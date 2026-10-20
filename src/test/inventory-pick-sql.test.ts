import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import type { InventoryPickPlan } from "@/features/picking/inventory-pick-core";

// Executes the actual migration in isolated Postgres WASM, with source-derived
// table/enum definitions. No network, local daemon, credentials or remote writes.
const baseline = readFileSync("supabase/migrations/20260511000000_consolidated_wms_schema.sql", "utf8");
const migration = readFileSync("supabase/migrations/20261020133102_inventory_whole_pallet_pick_work.sql", "utf8");
const tables = ["warehouses", "clients", "zones", "locations", "products", "inventory_lots", "receipts", "receipt_lines", "pallets", "inventory_balances", "orders", "order_lines", "pick_lists", "pick_tasks", "barcode_labels"];
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const wh = id(1), client = id(2), product = id(3), location = id(4);
let pg: PGlite;

async function call(ids: number[], options: { mode?: string; commit?: boolean; token?: string; choice?: string; listId?: string; order?: string; warehouse?: string } = {}) {
  const result = await pg.query<{ plan: InventoryPickPlan & { lists: { id: string }[] } }>(
    "select public.inventory_whole_pallet_pick_work($1, $2::uuid[], $3, $4, $5, $6, $7, $8) as plan",
    [options.warehouse ?? wh, ids.map(id), options.mode ?? "pallet", options.commit ?? false,
      options.choice ?? "selected", options.token ?? null, options.listId ?? null, options.order ?? "TEST-ORDER"]);
  return result.rows[0].plan;
}

async function pallet(n: number, received: string | null, expiry: string | null, quantity = 20, owner = client, prod = product) {
  await pg.query(`insert into pallets(id,pallet_code,pallet_barcode,product_id,client_id,current_warehouse_id,current_location_id,
    quantity,available_quantity,status) values ($1,$2,$2,$3,$4,$5,$6,$7,$7,'available')`, [id(n + 100), `PAL-${n}`, prod, owner, wh, location, quantity]);
  await pg.query(`insert into inventory_balances(id,pallet_id,product_id,client_id,warehouse_id,location_id,
    quantity,available_quantity,status,received_at,expiry_date) values($1,$2,$3,$4,$5,$6,$7,$7,'available',$8,$9)`,
    [id(n), id(n + 100), prod, owner, wh, location, quantity, received ?? "2026-01-01", expiry]);
  // Production receipt is NOT NULL. Tests retain null coverage in the JS comparator.
}

beforeAll(async () => {
  pg = new PGlite();
  await pg.exec(baseline.slice(baseline.indexOf("do $$"), baseline.indexOf("-- UTILITY FUNCTIONS")));
  for (const table of tables) {
    const ddl = baseline.match(new RegExp(`create table if not exists public\\.${table} \\([\\s\\S]*?\\n\\);`))?.[0];
    if (!ddl) throw new Error(`Missing baseline ${table}`);
    // External FK targets (profiles/auth, setup) are outside this fixture. Keep
    // real column types, defaults, nullability and unique constraints.
    await pg.exec(ddl.replace(/references\s+[\w.]+\s*\([^)]*\)(?:\s+on delete (?:cascade|restrict|set null))?/gi, ""));
  }
  await pg.exec(`alter table pallets add column correction_state text;
    alter table inventory_balances add column correction_state text;
    alter table receipts add column container_number text, add column po_number text;
    create table inventory_freezes(id uuid default gen_random_uuid(), warehouse_id uuid, location_id uuid, pallet_id uuid, status text);
    create schema auth;
    create function auth.uid() returns uuid language sql as $$ select '${id(900)}'::uuid $$;
    create function public.is_approved() returns boolean language sql as $$ select true $$;
    create function public.can_access_warehouse(uuid) returns boolean language sql as $$ select $1 = '${wh}'::uuid $$;`);
  await pg.exec(migration);
}, 30000);

