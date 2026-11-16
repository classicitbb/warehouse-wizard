import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { floorStage, needsPackCount, scanMatchesLine, tripDispatchState } from "@/features/trips/trip-dispatch-core";
import type { TripBoardRow } from "@/features/trips/trips-core";
import {
  buildFulfillmentShipPatch,
  isPermanentFulfillmentFailure,
  isShipShort,
  resolveFulfillmentKpiFields,
  validateFulfillmentShipPayload,
  type FulfillmentShipPayload,
} from "../../supabase/functions/_shared/netsuite-fulfillment";
import { NETSUITE_OUTBOUND_JOB_TYPES } from "../../supabase/functions/_shared/netsuite-queue";

function row(overrides: Partial<TripBoardRow>): TripBoardRow {
  return {
    fulfillment_id: "f1", warehouse_id: "w1", warehouse_code: "LE", document_number: "IF1", external_status: "A",
    fulfillment_date: "2026-11-04", truck_external_id: "7", truck_name: "C1490", trip_number: "1", picker_name: null,
    order_id: "o1", order_number: "SO1", order_type: "sales", customer_name: "C", delivery_zone: null, on_credit_hold: false,
    part_number: 1, part_count: 1, line_count: 1, unmapped_count: 0, quantity: 10,
    pick_list_id: "pl1", pick_list_status: "completed", picked_quantity: 10, open_tasks: 0, short_tasks: 0, exception_tasks: 0,
    is_aged: false, ww_stage: null, staging_lane: null, departed_at: null, ship_sync_status: null, ship_sync_error: null,
    ...overrides,
  };
}

describe("floor stage", () => {
  it("moves pick -> pack -> stage -> load -> departed", () => {
    expect(floorStage(row({ pick_list_status: "in_progress", open_tasks: 1 }))).toBe("pick");
    expect(floorStage(row({}))).toBe("pack");
    expect(floorStage(row({ ww_stage: "packed" }))).toBe("stage");
    expect(floorStage(row({ ww_stage: "staged" }))).toBe("load");
    expect(floorStage(row({ ww_stage: "departed" }))).toBe("departed");
  });

  it("a picked list with nothing picked cannot be packed", () => {
    expect(floorStage(row({ picked_quantity: 0, short_tasks: 1 }))).toBe("nothing_picked");
  });
});

describe("trip dispatch state", () => {
  it("departs only when every order with picks is loaded", () => {
    const s = tripDispatchState({ fulfillments: [row({ ww_stage: "loaded" }), row({ fulfillment_id: "f2", ww_stage: "staged" })] });
    expect(s.canDepart).toBe(false);
    expect(s.waiting.map((r) => r.fulfillment_id)).toEqual(["f2"]);
  });

  it("orders with nothing picked stay behind and do not block", () => {
    const s = tripDispatchState({ fulfillments: [row({ ww_stage: "loaded" }), row({ fulfillment_id: "f2", pick_list_id: null, picked_quantity: 0 })] });
    expect(s.canDepart).toBe(true);
    expect(s.leftBehind).toHaveLength(1);
  });

  it("flags a short trip", () => {
    expect(tripDispatchState({ fulfillments: [row({ ww_stage: "loaded", picked_quantity: 6 })] }).shipsShort).toBe(true);
    expect(tripDispatchState({ fulfillments: [row({ ww_stage: "loaded" })] }).shipsShort).toBe(false);
  });
});

describe("pack check", () => {
  const line = { product: { sku: "ABC-1", name: "x", barcode: "0123" }, picked: 5, packed_quantity: null };
  it("matches SKU or barcode, case-insensitive", () => {
    expect(scanMatchesLine(" abc-1 ", line)).toBe(true);
    expect(scanMatchesLine("0123", line)).toBe(true);
    expect(scanMatchesLine("XYZ", line)).toBe(false);
  });
  it("needs a count only for picked lines not yet counted", () => {
    expect(needsPackCount(line)).toBe(true);
    expect(needsPackCount({ ...line, packed_quantity: 5 })).toBe(false);
    expect(needsPackCount({ ...line, picked: 0 })).toBe(false);
  });
});

