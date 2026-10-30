# NetSuite outbound: sales order picking, forward pick, replenishment, customers, packaging

This document uses ASD-STE100 Simplified Technical English. Sentences are short and use the active voice. Each sentence has one topic. Technical names (record types, field ids, tables and statuses) stay in their usual form.

We agreed this design on 2026-10-16. Before that, we did a read-only probe of the NetSuite sandbox (`9738806-sb1`).
Read it together with `docs/netsuite-receiving-returns-sales-research.md` §7. The prototype is at
https://claude.ai/artifact/AFsdBAVXf44pqyQmXju3o1

## 1. What the sandbox showed

- **Open SOs:** there are 604 open SOs (`SalesOrd:B` 140, `:D` 450, `:E` 14). LOC-01 Lower Estate (id 3) has 8,627 open lines. LOC-02 Pine Showroom (id 4) has 237 open lines.
- **Item fulfillments (IFs):** 63 IFs are at `ItemShip:A` (Picking). 1,953 IFs are at `:C` (Shipped). Pick, Pack and Ship is on. SOs go to Pending Billing separately from invoicing. Thus, Advanced Shipping is probably on (V4).
- **Simplex's staged process:** Simplex keeps its process in these custom fields:
  - `custbody_picking_ticket_printed`, `custbody_picking_ticket_memo` and `custbody_qr_b64`. The QR on the ticket holds the SO internal id.
  - `custbody_simplex_picked_by` → `customlist_spx_pickers` (11 pickers).
  - `custbody_truck` → `customlist_truck_fulfillment` (20 trucks or drivers), and `custbody_simplex_trip_number`.
  - IF KPIs: `custbody_spx_kpi_if_created_at` and `custbody_spx_kpi_picked_at`.
  - Delivery: `custbody_erp_signature_captured`, and `custbody_ee_customer_refused`, `_customer_unavailable`, `_damaged_box`, `_damaged_item`, `_missing_items`, `_wrong_items` and `_other_reason`.
- **Records that the integration role cannot find:** `wave`, `picktask` and `bin` (V1). `inventorystatus` exists, but it has only "Good". IF inventory detail has a `licensePlateNumber` (V2).
- **Units of measure:** approximately 350 `unitstype` records are packaging recipes, for example `BL-6BG`, `CS-5000EA` and `BL-5BAG-12EA`. Simplex stocks many items in CASE or BALE and sells them in EACH, PACK or BAG. Thus, NetSuite on-hand shows fractions (for example, 192.1). Approximately 15% of recent SO lines use a unit that is smaller than the stock unit.
- **Customers:** 3,581 customers are active. `custentity_simplex_zone` holds the delivery zone (North, South, East, West or Central). `oncredithold` and the `custentity_spx_credit_*` fields hold the credit flags.

## 2. Decisions

| # | Topic | Decision |
|---|---|---|
| D1 | Customers | Make a new `customers` table. Do not use `clients`, because clients own stock. Load all active customers first. Then load the changes each night. Get an unknown customer when WW needs it |
| D2 | SO discovery | Do a SuiteQL poll each 2–5 minutes. The poll reads status B, D and E at mapped locations, and uses a `lastmodifieddate` cursor. Also, let the operator scan the QR on the picking ticket to find the SO |
| D3 | Fulfillment owner | WW makes the IF with the SO → itemFulfillment transform at shipStatus A. WW writes the picker, truck, trip and KPI timestamps. WW changes the IF to B at pack and to C at departure. **O1 replaces this decision** |
| D4 | Forward pick | Use `zones.is_forward_pick` and `pick_faces` (product, pick unit, and min/max in base units). Moves from bulk to forward pick stay in WW. WW does not post them to NetSuite, because the location is the same and there are no bins |
| D5 | Replen signal | Use min/max **and** the demand from released trips. When a picker reports "short", WW makes an urgent task. WW shows the tasks in a queue, on a Command Center tile and in a push notification to the forklift role |
| D6 | Packaging | Copy NetSuite `unitstype`/`unitstypeuom` into `uom_types`/`uom_units`. A curated `package_types` master makes the spellings the same. `product_packaging_profiles.package_type` becomes an FK |
| D7 | Grouping | One trip or truck is one wave. Each SO has one pick list. WW stages the pick lists for each trip into a `staging_load`. WW uses the zone to suggest trips. **O1 replaces the trip suggestion** |
| D8 | Release rules | Operators can pick only the committed quantity. WW blocks customers on credit hold |
| D9 | Quantity unit | WW keeps quantities as integer **base units**. WW changes them to the SO line unit only when it posts |
| D10 | Short pick | Make an urgent replen task. If the short is still open when the trip closes, ship short. The SO then stays Partially Fulfilled |
| D11 | Scope | Pick, pack scan-verify (B), load and dispatch (C), and write the proof of delivery back to NetSuite |

