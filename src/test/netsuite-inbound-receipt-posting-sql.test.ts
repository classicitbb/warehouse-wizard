import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { buildInboundShipmentRestletBody, netsuiteReceiptExternalRef, type ReceiptJobPayload } from "../../supabase/functions/_shared/netsuite-receipt";

// Runs the real label-print function and the W3c migration in isolated Postgres
// WASM. No network, credentials or remote writes.
const read = (file: string) => readFileSync(`supabase/migrations/${file}`, "utf8").split("\r\n").join("\n");
const baseline = read("20260511000000_consolidated_wms_schema.sql");
const labelsSource = read("20260902141515_a70c708f-ed8e-441b-9f7a-0d9387da4d18.sql");
const conflictPatch = read("20260902143104_55a4eb55-9e7e-4b6f-838b-c1a8201686d6.sql");
const putawaySync = read("20260720040000_netsuite_putaway_inventory_sync.sql");
const internalIds = read("20260916120000_netsuite_inventory_sync_internal_ids.sql");
const sourcedPutaway = read("20261021200000_netsuite_receipt_sourced_putaway.sql");
const migration = read("20261102120000_netsuite_inbound_shipment_receipt_posting.sql");

const tables = ["warehouses", "clients", "zones", "locations", "products", "product_packaging_profiles", "inventory_lots",
  "receipts", "receipt_lines", "pallets", "inventory_balances", "putaway_tasks", "barcode_labels", "audit_events"];
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const wh = id(1), product = id(3), connection = id(50);
let pg: PGlite;

const shipmentRef = { lineKey: "4827", lineNumber: 2, itemName: "Test", ordered: 100, received: 0, remaining: 100, poId: "76", poNumber: "PO76", inboundShipmentId: "52" };

async function draft(n: number, extra: Record<string, unknown> = {}, netsuite: Record<string, unknown> | null = shipmentRef) {
  const notes = {
    _draft: true, product_id: product, quantity: 10, draft_pallet_barcode: `PLT-${n}`, lot_number: "LOT-A1", expiry_date: "2027-09-01",
    ...(netsuite ? { netsuite } : {}), ...extra,
  };
  await pg.query(`insert into receipts(id, receipt_number, receipt_type, warehouse_id, status, draft_pallet_barcode, notes)
    values ($1, $2, 'po', $3, 'draft', $4, $5)`, [id(n), `RCT-${n}`, wh, `PLT-${n}`, JSON.stringify(notes)]);
  return id(n);
}
async function printLabels(draftId: string) {
  const { rows } = await pg.query<{ pallet_id: string }>("select pallet_id from public.confirm_receiving_draft_labels_printed($1)", [draftId]);
  return rows[0].pallet_id;
}
async function putAway(palletId: string) {
  await pg.query(`update inventory_balances set location_id = $2, status = 'available', available_quantity = quantity
    where pallet_id = $1`, [palletId, id(4)]);
}
const jobs = async () => (await pg.query<{ job_type: string; idempotency_key: string; payload: ReceiptJobPayload & { receiptId: string } }>(
  "select job_type, idempotency_key, payload from integration_sync_jobs order by job_type, idempotency_key")).rows;
const postingOn = (on: boolean) =>
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
  await pg.exec(labelsSource.slice(0, labelsSource.indexOf("\n$$;\n") + 4));
  await pg.exec(conflictPatch.replace(/ARRAY\[\s*'public\.confirm_receiving_draft_labels_printed\(uuid\)'[\s\S]*?\]/, "ARRAY['public.confirm_receiving_draft_labels_printed(uuid)']"));
  const enqueueStart = internalIds.indexOf("create or replace function public.enqueue_netsuite_inventory_sync");
  await pg.exec(internalIds.slice(enqueueStart, internalIds.indexOf("\n$$;\n", enqueueStart) + 4));
  await pg.exec(putawaySync.slice(putawaySync.indexOf("create trigger trg_enqueue_netsuite_inventory_sync"),
    putawaySync.indexOf(";", putawaySync.indexOf("create trigger trg_enqueue_netsuite_inventory_sync")) + 1));
  await pg.exec(sourcedPutaway);
  await pg.exec(migration);
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

describe("inbound shipment receipt posting", () => {
  it("queues nothing while receipts_post_to_netsuite is off", async () => {
    await printLabels(await draft(10));
    expect(await jobs()).toEqual([]);
  });

  it("queues one receipt job when the labels are confirmed", async () => {
    await postingOn(true);
    await printLabels(await draft(20));
    const [job, ...rest] = await jobs();
    expect(rest).toEqual([]);
    expect(job.job_type).toBe("receipt_inbound_shipment");
    expect(job.idempotency_key).toBe(`receipt:inbound_shipment:${id(20)}`);
    expect(job.payload).toEqual({
      documentType: "inbound_shipment", documentId: "52", externalRef: `ww-rcpt-ship-${id(20)}`, receiptId: id(20), locationId: "3",
      lines: [{ lineKey: "4827", lineNumber: 2, itemId: "2963", poId: "76", quantity: 10, lotNumber: "LOT-A1", expiryDate: "2027-09-01" }],
    });
  });

  it("builds the same externalRef the RESTlet body helper does, and a valid body from the stored payload", async () => {
    await postingOn(true);
    await printLabels(await draft(21));
    const { payload } = (await jobs())[0];
    expect(payload.externalRef).toBe(netsuiteReceiptExternalRef("inbound_shipment", id(21)));
    expect(buildInboundShipmentRestletBody(payload).lines[0]).toMatchObject({ shipmentLineKey: "4827", quantity: 10, location: "3" });
  });

  it("a second completion of the same receipt queues no second job", async () => {
    await postingOn(true);
    await printLabels(await draft(30));
    await pg.query("update receipts set status = 'draft' where id = $1", [id(30)]);
    await pg.query("update receipts set status = 'completed' where id = $1", [id(30)]);
    expect(await jobs()).toHaveLength(1);
  });

  it("leaves purchase order, transfer order and manual receipts alone", async () => {
    await postingOn(true);
    await printLabels(await draft(40, {}, { ...shipmentRef, inboundShipmentId: undefined }));
    await printLabels(await draft(41, {}, null));
    expect(await jobs()).toEqual([]);
  });

  it("skips stock returned to Receiving, which was already received once", async () => {
    await postingOn(true);
    await printLabels(await draft(50, { superseded_pallet_id: id(99) }));
    expect(await jobs()).toEqual([]);
  });

  it("never blocks label printing when the job cannot be queued", async () => {
    await postingOn(true);
    await pg.exec("alter table integration_sync_jobs rename to integration_sync_jobs_off");
    try {
      expect(await printLabels(await draft(60))).toBeTruthy();
      expect((await pg.query("select status from receipts where id = $1", [id(60)])).rows).toEqual([{ status: "completed" }]);
    } finally {
      await pg.exec("alter table integration_sync_jobs_off rename to integration_sync_jobs");
    }
  });

  it("only inbound shipment pallets skip the putaway adjustment; PO-sourced stock still adjusts", async () => {
    await postingOn(true);
    await putAway(await printLabels(await draft(70)));
    await putAway(await printLabels(await draft(71, {}, { ...shipmentRef, inboundShipmentId: undefined })));
    const kinds = (await jobs()).map((j) => j.job_type);
    expect(kinds).toEqual(["inventory_adjustment", "receipt_inbound_shipment"]);
  });
});