beforeEach(async () => {
  await pg.exec(`truncate ${[...tables, "inventory_freezes"].join(",")};
    insert into warehouses(id,code,name) values ('${wh}','TEST','Test warehouse');
    insert into clients(id,code,name) values ('${client}','TEST','Test owner');
    insert into products(id,sku,name,rotation_method) values ('${product}','TEST','Test product','fifo');
    insert into zones(id,warehouse_id,code,name) values ('${id(5)}','${wh}','A','Test zone');
    insert into locations(id,warehouse_id,zone_id,code,status) values ('${location}','${wh}','${id(5)}','A-01-A','active');`);
  await pallet(10, "2026-01-01", "2027-06-01", 7);
  await pallet(11, "2026-02-01", "2027-01-01", 90);
  await pallet(12, "2026-03-01", null, 30);
});
afterAll(async () => { await pg?.close(); });

describe("inventory whole-pallet Postgres API", () => {
  it("This product chooses exactly ONE FIFO whole pallet even when quantities differ", async () => {
    const plan = await call([12], { mode: "product" });
    expect(plan.selected.map((p) => [p.pallet_code, p.quantity])).toEqual([["PAL-10", 7]]);
    await call([12], { mode: "product", commit: true, token: plan.token });
    expect((await pg.query("select requested_quantity,status,confirmed_quantity from pick_tasks")).rows).toEqual([
      { requested_quantity: "7.00", status: "queued", confirmed_quantity: "0.00" },
    ]);
    expect((await pg.query("select quantity from inventory_balances where id=$1", [id(10)])).rows).toEqual([{ quantity: "7.00" }]);
  });
  it("FEFO uses earliest expiry, missing dates last, then receipt and deterministic ID ties", async () => {
    await pg.exec("update products set rotation_method='fefo'");
    let plan = await call([12], { mode: "product" });
    expect(plan.selected[0].pallet_code).toBe("PAL-11");
    await pg.exec("update inventory_balances set expiry_date='2027-01-01',received_at='2026-01-01' where expiry_date is not null");
    plan = await call([12], { mode: "product" });
    expect(plan.selected[0].pallet_code).toBe("PAL-10");
  });
  it("warns on exact pallets, deduplicates overlapping alternatives, and keeps exact choice", async () => {
    const plan = await call([11,12,12]);
    expect(plan.warning).toBe(true);
    expect(plan.selected.map((p) => p.pallet_code)).toEqual(["PAL-11","PAL-12"]);
    expect(plan.recommended.map((p) => p.pallet_code)).toEqual(["PAL-10","PAL-11"]);
    await call([11,12], { commit: true, token: plan.token, choice: "selected" });
    expect((await pg.query("select requested_quantity from pick_tasks order by requested_quantity")).rows).toEqual([
      { requested_quantity: "30.00" }, { requested_quantity: "90.00" },
    ]);
  });
  it("uses the reviewed recommendations and adds each pallet only once", async () => {
    const plan = await call([11,12]);
    await call([11,12], { commit: true, token: plan.token, choice: "recommended" });
    const tasks = (await pg.query("select pallet_id from pick_tasks order by pallet_id")).rows;
    expect(tasks).toEqual([{ pallet_id: id(110) }, { pallet_id: id(111) }]);
    await expect(call([10])).rejects.toThrow(/no longer eligible/);
  });
  it("rejects a later legacy task insert for an already-directed pallet", async () => {
    const plan = await call([10]);
    const result = await call([10], { commit: true, token: plan.token });
    await expect(pg.query(`insert into pick_tasks(task_number,pick_list_id,pallet_id,requested_quantity)
      values('LEGACY-RETRY',$1,$2,7)`, [result.lists[0].id, id(110)])).rejects.toThrow(/already has open pick work/);
    expect((await pg.query("select count(*)::int as count from pick_tasks")).rows[0]).toEqual({ count: 1 });
  });
  it("excludes inactive products and mismatched product ownership", async () => {
    await pg.exec("update products set active=false");
    await expect(call([10])).rejects.toThrow(/no longer eligible/);
    await pg.exec(`update products set active=true,client_owner_id='${id(99)}'`);
    await expect(call([10])).rejects.toThrow(/no longer eligible/);
  });
  it.each([
    "update inventory_balances set reserved_quantity=1 where id=$1",
    "update inventory_balances set held_quantity=1 where id=$1",
    "update inventory_balances set damaged_quantity=1 where id=$1",
    "update inventory_balances set available_quantity=6 where id=$1",
    "update inventory_balances set correction_state='pending' where id=$1",
    "update pallets set status='hold' where id=(select pallet_id from inventory_balances where id=$1)",
    "insert into inventory_freezes(warehouse_id,pallet_id,status) select warehouse_id,pallet_id,'active' from inventory_balances where id=$1",
  ])("excludes ineligible stock: %s", async (sql) => {
    await pg.query(sql, [id(10)]);
    await expect(call([10])).rejects.toThrow(/no longer eligible/);
    expect((await call([12], { mode: "product" })).selected[0].pallet_code).toBe("PAL-11");
  });
  it("blocks frozen/disabled locations and warehouse-wide freezes", async () => {
    await pg.exec("update locations set status='disabled'");
    await expect(call([12], { mode: "product" })).rejects.toThrow(/Not enough eligible/);
    await pg.exec(`update locations set status='active'; insert into inventory_freezes(warehouse_id,status) values('${wh}','active')`);
    await expect(call([10])).rejects.toThrow(/no longer eligible/);
  });
  it("requires fresh review for new earlier stock and changed quantities; rolls back completely", async () => {
    const plan = await call([11]);
    await pallet(13, "2025-01-01", null, 5);
    await expect(call([11], { commit: true, token: plan.token })).rejects.toThrow(/changed since review/);
    expect((await pg.query("select count(*)::int as count from orders")).rows[0]).toEqual({ count: 0 });
    const refreshed = await call([11]);
    await pg.exec(`update inventory_balances set quantity=80,available_quantity=80 where id='${id(11)}';
      update pallets set quantity=80,available_quantity=80 where id='${id(111)}'`);
    await expect(call([11], { commit: true, token: refreshed.token })).rejects.toThrow(/changed since review/);
  });
  it("scopes alternatives to product/client and creates separate owner lists", async () => {
    const owner2 = id(20);
    await pg.exec(`insert into clients(id,code,name) values('${owner2}','SECOND','Second owner')`);
    await pallet(14,"2025-01-01",null,9,owner2);
    expect((await call([12], { mode: "product" })).selected[0].client_id).toBe(client);
    const plan = await call([10,14]);
    const result = await call([10,14], { commit: true, token: plan.token });
    expect(result.lists).toHaveLength(2);
    expect((await pg.query("select count(distinct client_id)::int as count from pick_lists")).rows[0]).toEqual({ count: 2 });
  });
  it("appends to a queued list without creating another order; rejects a closed list", async () => {
    let plan = await call([10]);
    const first = await call([10], { commit: true, token: plan.token });
    plan = await call([11]);
    await call([11], { commit: true, token: plan.token, listId: first.lists[0].id });
    expect((await pg.query("select count(*)::int as count from orders")).rows[0]).toEqual({ count: 1 });
    await pg.exec("update pick_lists set status='completed'");
    plan = await call([12]);
    await expect(call([12], { commit: true, token: plan.token, listId: first.lists[0].id })).rejects.toThrow(/no longer eligible/);
  });
  it("rejects wrong warehouse and an invalid multi-product-mode request", async () => {
    await expect(call([10], { warehouse: id(99) })).rejects.toThrow(/Not authorized/);
    await expect(call([10,11], { mode: "product" })).rejects.toThrow(/exactly one/);
  });
  it("runs under invoker table permissions and existing warehouse RLS", async () => {
    await pg.exec(`create role fixture_operator;
      grant usage on schema public, auth to fixture_operator;
      grant select,insert,update,delete on all tables in schema public to fixture_operator;
      alter table inventory_balances enable row level security;
      create policy fixture_warehouse on inventory_balances for all to fixture_operator
        using (can_access_warehouse(warehouse_id)) with check (can_access_warehouse(warehouse_id));
      set role fixture_operator;`);
    try {
      const plan = await call([10]);
      const result = await call([10], { commit: true, token: plan.token });
      expect(result.lists).toHaveLength(1);
      expect((await pg.query("select quantity,available_quantity from inventory_balances where id=$1", [id(10)])).rows[0])
        .toEqual({ quantity: "7.00", available_quantity: "7.00" });
    } finally {
      await pg.exec("reset role; drop policy fixture_warehouse on inventory_balances; alter table inventory_balances disable row level security;");
    }
  });
});
