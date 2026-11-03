import { describe, expect, it } from "vitest";

import {
  buildFulfillmentHeaderQuery,
  buildFulfillmentLinesQuery,
  buildOrderHeaderQuery,
  buildOrderLinesQuery,
  laterCursor,
  mapFulfillmentHeader,
  mapFulfillmentLine,
  mapOrderHeader,
  mapOrderLine,
  orderTaskStatus,
  safeIds,
} from "../../supabase/functions/_shared/netsuite-orders";

describe("netsuite orders: queries", () => {
  it("reads open SOs and TOs at mapped locations on the first import", () => {
    const q = buildOrderHeaderQuery({ afterId: 0, locationIds: ["3", "4"] })!;
    expect(q).toContain("JOIN transactionline ml ON ml.transaction = t.id AND ml.mainline = 'T'");
    expect(q).toContain("t.type IN ('SalesOrd', 'TrnfrOrd') AND ml.location IN (3,4)");
    expect(q).toContain("t.status IN ('B','D','E')");
    expect(q).toContain("BUILTIN.DF(t.custbody_truck) AS truck");
    expect(q).toMatch(/AND t\.id > 0 ORDER BY t\.id$/);
  });

  it("reads every changed order after a cursor, so closed orders leave the inbox", () => {
    const q = buildOrderHeaderQuery({ afterId: 29000, since: "2026-10-28T13:11:42", locationIds: ["3"] })!;
    expect(q).toContain("t.lastmodifieddate >= TO_DATE('2026-10-28 13:11:42', 'YYYY-MM-DD HH24:MI:SS')");
    expect(q).not.toContain("t.status IN");
    expect(q).toContain("t.id > 29000");
  });

  it("returns null without a mapped location, and never embeds unsafe ids or cursors", () => {
    expect(buildOrderHeaderQuery({ afterId: 0, locationIds: [] })).toBeNull();
    expect(buildOrderHeaderQuery({ afterId: 0, locationIds: ["3) OR (1=1"] })).toBeNull();
    const q = buildOrderHeaderQuery({ afterId: Number.NaN, since: "x' OR 1=1 --", locationIds: ["3"] })!;
    expect(q).not.toContain("OR 1=1");
    expect(q).toContain("t.id > 0");
    expect(safeIds(["1", " 2 ", 3, "4;", "", "1"])).toEqual(["1", "2", "3"]);
  });

  it("takes SO item lines and only the TO source-side shipping line", () => {
    const q = buildOrderLinesQuery(["29444", "27129"])!;
    expect(q).toContain("tl.transaction IN (29444,27129)");
    expect(q).toContain("tl.taxline = 'F'");
    expect(q).toContain("tl.itemtype IN ('InvtPart','Assembly')");
    expect(q).toContain("(t.type = 'SalesOrd' OR (tl.transferorderitemlineid IS NOT NULL AND tl.quantity < 0))");
    expect(buildOrderLinesQuery([])).toBeNull();
  });

  it("reads Picked/Packed fulfillments first, then every changed one", () => {
    expect(buildFulfillmentHeaderQuery({ afterId: 0, locationIds: ["3"] })).toContain("t.status IN ('A','B')");
    const delta = buildFulfillmentHeaderQuery({ afterId: 0, since: "2026-10-28 13:11:30", locationIds: ["3"] })!;
    expect(delta).toContain("t.type = 'ItemShip'");
    expect(delta).not.toContain("t.status IN");
    expect(buildFulfillmentLinesQuery(["31399"])).toContain("lnk.linktype IN ('PickPack', 'ShipRcpt')");
  });
});

