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

## 5. Transfer orders vs trips and forward pick

**Status: proposed 2026-10-22, not yet agreed.** Decisions T1–T8 extend D2–D11 to NetSuite transfer orders (TOs) between Lower Estate, Pine and the new warehouse. The receiving side of a TO is Phase 1 (W2/W3b). This section covers the despatch side (W11) and how it shares the outbound flow.

### 5.1 What exists today

- The `transfers` feature (`src/features/transfers/transfers-core.ts`) works on **one pallet per transfer**. It debits the source when the transfer is *created*: the pallet goes `in_transit` and leaves its location before anyone has moved it. Departure needs a driver sign-off code, and receipt sets the pallet to `putaway` at the destination.
- There is no link to a NetSuite TO, no line numbers and no fulfillment id (research doc §10).
- Every WW warehouse maps to a different NetSuite location. So a WW transfer between two mapped warehouses changes NetSuite stock, but today nothing tells NetSuite.

### 5.2 Ownership model

**NetSuite owns transfer orders; WW executes them.** The TO is the document of record. It carries the approval, the transfer price, the in-transit accounting and the audit trail, none of which WW has or should copy. WW owns the physical work: which pallets are picked, the staging, the driver sign-off, the in-transit pallet record and putaway at the destination.

| Model | Verdict |
|---|---|
| WW only (today's flow, between mapped warehouses) | **Retired.** NetSuite stock goes wrong at both ends |
| NetSuite initiates, WW executes | **Default (Phase 2, W11).** Needs no new NetSuite permissions, and inventory control keeps approval |
| WW requests, NetSuite approves, WW executes | **Phase 3 addition (T9),** alongside bin-level replenishment (W9) |

The existing `transfers` feature becomes the execution layer under a TO:
- **several pallets per transfer** instead of one;
- each transfer linked to its TO and fulfillment;
- the source debited **at pick confirm**, not when the transfer is created.

Today's flow without a TO is kept only where NetSuite isn't involved (T8).

### 5.3 Decisions

| # | Topic | Proposal |
|---|---|---|
| T1 | Discovery | The D2 SuiteQL poll also reads TOs: `TrnfrOrd:B`, `:D` and `:E` where `location` is a mapped source location. They appear in the Orders inbox as type **Transfer**, next to SOs. TOs at `:E`/`:F` for a mapped destination stay in Receiving (Phase 1) |
| T2 | Trips | A TO is released onto a trip, the same as an SO. The same truck often carries customer orders and a Pine replenishment, so one load scan and one departure covers both. Trip suggestions group TOs by destination warehouse, not by customer zone |
| T3 | Pick source | TO lines are picked **from bulk as whole pallets** where the quantity allows, and from the forward-pick face only for the remainder. A transfer must not drain the faces that customer orders depend on |
| T4 | Replen demand | Only the forward-pick part of a TO line counts toward the D5 demand engine. Whole-pallet bulk picks add no forward-pick demand |
| T5 | Fulfillment | Same lifecycle as D3: TO → itemFulfillment transform at shipStatus **A** when the pick list completes, **B** at pack verify, **C** at departure. Shipped moves the value into Inventory In Transit in NetSuite |
| T6 | WW transfer record | One WW `transfers` row per TO fulfillment, created **when the pick list is released**. It holds the TO id (`external_record_id`) and, after T5, the fulfillment id. `transfer_lines` becomes **multi-pallet**: one row per pallet and quantity actually picked, each holding the TO line's `external_line_id` (orderLine) and `external_line_key` (lineuniquekey). `createTransferFlow` no longer debits the source when the transfer is created. Stock leaves the source bins at pick confirm, sits in the trip's `staging_load`, and becomes `in_transit` when the driver signs off at departure (the existing sign-off is kept). Cancelling before departure returns the picked pallets to stock and deletes the IF if one was created at A |
| T7 | Destination receipt | Receiving pre-fills from **the fulfillment**, not the TO (research doc §4). The receipt must match the despatch exactly. Short or damaged stock is received in full, then corrected with an `inventoryAdjustment` or a status change, following the Q-R1 policy |
| T8 | Transfers without a TO | WW cannot create a transfer between two warehouses mapped to **different** NetSuite locations. The New Transfer screen offers to request a TO instead (T9), or to pick an approved TO from the inbox. Transfers involving an unmapped warehouse, or two warehouses sharing one location, keep the flow with no TO, but move to the same multi-pallet, debit-at-pick model. `inventoryTransfer` (one step, with no in-transit stage) is not used, because it would show the stock at the destination before it arrives |
| T9 | WW transfer request (Phase 3) | A **Request transfer** action, offered by hand and by the W9 replenishment engine (e.g. "Pine forward pick is below min; Lower Estate bulk has stock"). It POSTs a `transferOrder` with `location`, `transferLocation`, lines and `externalId` `ww-to-request-<id>`, and `orderStatus` **A (Pending Approval)**. WW never approves its own requests. The request shows in WW as *Awaiting approval*. Once the D2/T1 poll sees the TO at `:B`, it enters the inbox and follows T2–T7. If rejected (`:C`), the requester is notified and the replenishment task re-raises the next time the min check runs. Needs NetSuite permission to create TOs and Jan to confirm the approval workflow (V10) |

### 5.4 Within-location moves

The D4 bulk → forward-pick replenishment moves stay in WW only and use the moves feature. NetSuite has no bins at these locations, so nothing is posted. If **Use Bins** is ever turned on (V1), these moves become `binTransfer` posts, and WW must also send `binNumber` on fulfillment lines.

### 5.5 Status mapping

| NetSuite TO | WW `transfers.status` | Trigger |
|---|---|---|
| `:A` Pending Approval (WW-raised, T9) | request shown as *Awaiting approval* (no `transfers` row yet) | Request posted |
| `:C` Rejected (WW-raised) | request closed, requester notified | Poll |
| `:B` Pending Fulfillment | (inbox only) | Poll |
| `:B`/`:D` + IF at A | `queued` → `in_progress` | Pick list complete |
| IF at B | `in_progress` | Pack verify |
| `:F` Pending Receipt + IF at C | `in_progress` (in transit) | Trip departure |
| `:G` Received | `completed` | Destination receipt posted |

## 6. Cycle-count freezes vs released trips and open Picked fulfillments

**Status: proposed 2026-10-22, not yet agreed.** These rules apply the freeze model in `docs/cycle-counts-architecture.md` (built in `src/features/cycle-counts/freeze-core.ts`) to slices D–F.

### 6.1 What each stage means for a count

| Where the stock is | WW state | NetSuite state | Counted by a cycle count? |
|---|---|---|---|
| In a bin, not allocated | `available_quantity` | Available | Yes |
| In a bin, on a pick task for a released trip | still in the bin | Available, committed to the SO | Yes, see C1–C3 |
| Picked, in a `staging_load` | Left the bin | On hand, **not** available (IF at A/B) | **No.** The pack and load scans verify it (C4) |
| Departed (`in_transit`) | Not in any bin | Shipped (SO) or In Transit (TO) | No |

The principle: a cycle count measures what is in **storage and forward-pick bins**. Stock already picked belongs to an open fulfillment, and the outbound scans are its count.

### 6.2 Decisions

| # | Case | Proposal |
|---|---|---|
| C1 | Creating a count on a bin with open pick tasks for a released trip | The count screen warns and lists the trips affected. If a trip departs within a configurable window (default **2 h**), the bin is left out of the count unless a Manager overrides. Otherwise the freeze goes ahead and C2 applies |
| C2 | Freeze lands on a bin with unconfirmed pick tasks | The tasks are reassigned to another source, using the existing pick-source reassignment (`20260730000001_pick_source_reassignment.sql`): another face, then bulk. With no source, the task is marked short (D10). Replenishment **into** a frozen face is blocked as well (moves/putaway `assertNotFrozen`), so the short stays until the count closes, and the trip can ship short |
| C3 | Pick confirmed while the count is being created | The freeze and its snapshot are taken **after** any pick confirm that commits first. The server-side `assertNotFrozen` decides the order, so a pick either lands before the snapshot (no variance) or is rejected (handset shows `FROZEN_BIN`, as built). Offline picks replayed after a freeze are rejected into the dead-letter queue |
| C4 | Staging locations | Zones with `is_staging` are **left out of count scope by default**. An audit count of a staging lane may be run, but its variances do not post an `inventoryAdjustment`. Each one raises a **trip exception** against the staged pick list, because NetSuite already holds that quantity under an open IF. To resolve it, re-pick, or PATCH the IF line down before Shipped, which returns the quantity to available in NetSuite. Only then may a bin adjustment be posted |
| C5 | Posting a variance while IFs are open at Picked | The adjustment is the WW **bin delta** (counted − expected for that bin), never a comparison with NetSuite on-hand. NetSuite on-hand still includes picked-not-shipped stock, so comparing with it would double-count. The W14 nightly reconciliation compares NetSuite `quantityonhand` with WW bins **+ staging + picked-not-shipped**, per location |
| C6 | Negative variance on a forward-pick face with open demand | Approving the variance raises an urgent replenishment for that face (D5). If it pushes the location below committed quantity, NetSuite recommits on its own, and the next D2 poll shrinks the affected pick lists |
| C7 | Freeze expiry with a trip waiting | Auto-expiry (default 4 h) un-holds the stock and alerts the supervisor, as built. The trip board shows faces that are frozen or awaiting count, so dispatch can see why a trip is short |
| C8 | Transfers | `in_transit` pallets have no bin, so no count covers them. At the destination, putaway into a frozen bin is bounced (built), and the pallet waits in receiving staging |

### 6.3 Prerequisite fix in the freeze code

`releaseCycleCountFreezes` moves **all** `held_quantity` back to available when a freeze ends. Stock that was already on hold for another reason, such as quality or damage, is released along with it. A frozen face sitting next to picking makes this more likely to matter. Before slice D, the freeze should record how much it moved into held (per balance and per pallet) and release only that amount.

### 6.4 To verify

- **V6** — Can Simplex accept the 2-hour departure window in C1, or should counts on faces with released trips be blocked outright?
- **V7** — Can a PATCH reduce an IF line's quantity at Picked/Packed through REST (C4), or must the IF be deleted and recreated?
- **V8** — Do the trucks to Pine and Lower Estate share trips with customer deliveries in practice (T2)?
- **V9** — Are there Simplex-to-Simplex moves that go through NetSuite inventory transfers today rather than TOs (T8)?
- **V10** — Can the integration role create TOs, does a TO created at Pending Approval follow Simplex's existing approval workflow, and who approves WW-raised requests (T9)?

## 7. Returns

**Status: proposed 2026-10-26, not yet agreed.** Decisions R1–R14 cover customer returns (NetSuite RMAs), deliveries refused at the door, and vendor returns. The NetSuite record detail is in the research doc §5. Returns are received through the Phase 1 receiving flow; vendor returns ship through the outbound flow in §2–§3.

### 7.1 What exists today

- `return_authorizations` is **header only**: `rma_number`, `client_id`, `warehouse_id`, a `task_status`, one `disposition` for the whole RMA, and `reason`. It has no lines, no NetSuite id and no source order. `client_id` is the wrong party, because clients own stock and RMAs come from customers (D1).
- `quality_disposition` is `pending`, `pass`, `fail`, `hold`, `release`, `scrap`, `return_to_vendor`. `quality_inspections` links a disposition to a pallet or receipt.
- `orders.order_type` is free text, default `'sales'`. Vendor returns have no WW record at all.
- **Sandbox (2026-10-21 discovery):** only two RMAs exist, one at `RtnAuth:A` and one at `:G` (Refunded), plus the test record RMA07. No `VendAuth` rows came back. Inventory Status has only "Good". 332 inventory items are serialised. The restock field id on RMA receipt lines is still open from J10.
- Delivery exceptions are already flagged on the SO/IF: `custbody_ee_customer_refused`, `_damaged_item`, `_wrong_items`, `_missing_items` and the rest (§1).

### 7.2 Ownership model

**NetSuite owns the RMA; WW receives it and decides the disposition of each line.** The RMA carries approval, price, restocking fees and the credit, none of which WW should copy. The credit memo or cash refund stays with finance (research doc §5.1). WW never creates or approves an RMA. It owns the physical work: counting what came back, the disposition per line, quarantine, putaway and scrap.

A **refused delivery is not a return.** The customer never accepted the goods, they come back on the same truck, and in most cases no credit is due because nothing was billed. WW handles it as a reversal of its own fulfillment (R7). It becomes an RMA only once the SO has been billed (R8).

### 7.3 Customer returns (RMA)

| # | Topic | Proposal |
|---|---|---|
| R1 | Discovery | The D2 SuiteQL poll also reads `RtnAuth:B`, `:D` and `:E` where the line location is a mapped location. They appear in **Receiving** as type **Return**, not in the Orders inbox. The W2 number lookup is extended to RMAs, so the dock can key or scan the RMA number on the customer's paperwork. `:A` (Pending Approval) is never shown, so goods that arrive without an approved RMA go to R5 |
| R2 | Data model | `return_authorizations` gains `external_record_id`, `customer_id` (FK `customers`), the source SO id and number, and the NetSuite status. New `return_authorization_lines`: `external_line_id` (`line`) and the `<internal id>:<line>` key built by the lookup (J10), product, NetSuite unit id, expected and received quantity in **base units** (D9), reason code, and lot/serial. The header `disposition` becomes a summary derived from the lines. `client_id` stays, nullable. All changes are additive |
| R3 | Receipt | A return is received as `receipts.receipt_type = 'return'`, with each `receipt_line` linked to its RMA line. The operator counts each line and gives it a disposition, and may split one line across several (e.g. 8 restock, 2 scrap). Posting uses `returnAuthorization/{id}/!transform/itemReceipt`: each line sends location, quantity converted to the RMA line's unit, and the restock flag. Serialised items carry their serial numbers in inventory detail. Idempotency uses `custbody_spx_ww_external_ref`, as Phase 1 receipts do. If one receipt cannot hold the same RMA line twice with different restock flags (V12), WW posts one receipt per disposition group |
| R4 | Disposition | Per line, mapped as in 7.4. **Restock** goes through normal putaway, and the stock can feed forward-pick replenishment (D5). **Hold** goes into a returns-quarantine zone with `held_quantity` and a `quality_inspections` row, and is never pickable until released. **Scrap** posts restock ✗: no pallet is created in WW, and a reason and photo are kept. **Return to vendor** is held like Hold until a vendor return picks it (R12) |
| R5 | Over, short and unexpected | WW never receives more than the open RMA quantity. Extra or unlisted items, and goods that arrive with no approved RMA, are booked into returns staging as an **unexpected return** exception with no NetSuite posting. Customer service amends or approves the RMA in NetSuite, and the next poll lets the dock receive against it without a recount. A short receipt leaves the RMA at `:D`/`:E` |
| R6 | Who disposes | Any receiver may choose Restock or Hold. Scrap and Return to vendor need a Supervisor or a completed inspection, because both are written off or leave the business |

### 7.4 Disposition mapping

| WW disposition | `quality_disposition` | NetSuite receipt line | WW stock afterwards |
|---|---|---|---|
| Restock | `pass` / `release` | Restock ✓, status Good | Available, normal putaway |
| Hold for inspection | `pending` / `hold` | Restock ✓ into a non-available status ("Quarantine") **if one is created (V13)**. Until then, restock ✓ as Good | Held in the quarantine zone. Inspection then releases it (status change to Good, if quarantined) or scraps it (`inventoryAdjustment` out) |
| Scrap | `fail` / `scrap` | Restock ✗ (written off to expense) | None |
| Return to vendor | `return_to_vendor` | Restock ✓, as Hold | Held, reserved for a VRMA |

Without a Quarantine status, NetSuite counts held returns as available and can commit them to SOs. WW will not pick them, so those SO lines short-pick (D10) until the hold clears. That gap is why V13 matters.

### 7.5 Refused deliveries

| # | Case | Proposal |
|---|---|---|
| R7 | Refused at the door, SO not yet billed | The driver records the refusal and reason in the POD (slice G), which writes `custbody_ee_customer_refused` and the reason fields. When the trip closes, the dock scans the refused cartons back in at a **trip check-in** step, before anything is put away. WW then reduces its own fulfillment: it PATCHes the IF lines down, or deletes the IF if the whole order was refused (V14). The quantity goes back to available and committed in NetSuite, the SO returns to Pending Fulfillment or Partially Fulfilled, and it reappears in the Orders inbox to be redelivered or cancelled by customer service. No RMA and no credit memo are needed. Cartons scanned back as damaged (`_damaged_item`/`_damaged_box`) go to Hold, and the inspection result posts an `inventoryAdjustment` or status change |
| R8 | Refused or returned after billing | Once the SO line is billed, the IF can no longer be reduced below the billed quantity. WW raises a **refusal needs RMA** exception to customer service, and the goods wait in returns staging, held. When the RMA appears through the R1 poll, receiving is pre-matched to the held stock and only needs confirming. A customer who sends goods back days later is always this case |
| R9 | Wrong or missing items | `_missing_items` is a short delivery, not a return: nothing comes back, and the SO stays open for the missing quantity (D10). `_wrong_items`: the wrong item comes back through R7 (or R8), and the right item is a new pick against the still-open SO line |
| R10 | Trip close | A trip cannot close while refused cartons from the POD are neither scanned back nor marked lost. Lost cartons raise a supervisor exception; WW does not adjust NetSuite for them on its own |

### 7.6 Vendor returns

| # | Topic | Proposal |
|---|---|---|
| R11 | Order type | Vendor returns become `orders.order_type = 'vendor_return'`, sourced from a NetSuite `vendorReturnAuthorization` (VRMA). NetSuite owns the VRMA (approval, vendor credit); WW picks and ships it. The D2 poll reads approved VRMAs (`VendAuth:B` Pending Return and `:D` Partially Returned, codes **[Verify]**) at mapped locations, and they appear in the Orders inbox as type **Vendor return** |
| R12 | Pick source | VRMA lines pick **held stock first**: pallets with the `return_to_vendor` disposition, then other held stock for that item, then bulk. They never pick from a forward-pick face and add no D5 demand (as T4). This is the one pick type that may take held stock |
| R13 | Shipping | `vendorReturnAuthorization/{id}/!transform/itemFulfillment`, on the same A/B/C lifecycle as D3. If the vendor's own carrier collects, the order goes to a **dock collection** instead of a trip: Picking at pick complete, then Packed and Shipped together at the collection scan, with the carrier's name and signature |
| R14 | Raising a vendor return | WW does not create VRMAs. A `return_to_vendor` disposition notifies purchasing with the item, quantity, supplier (from the receipt or product) and the inspection notes, and purchasing raises the VRMA in NetSuite. A WW-raised request at Pending Approval, as T9 does for TOs, is left for Phase 3 |

### 7.7 Status mapping

| NetSuite record | WW | Trigger |
|---|---|---|
| `RtnAuth:A` Pending Approval | (not shown) | — |
| `RtnAuth:B` Pending Receipt | Return in Receiving, `queued` | Poll |
| `RtnAuth:D`/`:E` Partially Received | `in_progress` | Receipt posted, lines still open |
| `RtnAuth:F` Pending Refund | `completed` | Last line received |
| `RtnAuth:G` Refunded / `:H` Closed / `:C` Cancelled | closed, read only | Poll |
| SO IF reduced or deleted after refusal | pick list reopened, SO back in the inbox | Trip check-in (R7) |
| `VendAuth:B` Pending Return | Vendor return in the Orders inbox | Poll |
| VRMA IF at A / B / C | `in_progress` → shipped | Pick, pack, collection or departure |

### 7.8 Build placement

| Slice | Contents | Depends on |
|---|---|---|
| H | RMA poll and lookup, `return_authorization_lines`, return receipt with per-line disposition, quarantine zone, RMA receipt posting | B, Phase 1 receipt posting (W3) |
| G+ | Trip check-in of refused cartons, IF reduce/delete, refusal needs RMA exception | G |
| I | `vendor_return` order type, VRMA poll, held-stock pick source, dock collection, VRMA fulfillment | E, H |

### 7.9 To verify

- **V11** — Is **Advanced Receiving** on? Without it, receipt and refund happen together on the credit memo, and WW cannot post an RMA receipt on its own (research doc §5.1). The sandbox has an RMA at Refunded but none at Pending Refund, so this is not yet shown.
- **V12** — What is the restock field id on an RMA receipt line (open since J10)? Can one receipt carry the same RMA line twice with different restock flags, or does a split disposition need two receipts?
- **V13** — Will Simplex add a "Quarantine" (or "Damaged") inventory status, so held returns are not committed to SOs? Is the Inventory Status feature actually on, or does the record exist with only "Good"?
- **V14** — Can REST reduce or delete an IF that is already at Shipped (extends V7)? When is an SO billed after shipping: a scheduled Bill Sales Orders run, by hand, or straight away? That decides how long the R7 window stays open, and depends on V4.
- **V15** — How are refusals handled today? Does the "ERP" driver app (V3) or a script create an RMA, or does someone edit the fulfillment by hand? Only two RMAs in the sandbox suggests refusals are not RMA'd.
- **V16** — Are VRMAs used at all, exposed through REST, and readable by the integration role (no `VendAuth` rows came back)? Are vendor returns in scope now or later (research doc §12 Q9)?
- **V17** — For the 332 serialised items, must the returned serial number match one shipped to that customer, and should WW check it?
- **V18** — Does Simplex want WW's return reason codes written to an RMA field, and who may approve Scrap (R6)?

## 8. Office-planned dispatch (sandbox findings 2026-10-30)

**Status: agreed with Russell 2026-10-30.** The research behind this section is a read-only SuiteQL pass over the `_SB1` sandbox (fulfillments dated 1 Sep – 28 Oct 2026). The flow chart is the "Simplex Order-to-Dispatch Flow" artifact.

### 8.1 What the sandbox showed

- **The office plans every trip.** The Simplex Fulfill Orders page (`SL_Bulk_Fulfill_Orders`, `customscript1118`) lists SOs and TOs together. It creates the IF at Picked with `custbody_simplex_picked_by` (list `customlist_spx_pickers`), `custbody_truck` (list `customlist_truck_fulfillment`, named by driver, plus "Pending" and "Pine" placeholders) and `custbody_simplex_trip_number` (free text). Submit and Print calls `SL_print_picking_tickets` (`customscript1120`). Truck and picker are set on about 97% of IFs.
- **The trip number is the run of the day.** Trip 1 appears on 21 dates and trip 2 on 19, so a trip is keyed by date + truck + trip number.
- **Packed is never used.** IF status is Picked (73) or Shipped (1,954), never Packed. 73 IFs have been stuck at Picked for 33 days on average.
- **Shorts become second deliveries.** 88 SOs needed 2–3 IFs, and 450 SOs are Partially Fulfilled (48 days on average).
- **The invoice follows the truck.** Invoices are raised minutes after Shipped, and 35 orders were invoiced before shipping.
- **The KPI timestamps are already scripted.** The SPX Operations KPI – Event Capture user event (SO, IF, invoice) writes `custbody_spx_kpi_*` and `customrecord_spx_order_kpi`. Windows: ordered 7:30–10:30, deliver the same day. Ordered 10:30–1:30, ship by 9:30 the next day. Ordered 1:30–4:30, ship by 12:30 the next day. 337 orders met the KPI and 829 missed it.
- **The sandbox has no driver data.** No IF has a signature or `custbody_ee_*` exception flag, though the ERP app's fields exist (`custbody_erp_signature_captured`, `_signature_image`, `_eq_signature_date`, `custbody_erp_eq_delivery_image_1..3`).

### 8.2 Decisions

| # | Topic | Decision |
|---|---|---|
| O1 | Who plans | The office keeps planning in NetSuite on the Fulfill Orders page. WW does not suggest or build trips. It reads the IFs that page creates and gives floor staff the pick, pack, load and depart tasks. This replaces D3's "WW creates the IF" and D7's trip suggestion |
| O2 | Discovery | The D2 poll also reads IFs at Picked, with picker, truck and trip number. The Orders inbox shows SOs and TOs together, as the Fulfill Orders page does (T1) |
| O3 | Trip key | Trip = IF date + `custbody_truck` + `custbody_simplex_trip_number` |
| O4 | KPI times | WW stamps the real pick, pack and departure times. Whether WW writes `custbody_spx_kpi_*` directly or only moves the IF status, and lets the KPI script stamp the time, is confirmed with whoever owns that script (V19) |
| O5 | Driver app | The ERP driver app stays. It looks up the IF and reads trip and truck from NetSuite. WW reads its signature and exception fields back |
| O6 | Refusals | Refusals go through returns (§7, R1–R6: RMA, return receipt, credit memo), because the invoice is normally raised at Shipped. R7 (reducing the IF) applies only when the order was not yet invoiced |

### 8.3 To verify

- **V19** — Does the SPX Operations KPI script accept KPI times written by WW?
- **V20** — How does the ERP app find its IFs (truck, trip or driver login)? Check in production, since the sandbox has no driver data.
- **V21** — What does Simplex Daily Deliveries Setup Cleanup reset each day? What does the "Pending" truck mean?
- **V22** — Who clears IFs stuck at Picked? Should WW flag them on the trip board?
