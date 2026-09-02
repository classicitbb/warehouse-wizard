# Verify the forced-update system on the live site

The version-gate work from the earlier plan is already in the codebase: the `app_release_policy` table, `release-policy.ts`, `forced-update-banner.tsx`, `release-gate.tsx`, `daily-refresh.ts` wired from `main.tsx`, and the admin **Release control** panel. What has not happened is an end-to-end check that it actually forces a stale tab to reload.

Since the Lovable preview URL is returning 401 at the platform gate, verification runs against the published site instead.

## What gets verified

1. **Policy read path** — an authenticated session on the live site reads the `app_release_policy` row without an RLS/grant error.
2. **Force path** — setting `min_required_version` to the current build and `force_after` to now surfaces the banner with a countdown on an already-open tab, and the tab hard-reloads at expiry.
3. **Active-work deferral** — with a scan/confirm flow open, the auto-reload holds until the flow finishes or the grace window expires.
4. **Daily refresh guard** — the once-per-day stamp prevents a reload loop, and the routine is skipped inside the preview iframe.
5. **Admin panel** — Release control writes are gated to admin/developer and rejected for other roles.

## Fixes in scope

Only defects surfaced by the checks above: missing grants, a wrong version comparison at the roll-at-10 boundary (`1.29.10` -> `1.30.0`), a banner that never fires, or a reload loop. No redesign of the flow.

## Technical notes

- Verification uses a headless browser session against `https://warehousewizard.app`, restoring an authenticated session, plus direct queries against `app_release_policy`.
- Version comparison lives in `src/lib/release-policy.ts`; any correction there gets a matching unit test.
- The policy row is restored to its original values after testing so no operator is force-reloaded by the test itself.
- Because only published builds appear on the live site, any code fix needs a publish before it can be re-verified.
