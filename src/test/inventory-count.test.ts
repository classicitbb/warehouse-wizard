import { describe, expect, it, vi } from "vitest";

const from = vi.hoisted(() => vi.fn());

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: vi.fn(), from },
}));

import { countInventory, searchInventory } from "@/lib/wms-core";

// One row per rule `isVisibleRow` applies, so a count that mirrors it wrong
// lands on a specific fixture rather than a vague off-by-N.
const VIEW_ROWS = [
  { inventory_balance_id: "live", pallet_code: "PAL-LIVE", status: "available", quantity: 40, available_quantity: 40 },
  { inventory_balance_id: "reserved", pallet_code: "PAL-RESERVED", status: "reserved", quantity: 10, available_quantity: 0 },
  { inventory_balance_id: "shipped", pallet_code: "PAL-SHIPPED", status: "shipped", quantity: 0, available_quantity: 0 },
  { inventory_balance_id: "picked", pallet_code: "PAL-PICKED", status: "picked", quantity: 5, available_quantity: 5 },
  { inventory_balance_id: "missing", pallet_code: "PAL-MISSING", status: "missing", quantity: 12, available_quantity: 12 },
  { inventory_balance_id: "emptied", pallet_code: "PAL-EMPTIED", status: "available", quantity: 0, available_quantity: 0 },
  { inventory_balance_id: "pending", pallet_code: "PAL-PENDING", status: "available", quantity: 10, available_quantity: 10, correction_state: "pending" },
  { inventory_balance_id: "pallet-pending", pallet_code: "PAL-PPENDING", status: "available", quantity: 10, available_quantity: 10, pallet_correction_state: "pending" },
  { inventory_balance_id: "superseded", pallet_code: "PAL-SUPERSEDED", status: "available", quantity: 8, available_quantity: 8, correction_state: "superseded" },
];

// ── A pocket PostgREST ───────────────────────────────────────────────────────
// Enough of the filter grammar to evaluate what `countInventory` actually sends,
// with SQL's three-valued logic: any comparison against NULL is false, which is
// exactly why every "is not X" filter is paired with an explicit null check.

/** Splits an `or=(…)` body on its top-level commas, ignoring those inside `in.(…)`. */
function splitConditions(clause: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of clause) {
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    if (char === "," && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  if (current) parts.push(current);
  return parts;
}

function matchesCondition(row: Record<string, any>, condition: string): boolean {
  const separator = condition.indexOf(".");
  const column = condition.slice(0, separator);
  const rest = condition.slice(separator + 1);
  const value = row[column] ?? null;
  if (rest === "is.null") return value === null;
  if (rest.startsWith("neq.")) return value !== null && String(value) !== rest.slice(4);
  if (rest.startsWith("not.in.(")) {
    const list = rest.slice("not.in.(".length, -1).split(",");
    return value !== null && !list.includes(String(value));
  }
  if (rest.startsWith("gt.")) return value !== null && Number(value) > Number(rest.slice(3));
  if (rest.startsWith("eq.")) return value !== null && String(value) === rest.slice(3);
  throw new Error(`unsupported filter in test evaluator: ${condition}`);
}

function mockSupabase(rows = VIEW_ROWS) {
  const orClauses: string[] = [];
  from.mockImplementation(() => {
    const builder: any = {
      select: () => builder,
      eq: (column: string, value: string) => {
        orClauses.push(`${column}.eq.${value}`);
        return builder;
      },
      lte: () => builder,
      gte: () => builder,
      ilike: () => builder,
      not: () => builder,
      order: () => builder,
      limit: () => Promise.resolve({ data: [], error: null }),
      or: (clause: string) => {
        orClauses.push(clause);
        return builder;
      },
      // searchInventory's browse path pages until a short page comes back.
      range: (start: number) => Promise.resolve({ data: start === 0 ? rows : [], error: null }),
      // countInventory awaits the builder itself (head: true).
      then: (resolve: (result: { count: number; error: null }) => unknown) => {
        const count = rows.filter((row) =>
          orClauses.every((clause) => splitConditions(clause).some((condition) => matchesCondition(row, condition))),
        ).length;
        return Promise.resolve(resolve({ count, error: null }));
      },
    };
    return builder;
  });
  return orClauses;
}

describe("countInventory", () => {
  it("counts exactly the rows the browse table renders", async () => {
    mockSupabase();
    const rendered = await searchInventory({ status: "all", limit: 50 });
    mockSupabase();
    const total = await countInventory({ status: "all" });

    expect(rendered.map((row: any) => row.pallet_code)).toEqual(["PAL-LIVE", "PAL-RESERVED"]);
    expect(total).toBe(rendered.length);
  });

  it("counts exactly the rows the table renders with history switched on", async () => {
    mockSupabase();
    const rendered = await searchInventory({ status: "all", includeHistoric: true, limit: 50 });
    mockSupabase();
    const total = await countInventory({ status: "all", includeHistoric: true });

    // Everything but the two in-flight corrections.
    expect(rendered).toHaveLength(7);
    expect(total).toBe(rendered.length);
  });

  it("carries the warehouse filter through to the count", async () => {
    const clauses = mockSupabase();
    await countInventory({ status: "all", warehouseId: "wh-1" });

    expect(clauses).toContain("warehouse_id.eq.wh-1");
  });

  it("reports nothing for a retired status the browse view cannot show", async () => {
    mockSupabase();
    expect(await countInventory({ status: "shipped" })).toBe(0);
  });
});
