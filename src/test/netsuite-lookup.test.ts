import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  buildDocumentSearchQuery,
  isLookupDocumentType,
  normalizeDocument,
  normalizeDocumentNumber,
  normalizeLine,
} from "../../supabase/functions/_shared/netsuite-lookup";

describe("normalizeDocumentNumber", () => {
  it("accepts scanned document numbers and trims them", () => {
    expect(normalizeDocumentNumber("  PO1234 ")).toBe("PO1234");
    expect(normalizeDocumentNumber("TO/2026-0042")).toBe("TO/2026-0042");
    expect(normalizeDocumentNumber("PO  1234")).toBe("PO 1234");
  });

  it("rejects empty, oversized and non-string input", () => {
    expect(normalizeDocumentNumber("")).toBeNull();
    expect(normalizeDocumentNumber("   ")).toBeNull();
    expect(normalizeDocumentNumber("A".repeat(41))).toBeNull();
    expect(normalizeDocumentNumber(1234)).toBeNull();
    expect(normalizeDocumentNumber(null)).toBeNull();
  });

  it("rejects anything that could break out of a SuiteQL literal", () => {
    expect(normalizeDocumentNumber("PO1' OR '1'='1")).toBeNull();
    expect(normalizeDocumentNumber("PO1;DROP")).toBeNull();
    expect(normalizeDocumentNumber("PO1\\")).toBeNull();
    expect(normalizeDocumentNumber("-PO1")).toBeNull();
  });
});

describe("isLookupDocumentType", () => {
  it("allows only the two Phase 1 lookup types handled here", () => {
    expect(isLookupDocumentType("purchase_order")).toBe(true);
    expect(isLookupDocumentType("transfer_order")).toBe(true);
    expect(isLookupDocumentType("inbound_shipment")).toBe(false);
    expect(isLookupDocumentType("toString")).toBe(false);
    expect(isLookupDocumentType(undefined)).toBe(false);
  });
});

describe("buildDocumentSearchQuery", () => {
  it("filters on the record type and an exact, case-insensitive number", () => {
    const q = buildDocumentSearchQuery("purchase_order", "PO1234");
    expect(q).toContain("t.type = 'PurchOrd'");
    expect(q).toContain("UPPER(t.tranid) = UPPER('PO1234')");
    expect(buildDocumentSearchQuery("transfer_order", "TO9")).toContain("t.type = 'TrnfrOrd'");
  });

  it("does not select subsidiary, which fails on accounts that are not OneWorld", () => {
    expect(buildDocumentSearchQuery("purchase_order", "PO1")).not.toMatch(/subsidiary/i);
  });
});

describe("normalizeLine", () => {
  it("reads a purchase order line and computes what is left to receive", () => {
    const line = normalizeLine("purchase_order", {
      item: { id: "77", refName: "RICE-25KG" },
      line: 3,
      quantity: 100,
      quantityReceived: 40,
      quantityOnShipments: 0,
      location: { id: "6", refName: "Main" },
      units: "575",
      description: "Rice 25kg",
      isClosed: false,
    }, "2751");
    expect(line).toMatchObject({
      lineKey: "2751:3",
      lineNumber: 3,
      itemId: "77",
      itemName: "RICE-25KG",
      quantityOrdered: 100,
      quantityFulfilled: null,
      quantityReceived: 40,
      quantityRemaining: 60,
      quantityOnShipments: 0,
      unitId: "575",
      location: { id: "6", name: "Main" },
      closed: false,
    });
  });

  it("never reports a negative remaining quantity after an over-receipt", () => {
    const line = normalizeLine("purchase_order", { item: { id: "1" }, quantity: 10, quantityReceived: 12 });
    expect(line.quantityRemaining).toBe(0);
  });

  it("treats a closed line as fully received", () => {
    const line = normalizeLine("purchase_order", { item: { id: "1" }, quantity: 10, quantityReceived: 0, isClosed: true });
    expect(line.closed).toBe(true);
    expect(line.quantityRemaining).toBe(0);
  });

  it("caps a transfer order line at what has actually been shipped", () => {
    const line = normalizeLine("transfer_order", {
      item: { id: "9" },
      quantity: 50,
      quantityFulfilled: 30,
      quantityReceived: 10,
    });
    expect(line.quantityFulfilled).toBe(30);
    expect(line.quantityRemaining).toBe(20);
  });

  it("has nothing to receive on a transfer order line that has not shipped", () => {
    const line = normalizeLine("transfer_order", { item: { id: "9" }, quantity: 50 });
    expect(line.quantityFulfilled).toBe(0);
    expect(line.quantityRemaining).toBe(0);
  });

  it("accepts numbers NetSuite serialises as strings", () => {
    const line = normalizeLine("purchase_order", {
      item: { id: "5" },
      quantity: "12",
      quantityReceived: "2",
      line: "4",
      isClosed: "F",
    }, "88");
    expect(line.quantityOrdered).toBe(12);
    expect(line.quantityRemaining).toBe(10);
    expect(line.lineKey).toBe("88:4");
    expect(line.closed).toBe(false);
  });

  it("reads only the verified field names, not the guessed spellings", () => {
    const line = normalizeLine("purchase_order", {
      item: { id: "5" },
      quantity: 12,
      quantityreceived: 2,
      lineuniquekey: "991",
      lineUniqueKey: "992",
      uniqueKey: 993,
      isclosed: true,
      orderLine: 9,
    }, "88");
    expect(line.quantityReceived).toBe(0);
    expect(line.lineKey).toBeNull();
    expect(line.closed).toBe(false);
    expect(line.lineNumber).toBeNull();
  });

  it("keys a line by document and line, since NetSuite returns no line key on a PO or a TO", () => {
    const raw = { item: { id: "9" }, line: 2, quantity: 5, quantityFulfilled: 5 };
    expect(normalizeLine("transfer_order", raw, "301").lineKey).toBe("301:2");
    // The same line number on another transfer order must not collide.
    expect(normalizeLine("transfer_order", raw, "302").lineKey).toBe("302:2");
    expect(normalizeLine("transfer_order", raw).lineKey).toBeNull();
  });

  it("degrades to empty values instead of throwing on a sparse line", () => {
    const line = normalizeLine("purchase_order", null);
    expect(line.lineKey).toBeNull();
    expect(line.itemId).toBeNull();
    expect(line.quantityOrdered).toBe(0);
    expect(line.location).toBeNull();
  });
});

