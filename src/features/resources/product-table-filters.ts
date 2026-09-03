/**
 * Sorting + per-column filtering for the Products resource table.
 *
 * Kept as pure functions so the behaviour can be tested without rendering the
 * page, and so the table component stays a thin presentation layer.
 */

export const PRODUCT_QTY_COLUMN = "__qty";

export type ProductColumnKind = "text" | "number" | "select" | "boolean";

export type ColumnFilter =
  | { kind: "text"; value: string }
  | { kind: "number"; min?: number | null; max?: number | null }
  | { kind: "select"; values: string[] }
  | { kind: "boolean"; value: boolean };

export type ColumnFilterMap = Record<string, ColumnFilter>;

export type SortState = { key: string; direction: "asc" | "desc" } | null;

export type ProductRow = Record<string, unknown>;

/** Cycles a header click: asc → desc → cleared. */
export function nextSortState(current: SortState, key: string): SortState {
  if (!current || current.key !== key) return { key, direction: "asc" };
  if (current.direction === "asc") return { key, direction: "desc" };
  return null;
}

export function columnValue(
  row: ProductRow,
  key: string,
  qtyMap: Map<string, number>,
): unknown {
  if (key === PRODUCT_QTY_COLUMN) return qtyMap.get(String(row.id ?? "")) ?? 0;
  return row[key];
}

function compareValues(a: unknown, b: unknown): number {
  const aMissing = a == null || a === "";
  const bMissing = b == null || b === "";
  if (aMissing && bMissing) return 0;
  // Blanks always sort last, whichever direction is active.
  if (aMissing) return 1;
  if (bMissing) return -1;
  if (typeof a === "boolean" || typeof b === "boolean") {
    return Number(Boolean(b)) - Number(Boolean(a));
  }
  const aNum = typeof a === "number" ? a : Number(a);
  const bNum = typeof b === "number" ? b : Number(b);
  if (Number.isFinite(aNum) && Number.isFinite(bNum)) return aNum - bNum;
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
}

export function sortProductRows<T extends ProductRow>(
  rows: T[],
  sort: SortState,
  qtyMap: Map<string, number>,
): T[] {
  if (!sort) return rows;
  const sorted = [...rows].sort((a, b) => {
    const result = compareValues(columnValue(a, sort.key, qtyMap), columnValue(b, sort.key, qtyMap));
    // Blank handling above already forces blanks last; keep it that way when
    // the direction flips.
    return result;
  });
  if (sort.direction === "desc") {
    const present = sorted.filter((row) => {
      const value = columnValue(row, sort.key, qtyMap);
      return !(value == null || value === "");
    });
    const blanks = sorted.filter((row) => {
      const value = columnValue(row, sort.key, qtyMap);
      return value == null || value === "";
    });
    return [...present.reverse(), ...blanks];
  }
  return sorted;
}

export function matchesColumnFilter(value: unknown, filter: ColumnFilter): boolean {
  switch (filter.kind) {
    case "text": {
      const needle = filter.value.trim().toLowerCase();
      if (!needle) return true;
      return String(value ?? "").toLowerCase().includes(needle);
    }
    case "number": {
      const num = value == null || value === "" ? null : Number(value);
      if (filter.min != null && (num == null || num < filter.min)) return false;
      if (filter.max != null && (num == null || num > filter.max)) return false;
      return true;
    }
    case "select": {
      if (filter.values.length === 0) return true;
      return filter.values.includes(String(value ?? ""));
    }
    case "boolean":
      return Boolean(value) === filter.value;
    default:
      return true;
  }
}

export function filterProductRows<T extends ProductRow>(
  rows: T[],
  filters: ColumnFilterMap,
  qtyMap: Map<string, number>,
): T[] {
  const entries = Object.entries(filters);
  if (entries.length === 0) return rows;
  return rows.filter((row) =>
    entries.every(([key, filter]) => matchesColumnFilter(columnValue(row, key, qtyMap), filter)),
  );
}

export function isFilterEmpty(filter: ColumnFilter | undefined): boolean {
  if (!filter) return true;
  if (filter.kind === "text") return filter.value.trim() === "";
  if (filter.kind === "number") return filter.min == null && filter.max == null;
  if (filter.kind === "select") return filter.values.length === 0;
  return false;
}

export function describeFilter(label: string, filter: ColumnFilter): string {
  switch (filter.kind) {
    case "text":
      return `${label}: "${filter.value.trim()}"`;
    case "number": {
      if (filter.min != null && filter.max != null) return `${label}: ${filter.min}–${filter.max}`;
      if (filter.min != null) return `${label} ≥ ${filter.min}`;
      return `${label} ≤ ${filter.max}`;
    }
    case "select":
      return `${label}: ${filter.values.join(", ")}`;
    case "boolean":
      return `${label}: ${filter.value ? "Yes" : "No"}`;
    default:
      return label;
  }
}

export type QuickLink = {
  id: string;
  label: string;
  /** Filter columns this preset sets, plus an optional sort it applies. */
  filters: ColumnFilterMap;
  sort?: SortState;
};

export const PRODUCT_QUICK_LINKS: QuickLink[] = [
  {
    id: "expiry",
    label: "Expiry tracked",
    filters: { expiry_tracked: { kind: "boolean", value: true } },
    sort: { key: "sku", direction: "asc" },
  },
  { id: "lot", label: "Lot tracked", filters: { lot_tracked: { kind: "boolean", value: true } } },
  { id: "batch", label: "Batch tracked", filters: { batch_tracked: { kind: "boolean", value: true } } },
  {
    id: "out-of-stock",
    label: "Out of stock",
    filters: { [PRODUCT_QTY_COLUMN]: { kind: "number", max: 0 } },
  },
  {
    id: "cold-chain",
    label: "Cold chain",
    filters: { temperature_requirement: { kind: "select", values: ["chilled", "frozen"] } },
  },
];

/** "Below minimum stock" compares two columns, so it can't be expressed as a
 *  plain column filter — it is applied as a row predicate instead. */
export function isBelowMinimumStock(row: ProductRow, qtyMap: Map<string, number>): boolean {
  const minimum = row.minimum_stock_level;
  if (minimum == null || minimum === "") return false;
  const qty = qtyMap.get(String(row.id ?? "")) ?? 0;
  return qty < Number(minimum);
}