## 3. Build slices

| Slice | Contents | Depends on |
|---|---|---|
| A | package_types, uom copy, product unit backfill, packaging-profile FK | none |
| B | customers table, import and changes, Customers page | none |
| C | SO poll and QR lookup, Orders inbox with credit gate and committed quantity | A, B |
| D | Forward-pick zone, pick faces, min/max and demand engine, replen queue, Command Center tile | A |
| E | Trip board, pick lists, handset, short → urgent replen, IF at Picking | C, D |
| F | Pack scan-verify (Packed), load scan, depart (Shipped) | E |
| G | Driver proof of delivery, and signature and exception write-back | F |

All schema changes only add to the schema. Refer to the "Data model & build" tab of the prototype. Each line that comes from NetSuite keeps `external_line_id` (orderLine) and `external_line_key` (lineuniquekey).

## 4. To verify before slice E

- **V1** — The integration role cannot find `wave`, `picktask` or `bin`. Is the cause a role permission or a feature that is off? The answer tells us if NetSuite WMS also controls picks. It also tells us if IF lines need `binNumber`.
- **V2** — Is the IF `licensePlateNumber` a NetSuite WMS LPN? Must WW send it?
- **V3** — Which script sets the KPI timestamps? Does a different app (possibly the "ERP" driver app) write the `custbody_ee_*` and signature fields?
- **V4** — An admin must make sure that Advanced Shipping is on. If it is off, each IF also makes an invoice.
- **V5** — After WW releases orders, who prints the picking ticket?

## 5. Transfer orders, trips and forward pick

**Status: proposed on 2026-10-22. Not agreed.** Decisions T1–T8 apply D2–D11 to NetSuite transfer orders (TOs). These TOs move stock between Lower Estate, Pine and the new warehouse. The receiving side of a TO is Phase 1 (W2/W3b). This section is about the despatch side (W11). It also shows how the despatch side uses the outbound flow.

### 5.1 What exists today

- The `transfers` feature (`src/features/transfers/transfers-core.ts`) moves **one pallet per transfer**. It removes the stock from the source when an operator *creates* the transfer. The pallet goes to `in_transit` and leaves its location before a person moves it. The driver must give a sign-off code at departure. The receipt sets the pallet to `putaway` at the destination.
- There is no link to a NetSuite TO. There are no line numbers and no fulfillment id (research doc §10).
- Each WW warehouse has a different NetSuite location. Thus, a WW transfer between two mapped warehouses changes NetSuite stock. Today, nothing tells NetSuite about the change.

### 5.2 Ownership model

**NetSuite owns transfer orders. WW does the physical work.** The TO is the document of record. It holds the approval, the transfer price, the in-transit accounting and the audit trail. WW does not have these data and must not copy them. WW owns the physical work: the pallets to pick, the staging, the driver sign-off, the in-transit pallet record and the putaway at the destination.

| Model | Result |
|---|---|
| WW only (the flow today, between mapped warehouses) | **Stopped.** NetSuite stock becomes incorrect at the two ends |
| NetSuite starts the TO, WW does the work | **Default (Phase 2, W11).** This model needs no new NetSuite permissions. Inventory control keeps the approval |
| WW requests, NetSuite approves, WW does the work | **Added in Phase 3 (T9),** together with bin-level replenishment (W9) |

The `transfers` feature becomes the layer that does the work for a TO:
- A transfer can have **many pallets**, not only one.
- Each transfer has a link to its TO and its fulfillment.
- WW removes the stock from the source **when the operator confirms the pick**, not when the operator creates the transfer.

WW keeps the flow without a TO only where NetSuite is not involved (T8).

