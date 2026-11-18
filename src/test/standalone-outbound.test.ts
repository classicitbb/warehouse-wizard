import { describe, expect, it } from "vitest";
import { NAVIGATION } from "@/features/shared/core-types";
import { departMessage } from "@/features/trips/trip-dispatch-core";
import { fulfillmentStatusLabel } from "@/features/orders/orders-inbox-core";
import { normalizeOrderLines, openToPlan, orderInputProblem } from "@/features/orders/ww-orders-core";
import { cleanAddress } from "@/features/customers/ww-customers-core";

describe("standalone outbound navigation", () => {
  it("lists Orders, Trips and Customers without NetSuite", () => {
    for (const label of ["Orders", "Trips", "Customers"]) {
      const item = NAVIGATION.find((n) => n.label === label);
      expect(item, label).toBeDefined();
      expect(item?.netsuite, label).toBeFalsy();
    }
  });
});

describe("WW order entry", () => {
  it("keeps lines with a product and a quantity, adding repeats together", () => {
    expect(normalizeOrderLines([
      { product_id: "a", quantity: "5" },
      { product_id: "", quantity: 3 },
      { product_id: "b", quantity: 0 },
      { product_id: "a", quantity: 2 },
      { product_id: "c", quantity: "x" },
    ])).toEqual([{ product_id: "a", quantity: 7 }]);
  });

  it("says what is missing before save", () => {
    expect(orderInputProblem({ warehouse_id: "", customer_id: "c", lines: [{ product_id: "a", quantity: 1 }] })).toMatch(/warehouse/);
    expect(orderInputProblem({ warehouse_id: "w", customer_id: "", lines: [{ product_id: "a", quantity: 1 }] })).toMatch(/customer/);
    expect(orderInputProblem({ warehouse_id: "w", customer_id: "c", lines: [] })).toMatch(/line/);
    expect(orderInputProblem({ warehouse_id: "w", customer_id: "c", lines: [{ product_id: "a", quantity: 1 }] })).toBeNull();
  });

  it("counts only what is not shipped or on an open trip", () => {
    const lines = [
      { id: "l1", quantity: 10, fulfilled_quantity: 2, is_closed: false },
      { id: "l2", quantity: 5, fulfilled_quantity: 0, is_closed: false },
      { id: "l3", quantity: 9, fulfilled_quantity: 0, is_closed: true },
    ];
    const fulfillments = [
      { external_status: "A", order_fulfillment_lines: [{ order_line_id: "l1", quantity: 3 }] },
      { external_status: "C", order_fulfillment_lines: [{ order_line_id: "l2", quantity: 5 }] },
    ];
    expect(openToPlan(lines, fulfillments)).toBe(5 + 5);
  });

  it("labels a planned WW fulfillment as on trip", () => {
    expect(fulfillmentStatusLabel("A", "ww")).toBe("On trip");
    expect(fulfillmentStatusLabel("A")).toBe("Picked");
    expect(fulfillmentStatusLabel("C", "ww")).toBe("Shipped");
  });
});

describe("depart message", () => {
  const base = { departed: 2, queued: 0, posting_enabled: false, ship_short: false };

  it("a WW-only trip ships without mentioning NetSuite", () => {
    const m = departMessage({ ...base, shipped_in_ww: 2, netsuite_count: 0 });
    expect(m.tone).toBe("success");
    expect(m.text).toBe("Trip departed. 2 order(s) shipped.");
  });

  it("a NetSuite trip with posting on reports the queued posts", () => {
    const m = departMessage({ ...base, queued: 2, posting_enabled: true, shipped_in_ww: 0, netsuite_count: 2 });
    expect(m).toEqual({ tone: "success", text: "Trip departed. 2 fulfillment(s) queued to NetSuite as Shipped." });
  });

  it("asks the office to finish NetSuite fulfillments when posting is off", () => {
    const m = departMessage({ ...base, ship_short: true, shipped_in_ww: 1, netsuite_count: 1 });
    expect(m.tone).toBe("attention");
    expect(m.text).toContain("1 order(s) shipped.");
    expect(m.text).toContain("must set 1 fulfillment(s) to Shipped");
    expect(m.text).toContain("ship short");
  });

  it("reads an older database result as all NetSuite", () => {
    expect(departMessage({ ...base, queued: 2, posting_enabled: true }).text).toContain("2 fulfillment(s) queued");
  });
});

describe("WW customer address", () => {
  it("drops blank parts and sends an empty address as null", () => {
    expect(cleanAddress({ addr1: " 1 Main St ", city: "", zip: "  " })).toEqual({ addr1: "1 Main St" });
    expect(cleanAddress({ addr1: "", city: null })).toBeNull();
  });
});
