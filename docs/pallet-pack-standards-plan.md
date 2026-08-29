# Pallet Pack Standards — implementation plan

**Status:** Phase 1 in build. Phases 2–5 planned.
**Ratified:** height is a **hard block** at put-away (no override, no reason code); bin
clearances move to mm in Phase 1; clearance safety margin is **3 in / 76 mm**; container
staff are promoted through the existing Role Matrix; matrix enforcement may widen
`inventory_clerk` write access.
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
| `pallet_footprint_length_mm` / `..._width_mm` | `int` | Base footprint incl. overhang. Warehouse default, per-profile override. |
| `pallet_base_height_mm` | `int` | Empty pallet deck height. Default `145`. |
| `slip_sheet_height_mm` | `int` | Tier sheet between layers. Default `0`. |
| `pallet_tare_kg` | `numeric` | Empty pallet weight, for the bin weight rule. |
| `max_stack_pallets` | `int` | Can a standard pallet be double-stacked in a bin. |
| `quantity_tolerance` | `int` | Units of slack before a receipt is flagged off-standard. Default `0`. |
| `is_pallet_standard` | `bool` | This profile is *the* build standard for the SKU. Partial unique index, one per product. |
| `build_notes` | `text` | "Labels face out", "corner posts on top layer". |
| `revision` / `superseded_by_id` / `effective_from` | `int` / `uuid` / `date` | Profiles are versioned, never mutated — see §4. |
| `fit_status` / `fit_checked_at` / `fit_summary` | `text` / `timestamptz` / `jsonb` | Cached storability verdict (§6). |

### Generated columns (`generated always as … stored`)

| Column | Expression |
| --- | --- |
| `packages_per_pallet` | `packages_per_layer * layers_per_pallet` — the **48** |
| `units_per_pallet` | `units_per_package * packages_per_pallet` — what the receiving form uses |
| `standard_height_mm` | `pallet_base_height_mm + layers_per_pallet * (height_mm + slip_sheet_height_mm)` |
| `standard_gross_weight_kg` | `pallet_tare_kg + weight * packages_per_pallet` |

`length` / `width` / `height` / `weight` keep their current meaning as **package**
dimensions. Only the code that mistook them for pallet dimensions changes.

All four derived columns resolve to `NULL` when their inputs are null, so every
existing profile keeps working untouched.

### Units: stored in mm, read in inches

Lengths are stored as **integer millimetres**, entered and displayed in **inches,
decimal, rounded to the nearest 0.25 in** — or in mm, by preference. Integers rather
than `numeric`: sub-millimetre precision is meaningless for pallet stacking, and the
height rule is a hard block, where a float-equality edge is a stoppage.

Round-trip is stable. A quarter-inch is 6.35 mm and integer-mm rounding costs at most
0.5 mm, so `round(round(q × 6.35) / 6.35) === q` for every value in range.

**The whole height chain converts, or none of it does.** The app is metric today:
`locations.max_height` is labelled "Max height (cm)" (`core-types.ts:436`),
`moves-core.ts:398` reports cm, weights are kg. A pallet in inches against a bin in
centimetres leaves the operator unable to check a hard block by eye.

- **Ratified for Phase 1:** add `max_height_mm` to `locations`, backfilled from
  `max_height * 10`. The rules read it; `max_height` and `max_pallet_height_cm` stay
  as legacy, written through for one release.
- `resolveLocationClearanceMm(location)` is the single reader: least non-null of
  `max_height_mm`, `max_height * 10`, `max_pallet_height_cm * 10`.
- Unit preference rides on `user_mobile_toolbar_preferences` (already holds per-user
  workspace prefs), defaulting from a new warehouse-level setting.

### The 3 in margin must be applied in exactly three places

`warehouses.clearance_safety_margin_mm` = **76** (3 in, ratified), manager-editable
per site. The block fires at `standard_height_mm > clearance_mm - margin`.

