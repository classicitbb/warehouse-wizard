import { describe, expect, it } from "vitest";

import {
  RECEIPT_JOB_TYPES,
  buildReceiptJobPayload,
  interpretReceiptResponse,
  netsuiteReceiptExternalRef,
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
    expect(interpretReceiptResponse({ error: "Invalid item" })).toEqual({ ok: false, reason: "Invalid item" });
    expect(interpretReceiptResponse(null).ok).toBe(false);
    expect(interpretReceiptResponse({ success: false, message: "denied" })).toEqual({ ok: false, reason: "denied" });
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
