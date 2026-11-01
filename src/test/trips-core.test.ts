import { describe, expect, it } from "vitest";
import {
  filterTrips,
  groupTrips,
  localToday,
  orderLabel,
  pickState,
  remainingQuantity,
  sortPickTasks,
  toBaseUnits,
  tripTitle,
  type TripBoardRow,
  type TripPickTask,
} from "@/features/trips/trips-core";

function row(overrides: Partial<TripBoardRow>): TripBoardRow {
  return {
    fulfillment_id: "f1",
    warehouse_id: "w1",
    warehouse_code: "LE",
    document_number: "IF1",
    external_status: "A",
    fulfillment_date: "2026-11-01",
    truck_external_id: "7",
    truck_name: "C1490 - Driver",
    trip_number: "1",
    picker_name: null,
    order_id: "o1",
    order_number: "SO1",
    order_type: "sales",
    customer_name: "Customer",
    delivery_zone: null,
    on_credit_hold: false,
    part_number: 1,
    part_count: 1,
    line_count: 2,
    unmapped_count: 0,
    quantity: 10,
    pick_list_id: null,
    pick_list_status: null,
    picked_quantity: 0,
    open_tasks: 0,
    short_tasks: 0,
    exception_tasks: 0,
    is_aged: false,
    ...overrides,
  };
}

function task(overrides: Partial<TripPickTask>): TripPickTask {
  return {
    id: "t",
    task_number: "PKT",
    status: "queued",
    requested_quantity: 10,
    confirmed_quantity: 0,
    short_reason: null,
    location: { id: "l", code: "F-01-A", status: "pick_face", pick_sequence: 10 },
    fulfillment_line: { id: "fl", product_id: "p", product: { sku: "SKU", name: "Item" }, order_line: { line_number: 1, unit: null } },
    ...overrides,
  };
}

describe("trip grouping (O3)", () => {
  it("groups fulfillments by date, truck and trip number", () => {
    const trips = groupTrips([
      row({ fulfillment_id: "a", order_number: "SO2" }),
      row({ fulfillment_id: "b", order_number: "SO1" }),
      row({ fulfillment_id: "c", trip_number: "2" }),
      row({ fulfillment_id: "d", truck_external_id: "8", truck_name: "Other" }),
    ]);
    expect(trips).toHaveLength(3);
    expect(trips[0].fulfillments.map((f) => f.order_number)).toEqual(["SO1", "SO2"]);
  });

  it("puts the newest date first, then trips in number order (2 before 10)", () => {
    const trips = groupTrips([
      row({ fulfillment_id: "a", trip_number: "10" }),
      row({ fulfillment_id: "b", trip_number: "2" }),
      row({ fulfillment_id: "c", fulfillment_date: "2026-10-30", trip_number: "1" }),
    ]);
    expect(trips.map((t) => `${t.date}/${t.tripNumber}`)).toEqual(["2026-11-01/2", "2026-11-01/10", "2026-10-30/1"]);
  });

  it("counts picked orders and flags an aged trip", () => {
    const [trip] = groupTrips([
      row({ fulfillment_id: "a", pick_list_id: "p", pick_list_status: "completed" }),
      row({ fulfillment_id: "b", pick_list_id: "q", pick_list_status: "completed", short_tasks: 1 }),
      row({ fulfillment_id: "c", is_aged: true }),
    ]);
    expect(trip.picked).toBe(2);
    expect(trip.total).toBe(3);
    expect(trip.isAged).toBe(true);
  });

  it("filters to today", () => {
    const trips = groupTrips([row({ fulfillment_id: "a" }), row({ fulfillment_id: "b", fulfillment_date: "2026-10-30" })]);
    expect(filterTrips(trips, "today", "2026-11-01")).toHaveLength(1);
    expect(filterTrips(trips, "open", "2026-11-01")).toHaveLength(2);
  });

  it("titles a trip and formats the local date", () => {
    expect(tripTitle({ tripNumber: "3", truck: "Pine" })).toBe("Trip 3 · Pine");
    expect(tripTitle({ tripNumber: null, truck: null })).toBe("No trip number · No truck");
    expect(localToday(new Date(2026, 10, 1, 23, 30))).toBe("2026-11-01");
  });
});

describe("pick state", () => {
  it("blocks a sales order on credit hold until a list exists (D8)", () => {
    expect(pickState(row({ on_credit_hold: true }))).toBe("blocked");
    expect(pickState(row({ on_credit_hold: true, order_type: "transfer" }))).toBe("not_started");
  });

  it("follows the pick list", () => {
    expect(pickState(row({}))).toBe("not_started");
    expect(pickState(row({ pick_list_id: "p", pick_list_status: "in_progress", open_tasks: 2 }))).toBe("picking");
    expect(pickState(row({ pick_list_id: "p", pick_list_status: "in_progress", exception_tasks: 1 }))).toBe("exception");
    expect(pickState(row({ pick_list_id: "p", pick_list_status: "completed", short_tasks: 1 }))).toBe("short");
    expect(pickState(row({ pick_list_id: "p", pick_list_status: "completed" }))).toBe("picked");
  });

  it("shows part n of m only when an order has more than one fulfillment (N2)", () => {
    expect(orderLabel(row({}))).toBe("SO1");
    expect(orderLabel(row({ part_number: 2, part_count: 3 }))).toBe("SO1 · part 2 of 3");
  });
});

describe("handset lines", () => {
  it("sorts open lines in walk order, no-stock lines next, closed lines last", () => {
    const sorted = sortPickTasks([
      task({ id: "closed", status: "completed", location: { id: "a", code: "A-01-A", status: "active", pick_sequence: 1 } }),
      task({ id: "nostock", status: "exception", location: null }),
      task({ id: "late", location: { id: "b", code: "G-17-A", status: "pick_face", pick_sequence: 50 } }),
      task({ id: "early", location: { id: "c", code: "F-01-A", status: "pick_face", pick_sequence: 10 } }),
    ]);
    expect(sorted.map((t) => t.id)).toEqual(["early", "late", "nostock", "closed"]);
  });

  it("keeps what is left on a line after a partial pick", () => {
    expect(remainingQuantity(task({ requested_quantity: 10, confirmed_quantity: 4 }))).toBe(6);
    expect(remainingQuantity(task({ requested_quantity: 10, confirmed_quantity: 12 }))).toBe(0);
  });

  it("posts base units for a quantity entered in the line unit (D9)", () => {
    expect(toBaseUnits(3, { unit_name: "CASE", abbreviation: "CS", conversion_rate: 500 })).toBe(1500);
    expect(toBaseUnits(2.5, null)).toBe(2.5);
  });
});
