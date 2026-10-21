import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// What the sandbox said, captured on 2026-10-21 through the netsuite-discovery
// function. These tests pin the field names the lookup reads and the receipt
// will send to what the account actually exposes, so a wrong guess fails here
// rather than in front of a receiver.
function fixture<T>(name: string): T {
  return JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "src/test/fixtures/netsuite", name), "utf8")) as T;
}

type Catalog = Record<string, Record<string, string>>;
const catalog = fixture<Catalog>("catalog-receiving-line-fields.json");

describe("source order line fields (metadata catalog)", () => {
  it.each(["purchaseOrder", "transferOrder"])("%s exposes every field the lookup reads", (record) => {
    for (const field of ["line", "quantity", "quantityReceived", "quantityFulfilled", "isClosed", "units", "location"]) {
      expect(catalog[record], `${record}.${field}`).toHaveProperty(field);
    }
  });

  it("gives a purchase order line a uniqueKey and a transfer order line no key at all", () => {
    expect(catalog.purchaseOrder).toHaveProperty("uniqueKey");
    expect(catalog.transferOrder).not.toHaveProperty("uniqueKey");
    expect(catalog.transferOrder).not.toHaveProperty("lineUniqueKey");
  });

  it("uses lineUniqueKey, a string, on sales orders and return authorisations", () => {
    expect(catalog.salesOrder.lineUniqueKey).toBe("string");
    expect(catalog.returnAuthorization.lineUniqueKey).toBe("string");
  });
});

describe("receipt line fields (metadata catalog)", () => {
  it("points an item receipt line back at its source line with orderLine", () => {
    expect(catalog.itemReceipt).toHaveProperty("orderLine");
    expect(catalog.itemReceipt).toHaveProperty("orderDoc");
    expect(catalog.itemReceipt).toHaveProperty("itemReceive");
    expect(catalog.itemReceipt).toHaveProperty("inventoryDetail");
  });
});

describe("inbound shipment RESTlet report (IS052)", () => {
  const report = fixture<{
    recordType: string
    configuredSublistId: string
    sublistIdExists: boolean
    sublistIds: string[]
    lineCount: number
    bodyFieldIds: string[]
    firstLineFieldIds: string[]
    inventoryDetailFieldId: string
  }>("restlet-inbound-shipment-52.json");

  it("receives through the receiveitems sublist of a receiveinboundshipment record", () => {
    expect(report.recordType).toBe("receiveinboundshipment");
    expect(report.configuredSublistId).toBe("receiveitems");
    expect(report.sublistIdExists).toBe(true);
    expect(report.sublistIds).toEqual(["receiveitems"]);
  });

  it("carries two purchase orders' lines, each tied to its PO line by origline and uniquekey", () => {
    expect(report.lineCount).toBe(36);
    for (const field of ["uniquekey", "origline", "purchaseorder", "item", "quantity", "quantityremaining", "quantityreceived", "quantitytobereceived", "receiveitem", "unit", "receivinglocation"]) {
      expect(report.firstLineFieldIds, field).toContain(field);
    }
  });

  it("names the body fields a receipt sets", () => {
    for (const field of ["trandate", "receivinglocation", "postingperiod", "inboundshipmentnumber", "externalid"]) {
      expect(report.bodyFieldIds, field).toContain(field);
    }
  });

  it("holds inventory detail in a subrecord, not on the line itself", () => {
    expect(report.inventoryDetailFieldId).toBe("inventorydetail");
    expect(report.firstLineFieldIds).not.toContain("inventorydetail");
    expect(report.firstLineFieldIds).toContain("inventorydetailreq");
  });
});
