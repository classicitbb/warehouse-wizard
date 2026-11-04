import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

// Runs the real forward-pick and event-driven migrations in isolated Postgres
// WASM, over source-derived table definitions. No network or remote writes.
const read = (name: string) => readFileSync(`supabase/migrations/${name}`, "utf8");
const baseline = read("20260511000000_consolidated_wms_schema.sql");
const outbound = read("20261031120000_netsuite_outbound_orders.sql");
const forwardPick = read("20261031150000_forward_pick_replenishment.sql");
const eventDriven = read("20261103090000_event_driven_pick_face_replenishment.sql");

const baselineTables = [
  "warehouses", "clients", "zones", "locations", "products", "inventory_lots", "receipts", "receipt_lines", "pallets",
  "inventory_balances", "orders", "order_lines", "pick_lists", "pick_tasks", "move_tasks", "replenishment_tasks", "system_logs",
];
const stripRefs = (ddl: string) => ddl.replace(/references\s+[\w.]+\s*\([^)]*\)(?:\s+on delete (?:cascade|restrict|set null))?/gi, "");
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const wh = id(1), product = id(3), face = id(4), bulk = id(5), zone = id(6);
let pg: PGlite;

const tasks = async () => (await pg.query<{ status: string; reason: string }>("select status, reason from replenishment_tasks order by created_at")).rows;
const logs = async () => (await pg.query<{ source: string; message: string }>("select source, message from system_logs")).rows;

/** A picker takes stock from the face: the balance quantity drops (as a pick confirmation does). */
const pickFromFace = (to: number) =>
  pg.query("update inventory_balances set quantity = $1, available_quantity = $1 where location_id = $2", [to, face]);

async function balance(n: number, location: string, quantity: number) {
  await pg.query(`insert into pallets(id,pallet_code,pallet_barcode,product_id,current_warehouse_id,current_location_id,quantity,available_quantity,status)
    values ($1,$2,$2,$3,$4,$5,$6,$6,'available')`, [id(n + 100), `PAL-${n}`, product, wh, location, quantity]);
  await pg.query(`insert into inventory_balances(id,pallet_id,product_id,warehouse_id,location_id,quantity,available_quantity,status,received_at)
    values ($1,$2,$3,$4,$5,$6,$6,'available','2026-01-01')`, [id(n), id(n + 100), product, wh, location, quantity]);
}

beforeAll(async () => {
  pg = new PGlite();
  await pg.exec("set check_function_bodies = off");
  await pg.exec(baseline.slice(baseline.indexOf("do $$"), baseline.indexOf("-- UTILITY FUNCTIONS")));
  for (const table of baselineTables) {
    const ddl = baseline.match(new RegExp(`create table if not exists public\\.${table} \\([\\s\\S]*?\\n\\);`))?.[0];
    if (!ddl) throw new Error(`Missing baseline ${table}`);
    await pg.exec(stripRefs(ddl));
  }
  for (const table of ["order_fulfillments", "order_fulfillment_lines"]) {
    const ddl = outbound.match(new RegExp(`create table if not exists public\\.${table} \\([\\s\\S]*?\\n\\);`))?.[0];
    if (!ddl) throw new Error(`Missing outbound ${table}`);
    await pg.exec(stripRefs(ddl));
  }
  await pg.exec(`
    create role anon; create role authenticated; create role service_role;
    alter table pick_lists add column fulfillment_id uuid;
    alter table pick_tasks add column fulfillment_line_id uuid;
    alter table pallets add column correction_state text;
    create table inventory_freezes(id uuid default gen_random_uuid(), warehouse_id uuid, location_id uuid, pallet_id uuid, status text);
    create schema if not exists auth;
    create function auth.uid() returns uuid language sql as $$ select null::uuid $$;
    create table auth.users(id uuid primary key);
    create function public.is_approved() returns boolean language sql as $$ select true $$;
    create function public.can_access_warehouse(uuid) returns boolean language sql as $$ select true $$;
    create function public.has_min_role(uuid, text) returns boolean language sql as $$ select true $$;
    create function public.assert_location_not_frozen(uuid, uuid) returns void language sql as $$ select $$;
    create function public.log_audit_event(text, text, uuid, uuid, uuid, uuid, uuid, jsonb) returns void language sql as $$ select $$;
    create function public.set_updated_at() returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end $$;`);
  await pg.exec(forwardPick);
  await pg.exec(eventDriven);
}, 60000);

