# NetSuite outbound: sales order picking, forward pick, replenishment, customers, packaging

Design agreed 2026-10-16 after a live read-only probe of the NetSuite sandbox (`9738806-sb1`).
Companion to `docs/netsuite-receiving-returns-sales-research.md` §7. Prototype:
https://claude.ai/artifact/AFsdBAVXf44pqyQmXju3o1

## 1. What the sandbox showed

- **604 open SOs** (`SalesOrd:B` 140, `:D` 450, `:E` 14). There are 8,627 open lines at LOC-01 Lower Estate (id 3) and 237 at LOC-02 Pine Showroom (id 4).
- **Item fulfillments:** 63 at `ItemShip:A` (Picking) and 1,953 at `:C` (Shipped). Pick, Pack and Ship is on. SOs reach Pending Billing separately from invoicing, which implies Advanced Shipping is on (V4).
- **Simplex's existing staged process,** held in custom fields:
  - `custbody_picking_ticket_printed`, `custbody_picking_ticket_memo`, `custbody_qr_b64` (the ticket QR, which holds the SO internal id)
  - `custbody_simplex_picked_by` → `customlist_spx_pickers` (11 pickers)
  - `custbody_truck` → `customlist_truck_fulfillment` (20 trucks/drivers), plus `custbody_simplex_trip_number`
  - IF KPIs: `custbody_spx_kpi_if_created_at`, `custbody_spx_kpi_picked_at`
  - Delivery: `custbody_erp_signature_captured`, plus `custbody_ee_customer_refused`, `_customer_unavailable`, `_damaged_box`, `_damaged_item`, `_missing_items`, `_wrong_items` and `_other_reason`
- **Not found by the integration role:** `wave`, `picktask` and `bin` (V1). `inventorystatus` exists, with only "Good". IF inventory detail carries `licensePlateNumber` (V2).
- **Units of measure:** about 350 `unitstype` records are packaging recipes, e.g. `BL-6BG`, `CS-5000EA`, `BL-5BAG-12EA`. Many items are stocked in CASE/BALE and sold in EACH/PACK/BAG, so NetSuite on-hand shows fractions (e.g. 192.1). About 15% of recent SO lines use a unit smaller than the stock unit.
- **Customers:** 3,581 active. `custentity_simplex_zone` holds the delivery zone (North, South, East, West, Central). `oncredithold` and the `custentity_spx_credit_*` fields hold credit flags.

## 2. Decisions

| # | Topic | Decision |
|---|---|---|
| D1 | Customers | New `customers` table (not `clients`; clients own stock). Load all active customers, then a nightly delta and on-demand fetch for unknown customers |
| D2 | SO discovery | SuiteQL poll every 2–5 min (status B/D/E, mapped locations, `lastmodifieddate` cursor), plus a QR scan lookup of the picking ticket |
| D3 | Fulfillment owner | WW creates the IF via the SO → itemFulfillment transform at shipStatus A, writing picker, truck, trip and KPI timestamps. It PATCHes to B at pack and to C at departure |
| D4 | Forward pick | `zones.is_forward_pick` + `pick_faces` (product, pick unit, min/max in base units). Bulk → forward-pick moves stay inside WW, with no NetSuite posting (same location, no bins) |
| D5 | Replen signal | Min/max **and** demand from released trips, plus picker "short" raising an urgent task. Shown as a queue, a Command Center tile and a push notification to the forklift role |
| D6 | Packaging | Mirror NetSuite `unitstype`/`unitstypeuom` into `uom_types`/`uom_units`. A curated `package_types` master normalises spellings. `product_packaging_profiles.package_type` becomes an FK |
| D7 | Grouping | Trip/truck = one wave. One pick list per SO, staged per trip into a `staging_load`. Zone is used to suggest trips |
| D8 | Release rules | Only committed quantity is pickable. Customers on credit hold are blocked |
| D9 | Quantity unit | WW holds integer **base units** and converts to the SO line unit only when posting |
| D10 | Short pick | Raise an urgent replen. If unresolved when the trip closes, ship short and the SO stays Partially Fulfilled |
| D11 | Scope | Pick, then pack scan-verify (B), load/dispatch (C), and delivery POD write-back |

## 3. Build slices

| Slice | Contents | Depends on |
|---|---|---|
| A | package_types, uom mirror, product unit backfill, packaging-profile FK | none |
| B | customers table, import + delta, Customers page | none |
| C | SO poll + QR lookup, Orders inbox with credit gate and committed qty | A, B |
| D | Forward-pick zone, pick faces, min/max + demand engine, replen queue, Command Center tile | A |
| E | Trip board, pick lists, handset, short → urgent replen, IF at Picking | C, D |
| F | Pack scan-verify (Packed), load scan, depart (Shipped) | E |
| G | Driver POD and signature/exception write-back | F |

Schema changes are additive only (see the prototype's "Data model & build" tab). Every NetSuite-sourced line stores `external_line_id` (orderLine) and `external_line_key` (lineuniquekey).

## 4. To verify before slice E

- **V1** — `wave`/`picktask`/`bin` "not found": is that a role permission or a disabled feature? This decides whether NetSuite WMS competes for picks and whether IF lines need `binNumber`.
- **V2** — Is the IF `licensePlateNumber` NetSuite WMS LPN, and must WW send it?
- **V3** — Which script sets the KPI timestamps? Does another app (the "ERP" driver app?) already write the `custbody_ee_*` and signature fields?
- **V4** — An admin must confirm Advanced Shipping is on. If it is off, every IF also creates an invoice.
- **V5** — Who prints the picking ticket after WW releases orders?
