# Fix batch: connection recovery, spinners, Rack J capacity, putaway search, notifications, What's New

## 1. Lost connection recovers itself (no manual reload)

Today `useNetworkStatus` probes the backend health endpoint every 45s and on browser
online/offline/focus events. When a device drops, the operator often force-reloads.

Change: while the app believes it is offline, switch to a fast self-healing retry loop
(2s, 4s, 8s, capped at 15s) instead of waiting for the 45s tick. When a probe succeeds,
the app recovers in place: refresh the auth session, refetch active queries, and clear
the offline banner — no page reload. This runs on the login screen too, so a signed-out
device that loses Wi-Fi comes back on its own.

## 2. Monochrome single spinner

The `animate-themed-loader` keyframes cycle primary/accent colours, scale, and a glow.
Replace with a single plain rotation in one muted colour so every loading indicator in
the app looks identical and calm.

## 3. Rack J bays 3-23 showing wrong bay/rack counts and no fill level

Confirmed cause: the warehouse tree's fill-stat query selects every location with no
paging. The database currently holds 1,358 visible locations, and an unpaged request is
capped at 1,000 rows by the data API. Zones A-I already consume that budget, so Zone J's
locations arrive with no stats at all and the fill indicator renders empty.

Fix: page the fill-stats query (and the tree search query, same issue) in 1,000-row
batches using the existing `fetchAllRows` helper. Also raise the per-zone location fetch
cap so a zone larger than 201 bins is not silently truncated.

## 4. Putaway search steals the cursor

Typing in the Putaway task search changes the active-task count, which re-triggers the
"auto-focus first pallet field" effect, so the caret jumps to the first task's pallet
barcode input after the first character.

Fix: only auto-focus the first pallet field when the task list identity actually changes
(new tasks loaded), and never when the search box currently has focus.

## 5. Notification settings

New "Notifications" section in Settings with:

- Per-device/browser toggle for new-build notifications (stored locally per browser).
- Permission state readout: granted / not asked / denied / unsupported.
- A friendly "Enable notifications" button that triggers the browser prompt.
- When permission is denied, show fallback instructions for unblocking the site
(browser site-settings steps for desktop and Android), plus a note that in-app toasts
still work.

`notifyNewBuildAvailable` will respect the per-device toggle.

## 6. What's New popup after a version update

After the app reloads onto a newer version, automatically open a "What's new in  
vX.Y.Z" dialog with the release-notes summary for that version. Shown once per version  
per browser (stored locally), dismissible, and suppressed while an active scan/confirm  
flow is in progress so it never interrupts floor work.   
for non developer users, tapping or clicking the version number in desktop or mobile on the app screen takes them to Settings > About.

## Technical notes

- `src/hooks/use-network-status.ts` — backoff probe loop while offline, recovery event
that triggers session refresh + query refetch.
- `src/index.css` — simplify `themed-loader-spin` keyframes.
- `src/components/warehouse-tree-view.tsx` — `fetchLocationFillStats` and
`fetchTreeSearchLocations` paged via `fetchAllRows`; `fetchZoneLocations` cap raised.
- `src/features/putaway/putaway-page.tsx` — guard the auto-focus effect.
- `src/lib/build-notification.ts` + new settings panel in
`src/features/admin/admin-page.tsx` — per-device preference and permission UX, reusing
`use-notification-permission`.
- `src/App.tsx` — version-change What's New dialog driven by `RELEASE_HISTORY[0]`.
- Version bump to 1.28.8 with release notes, What's New copy, and a Help Center topic for
notification settings.