import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

// Runs the real label-print function, the real `#variable_conflict` patch that
// broke its pallet -> receipt line link, and the fix migration, in isolated
// Postgres WASM. No network, credentials or remote writes.
const read = (file: string) => readFileSync(`supabase/migrations/${file}`, "utf8");
const baseline = read("20260511000000_consolidated_wms_schema.sql");
const labelsSource = read("20260902141515_a70c708f-ed8e-441b-9f7a-0d9387da4d18.sql");
const conflictPatch = read("20260902143104_55a4eb55-9e7e-4b6f-838b-c1a8201686d6.sql");
const putawaySync = read("20260720040000_netsuite_putaway_inventory_sync.sql");
const internalIds = read("20260916120000_netsuite_inventory_sync_internal_ids.sql");
const migration = read("20261021200000_netsuite_receipt_sourced_putaway.sql");

const tables = ["warehouses", "clients", "zones", "locations", "products", "product_packaging_profiles", "inventory_lots",
  "receipts", "receipt_lines", "pallets", "inventory_balances", "putaway_tasks", "barcode_labels", "audit_events"];
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const wh = id(1), product = id(3), connection = id(50);
let pg: PGlite;

/** A Receiving draft as saveShipmentDrafts writes it; `netsuite` marks a line loaded from a NetSuite document. */
async function draft(n: number, netsuite: boolean) {
  const notes = {
    _draft: true, product_id: product, quantity: 10, draft_pallet_barcode: `PLT-${n}`,
    ...(netsuite ? { netsuite: { lineKey: "1", lineNumber: 1, itemName: "Test", ordered: 10, received: 0, remaining: 10, poId: "76", poNumber: "PO76" } } : {}),
  };
  await pg.query(`insert into receipts(id, receipt_number, receipt_type, warehouse_id, status, draft_pallet_barcode, notes)
    values ($1, $2, 'po', $3, 'draft', $4, $5)`, [id(n), `RCT-${n}`, wh, `PLT-${n}`, JSON.stringify(notes)]);
  return id(n);
}

/** Labels printed: completes the receipt and creates the pallet and its inventory record. */
async function printLabels(draftId: string) {
  const { rows } = await pg.query<{ pallet_id: string }>("select pallet_id from public.confirm_receiving_draft_labels_printed($1)", [draftId]);
  return rows[0].pallet_id;
}

/** Putaway confirmed: sets the location and makes the stock available, which fires the NetSuite trigger. */
async function putAway(palletId: string) {
  await pg.query(`update inventory_balances set location_id = $2, status = 'available', available_quantity = quantity
    where pallet_id = $1`, [palletId, id(4)]);
}

const adjustments = async () => (await pg.query("select payload->>'quantityDelta' as qty from integration_sync_jobs")).rows;
const setReceiptsPost = (on: boolean) =>
  pg.query("update integration_connections set config = config || jsonb_build_object('receipts_post_to_netsuite', $1::boolean)", [on]);

beforeAll(async () => {
  pg = new PGlite();
  await pg.exec(baseline.slice(baseline.indexOf("do $$"), baseline.indexOf("-- UTILITY FUNCTIONS")));
  for (const table of tables) {
    const ddl = baseline.match(new RegExp(`create table if not exists public\\.${table} \\([\\s\\S]*?\\n\\);`))?.[0];
    if (!ddl) throw new Error(`Missing baseline ${table}`);
    await pg.exec(ddl.replace(/references\s+[\w.]+\s*\([^)]*\)(?:\s+on delete (?:cascade|restrict|set null))?/gi, ""));
  }
  await pg.exec(`alter table receipts add column draft_pallet_barcode text;
    create table integration_connections(id uuid primary key, system text, enabled boolean, config jsonb not null default '{}');
    create table external_record_links(system text, local_table text, local_id uuid, external_record_type text, external_id text);
    create table integration_sync_jobs(id uuid default gen_random_uuid(), connection_id uuid, job_type text,
      idempotency_key text, payload jsonb, unique (connection_id, idempotency_key));
    create role anon; create role authenticated; create role service_role;
    create schema auth;
    create function auth.uid() returns uuid language sql as $$ select '${id(900)}'::uuid $$;
    create function public.has_min_role(uuid, text) returns boolean language sql as $$ select true $$;
    create function public.can_access_warehouse(uuid) returns boolean language sql as $$ select true $$;
    create function public.directed_putaway_candidates(uuid) returns table(location_id uuid) language sql as $$ select null::uuid where false $$;
    create function public.inventory_correction_code(text) returns text language sql as $$ select $1 || '-' || gen_random_uuid()::text $$;`);
  // The label-print function as the repository defines it, then the bulk patch
  // that added `#variable_conflict use_column` (limited to this one function).
  await pg.exec(labelsSource.slice(0, labelsSource.indexOf("\n$$;\n") + 4));
  await pg.exec(conflictPatch.replace(/ARRAY\[\s*'public\.confirm_receiving_draft_labels_printed\(uuid\)'[\s\S]*?\]/, "ARRAY['public.confirm_receiving_draft_labels_printed(uuid)']"));
  // The putaway trigger as deployed before this fix.
  const enqueueStart = internalIds.indexOf("create or replace function public.enqueue_netsuite_inventory_sync");
  await pg.exec(internalIds.slice(enqueueStart, internalIds.indexOf("\n$$;\n", enqueueStart) + 4));
  await pg.exec(putawaySync.slice(putawaySync.indexOf("create trigger trg_enqueue_netsuite_inventory_sync"),
    putawaySync.indexOf(";", putawaySync.indexOf("create trigger trg_enqueue_netsuite_inventory_sync")) + 1));
}, 30000);

