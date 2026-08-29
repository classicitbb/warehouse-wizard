# Pallet Pack Standards — implementation plan

**Status:** plan only, nothing implemented.
**Branch:** `claude/pallet-packaging-profiles-n96nce`
**Interactive version (schema tables, placement matrix, live isometric prototype):**
https://claude.ai/code/artifact/e1c6b7d5-5737-44b2-9c2e-f6c4378abe7e

Goal: turn `product_packaging_profiles` from a package-dimension template into the
**pallet build standard** for a SKU — `6 × 8` meaning six cases per layer, eight
layers — so receiving, slotting, and put-away all work from the same number.

---

## 1. Why the current profile does nothing

Evidence from the current tree:

| Where | Problem |
| --- | --- |
| `src/features/receiving/receiving-core.ts:203` | `pallets.height` is set to `packagingProfile?.height ?? product.height` — the **carton** height. Every downstream height rule compares a 22 cm carton against a 190 cm bin, so every height rule passes. |
| `src/features/putaway/putaway-core.ts:76` | `confirmPutaway` calls `validatePutawayAssignment()` without `palletHeightCm` / `locationMaxPalletHeightCm`, so the height branch at `core-types.ts:713` is unreachable. Put-away has **no** height rule today. |
| `locations.max_height` vs `locations.max_pallet_height_cm` | Two ceilings. `moves-core.ts:394` reads `max_height ?? max_pallet_height_cm`; `directed_putaway_candidates` reads only `max_height`; the Bin Locations form exposes only `max_height`. |
| `src/features/receiving/receiving-page.tsx:1682` | The Packaging select lists **every** profile in the database, unfiltered by product, inside a collapsed "Lot, batch, and packaging" section, defaulting to empty. |
| `src/lib/ai-assist.ts` → `getProductPalletQtyHint()` | Qty per pallet is suggested from prior pallets — a fine fallback, a poor standard. |

---

## 2. Data model

**Vocabulary rule.** "6 per layer" means six *cases*, but `pallets.quantity` and the
receiving form are in stock units. Keep both: `units_per_package` (already means
"stock units inside one handling unit") stays; the new columns count **packages**,
matching floor vocabulary. The system derives the receipt-unit number.

### New columns on `product_packaging_profiles`

| Column | Type | Purpose |
| --- | --- | --- |
| `packages_per_layer` | `int` | The **6**. |
| `layers_per_pallet` | `int` | The **8**. |
| `layer_pattern` | `text` | `block` \| `brick` \| `pinwheel` \| `column` \| `custom`. Drives the render and the printed layer map. |
| `layer_columns` | `int` | Cases across the long side; null derives a near-square grid. |
| `pallet_footprint_length_cm` / `..._width_cm` | `numeric` | Base footprint incl. overhang. Warehouse default, per-profile override. |
| `pallet_base_height_cm` | `numeric` | Empty pallet deck height. Default `14.5`. |
| `slip_sheet_height_cm` | `numeric` | Tier sheet between layers. Default `0`. |
| `pallet_tare_kg` | `numeric` | Empty pallet weight, for the bin weight rule. |
| `max_stack_pallets` | `int` | Can a standard pallet be double-stacked in a bin. |
| `quantity_tolerance` | `int` | Units of slack before a receipt is flagged off-standard. Default `0`. |
| `is_pallet_standard` | `bool` | This profile is *the* build standard for the SKU. Partial unique index, one per product. |
| `build_notes` | `text` | "Labels face out", "corner posts on top layer". |
| `fit_status` / `fit_checked_at` / `fit_summary` | `text` / `timestamptz` / `jsonb` | Cached storability verdict (§5). |

### Generated columns (`generated always as … stored`)

| Column | Expression |
| --- | --- |
| `packages_per_pallet` | `packages_per_layer * layers_per_pallet` — the **48** |
| `units_per_pallet` | `units_per_package * packages_per_pallet` — what the receiving form uses |
| `standard_height_cm` | `pallet_base_height_cm + layers_per_pallet * (height + slip_sheet_height_cm)` |
| `standard_gross_weight_kg` | `pallet_tare_kg + weight * packages_per_pallet` |

`length` / `width` / `height` / `weight` keep their current meaning as **package**
dimensions. Only the code that mistook them for pallet dimensions changes.

All four derived columns resolve to `NULL` when their inputs are null, so every
existing profile keeps working untouched.

### No blind backfill

