---
document_id: WW-UM-001
title: Warehouse Wizard User Manual
product_version: "1.27"
revision: "1.1"
effective_date: "2026-08-17"
audience: [warehouse_operator, inventory_clerk, warehouse_supervisor, warehouse_manager, admin, dispatch_driver]
canonical_help_source: src/lib/help-content.ts
retrieval_note: Use the stable HELP and SOP identifiers when citing this manual in an AI answer.
---

# Warehouse Wizard User Manual

End-to-end operating guide for warehouse managers, supervisors, inventory clerks, operators, dispatch staff, and administrators.

### A note to experienced warehouse teams

This manual is not here to teach experienced people how to run a warehouse. The audience already knows what a clean receiving lane looks like, when a pallet does not belong in a location, why a short pick matters, and how quickly a weak handoff becomes tomorrow’s problem.

Warehouse Wizard gives those familiar decisions a shared place to live. It records what the team saw, who acted, where the pallet went, and what still needs attention. During training, start with the way the team handles the situation today, then connect that practice to the matching screen and scan. New inventory terms are explained only so everyone can use the same language—not to replace the language or experience already on the floor.

**Document:** WW-UM-001  
**Product:** Warehouse Wizard 1.27  
**Revision:** 1.1

**Effective:** 17 August 2026
**Owner:** {{DOCUMENT_OWNER}}  
**Approved by:** {{APPROVER}}  
**Support / escalation:** {{SUPPORT_CONTACT}}

> Site owners must replace all `{{PLACEHOLDER}}` values, confirm local safety rules, and issue the approved revision before using this as controlled floor documentation. The application and its in-app Help Center remain the source of truth for current screen behavior.

## 1. Purpose and operating principle

Warehouse Wizard controls pallet-level warehouse work from receipt through storage, picking, same-warehouse moves, counting, status control, and reporting. Cross-warehouse Transfers are temporarily disabled while that workflow is being reviewed. The system is designed around one principle:

> **See the work, confirm the physical pallet or location, record the action once, and leave a clear handoff for the next person.**

If the floor and the system disagree, stop the transaction. Do not guess a code, bypass a scan, invent a quantity, or repeat a physical movement under a second task. Keep the stock safe, verify it in Inventory Search, apply a controlled status if authorized, record the issue, and involve a supervisor.

### 1.1 What “normal workflow” means

A normal workflow has all of the following:

1. The user is signed in with the correct role and warehouse selected.
2. The physical pallet, product, location, and paperwork are identifiable.
3. Required labels scan or can be typed exactly as printed.
4. The device is online when the transaction is committed.
5. The system accepts the live pallet, location, quantity, status, and temperature rules.
6. The operator confirms the action once and verifies completion before moving on.

Anything outside those conditions is an exception, not an invitation to improvise.

### 1.2 Core safety rules

- Follow site PPE, material-handling, food/pharma, dangerous-goods, and lifting rules. The WMS does not replace physical safety procedures.
- Never stand in an unsafe area to scan a label. Stop and reposition safely.
- Never move leaking, unstable, contaminated, or unsafe stock unless authorized by local procedure.
- Cool or frozen stock must use a compatible temperature zone.
- A bay code identifies a group of locations; select the exact cell before confirming.
- Live posts are frozen when the device is offline. Reconnect, refresh, re-check, then post once.

## 2. Roles and responsibility

| Role | Normal responsibility | Typical modules |
|---|---|---|
| Warehouse Operator | Execute directed work and stop on exceptions | Put-Away, Pick Execution, Location Moves, Cycle Counts, Inventory Search |
| Inventory Clerk | Receive stock, maintain product data, investigate inventory, control status | Receiving, Products, Packaging Profiles, Inventory Search, Cycle Counts, Statuses |
| Dispatch Driver | Support approved dispatch handoffs; cross-warehouse Transfers are currently unavailable | Assigned dispatch procedures |
| Warehouse Supervisor | Allocate work, resolve exceptions, review counts, coach standard work | Dashboard, operational modules, Cycle Counts, Statuses, System Log |
| Warehouse Manager | Plan work, release pick lists, monitor flow, manage structure and access | Dashboard, Reports, Pick Lists, Settings, Users & Roles, System Log |
| Admin | Configure the environment and administer access | All modules, Setup Wizard, Reset, integrations, logs |

Assign the smallest role that allows the person to complete their normal work. Reassign open work before disabling a person or removing a role.

## 3. Navigation, sign-in, and device use {#help-help-center}

**Parallel Help ID:** `help-center`

### 3.1 Sign in

1. Open Warehouse Wizard in the approved browser or installed shortcut.
2. Sign in with email or user code and password.
3. On an approved mobile/tablet device, badge and PIN may be available after a normal password sign-in established trust.
4. Confirm your name, role, and active warehouse before starting work.
5. Never share a password, PIN, badge, or signed-in device.

Badge sign-in is a convenience, not a replacement for identity controls. A lost badge must be reported and disabled.

### 3.2 Select the active warehouse

The active warehouse is working context for tasks, searches, and location codes. Always check it:

- at sign-in;
- after changing facilities;
- when a location code cannot be found;
- before receiving, moving, counting, picking, or transferring stock.

### 3.3 Use scanners and typing

Use a scanner or camera where available. Direct typing remains a supported fallback:

- click or tap the field;
- type the visible code exactly as printed;
- use Enter or the screen action to commit;
- do not depend on clipboard access.

