import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

// Runs the real outbound, trip dispatch and standalone outbound migrations in
// isolated Postgres WASM, over source-derived table definitions. No network
// or remote writes. Covers the WW-only flow and the hand-over to NetSuite.
const read = (name: string) => readFileSync(`supabase/migrations/${name}`, "utf8").split("\r\n").join("\n");
const baseline = read("20260511000000_consolidated_wms_schema.sql");
const customersSql = read("20261016120000_netsuite_customers.sql");
const outbound = read("20261031120000_netsuite_outbound_orders.sql");
const tripDispatch = read("20261104090000_trip_dispatch.sql");
const standalone = read("20261116230000_standalone_outbound.sql");

const baselineTables = [
  "warehouses", "clients", "zones", "locations", "products", "inventory_lots", "pallets", "inventory_balances",
  "orders", "order_lines", "pick_lists", "pick_tasks", "staging_loads", "audit_events",
];
const stripRefs = (ddl: string) => ddl.replace(/references\s+[\w.]+\s*\([^)]*\)(?:\s+on delete (?:cascade|restrict|set null))?/gi, "");
const tableDdl = (source: string, table: string) => {
  const ddl = source.match(new RegExp(`create table if not exists public\\.${table} \\([\\s\\S]*?\\n\\);`))?.[0];
  if (!ddl) throw new Error(`Missing ${table}`);
  return stripRefs(ddl);
};
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const wh = id(1), product = id(2), product2 = id(3), connection = id(50);
let pg: PGlite;

const one = async <T,>(sql: string, params: unknown[] = []) => (await pg.query<T>(sql, params)).rows[0];
const setNetSuite = (active: boolean) => pg.query("update test_flags set netsuite_active = $1", [active]);

async function newCustomer(name = "Corner Shop", hold = false) {
  return (await one<{ id: string }>("select public.save_ww_customer(null, $1::jsonb) as id", [JSON.stringify({ name, on_credit_hold: hold })])).id;
}

async function newOrder(customer: string, lines = [{ product_id: product, quantity: 10 }]) {
  return (await one<{ id: string }>("select public.create_ww_order($1, $2, '2026-11-20', 'PO-9', null, $3::jsonb) as id", [wh, customer, JSON.stringify(lines)])).id;
}

async function plan(order: string, truck = "T1", trip = "1") {
  return (await one<{ id: string }>("select public.plan_ww_fulfillment($1, '2026-11-20', $2, $3, null, null) as id", [order, truck, trip])).id;
}

/** The floor picked `picked` of every line and loaded the order (the slice E/F RPCs, condensed). */
async function pickAndLoad(fulfillment: string, picked: (requested: number) => number = (q) => q) {
  const list = (await one<{ id: string }>(
    `insert into pick_lists(pick_list_number, warehouse_id, fulfillment_id, status) values ('PKL-' || $1::text, $2, $1::uuid, 'completed') returning id`,
    [fulfillment, wh])).id;
  const { rows } = await pg.query<{ id: string; quantity: string }>("select id, quantity from order_fulfillment_lines where fulfillment_id = $1", [fulfillment]);
  for (const line of rows) {
    await pg.query(`insert into pick_tasks(task_number, pick_list_id, fulfillment_line_id, requested_quantity, confirmed_quantity, status)
      values ('PKT-' || gen_random_uuid()::text, $1, $2, $3, $4, 'completed')`, [list, line.id, line.quantity, picked(Number(line.quantity))]);
  }
  await pg.query("update order_fulfillments set ww_stage = 'loaded' where id = $1", [fulfillment]);
}

