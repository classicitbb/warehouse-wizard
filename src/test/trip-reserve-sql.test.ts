import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");
const forward = read("supabase/migrations/20261031150000_forward_pick_replenishment.sql");
const extract = (name: string) => {
  const start = forward.indexOf(`create or replace function public.${name}(`);
  return forward.slice(start, forward.indexOf("$$;", start) + 3);
};
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
let pg: PGlite;
const preview = async (request = false, pallet = id(8)) => (await pg.query<{ result: any }>(
  "select trip_pick_reserve($1, $2, $3) result", [id(1), request, pallet],
)).rows[0].result;

beforeAll(async () => {
  pg = new PGlite();
  await pg.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth;
    create function auth.uid() returns uuid language sql as $$ select '${id(99)}'::uuid $$;
    create function is_approved() returns boolean language sql as $$ select true $$;
    create function can_access_warehouse(uuid) returns boolean language sql as $$ select true $$;
    create type task_status as enum ('queued','assigned','in_progress','completed','cancelled','exception');
    create table pick_tasks(id uuid primary key, pick_list_id uuid, fulfillment_line_id uuid, location_id uuid, pallet_id uuid, status task_status, confirmed_quantity numeric default 0);
    create table pick_lists(id uuid primary key,warehouse_id uuid,fulfillment_id uuid);
    create table order_fulfillment_lines(id uuid primary key,product_id uuid);
    create table order_fulfillments(id uuid primary key,external_status text);
    create table products(id uuid primary key,rotation_method text);
    create table zones(id uuid primary key,is_staging boolean default false,is_dispatch boolean default false,is_quarantine boolean default false);
    create table locations(id uuid primary key,warehouse_id uuid,zone_id uuid,code text,status text);
    create table pallets(id uuid primary key,pallet_barcode text,product_id uuid,current_location_id uuid,current_warehouse_id uuid,status text,available_quantity numeric,correction_state text);
    create table inventory_balances(id uuid primary key,pallet_id uuid,product_id uuid,location_id uuid,warehouse_id uuid,status text,available_quantity numeric,received_at timestamptz,created_at timestamptz default now(),expiry_date date);
    create table inventory_freezes(id uuid,location_id uuid,pallet_id uuid,status text);
    create table move_tasks(id uuid,pallet_id uuid,status task_status);
    create table replenishment_tasks(id uuid primary key default gen_random_uuid(),task_number text,warehouse_id uuid,product_id uuid,to_location_id uuid,from_location_id uuid,suggested_pallet_id uuid,target_quantity numeric,on_hand_quantity numeric,demand_quantity numeric,priority text,reason text,status task_status,notes text,created_by uuid,created_at timestamptz default now());
    create function pick_face_target(uuid,uuid) returns uuid language sql as $$ select id from locations where warehouse_id=$1 and status='pick_face' limit 1 $$;
    create function pick_face_on_hand(uuid,uuid) returns numeric language sql as $$ select 0::numeric $$;
    create function pick_face_demand(uuid,uuid) returns numeric language sql as $$ select 36::numeric $$;
  `);
  await pg.exec(extract("replenishment_source_pallet"));
  await pg.exec(extract("request_urgent_replenishment"));
  await pg.exec(read("drizzle/migrations/0031_trip_pick_reserve_request_readback.sql"));
}, 60000);

beforeEach(async () => {
  await pg.exec(`truncate pick_tasks,pick_lists,order_fulfillment_lines,order_fulfillments,products,zones,locations,pallets,inventory_balances,inventory_freezes,move_tasks,replenishment_tasks;
    create or replace function can_access_warehouse(uuid) returns boolean language sql as $$ select true $$;
    insert into products values('${id(4)}','fifo');
    insert into locations values('${id(6)}','${id(3)}',null,'FACE-1','pick_face'),('${id(7)}','${id(3)}',null,'BULK-1','active');
    insert into order_fulfillment_lines values('${id(5)}','${id(4)}');
    insert into pick_lists values('${id(2)}','${id(3)}','${id(10)}');
    insert into order_fulfillments values('${id(10)}','A');
    insert into pick_tasks(id,pick_list_id,fulfillment_line_id,status) values('${id(1)}','${id(2)}','${id(5)}','exception');
    insert into pallets values('${id(8)}','OLD','${id(4)}','${id(7)}','${id(3)}','available',64,null),('${id(9)}','NEW','${id(4)}','${id(7)}','${id(3)}','available',36,null);
    insert into inventory_balances(id,pallet_id,product_id,location_id,warehouse_id,status,available_quantity,received_at,expiry_date) values
    ('${id(18)}','${id(8)}','${id(4)}','${id(7)}','${id(3)}','available',64,'2026-10-01','2027-06-30'),
    ('${id(19)}','${id(9)}','${id(4)}','${id(7)}','${id(3)}','available',36,'2026-11-01','2027-01-31');`);
});
afterAll(async () => { await pg.close(); });

describe("picker reserve rules", () => {
  it("shows only the oldest FIFO pallet and its available quantity", async () => {
    expect((await preview()).source).toMatchObject({ pallet_id: id(8), barcode: "OLD", available_quantity: 64, bin: "BULK-1" });
  });
  it("respects FEFO before receipt date", async () => {
    await pg.exec("update products set rotation_method='fefo'");
    expect((await preview()).source.pallet_id).toBe(id(9));
  });
  it("queues the displayed pallet urgently and leaves the pick line open", async () => {
    const result = await preview(true);
    expect(result.replenishment.status).toBe("queued");
    expect((await pg.query("select suggested_pallet_id,priority from replenishment_tasks")).rows).toEqual([{ suggested_pallet_id: id(8), priority: "urgent" }]);
    expect((await pg.query("select status,confirmed_quantity from pick_tasks")).rows).toEqual([{ status: "exception", confirmed_quantity: "0" }]);
  });
  it("reuses an existing request instead of creating a duplicate", async () => {
    const first = await preview(true);
    expect((await preview(true)).replenishment.id).toBe(first.replenishment.id);
    expect((await pg.query("select id from replenishment_tasks")).rows).toHaveLength(1);
    expect((await preview()).source.barcode).toBe("OLD");
  });
  it("shows no pallet and creates no task when reserve stock is absent", async () => {
    await pg.exec("update inventory_balances set available_quantity=0");
    expect((await preview()).source).toBeNull();
    await expect(preview(true)).rejects.toThrow("No eligible reserve pallet");
    expect((await pg.query("select id from replenishment_tasks")).rows).toHaveLength(0);
  });
  it("does not silently substitute a different pallet on request", async () => {
    await expect(preview(true, id(9))).rejects.toThrow("oldest reserve pallet has changed");
    expect((await pg.query("select id from replenishment_tasks")).rows).toHaveLength(0);
  });
  it("excludes frozen and superseded pallets", async () => {
    await pg.exec(`insert into inventory_freezes values('${id(20)}',null,'${id(8)}','active')`);
    expect((await preview()).source.pallet_id).toBe(id(9));
    await pg.exec("truncate inventory_freezes; update pallets set correction_state='superseded' where pallet_barcode='OLD'");
    expect((await preview()).source.pallet_id).toBe(id(9));
  });
  it("requires warehouse access", async () => {
    await pg.exec("create or replace function can_access_warehouse(uuid) returns boolean language sql as $$ select false $$");
    await expect(preview()).rejects.toThrow("Not authorized for this warehouse");
  });
  it("will not request against a closed pick line", async () => {
    await pg.exec("update pick_tasks set status='completed'");
    await expect(preview(true)).rejects.toThrow("already closed");
  });
});