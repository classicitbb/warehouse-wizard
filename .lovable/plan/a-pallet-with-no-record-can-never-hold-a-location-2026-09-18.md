# A pallet with no record can never hold a location

A pallet that has lost its stock record — or that somehow appears "available" without
ever having been received and put away — must not be counted as stored and must not
occupy a bay. Today the app can show such a pallet with a location, and Location Moves
or Put-Away will happily work with it.

Checked against live data: there are currently no pallets in this state, so this change
is about preventing and catching it, not cleaning up a known mess.

## What changes

1. **Scanning one is refused, with a way out.**
   In Put-Away and Location Moves, scanning a pallet that has no stock record stops with
   a plain message — "This pallet has no stock record, so it cannot be stored" — plus a
   button that opens a receiving draft for that pallet so staff can re-record what is
   physically on it. Completely unknown numbers keep the existing "not found" refusal.

2. **It stops counting as occupying the bay.**
   Bay occupancy, capacity checks and the pallets-in-location counts ignore any pallet
   with no stock record, so the bay immediately shows the space as free and put-away
   suggestions can use it again.

3. **A supervisor banner lists them for clearing.**
   Nothing is cleared automatically. A warning panel (same style as the existing
   "waiting for Put-Away with no task" banner) appears on Inventory and Put-Away for
   admins, managers and supervisors, listing every pallet that has no stock record but
   still shows a location, with two actions per row:
   - **Release location** — frees the bay and marks the pallet Missing, so
     Statuses > Missing remains the undo path.
   - **Re-receive** — frees the bay and opens a receiving draft for it.

4. **Pallets with no provenance are treated the same way.**
   A pallet holding a location with no receiving line behind it and no completed
   put-away or move is flagged in the same banner, because there is no record of how it
   got there.

5. **Inventory Search keeps showing them.** The existing "no record" tag stays, with the
   location column reading "not stored" instead of a bay code.

## Technical notes

- Detection lives in one shared helper (`src/features/inventory/inventory-core.ts`) so
  Inventory, Put-Away and Moves all use the same definition: a pallet row with no live
  `inventory_balances` row, or a located pallet with `receipt_line_id` null and no
  completed `putaway_tasks`/`move_tasks`.
- `src/features/moves/moves-core.ts`: extend the existing pallet validation
  (`validateMove` / direct-scan and task paths) with a no-record check before any
  location work, returning the refusal reason and a `canReReceive` flag.
- `src/features/putaway/putaway-core.ts`: same check in the scan/confirm path; reuse
  `createReturnedPalletDraft` from `receiving-core.ts` for the re-receive action.
- Occupancy: `getStoredPalletCount` / `getBayOccupancy` and the
  `reconcile_location_occupancy` phantom definition already treat balance-less pallets
  as phantom — add the no-provenance case and expose a
  `listUnrecordedStoredPallets(warehouseId)` reader plus a
  `release_unrecorded_pallet_location(in_pallet_id, in_reason)` migration function that
  clears the location, sets `is_stored = false`, status `missing`, and writes an
  `audit_events` row.
- UI: new shared banner component used by `inventory-page.tsx` and `putaway-page.tsx`,
  role-gated to admin / warehouse_manager / warehouse_supervisor / developer.
- Tests: extend `src/test/putaway-orphans.test.ts`, `location-moves` and
  `stored-pallet-counts` specs — a no-record pallet is refused at scan, is not counted in
  bay occupancy, and release marks it Missing with the bay freed.
- Version bump, release notes, What's New, and Help topics for Put-Away, Location Moves
  and Statuses on publish.
