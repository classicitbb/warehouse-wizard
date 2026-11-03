import { describe, expect, it } from "vitest";

import {
  RECEIPT_JOB_TYPES,
  buildInboundShipmentRestletBody,
  buildReceiptJobPayload,
  interpretReceiptResponse,
  netsuiteReceiptExternalRef,
  planShipmentReceipt,
  receiptIdempotencyKey,
} from "../../supabase/functions/_shared/netsuite-receipt";
import { netsuiteRefFromDraftMeta } from "@/features/receiving/netsuite-lookup-lines";

describe("externalRef and idempotency key", () => {
  it("is deterministic, so every retry sends the same reference", () => {
    const a = netsuiteReceiptExternalRef("purchase_order", "shipment_1f3a");
    expect(a).toBe(netsuiteReceiptExternalRef("purchase_order", "shipment_1f3a"));
    expect(a).toBe("ww-rcpt-po-shipment_1f3a");
  });

  it("differs by document type and posting", () => {
    const refs = new Set([
      netsuiteReceiptExternalRef("purchase_order", "x"),
      netsuiteReceiptExternalRef("transfer_order", "x"),
      netsuiteReceiptExternalRef("inbound_shipment", "x"),
      netsuiteReceiptExternalRef("purchase_order", "y"),
    ]);
    expect(refs.size).toBe(4);
  });

  it("keeps only characters NetSuite allows and caps the length", () => {
    expect(netsuiteReceiptExternalRef("transfer_order", "a b/c#1")).toBe("ww-rcpt-to-a-b-c-1");
    expect(netsuiteReceiptExternalRef("inbound_shipment", "k".repeat(200)).length).toBe(64);
  });

  it("rejects an empty posting key", () => {
    expect(() => netsuiteReceiptExternalRef("purchase_order", "  ")).toThrow();
  });

  it("builds one idempotency key per posting", () => {
    expect(receiptIdempotencyKey("inbound_shipment", "g1")).toBe("receipt:inbound_shipment:g1");
    expect(RECEIPT_JOB_TYPES.inbound_shipment).toBe("receipt_inbound_shipment");
  });
});

describe("buildReceiptJobPayload", () => {
  const line = { lineKey: "3", lineNumber: 1, itemId: "2963", quantity: 10 };

  it("always carries the externalRef and drops empty lines", () => {
    const p = buildReceiptJobPayload({
      documentType: "purchase_order",
      documentId: " 555 ",
      postingKey: "g1",
      lines: [line, { ...line, quantity: 0 }],
    });
    expect(p.externalRef).toBe("ww-rcpt-po-g1");
    expect(p.documentId).toBe("555");
    expect(p.lines).toHaveLength(1);
    expect(p.locationId).toBeNull();
  });

  it("refuses a job with no document or no quantity", () => {
    expect(() => buildReceiptJobPayload({ documentType: "purchase_order", documentId: "", postingKey: "g", lines: [line] })).toThrow();
    expect(() => buildReceiptJobPayload({ documentType: "purchase_order", documentId: "1", postingKey: "g", lines: [{ ...line, quantity: 0 }] })).toThrow();
  });
});