Block text quotes actual millimetres on both sides plus the margin — "1905 mm pallet,
1900 mm bin, 76 mm margin" — because the quarter-inch display cannot show a difference
smaller than 6 mm, and an operator who cannot see why they are blocked will find a way
around it.

The margin must then reach **all three** consumers or they disagree:

1. The fit test's eligible-bin count *and* its "drop to N layers" remedy.
2. The slotting filter in `directed_putaway_candidates`.
3. The put-away block.

One SQL expression, one TS helper, three callers. If the fit test counts 214 bins and
put-away then refuses one of them, the operator stops believing any of the three.

**Budget for the count dropping.** At 76 mm a 2000 mm bay accepts 1924 mm, and a
standard 1905 mm pallet needs a 1981 mm bay. Re-run the fit test across live bins
before Phase 5 turns the block on — the margined count is the one that matters.

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
| **Pack view panel** | At the stack | The isometric render at this pallet's actual quantity, and — for the roles that may — creating or versioning the standard on the spot. Right-hand rail at ≥ `xl`, `Sheet` below. Detailed in §4. | Sheet / rail |
| Pallet label (`pallet-label-page.tsx`) | Physical stacking | Large `6 × 8` plus a **top-view layer map** (six boxes drawn 3×2) and a `STANDARD` / `SHORT 36/48` stamp. **Not** the isometric view — a stacker needs the layer pattern, and 3D on a thermal label is ink, not information. | Print block |
| Put-away confirm (`putaway-page.tsx`) | Placing it | 2D side elevation: pallet 190 cm vs bin clearance 180 cm, overflow hatched red. Height is one-dimensional and deserves a one-dimensional picture. | Inline strip |
| Profile editor (`resource-page.tsx`) | Setup | Live render as numbers are typed, plus the fit verdict before save. | Panel |
| Inventory detail / cycle count | Audit | Static render at the recorded quantity. | Panel |

Lengths render in the viewer's chosen unit throughout, inch values rounded to the
nearest quarter. Only the height-block message quotes raw millimetres, deliberately.

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

## 4. The receiving side panel

Follows `activeShipmentLineId` (already tracked in `receiving-page.tsx`), so on a
multi-SKU shipment it switches as the operator moves between lines.

| State | When | What the panel is |
| --- | --- | --- |
| **Idle** | No SKU on the active line | "Select a SKU to see its pack standard." Nothing else — the panel does not compete with the form for attention. |
| **View** | Active SKU has a standard | Isometric render at this line's Qty per pallet, the `6 × 8` chip, standard height, fit verdict for this warehouse. Actions: **New**, **Edit**. |
| **Edit / New** | Operator opens the form | Layer fields with the render updating live beside them, fit test inline, Save / Cancel. |

### Three ways a pack changes — three different acts

"Supplier changed something" splits in two, and the split decides whether history
stays true.

1. **A SKU has no standard yet.** Create one. Default the profile name to the pack
   code (`6×8`, suffixed if taken) — `unique (product_id, profile_name)` already
   exists, and the name then matches floor vocabulary.
2. **The supplier permanently changed the pack.** **Version it, never mutate it.**
   Stored pallets reference the profile; editing 8 layers to 9 in place silently
   rewrites the standard every one of them was validated against. Save creates
   revision *n+1*, marks *n* superseded, repoints `is_pallet_standard`.
3. **This container arrived packed differently — one-off.** Not a profile change.
   `receipt_lines` already carries `override_length/width/height/weight` end to end
   (written `receiving-core.ts:166`, shown `App.tsx:1564`). Extend the same pattern
   with `override_packages_per_layer` / `override_layers_per_pallet`. The standard is
   untouched; the receipt records what actually turned up.

The panel must make the operator choose between 2 and 3 in words — "Supplier changed
this permanently" vs "Just this container". It cannot be inferred, and it is
expensive both ways: a one-off recorded as a version corrupts the standard; a
permanent change recorded as a one-off means every future receipt fights the old one.

### Pallets snapshot the standard they were built to

