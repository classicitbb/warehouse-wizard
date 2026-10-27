import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

// Runs the real Put-Away return, label-confirm and draft-cancel functions in
// isolated Postgres WASM. No network, credentials or remote writes.
const read = (file: string) => readFileSync(`supabase/migrations/${file}`, "utf8");
const baseline = read("20260511000000_consolidated_wms_schema.sql");
const lifecycle = read("20260901155226_receiving_putaway_lifecycle_integrity.sql");
const labelsSource = read("20260902141515_a70c708f-ed8e-441b-9f7a-0d9387da4d18.sql");
const migration = read("20261027140000_putaway_return_new_pallet_number.sql");

const tables = ["warehouses", "clients", "zones", "locations", "products", "product_packaging_profiles", "inventory_lots",
  "receipts", "receipt_lines", "pallets", "inventory_balances", "putaway_tasks", "barcode_labels", "audit_events"];
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const wh = id(1), product = id(3), location = id(4), oldLot = id(20), oldPallet = id(30), task = id(40);
let pg: PGlite;

const functionSource = (source: string, name: string) => {
  const start = source.indexOf(`create or replace function public.${name}`);
  return source.slice(start, source.indexOf("\n$$;", start) + 4);
};

/** A stored AYIDY-style pallet with an open Put-Away task, on a lot expiring 2026-11-26. */
async function seedPalletInPutaway() {
  await pg.query(`insert into inventory_lots(id, product_id, expiry_date) values ($1, $2, '2026-11-26')`, [oldLot, product]);
  await pg.query(`insert into pallets(id, pallet_code, pallet_barcode, product_id, current_warehouse_id, inventory_lot_id,
    quantity, available_quantity, status, is_stored, current_location_id)
    values ($1, 'PLT-OLD', 'PLT-OLD', $2, $3, $4, 90, 0, 'putaway', false, null)`, [oldPallet, product, wh, oldLot]);
  await pg.query(`insert into inventory_balances(pallet_id, product_id, warehouse_id, inventory_lot_id, status, quantity, available_quantity, expiry_date)
    values ($1, $2, $3, $4, 'putaway', 90, 0, '2026-11-26')`, [oldPallet, product, wh, oldLot]);
  await pg.query(`insert into putaway_tasks(id, task_number, pallet_id, warehouse_id, status) values ($1, 'PTA-1', $2, $3, 'queued')`, [task, oldPallet, wh]);
}

const returnToReceiving = async () => (await pg.query<{ draft_id: string; draft_pallet_barcode: string }>(
  "select * from public.return_putaway_to_receiving_draft($1)", [task])).rows[0];
const receive = async (draftId: string) => (await pg.query<{ pallet_id: string; pallet_barcode: string }>(
  "select * from public.confirm_receiving_draft_labels_printed($1)", [draftId])).rows[0];
const editDraftExpiry = (draftId: string, expiry: string) =>
  pg.query(`update receipts set notes = (notes::jsonb || jsonb_build_object('expiry_date', $2::text))::text where id = $1`, [draftId, expiry]);

beforeAll(async () => {
  pg = new PGlite();
  await pg.exec(baseline.slice(baseline.indexOf("do $$"), baseline.indexOf("-- UTILITY FUNCTIONS")));
  await pg.exec("alter type public.inventory_status add value if not exists 'putaway';");
  for (const table of tables) {
    const ddl = baseline.match(new RegExp(`create table if not exists public\\.${table} \\([\\s\\S]*?\\n\\);`))?.[0];
    if (!ddl) throw new Error(`Missing baseline ${table}`);
    await pg.exec(ddl.replace(/references\s+[\w.]+\s*\([^)]*\)(?:\s+on delete (?:cascade|restrict|set null))?/gi, ""));
  }
  await pg.exec(`alter table receipts add column draft_pallet_barcode text;
    alter table pallets add column if not exists correction_state text;
    alter table inventory_balances add column if not exists correction_state text;
    create role anon; create role authenticated; create role service_role;
    create schema auth;
    create function auth.uid() returns uuid language sql as $$ select '${id(900)}'::uuid $$;
    create function public.has_min_role(uuid, text) returns boolean language sql as $$ select true $$;
    create function public.can_access_warehouse(uuid) returns boolean language sql as $$ select true $$;
    create function public.directed_putaway_candidates(uuid) returns table(location_id uuid) language sql as $$ select null::uuid where false $$;
    create function public.inventory_correction_code(text) returns text language sql as $$ select $1 || '-' || gen_random_uuid()::text $$;`);
  // The functions as they stood before this change, so the migration is proven to replace them.
  await pg.exec(functionSource(labelsSource, "confirm_receiving_draft_labels_printed"));
  await pg.exec(functionSource(labelsSource, "cancel_receiving_draft"));
  await pg.exec(functionSource(lifecycle, "return_putaway_to_receiving_draft"));
  await pg.exec(migration);
}, 30000);

beforeEach(async () => {
  await pg.exec(`truncate ${tables.join(",")};
    insert into warehouses(id, code, name) values ('${wh}', 'TEST', 'Test warehouse');
    insert into zones(id, warehouse_id, code, name) values ('${id(5)}', '${wh}', 'A', 'Test zone');
    insert into locations(id, warehouse_id, zone_id, code, status) values ('${location}', '${wh}', '${id(5)}', 'A-01-A', 'active');
    insert into products(id, sku, name) values ('${product}', 'AYIDY50021', 'Dry yeast');`);
});
afterAll(async () => { await pg?.close(); });