### 5.3 Decisions

| # | Topic | Proposal |
|---|---|---|
| T1 | Discovery | The D2 SuiteQL poll also reads TOs at `TrnfrOrd:B`, `:D` and `:E` where `location` is a mapped source location. The Orders inbox shows them as type **Transfer**, together with SOs. TOs at `:E`/`:F` for a mapped destination stay in Receiving (Phase 1) |
| T2 | Trips | The office releases a TO onto a trip, the same as an SO. One truck often carries customer orders and a Pine replenishment. Thus, one load scan and one departure are sufficient for the two. Trip suggestions put TOs together by destination warehouse, not by customer zone |
| T3 | Pick source | Pick TO lines **from bulk as full pallets** when the quantity lets you. Pick only the remainder from the forward-pick face. A transfer must not empty the faces that customer orders need |
| T4 | Replen demand | Only the forward-pick part of a TO line adds to the D5 demand engine. Full-pallet picks from bulk add no forward-pick demand |
| T5 | Fulfillment | The life cycle is the same as D3. WW makes the TO → itemFulfillment transform at shipStatus **A** when the pick list is complete. WW sets **B** at pack verify and **C** at departure. At Shipped, NetSuite moves the value into Inventory In Transit |
| T6 | WW transfer record | WW makes one `transfers` row for each TO fulfillment **when the office releases the pick list**. The row holds the TO id (`external_record_id`). After T5, it also holds the fulfillment id. `transfer_lines` can hold **many pallets**: one row for each pallet and quantity that the operator picks. Each row holds the TO line's `external_line_id` (orderLine) and `external_line_key` (lineuniquekey). `createTransferFlow` does not remove stock from the source when the operator creates the transfer. The stock leaves the source bins at pick confirm. It stays in the trip's `staging_load`. It becomes `in_transit` when the driver signs off at departure (WW keeps this sign-off). If an operator cancels before departure, WW puts the picked pallets back into stock. WW also deletes the IF if it made one at A |
| T7 | Destination receipt | Receiving fills its lines from **the fulfillment**, not from the TO (research doc §4). The receipt must be the same as the despatch. Receive short or damaged stock in full. Then correct it with an `inventoryAdjustment` or a status change, as the Q-R1 policy tells |
| T8 | Transfers without a TO | WW cannot make a transfer between two warehouses that have **different** NetSuite locations. The New Transfer screen lets the operator request a TO (T9) or select an approved TO from the inbox. Some transfers use an unmapped warehouse, or two warehouses with the same location. These transfers keep the flow without a TO. But they also use the many-pallet model, and remove stock at pick. WW does not use `inventoryTransfer`, because it has no in-transit step. It would show the stock at the destination before the stock arrives |
| T9 | WW transfer request (Phase 3) | Add a **Request transfer** action. An operator can use it, and the W9 replenishment engine can suggest it (for example, "Pine forward pick is below min, and Lower Estate bulk has stock"). The action POSTs a `transferOrder` with `location`, `transferLocation`, the lines, `externalId` `ww-to-request-<id>` and `orderStatus` **A (Pending Approval)**. WW never approves its own requests. WW shows the request as *Awaiting approval*. When the D2/T1 poll finds the TO at `:B`, the TO goes into the inbox and follows T2–T7. If NetSuite rejects it (`:C`), WW tells the requester. The replenishment task then starts again at the next min check. This needs NetSuite permission to make TOs. Jan must confirm the approval workflow (V10) |

### 5.4 Moves in one location

The D4 moves from bulk to forward pick stay only in WW. They use the moves feature. NetSuite has no bins at these locations, so WW posts nothing. If an admin sets **Use Bins** to on (V1), these moves become `binTransfer` posts. WW must then also send `binNumber` on fulfillment lines.

### 5.5 Status mapping

| NetSuite TO | WW `transfers.status` | Trigger |
|---|---|---|
| `:A` Pending Approval (WW request, T9) | WW shows the request as *Awaiting approval* (no `transfers` row yet) | WW posts the request |
| `:C` Rejected (WW request) | WW closes the request and tells the requester | Poll |
| `:B` Pending Fulfillment | (inbox only) | Poll |
| `:B`/`:D` + IF at A | `queued` → `in_progress` | The pick list is complete |
| IF at B | `in_progress` | Pack verify |
| `:F` Pending Receipt + IF at C | `in_progress` (in transit) | The trip departs |
| `:G` Received | `completed` | WW posts the destination receipt |

