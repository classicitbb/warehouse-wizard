# Fix the database timeouts and make the notifications panel fit every screen

## What the logs show

Every "canceling statement due to statement timeout" in the last hour came from two reads:

- the Command Center metrics call (`dashboard_metrics_summary`)
- the Inventory Search list (`inventory_search_view`)

The tables involved are small (1,358 locations, 1,332 pallets, 3,704 products, 6,580 history rows), yet the slowest-query report shows average times of 1–2.3 seconds and peaks near 8 seconds — the ceiling before the database gives up. So this is not data volume; it is per-row permission checking.

Confirmed cause: every permission rule re-runs the "is this person approved / can they see this warehouse / is this pallet on an open transfer" checks **once per row**, and each of those runs its own lookups. The metrics call alone scans the stock table around twenty times, so the cost multiplies. The Inventory Search list joins eight tables, each paying the same per-row charge.

## The fix

1. **Evaluate permission checks once per query, not once per row**
  - Rewrite the read rules so the approval check is computed a single time, and warehouse access compares against a pre-computed list of the warehouses the person may see.
  - Replace the per-row open-transfer check with a single small pre-computed list of pallets on open transfers.
  - No change to who can see what — same rules, same results, far less repeated work.
2. **Rebuild the Command Center metrics call**
  - Compute all counts in one or two passes over the stock table using conditional aggregates instead of ~20 separate sub-counts.
  - Run it with fixed elevated rights plus an explicit warehouse-access check at the top, so internal counting does not re-pay row-level checks.
3. **Add the missing indexes**
  - History ordered by date, pallets by warehouse + status, receipts by warehouse + status + date, role lookups by person.
4. **Make Inventory Search cheaper**
  - Always scope the first page to the active warehouse and a bounded page size, keeping the existing scroll-to-load behaviour.
5. **Friendly failure instead of raw database text**
  - If a read still times out, show "That took too long — retrying" with one automatic retry, rather than the current "canceling statement due to statement timeout" toast.
6. **Verify**
  - Re-run timing on the metrics call and Inventory Search before/after, then re-check the logs for new timeouts.

## Notifications panel

Currently a fixed 22rem dropdown with a fixed 20rem scroll area, so on a phone or a short screen it is cramped and the lists get squeezed.

- On phones and tablets in portrait: use the full available width with comfortable margins.
- Height follows the real visible screen height instead of a fixed value, so more items show on tall screens and nothing is clipped on short ones.
- Section labels (Connectivity, Reorder alerts, Warehouse activity, Setup) stay pinned while the list scrolls.
- Larger tap targets for each entry, and the panel opens without shifting the page.

## Technical notes

- Migration: rewrite `public` SELECT/UPDATE/DELETE policies on `locations`, `products`, `receipts`, `pallets`, `inventory_balances`, `audit_events` to wrap `is_approved()` in a scalar sub-select and to use a cached accessible-warehouse array plus a cached accessible-transfer pallet list.
- Migration: replace `dashboard_metrics_summary` with a `SECURITY DEFINER`, `STABLE`, `search_path`-pinned version using `count(*) FILTER (...)` aggregates; keep the same JSON keys and the existing full-count fields so `dashboard-core.ts` is unchanged.
- Indexes: `audit_events(created_at desc)`, `audit_events(warehouse_id, created_at desc)`, `pallets(current_warehouse_id, status)`, `receipts(warehouse_id, status, created_at desc)`, `user_roles(user_id) where is_hidden = false`.
- Client: timeout-aware retry for Postgres `57014` in the shared query layer; Inventory Search first page scoped to the active warehouse.
- `src/features/shared/app-shell.tsx` notification dropdown: responsive width, `svh`-based max height, sticky section headers.
- Verification: `EXPLAIN (ANALYZE, BUFFERS)` on the rewritten RPC and view read, `supabase--slow_queries` re-check, focused tests plus full typecheck.  
  
also Add a role history log so I can see when and by whom a role is assigned, archived or unarchived.