If the scanner reads the wrong code repeatedly, stop and reprint or replace the damaged label.

### 3.4 Help and notifications {#help-notification-bell}

Open the contextual Help sidebar from any module for the relevant summary, key actions, mistakes, and linked articles. Open the full Help Center for search.

The header notification bell combines:

- **Connectivity notices:** the current device is offline or a floor device lost its connection. These take priority and show red.
- **Reorder alerts:** available stock has crossed a reorder threshold and a replenishment quantity is recommended. These show amber when no connectivity alert is present.

## 4. The standard operating day

### 4.1 Manager start-of-shift — 5 to 10 minutes

1. Open Dashboard and select the relevant view: Floor, Dock, or Office.
2. Confirm the active warehouse and available staffing.
3. Review open Receiving, Put-Away, Pick Lists, transfers, and count work.
4. Check hold, quarantine, damaged, missing, and blocked-location exceptions.
5. Review occupancy pressure, reorder alerts, expiry risk, and System Log items.
6. Assign an owner and next action to every material exception.
7. Release only the work the floor can finish safely with available stock and space.

### 4.2 Operator start-of-shift — 2 to 5 minutes

1. Sign in on the assigned device and verify the active warehouse.
2. Confirm scanner/camera, network, battery, and printer availability.
3. Inspect PPE and material-handling equipment.
4. Read notifications and the supervisor’s work priority.
5. Open the assigned queue and complete one task at a time.

### 4.3 End-of-shift handoff

Operators:

- finish or clearly leave each task in its correct system state;
- keep unfinished physical stock in the matching controlled area;
- report unposted scans, offline work, damaged labels, and exceptions;
- sign out of shared devices.

Managers:

- reconcile open tasks with the physical floor;
- review receiving lanes, put-away backlog, staging, controlled stock, and count variances;
- assign owners to unresolved System Log entries;
- do not mark an issue resolved until the real condition is corrected.

## 5. Dashboard and management control {#help-enterprise-dashboard-modes}

**Parallel Help IDs:** `enterprise-dashboard-modes`, `warehouse-brain`, `reporting-basics`, `lean-standard-work`

### 5.1 Choose the right view

- **Floor:** shift-start queue and large workflow cards for operators.
- **Dock:** staged outbound lanes and handoff states such as ready, called, loading, blocked, and loaded.
- **Office:** fill level, inventory turn, expiration, variance, setup readiness, and management recommendations.

Dashboard numbers are signals. Drill into the operational module or Inventory Search before making a stock decision.

### 5.2 Manager routine

Review three times: shift start, before releasing a major wave, and end of shift.

Ask:

1. Where is work accumulating?
2. Is space available where inbound stock is being directed?
3. Are hold/quarantine/missing trends increasing?
4. Are people repeating scans, searches, or corrections?
5. Which exception has no owner or due time?

Treat blocked locations, quarantine buildup, missing stock, and repeated scan failures as daily 5S and standard-work signals.

## 6. Master data before operations

Correct master data prevents downstream errors. Configure in this sequence:

1. Warehouses.
2. Clients and ownership rules.
3. Zones and temperature/purpose flags.
4. Bin locations, sequence, and capacity.
5. Products, tracking, rotation, and temperature requirements.
6. Packaging profiles and barcodes.
7. Labels that physically match every configured code.

### 6.1 Warehouse and zone design {#help-warehouse-setup}

Use short, stable warehouse codes. Keep receiving, put-away/staging, picking, dispatch, quarantine, and temperature-controlled use cases distinct. Hide obsolete records where the application supports it rather than deleting history.

### 6.2 Locations and labels {#help-location-generation}

Location hierarchy is Warehouse > Zone > Aisle > Bay > Level > Position/Depth. A rack label identifies an exact cell, for example `A-05-L05` or `A-05-L05-P1`. A bay label omits level/position and opens the bay grid. **Position** distinguishes side-by-side cells at a bay level; **depth** is how many pallets that location can hold front-to-back and is used as location capacity when an older capacity value is blank or zero.

Sequence locations to match the walking path. Set realistic capacity and mixed-stock rules. Whenever a code changes, print and install the new physical label before releasing work.

### 6.3 Products and packaging {#help-product-mastery}

For every SKU, verify:

- stable SKU and name;
- client owner;
- barcode(s);
- FIFO or FEFO rotation;
- expiry and lot tracking;
- temperature and handling requirements;
- one appropriate default packaging profile;
- each/case/pallet quantities and dimensions.

Do not receive an unknown product under a guessed SKU. Correct the master data first.

## 7. Receiving — normal inbound workflow {#help-receiving-flow}

**Parallel Help IDs:** `receiving-flow`, `label-printing`  
**Normal owner:** Inventory Clerk  
**Result:** Pallet records, lot/expiry context, labels, inventory in receiving state, and Put-Away tasks.

### 7.1 Before receiving

Confirm:

- correct active warehouse and client owner;
- paperwork, PO, or transfer reference;
- container identity where applicable;
- product master and packaging profile;
- physical quantity and palletization;
- lot, batch, expiry, and temperature requirements;
- printer and destination storage capability.

### 7.2 New Shipment sequence