## 6. Cycle-count freezes, released trips and open Picked fulfillments

**Status: proposed on 2026-10-22. Not agreed.** These rules apply the freeze model to slices D–F. The model is in `docs/cycle-counts-architecture.md`. The code is in `src/features/cycle-counts/freeze-core.ts`.

### 6.1 What each stage means for a count

| Where the stock is | WW state | NetSuite state | Does a cycle count include it? |
|---|---|---|---|
| In a bin, not allocated | `available_quantity` | Available | Yes |
| In a bin, on a pick task for a released trip | Still in the bin | Available, committed to the SO | Yes. Refer to C1–C3 |
| Picked, in a `staging_load` | Not in the bin | On hand, **not** available (IF at A/B) | **No.** The pack and load scans count it (C4) |
| Departed (`in_transit`) | Not in a bin | Shipped (SO) or In Transit (TO) | No |

The rule: a cycle count measures the stock in **storage bins and forward-pick bins**. Picked stock is part of an open fulfillment. The outbound scans are its count.

### 6.2 Decisions

| # | Case | Proposal |
|---|---|---|
| C1 | A count is made on a bin that has open pick tasks for a released trip | The count screen shows a warning and lists the trips. If a trip departs in a set time (default **2 hours**), the count does not include the bin, unless a Manager overrides. If not, the freeze starts and C2 applies |
| C2 | A freeze starts on a bin that has pick tasks that are not confirmed | WW gives the tasks to a different source. It uses the pick-source reassignment that exists (`20260730000001_pick_source_reassignment.sql`): first a different face, then bulk. If there is no source, WW marks the task short (D10). WW also blocks replenishment **into** a frozen face (moves/putaway `assertNotFrozen`). Thus, the short stays until the count closes, and the trip can ship short |
| C3 | An operator confirms a pick while the count is being made | WW takes the freeze and its snapshot **after** each pick confirm that commits first. The server-side `assertNotFrozen` sets the order. Thus, a pick is either in the snapshot (no variance) or rejected. If rejected, the handset shows `FROZEN_BIN` (this exists). WW rejects offline picks that replay after a freeze, and puts them in the dead-letter queue |
| C4 | Staging locations | By default, counts **do not include** zones with `is_staging`. An operator can do an audit count of a staging lane. But its variances do not post an `inventoryAdjustment`. Each variance makes a **trip exception** for the staged pick list, because NetSuite already holds that quantity under an open IF. To correct it, pick again, or decrease the IF line before Shipped. This puts the quantity back to available in NetSuite. Only then can WW post a bin adjustment |
| C5 | A variance is posted while IFs are open at Picked | The adjustment is the WW **bin difference** (counted quantity minus expected quantity for that bin). WW never compares it with NetSuite on-hand. NetSuite on-hand still includes stock that is picked but not shipped. A comparison with it would count that stock two times. The W14 nightly reconciliation compares NetSuite `quantityonhand` with WW bins **+ staging + picked but not shipped**, for each location |
| C6 | Negative variance on a forward-pick face that has open demand | When a person approves the variance, WW makes an urgent replenishment for that face (D5). If the location goes below the committed quantity, NetSuite commits again by itself. The next D2 poll then makes the pick lists smaller |
| C7 | A freeze expires while a trip waits | The automatic expiry (default 4 hours) releases the stock and tells the supervisor (this exists). The trip board shows the faces that are frozen or wait for a count. Thus, dispatch can see why a trip is short |
| C8 | Transfers | `in_transit` pallets have no bin, so no count includes them. At the destination, WW stops putaway into a frozen bin (this exists). The pallet waits in receiving staging |

### 6.3 Necessary fix in the freeze code

When a freeze ends, `releaseCycleCountFreezes` moves **all** `held_quantity` back to available. This also releases stock that was on hold for a different cause, for example quality or damage. This risk is larger when a frozen face is near picking. Before slice D, change the freeze: it must record how much it moved into held (for each balance and each pallet). It must release only that quantity.

