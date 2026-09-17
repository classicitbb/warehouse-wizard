# NetSuite API integration — record-level test plan

Tests for the NetSuite adapter, driven by records a tester **creates by hand in a
NetSuite sandbox**: an item, a purchase order, a sales order, an invoice, and an
item receipt — plus the inventory adjustment Warehouse Wizard posts back.

Three layers, each runnable on its own:

| Layer | Where | Needs NetSuite? | Command |
|---|---|---|---|
| Contract | `src/test/netsuite-record-flows.test.ts` | no | `npm test -- netsuite-record-flows` |
| Live API | `src/test/netsuite-live.integration.test.ts` | yes (skipped without credentials) | see [Running the live suite](#running-the-live-suite) |
| Manual | this document, cases NS-01…NS-15 | yes | by hand |

## What the adapter actually does today

Read this before writing a bug report. Most record types are **accepted and
parked**, not processed, and two are rejected outright. That is the current
design, not a defect.

| NetSuite record | `recordType` | Inbound behaviour | Outbound |
|---|---|---|---|
| Item | `item` | **Processed** — upserts `products` + `external_record_links` | — |
| Purchase order | `purchase_order` | Accepted, logged, left `queued` — no processor | — |
| Sales order | `sales_order` | Accepted, logged, left `queued` — no processor | — |
| Transfer order | `transfer_order` | Accepted, logged, left `queued` — no processor | — |
| Item fulfillment | `fulfillment` | Accepted, logged, left `queued` — no processor | — |
| Inventory | `inventory` | Accepted, logged, left `queued` — no processor | — |
| **Invoice** | `invoice` | **400 Unsupported recordType** | — |
| **Item receipt** | `item_receipt` | **400 Unsupported recordType** | — |
| Inventory adjustment | — | not inbound | **Posted** by `process-netsuite-queue` after putaway |

There is also **no SuiteScript in this repository**. Nothing in NetSuite calls
`netsuite-webhook` yet. So the inbound cases below have you create the record in
NetSuite by hand and then replay it at the webhook with `curl` — using the real
record's field values, which the live suite reads back over SuiteQL. When a
User Event script is added, the same cases apply with the `curl` step removed.

## Prerequisites

NetSuite sandbox (an account id ending `_SB1` or similar):

1. Integration record with **OAuth 2.0 Client Credentials (Machine to Machine)**
   grant and the **REST Web Services** scope.
2. Certificate uploaded under Setup → Integration → Manage Authentication →
   OAuth 2.0 Client Credentials (M2M) Setup. Generate it in
   Settings → Integrations → NetSuite, download it, upload it, then save the
   Certificate ID NetSuite assigns back into Settings.
3. A test item, e.g. `WW-TEST-001`, stocked at one location.
4. A customer and a vendor you are happy to raise test documents against.

Warehouse Wizard (Settings → Integrations, as `admin` or `developer`):

5. Account ID saved, connection **enabled**, **Test connection** green.
6. **Inventory adjustment posting**: the GL account internal id. Until this is
   set, the queue worker answers `skipped: adjustment_account_not_configured`
   and claims nothing — correct, but it means NS-12 cannot pass.
7. **NetSuite Location Mapping**: the sandbox location's internal id mapped to
   the warehouse you will receive into.
8. Webhook secret and queue runner secret — both revealed **once**, on the save
   that creates them. Re-save to rotate.

## Running the live suite

```bash
NETSUITE_ACCOUNT_ID=1234567_SB1 NETSUITE_CLIENT_ID=... NETSUITE_CERTIFICATE_ID=... NETSUITE_PRIVATE_KEY="$(cat ww-netsuite.key)" NS_TEST_ITEM_SKU=WW-TEST-001 NS_TEST_SALES_ORDER=SO1042 NS_TEST_PURCHASE_ORDER=PO2051 NS_TEST_INVOICE=INV3007 NS_TEST_ITEM_RECEIPT=RCPT4011 WW_FUNCTIONS_URL=https://<ref>.supabase.co/functions/v1 WW_WEBHOOK_SECRET=... WW_QUEUE_SECRET=... npm test -- netsuite-live
```

Every variable is optional; each group of tests skips itself when its variables
are absent, so you can start with credentials only and add document numbers as
you create them. Writes are opt-in: `WW_ALLOW_WRITES=1` lets the item webhook
upsert a product, and `NETSUITE_ALLOW_WRITES=1` (sandbox account ids only) lets
it post a real inventory adjustment and reverse it.

Sections C and D write `integration_sync_jobs` and `integration_payload_logs`
rows into whichever Supabase project `WW_FUNCTIONS_URL` points at. Use a staging
project, or accept the audit rows and clean them up with the query at the end.

## Verification queries

Run in the Supabase SQL editor. `integration_secrets` is service-role only, so
these read the job spine, not the credentials.

```sql
-- Every job from the last hour, newest first.
select j.created_at, j.job_type, j.status, j.attempts, j.idempotency_key,
       j.error_message, j.result
  from integration_sync_jobs j
  join integration_connections c on c.id = j.connection_id
 where c.system = 'netsuite' and j.created_at > now() - interval '1 hour'
 order by j.created_at desc;

-- What a specific delivery actually sent and got back.
select direction, http_status, created_at, payload, response
  from integration_payload_logs
 where sync_job_id = '<job id>'
 order by created_at;

-- Nothing should ever be here for a parked order row.
select d.created_at, d.reason, j.job_type, j.idempotency_key
  from integration_dead_letters d
  left join integration_sync_jobs j on j.id = d.sync_job_id
 where d.resolved_at is null
 order by d.created_at desc;

-- The links the outbound trigger requires.
select local_table, external_record_type, external_id, last_synced_at
  from external_record_links where system = 'netsuite' order by local_table;
```

The `curl` used by the inbound cases:

```bash
curl -si -X POST "$WW_FUNCTIONS_URL/netsuite-webhook" -H 'Content-Type: application/json' -H "X-Webhook-Secret: $WW_WEBHOOK_SECRET" -d @body.json
```

---

## NS-01 — Connection and token

**NetSuite** Nothing; prerequisites 1–2 done.
**Warehouse Wizard** Settings → Integrations → NetSuite → **Test connection**.
**Expected** Green, and `integration_connections.config.last_test_ok = true`.
A bare `400 invalid_client` means the certificate is not registered against this
integration record; `500 server_error` usually means an unknown Client ID.
NetSuite's Login Audit Trail carries the real reason.
**Covered live by** A1–A3.

## NS-02 — Item created in NetSuite reaches the product master

**NetSuite** Create item `WW-TEST-001` — a display name, a UPC, one stocked
location.
**Warehouse Wizard** Settings → Integrations → NetSuite → browse items, search
`WW-TEST-001`, select it, **Import selected**.
**Expected** One `products` row with `sku = 'WW-TEST-001'`, and one
`external_record_links` row (`local_table = 'products'`,
`external_record_type = 'item'`, `external_id` = the item's **internal id**, not
its name). Re-importing updates the same row and creates no duplicate.
**Also** Push the same item at the webhook as `recordType: "item"`; expect
`processed: true` and the same single product row — the picker and the webhook
share one upsert path, so they must not diverge.
**Covered live by** A4, B1, C10.

## NS-03 — Purchase order created in NetSuite is parked

**NetSuite** Create a purchase order for the vendor, one line of `WW-TEST-001`,
quantity 10. Note the document number and internal id.
**Replay** POST with `recordType: "purchase_order"`, `externalId` = the internal
id, `lastModified` = the record's last modified timestamp, `payload` = the
header and line fields.
**Expected** `200 {"received":true,"recordType":"purchase_order","processed":false}`.
One `integration_sync_jobs` row, `job_type = 'purchase_order'`,
`status = 'queued'`, and one inbound `integration_payload_logs` row.
**Not expected** Any local `receipts` row. Nothing consumes a purchase order yet.
**Covered live by** B3, C3, C4.

## NS-04 — Sales order created in NetSuite is parked

**NetSuite** Create a sales order for the customer, two lines of `WW-TEST-001`
at different rates, and **save it approved** so NS-05 can bill it.
**Replay** As NS-03 with `recordType: "sales_order"`.
**Expected** `200 … processed:false`, one `queued` job with
`job_type = 'sales_order'`.
**Not expected** Any local `orders` / `order_lines` row.
**Covered live by** B2, C1, C2.

## NS-05 — Invoice billed from the sales order is rejected

**NetSuite** Open the NS-04 sales order → **Bill**. Save the invoice.
**Replay** As NS-03 with `recordType: "invoice"`.
**Expected** `400 {"error":"Unsupported recordType: invoice"}`, **no** sync job
and **no** payload log — the gate runs before either insert. In NetSuite the
invoice's *Created From* is the NS-04 sales order and its total matches the
lines; that chain is verified over the API, not through Warehouse Wizard.
**This is today's contract.** When invoice support lands, `invoice` joins
`SUPPORTED_RECORD_TYPES`, the contract test's rejection list drops it, and this
case's expected result changes with them.
**Covered live by** B4, C5.

## NS-06 — Item receipt against the purchase order

**NetSuite** Open the NS-03 purchase order → **Receive**. Receive 10 at the
mapped location. Save.
**Expected** In NetSuite: an item receipt whose *Created From* is the purchase
order, whose lines carry a location, and which raises on-hand by 10. In
Warehouse Wizard: **nothing**. Receiving is entered on the floor (NS-11), not
mirrored from NetSuite, so this quantity and the one WW later posts are
independent — do not run NS-06 and NS-12 against the same expected on-hand
figure without accounting for both.
**Covered live by** B5 — including the assertion that the receipt introduces no
item the purchase order never ordered.

## NS-07 — Receipt pushed at the webhook is rejected

**Replay** As NS-03 with `recordType: "item_receipt"`, then again with
`inventory_receipt`.
**Expected** `400 Unsupported recordType` for both. Documents the boundary
NS-06 relies on.
**Covered live by** C6.

## NS-08 — Redelivery and edits

**Replay** (a) Send the NS-04 body twice, unchanged.
(b) Send it again with `lastModified` moved forward.
(c) Send a body with **no** `lastModified` twice.
**Expected**
(a) Second answers `duplicate: true` with the **same** `jobId`; still one job row,
but **two** inbound payload logs — a redelivery is logged even though it is not
re-processed.
(b) A **new** `jobId`: a real edit re-queues.
(c) Second is also `duplicate: true` — the key falls back to a SHA-256 digest of
the body, so a retry of the identical body dedupes without a timestamp.
**Covered live by** C2, C3, C4, and the digest properties in
`netsuite-record-flows.test.ts`.

## NS-09 — Authentication and malformed bodies

**Replay** Wrong `X-Webhook-Secret`; no header at all; `GET`; a body with no
`externalId`; a body with `recordType` omitted; invalid JSON.
**Expected** `401`, `401`, `405`, `400 externalId is required`,
`400 Unsupported recordType: (missing)`, `400 Invalid JSON body`. No job rows
from any of them.
**Covered live by** C8, C9.

## NS-10 — Queue drain leaves the parked rows alone

**Warehouse Wizard** With the NS-03/NS-04 jobs sitting `queued`, run the drain:

```bash
curl -si -X POST "$WW_FUNCTIONS_URL/process-netsuite-queue" -H "X-Queue-Secret: $WW_QUEUE_SECRET"
```

**Expected** `200` with `deadLettered: 0`, and the `purchase_order` /
`sales_order` rows **still `queued`** afterwards. The worker claims only
`inventory_adjustment`; if it ever claims these, it treats them as a permanent
failure and destroys them. Also check `integration_dead_letters` is empty.
A `skipped` response naming `credentials_incomplete` or
`adjustment_account_not_configured` is a pass for this case — it means nothing
was claimed at all.
**Also** Drain with a wrong secret (`403`) and with no credential (`401`).
**Covered live by** D1–D3.

## NS-11 — Putaway enqueues an inventory adjustment

**Warehouse Wizard** Receive `WW-TEST-001` into the mapped warehouse, then
complete putaway so the balance goes `receiving` → `available`.
**Expected** One `integration_sync_jobs` row, `job_type = 'inventory_adjustment'`,
`status = 'queued'`, `idempotency_key = 'putaway-<balance id>'`, and a payload
carrying `netsuiteItemId`, `netsuiteLocationId`, `quantityDelta` and `memo`.
Complete putaway on the same balance row again: **no second job** (the key
conflicts and is ignored).
**Covered by** the trigger assertions in `netsuite-record-flows.test.ts`.

## NS-12 — The adjustment reaches NetSuite

**Warehouse Wizard** Run the drain from NS-10 (or wait for the 5-minute
`netsuite-queue` workflow, once its repository secrets exist).
**Expected** `succeeded: 1`. The job flips to `succeeded` with
`result.netsuiteId` set, and the outbound payload log holds the exact body:
`externalId`, `account`, `memo`, `inventory.items[]` — no wrapper keys.
**NetSuite** An inventory adjustment exists with external id
`ww-inventory-adjustment-putaway-<balance id>`, posting the same quantity at the
mapped location, and on-hand has moved by that amount.
**Watch** No `unitCost` is sent, so confirm the cost NetSuite applies to a
positive adjustment. Lot-numbered, serialised and bin-managed items need an
`inventoryDetail` subrecord that is **not** sent — those will fail here.
**Covered live by** E1.

## NS-13 — The adjustment cannot post twice

**Warehouse Wizard** Set the NS-12 job back to `queued` in SQL and drain again.
**Expected** `succeeded: 1` again, with `result.alreadyPosted = true` — the POST
is refused by NetSuite for the duplicate external id, the worker looks the record
up at `inventoryAdjustment/eid:<externalId>`, finds it and calls the job done.
**NetSuite** Still exactly **one** adjustment for that external id.
**Covered live by** E1's retry half.

## NS-14 — Unmapped product or warehouse enqueues nothing

**Warehouse Wizard** Receive and put away a product that has **no**
`external_record_links` item row (or into a warehouse with no location mapping).
**Expected** No `inventory_adjustment` job, no error, no toast. The trigger
no-ops so a client without NetSuite is unaffected. Same when the connection is
disabled.
**Covered by** the trigger assertions in `netsuite-record-flows.test.ts`.

## NS-15 — Missing configuration fails safe

**Warehouse Wizard** Clear the adjustment account in Settings, leave an
`inventory_adjustment` job queued, drain.
**Expected** `200 {"skipped":true,"reason":"adjustment_account_not_configured"}`,
the job still `queued`, nothing dead-lettered. Restore the account afterwards.
**Covered by** the guard-ordering assertion in `netsuite-record-flows.test.ts`.

---

## Results

| Case | Record | Run | Result | Notes |
|---|---|---|---|---|
| NS-01 | connection | | | |
| NS-02 | item | | | |
| NS-03 | purchase order | | | |
| NS-04 | sales order | | | |
| NS-05 | invoice | | | |
| NS-06 | item receipt (NetSuite side) | | | |
| NS-07 | item receipt (webhook) | | | |
| NS-08 | redelivery | | | |
| NS-09 | auth / malformed | | | |
| NS-10 | queue drain safety | | | |
| NS-11 | putaway enqueue | | | |
| NS-12 | adjustment posted | | | |
| NS-13 | adjustment retry | | | |
| NS-14 | unmapped no-op | | | |
| NS-15 | missing configuration | | | |

## What these tests cannot prove yet

- **No NetSuite-side trigger.** Until a SuiteScript User Event script posts to
  `netsuite-webhook`, NS-03…NS-09 test Warehouse Wizard's receiving end with
  real NetSuite data, not NetSuite's delivery of it. Retry behaviour, delivery
  ordering and the exact field names NetSuite would send remain unverified.
- **No order or invoice processing.** A parked `sales_order` job proves the
  record was captured, nothing more. There is no assertion that a NetSuite sales
  order becomes a pick, or that an invoice reconciles against a shipment,
  because no code does either.
- **Restricted item types.** Lot, serial and bin-managed items are out of scope
  for the outbound adjustment (no `inventoryDetail`), so NS-12 must be run with a
  plain stock item.
- **Adjustments only fire at putaway.** Picks, transfers and stock adjustments
  change `available_quantity` without enqueuing anything, by design. Do not
  expect NetSuite on-hand to track Warehouse Wizard after NS-12.

Clean-up, after a run against a shared project:

```sql
delete from integration_sync_jobs
 where idempotency_key like '%APITEST%' or idempotency_key like '%-apitest-%';
```