1. Open **Receiving > New Shipment**.
2. Confirm warehouse context.
3. Scan or type the container number. For camera capture, use only a valid green ISO 6346 candidate and press **Use**.
4. Enter the PO number.
5. Scan a product or search by SKU/name.
6. Press the highlighted right-arrow to commit the selected product to the line.
7. Enter **Total received**, then press Enter.
8. Enter **Qty per pallet**, then press Enter.
9. Confirm **Pallets**, then press Enter.
10. Select expiry when required; add lot, batch, packaging, and notes.
11. Repeat for every product line.
12. Compare the completed form with the physical receipt and paperwork.
13. Save as a draft if information is incomplete, or receive once when verified.
14. Print pallet labels and attach them to the matching physical pallets.
15. Release/send the pallets to Put-Away.

Learned quantity-per-pallet suggestions are time savers only. The physical count always wins.

### 7.3 Saved drafts

Use a draft when the physical shipment is present but the transaction cannot be safely completed. Keep the physical pallets in the designated receiving area and ensure the draft can be matched by container, PO, pallet, or product. Complete or cancel drafts promptly so lanes do not become invisible queues.

### 7.4 Receiving exceptions

| Condition | Required action |
|---|---|
| Container code will not validate | Improve framing/light or type the visible code; verify before use. Do not invent a code. |
| Unknown SKU/barcode | Stop. Correct product and packaging master data. |
| Physical quantity differs from paperwork | Record the verified physical count and escalate/document the discrepancy. |
| Cool stock has no compatible zone/profile | Stop before receipt completion; correct setup. |
| Device is offline | Keep the physical stock in receiving. Reconnect, refresh drafts/live form, re-check, then post once. |
| Label fails | Reprint the same pallet identity; do not create a duplicate pallet. |

**Done when:** every physical pallet has one matching label/record and a downstream Put-Away task or documented controlled exception.

### 7.5 Correct a stored pallet returned from Inventory

Authorized clerks, supervisors, managers, and admins can start a controlled correction from **Inventory Detail > Edit & return to Receiving**. Use this only after confirming the physical pallet, its live location, and that no quantity is reserved or allocated.

1. Open the pallet in Inventory Detail and select **Edit & return to Receiving**.
2. The original pallet is held out of active Inventory while its correction draft opens in Receiving. The product is locked so the correction cannot silently change the SKU.
3. Correct the quantity per pallet and/or expiry date using the verified physical information.
4. Confirm whether the pallet is still physically at its former stored location.
5. If only quantity changed and the pallet remains in that exact location, select **Update & Close**. The same pallet identity, barcode, location, and history are preserved; no label is reprinted.
6. If expiry changed, or the pallet is no longer at the former location, use **Print & Receive pallet**. Attach the replacement label and complete the directed Put-Away task before attempting a Location Move.
7. If the correction should not continue, select **Cancel**. The original pallet is restored to Inventory.

Do not correct a reserved/allocated pallet, a pallet already in correction, or a pallet whose physical location cannot be confirmed. A quantity-only update is never permission to change product identity or erase movement history.

## 8. Directed Put-Away {#help-putaway-flow}

**Parallel Help ID:** `putaway-flow`  
**Normal owner:** Warehouse Operator  
**Result:** Stock becomes stored and available in an exact compatible location.

### 8.1 Normal sequence

1. Open Put-Away and select the next assigned/priority task.
2. Verify the physical pallet and task number.
3. Scan the pallet label.
4. Travel to the directed area.
5. Scan the exact location label, or scan a shortened bay code and select the exact available cell.
6. Check the cell is physically open, safe, and temperature-compatible.
7. Place the pallet in that exact cell.
8. Confirm the task once.
9. Verify the task clears and stock shows at the destination.

Two confirmations are essential: pallet identity and exact location. A bay code is not the final location.

### 8.2 Return to Receiving

If the pallet or receipt needs correction, use **Save as Draft / Return to Receiving** when authorized. The task leaves the active Put-Away queue and creates a Saved Draft in Receiving. Keep the physical pallet in the receiving area and tell the clerk why it was returned.

When several Put-Away tasks from the same receipt need the same correction handoff, use the available batch return selection rather than reopening each task separately. Review every selected pallet before confirming. A returned or cancelled task must no longer remain in the active Put-Away queue.

### 8.3 Put-Away exceptions

Stop if the cell is inactive, full, blocked, unsafe, or temperature-incompatible. Use another eligible cell only through the provided bay selection/override process and with the required reason. If the device disconnected, refresh the task and destination after reconnect; do not trust a pre-disconnect location.

**Done when:** pallet and exact location are confirmed, the task clears, and Inventory Search shows the new stored location.

## 9. Inventory Search and verification {#help-inventory-search}

**Parallel Help ID:** `inventory-search`  
**Normal users:** All approved operational roles.

Search by SKU, product name, pallet, lot, warehouse, zone, or location. The results identify stock in the practical order **SKU → Product → Pallet**, followed by the remaining stock and location detail. Open Inventory Detail to inspect quantity, status, owner, lot/expiry, current location, and movement history.

Use Inventory Search before:

- substituting or reassigning a pallet;
- correcting a location;
- changing status;
- beginning an authorized pallet correction;
- investigating a short or missing pick;
- preparing an approved manual cross-warehouse handoff while Transfers remain disabled;
- resolving a count variance.

Filters matter: held or quarantined stock may be excluded from normal availability. Never treat a dashboard total or memory as the live pallet record.

## 10. Pick Lists and whole-pallet execution {#help-pick-flow}

**Parallel Help IDs:** `pick-flow`, `operational-dead-ends`  
**Manager result:** Executable whole-pallet work released against available stock.  
**Operator result:** Correct pallet confirmed and moved to the directed staging/dispatch area.