### 6.4 To verify

- **V6** — Can Simplex accept the 2-hour departure time in C1? Or must WW block counts on faces that have released trips?
- **V7** — Can a REST PATCH decrease the quantity of an IF line at Picked or Packed (C4)? Or must WW delete the IF and make it again?
- **V8** — Do the trucks to Pine and Lower Estate share trips with customer deliveries (T2)?
- **V9** — Does Simplex move stock between its locations with NetSuite inventory transfers today, not with TOs (T8)?
- **V10** — Can the integration role make TOs? Does a TO at Pending Approval follow the Simplex approval workflow? Who approves the requests from WW (T9)?

## 7. Returns

**Status: proposed on 2026-10-26. Not agreed.** Decisions R1–R14 are about customer returns (NetSuite RMAs), deliveries that the customer refuses at the door, and vendor returns. The NetSuite record data is in the research doc §5. WW receives returns through the Phase 1 receiving flow. Vendor returns ship through the outbound flow in §2–§3.

### 7.1 What exists today

- `return_authorizations` has **only a header**: `rma_number`, `client_id`, `warehouse_id`, a `task_status`, one `disposition` for the full RMA, and `reason`. It has no lines, no NetSuite id and no source order. `client_id` is the incorrect party. Clients own stock, but RMAs come from customers (D1).
- `quality_disposition` has the values `pending`, `pass`, `fail`, `hold`, `release`, `scrap` and `return_to_vendor`. `quality_inspections` links a disposition to a pallet or a receipt.
- `orders.order_type` is free text. Its default is `'sales'`. WW has no record for vendor returns.
- **Sandbox (discovery on 2026-10-21):** there are only two RMAs. One is at `RtnAuth:A` and one is at `:G` (Refunded). There is also the test record RMA07. No `VendAuth` rows came back. Inventory Status has only "Good". 332 inventory items have serial numbers. We do not know the restock field id on RMA receipt lines yet (open from J10).
- The SO and IF already have flags for delivery exceptions: `custbody_ee_customer_refused`, `_damaged_item`, `_wrong_items`, `_missing_items` and the other flags (§1).

### 7.2 Ownership model

**NetSuite owns the RMA. WW receives it and sets the disposition of each line.** The RMA holds the approval, the price, the restocking fees and the credit. WW must not copy these data. The credit memo or cash refund stays with finance (research doc §5.1). WW never makes or approves an RMA. WW owns the physical work: it counts the returned goods, sets the disposition of each line, and does quarantine, putaway and scrap.

A **refused delivery is not a return** when nobody has invoiced the order. The customer did not accept the goods. The goods come back on the same truck. Usually no credit is necessary, because there is no invoice. WW then cancels its own fulfillment (R7). The refusal becomes an RMA only after the SO is billed (R8). §8 (O6) shows that Simplex usually invoices at Shipped. Thus, most refusals use R8.

### 7.3 Customer returns (RMA)

