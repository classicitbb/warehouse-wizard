# Infinite scroll everywhere + release notes under the current version (v1.28.9)

## 1. Share the auto-load-on-scroll behaviour

Inventory Search already auto-loads the next 50 rows as you approach the bottom (sentinel + IntersectionObserver, 300px prefetch, "Load 50 more" fallback button). That logic will be extracted into one reusable hook and applied to every list that can have more rows than fit on screen.

New hook `src/hooks/use-infinite-rows.ts`:
- Owns the visible-row limit (50, +50 per page), the sentinel ref, and the observer that finds the nearest scrollable ancestor.
- Resets to 50 whenever filters/search change.
- Returns `{ limit, hasMore, sentinelRef, loadMore, reset }` so each page keeps its own query shape.

Applied to:
- **Locations, Products, Zones** (Resources page) — these already fetch `limit + 1` pages but only offer a manual button; they gain the scroll sentinel.
- **Warehouses and Clients** (same page) — same treatment so all resource tables behave alike.
- **Reports** — the occupancy/detail lists currently render a hard `slice(0, 12)`; they get the same progressive reveal.
- **System Log** and **Email Log** — currently fetch a fixed 500 rows in one shot; they move to paged fetches (50 at a time, ordered newest first) that extend as you scroll.

Each list keeps: rows staying on screen while the next page loads, a monochrome spinner during fetch, the "Load 50 more" button as a manual fallback, and the "N loaded" counter.

## 2. Current version shows its own features and fixes

The About tab in Settings currently shows "Current version v1.28.8" above a hardcoded list that stops at v1.27, so the newest releases are missing.

- Move `RELEASE_HISTORY` out of `src/App.tsx` into `src/lib/release-history.ts` as the single source of truth (App.tsx, the What's New popup, and Settings > About all import it).
- Each release entry gains an optional `fixes` list alongside `features`, so About renders, under the current version: what was added in that release, then the fixes shipped with it.
- Delete the stale hardcoded list in `admin-page.tsx`; About renders straight from the shared history, newest first, with the current version expanded at the top.

## 3. Version bump to 1.28.9

Per the project rule (patch rolls at 10), `1.28.8` -> `1.28.9`. Updates in the same pass:
- `package.json` version.
- New `1.28.9` entry in the shared release history covering everything shipped since 1.28.8: the reverted instant scan capture, configurable scan dwell/cooldown in Settings > Environment, audio & alerts moved to Notifications, resumable/cancellable pallet edit drafts, spatial scan-target gating (recognise anywhere, capture only inside the reticle), fixed six-row calendar grid, Cancel Move returning to the inventory product you came from, cleared expiry dates on Greenware stock, Inventory Search infinite scroll, and the list auto-loading rolled out in this release.
- Help Center topics touched by the change (inventory/locations/products/logs scrolling, scanner settings, Cancel Move).

## Technical notes

- The hook derives the scroll root by walking up to the nearest `overflow-y: auto|scroll` ancestor, matching the existing Inventory behaviour inside `TableFrame`.
- System/Email log queries switch from `.limit(500)` to `.range(0, limit)` with `placeholderData: (prev) => prev`, keeping the existing query keys plus the limit.
- No table or RLS changes; all work is frontend plus the version/release-notes content.