### 10.1 Manager: create and release

1. Verify demand, client/order details, warehouse, due date, and staging capacity.
2. Use Inventory Search to confirm available stock and rotation eligibility.
3. Create the list and product lines. Scanner-first creation may add repeated scans before quantities/details are finalized.
4. Review shortages and task quantities.
5. Remember that normal execution is whole-pallet: do not release a plan that requires an unsupported split.
6. Release the list.
7. Confirm it appears in the Lists tab and monitor assigned work.

### 10.2 Operator: execute

1. Open the assigned pick task.
2. Read the rack, aisle, bay, level, and short position instruction.
3. Travel to the location.
4. Scan the exact location, or scan the bay and select the highlighted assigned cell.
5. Verify the pallet condition and expected whole-pallet quantity.
6. Scan the pallet label.
7. When **Confirm pick** highlights/flashes, confirm before doing anything else on that task.
8. Move the whole pallet to the directed staging/dispatch lane.
9. Verify the task completed.

### 10.3 Short, missing, or damaged pick

If the system expects 100 and the pallet physically contains 80 or 90, do not confirm a normal whole-pallet pick. Stop and notify a supervisor. The current controlled response is:

1. Verify the pallet in Inventory Search.
2. Apply Hold, Quarantine, Damaged, or Missing only as facts justify and authorization permits.
3. Record a System Log note for investigation/customer/quality follow-up.
4. Replan or reassign the pick after the stock record is corrected.

Do not split a pallet or type a smaller quantity simply to finish the task.

## 11. Location Moves {#help-location-move-flow}

**Parallel Help ID:** `location-move-flow`  
Use only when a stored pallet changes location inside the same warehouse. Cross-warehouse Transfers are temporarily disabled; follow the manager-approved manual containment and escalation procedure instead of trying to represent that movement as a Location Move.

1. Verify the active warehouse.
2. Open Location Moves and scan/type the pallet.
3. Confirm its current live location/status.
4. Scan/type the destination or use **Browse bays**.
5. If a bay was selected, choose the exact eligible cell.
6. Physically move the pallet.
7. Confirm the move once and verify Inventory Search.

Cancel queued or in-progress moves when plans change. If a move was posted to the wrong bin, perform a controlled corrective move; do not edit history away.

The system blocks pallets that are still in Receiving or have not completed Put-Away. It also blocks terminal pallet states such as Shipped, Cancelled, Retired, and Missing. Complete the correct upstream workflow or resolve the status with a supervisor; do not create a second pallet or use another screen to bypass the block.

## 12. Warehouse Transfers {#help-transfer-flow}

**Parallel Help ID:** `transfer-flow`  
**Current availability:** Temporarily disabled for all users.

The Transfers module normally preserves pallet and lot identity across warehouse boundaries, but it is not currently available for live operations. Opening the route shows a disabled notice, saved toolbar preferences cannot restore it, and transfer actions are blocked centrally.

Until the module is re-enabled through an approved release:

1. Do not use Location Moves to imitate a cross-warehouse transfer.
2. Keep the pallet controlled at its verified source location or designated dispatch holding area.
3. Notify the warehouse manager and use the site-approved manual movement, paperwork, and reconciliation process.
4. Reconcile the physical pallet and Inventory Search record before normal system work resumes.

### 12.1 What users will see

- Transfers is removed from normal enabled-module navigation.
- Opening `/transfers` directly shows **Transfers are temporarily disabled**.
- Create, dispatch, receive, cancel, and list operations reject transfer work.

### 12.2 Manager response

Keep the physical pallet, paperwork, authorization, departure/arrival evidence, and reconciliation owner explicit. Never leave cross-warehouse stock physically in a receiving or dispatch lane while its system record suggests a different location or availability. Record the exception and obtain an approved reconciliation before releasing dependent picks, counts, or moves.

## 13. Cycle Counts {#help-cycle-counts}

**Parallel Help ID:** `cycle-counts`

### 13.1 Manager/supervisor: plan

1. Choose location, zone, SKU, or spot-check scope.
2. Prioritize high-value, high-risk, high-velocity, and recently discrepant stock.
3. Generate the count and assign it.
4. Avoid unnecessary stock movement in the count area during execution.

### 13.2 Operator: blind count

1. Open the assigned CCT count.
2. Verify/scan the exact location.
3. Count physical stock without reading or guessing the expected value.
4. Enter the true count and required notes.
5. Submit once while online.

### 13.3 Supervisor review

Review over-threshold variances separately from count exceptions. Recount or investigate when required. Use notes before approving, rejecting, accepting, or returning a line to blind entry. Approved variances create the controlled stock/adjustment history.

If disconnected, entered values can remain on the device, but submit/approve/reject/close actions must wait. Reconnect, refresh the live assignment and freeze state, then act once.

Variance is evidence of a broken upstream handoff. Track root cause across receiving, put-away, movement, picking, transfer, labeling, or status control.

## 14. Status Controls {#help-status-controls}

**Parallel Help ID:** `status-controls`

| Status | Use when | Do not use when |
|---|---|---|
| Available | Stock is verified and eligible for normal work | Quality, count, location, or ownership is uncertain |
| Hold | Review is needed and final disposition is not known | A confirmed quarantine/damage/missing condition already exists |
| Quarantine | Quality, expiry, contamination, temperature, or customer rules require isolation | The pallet is simply waiting for ordinary work |
| Damaged | Physical damage has been verified | Damage is suspected but not confirmed |
| Missing | A verified search/count supports missing status | The operator only checked one expected location |