| # | Topic | Proposal |
|---|---|---|
| R1 | Discovery | The D2 SuiteQL poll also reads `RtnAuth:B`, `:D` and `:E` where the line location is a mapped location. **Receiving** shows them as type **Return**. The Orders inbox does not show them. The W2 number lookup also finds RMAs. Thus, the dock can type or scan the RMA number on the customer's papers. WW never shows `:A` (Pending Approval). Goods that arrive without an approved RMA go to R5 |
| R2 | Data model | `return_authorizations` gets `external_record_id`, `customer_id` (FK `customers`), the source SO id and number, and the NetSuite status. A new table `return_authorization_lines` holds: `external_line_id` (`line`), the `<internal id>:<line>` key that the lookup makes (J10), the product, the NetSuite unit id, the expected and received quantity in **base units** (D9), the reason code, and the lot or serial number. The header `disposition` becomes a summary of the lines. `client_id` stays, and can be empty. All changes only add to the schema |
| R3 | Receipt | WW receives a return as `receipts.receipt_type = 'return'`. Each `receipt_line` has a link to its RMA line. The operator counts each line and gives it a disposition. The operator can divide one line into more than one disposition (for example, 8 restock and 2 scrap). WW posts with `returnAuthorization/{id}/!transform/itemReceipt`. Each line sends the location, the quantity in the unit of the RMA line, and the restock flag. Items with serial numbers send them in inventory detail. `custbody_spx_ww_external_ref` prevents a second post, as in the Phase 1 receipts. A receipt possibly cannot hold the same RMA line two times with different restock flags (V12). In that case, WW posts one receipt for each disposition group |
| R4 | Disposition | WW sets the disposition for each line, as 7.4 shows. **Restock** goes through normal putaway. The stock can then go into forward-pick replenishment (D5). **Hold** goes into a returns-quarantine zone with `held_quantity` and a `quality_inspections` row. Nobody can pick it until a person releases it. **Scrap** posts restock ✗. WW makes no pallet, and keeps a reason and a photo. **Return to vendor** stays on hold, the same as Hold, until a vendor return picks it (R12) |
| R5 | Over, short and unexpected | WW never receives more than the open RMA quantity. WW puts extra items, items not on the RMA, and goods without an approved RMA into returns staging. It records them as an **unexpected return** exception, and posts nothing to NetSuite. Customer service then changes or approves the RMA in NetSuite. After the next poll, the dock can receive against the RMA without a second count. A short receipt keeps the RMA at `:D`/`:E` |
| R6 | Who sets the disposition | Each receiver can select Restock or Hold. Scrap and Return to vendor need a Supervisor or a completed inspection, because the business writes off or loses these goods |

### 7.4 Disposition mapping

| WW disposition | `quality_disposition` | NetSuite receipt line | WW stock after the receipt |
|---|---|---|---|
| Restock | `pass` / `release` | Restock ✓, status Good | Available, normal putaway |
| Hold for inspection | `pending` / `hold` | Restock ✓ into a status that is not available ("Quarantine"), **if Simplex makes this status (V13)**. Until then, restock ✓ as Good | On hold in the quarantine zone. Then the inspection releases it (status change to Good, if in quarantine) or scraps it (`inventoryAdjustment` out) |
| Scrap | `fail` / `scrap` | Restock ✗ (written off to expense) | None |
| Return to vendor | `return_to_vendor` | Restock ✓, as Hold | On hold, kept for a VRMA |

If there is no Quarantine status, NetSuite counts returns on hold as available. NetSuite can then commit them to SOs. WW does not pick them, so those SO lines become short picks (D10) until the hold is released. This is why V13 is important.

### 7.5 Refused deliveries

| # | Case | Proposal |
|---|---|---|
| R7 | The customer refuses at the door, and the SO is not billed | The driver records the refusal and the reason in the proof of delivery (slice G). This writes `custbody_ee_customer_refused` and the reason fields. When the trip closes, the dock scans the refused cartons back in at a **trip check-in** step. This occurs before putaway. WW then decreases its own fulfillment. It PATCHes the IF lines down, or deletes the IF if the customer refused the full order (V14). The quantity becomes available and committed again in NetSuite. The SO goes back to Pending Fulfillment or Partially Fulfilled. It shows again in the Orders inbox, and customer service delivers it again or cancels it. No RMA and no credit memo are necessary. Cartons that come back damaged (`_damaged_item`/`_damaged_box`) go to Hold. The inspection result then posts an `inventoryAdjustment` or a status change |
| R8 | The customer refuses or returns goods after billing | After the SO line is billed, nobody can decrease the IF below the billed quantity. WW sends a **refusal needs RMA** exception to customer service. The goods wait on hold in returns staging. When the R1 poll finds the RMA, receiving matches it to the goods on hold. The operator only has to confirm. Goods that a customer sends back some days later always use this case. **This is the usual case for Simplex (O6)** |
| R9 | Incorrect or missing items | `_missing_items` is a short delivery, not a return. Nothing comes back, and the SO stays open for the missing quantity (D10). For `_wrong_items`, the incorrect item comes back through R7 or R8. The correct item is a new pick against the SO line, which is still open |
| R10 | Trip close | A trip cannot close while refused cartons from the proof of delivery are not scanned back in or marked lost. Lost cartons make a supervisor exception. WW does not adjust NetSuite for them by itself |

### 7.6 Vendor returns