describe("NetSuite fulfillment_ship", () => {
  const payload: FulfillmentShipPayload = {
    fulfillmentId: "12345",
    externalRef: "ww-ship-abc",
    pickedAt: "2026-11-04T13:00:00Z",
    packedAt: "2026-11-04T13:30:00Z",
    shippedAt: "2026-11-04T14:00:00Z",
    lines: [
      { line: "1", plannedBase: 24, pickedBase: 24, quantity: 2 },
      { line: "2", plannedBase: 10, pickedBase: 4, quantity: 4 },
      { line: "3", plannedBase: 5, pickedBase: 0, quantity: 0 },
    ],
  };

  it("is a claimed outbound job type", () => {
    expect(NETSUITE_OUTBOUND_JOB_TYPES).toContain("fulfillment_ship");
  });

  it("sets Shipped, ships short, and drops lines with nothing picked", () => {
    const body = buildFulfillmentShipPatch(payload) as { shipStatus: unknown; memo: string; item: { items: unknown[] }; custbody_spx_kpi_picked_at: string };
    expect(body.shipStatus).toEqual({ id: "C" });
    expect(body.memo).toContain("shipped short");
    expect(body.item.items).toEqual([
      { line: 1, itemReceive: true, quantity: 2 },
      { line: 2, itemReceive: true, quantity: 4 },
      { line: 3, itemReceive: false },
    ]);
    expect(body.custbody_spx_kpi_picked_at).toBe("2026-11-04T13:00:00.000Z");
    expect(isShipShort(payload)).toBe(true);
  });

  it("writes only the configured KPI fields", () => {
    const kpi = resolveFulfillmentKpiFields({ fulfillment_kpi_fields: { shipped: "custbody_spx_kpi_shipped_at", packed: "bad field" } });
    expect(kpi).toEqual({ shipped: "custbody_spx_kpi_shipped_at" });
    const body = buildFulfillmentShipPatch(payload, kpi);
    expect(body.custbody_spx_kpi_shipped_at).toBe("2026-11-04T14:00:00.000Z");
    expect(body).not.toHaveProperty("custbody_spx_kpi_picked_at");
  });

  it("refuses a payload with nothing picked or a bad id", () => {
    expect(validateFulfillmentShipPayload(payload)).toBeNull();
    expect(validateFulfillmentShipPayload({ ...payload, fulfillmentId: "IF1" })).toMatch(/fulfillment id/);
    expect(validateFulfillmentShipPayload({ ...payload, lines: payload.lines.map((l) => ({ ...l, quantity: 0 })) })).toMatch(/nothing picked/);
  });

  it("parks record errors but retries auth and rate limits", () => {
    expect(isPermanentFulfillmentFailure(400)).toBe(true);
    expect(isPermanentFulfillmentFailure(429)).toBe(false);
    expect(isPermanentFulfillmentFailure(401)).toBe(false);
    expect(isPermanentFulfillmentFailure(503)).toBe(false);
  });
});

describe("trip dispatch migration", () => {
  const sql = readFileSync("supabase/migrations/20261104090000_trip_dispatch.sql", "utf8");
  it("gates the NetSuite post on the connection flag", () => {
    expect(sql).toContain("fulfillments_post_to_netsuite");
    expect(sql).toContain("'fulfillment:ship:' || ful.id::text");
  });
  it("needs a supervisor to ship short", () => {
    expect(sql).toMatch(/v_short and not exists \(/);
    expect(sql).toContain("r.code::text in ('admin', 'warehouse_manager', 'warehouse_supervisor', 'developer')");
  });
  it("only adds to the schema", () => {
    expect(sql).not.toMatch(/\bdrop\s+(table|column)\b/i);
  });
});
