# Products screen: correct quantities, sortable & filterable columns

## 1. Fix the missing quantity

The Qty column reads a database aggregate that currently counts only stock that is
stored in a location **and** not reserved. Verified against live data, that silently
drops:

- 139 units reserved for open pick lists (still physically on the rack)
- 811 units sitting in receiving / awaiting put-away

New rule (as chosen): Qty = all live stock — on-hand plus reserved plus
receiving/put-away — excluding shipped and missing pallets. One plain total per row,
no breakdown.

Delivered by a new migration that replaces the aggregate function so it sums the
recorded quantity for every balance row whose status is not shipped and not missing,
regardless of whether a location is assigned yet.

## 2. Sortable columns

Every column header on Products becomes clickable: first click sorts ascending,
second descending, third clears back to SKU order. An arrow indicates the active
column and direction. Sorting covers Qty, SKU, Name, ABC class, Minimum stock,
Maximum stock, Pick down to, Supplier lead time, Temperature, Rotation, and the
Lot / Batch / Expiry / Active toggles.

## 3. Per-column filters

A filter icon on each header opens a small popover:

- Text columns (SKU, Name) — type-ahead "contains" box
- Number columns (Qty, min/max stock, pick down to, lead time) — min / max range
- Choice columns (ABC class, Temperature, Rotation) — checkbox list of values
- Yes/No columns (Lot, Batch, Expiry, Active/Visible) — Any / Yes / No

Active filters show as removable chips under the search bar with a "Clear all"
action. The existing free-text search box keeps working across all fields and
combines with the column filters.

## 4. Quick links under the search

A row of one-tap presets beneath the search bar:

- Expiry tracked — expiry-tracked products first (default emphasis, as requested)
- Lot tracked
- Batch tracked
- Below minimum stock
- Out of stock
- Cold chain (chilled / frozen)

Each toggles the matching column filter, so they are visible and removable like any
other filter.

## 5. Full result set while filtering (all 4,000+ rows, not 1,000)

Products already switch from paged loading to a full read when the search box is in
use; the same applies when any column filter or quick link is active, so a filtered
count is the true count and never capped at the current page.

The "full read" itself is currently capped at 1,000 rows by the backend's hard
response limit, which is why only about 1,000 of ~4,000 products appear. The full
read becomes a chunked fetch: repeated 1,000-row pages are requested back to back
until the last short page arrives, then merged into one list. The same chunked
reader is used for the quantity totals and for exports, so counts, filters, sorts,
and CSV output all cover the whole catalogue. A progress indicator shows while the
chunks load, and the quantity aggregate is fetched once per catalogue load rather
than per chunk.


## Technical notes

- Migration: replace `public.product_quantity_totals()` to sum
  `coalesce(quantity, available_quantity, 0)` grouped by product, filtered to
  `status not in ('shipped','missing')`. Function stays `STABLE`, keeps its
  `search_path`, and remains readable by the same roles.
- `listRecords` gains a chunked mode: loop `.range(offset, offset + 999)` until a
  page returns fewer than 1,000 rows, concatenating results. This bypasses the
  PostgREST 1,000-row response cap that currently truncates the ~4,000 products.
  Applies to the products full read, quantity totals, and export.
- `src/features/resources/resource-page.tsx`: add `sort` and `columnFilters` state
  scoped to the products table, applied after the existing `filteredData` memo and
  before rendering; the memo also feeds label/export paths so counts stay consistent.
- Column metadata (type, options) comes from the existing `products` entry in
  `src/features/shared/core-types.ts`; Qty is registered as a synthetic numeric
  column backed by `productQtyMap`. No schema/field-definition changes.
- Reuse existing shadcn Popover, Checkbox, Input, and Button primitives and current
  table density — no new tokens or layout changes.
- Tests: `src/test/` cases for the new quantity rule (reserved and inbound counted,
  shipped/missing excluded), sort toggling, one filter of each kind, and the expiry
  quick link.
- Run `npm run typecheck` plus the affected suites before finishing.