| # | Topic | Proposal |
|---|---|---|
| R11 | Order type | Vendor returns become `orders.order_type = 'vendor_return'`. They come from a NetSuite `vendorReturnAuthorization` (VRMA). NetSuite owns the VRMA (approval and vendor credit). WW picks and ships it. The D2 poll reads approved VRMAs (`VendAuth:B` Pending Return and `:D` Partially Returned; **[Verify]** these codes) at mapped locations. The Orders inbox shows them as type **Vendor return** |
| R12 | Pick source | VRMA lines pick **stock on hold first**. First they pick pallets with the `return_to_vendor` disposition. Then they pick other stock on hold for that item. Then they pick from bulk. They never pick from a forward-pick face, and they add no D5 demand (as T4). This is the only pick type that can take stock on hold |
| R13 | Shipping | Use `vendorReturnAuthorization/{id}/!transform/itemFulfillment`, with the same A/B/C life cycle as D3. If the vendor's own carrier collects the goods, the order goes to a **dock collection**, not a trip. The status is Picking when the pick is complete. It becomes Packed and Shipped together at the collection scan, with the name and signature of the carrier |
| R14 | Start a vendor return | WW does not make VRMAs. A `return_to_vendor` disposition tells purchasing the item, the quantity, the supplier (from the receipt or the product) and the inspection notes. Purchasing then makes the VRMA in NetSuite. A request from WW at Pending Approval, as T9 does for TOs, is for Phase 3 |

### 7.7 Status mapping

| NetSuite record | WW | Trigger |
|---|---|---|
| `RtnAuth:A` Pending Approval | (not shown) | — |
| `RtnAuth:B` Pending Receipt | Return in Receiving, `queued` | Poll |
| `RtnAuth:D`/`:E` Partially Received | `in_progress` | WW posts a receipt, and some lines are still open |
| `RtnAuth:F` Pending Refund | `completed` | WW receives the last line |
| `RtnAuth:G` Refunded / `:H` Closed / `:C` Cancelled | Closed, read only | Poll |
| SO IF decreased or deleted after a refusal | WW opens the pick list again, and the SO goes back to the inbox | Trip check-in (R7) |
| `VendAuth:B` Pending Return | Vendor return in the Orders inbox | Poll |
| VRMA IF at A / B / C | `in_progress` → shipped | Pick, pack, collection or departure |

### 7.8 Build placement

| Slice | Contents | Depends on |
|---|---|---|
| H | RMA poll and lookup, `return_authorization_lines`, return receipt with a disposition for each line, quarantine zone, RMA receipt posting | B, Phase 1 receipt posting (W3) |
| G+ | Trip check-in of refused cartons, IF decrease or delete, refusal needs RMA exception | G |
| I | `vendor_return` order type, VRMA poll, pick source from stock on hold, dock collection, VRMA fulfillment | E, H |

### 7.9 To verify

- **V11** — Is **Advanced Receiving** on? If it is off, the receipt and the refund occur together on the credit memo. Then WW cannot post an RMA receipt by itself (research doc §5.1). The sandbox has an RMA at Refunded but none at Pending Refund, so we do not know yet.
- **V12** — What is the restock field id on an RMA receipt line (open since J10)? Can one receipt hold the same RMA line two times with different restock flags? Or does a divided disposition need two receipts?
- **V13** — Will Simplex add a "Quarantine" (or "Damaged") inventory status? With this status, NetSuite does not commit returns on hold to SOs. Is the Inventory Status feature on, or does the record exist with only "Good"?
- **V14** — Can REST decrease or delete an IF that is already at Shipped (this extends V7)? When does Simplex bill an SO after shipping: in a scheduled Bill Sales Orders run, by hand, or immediately? The answer sets how long the R7 time stays open. It depends on V4. §8 shows that Simplex usually invoices some minutes after Shipped.
- **V15** — How does Simplex process refusals today? Does the "ERP" driver app (V3) or a script make an RMA? Or does a person change the fulfillment by hand? The sandbox has only two RMAs. Thus, Simplex probably does not make RMAs for refusals.
- **V16** — Does Simplex use VRMAs? Are they available through REST? Can the integration role read them (no `VendAuth` rows came back)? Are vendor returns in scope now or later (research doc §12 Q9)?
- **V17** — For the 332 items with serial numbers, must the returned serial number be one that WW shipped to that customer? Must WW check it?
- **V18** — Does Simplex want WW to write its return reason codes to an RMA field? Who can approve Scrap (R6)?