describe("buildInboundShipmentRestletBody", () => {
  const job = buildReceiptJobPayload({
    documentType: "inbound_shipment",
    documentId: "52",
    postingKey: "rcpt-1",
    locationId: "3",
    lines: [{ lineKey: "4827", lineNumber: 2, itemId: "2963", quantity: 95, poId: "76", lotNumber: "LOT-A1", expiryDate: "2027-09-01" }],
  });

  it("names the shipment, the line key and the externalRef", () => {
    expect(buildInboundShipmentRestletBody(job)).toEqual({
      inboundShipmentId: "52",
      externalRef: "ww-rcpt-ship-rcpt-1",
      lines: [{
        shipmentLineKey: "4827", quantity: 95, poId: "76", lineNumber: 2, location: "3",
        inventoryAssignment: [{ receiptInventoryNumber: "LOT-A1", expirationDate: "2027-09-01", quantity: 95 }],
      }],
    });
  });

  it("sends no lot, location or PO the pallet does not have", () => {
    const plain = buildReceiptJobPayload({
      documentType: "inbound_shipment", documentId: "52", postingKey: "r2",
      lines: [{ lineKey: "9", lineNumber: null, itemId: "1", quantity: 5 }],
    });
    expect(buildInboundShipmentRestletBody(plain).lines).toEqual([{ shipmentLineKey: "9", quantity: 5 }]);
  });

  it("sends each shipment line once: two pallets of one PO line become one line with two lots", () => {
    const twoPallets = buildReceiptJobPayload({
      documentType: "inbound_shipment", documentId: "52", postingKey: "r4",
      lines: [
        { lineKey: "4827", lineNumber: 2, itemId: "1", quantity: 40, lotNumber: "LOT-A", expiryDate: "2027-01-01" },
        { lineKey: "4827", lineNumber: 2, itemId: "1", quantity: 55, lotNumber: "LOT-B" },
        { lineKey: "4827", lineNumber: 2, itemId: "1", quantity: 5, lotNumber: "LOT-A", expiryDate: "2027-01-01" },
        { lineKey: "9", lineNumber: 3, itemId: "2", quantity: 7 },
      ],
    });
    expect(buildInboundShipmentRestletBody(twoPallets).lines).toEqual([
      {
        shipmentLineKey: "4827", quantity: 100, lineNumber: 2,
        inventoryAssignment: [
          { receiptInventoryNumber: "LOT-A", expirationDate: "2027-01-01", quantity: 45 },
          { receiptInventoryNumber: "LOT-B", quantity: 55 },
        ],
      },
      { shipmentLineKey: "9", quantity: 7, lineNumber: 3 },
    ]);
  });

  it("refuses one line that mixes lot-tracked and untracked pallets", () => {
    const mixed = buildReceiptJobPayload({
      documentType: "inbound_shipment", documentId: "52", postingKey: "r5",
      lines: [
        { lineKey: "4827", lineNumber: 2, itemId: "1", quantity: 40, lotNumber: "LOT-A" },
        { lineKey: "4827", lineNumber: 2, itemId: "1", quantity: 10 },
      ],
    });
    expect(() => buildInboundShipmentRestletBody(mixed)).toThrow(/mixes lot-tracked/);
  });

  it("refuses a line with no shipment line key, or another document type", () => {
    const noKey = buildReceiptJobPayload({ documentType: "inbound_shipment", documentId: "52", postingKey: "r3", lines: [{ lineKey: null, lineNumber: 1, itemId: "1", quantity: 5 }] });
    expect(() => buildInboundShipmentRestletBody(noKey)).toThrow(/line key/);
    expect(() => buildInboundShipmentRestletBody({ ...job, documentType: "purchase_order" })).toThrow();
  });
});