Every status change requires a meaningful reason. Add a System Log entry when quality, customer, manager, or support follow-up is required. Return stock to Available only after authorized verification.

## 15. Labels and printing {#help-label-printing}

Labels connect physical reality to system identity. Print immediately after receiving or structure setup.

- Pallet labels: attach to the matching pallet; reprint the same identity when damaged.
- Exact location labels: scan directly for the final rack cell.
- Bay labels: open the bay grid; operator selects the exact cell.
- Zone/warehouse labels: support navigation and bulk label sheets.

Do not create a new record simply to replace a damaged label. If a code changes, replace the floor label before releasing work. Use the configured Zebra/ZPL path for warehouse stations and browser printing only as the approved fallback.

## 16. Exception and Andon response {#help-operational-dead-ends}

**Parallel Help ID:** `operational-dead-ends`

### 16.1 Operator five-step stop rule

1. **Stop** the transaction and keep stock safe.
2. **Identify** pallet, location, warehouse, and task.
3. **Verify** the live record in Inventory Search.
4. **Notify** the supervisor with facts, not guesses.
5. **Resume once** only after the record and floor agree.

### 16.2 Supervisor response matrix

| Symptom | Verify | Controlled action |
|---|---|---|
| Pallet label unreadable | Printed text, Inventory Search record | Reprint same pallet label |
| Location label unreadable/stale | Active warehouse, Warehouse Structure, physical rack | Reprint label; correct structure only if wrong |
| Pallet in wrong bin | Movement history and physical location | Location Move to actual/correct destination |
| Quantity mismatch | Recount, lot, pallet identity, recent movements | Hold; count/investigate; adjust through approved workflow |
| Damage/contamination/expiry | Condition, lot, photos/site quality process | Quarantine/Damaged with reason and log |
| Unknown product barcode | Product/client/packaging records | Correct master data before work |
| Full/blocked destination | Physical cell and live capacity/status | Choose eligible cell or correct location state |
| Offline device | Network and backend connectivity | Freeze physical/system commit; reconnect and refresh |

### 16.3 Offline recovery

When connectivity drops:

- do not force or repeat Save, Receive, Put-Away, Pick, Move, Count, or approval actions;
- keep the pallet in its current physical state;
- preserve the visible task/form where possible;
- notify the supervisor if floor work is affected.

After reconnect:

1. Confirm the connection notice clears.
2. Refresh the module/live task.
3. Re-check pallet, location, quantity, status, and task state.
4. If the task changed, follow the current live instruction.
5. Post once and verify completion.

## 17. Reports, System Log, and audit {#help-reporting-basics}

Reports provide snapshots for management; they do not replace transaction detail.

Use Reports for stock by warehouse, occupancy, expiry risk, low stock/turn, dock performance, and variance trends. Use Inventory Search for pallet decisions. Use the System Log for operational exceptions and support/manager follow-up. Resolve a log only after the underlying condition is fixed.

Critical RF disconnect alerts require acknowledgment only after the operator has reconnected, refreshed live state, and verified work can safely continue.

## 18. Users, roles, badges, and access {#help-user-management}

**Parallel Help ID:** `user-management`

Admin standard work:

1. Create/approve the user.
2. Assign the smallest appropriate role.
3. Issue user code and approved badge/PIN for shared mobile devices.
4. Test sign-in before the shift.
5. Hide a role to remove one area; disable the profile to stop sign-in entirely.
6. Reassign open work before access changes.
7. Preserve audit history; do not delete records as a routine access action.

## 19. Warehouse Setup Wizard and Structure tool {#help-warehouse-structure-tool}

**Parallel Help IDs:** `warehouse-setup`, `warehouse-structure-tool`, `zone-design`, `location-generation`

Use the Setup Wizard for a new implementation or planned rebuild:

1. Define facilities.
2. Define purpose- and temperature-aligned zones.
3. Generate locations matching real aisles, bays, levels, and depth.
4. Review counts and codes; nothing is created yet.
5. Create the structure, then print and install matching labels.

Use Warehouse Structure to inspect the live hierarchy and capacity/fill. Edit a wrong item in its matching resource table rather than rerunning the wizard. Reset All is destructive and must be used only by an authorized admin with a documented rebuild plan and typed challenge.

## 20. Recommended training and competency sign-off

### 20.1 Operator competency

The operator can demonstrate, without prompting:

- sign-in and warehouse selection;
- scanner and manual typing fallback;
- exact location versus bay selection;
- one Put-Away, one Pick, one Location Move, and one Cycle Count;
- the stop rule for mismatch, damage, unknown code, full location, and offline device;
- Inventory Search verification and Help Center search;
- clean end-of-shift handoff.

### 20.2 Clerk competency

Add:

- complete receipt with product commit, quantities, lot/expiry, and labels;
- product/packaging correction before receipt;
- controlled status with reason;
- receipt draft and return-from-Put-Away handling.

### 20.3 Manager/supervisor competency

Add:

- start-of-shift control review;
- whole-pallet pick list release and shortage decision;
- cycle-count review and variance escalation;
- transfer dispatch/receive oversight;
- exception diagnosis, owner, and closure;
- role/access administration within authorization;
- end-of-shift reconciliation.

Record trainee, trainer, date, facility, scenarios completed, exceptions tested, and any retraining due.