`pallets` gains `standard_packages_per_layer`, `standard_layers_per_pallet`,
`standard_height_mm`, written at receipt. Audit, cycle count, and the height rule
reference what was true when the pallet was built, not what the profile says today.
`pallets.height` is already a snapshot of this kind — this finishes it.

### Who can do it — and why "promote them in the Role Matrix" cannot work yet

Promotion through the Role Matrix is the right mechanism. It does nothing today, for
two independent reasons. Three sources currently disagree about who may write a
packaging profile:

| Source | Who it says may write a profile |
| --- | --- |
| `core-types.ts:494` (`packagingProfiles.roles`) | `admin`, `warehouse_manager`, `inventory_clerk` |
| Role Matrix seed (`20260820204306`, `packaging`) | `inventory_clerk` has `can_edit`. `warehouse_operator` has no `packaging` row — and no `receiving` row either. |
| RLS on the table (`20260722000000`) | `has_min_role(auth.uid(), 'warehouse_manager')` — rank ≥ 40, so `inventory_clerk` at 20 is refused outright. |

And `role_permissions` is read nowhere but the matrix editor itself
(`admin-page.tsx:563`). Nothing in the app gates on it. So today an `inventory_clerk`
is shown the create button by the roles array and refused by the database — and
toggling the matrix changes neither half of that.

Making promotion real, **scoped to the `packaging` feature alone** — this is not an
app-wide permissions project:

1. `has_feature_permission(_user_id, _feature_code, _mode)` — security definer,
   joining `user_roles → roles → role_permissions → permission_features`.
2. RLS on `product_packaging_profiles` writes becomes
   `is_approved() and (has_min_role(…,'warehouse_manager') or has_feature_permission(…,'packaging','edit'))`.
   The `has_min_role` arm stays so a missing matrix row can never lock a manager out.
3. A `useFeaturePermission('packaging')` hook. The panel and the Packaging Profiles
   resource page both gate on it, replacing the hardcoded roles array for this one
   resource.

Two things follow that are decisions, not side effects:

- Turning matrix enforcement on immediately grants `inventory_clerk` write access,
  because the seed already sets `can_edit` for them — a widening against today's RLS.
  **Ratified: let it widen.** No re-seed, no manager-only interim step.
- Promoting a `warehouse_operator` takes **two** toggles, not one: `receiving` view
  and `packaging` edit, since the seed gives operators neither.

Whatever the matrix says, the division holds: an operator records what arrived through
the per-receipt override; setting the standard is a separate grant.

### Two gates on Save

- **Fit test first.** With no override on height, a profile created at receiving that
  fails the fit test produces pallets that cannot be put away — discovered an hour
  later, holding one. The panel runs `packaging_profile_fit_report` inline and will
  not save a `fail` without explicit acknowledgement, showing the largest layer count
  that would fit.
- **Online only.** Receiving already gates on `useNetworkStatus` / `assertOnline`.
  Creating master data offline risks duplicate profiles racing in from several
  devices, so New and Edit disable offline with the reason shown. The per-receipt
  override stays available — it queues safely with its receipt.

---

## 5. One height, carried end to end

1. **Receiving writes the real height.** `pallets.height` becomes
   `profile.standard_height_mm`, falling back to today's carton/product value when
   no standard is set. Same fix in the pallet-correction and pallet-recovery RPCs,
   which clone pallet rows.
2. **One definition of a bin's ceiling.** `resolveLocationClearanceMm(location)` in
   `core-types.ts` (§2), with a matching SQL expression. Switch every call site:
   `moves-core.ts:394`, `putaway-core.ts`, `directed_putaway_candidates`.
3. **Put-away actually checks.** `confirmPutaway` passes the pallet height and the
   resolved clearance, waking the dead branch at `core-types.ts:713`. The block is
   hard: it keeps the `RULE_VIOLATION:` prefix so the existing error surface works,
   but the override affordance is **not** offered for a height failure — that is the
   one difference from temperature and mixed-SKU, and the UI has to say so rather
   than showing a disabled override button.
