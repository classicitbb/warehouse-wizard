# Faster Command Center, truer metrics, fluid tiles

## What's wrong today (verified)

- The dashboard figures are computed in the browser after downloading raw rows. `getDashboardMetrics` pulls every inventory balance row with no page limit, and the backend caps a single read at 1,000 rows. There are 1,118 balance rows live today, so pallet totals, hold/quarantine, expiry and stock-age counts are already **under-reported**, and the gap grows as stock grows.
- The same heavy function runs in three places at once (Command Center every 15s, the sidebar counts every 30s, and the Reports/Status page), each with its own cache key, so the app repeats the same big download several times per minute.
- It also downloads all 1,358 locations just to add up capacity, plus open receipts, putaway, picks, moves, transfers, counts, dock loads, replenishments and 50 audit rows — nine extra round trips for numbers a single database call can return.
- Tiles only have two sizes: normal or double-width. There is no square/tall option, so tiles leave ragged gaps when the window resizes.

## The plan

### 1. Move the counting into the database
Add one read-only database function that returns the whole metric set for a warehouse (or all warehouses) as a single row of counts: pallets stored, capacity, available, cool zone, holds, quarantine, expiry within 30/60 days, stock aged 3/6/12 months, and the open-work counts for receiving, putaway, picking, moves, transfers, counts, dock loads and replenishment. Grant execute to signed-in users only.

The app calls that one function instead of nine downloads. Detail lists (the clickable task rows behind each tile) stay separate and are fetched only for the tiles actually visible, capped and ordered in the database.

Expected effect: dashboard first paint drops from ~10 requests and several thousand rows to 1 request and 1 row; counts become correct rather than truncated at 1,000.

### 2. One shared cache
Give the metric read a single cache key shared by the Command Center, the sidebar counters and the Reports page, with a 30-second freshness window and refresh only while the tab is visible. Background refresh pauses when the device is offline or when the user has active floor work.

### 3. Make sure every tile earns its place
Review the tile list against the metrics that actually change during a shift, and:
- Remove or merge duplicates (the same open-work number appearing in more than one tile).
- Hide tiles whose module is switched off for the site.
- Add missing operational signals that the data already supports: pallets awaiting putaway with no task, receiving drafts older than a day, and locations over capacity.
- Every number stays clickable through to the screen that explains it.

### 4. Fluid, resizable tile grid
Replace the two-size system with four sizes: **1x1 square**, **2x1 wide**, **1x2 tall**, **2x2 large**. The grid becomes a fixed-column-width auto-fill grid with equal row height, so squares stay square and tiles reflow cleanly from phone to wide desktop instead of leaving gaps. Resizing in edit mode cycles through the four sizes; saved layouts that only know "small/large" are converted automatically on load. Drag, hide and restore behave exactly as they do now, and layouts keep saving per user, per device, per view.

### 5. Two new locked views
Add **3D** and **Packing** tabs beside Floor, Dock and Office. Both show a padlock, are not selectable, and show a short "coming soon" note on hover/tap so the roadmap is visible without dead screens.

### 6. Verify
- Compare each new database count against the current in-browser count on live data and confirm the differences are exactly the rows previously cut off at 1,000.
- Measure Command Center load before and after.
- Tests for the new metric function, the tile-size conversion, and the locked tabs.

## Technical notes

- New migration: `dashboard_metrics_summary(p_warehouse_id uuid)` returning a single row, `security definer`, `set search_path = public`, `grant execute ... to authenticated` only, plus supporting partial indexes on `inventory_balances (warehouse_id, status)` and `(warehouse_id, expiry_date)` if `EXPLAIN` shows sequential scans.
- `src/features/dashboard/dashboard-core.ts`: `getDashboardMetrics` becomes a thin RPC wrapper; task-row lists split into `getDashboardTaskRows(kind)` fetched lazily per visible tile.
- `src/lib/dashboard-preferences.ts`: `DashboardCardSize` becomes `"1x1" | "2x1" | "1x2" | "2x2"` with a migration shim in `sanitizeDashboardLayout` mapping `sm -> 1x1`, `lg -> 2x1`.
- `src/features/shared/ui-shared.tsx` `SortableSummaryCard`: span classes driven by size; grid container moves to `grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] auto-rows-[minmax(9rem,auto)]`.
- `src/features/dashboard/dashboard-page.tsx`: tab list gains disabled `3d` and `packing` triggers with lock icons and tooltips.
- No change to Copilot, reports content, or any workflow screen.
