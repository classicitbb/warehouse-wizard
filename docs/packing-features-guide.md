# Packing features — how to use them

**Applies to:** Warehouse Wizard 1.29.5  
**Audience:** warehouse managers, supervisors, inventory clerks, receiving operators  
**Related:** [pallet-pack-standards-plan.md](pallet-pack-standards-plan.md) — the design and build order behind this

---

## 1. What shipped

A packaging profile used to be a carton-dimension template that nothing downstream
read. It is now the **pallet build standard** for a SKU: `12 × 7` — twelve cases per
layer, seven layers, 84 cases on a full pallet.

Three things follow from that one number:

- **Receiving works from it.** Selecting a SKU assigns its standard, the Qty per
  pallet field shows the standard beside it, and one tap fills it in.
- **The built height is real.** A pallet's height is now the deck plus every layer of
  cartons, not the height of one carton. Put-away and Location Moves refuse a pallet
  that will not fit under the bin.
- **The build is designable.** The Command Center's **Packing** tab renders the stack
  as you shape it, and saves the result as the SKU's standard.

Off-standard receipts are **recorded, never blocked** — a short last pallet is normal,
and a blocked receipt just gets worked around invisibly.

---

## 2. The vocabulary

| Term | Means | Where it comes from |
| --- | --- | --- |
| **Pack code** | `12 × 7` — cases per layer × layers | `packages_per_layer`, `layers_per_pallet` |
| **Cases per pallet** | The 84 in `12 × 7` | Derived: per layer × layers |
| **Units per pallet** | What the receiving form counts in | Cases per pallet × units per package |
| **Built height** | Deck + every layer, slip sheets included | Derived from the carton height |
| **Bin clearance** | The bin's ceiling | The bin location's max height |
| **Usable height** | Clearance minus the safety margin | Margin defaults to **76 mm (3 in)**, set per warehouse |
| **Conformance** | Standard / short / overpack | Actual cases against the standard |

**Cases versus units.** A pack code counts *cases*. Receiving's Qty per pallet counts
*stock units*. The two coincide only when a profile's **units per package** is 1, so
every screen that compares them says which unit it used. If a SKU has no
units-per-package set, the comparison is made in cases and says so.

---

## 3. Where the packing features live

| Surface | Who normally uses it | What it is for |
| --- | --- | --- |
| **Command Center → Packing tab** | Manager, supervisor | Design a build, watch the stack, save it as the SKU's standard |
| **Receiving → Lot, batch, and packaging** | Receiving operator, clerk | Record the pack code that actually arrived; create a standard on the spot |
| **Receiving → Qty per pallet** | Receiving operator | See the standard and apply it in one tap |
| **Packaging Profiles module** | Manager, admin | The full field-by-field editor; the place to *change* an existing standard |
| **Put-Away and Location Moves** | Operator | The height rule that uses all of the above |

---

## 4. The Pallet Pak Designer (Command Center → Packing)

### Getting in

The Packing tab sits beside Floor, Dock and Office on the Command Center. Until the
feature is released it shows a padlock for everyone except developers, who see the tab
with a **Developer preview** badge. See §8 for the one toggle that releases it.

### Step by step

1. **Pick a SKU.** The search box at the top right of the panel matches SKU, name or
   barcode. If the SKU already has a pallet standard, its numbers load into the
   designer, so you are shaping a real build rather than starting from defaults.

2. **Shape the build with the sliders.**

   | Slider | Range | What it changes |
   | --- | --- | --- |
   | Cases per layer | 1–40 | The first number of the pack code |
   | Grid across | 1 – cases per layer | Cases along the long side; the rest wrap |
   | Layers | 1–30 | The second number of the pack code |
   | Carton height | 40–800 mm | **Drives the built height** — see the warning in §7 |
   | Actual on pallet | 0 – 125% of standard | A "what if this pallet is short" preview |
   | Bin clearance | 800–3200 mm | The bin ceiling you are testing against |

   **Layer pattern** (block, brick, pinwheel, column, custom) and **slip sheet** height
   sit below the sliders. The pattern is recorded on the standard and drives how the
   layer is drawn.