## 21. Quick reference: normal end-to-end flow

| Stage | Owner | Physical confirmation | System completion |
|---|---|---|---|
| Plan | Manager | Capacity, stock, labor, priorities | Work released with owner |
| Receive | Clerk | Product, count, lot/expiry, pallets | Receipt/pallets/labels/put-away tasks |
| Put away | Operator | Pallet + exact eligible location | Stored/available inventory |
| Verify | Any operations user | Floor matches pallet record | Live state confirmed |
| Pick | Manager + Operator | Whole pallet at assigned cell | Pick confirmed and staged |
| Transfer | Manager/Driver/Clerk | Pallet, route, departure, arrival | In-transit then destination receipt/put-away |
| Count | Operator + Supervisor | Blind physical count | Reviewed variance/adjustment |
| Control exception | Clerk/Supervisor | Condition/location/count verified | Status, audit, and log |
| Close shift | Manager | Floor and queues reconciled | Owners assigned; safe handoff |

## 22. Glossary

| Term | Meaning |
|---|---|
| 3PL | Third-party logistics provider. |
| 5S | Sort, Set in order, Shine, Standardize, Sustain. |
| Andon | A visible stop/escalation signal used when work cannot safely continue. |
| CCT | Cycle-count task/number prefix used by the application. |
| DMAIC | Define, Measure, Analyze, Improve, Control. |
| DPMO | Defects per million opportunities. |
| FEFO | First Expired, First Out; earliest usable expiry is selected first. |
| FIFO | First In, First Out; oldest eligible stock is selected first. |
| ISO 6346 | International container identification and check-digit standard. |
| Pallet identity | The unique system code/label that follows one physical pallet. |
| Put-Away | Controlled move from receiving/staging to an exact storage location. |
| RLS | Row-level security controlling which data a signed-in user may access. |
| SKU | Stock keeping unit. |
| Whole-pallet pick | A task that moves the entire assigned pallet; no ordinary split is permitted. |
| WMS | Warehouse management system. |
| ZPL | Zebra Programming Language used for warehouse label printing. |

## 23. AI / ChatGPT reference guidance

For reliable answers, provide the assistant with this manual and ask it to cite the stable section or Help ID. The assistant should:

1. Prefer the current product version and revision metadata.
2. Distinguish normal workflow from exception handling.
3. Never recommend bypassing scans, guessing codes, forcing quantities, or posting offline.
4. State the role required for a consequential action.
5. Refer destructive setup/access actions to an authorized admin.
6. Use `operational-dead-ends` when the physical floor and system disagree.
7. Ask for the active warehouse, task number, pallet code, location code, current status, and exact error when diagnosing.

Suggested prompt:

> Using Warehouse Wizard User Manual WW-UM-001 for product version 1.27, answer as a warehouse trainer. Give the normal workflow first, then stop/escalate conditions. Cite the relevant section and HELP ID. Do not invent permissions or bypass a blocked transaction.

## 24. Module-by-module system overview

This section provides the normal orientation for every current application module. Use it during onboarding before role-specific hands-on training. A module may be hidden when the user’s role or a configured feature flag does not permit access.

## 24.1 Dashboard {#module-dashboard}

**Purpose:** Provide a live starting point for inbound, storage, outbound, exception, capacity, and management signals.  
**Normal users:** Managers, supervisors, clerks, and operators.  
**Normal use:** Select the active warehouse and the Floor, Dock, or Office view; read open-work and exception signals; open the source module for detail.  
**Handoff:** Managers set priority and ownership; operators open the assigned execution queue.  
**Avoid:** Treating a dashboard total as sufficient evidence for a pallet decision.

## 24.2 Warehouses {#module-warehouses}

**Purpose:** Define the top-level facilities that own zones, locations, users, and operational activity.  
**Normal users:** Admins and warehouse managers.  
**Normal use:** Create a unique stable facility code, name, address/context, status, and cool-zone capability; keep the physical facility and system record aligned.  
**Handoff:** Create zones and locations before releasing warehouse work.  
**Avoid:** Duplicate codes, disabling a warehouse with dependent work, or deleting history.

## 24.3 Clients {#module-clients}

**Purpose:** Identify the owner of 3PL stock and the rules that apply to its receipt, storage, picking, and reporting.  
**Normal users:** Admins and warehouse managers.  
**Normal use:** Maintain short stable client codes, ownership, expiry/mixed-stock requirements, and active status.  
**Handoff:** Products and receipts must reference the correct client.  
**Avoid:** Receiving under a guessed owner or deleting client context needed by historical transactions.

## 24.4 Zones {#module-zones}

**Purpose:** Group warehouse space by workflow, storage purpose, and temperature.  
**Normal users:** Admins and warehouse managers.  
**Normal use:** Configure Receiving, Put-Away/staging, Picking, Dispatch, Quarantine, Bulk, Cool, or Frozen areas with appropriate flags.  
**Handoff:** Generate exact bin locations and labels inside each zone.  
**Avoid:** Mixing staging/dispatch/quarantine purposes or assigning the wrong temperature class.

## 24.5 Bin Locations {#module-bin-locations}

**Purpose:** Define the exact physical cells used by directed Put-Away, picking, moves, counts, and occupancy reporting.  
**Normal users:** Admins and warehouse managers; operational roles consume the labels.  
**Normal use:** Maintain aisle, bay, level, side-by-side position, front-to-back depth/capacity, sequence, status, and scan code; print exact-cell and bay labels. Warehouse Structure occupancy uses the configured capacity and falls back to depth when older capacity data is blank or zero.

