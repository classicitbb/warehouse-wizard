# Make pallet status say where the pallet actually is

Today a pallet keeps the status **Receiving** from the moment it is created in a
receiving draft right up until someone scans it into a bin — so a pallet sitting in a
draft and a pallet waiting on the dock to be put away look identical in the database.
The app papers over this by printing "Awaiting Put-Away" on screen for some of them.

This change makes the stored status match the real stage of the pallet.

## The four workflow statuses

| Stage | Status |
| --- | --- |
| Pallet exists only inside an unconfirmed receiving draft | **Receiving** |
| Receipt confirmed / labels printed, put-away task open | **Put-Away** |
| Scanned into a bin (has a location) | **Available** |
| Fully picked out | **Shipped** (unchanged) |

Everything else — Hold, Quarantine, Damaged, Missing, Reserved, In transit — stays a
manual decision made in the Statuses module.

## What changes

1. **Receiving.** Creating or editing a pallet in a draft keeps it Receiving. Confirming
   the receipt (and the labels-printed confirmation) flips the pallet and its inventory
   balance to Put-Away at the same moment the put-away task is queued.
2. **Returning a task to Receiving** puts the pallet back to Receiving, as it does now.
3. **Put-away confirmation** continues to set Available and record the location.
4. **Everywhere that currently treats "Receiving" as "not yet stored"** is taught to treat
   Put-Away the same way, so nothing regresses: the put-away queue and its offline
   re-check, Location Moves (a Put-Away pallet can still be moved), pallet edit rules,
   the phantom-occupancy reconciliation, the orphan-pallet cleanup, the pallet correction
   flows, and the dashboard/inventory counts.
5. **Screen wording.** Inventory and Status badges read "Receiving", "Awaiting Put-Away",
   "Put Away" and "Shipped" — the lifecycle label now reads the real status instead of
   guessing from Receiving plus a location.
6. **Statuses module.** The manual list becomes Hold, Quarantine, Damaged, Missing,
   Reserved, In transit. Available is removed from the manual list: a pallet becomes
   Available by being put away, and a pallet released from Hold returns to the status it
   should have (Available if it has a location, otherwise Put-Away). Releasing back to the
   right status is handled by the module, so nothing gets stranded.
7. **One-off correction of existing pallets.** Pallets with a location become Available;
   pallets with an open put-away task become Put-Away; pallets still tied to an
   unconfirmed draft stay Receiving. Hold/Quarantine/Damaged/Missing/Shipped rows are left
   alone. Inventory balances are corrected to match their pallet.

## Technical notes

- No new enum value is needed: `inventory_status` already carries `putaway`, currently
  unused.
- App code: `src/features/receiving/receiving-core.ts` (confirm paths only — draft
  creation keeps `receiving`), `src/features/putaway/putaway-core.ts` (accept `putaway`
  in the allowed-status check), `src/features/moves/moves-core.ts`,
  `src/features/shared/core-types.ts` (`isStoredPalletStatus`, `inventoryLifecycleLabel`,
  retired-status sets), `src/features/status/status-core.ts` and `status-page.tsx`
  (manual option list + release behaviour), `src/lib/wms-core.ts` pallet-edit rules.
- Database (additive migration): update `confirm_receiving_draft_labels_printed`,
  `return_putaway_to_receiving_draft`, `recover_missing_pallet_to_putaway`,
  `reconcile_location_occupancy`, the orphan-receiving reconciliation, and the four
  `*_inventory_pallet_correction` functions so `putaway` is handled wherever `receiving`
  is today.
- Data fix runs as a separate one-off data statement, not a schema migration.
- Tests: extend `pallet-edit-rules`, `location-moves`, `stored-pallet-counts` and
  `putaway-page` specs with the new status, plus a case asserting a confirmed receipt
  leaves the pallet as Put-Away and a draft pallet as Receiving.
- Version bump, release notes, What's New and the Help topics for Receiving, Put-Away and
  Statuses on publish.
