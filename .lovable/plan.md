# Block moves for pallets in an open put-away task + repair the permission matrix SQL

Two separate items.

## 1. Location Moves: reject pallets that belong to an open put-away task

Today a pallet scan in Location Moves is validated for pallet status, location status, capacity and freezes, but nothing checks whether the pallet already has a live put-away task. That pallet must be completed through Put-Away, not moved.

Behaviour to add:
- When a pallet is scanned (direct move and queued-task completion), look for a `putaway_tasks` row for that pallet whose status is not `completed` or `cancelled`.
- If one exists, the move is refused with a clear reason naming the task number and its current status, e.g. `Pallet PLT-… is on put-away task PTA-… (queued) — complete the put-away instead of moving it.`
- The validation result renders in the existing "Cannot move here" callout, and an audible no-go alarm plays (the same `playNoGoTone` used elsewhere on the floor screens) so the operator hears the rejection on a handheld.
- The Confirm/Complete buttons stay disabled while this rejection stands.
- The same check runs server-side in the move helpers so a stale UI can't slip a move through.

## 2. Permission matrix SQL from the last GitHub push

The pushed migration `20260820204306_role_permissions_matrix.sql` was never applied to the database — `permission_features` and `role_permissions` do not exist, which is why the admin Role Matrix screen (which reads and upserts those two tables) cannot load or save.

Two problems with the SQL as written:
- No `GRANT` statements. On this backend, a new public table without grants is unreachable from the app even with RLS policies in place, so the migration would still fail at runtime.
- Its seed references a `warehouse_supervisor` role code; the `roles` table only contains admin, developer, dispatch_driver, inventory_clerk, warehouse_manager, warehouse_operator. Those seed branches are simply inert, but the app does treat supervisors as a distinct level, so the seed should be written against the role codes that actually exist.

Fix: add a new additive migration (existing migration files stay untouched) that creates the two tables if absent, keeps the same policies, adds the required grants (`SELECT` to authenticated, full access to service_role, admin writes via policy), re-seeds `permission_features`, and seeds `role_permissions` for the real role codes so current navigation behaviour is preserved. No UI change needed — the Role Matrix code already targets these tables.

## Technical notes

- `src/features/moves/moves-core.ts`: add a `assertPalletNotInOpenPutaway`-style lookup used by `validateMoveDestination`, `completeDirectMove`, `completeMoveTask`, and the queue-a-move path.
- `src/features/moves/moves-page.tsx`: play `playNoGoTone()` from `@/features/shared/ui-shared` when a validation result comes back invalid (covers this and the other rejection reasons).
- New tests in `src/test/location-moves.test.ts` covering: pallet with a queued put-away task is rejected; pallet with only a completed/cancelled put-away task moves normally.
- New migration `supabase/migrations/<ts>_role_permissions_matrix_fix.sql` with table creation, grants, policies and seeds as described above.