4. **Blocked before the tap, not after.** The bay picker already knows the task's
   pallet. Bins whose clearance is short render disabled with the reason inline
   ("−140 mm"); a scanned short bin is refused at scan time with the same wording.
   With no override, this is the difference between a rule and an obstruction — the
   operator must never be able to select a bin that will refuse the pallet.

### Slotting: like products, like bin sizes

`directed_putaway_candidates` gains a hard filter on effective clearance plus three
scoring terms:

- **Best fit, not first fit** — `+18 × max(0, 1 − headroom_mm/600)`, headroom
  measured against the usable ceiling. Stops a 900 mm pallet consuming a 2400 mm bay
  while tall pallets queue. Biggest cube-utilisation win in the change.
- **Height bands** — profiles and bins both resolve to a band
  (≤110 / ≤140 / ≤170 / ≤200 / >200). Same band scores, and it gives operators a
  vocabulary and the fit test something legible to report.
- **Family and SKU affinity** — `+10` when the zone already holds the same
  `product_family`, `+6` when the bin already holds this SKU. Existing mixed-SKU
  penalty stays.

Carried to the operator through the existing `reason` string:
`height_band_fit; family_zone; snug_9cm`.

---

## 6. The fit test

Now that the height block cannot be overridden, this is the gate that keeps a block
from being discovered on the floor with a built pallet in hand.

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

## 7. Build order

Each phase is shippable on its own.

1. **Schema, units, and the silent height bug** — additive migration, generated
   columns, `locations.max_height_mm` with its backfill, `resolveLocationClearanceMm()`,
   the mm↔inch helpers, the `pallets.height` fix. No UI. Worth shipping alone: it
   corrects a height rule that has been passing everything.
   `+ supabase/migrations/…_pallet_pack_standards.sql` · `+ src/lib/measure.ts` ·
   `~ receiving-core.ts`, `core-types.ts`, `moves-core.ts` ·
   `+ src/test/pack-standard-math.test.ts`, `measure.test.ts`
2. **Profile editor, versioning, and the fit test** — layer fields on the Packaging
   Profiles form with inch entry, profile revisions, the shared `PalletStackPreview`
   component, the fit-report RPC, the status chip.
   `+ src/components/pallet-stack-preview.tsx` · `~ core-types.ts`
   (`RESOURCE_DEFINITIONS`), `resource-page.tsx` ·
   `+ src/test/packaging-profile-fit.test.ts`
3. **Receiving: assignment and conformance** — auto-assign the default standard on
   product select, filter the profile list to the product, standard chip and
   **Use standard** beside Qty per pallet, conformance on draft rows, `6 × 8` and
   layer map on the label.
   `~ receiving-page.tsx`, `ui-shared.tsx`, `pallet-label-page.tsx` ·
   `~ src/test/receiving-page.test.tsx`, `receiving-shipment-math.test.ts`
4. **The receiving panel — View, Edit, New** — the three-state panel (§4): the
   actual-quantity render, on-the-fly create and version, the per-receipt override,
   the inline fit test, and the Role Matrix and offline gates — including making the
   matrix actually govern the `packaging` feature, client and server. Right rail at
   ≥ `xl`, `Sheet` below. The largest phase, and the one that puts the standard in
   reach of the person who discovers it changed.
   `+ src/components/pack-view-panel.tsx` · `+ src/hooks/use-feature-permission.ts` ·
   `+ supabase/migrations/…_packaging_feature_permission.sql` ·
   `~ receiving-page.tsx`, `receiving-core.ts` ·
   `+ src/test/pack-view-panel.test.tsx`, `feature-permission.test.ts`
5. **Slotting and put-away enforcement** — new scoring, the hard height block, the
   76 mm margin wired into all three consumers, bay-picker pre-validation, the
   height silhouette. Last, because it
   is the only phase that can stop an operator mid-task, and with no override it
   should land on data the previous four phases have proven.
   `+ supabase/migrations/…_slotting_height_bands.sql` · `~ putaway-core.ts`,
   `putaway-page.tsx` · `~ src/test/putaway-page.test.tsx`