Existing profiles get nulls, not guesses. The editor offers **Suggest from history**
(factoring observed pallet quantities into candidate layer × layer pairs) for a
supervisor to confirm. Inferring a standard from unlabelled history and then
enforcing it is how a validation feature starts rejecting correct pallets.

---

## 3. Where operators meet it

Show the *smallest* thing that answers the question in hand. The full isometric
view earns its space at build time and nowhere else.

| Surface | Moment | What it shows | Form |
| --- | --- | --- | --- |
| Shipment / pallet dialog (`receiving-page.tsx`) | Planning the split | `6×8 · 48` chip beside **Qty per pallet**, a **Use standard** button, and a build plan for the remainder pallet: "Pallet 4 of 4 — 36 units, 3 layers + 6". | Inline chip |
| Draft pallet row | Building & verifying | Next to Qty: `Qty 48 · 6×8 ✓` or `Qty 36 · 6×8 · short 12` in amber. Tap opens Pack view. | Inline text |
| **Pack view** | At the stack | The isometric render at this pallet's actual quantity. Right-hand rail at ≥ `xl`, `Sheet` on everything smaller — the pattern `help-sidebar.tsx` already uses. | Sheet / rail |
| Pallet label (`pallet-label-page.tsx`) | Physical stacking | Large `6 × 8` plus a **top-view layer map** (six boxes drawn 3×2) and a `STANDARD` / `SHORT 36/48` stamp. **Not** the isometric view — a stacker needs the layer pattern, and 3D on a thermal label is ink, not information. | Print block |
| Put-away confirm (`putaway-page.tsx`) | Placing it | 2D side elevation: pallet 190 cm vs bin clearance 180 cm, overflow hatched red. Height is one-dimensional and deserves a one-dimensional picture. | Inline strip |
| Profile editor (`resource-page.tsx`) | Setup | Live render as numbers are typed, plus the fit verdict before save. | Panel |
| Inventory detail / cycle count | Audit | Static render at the recorded quantity. | Panel |

**The change that decides whether any of this lands:** selecting a product must
auto-assign its default standard profile, and the profile list must filter to that
product. Fix the assignment path first — the visuals are worth nothing on an
unassigned profile.

### Renderer

Inline SVG, isometric projection, generated polygons, painter's-algorithm depth
sort. No 3D library: this runs on the same cheap Android scanners as the rest of the
floor UI, has to survive the print path, and has to render inside a `Sheet` on a
5-inch screen. WebGL buys rotation the operator does not need for ~½ MB.

Depth sort: pallet base first, then cargo by `(z, x + y)` ascending. A single
`x + y + z` key is wrong here because the deck slab and the cartons are different
sizes — the deck paints over the boxes standing on it.

Above ~600 boxes, collapse each layer into one extruded slab with a count badge.

A working prototype of the exact renderer is in the artifact linked at the top.

---

## 4. One height, carried end to end

1. **Receiving writes the real height.** `pallets.height` becomes
   `profile.standard_height_cm`, falling back to today's carton/product value when
   no standard is set. Same fix in the pallet-correction and pallet-recovery RPCs,
   which clone pallet rows.
2. **One definition of a bin's ceiling.** `resolveLocationClearanceCm(location)` in
   `core-types.ts` returns the least non-null of `max_height` and
   `max_pallet_height_cm`, with a matching SQL expression. Switch every call site:
   `moves-core.ts:394`, `putaway-core.ts`, `directed_putaway_candidates`.
3. **Put-away actually checks.** `confirmPutaway` passes `palletHeightCm` and
   `locationMaxPalletHeightCm`, waking the dead branch. The existing
   `RULE_VIOLATION:` prefix means the override UI needs no change.
4. **Blocked before the tap, not after.** The bay picker already knows the task's
   pallet. Bins whose clearance is short render disabled with the reason inline
   ("−14 cm"); a scanned short bin is refused at scan time with the same wording.

### Slotting: like products, like bin sizes

`directed_putaway_candidates` gains a hard filter on effective clearance plus three
scoring terms:

- **Best fit, not first fit** — `+18 × max(0, 1 − headroom/60)`. Stops a 90 cm
  pallet consuming a 240 cm bay while tall pallets queue. Biggest cube-utilisation
  win in the change.
- **Height bands** — profiles and bins both resolve to a band
  (≤110 / ≤140 / ≤170 / ≤200 / >200). Same band scores, and it gives operators a
  vocabulary and the fit test something legible to report.
