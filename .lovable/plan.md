# Warehouse-scoped task lists + non-disruptive refresh

## 1. Filter Put-Away tasks and Pick Lists by the active warehouse

Today `getPutawayTasks()` and the pick-list query return tasks for every warehouse, so picking a specific warehouse in the switcher does not narrow the active queues. The "All warehouses" sentinel (developer/admin) should keep showing everything; any other selection should hide tasks from other warehouses.

**Changes**
- `src/features/putaway/putaway-core.ts` — extend `getPutawayTasks(userId?, warehouseId?: string | null)`. When `warehouseId` is a non-null string, add `.eq("warehouse_id", warehouseId)`. When it is `null` (All) or `undefined` (legacy callers), no warehouse filter is applied.
- `src/features/putaway/putaway-page.tsx` — read `profile?.default_warehouse_id` and pass it into `getPutawayTasks`. Include the value in the `queryKey` (`["putaway-tasks", userId, warehouseId]`) so switching warehouses refetches.
- `src/features/picking/picking-core.ts` — add an optional `warehouseId` arg to the pick-list fetcher and `.eq("warehouse_id", …)` when set.
- `src/features/picking/picking-page.tsx` — pass `profile?.default_warehouse_id` into the pick-list query and include it in the query key.
- Update `src/test/putaway-page.test.tsx` mocks so the new signature stays satisfied.

The active-doc badge counts in the sidebar already aggregate across warehouses; leave those alone so admins/developers still see global totals.

## 2. Keep the bay selector scoped to the receiving warehouse

The Put-Away bay browser is already invoked with `warehouseId={task.warehouse_id}` (the warehouse the pallet was received in), so the dialog itself is correct even when "All warehouses" is active. Verify nothing else passes the active-warehouse instead:

- Audit `src/features/putaway/putaway-page.tsx` and confirm every `<WarehouseBayBrowserDialog …>` and `getWarehouseBayOccupancy(...)` call uses the **task's** `warehouse_id`, never `profile?.default_warehouse_id`. Fix any stray usage.
- Same audit for pick-task bay/location pickers in `src/features/picking/picking-page.tsx`.

No schema or RPC change needed.

## 3. Non-disruptive background refresh

Two mechanisms currently cause "hard refresh" feel:

- `src/hooks/use-background-sync.ts` calls `queryClient.invalidateQueries()` (all queries) when the tab returns after 2 min hidden. That can re-render an in-progress put-away/pick screen, dropping local form state and scan focus.
- `src/main.tsx` registers the PWA service worker with auto-reload behaviors that, in some flows, can navigate the page.

**Changes**
- Introduce a tiny module `src/lib/active-work.ts` exporting:
  ```ts
  let active = 0;
  export function beginActiveWork(): () => void { active++; return () => { active = Math.max(0, active-1); }; }
  export function isActiveWorkInProgress() { return active > 0; }
  ```
- `use-background-sync.ts` — when returning to foreground:
  - Always flush the offline queue (unchanged).
  - If `isActiveWorkInProgress()` is true, **skip** the blanket `invalidateQueries` and instead only invalidate safe, read-only keys (`["putaway-tasks"]`, `["pick-lists"]`, `["warehouse-bay-occupancy"]`, `["options"]`) using `{ refetchType: "none" }` so background data stays fresh on next access but no in-flight screen re-mounts.
  - If no active work, keep today's behavior.
- Mark active work from the screens that own scan/confirm flow:
  - `putaway-page.tsx` — call `beginActiveWork()` when a pallet has been scanned and a task is selected; release it on confirm/cancel/back to scan prompt.
  - `picking-page.tsx` — call `beginActiveWork()` when a pick task is in progress (location scanned or quantity entered); release on confirm/skip/cancel.
  - `receiving-page.tsx` — call it while the New Shipment / Print Draft dialog is open.
- `src/main.tsx` PWA hook — when `onNeedRefresh` fires and `isActiveWorkInProgress()`, defer `updateSW(true)` until `visibilitychange → hidden` **and** active work is zero (current code already waits for hidden; add the active-work guard). Same for the preview-mode SW cleanup reload: skip the `window.location.reload()` if active work is in progress; reschedule on the next idle visibility change.

This keeps data fresh in the background while guaranteeing that an operator mid-task is never bounced.

## Verification

- `bunx tsc --noEmit`
- `bunx vitest run src/test/putaway-page.test.tsx src/test/pick-tasks.test.ts`
- Manual: set a specific warehouse → confirm only its put-away tasks and pick lists appear; switch to "All warehouses" (admin) → both warehouses show. Open bay selector from a task created in WH-A while "All" is active → only WH-A bays load.
- Manual: start a put-away (scan pallet, open bay selector), background the tab for >2 min, return → the in-progress dialog is still open with the same task and scan focus; no flicker, no data loss.

## Out of scope

- No visual redesign, no schema changes.
- Sidebar active-doc count behavior is unchanged.
