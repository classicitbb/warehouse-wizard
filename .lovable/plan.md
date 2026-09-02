# Keeping everyone on the latest build

Today the app only *suggests* updates: the service worker polls every 30 minutes, shows a toast, and applies the new build when the tab goes idle. Nothing forces a stale tab (a shift-long open tab on a floor tablet) onto a hot fix, and nothing guarantees a clean start each morning. This adds a server-controlled version gate plus a daily freshness routine.

## 1. Server-controlled minimum version (hot fixes)

A single settings row in the database holds the release policy:

- `min_required_version` — builds older than this must reload
- `force_after` — timestamp when the grace period ends
- `grace_minutes` — how long operators can finish current work (default 10)
- `message` — optional note shown to operators ("Hot fix: pallet moves")
- `nightly_signout_enabled`, `daily_refresh_hour` (default 04:00 local)

Every client subscribes to that row in realtime and also re-checks it on focus/reconnect and every 5 minutes.

When the running build is older than `min_required_version`:

1. A persistent banner appears: "New version required — reloading in 9:58" with a **Reload now** button.
2. During the grace window, operators can finish a scan/confirm flow. The existing active-work tracker delays the auto-reload only until the flow completes or the grace expires.
3. At expiry the app clears caches, unregisters the old service worker, and hard-reloads. In-progress form state that already supports drafts is saved first (receiving drafts, putaway task state).
4. Operators who granted notification permission also get the existing OS-level build notification, so a backgrounded tablet surfaces it.

Publishing a hot fix then means: publish as usual, then set the required version from Settings.

## 2. Admin control in Settings

New "Release control" card in the Environment tab (admin/developer only):

- Current published version and how many active sessions are on which version (from a lightweight heartbeat already implied by telemetry)
- **Force everyone onto v X.Y.Z** button — writes `min_required_version` = current build, `force_after` = now + grace
- Grace-period selector, optional message
- Toggles for nightly sign-out and morning refresh hour

## 3. Daily freshness (each morning)

On app start and on the first focus after the configured hour (default 04:00 local):

- If the last successful "daily refresh" stamp is from a previous day, purge all caches, unregister service workers, then reload once. Guarded by the active-work tracker and a once-per-day key so it never loops.
- Optional nightly sign-out: if enabled, any session whose last activity is before the configured cutoff is signed out on next load, so the morning starts with a fresh login and a fresh bundle.

Both are off-by-default-safe: the refresh always runs, sign-out only when the toggle is on.

## Technical notes

- New table `public.app_release_policy` (singleton), readable by all authenticated users, writable only by admin/developer roles, with GRANTs and RLS.
- New `src/lib/release-policy.ts`: reads the policy, compares against `__APP_VERSION__` with a semver-aware comparison matching the project's roll-at-10 numbering, exposes a hook for the banner.
- New `src/components/forced-update-banner.tsx` mounted in the app shell; reuses existing toast/banner styling and `isActiveWorkInProgress()`.
- New `src/lib/daily-refresh.ts` holding the once-per-day purge + reload logic; wired from `src/main.tsx` alongside the existing purge block, and skipped inside the Lovable preview iframe via `preview-env.ts`.
- Service worker polling interval tightened from 30 to 5 minutes so a hot fix is detected quickly even without the policy row.
- Tests: version comparison, grace-period expiry, once-per-day guard, and active-work deferral.
- Version bump and release notes on publish.