afterAll(async () => { await pg.close(); });

beforeEach(async () => {
  await pg.exec(`truncate warehouses, zones, locations, products, pallets, inventory_balances, pick_lists, pick_tasks,
    replenishment_tasks, pick_face_slots, system_logs, order_fulfillments, order_fulfillment_lines restart identity cascade;
    insert into warehouses(id,code,name) values ('${wh}','TEST','Test warehouse');
    insert into zones(id,warehouse_id,code,name) values ('${zone}','${wh}','A','Zone');
    insert into products(id,sku,name,rotation_method) values ('${product}','SKU','Product','fifo');
    insert into locations(id,warehouse_id,zone_id,code,status,max_pallets) values
      ('${face}','${wh}','${zone}','FACE-01','pick_face',2),
      ('${bulk}','${wh}','${zone}','BULK-01','active',1);
    insert into pick_face_slots(location_id,product_id,warehouse_id,full_quantity) values ('${face}','${product}','${wh}',100);`);
  await balance(10, face, 100);
  await balance(11, bulk, 100);
});

describe("event-driven replenishment", () => {
  it("does nothing while the face stays above its trigger level", async () => {
    await pickFromFace(60);
    expect(await tasks()).toEqual([]);
  });

  it("one face below min after a pick creates exactly one task", async () => {
    await pickFromFace(40);
    expect(await tasks()).toEqual([{ status: "queued", reason: "min" }]);
  });

  it("a second pick creates no duplicate task", async () => {
    await pickFromFace(40);
    await pickFromFace(25);
    await pickFromFace(10);
    expect(await tasks()).toHaveLength(1);
    // The open task keeps the latest numbers.
    const { rows } = await pg.query<{ on_hand_quantity: string }>("select on_hand_quantity from replenishment_tasks");
    expect(Number(rows[0].on_hand_quantity)).toBe(10);
  });

  it("the whole-warehouse check adds no duplicate after an event task", async () => {
    await pickFromFace(40);
    await pg.query("select public.evaluate_forward_pick_replenishment(null)");
    expect(await tasks()).toHaveLength(1);
  });

  it("a failing evaluator does not abort the pick confirmation", async () => {
    await pg.exec(`create or replace function public.replenishment_source_pallet(p_warehouse_id uuid, p_product_id uuid, p_exclude uuid[] default '{}')
      returns table (pallet_id uuid, location_id uuid, available_quantity numeric)
      language plpgsql as $$ begin raise exception 'evaluator boom'; end $$;`);
    await pickFromFace(40);
    const { rows } = await pg.query<{ quantity: string }>("select quantity from inventory_balances where location_id = $1", [face]);
    expect(Number(rows[0].quantity)).toBe(40);
    expect(await tasks()).toEqual([]);
    const failures = await logs();
    expect(failures).toHaveLength(1);
    expect(failures[0].message).toContain("evaluator boom");
  });
});

describe("event-driven replenishment migration", () => {
  it("is additive and drops no table or column", () => {
    expect(eventDriven).not.toMatch(/\bdrop\s+(table|column|function)\b/i);
  });

  it("moves the safety net from every 5 minutes to hourly under the same job name", () => {
    expect(eventDriven).toContain("'evaluate-forward-pick-replenishment'");
    expect(eventDriven).toContain("'0 * * * *'");
    expect(eventDriven).not.toContain("*/5");
  });

  it("makes the targeted evaluator internal and revoked from anon", () => {
    expect(eventDriven).toContain("create or replace function public.evaluate_pick_face_replenishment(p_product_id uuid, p_location_id uuid)");
    expect(eventDriven).toMatch(/revoke all on function public\.evaluate_pick_face_replenishment\(uuid, uuid\) from public, anon/);
  });

  it("uses statement-level triggers and guards recursion", () => {
    expect(eventDriven.match(/for each statement/g)).toHaveLength(7);
    expect(eventDriven).toContain("pg_trigger_depth() > 1");
    expect(eventDriven).toContain("ww.replen_eval");
  });
});