**Handoff:** Warehouse Structure verifies the hierarchy; operators scan locations in execution modules.  
**Avoid:** Releasing work to inactive/full cells or changing a code without replacing the physical label.

## 24.6 Products {#module-products}

**Purpose:** Define SKU identity, client ownership, rotation, tracking, temperature, and handling behavior.  
**Normal users:** Admins, managers, and inventory clerks.  
**Normal use:** Create or import verified SKU/name/barcode/owner data; set FIFO/FEFO, lot/expiry, and temperature controls; hide discontinued products.  
**Handoff:** Create one appropriate default Packaging Profile before receiving.  
**Avoid:** Guessed SKUs, unknown rotation values, duplicate barcodes, or temperature rules that conflict with storage.

## 24.7 Packaging Profiles {#module-packaging-profiles}

**Purpose:** Connect physical each/case/pallet units and barcodes to receiving and handling quantities.  
**Normal users:** Admins, managers, and inventory clerks.  
**Normal use:** Configure pack sizes, dimensions, weights, barcodes, and one default profile per normal pack style.  
**Handoff:** Receiving uses the profile to interpret product scans and pallet quantities.  
**Avoid:** Multiple defaults or a units-per-package value that does not match the physical pack.

## 24.8 Receiving {#module-receiving}

**Purpose:** Create receipts, shipment drafts, pallet identities, lot/expiry context, labels, and downstream Put-Away work.  
**Normal users:** Admins, managers, and inventory clerks.  
**Normal use:** Confirm warehouse/container/PO; scan and commit product; enter physical quantities and trace fields; verify; receive once; print labels; release Put-Away. For an authorized Inventory pallet correction, keep the product locked, correct quantity/expiry, confirm the pallet's physical location, then update in place or print a replacement label as directed.

**Handoff:** Labeled pallets and tasks move to Put-Away; incomplete work remains an identifiable Saved Draft in the receiving area.  
**Avoid:** Skipping the product commit arrow, accepting a learned suggestion without counting, guessed SKUs, or posting offline.

## 24.9 Put-Away {#module-putaway}

**Purpose:** Store a received pallet in an exact eligible location and make stock available.  
**Normal users:** Admins, managers, clerks, and operators.  
**Normal use:** Select task; scan pallet; scan exact cell or choose a bay cell; verify physical/temperature capacity; place; confirm once.  
**Handoff:** Inventory Search reflects the stored location and the task clears.  
**Avoid:** Treating a bay code as final, forcing a blocked cell, or trusting stale pre-disconnect state.

## 24.10 Inventory Search {#module-inventory-search}

**Purpose:** Show the live pallet, quantity, status, ownership, lot, location, and movement record.  
**Normal users:** All approved operational roles.  
**Normal use:** Search by pallet, SKU, product name, lot, warehouse, zone, or location; read SKU, Product, then Pallet in the results; open detail and history; compare with the physical floor before acting. Authorized users can return an eligible, unreserved stored pallet to Receiving for controlled correction.

**Handoff:** Use the verified record to justify a pick, move, transfer, status change, count, or correction.  
**Avoid:** Ignoring filters or acting from a dashboard snapshot, memory, or stale paper.

## 24.11 Pick Lists {#module-pick-lists}

**Purpose:** Create, release, assign, and execute outbound whole-pallet work.  
**Normal users:** Admins, managers, supervisors, and warehouse operators.  
**Normal use:** Manager confirms demand/stock/staging and releases executable tasks; operator scans assigned location and whole pallet, confirms, and stages it.  
**Handoff:** Completed pallets move to the directed outbound lane or transfer/dispatch process.  
**Avoid:** Releasing short work, splitting a pallet in normal execution, or confirming a physical quantity mismatch.

## 24.12 Transfers {#module-transfers}

**Purpose:** Preserve pallet identity between warehouses with source, in-transit, destination, and driver handoff history.

**Current state:** Temporarily disabled for every role; the route and transfer operations show or enforce that state.

**Current use:** None. Managers must use the approved manual containment, movement, paperwork, and reconciliation process until a release explicitly re-enables the module.

**Handoff:** Reconcile the physical pallet and Inventory Search record before resuming system work.

**Avoid:** Using Location Moves to imitate a transfer or attempting to restore the module through saved navigation preferences.

## 24.13 Location Moves {#module-location-moves}

**Purpose:** Relocate a pallet inside the same warehouse while preserving identity and audit history.  
**Normal users:** Admins, managers, inventory clerks, supervisors, and operators.  
**Normal use:** Scan a stored pallet; verify live state; scan/type/Browse bays; choose exact eligible destination; move; confirm once. Pallets still in Receiving/not put away and terminal states are blocked.

**Handoff:** Inventory Search shows the destination; queued/in-progress work may be cancelled when plans change.  
**Avoid:** Using a Move across warehouses, posting into a disabled/full/incompatible cell, or treating a bay as final.

## 24.14 Cycle Counts {#module-cycle-counts}

**Purpose:** Plan blind physical counts, review exceptions/variances, and maintain controlled adjustment history.  
**Normal users:** Admins, managers, clerks, supervisors, and operators.  
**Normal use:** Manager creates/assigns CCT scope; operator verifies location and submits the physical count online; supervisor reviews threshold variance and notes.  
**Handoff:** Approved corrections update stock and feed root-cause action.  
**Avoid:** Counting expected values, ignoring thresholds, or approving stale state after reconnect.