beforeAll(async () => {
  pg = new PGlite();
  await pg.exec("set check_function_bodies = off");
  await pg.exec(baseline.slice(baseline.indexOf("do $$"), baseline.indexOf("-- UTILITY FUNCTIONS")));
  for (const table of baselineTables) await pg.exec(tableDdl(baseline, table));
  await pg.exec(tableDdl(customersSql, "customers"));
  await pg.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema if not exists auth;
    create table auth.users(id uuid primary key);
    insert into auth.users values ('${id(99)}');
    create function auth.uid() returns uuid language sql as $$ select '${id(99)}'::uuid $$;
    create table test_flags(netsuite_active boolean not null default false);
    insert into test_flags default values;
    create function public.is_approved() returns boolean language sql as $$ select true $$;
    create function public.can_access_warehouse(uuid) returns boolean language sql as $$ select true $$;
    create function public.has_min_role(uuid, text) returns boolean language sql as $$ select true $$;
    create function public.netsuite_integration_active() returns boolean language sql as $$ select netsuite_active from test_flags $$;
    create function public.set_updated_at() returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end $$;
    create table uom_units(id uuid primary key default gen_random_uuid(), conversion_rate numeric);
    create table roles(id uuid primary key default gen_random_uuid(), code text);
    create table user_roles(user_id uuid, role_id uuid);
    create table integration_connections(id uuid primary key, system text, enabled boolean, config jsonb default '{}'::jsonb, created_at timestamptz default now());
    create table integration_secrets(connection_id uuid, secret_type text, secret_value text);
    create table integration_sync_jobs(id uuid primary key default gen_random_uuid(), connection_id uuid, job_type text, idempotency_key text,
      payload jsonb, status text default 'queued', error_message text, unique (connection_id, idempotency_key));
    create table external_record_links(system text, local_table text, local_id uuid, external_record_type text, external_id text);
    alter table warehouses add column if not exists replen_demand_max_age_days integer not null default 3;
    alter table zones add column if not exists is_staging boolean not null default false;
    insert into roles(code) values ('warehouse_supervisor');
    insert into user_roles select '${id(99)}', id from roles;`);
  await pg.exec(outbound.slice(0, outbound.indexOf("-- Read by users who can see the warehouse")));
  await pg.exec(`alter table pick_lists add column fulfillment_id uuid; alter table pick_tasks add column fulfillment_line_id uuid;`);
  await pg.exec(tripDispatch.slice(0, tripDispatch.indexOf("-- Trip board: add the floor stage")).replace(/^-- =+\s*$/gm, ""));
  await pg.exec(standalone);
}, 60000);

afterAll(async () => { await pg.close(); });

beforeEach(async () => {
  await pg.exec(`truncate warehouses, products, customers, orders, order_lines, order_fulfillments, order_fulfillment_lines,
    pick_lists, pick_tasks, audit_events, integration_connections, integration_sync_jobs, external_record_links restart identity cascade;
    update test_flags set netsuite_active = false;
    insert into warehouses(id, code, name) values ('${wh}', 'TEST', 'Test warehouse');
    insert into products(id, sku, name) values ('${product}', 'SKU-1', 'Product 1'), ('${product2}', 'SKU-2', 'Product 2');`);
});

describe("standalone outbound (no NetSuite)", () => {
  it("adds a WW customer with the next WC- number", async () => {
    const customer = await newCustomer();
    const row = await one<{ customer_number: string; source: string }>("select customer_number, source from customers where id = $1", [customer]);
    expect(row).toEqual({ customer_number: "WC-000001", source: "ww" });
  });

  it("enters an order as open with every unit committed", async () => {
    const order = await newOrder(await newCustomer(), [{ product_id: product, quantity: 10 }, { product_id: product2, quantity: 4 }]);
    const row = await one<{ order_number: string; source: string; external_status: string; customer_reference: string }>(
      "select order_number, source, external_status, customer_reference from orders where id = $1", [order]);
    expect(row).toEqual({ order_number: "WO-000001", source: "ww", external_status: "B", customer_reference: "PO-9" });
    const inbox = await one<{ n: number; committed: string }>("select count(*)::int as n, sum(committed_quantity) as committed from order_lines where order_id = $1", [order]);
    expect(inbox.n).toBe(2);
    expect(Number(inbox.committed)).toBe(14);
  });

  it("plans a trip as a WW fulfillment the NetSuite poll cannot match", async () => {
    const order = await newOrder(await newCustomer());
    const ful = await plan(order);
    const row = await one<{ source: string; external_status: string; document_number: string; external_record_id: string }>(
      "select source, external_status, document_number, external_record_id from order_fulfillments where id = $1", [ful]);
    expect(row.source).toBe("ww");
    expect(row.external_status).toBe("A");
    expect(row.document_number).toBe("WF-000001");
    expect(row.external_record_id).toBe(`ww:${ful}`);
    // Nothing is left to plan, so a second trip is refused.
    await expect(plan(order, "T2")).rejects.toThrow(/Nothing open to plan/);
  });

  it("departing ships the order in WW and closes it", async () => {
    const order = await newOrder(await newCustomer());
    const ful = await plan(order);
    await pickAndLoad(ful);
    const result = await one<{ r: { departed: number; shipped_in_ww: number; queued: number } }>("select public.depart_trip(array[$1]::uuid[]) as r", [ful]);
    expect(result.r).toMatchObject({ departed: 1, shipped_in_ww: 1, queued: 0 });
    expect(await one("select external_status, ww_stage from order_fulfillments where id = $1", [ful])).toEqual({ external_status: "C", ww_stage: "departed" });
    expect(await one("select external_status, status from orders where id = $1", [order])).toEqual({ external_status: "H", status: "completed" });
    expect(Number((await one<{ q: string }>("select fulfilled_quantity as q from order_lines where order_id = $1", [order])).q)).toBe(10);
  });

  it("a short trip leaves the rest open to plan again", async () => {
    const order = await newOrder(await newCustomer());
    const ful = await plan(order);
    await pickAndLoad(ful, () => 6);
    await pg.query("select public.depart_trip(array[$1]::uuid[])", [ful]);
    expect(await one("select external_status, status from orders where id = $1", [order])).toEqual({ external_status: "D", status: "queued" });
    const next = await plan(order, "T2");
    expect(Number((await one<{ q: string }>("select quantity as q from order_fulfillment_lines where fulfillment_id = $1", [next])).q)).toBe(4);
  });

  it("takes an unpicked trip off and cancels the order", async () => {
    const order = await newOrder(await newCustomer());
    const ful = await plan(order);
    await expect(pg.query("select public.cancel_ww_order($1)", [order])).rejects.toThrow(/on a trip/);
    await pg.query("select public.cancel_ww_fulfillment($1)", [ful]);
    await pg.query("select public.cancel_ww_order($1)", [order]);
    expect(await one("select external_status, status from orders where id = $1", [order])).toEqual({ external_status: "C", status: "cancelled" });
  });

  it("refuses to take a trip off once stock is picked", async () => {
    const ful = await plan(await newOrder(await newCustomer()));
    await pickAndLoad(ful);
    await pg.query("update order_fulfillments set ww_stage = null where id = $1", [ful]);
    await expect(pg.query("select public.cancel_ww_fulfillment($1)", [ful])).rejects.toThrow(/picked stock/);
  });
});

describe("standalone outbound with NetSuite", () => {
  it("refuses new WW orders and customers while NetSuite is connected", async () => {
    const customer = await newCustomer();
    await setNetSuite(true);
    await expect(newCustomer("Another")).rejects.toThrow(/NetSuite is connected/);
    await expect(newOrder(customer)).rejects.toThrow(/NetSuite is connected/);
    // A WW customer made before the switch-on stays editable.
    await pg.query("select public.save_ww_customer($1, $2::jsonb)", [customer, JSON.stringify({ name: "Renamed" })]);
    expect((await one<{ name: string }>("select name from customers where id = $1", [customer])).name).toBe("Renamed");
  });

  it("refuses to edit or plan NetSuite records", async () => {
    await pg.query(`insert into customers(id, customer_number, name) values ('${id(70)}', 'C100', 'NS customer')`);
    await expect(pg.query("select public.save_ww_customer($1, $2::jsonb)", [id(70), JSON.stringify({ name: "x" })])).rejects.toThrow(/from NetSuite/);
    await pg.query(`insert into orders(id, order_number, warehouse_id, source, external_status, external_record_id) values ('${id(71)}', 'SO1', '${wh}', 'netsuite', 'B', '1001')`);
    await expect(plan(id(71))).rejects.toThrow(/comes from NetSuite/);
  });

  it("a WW order shipped after the switch-on takes the stock off NetSuite", async () => {
    const order = await newOrder(await newCustomer());
    const ful = await plan(order);
    await setNetSuite(true);
    await pg.exec(`insert into integration_connections(id, system, enabled, config) values ('${connection}', 'netsuite', true, '{"fulfillments_post_to_netsuite":"true"}');
      insert into external_record_links values ('netsuite', 'warehouses', '${wh}', 'location', '3'), ('netsuite', 'products', '${product}', 'item', '555');`);
    await pickAndLoad(ful, () => 7);
    const result = await one<{ r: { queued: number; shipped_in_ww: number } }>("select public.depart_trip(array[$1]::uuid[]) as r", [ful]);
    expect(result.r).toMatchObject({ queued: 0, shipped_in_ww: 1 });
    const { rows } = await pg.query<{ job_type: string; payload: { netsuiteItemId: string; netsuiteLocationId: string; quantityDelta: number } }>(
      "select job_type, payload from integration_sync_jobs");
    expect(rows).toHaveLength(1);
    expect(rows[0].job_type).toBe("inventory_adjustment");
    expect(rows[0].payload).toMatchObject({ netsuiteItemId: "555", netsuiteLocationId: "3", quantityDelta: -7 });
  });

  it("a NetSuite fulfillment still queues fulfillment_ship and stays open until NetSuite shows Shipped", async () => {
    await pg.exec(`insert into integration_connections(id, system, enabled, config) values ('${connection}', 'netsuite', true, '{"fulfillments_post_to_netsuite":"true"}');
      insert into orders(id, order_number, warehouse_id, source, external_status, external_record_id) values ('${id(80)}', 'SO2', '${wh}', 'netsuite', 'B', '2002');
      insert into order_lines(id, order_id, product_id, quantity) values ('${id(81)}', '${id(80)}', '${product}', 5);
      insert into order_fulfillments(id, order_id, warehouse_id, external_record_id, document_number, external_status, truck_name, trip_number)
        values ('${id(82)}', '${id(80)}', '${wh}', '9001', 'IF9', 'A', 'T1', '1');
      insert into order_fulfillment_lines(fulfillment_id, order_line_id, external_line_id, product_id, quantity) values ('${id(82)}', '${id(81)}', '1', '${product}', 5);`);
    await pickAndLoad(id(82));
    const result = await one<{ r: { queued: number; netsuite_count: number } }>("select public.depart_trip(array[$1]::uuid[]) as r", [id(82)]);
    expect(result.r).toMatchObject({ queued: 1, netsuite_count: 1 });
    expect(await one("select external_status, ww_stage from order_fulfillments where id = $1", [id(82)])).toEqual({ external_status: "A", ww_stage: "departed" });
    expect((await one<{ job_type: string }>("select job_type from integration_sync_jobs")).job_type).toBe("fulfillment_ship");
  });
});

describe("standalone outbound migration", () => {
  it("only adds to the schema", () => {
    expect(standalone).not.toMatch(/\bdrop\s+(table|column)\b/i);
  });
  it("keeps the queue kick on the NetSuite connection", () => {
    expect(standalone).toContain("from integration_connections where system = 'netsuite' and enabled = true order by created_at limit 1");
  });
});
