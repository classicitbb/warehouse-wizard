# Stop data-heavy pages from timing out

Large list screens (Products, Locations, Inventory) pull entire tables in one go, and the database cancels those reads after 8 seconds. Staff then see empty or failing tables.

## Already done in this pass
Added indexes on `inventory_balances` for the columns those screens filter on (`location_id, status`, `status, available_quantity`, `product_id, status`). This alone should remove a large share of the timeouts.

## Remaining work (needs approval — touches shared data loading)

1. **Stop full-table fetches for admin/resource tables**
   - `listRecords()` in `src/features/admin/admin-core.ts` pages through every row with `select "*"`.
   - Switch the resource/admin tables (locations, products, pallets, profiles) to the existing `listRecordsPage()` keyset path plus the shared `useInfiniteRows` hook, so only the visible pages load.
   - Keep `listRecords()` for exports and selectors, but with a narrow column list instead of `*`.

2. **Server-side totals instead of 10k row reads**
   - `src/features/shared/ui-shared.tsx` and `src/features/resources/resource-page.tsx` read up to 10,000 `inventory_balances` rows only to compute per-product/per-location quantity totals.
   - Replace with a small aggregation RPC (`product_quantity_totals`, `location_occupancy_totals`) returning one row per product/location.

3. **Trim the warehouse tree read**
   - `src/components/warehouse-tree-view.tsx` loads 2,000 rows up front; scope it to the selected warehouse/zone and fetch children on expand.

4. **Verify**
   - Re-run `EXPLAIN (ANALYZE)` on the rewritten queries and confirm no new 57014 errors appear in the logs.

## Risk
These are shared read paths used by many screens, so the change is staged: indexes first (done), then aggregation RPCs, then pagination — each verified before the next.
