import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Schema-drift guard.
 *
 * A production move failed with `42703: column locations.max_pallet_height_cm
 * does not exist` because a PostgREST projection named a column the deployed
 * database did not have. `src/integrations/supabase/types.ts` is generated from
 * the live database, so it is the source of truth for what a select may name.
 *
 * This test resolves the column lists passed to `.select()` on the tables the
 * floor screens depend on and fails when a plain column is missing from the
 * generated Row type — in CI, instead of on a handheld.
 */

const GUARDED_TABLES = [
  "locations",
  "pallets",
  "inventory_balances",
  "products",
  "putaway_tasks",
  "move_tasks",
  "pick_tasks",
] as const;
type GuardedTable = (typeof GUARDED_TABLES)[number];

const TYPES_FILE = "src/integrations/supabase/types.ts";

/** Pull `Row: { ... }` column names for a table out of the generated types. */
function generatedRowColumns(table: string): Set<string> {
  const source = readFileSync(TYPES_FILE, "utf8");
  const tableAnchor = new RegExp(`^      ${table}: \\{$`, "m");
  const anchorMatch = tableAnchor.exec(source);
  if (!anchorMatch) throw new Error(`Table ${table} not found in ${TYPES_FILE}`);
  const rowStart = source.indexOf("Row: {", anchorMatch.index);
  const rowEnd = source.indexOf("\n        }", rowStart);
  if (rowStart === -1 || rowEnd === -1) throw new Error(`Row block for ${table} not found`);
  const block = source.slice(rowStart, rowEnd);
  const columns = new Set<string>();
  for (const match of block.matchAll(/^\s{10}([a-z_][a-z0-9_]*)\??:/gm)) columns.add(match[1]);
  return columns;
}

const ROW_COLUMNS = new Map<GuardedTable, Set<string>>(
  GUARDED_TABLES.map((table) => [table, generatedRowColumns(table)] as const),
);

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
  const pattern = /(?:db|from)\(\s*"(\w+)"\s*\)\s*(?:as any\s*)?\.?\s*\n?\s*\.select\(\s*(?:"([^"]*)"|([A-Z0-9_]+))/g;
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
 * table. Embedded relations (`zones(code)`), wildcards and computed entries are
 * skipped — only base-table columns are asserted. `alias:column` resolves to the
 * column side.
 */
function baseColumns(projection: string): string[] {
  const columns: string[] = [];
  let depth = 0;
  let current = "";
  const push = () => {
    const raw = current.trim();
    current = "";
    if (!raw || raw === "*" || raw.includes("(") || raw.includes("!")) return;
    const resolved = raw.includes(":") ? raw.split(":")[1].trim() : raw;
    if (!resolved || !/^[a-z_][a-z0-9_]*$/.test(resolved)) return;
    columns.push(resolved);
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
      const known = ROW_COLUMNS.get(projection.table)!;
      for (const column of baseColumns(projection.columns)) {
        if (!known.has(column)) offenders.push(`${projection.file}: ${projection.table}.${column}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
