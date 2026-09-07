import { describe, expect, it } from "vitest";
import {
  PRODUCT_QTY_COLUMN,
  PRODUCT_QUICK_LINKS,
  filterProductRows,
  isBelowMinimumStock,
  isFilterEmpty,
  nextSortState,
  sortProductRows,
} from "@/features/resources/product-table-filters";

const rows = [
  { id: "a", sku: "AAA", name: "Alpha", expiry_tracked: true, velocity_class: "A", minimum_stock_level: 10, temperature_requirement: "chilled" },
  { id: "b", sku: "BBB", name: "Bravo", expiry_tracked: false, velocity_class: "C", minimum_stock_level: null, temperature_requirement: "ambient" },
  { id: "c", sku: "CCC", name: "Charlie", expiry_tracked: true, velocity_class: "B", minimum_stock_level: 5, temperature_requirement: "frozen" },
];
const qty = new Map([["a", 4], ["b", 120], ["c", 0]]);

describe("product table sorting", () => {
  it("cycles asc → desc → cleared", () => {
    const first = nextSortState(null, "sku");
    expect(first).toEqual({ key: "sku", direction: "asc" });
    expect(nextSortState(first, "sku")).toEqual({ key: "sku", direction: "desc" });
    expect(nextSortState({ key: "sku", direction: "desc" }, "sku")).toBeNull();
    expect(nextSortState({ key: "sku", direction: "desc" }, "name")).toEqual({ key: "name", direction: "asc" });
  });

  it("sorts by the synthetic quantity column", () => {
    const asc = sortProductRows(rows, { key: PRODUCT_QTY_COLUMN, direction: "asc" }, qty);
    expect(asc.map((r) => r.id)).toEqual(["c", "a", "b"]);
    const desc = sortProductRows(rows, { key: PRODUCT_QTY_COLUMN, direction: "desc" }, qty);
    expect(desc.map((r) => r.id)).toEqual(["b", "a", "c"]);
  });

  it("keeps blanks last in both directions", () => {
    const asc = sortProductRows(rows, { key: "minimum_stock_level", direction: "asc" }, qty);
    expect(asc.map((r) => r.id)).toEqual(["c", "a", "b"]);
    const desc = sortProductRows(rows, { key: "minimum_stock_level", direction: "desc" }, qty);
    expect(desc[desc.length - 1].id).toBe("b");
  });
});

describe("product column filters", () => {
  it("filters text columns by contains", () => {
    const result = filterProductRows(rows, { name: { kind: "text", value: "ra" } }, qty);
    expect(result.map((r) => r.id)).toEqual(["b"]);
  });

  it("filters numeric ranges including the quantity column", () => {
    expect(filterProductRows(rows, { [PRODUCT_QTY_COLUMN]: { kind: "number", min: 1 } }, qty).map((r) => r.id)).toEqual(["a", "b"]);
    expect(filterProductRows(rows, { [PRODUCT_QTY_COLUMN]: { kind: "number", max: 0 } }, qty).map((r) => r.id)).toEqual(["c"]);
  });

  it("filters select and boolean columns", () => {
    expect(filterProductRows(rows, { velocity_class: { kind: "select", values: ["A", "B"] } }, qty).map((r) => r.id)).toEqual(["a", "c"]);
    expect(filterProductRows(rows, { expiry_tracked: { kind: "boolean", value: false } }, qty).map((r) => r.id)).toEqual(["b"]);
  });

  it("combines filters with AND", () => {
    const result = filterProductRows(
      rows,
      { expiry_tracked: { kind: "boolean", value: true }, [PRODUCT_QTY_COLUMN]: { kind: "number", min: 1 } },
      qty,
    );
    expect(result.map((r) => r.id)).toEqual(["a"]);
  });

  it("treats empty filters as no-ops", () => {
    expect(isFilterEmpty({ kind: "text", value: "  " })).toBe(true);
    expect(isFilterEmpty({ kind: "select", values: [] })).toBe(true);
    expect(isFilterEmpty({ kind: "number", min: null, max: null })).toBe(true);
    expect(isFilterEmpty({ kind: "boolean", value: false })).toBe(false);
  });
});

describe("quick links", () => {
  it("expiry tracked preset selects only expiry-tracked products", () => {
    const link = PRODUCT_QUICK_LINKS.find((item) => item.id === "expiry")!;
    expect(filterProductRows(rows, link.filters, qty).map((r) => r.id)).toEqual(["a", "c"]);
  });

  it("cold chain preset covers chilled and frozen", () => {
    const link = PRODUCT_QUICK_LINKS.find((item) => item.id === "cold-chain")!;
    expect(filterProductRows(rows, link.filters, qty).map((r) => r.id)).toEqual(["a", "c"]);
  });

  it("below minimum stock compares quantity against the product floor", () => {
    expect(rows.filter((row) => isBelowMinimumStock(row, qty)).map((r) => r.id)).toEqual(["a", "c"]);
  });
});