beforeEach(async () => {
  await pg.exec(`truncate ${[...tables, "integration_connections", "external_record_links", "integration_sync_jobs"].join(",")};
    insert into warehouses(id, code, name) values ('${wh}', 'TEST', 'Test warehouse');
    insert into zones(id, warehouse_id, code, name) values ('${id(5)}', '${wh}', 'A', 'Test zone');
    insert into locations(id, warehouse_id, zone_id, code, status) values ('${id(4)}', '${wh}', '${id(5)}', 'A-01-A', 'active');
    insert into products(id, sku, name) values ('${product}', 'TEST', 'Test product');
    insert into integration_connections(id, system, enabled) values ('${connection}', 'netsuite', true);
    insert into external_record_links values
      ('netsuite', 'products', '${product}', 'item', '2963'),
      ('netsuite', 'warehouses', '${wh}', 'location', '3');`);
});
afterAll(async () => { await pg?.close(); });

describe("before the fix migration", () => {
  it("label print leaves the pallet unlinked from its receipt line", async () => {
    const pallet = await printLabels(await draft(10, true));
    expect((await pg.query("select receipt_line_id from pallets where id = $1", [pallet])).rows).toEqual([{ receipt_line_id: null }]);
  });
});

describe("netsuite receipt-sourced putaway migration", () => {
  beforeAll(async () => {
    await pg.exec(migration);
  });

  /** A pallet labelled while the link was broken: clear its link, then re-run the (idempotent) migration. */
  async function labelledBeforeFix(n: number) {
    const pallet = await printLabels(await draft(n, true));
    await pg.query("update pallets set receipt_line_id = null where id = $1", [pallet]);
    await pg.exec(migration);
    return pallet;
  }

  it("backfills a missing link from the label confirmation audit event", async () => {
    const pallet = await labelledBeforeFix(20);
    const { rows } = await pg.query<{ receipt_id: string }>(`select rl.receipt_id from pallets p
      join receipt_lines rl on rl.id = p.receipt_line_id where p.id = $1`, [pallet]);
    expect(rows).toEqual([{ receipt_id: id(20) }]);
  });

  it("label print now links the pallet to its receipt line", async () => {
    const pallet = await printLabels(await draft(30, false));
    const { rows } = await pg.query<{ receipt_id: string }>(`select rl.receipt_id from pallets p
      join receipt_lines rl on rl.id = p.receipt_line_id where p.id = $1`, [pallet]);
    expect(rows).toEqual([{ receipt_id: id(30) }]);
  });

  it("with receipt posting off, every putaway still posts its adjustment", async () => {
    await putAway(await printLabels(await draft(40, true)));
    await putAway(await printLabels(await draft(41, false)));
    expect(await adjustments()).toEqual([{ qty: "10.00" }, { qty: "10.00" }]);
  });

  it("with receipt posting on, NetSuite-sourced receipts skip the putaway adjustment; manual receipts keep it", async () => {
    await setReceiptsPost(true);
    await putAway(await printLabels(await draft(50, true)));
    expect(await adjustments()).toEqual([]);
    await putAway(await printLabels(await draft(51, false)));
    expect(await adjustments()).toEqual([{ qty: "10.00" }]);
  });

  it("a pallet labelled before the fix is recognised through its backfilled link", async () => {
    const pallet = await labelledBeforeFix(55);
    await setReceiptsPost(true);
    await putAway(pallet);
    expect(await adjustments()).toEqual([]);
  });

  it("free-text receipt notes never block a putaway", async () => {
    await setReceiptsPost(true);
    const pallet = await printLabels(await draft(60, false));
    await pg.query("update receipts set notes = 'not json {' where id = $1", [id(60)]);
    await putAway(pallet);
    expect(await adjustments()).toEqual([{ qty: "10.00" }]);
  });
});