## 8. Dispatch that the office plans (sandbox findings, 2026-10-30)

**Status: agreed with Russell on 2026-10-30.** We did a read-only SuiteQL query of the `_SB1` sandbox. The query read the fulfillments with dates from 1 Sep to 28 Oct 2026. The "Simplex Order-to-Dispatch Flow" artifact shows the flow chart.

### 8.1 What the sandbox showed

- **The office plans each trip.** The Simplex Fulfill Orders page (`SL_Bulk_Fulfill_Orders`, `customscript1118`) shows SOs and TOs together. It makes the IF at Picked with these fields:
  - `custbody_simplex_picked_by` (list `customlist_spx_pickers`).
  - `custbody_truck` (list `customlist_truck_fulfillment`). Each truck has the name of its driver. The list also has the placeholders "Pending" and "Pine".
  - `custbody_simplex_trip_number` (free text).

  Submit and Print calls `SL_print_picking_tickets` (`customscript1120`). Approximately 97% of IFs have a truck and a picker.
- **The trip number is the run of the day.** Trip 1 occurs on 21 dates. Trip 2 occurs on 19 dates. Thus, the key of a trip is the date + the truck + the trip number.
- **Nobody uses Packed.** IF status is Picked (73) or Shipped (1,954). It is never Packed. 73 IFs stay at Picked for 33 days on average.
- **Shorts become second deliveries.** 88 SOs needed 2 or 3 IFs. 450 SOs are Partially Fulfilled, for 48 days on average.
- **The invoice follows the truck.** Simplex makes the invoice some minutes after Shipped. 35 orders got an invoice before they shipped.
- **A script already sets the KPI timestamps.** The SPX Operations KPI – Event Capture user event (on SO, IF and invoice) writes `custbody_spx_kpi_*` and `customrecord_spx_order_kpi`. The KPI windows are:
  - Ordered 7:30–10:30: deliver on the same day.
  - Ordered 10:30–1:30: ship by 9:30 on the next day.
  - Ordered 1:30–4:30: ship by 12:30 on the next day.

  337 orders met the KPI. 829 orders did not meet it.
- **The sandbox has no driver data.** No IF has a signature or a `custbody_ee_*` exception flag. But the fields of the ERP app exist: `custbody_erp_signature_captured`, `_signature_image`, `_eq_signature_date` and `custbody_erp_eq_delivery_image_1..3`.

### 8.2 Decisions

| # | Topic | Decision |
|---|---|---|
| O1 | Who plans | The office continues to plan in NetSuite on the Fulfill Orders page. WW does not suggest or make trips. WW reads the IFs that the page makes. WW gives floor staff the pick, pack, load and depart tasks. This decision replaces "WW makes the IF" in D3 and the trip suggestion in D7 |
| O2 | Discovery | The D2 poll also reads IFs at Picked, with the picker, truck and trip number. The Orders inbox shows SOs and TOs together, as the Fulfill Orders page does (T1) |
| O3 | Trip key | A trip is the IF date + `custbody_truck` + `custbody_simplex_trip_number` |
| O4 | KPI times | WW records the real pick, pack and departure times. WW can write `custbody_spx_kpi_*` itself. Or WW can only change the IF status and let the KPI script record the time. The owner of that script must confirm which method to use (V19) |
| O5 | Driver app | Simplex keeps the ERP driver app. The app finds the IF and reads the trip and truck from NetSuite. WW reads the signature and exception fields that the app writes |
| O6 | Refusals | Refusals go through returns (§7, R1–R6 and R8: RMA, return receipt and credit memo), because Simplex usually makes the invoice at Shipped. R7 (decrease the IF) applies only when the order has no invoice yet |

### 8.3 To verify

- **V19** — Does the SPX Operations KPI script accept KPI times that WW writes?
- **V20** — How does the ERP app find its IFs: by truck, by trip or by driver login? Check this in production, because the sandbox has no driver data.
- **V21** — What does Simplex Daily Deliveries Setup Cleanup reset each day? What does the "Pending" truck mean?
- **V22** — Who clears the IFs that stay at Picked? Must WW show them on the trip board?
