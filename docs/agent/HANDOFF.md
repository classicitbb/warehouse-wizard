# Work Handoff

- Repository: `classicitbb/warehouse-wizard`
- Status: Incomplete — Copilot composer implementation awaits authorized browser verification and deployment approval
- Last updated: 2026-08-30

## Current state

Implemented the Warehouse Copilot composer upgrade locally. It now has an auto-growing keyboard-first textarea, Enter send / Shift+Enter newline behavior, immediate duplicate-send locking, bounded context (five client turns, six server turns), new-chat reset, server-grounded source labels, idempotent response feedback, and a microphone control. Dictation records up to one minute, sends the clip to a protected Edge Function for server-side Lovable transcription, then inserts the editable transcript into the composer; it never auto-sends.

The Copilot Edge Function now requires a verified signed-in profile with a default warehouse and explicitly filters inventory, receipt, location, open-work, expiry, blocked-work, and task reads to that warehouse. It still has no operational write tools: inventory, pallet, location, print, cycle-count, and freeze changes cannot be executed by the model. Problem reports remain the existing separately approved/audited exception.

## Exact next action

Use an approved non-production Warehouse Wizard operator in external Chrome or Edge to sign in, then open Copilot and type into the composer with real keystrokes: verify focus/editability, Shift+Enter newline, Enter send, pending duplicate-send prevention, source labels, Helpful/Not helpful idempotency, New chat, microphone permission, recording, Done/transcription state, and editable review-before-send. Do not use clipboard fill or the in-app browser as the test proof.

## Baseline verification

Passed `npm run test -- --run src/test/copilot-panel.test.tsx` (17 tests), `npm run typecheck`, `npm run build`, and `git diff --check`. The build retains pre-existing large-chunk warnings for the WMS UI/vendor chunks. External Edge reached `http://127.0.0.1:8080/login`, but the composer cannot be opened without a signed-in approved operator; no credentials were supplied and no access boundary was bypassed.

Affected files: `src/features/copilot/copilot-panel.tsx`, `src/features/copilot/use-copilot-dictation.ts`, `supabase/functions/copilot-transcribe/index.ts`, and `supabase/config.toml`.

Deployment/environment state: local changes only. The new migration and Edge Function configuration have not been applied or deployed. Approval required before any deployment or database migration.

## Required incomplete-work record

Objective; current state; completed steps; affected files; tests/commands and exact failures; deployment/environment state; blocker; approval required; one exact executable next action.

## Warehouse Intelligence Phase 1 — 2026-08-30

- Objective: scope Command Center intelligence to the active warehouse, make evidence visible, and use configured reorder forecasts instead of a fixed low-stock quantity.
- Completed: active-warehouse query filtering for dashboard signal inputs; an additive `location_occupancy_view` migration exposing `warehouse_id`; reorder-alert evidence in Warehouse Brain; a unit test proving a hard-coded inventory threshold no longer produces a reorder recommendation.
- Affected files: `src/features/dashboard/dashboard-page.tsx`, `src/features/shared/ui-shared.tsx`, `src/features/reports/reports-core.ts`, `src/features/status/status-page.tsx`, `src/lib/enterprise-wms.ts`, `src/test/enterprise-wms.test.ts`, `supabase/migrations/20260830021615_warehouse_intelligence_phase_one_scope.sql`.
- Verification: passed `npm run typecheck`, `npm run lint`, `npm run test` (45 files, 518 tests), `npm run build`, and `git diff --check`. Build retained existing Vite chunk-size warnings.
- Environment state: no migration applied and no deployment performed. `supabase migration list --local` could not run because local Postgres is unavailable (`failed to connect to postgres: effect/sql/SqlError: PgClient: Failed to connect`). External Chromium loaded the login page without a Vite overlay, but the checked-in seeded login was rejected with `The email or password you entered is incorrect. Please try again.`
- Approval required: apply the new migration to the intended Supabase environment; provide or authorize a valid non-production account for external-browser dashboard verification.
- Exact next action: after approval and project linkage, run `supabase db push`, then sign in through external Chrome or Edge and confirm the Dashboard Office view shows Warehouse Intelligence evidence only for the active warehouse.

### Migration correction — 2026-08-30

The original Phase 1 view migration failed in the target SQL editor with `ERROR: 42P16: cannot change name of view column "location_code" to "warehouse_id"`. Cause: PostgreSQL `CREATE OR REPLACE VIEW` preserves existing view-column positions, and the migration inserted `warehouse_id` as the second selected field. Fixed by preserving the nine existing fields in their established order and appending `l.warehouse_id` last. Added a migration regression assertion in `src/test/migration.test.ts`; passed `npm run typecheck` and `npm run test -- --run src/test/migration.test.ts src/test/enterprise-wms.test.ts` (2 files, 27 tests). Exact next action remains: rerun the corrected `20260830021615_warehouse_intelligence_phase_one_scope.sql` in the intended environment.

### Favicon composition fix — 2026-08-30

- Objective: maximize the visible green pallet cube and gold status mark in browser tabs that apply rounded favicon clipping.
- Completed: added `public/favicon.svg` with a square dark base and a 1.28x enlarged mark, then pointed `index.html` at that dedicated favicon URL. The PWA and application icon sources remain unchanged.
- Verification: passed `npm run build` and `git diff --check`; inspected the generated SVG in external Chrome headless rendering. Build retained the pre-existing dynamic-import and chunk-size warnings.
- Environment state: local asset/source change only; no deployment performed. This favicon work is complete and requires no further action. Existing Copilot and migration handoff actions above remain active.

### Sidebar vertical compression — 2026-08-30

- Objective: let desktop sidebar navigation buttons compress before showing a vertical scrollbar, in both expanded and icon-only states.
- Completed: made the navigation list fill its available height and share that height among buttons; buttons now shrink from the existing 54px maximum to a readable 36px minimum before the navigation itself overflows. The collapsed state uses the same sizing rule.
- Affected files: `src/features/shared/ui-shared.tsx`.
- Verification: passed `npm run typecheck`, `npm run build`, and `git diff --check`. The build retains the existing dynamic-import and chunk-size warnings. External Edge reached the local login page at `http://127.0.0.1:8080/login`; authenticated sidebar rendering could not be checked because no approved operator session was available.
- Environment state: local source change only; no deployment performed.
- Exact next action: with an approved non-production operator session in external Edge or Chrome, verify at a short landscape viewport that expanded and collapsed sidebar buttons compress to 36px before the navigation shows a scrollbar.
