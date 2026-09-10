# Pallet Pak Designer polish + Packaging Profiles rework

## 1. Pallet Pak Designer (Packing tab)

**SKU picker actually loads.** The picker currently pulls every column of all
3,702 active products through the shared admin option loader, which is slow
enough that the list looks empty. Replace it with a narrow read (id, SKU, name,
barcode, plus which products already have a saved profile) so the drop-down
behaves like the Receiving/Picking product search: opens instantly, full list,
type or scan to filter.

**Saved profile loads on selection.** Selecting a SKU that already has a saved
pack standard fills the designer with that build (cases per layer, layers,
carton size, deck/slip heights, footprint) and the header shows "Editing
<profile name>", with the button reading "Update pack standard". Selecting a
SKU with nothing saved shows a clear "No pack standard yet — you're creating
one" notice and the button reads "Save as pack standard".

**Status colour in the SKU list.** Each row in the drop-down carries a small
dot and label: green "Saved" when the product already has a pack standard,
amber "Not created" when it does not. Same badge next to the chosen SKU in the
header.

**Pallet drawn orange.** The pallet deck and blocks under the cargo change from
the grey muted tone to the warning (orange) token, so the pallet reads as a
pallet instead of ghosted-out filler. Cargo colours are unchanged.

**Pack code in the sidebar.** The sidebar gets the pack code (e.g. `12 × 7`)
above "Cases on pallet", with the plain-language line "12 cases per layer × 7
layers". Deliberately duplicated from the stage so the sidebar carries the full
pallet readout.

**Developer preview chip removed** from the designer header (and any other view
showing it).

**Tablet & mobile layout review.** Today the workspace is a two-column grid that
only splits at very wide screens, and the big pack code overlaps the stack on
narrow screens. Changes: stack the picture, the controls and the sidebar in one
column below tablet width; move the pack code above the picture instead of
floating over it on small screens; make the unit switcher and sliders
finger-sized; keep the save button reachable (sticky at the bottom on mobile);
allow the sidebar readouts to sit two-up on tablet rather than one tall column.

## 2. Where the Packing tab gets unlocked

Right now the tab is locked for everyone except developers, and it cannot be
unlocked from the UI: the permission list has no `pack_designer` entry at all,
and the release flag the code checks (`is_released`) does not exist in the
database. To make it public we will:

- add the missing release flag column and a `Pallet Pak Designer` permission
  entry;
- expose it in **Settings → Users & Roles → Role Matrix**, where an admin ticks
  view/edit per role and flips one "Released" switch to take it out of
  developer preview.

After that, unlocking is a switch in Settings — no code change.

## 3. Packaging Profiles page toolbar

- Gear menu holds: Export CSV, Show/Hide archived, Download template, Import CSV.
- A separate primary **New profile** button sits beside the gear.

## 4. Create Packaging Profile dialog — rebuilt around the pack code

New flow, top to bottom, matching how the floor actually works:

1. **Product** — the same fast SKU search as the designer, with the
   Saved / Not created badge.
2. **Pack code** — one field, typed as `12x7`, `8x6`, `20x5`, `10x4`. It parses
   into cases per layer and layers per pallet, and shows "12 × 7 · 84 cases per
   pallet" underneath. The two individual numbers stay visible and editable.
3. **Details (auto-filled, editable)** — profile name defaults to the pack code,
   package type defaults to the product's last used type or "case", units per
   package defaults to the product's existing value or the last profile for that
   SKU, falling back to 1. None of the three has to be typed to save.
4. **Optional build detail** — carton dimensions, deck/slip heights, footprint,
   tare, tolerance, notes, collapsed by default.
5. **Pallet standard** switch, as today.

A **Save and add another** action keeps the product cleared but the settings
warm, so a clerk can rattle off a run of profiles from memory or from a
container without reopening the dialog each time. Same dialog is reachable from
Receiving so a profile can be created mid-receipt.

## Technical notes

- New narrow product+profile read for the pickers, replacing
  `fetchOptions(... ["products","packagingProfiles","warehouses"])` in
  `pallet-pak-designer.tsx`; paged with `fetchAllRows` so all 3,702 rows arrive.
- `packStandardDraftFromProfile` already exists and is reused for load-on-select;
  save switches to an update when a profile for that SKU is being edited.
- Pallet fill: `KIND_FILL["pallet-block"] / ["pallet-deck"]` →
  `hsl(var(--warning))` in `pallet-stack-preview.tsx`.
- Migration: `alter table permission_features add column is_released boolean not
  null default false` (additive) plus an insert of the `pack_designer` feature
  and default role grants; `has_feature_permission()` updated to honour the flag
  with a developer exemption. Existing features backfill to released so nothing
  currently visible disappears.
- `useGearActions` in `resource-page.tsx` extended to
  `product_packaging_profiles`, with the Add action promoted out of the menu to
  a standalone button for this table.
- Pack code parsing helper (`parsePackCode`) added next to `formatPackCode` in
  `src/lib/measure.ts`, with unit tests; dialog changes covered by tests
  alongside `src/test/pack-standard-form.test.tsx`.
- Version bump to 1.29.5 with release notes, What's New and packaging help topic
  updates.