describe("Put-Away return to Receiving", () => {
  it("issues a new pallet number, holds the old pallet and records the link in the draft", async () => {
    await seedPalletInPutaway();
    const draft = await returnToReceiving();

    expect(draft.draft_pallet_barcode).toMatch(/^PLT-/);
    expect(draft.draft_pallet_barcode).not.toBe("PLT-OLD");
    const meta = JSON.parse((await pg.query<{ notes: string }>("select notes from receipts where id = $1", [draft.draft_id])).rows[0].notes);
    expect(meta).toMatchObject({ superseded_pallet_id: oldPallet, superseded_pallet_barcode: "PLT-OLD", draft_pallet_barcode: draft.draft_pallet_barcode });
    expect(meta.returned_pallet_id).toBeUndefined();
    expect((await pg.query("select status from putaway_tasks where id = $1", [task])).rows).toEqual([{ status: "cancelled" }]);
    expect((await pg.query("select correction_state from pallets where id = $1", [oldPallet])).rows).toEqual([{ correction_state: "pending" }]);
  });

  it("receiving the draft creates a new pallet under the new number and retires the old one", async () => {
    await seedPalletInPutaway();
    const draft = await returnToReceiving();
    const received = await receive(draft.draft_id);

    expect(received.pallet_barcode).toBe(draft.draft_pallet_barcode);
    expect(received.pallet_id).not.toBe(oldPallet);
    const created = (await pg.query<{ pallet_barcode: string; reused_from_pallet_id: string; quantity: string; status: string }>(
      "select pallet_barcode, reused_from_pallet_id, quantity, status from pallets where id = $1", [received.pallet_id])).rows[0];
    expect(created).toMatchObject({ pallet_barcode: draft.draft_pallet_barcode, reused_from_pallet_id: oldPallet, status: "putaway" });
    expect(Number(created.quantity)).toBe(90);

    const retired = (await pg.query("select correction_state, quantity from pallets where id = $1", [oldPallet])).rows[0] as any;
    expect(retired.correction_state).toBe("superseded");
    expect(Number(retired.quantity)).toBe(0);
    // Stock exists exactly once, on the new pallet, and Put-Away work follows the new number.
    expect((await pg.query("select sum(quantity)::int as total from inventory_balances")).rows).toEqual([{ total: 90 }]);
    expect((await pg.query("select status from putaway_tasks where pallet_id = $1", [received.pallet_id])).rows).toEqual([{ status: "queued" }]);
  });

  it("honours an edited expiry with a new lot and leaves the old lot untouched", async () => {
    await seedPalletInPutaway();
    const draft = await returnToReceiving();
    await editDraftExpiry(draft.draft_id, "2028-06-30");
    const received = await receive(draft.draft_id);

    expect((await pg.query("select expiry_date::text as expiry from inventory_balances where pallet_id = $1", [received.pallet_id])).rows)
      .toEqual([{ expiry: "2028-06-30" }]);
    expect((await pg.query("select expiry_date::text as expiry from inventory_lots where id = $1", [oldLot])).rows).toEqual([{ expiry: "2026-11-26" }]);
    expect((await pg.query("select count(*)::int as n from inventory_lots")).rows).toEqual([{ n: 2 }]);
  });

  it("a return with no edits still gets a new number, on the same lot", async () => {
    await seedPalletInPutaway();
    const draft = await returnToReceiving();
    const received = await receive(draft.draft_id);

    expect(received.pallet_barcode).not.toBe("PLT-OLD");
    expect((await pg.query("select inventory_lot_id from pallets where id = $1", [received.pallet_id])).rows).toEqual([{ inventory_lot_id: oldLot }]);
    expect((await pg.query("select count(*)::int as n from inventory_lots")).rows).toEqual([{ n: 1 }]);
  });

  it("cancelling the draft keeps the stock as a missing pallet instead of losing it", async () => {
    await seedPalletInPutaway();
    const draft = await returnToReceiving();
    await pg.query("select public.cancel_receiving_draft($1, 'test')", [draft.draft_id]);

    expect((await pg.query("select status, correction_state from pallets where id = $1", [oldPallet])).rows)
      .toEqual([{ status: "missing", correction_state: null }]);
    expect((await pg.query("select status from inventory_balances where pallet_id = $1", [oldPallet])).rows).toEqual([{ status: "missing" }]);
  });

  it("returning the same task twice reuses the open draft", async () => {
    await seedPalletInPutaway();
    const first = await returnToReceiving();
    await pg.query("update putaway_tasks set status = 'queued', completed_at = null where id = $1", [task]);
    const second = await returnToReceiving();
    expect(second).toEqual(first);
  });
});

describe("legacy returned_pallet_id drafts", () => {
  it("still keep the physical pallet number", async () => {
    await seedPalletInPutaway();
    const notes = { _draft: true, returned_pallet_id: oldPallet, product_id: product, quantity: 90, draft_pallet_barcode: "PLT-OLD" };
    await pg.query(`insert into receipts(id, receipt_number, receipt_type, warehouse_id, status, draft_pallet_barcode, notes)
      values ($1, 'RCT-L', 'other', $2, 'draft', 'PLT-OLD', $3)`, [id(50), wh, JSON.stringify(notes)]);
    const received = await receive(id(50));
    expect(received).toMatchObject({ pallet_id: oldPallet, pallet_barcode: "PLT-OLD" });
  });
});
