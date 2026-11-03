# Event-driven forward-pick replenishment (Option 2)

## Goal
Replenishment tasks appear the moment a pick face drops, instead of waiting for the next 5-minute check. The blind 5-minute poll becomes a slow safety net.

## What changes for operators
- Confirming a pick (normal or trip pick) that takes a pick face below its minimum creates the replenishment task immediately.
- Releasing a pick list / importing a NetSuite order pre-replenishes affected pick faces right away.
- Stock adjustments, cycle-count approvals and moves out of a pick face also re-check that face.
- Behaviour, thresholds and the 30-day learning window are unchanged.

## How it works
1. **Targeted evaluator**: add a per-product/per-location version of the current check, so a single event only re-evaluates the affected pick face (not the whole warehouse). The existing whole-warehouse check stays for the safety net.
2. **Database triggers** (fire after the change is saved, same transaction):
   - inventory balance quantity drops at a pick-face location
   - pick task completed / shorted
   - pick list released, order fulfillment lines inserted (demand)
   - pick-face slot min/max edited
3. **De-duplication**: the evaluator already skips faces with an open replenishment task; triggers reuse that so repeated picks never create duplicate tasks.
4. **Failure isolation**: trigger errors are caught and logged to system logs — a replenishment failure never blocks a pick confirmation.
5. **Safety net**: reschedule the existing job from every 5 minutes (288 runs/day) to hourly (24 runs/day), catching anything missed.

## Technical details
- New additive migration: `evaluate_pick_face_replenishment(p_product_id, p_location_id)` SECURITY DEFINER, `search_path = public`, revoked from anon; refactor shared logic so `evaluate_forward_pick_replenishment` loops over it.
- Statement-level-safe AFTER triggers on `inventory_balances`, `pick_tasks`, `pick_lists`, `order_fulfillment_lines`, `pick_face_slots`, guarded with `pg_trigger_depth()` to avoid recursion when the replenishment task itself moves stock.
- `cron.schedule('evaluate-forward-pick-replenishment', '0 * * * *', ...)` replaces the 5-minute job by name.
- Audit events continue to be written by task creation.
- Tests in `src/test/**`: one face below min after pick creates exactly one task; second pick creates no duplicate; failing evaluator does not abort pick confirmation.
- Help topic + release history + version bump on publish.

## Out of scope
NetSuite sync logic, UI changes to the Replenishment page.
