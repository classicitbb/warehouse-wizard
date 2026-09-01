import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Database } from "@/integrations/supabase/types";

/**
 * Schema-drift guard.
 *
 * A production move failed with `42703: column locations.max_pallet_height_cm
 * does not exist` because a PostgREST projection named a column the deployed
 * database did not have. `src/integrations/supabase/types.ts` is generated from
 * the live database, so it is the source of truth for what a select may name.
 *
 * This test walks the source, resolves the column lists passed to `.select()`
 * on the tables the floor screens depend on, and fails when a plain column is
 * not present on the generated Row type — in CI, instead of on a handheld.
 */

const GUARDED_TABLES = ["locations", "pallets", "inventory_balances", "products", "putaway_tasks", "move_tasks"] as const;
type GuardedTable = (typeof GUARDED_TABLES)[number];

// Sample rows only exist at runtime, so build the key set from a typed helper:
// the generated Row type is checked structurally below via a key map.
const ROW_KEYS: Record<GuardedTable, Set<string>> = {
  locations: keysOf<Database["public"]["Tables"]["locations"]["Row"]>(LOCATION_KEYS()),
  pallets: keysOf<Database["public"]["Tables"]["pallets"]["Row"]>(PALLET_KEYS()),
  inventory_balances: keysOf<Database["public"]["Tables"]["inventory_balances"]["Row"]>(INVENTORY_KEYS()),
  products: keysOf<Database["public"]["Tables"]["products"]["Row"]>(PRODUCT_KEYS()),
  putaway_tasks: keysOf<Database["public"]["Tables"]["putaway_tasks"]["Row"]>(PUTAWAY_KEYS()),
  move_tasks: keysOf<Database["public"]["Tables"]["move_tasks"]["Row"]>(MOVE_TASK_KEYS()),
};

function keysOf<Row>(keys: (keyof Row & string)[]): Set<string> {
  return new Set(keys);
}

// Each list below is type-checked against the generated Row type: a column that
// is dropped from the database stops compiling here, and a column that never
// existed can never be added.
function LOCATION_KEYS() {
  const keys: (keyof Database["public"]["Tables"]["locations"]["Row"] & string)[] = [
    "id", "code", "status", "max_pallets", "temperature_class", "mixed_sku_allowed", "mixed_lot_allowed",
    "max_height", "max_height_mm", "max_pallet_height_cm", "zone_id", "warehouse_id", "aisle", "bay", "level",
    "position", "depth", "location_type", "pick_sequence", "putaway_sequence", "notes", "is_staging",
    "level_style", "created_at", "updated_at",
  ];
  return keys;
}
function PALLET_KEYS() {
  const keys: (keyof Database["public"]["Tables"]["pallets"]["Row"] & string)[] = [
    "id", "pallet_barcode", "pallet_code", "status", "is_stored", "current_location_id", "current_warehouse_id",
    "product_id", "client_id", "quantity", "available_quantity", "inventory_lot_id", "height", "standard_height_mm",
    "length", "width", "weight", "created_at", "updated_at",
  ];
  return keys;
}
function INVENTORY_KEYS() {
  const keys: (keyof Database["public"]["Tables"]["inventory_balances"]["Row"] & string)[] = [
    "id", "pallet_id", "product_id", "client_id", "location_id", "zone_id", "warehouse_id", "status",
    "quantity", "available_quantity", "created_at", "updated_at",
  ];
  return keys;
}
function PRODUCT_KEYS() {
  const keys: (keyof Database["public"]["Tables"]["products"]["Row"] & string)[] = [
    "id", "sku", "name", "temperature_requirement", "client_id", "created_at", "updated_at",
  ];
  return keys;
}
function PUTAWAY_KEYS() {
  const keys: (keyof Database["public"]["Tables"]["putaway_tasks"]["Row"] & string)[] = [
    "id", "task_number", "status", "pallet_id", "warehouse_id", "created_at", "updated_at",
  ];
  return keys;
}
function MOVE_TASK_KEYS() {
  const keys: (keyof Database["public"]["Tables"]["move_tasks"]["Row"] & string)[] = [
    "id", "task_number", "status", "pallet_id", "warehouse_id", "from_location_id", "to_location_id",
    "reason", "completed_at", "created_at", "updated_at",
  ];
  return keys;
}

const SOURCE_ROOTS = ["src/features", "src/hooks", "src/lib", "src/components"];

function collectFiles(dir: string, out: string[] = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) collectFiles(full, out);
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

/** `const NAME = "a, b, c";` string constants, so named projections resolve. */
function stringConstants(source: string) {
  const constants = new Map<string, string>();
  const pattern = /const\s+([A-Z0-9_]+)\s*(?::\s*string)?\s*=\s*\n?\s*"([^"]*)"/g;
  for (const match of source.matchAll(pattern)) constants.set(match[1], match[2]);
  return constants;
}

type Projection = { file: string; table: GuardedTable; columns: string };

function findProjections(file: string): Projection[] {
  const source = readFileSync(file, "utf8");
  const constants = stringConstants(source);
  const found: Projection[] = [];
  const pattern = /(?:db|supabase\s*\.\s*from|\.from)\(\s*"(\w+)"\s*\)\s*(?:as any\s*)?\.\s*select\(\s*(?:"([^"]*)"|([A-Z0-9_]+))/g;
  for (const match of source.matchAll(pattern)) {
    const table = match[1] as GuardedTable;
    if (!GUARDED_TABLES.includes(table)) continue;
    const columns = match[2] ?? (match[3] ? constants.get(match[3]) : undefined);
    if (columns == null) continue;
    found.push({ file, table, columns });
  }
  return found;
}

/**
 * Split a PostgREST projection into the plain column names it reads on the base
 * table. Embedded relations (`zones(code)`), aliases (`warehouse_id:x`),
 * wildcards and aggregates are skipped — only base-table columns are asserted.
 */
function baseColumns(projection: string): string[] {
  const columns: string[] = [];
  let depth = 0;
  let current = "";
  const push = () => {
    const raw = current.trim();
    current = "";
    if (!raw || raw === "*" || raw.includes("(") || raw.includes("!")) return;
    const aliased = raw.includes(":") ? raw.split(":")[1].trim() : raw;
    if (!aliased || !/^[a-z_][a-z0-9_]*$/.test(aliased)) return;
    columns.push(aliased);
  };
  for (const char of projection) {
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    if (char === "," && depth === 0) {
      push();
      continue;
    }
    current += char;
  }
  push();
  return columns;
}

describe("PostgREST projections match the generated database schema", () => {
  const files = SOURCE_ROOTS.flatMap((root) => collectFiles(root));
  const projections = files.flatMap((file) => findProjections(file));

  it("finds projections to check", () => {
    expect(projections.length).toBeGreaterThan(5);
  });

  it("never selects a column that does not exist on the table", () => {
    const offenders: string[] = [];
    for (const projection of projections) {
      for (const column of baseColumns(projection.columns)) {
        if (!ROW_KEYS[projection.table].has(column)) {
          offenders.push(`${projection.file}: ${projection.table}.${column}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