### Phase 1 build notes — two unit boundaries that will bite

Both of these are places where "store mm" collides with a codebase that is currently
centimetres. Getting either wrong is a silent 10× error that passes every test that
does not assert an actual number.

**1. The profile's own package dimensions are cm.** `product_packaging_profiles`
`length` / `width` / `height` / `weight` are `numeric(10,2)` and metric-cm by
convention. `standard_height_mm` must not be generated from `height` directly, or it
mixes units. Add explicit mm columns for the package —
`package_length_mm`, `package_width_mm`, `package_height_mm` — backfilled from the
legacy cm columns (`* 10`), and generate `standard_height_mm` from
`package_height_mm`. Leave the legacy columns alone; they still feed the existing UI.

**2. `pallets.height` is cm and is read as cm.** `directed_putaway_candidates`
compares `pc.height` against `l.max_height` (cm), and `moves-core.ts:394` does the
same. Writing millimetres into `pallets.height` is a 10× error that makes every bin
look 10× too small. Instead:

- Add `pallets.standard_height_mm`; the new rules read that.
- Keep `pallets.height` in cm, and set it to `standard_height_mm / 10` at receipt so
  the legacy path becomes *correct* rather than staying wrong.

**Scope fences for Phase 1**

- Change the height *filter* in `directed_putaway_candidates` to mm plus the margin.
  Do **not** add the best-fit, height-band, or family-affinity scoring — that is
  Phase 5.
- No UI. `RESOURCE_DEFINITIONS` is untouched; the profile form is Phase 2. With no
  form, no profile will have layer data yet, so the only behaviour change in Phase 1
  is the clearance plumbing — which is the point.
- `supabase/migrations/**` is additive only; never edit an existing migration file.
  `create or replace function` for the RPC follows the existing repo pattern.
- `src/integrations/supabase/types.ts` is generated and must not be hand-edited, so
  the new columns will not be typed. Follow the `as any` patterns already used around
  `db(...)` rather than fighting it.
- Verify with `npm run typecheck`. Plain `tsc --noEmit` compiles nothing here — the
  root `tsconfig.json` is reference-only with `"files": []` and always exits 0.

Feature-flag note: the `packaging` module flag is `false` in `STARTER_MODULES`. Gate
the new UI behind it; the height correctness fixes in Phase 1 ship ungated, since
they are no-ops when no profile is assigned.

---

## 8. Decisions

**Ratified**

- **Height override** — hard block, no override. Carried into Phase 5.
- **Bin clearances move to mm in Phase 1** — `locations.max_height_mm`, backfilled
  from `max_height * 10`, read through `resolveLocationClearanceMm()`. Bin Locations
  accepts inch entry from Phase 2.
- **Clearance safety margin: 3 in** — `warehouses.clearance_safety_margin_mm` = 76,
  manager-editable per site. Must reach the fit test, the slotting filter, and the
  put-away block together (§2).
- **Container staff are promoted in the Role Matrix** — so the matrix has to start
  governing the `packaging` feature; it governs nothing today (§4). Display unit
  follows the same route: an inch default per warehouse, overridable per user.

- **Matrix enforcement may widen `inventory_clerk` access** — let it widen. From
  Phase 4, `inventory_clerk` can write packaging profiles; RLS stops contradicting
  the matrix seed. No re-seed, no manager-only interim step.

**Open — neither blocks Phase 1**

1. **Which pallet footprint?** 1200 × 1000 mm (EUR2) and 1219 × 1016 mm (GMA 48 × 40)
   are close enough to look identical and far enough apart to fail a footprint check.
   *(Needed by Phase 2 for editor defaults.)*
   *Recommend:* warehouse-level default with a per-profile override.
2. **What happens on an off-standard receipt?** Short pallets are normal — the last
   pallet of a run almost always is. *(Needed by Phase 3.)*
   *Recommend:* warn and record the variance, never block. A blocked receipt gets
   worked around invisibly; a recorded variance is data the fit test and slotting
   scores can use.