3. **Read the stage.** The pack code is printed at display size in the top left — that
   is the number an operator reads across a room — with the cases-per-pallet count
   under it. The unit switch in the top right toggles **mm / inch / ft-in** for every
   length on the screen.

4. **Read the two verdicts** in the right-hand rail. The first is fit:

   | Verdict | Means |
   | --- | --- |
   | `fits` | Clear of the usable height with room to spare |
   | `tight` | Under 100 mm of headroom. Best-fit slotting will prefer this bin |
   | `blocked` | Taller than the usable height. The message names the overage **and the remedy** — "Drop to 6 layers, or slot a taller bay" |
   | `unknown` | No bin clearance to check against |

   The second is conformance, driven by the **Actual on pallet** slider: `standard`,
   `short` — with the layer breakdown, "4 full layers plus 5 of 12 on top" — or
   `overpack`.

5. **Save as pack standard.** The dialog asks for four things:

   - **Profile name** — pre-filled from the pack code (`12x7`, suffixed if taken).
   - **Package type** — case, carton, box, tray or bag.
   - **Units per package** — the dialog spells the product out: "84 cases × 6 = 504
     units per pallet". That is the number receiving will use.
   - **Make this the pallet standard for this SKU** — one standard per SKU. If the SKU
     already has one, the toggle is disabled and the panel names the profile holding it.

### Two things to know before you save

- **The designer always creates a new profile.** Loading an existing standard and
  saving does not overwrite it — it adds a second profile alongside. To *change* an
  existing standard, edit it in the Packaging Profiles module.
- **Saving needs you online and permitted.** Master data is created online only, so two
  devices cannot race the same profile name. Without the packaging permission the Save
  button stays disabled with the reason underneath it.

---

## 5. Receiving

### A. The SKU already has a standard

Selecting the SKU assigns its standard automatically — no digging in a collapsed
section. Beside **Qty per pallet** you get a chip reading `12 × 7 · 504`, and if the
typed quantity differs, a **Use standard** link that fills it in.

A declared standard outranks the learned suggestion from prior pallets. Anything you
type yourself outranks both.

### B. Recording the pack that actually arrived

Open **Lot, batch, and packaging** on the line. Two fields matter:

- **Packaging** — the profile list, filtered to this line's SKU, each entry showing its
  pack code.
- **Pack code** — free text for what this container was built to. Accepts `12x7`,
  `12 X 7`, `12 × 7`, `12*7` and `12 by 7`. A bare number is rejected on purpose: `84`
  is a quantity, and reading it as `84 × 1` would invent a standard nobody can build.

As soon as the code parses, a conformance line appears under the section:

> `12 × 7 · short 84 units of 504 — 6 full layers plus 4 of 12 on top.`

**This never blocks the receipt.** It is recorded as variance, shown in amber when it
is off standard.

### C. Creating a standard from the floor

**Create Package Standard**, under the Pack code field, opens a small dialog seeded
with whatever code you typed. Enter cases per layer, layers, package type, units per
package and — importantly — the **carton height**. The preview beside it renders the
stack, and saving assigns the new profile to the line you were working on.

The button is disabled, with the reason on hover, when there is no SKU on the line,
when the device is offline, or when you do not hold the packaging permission.

### D. The proposal after a receipt

When a SKU has no standard and the receipt was good evidence of one, the same dialog
opens after saving, with the reason it appeared:

- *"You recorded this container as 12 × 7. Save it as the standard for this SKU?"* — a
  typed pack code is a declaration by someone who may set master data, and is enough on
  its own.
- *"5 prior pallets of this SKU came in at 504. Save 12 × 42 as the standard?"* — an
  observed quantity needs at least three prior pallets **and** has to divide cleanly
  into layers.

Declining is remembered for the rest of the session, so the prompt does not come back
on the next line.

---

## 6. The Packaging Profiles module

