# Make PLT-735061111DTT (and any pallet like it) appear in Put-Away

## What's actually wrong

The pallet exists, has 50 units, no location, and status `putaway` — but the Put-Away queue only lists **open Put-Away tasks**, not pallets. This pallet's task (PTA-736896176TAW) was cancelled on 28 Aug when it was returned to Receiving. Since then its status was changed twice from the Statuses module (receiving -> missing -> putaway, "pallet found that was on racking but not scanned").

Changing a status does not create a Put-Away task, so the pallet is now in a state nothing shows: not in Receiving drafts (that draft is gone), not stored, and not in the Put-Away queue.

## Fix

### 1. Repair this pallet (data)

Queue a fresh Put-Away task for PLT-735061111DTT in its warehouse, with its quantity and no assignee, so it shows in the queue immediately. Keep the pallet at status `putaway`, unstored, no location.

### 2. Stop it recurring (code)

In the status-change flow (`src/features/status/status-core.ts`, `changePalletStatus`): whenever the resolved status becomes `putaway` and the pallet has no location, ensure an open Put-Away task exists — reuse an open one if present, otherwise create one (new task number, warehouse from the inventory balance, suggested location left blank for directed put-away to fill). This covers both the explicit "putaway" status and the "release" path that resolves to `putaway`.

### 3. Catch the general case

Add a check to the existing occupancy/integrity audit surface: list pallets with status `putaway`, `is_stored = false`, no location and **no open Put-Away task** — orphans invisible to operators — with a one-click "Queue Put-Away task" repair. Today there is exactly one such pallet (this one).

## Technical notes

- Task creation mirrors the shape used by `recover_missing_pallet_to_putaway` (task number via `inventory_correction_code`/`buildPalletCode` prefix `PTA`, status `queued`, `assigned_user_id` null).
- Preferred: do the ensure-task work in a small `SECURITY DEFINER` function so the client cannot create tasks in warehouses it cannot access, called from `changePalletStatus` after the status update.
- Audit event `putaway_task_requeued` written alongside the existing `status_change` event.
- Tests: unit test that a status change to `putaway` on an unstored pallet results in a queued task, and that an existing open task is not duplicated.
- No UI redesign; the Put-Away queue itself is unchanged.