- **Family and SKU affinity** — `+10` when the zone already holds the same
  `product_family`, `+6` when the bin already holds this SKU. Existing mixed-SKU
  penalty stays.

Carried to the operator through the existing `reason` string:
`height_band_fit; family_zone; snug_9cm`.

---

## 5. The fit test

New RPC `packaging_profile_fit_report(in_profile_id uuid, in_warehouse_id uuid)`
counts bins that can actually take this standard pallet — clearance, footprint,
gross weight, temperature class, family restriction — and returns the count, a
per-zone breakdown, what disqualified the rest, and the largest layer count that
*would* fit.

| Verdict | Condition | What the manager is told |
| --- | --- | --- |
| `pass` | Eligible bins in ≥ 2 zones, above the floor threshold | "214 of 980 bins across Zones A, B, D." |
| `warn` | < 5 bins, or every eligible bin in one zone | "Only 4 bins fit, all in Zone D. One outage and this SKU has nowhere to go." |
| `fail` | No eligible bin | "190.5 cm exceeds every bin in this warehouse. 7 layers (168.5 cm) would fit 214 bins." |

A failing verdict always carries the remedy, and the remedy is a number — drop a
layer, or raise a clearance.

Runs on profile save, on demand from the profile row, and in bulk from the Bin
Locations gear menu (bin heights changing invalidates every verdict). Cached
`fit_status` drives a green / amber / red chip in the profiles table.

---

## 6. Build order

Each phase is shippable on its own.

1. **Schema and the silent height bug** — additive migration, generated columns, the
   clearance helper, the `pallets.height` fix. No UI. Worth shipping alone: it
   corrects a height rule that has been passing everything.
   `+ supabase/migrations/…_pallet_pack_standards.sql` · `~ receiving-core.ts`,
   `core-types.ts`, `moves-core.ts` · `+ src/test/pack-standard-math.test.ts`
2. **Profile editor and the fit test** — layer fields on the Packaging Profiles form,
   the shared `PalletStackPreview` component, the fit-report RPC, the status chip.
   `+ src/components/pallet-stack-preview.tsx` · `~ core-types.ts`
   (`RESOURCE_DEFINITIONS`), `resource-page.tsx` ·
   `+ src/test/packaging-profile-fit.test.ts`
3. **Receiving: assignment and conformance** — auto-assign the default standard on
   product select, filter the profile list to the product, standard chip and
   **Use standard** beside Qty per pallet, conformance on draft rows, `6 × 8` and
   layer map on the label.
   `~ receiving-page.tsx`, `ui-shared.tsx`, `pallet-label-page.tsx` ·
   `~ src/test/receiving-page.test.tsx`, `receiving-shipment-math.test.ts`
4. **Pack view** — the sheet, wired to the shipment dialog and each draft row,
   docking as a right rail at ≥ `xl`.
   `+ src/components/pack-view-sheet.tsx` · `~ receiving-page.tsx`
5. **Slotting and put-away enforcement** — new scoring, the height block,
   bay-picker pre-validation, the height silhouette. Last, because it is the only
   phase that can stop an operator mid-task.
   `+ supabase/migrations/…_slotting_height_bands.sql` · `~ putaway-core.ts`,
   `putaway-page.tsx` · `~ src/test/putaway-page.test.tsx`

Feature-flag note: the `packaging` module flag is `false` in `STARTER_MODULES`. Gate
the new UI behind it; the height correctness fixes in Phase 1 ship ungated, since
they are no-ops when no profile is assigned.

---

## 7. Open decisions

1. **Can a supervisor override a height block?** Temperature and mixed-SKU are
   overridable today. Height is different in kind — a 190 cm pallet does not fit a
   180 cm bay regardless of who authorises it.
   *Recommend:* hard block, no override.
2. **Does the standard beat the learned hint on Qty per pallet?**
   *Recommend:* standard wins; `getProductPalletQtyHint()` fills only when no
   standard exists. Surface disagreement beyond tolerance — it is a real signal
   about either the standard or the floor.
3. **Which pallet footprint?** 120 × 100 (EUR2) and 121.9 × 101.6 (GMA 48 × 40) are
   close enough to look identical and far enough apart to fail a footprint check.
   *Recommend:* warehouse-level default with a per-profile override.
4. **What happens on an off-standard receipt?** Short pallets are normal — the last
   pallet of a run almost always is.
   *Recommend:* warn and record the variance, never block. A blocked receipt gets
   worked around invisibly; a recorded variance is data the fit test and slotting
   scores can use.