describe("planShipmentReceipt: a PO that sits on an inbound shipment", () => {
  // PO53 (internal id 2727) in the sandbox: both lines are on IS033, which is partially received, and on IS045, fully received.
  const po53 = [
    { shipmentId: "33", lineNumber: 1, lineKey: "12487", remaining: 759 - 695 },
    { shipmentId: "33", lineNumber: 2, lineKey: "12488", remaining: 0 },
    { shipmentId: "45", lineNumber: 1, lineKey: "12487", remaining: 0 },
    { shipmentId: "45", lineNumber: 2, lineKey: "12488", remaining: 0 },
  ];

  it("routes the PO53 receipts that failed with a 400 to IS033", () => {
    for (const quantity of [64, 36, 28]) {
      expect(planShipmentReceipt(po53, [{ lineNumber: 1, quantity }])).toEqual({
        ok: true, shipmentId: "33", lines: [{ lineNumber: 1, lineKey: "12487", quantity }],
      });
    }
  });

  it("refuses more than any shipment has left, and says where the stock is", () => {
    const plan = planShipmentReceipt(po53, [{ lineNumber: 1, quantity: 65 }]);
    expect(plan.ok).toBe(false);
    expect(plan.ok === false && plan.reason).toMatch(/shipment 33: 64/);
  });

  it("needs one shipment to take every line", () => {
    const split = [
      { shipmentId: "1", lineNumber: 1, lineKey: "a", remaining: 10 },
      { shipmentId: "2", lineNumber: 2, lineKey: "b", remaining: 10 },
    ];
    expect(planShipmentReceipt(split, [{ lineNumber: 1, quantity: 5 }, { lineNumber: 2, quantity: 5 }]).ok).toBe(false);
  });

  it("prefers the shipment with the most left when a line is on several", () => {
    const two = [
      { shipmentId: "7", lineNumber: 1, lineKey: "k", remaining: 5 },
      { shipmentId: "8", lineNumber: 1, lineKey: "k", remaining: 50 },
    ];
    expect(planShipmentReceipt(two, [{ lineNumber: 1, quantity: 5 }])).toMatchObject({ ok: true, shipmentId: "8" });
  });
});

describe("interpretReceiptResponse", () => {
  it("treats alreadyProcessed as success and keeps the existing ids", () => {
    expect(interpretReceiptResponse({ alreadyProcessed: true, itemReceiptIds: [11, 12] })).toEqual({
      ok: true,
      receiptIds: ["11", "12"],
      alreadyProcessed: true,
    });
  });

  it("keeps every receipt id when one posting spans several POs", () => {
    const r = interpretReceiptResponse({ itemReceipts: [{ id: 1 }, { itemReceiptId: 2 }, 3] });
    expect(r).toEqual({ ok: true, receiptIds: ["1", "2", "3"], alreadyProcessed: false });
  });

  it("fails when no receipt id comes back", () => {
    expect(interpretReceiptResponse({ error: "Invalid item" })).toEqual({ ok: false, reason: "Invalid item", retryable: true });
    expect(interpretReceiptResponse(null).ok).toBe(false);
    expect(interpretReceiptResponse({ success: false, message: "denied" })).toEqual({ ok: false, reason: "denied", retryable: true });
  });

  it("reads the RESTlet failure shape: code and retryable decide whether to retry", () => {
    expect(interpretReceiptResponse({ ok: false, code: "OVER_RECEIPT", retryable: false, error: "Quantity exceeds shipment" })).toEqual({
      ok: false, reason: "OVER_RECEIPT: Quantity exceeds shipment", retryable: false, code: "OVER_RECEIPT",
    });
    expect(interpretReceiptResponse({ ok: false, code: "RCRD_HAS_BEEN_CHANGED", retryable: true, error: "changed" })).toMatchObject({ ok: false, retryable: true });
    expect(interpretReceiptResponse({ ok: true, itemReceiptIds: [5], alreadyProcessed: false })).toEqual({ ok: true, receiptIds: ["5"], alreadyProcessed: false });
  });
});

describe("W4: NetSuite line saved with the draft", () => {
  it("round-trips the line reference from draft notes", () => {
    const ref = { lineKey: "3", lineNumber: 2, itemName: "Bottle", ordered: 100, received: 40, remaining: 60 };
    expect(netsuiteRefFromDraftMeta(JSON.parse(JSON.stringify({ netsuite: ref })))).toEqual(ref);
  });

  it("returns undefined for drafts that did not come from NetSuite", () => {
    expect(netsuiteRefFromDraftMeta({})).toBeUndefined();
    expect(netsuiteRefFromDraftMeta(null)).toBeUndefined();
    expect(netsuiteRefFromDraftMeta({ netsuite: "x" })).toBeUndefined();
  });

  it("defaults missing numbers to zero", () => {
    expect(netsuiteRefFromDraftMeta({ netsuite: { lineKey: "9" } })).toEqual({
      lineKey: "9", lineNumber: null, itemName: "", ordered: 0, received: 0, remaining: 0,
    });
  });
});