describe("normalizeDocument", () => {
  const record = {
    tranId: "PO1234",
    tranDate: "2026-09-20",
    memo: "Container 1",
    status: { id: "Pending Receipt", refName: "Pending Receipt" },
    orderStatus: { id: "B", refName: "B" },
    entity: { id: "300", refName: "Acme Foods" },
    location: { id: "6", refName: "Main" },
    item: {
      items: [
        { item: { id: "77", refName: "RICE" }, line: 1, quantity: 10, quantityReceived: 0 },
        { item: { id: "78", refName: "OIL" }, line: 3, quantity: 5, quantityReceived: 5 },
      ],
    },
  };

  it("maps the header and keeps the source line numbers as sent", () => {
    const doc = normalizeDocument("purchase_order", "555", record);
    expect(doc).toMatchObject({
      type: "purchase_order",
      internalId: "555",
      number: "PO1234",
      status: { code: "B", label: "Pending Receipt" },
      entity: { id: "300", name: "Acme Foods" },
      location: { id: "6", name: "Main" },
      tranDate: "2026-09-20",
      memo: "Container 1",
    });
    expect(doc.lines.map((l) => l.lineNumber)).toEqual([1, 3]);
    expect(doc.lines.map((l) => l.quantityRemaining)).toEqual([10, 0]);
  });

  it("reads a transfer order's status from orderStatus, which is the only status it has", () => {
    const doc = normalizeDocument("transfer_order", "301", {
      tranId: "TO05",
      orderStatus: { id: "E", refName: "Partially Fulfilled" },
      item: { items: [{ item: { id: "9" }, line: 1, quantity: 4, quantityFulfilled: 4 }] },
    });
    expect(doc.status).toEqual({ code: "E", label: "Partially Fulfilled" });
    expect(doc.lines[0].lineKey).toBe("301:1");
  });

  it("returns no lines when the record has no item sublist", () => {
    expect(normalizeDocument("transfer_order", "1", { tranId: "TO1" }).lines).toEqual([]);
    expect(normalizeDocument("transfer_order", "1", null).number).toBe("");
  });
});

describe("real sandbox records (PO76 and TO05, 2026-10-21)", () => {
  const records = JSON.parse(
    fs.readFileSync(path.resolve(process.cwd(), "src/test/fixtures/netsuite/record-po76-and-to05.json"), "utf8"),
  );

  it("reads PO76 as pending receipt, with the line on an inbound shipment and a key built from document and line", () => {
    const doc = normalizeDocument("purchase_order", "2751", records.purchaseOrder);
    expect(doc).toMatchObject({
      number: "PO76",
      status: { code: "B", label: "Pending Receipt" },
      entity: { id: "379", name: "Changsha Glowjoy Hardware Co." },
      location: { id: "3", name: "LOC-01 Lower Estate" },
      tranDate: "2026-06-12",
    });
    expect(doc.lines).toHaveLength(1);
    expect(doc.lines[0]).toMatchObject({
      lineKey: "2751:1",
      lineNumber: 1,
      itemId: "6262",
      itemName: "GJWCFSLIP",
      quantityOrdered: 15040,
      quantityReceived: 0,
      quantityOnShipments: 15040,
      quantityRemaining: 15040,
      unitId: "575",
      location: { id: "3", name: "LOC-01 Lower Estate" },
      closed: false,
    });
  });

  it("reads TO05 as pending fulfilment with nothing receivable yet", () => {
    const doc = normalizeDocument("transfer_order", "16317", records.transferOrder);
    expect(doc).toMatchObject({
      number: "TO05",
      status: { code: "B", label: "Pending Fulfillment" },
      entity: null,
      location: { id: "4", name: "LOC-02 Pine Showroom" },
    });
    expect(doc.lines[0]).toMatchObject({
      lineKey: "16317:1",
      lineNumber: 1,
      quantityOrdered: 1,
      quantityFulfilled: 0,
      quantityOnShipments: null,
      quantityRemaining: 0,
      unitId: "93",
    });
  });
});