## 24.15 Statuses {#module-statuses}

**Purpose:** Keep restricted stock visible through Available, Hold, Quarantine, Damaged, or Missing states.  
**Normal users:** Admins, managers, supervisors, and inventory clerks.  
**Normal use:** Verify the pallet and condition; choose the justified status; enter a meaningful reason; add System Log ownership when follow-up is required.  
**Handoff:** The corrected status controls availability in picking and other operations.  
**Avoid:** Marking Damaged/Missing on assumption or returning stock to Available without authorization.

## 24.16 Reports {#module-reports}

**Purpose:** Provide management snapshots across stock, occupancy, expiry, movement, count, and operational performance.  
**Normal users:** Admins, managers, supervisors, and inventory clerks as authorized.  
**Normal use:** Review trends and export approved reports; identify a bottleneck; open the underlying module or Inventory Search for transaction detail.  
**Handoff:** Assign improvement/action owners and verify later performance.  
**Avoid:** Treating aggregated reports as a substitute for live task or pallet records.

## 24.17 Users & Roles {#module-users-roles}

**Purpose:** Create, approve, authorize, badge/PIN-enable, disable, and audit user access.  
**Normal users:** Admins; managers/supervisors may view or perform only configured actions.  
**Normal use:** Create/approve; assign least privilege; issue credentials; test access; hide a role or disable a profile non-destructively.  
**Handoff:** Reassign open operational work before changing access.  
**Avoid:** Shared credentials, excessive roles, deleting audit history, or disabling a person mid-task.

## 24.18 System Log {#module-system-log}

**Purpose:** Record operational issues, support notes, RF alerts, snapshots, ownership, and resolution status.  
**Normal users:** Admins and warehouse managers.  
**Normal use:** Review severity and evidence; assign an owner; investigate the underlying transaction; resolve only after the real condition is corrected.  
**Handoff:** Quality, customer, IT, or warehouse action is traceable to closure.  
**Avoid:** Using a log instead of the required inventory/status transaction or acknowledging RF recovery without checking the floor.

## 24.19 Email Log {#module-email-log}

**Purpose:** Show outbound email attempts, templates, recipients, delivery states, and failure details.  
**Normal users:** Admins.  
**Normal use:** Search the user/message; verify recipient/template/status/error; correct the cause; retry through the approved workflow or escalate provider/DNS/suppression issues.  
**Handoff:** Confirm delivery before telling the user an invitation or recovery message succeeded.  
**Avoid:** Repeated retries without reading the error.

## 24.20 Settings {#module-settings}

**Purpose:** Group environment guidance, Warehouse Structure, Users & Roles, setup access, release information, and controlled administrative actions.  
**Normal users:** Admins and warehouse managers, with admin-only destructive controls.  
**Normal use:** Review the relevant tab; change only the intended configuration; verify downstream labels/users/workflows; document consequential changes.  
**Handoff:** Return to the affected operational module and confirm normal use still works.  
**Avoid:** Reset without a rebuild plan, broad “while here” changes, or structure edits without label replacement.

## 24.21 Help Center {#module-help-center}

**Purpose:** Provide searchable and contextual product guidance for approved users.  
**Normal users:** Everyone.  
**Normal use:** Open contextual Help from the current module; review key actions and mistakes; search by module, workflow, error, or operational term; follow the current version.  
**Handoff:** Return to the task only when the normal next action is clear; use `operational-dead-ends` for floor/system disagreement.  
**Avoid:** Following an outdated printout or searching only one exact title.

## 24.22 Setup Wizard {#module-setup-wizard}

**Purpose:** Create or extend warehouses, zones, and generated bin locations from a reviewed structure.  
**Normal users:** Admins and warehouse managers; execution/reset controls remain authorization-dependent.  
**Normal use:** Define facilities; define zones; define location-generation rules; review totals/codes; create; print/install labels; verify Warehouse Structure.  
**Handoff:** Products/packaging are prepared and operational work is released only after physical structure matches the system.  
**Avoid:** Running without the physical design, accepting inconsistent codes, or treating the wizard as a routine correction tool after go-live.

## 25. Revision and source map

### Revision 1.1 — 17 August 2026

- Added the controlled Inventory pallet correction workflow, including quantity-only **Update & Close**, expiry/relabel handling, cancellation, and Put-Away requirements.
- Documented batch return from Put-Away to Receiving and removal of returned/cancelled tasks from the active queue.
- Added Product identification in Inventory Search and the **SKU → Product → Pallet** result order.
- Documented Location Move blocks for not-yet-put-away and terminal pallets.
- Marked cross-warehouse Transfers as temporarily disabled and supplied the approved escalation principle.
- Clarified location position versus depth/capacity and Warehouse Structure occupancy behavior.

This manual is parallel to the in-app Help Center and expands it into role-based standard work. Product-specific behavior was mapped from:

- `src/lib/help-content.ts` — contextual route guidance and searchable Help articles;
- `docs/admin-guide.md` — setup, master data, operational flow, go-live, and Lean/Six Sigma controls;
- `README.md` — supported routes, roles, and operational workflows;
- `WW-SOP-Standard-Work-Cards.docx` — floor-ready standard work cards.

When product behavior changes, update the in-app Help article and the matching stable section here in the same release cycle.
