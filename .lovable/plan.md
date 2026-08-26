# Square scan targets, 1-second dwell, and staging-only pallet edit

Three related changes: the scanner reticle and acceptance timing, and tightening where and how a stored pallet can be edited.

## 1. Square scanner target for pallet and bay codes

Today the scan window is a fixed 256x144 rectangle inside a 16:9 camera frame. For pallet (`PLT-`) and bay/location scanning that shape encourages operators to frame QR codes badly.

- The default reticle becomes a square (equal width and height, sized to fit the shorter side of the camera frame) for all non-container scan modes.
- Container-number scanning uses a vertical (portrait) reticle so the camera frames the full container door height rather than a horizontal text band.
- Corner markers, dim mask, and the green "found" state stay exactly as they are, just on the square frame.

## 2. One-second dwell before a code is accepted

Currently a detected barcode is turned into a pending scan on the first frame that decodes it, then auto-inserts after a short preview.

- A candidate must be seen continuously for **1000 ms** before it is accepted.
- The same value must keep decoding during that second; a different value restarts the timer, and losing the code cancels it.
- While the dwell runs, the reticle shows the "holding" state with a visible progress/countdown cue and the candidate value, so operators know to keep the code steady.
- After the dwell completes, existing behaviour continues unchanged: auto-insert, or the "Use" confirm button where `requireConfirm` is set.
- Manual keyboard/wedge entry and the confirm button are unaffected.

## 3. Pallet edit is only available from the Put-Away Staging location

Live data confirms `STG-01-A` (zone STG, "Put-Away Staging") and the receiving staging spots are the locations flagged `location_type = 'staging'`.

- On Inventory Detail, the **Edit pallet** button is enabled only when the pallet's current location is a staging location (`STG-01-A` / Put-Away Staging). All existing blocks (reserved stock, superseded, no pallet) still apply.
- When the pallet is stored anywhere else, the button is disabled and an inline hint appears:
  "A pallet can only be edited from Put-Away Staging (STG-01-A). Move it there first."
  next to a **Go to Location Moves** button that opens Location Moves pre-filled with this pallet's barcode and `STG-01-A` loaded as the bay code.
- The same rule is applied wherever the edit entry point appears so the button can't be reached from a non-staging pallet.

## 4. Opening the edit dialog changes nothing

Today the dialog calls `begin_inventory_pallet_correction` the moment it opens, which puts the pallet into a pending correction state and reserves a replacement pallet number. Cancel then has to call a second RPC to undo it.

- The dialog opens read-only: no RPC, no state change, no reserved pallet number.
- The correction draft is created lazily — only when the operator actually commits to an option (Save changes, or Save as draft), immediately before that action runs.
- **Cancel**, the X, and Escape simply dismiss the dialog. No RPC, no audit write, no status change, no toast claiming the pallet was "left unchanged".
- If a draft was already created earlier and is still pending (a resumed edit), Cancel keeps its current restore behaviour so nothing is left stranded.

## Technical notes

- `src/components/barcode-scan-button.tsx` — square default reticle (skip for `scanMode === "containerNumber"`), dwell tracking refs (candidate value + first-seen timestamp) inside the detection loop, dwell progress in the overlay.
- `src/App.tsx` (Inventory Detail) — extend `correctionBlockedReason` with the staging check; the detail query must return `locations.location_type`; render the hint + "Go to Location Moves" link.
- `src/features/inventory/pallet-edit-dialog.tsx` — remove the on-open `beginMutation` effect; run `beginInventoryPalletCorrection` inside the save/draft mutations; make Cancel a plain close when no draft exists.
- Tests: update `src/test/pallet-edit-dialog.test.tsx` for the deferred begin and no-op cancel; add coverage for the dwell gate and the staging gate.
- Version bump and release notes on publish per project policy.