describe("netsuite orders: mapping", () => {
  // Shapes taken from SO1943 / IF2154 / TO18 in _SB1 on 2026-10-31.
  it("maps an SO header with the office's truck, trip and picker", () => {
    const order = mapOrderHeader({
      id: "29444", tranid: "SO1943", type: "SalesOrd", status: "B", trandate: "2026-09-28", shipdate: "2026-09-28",
      entity: "28", entityname: "Massy Stores", otherrefnum: "DELI", location: "3",
      truck_id: "4", truck: "C1761 - Codie Skeete", trip: "123", picker: "Bryan Carrol", printed: "T", shipcomplete: "F",
      modified: "2026-10-28 13:11:42",
    })!;
    expect(order).toMatchObject({
      externalId: "29444", locationId: "3", order_number: "SO1943", order_type: "sales", external_status: "B", status: "queued",
      customer_external_id: "28", customer_name: "Massy Stores", customer_reference: "DELI",
      truck_name: "C1761 - Codie Skeete", trip_number: "123", picker_name: "Bryan Carrol",
      picking_ticket_printed: true, ship_complete: false, destination_location_external_id: null,
    });
  });

  it("maps a TO header with its destination and no customer", () => {
    const order = mapOrderHeader({
      id: "27129", tranid: "TO18", type: "TrnfrOrd", status: "B", entity: "5", location: "3",
      transferlocation: "4", transferlocationname: "LOC-02 Pine Showroom", truck_id: "0", truck: "- None -",
    })!;
    expect(order.order_type).toBe("transfer");
    expect(order.customer_external_id).toBeNull();
    expect(order.destination_location_external_id).toBe("4");
    expect(order.truck_name).toBeNull();
    expect(order.truck_external_id).toBeNull();
  });

  it("rejects rows without id, number, location or a known type", () => {
    expect(mapOrderHeader({ tranid: "SO1", type: "SalesOrd", status: "B", location: "3" })).toBeNull();
    expect(mapOrderHeader({ id: "1", tranid: "SO1", type: "CustInvc", status: "B", location: "3" })).toBeNull();
    expect(mapOrderHeader({ id: "1", tranid: "SO1", type: "SalesOrd", status: "B" })).toBeNull();
  });

  it("keeps line quantities in base units without the outbound sign", () => {
    const line = mapOrderLine({
      transaction: "29444", id: "7", linesequencenumber: "7", uniquekey: "224604", item: "1534", units: "66",
      quantity: "-1500", quantitycommitted: "1500", quantityshiprecv: "0", isclosed: "F",
    })!;
    expect(line).toMatchObject({
      orderExternalId: "29444", itemExternalId: "1534", external_line_id: "7", external_line_key: "224604",
      line_number: 7, ns_unit_id: "66", quantity: 1500, committed_quantity: 1500, fulfilled_quantity: 0, is_closed: false,
    });
    expect(mapOrderLine({ transaction: "1", id: "2" })).toBeNull();
    expect(mapOrderLine({ transaction: "1", id: "2", item: "3", quantitycommitted: undefined })!.committed_quantity).toBe(0);
  });

  it("maps a Picked fulfillment and its link to the order line", () => {
    const f = mapFulfillmentHeader({
      id: "31399", tranid: "IF2154", status: "A", trandate: "2026-10-28", createdfrom: "29444", location: "3",
      truck_id: "4", truck: "C1761 - Codie Skeete", trip: "123", picker_id: "8", picker: "Bryan Carrol",
    })!;
    expect(f).toMatchObject({ externalId: "31399", orderExternalId: "29444", external_status: "A", fulfillment_date: "2026-10-28", picker_external_id: "8" });
    expect(mapFulfillmentHeader({ id: "1", tranid: "IF1", status: "A" })).toBeNull();
    expect(mapFulfillmentLine({ transaction: "31399", id: "6", item: "1119", units: "25", quantity: "-36", previousline: "3" })).toEqual({
      fulfillmentExternalId: "31399", external_line_id: "6", order_external_line_id: "3", ns_item_id: "1119", ns_unit_id: "25", quantity: 36,
    });
  });

  it("maps NetSuite status letters to WW task status", () => {
    expect(orderTaskStatus("B")).toBe("queued");
    expect(orderTaskStatus("E")).toBe("queued");
    expect(orderTaskStatus("H")).toBe("cancelled");
    expect(orderTaskStatus("G")).toBe("completed");
  });

  it("keeps the later cursor", () => {
    expect(laterCursor(null, "2026-10-01 00:00:00")).toBe("2026-10-01 00:00:00");
    expect(laterCursor("2026-10-02 00:00:00", "2026-10-01 00:00:00")).toBe("2026-10-02 00:00:00");
    expect(laterCursor("2026-10-02 00:00:00", null)).toBe("2026-10-02 00:00:00");
  });
});