The **Packaging** module (`/packaging-profiles`) is where an existing standard is changed. The pack
fields are grouped into their own section on the form:

| Field | Notes |
| --- | --- |
| Packages per layer / Layers per pallet | The two halves of the pack code |
| Layer pattern | Block, brick (alternate 90°), pinwheel, column, custom |
| Grid across | Cases along the long side. Blank derives a near-square grid |
| Package length / width / height (mm) | The carton. Height drives the built pallet height |
| Pallet length / width (mm) | The footprint, overhang included |
| Deck height (mm) | Empty pallet. Blank restores 145 |
| Slip sheet (mm) | Tier sheet between layers. Blank restores 0 |
| Pallet tare (kg) | Empty pallet weight, for the bin weight rule |
| Max stacked pallets | Whether this pallet may be double-stacked in a bin |
| Quantity tolerance | Units of slack before a receipt is flagged off standard |
| Build notes | "Labels face out", "corner posts on the top layer" |
| Pallet standard for this SKU | One per product. Receiving assigns it automatically |

Carton dimensions typed in millimetres keep the older centimetre columns in step
automatically — there is nothing to enter twice.

---

## 7. The height rule

Before this release, a pallet's height held the height of a *carton*, so a 22 cm number
was compared against a 190 cm bin and every height check passed. It now holds the built
height of the pallet, snapshotted at receipt.

**Where it bites:** Put-Away confirmation and Location Moves both refuse a pallet
taller than the bin's usable height. The block is hard — there is **no override and no
reason code** for a height failure, unlike temperature or mixed-SKU. The message quotes
raw millimetres on both sides deliberately, because a quarter-inch display cannot show
a 6 mm difference:

> Pallet is too tall for this bin — 1905 mm pallet, 1900 mm bin, 76 mm margin

**Usable height = bin clearance − safety margin.** The margin defaults to 76 mm (3 in)
and is set per warehouse. The same arithmetic runs everywhere fit is judged, so the
designer's verdict and the put-away block agree.

> **The one thing that silently disables all of this:** a standard saved with **no
> carton height** has no pallet height, and a pallet with no height passes every bin
> check. Both dialogs warn about this in amber. Fill the carton height in.

A missing height never blocks — an unrecorded measurement is not evidence of a problem
— which is exactly why that warning matters.

---

## 8. Permissions and releasing the Packing tab

Two feature codes in **Settings → Users & Roles → Role Matrix** govern this work:

| Feature code | Controls |
| --- | --- |
| `packaging` | Creating and editing pack standards, from receiving or anywhere else |
| `pack_designer` | Seeing and using the Command Center Packing tab |

- The matrix now **really governs** packaging profile writes, client and server. An
  inventory clerk granted edit can record a standard on the floor; previously the
  button appeared and the database refused it.
- A warehouse manager keeps write access whatever the matrix says — a missing matrix
  row can never lock a manager out of master data.
- **Deleting** a profile stays manager-tier. Widening who may *create* a standard was
  the point; widening who may destroy one was not.
- **Releasing the Packing tab** is one toggle and no deploy: set `is_released` on the
  `pack_designer` feature. Until then the tab is padlocked for everyone but developers,
  and the panel wears a *Developer preview* badge. The role grants are already seeded,
  so releasing is not a configuration exercise performed under pressure.

---

## 9. Not in this release

So nobody goes looking for them:

- **The pallet label does not carry the pack code or a layer map yet.** It still prints
  the packaging profile name only.
- **There is no warehouse-wide fit test.** The designer checks a build against the one
  bin clearance you set on the slider; counting how many bins in the warehouse could
  actually take a standard pallet is a later phase.
- **Profiles are not versioned in the UI.** Editing a standard changes it for every
  pallet that references it. Where a supplier has permanently changed a pack, create a
  new profile rather than editing in place.
- **There is no per-receipt pack override field.** Record what arrived with the Pack
  code field, which is captured as variance on the receipt.
- **Slotting does not yet score on height.** Best-fit, height bands and family affinity
  are the next phase; today the height rule filters, it does not rank.
