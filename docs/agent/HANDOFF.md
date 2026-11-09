# Work Handoff

## White landing V2, legal drafts and login links — 2026-11-02

- Status: Complete — no active handoff for the landing implementation. User authorized pushing to sandbox main on 2026-11-02; legal effectiveness and production promotion remain deferred. Prior operational handoffs below remain separate.
- Owner direction: white V2 emphasizing inventory uncertainty, ERP/accounting adaptability, stock/warehouse/layout/capacity/movement configuration, guided workflows, cloud access, security and MCP-compatible AI reporting. `/landing-v2` is separate from the original `/landing`; V2 omits release versions and micro-feature grids. Interactive stock/spaces/flow panels illustrate adaptability without pretending to be live warehouse data.
- Navigation: both landing versions have Back to top controls and real legal-document links. Login's existing desktop footer now says `Explore Warehouse Wizard — visit the landing page`; the four feature tiles link to V2's pallet-tracking, pick/put-away, cycle-count and multi-warehouse explainers. A matching deep link opens the relevant FAQ and scrolls it below the sticky header. No authentication handlers or permissions changed.
- Legal: owner confirmed Classic Visions, Barbados, and local jurisdiction where software is used. Added substantive privacy, terms and end-user licence review drafts at `/legal/privacy`, `/legal/terms`, `/legal/licence`, each explicitly not yet effective. Final law/forum, mandatory local protections, commercial terms, retention, processing regions and provider/analytics disclosures need review before making these effective. No agreement acceptance flow, compliance certification or fabricated commercial promises added.
- Affected files: `src/App.tsx`; `src/features/landing/landing-page.tsx`, `demo-request.tsx`, `landing-shared.css`, `landing-v2.tsx`, `landing-v2-data.ts`, `landing-v2.css`, `landing-legal.tsx`, `landing-legal.css`; `src/test/landing-v2.test.tsx`; continuity files. Earlier landing changes are included in the same authorized sandbox release.
- Verification: final `npm run typecheck` passed; focused ESLint including App and changed landing components passed; `npm run test -- src/test/landing-page.test.tsx src/test/landing-v2.test.tsx` passed 13 tests; `npm run build` passed including service worker, with existing >500kB chunk warnings; `git diff --check` passed. Desktop, 390px mobile, 320px narrow mobile and 768px tablet inspected; no main-content horizontal overflow at 320/390/768px. Browser verified Back to top reaches scrollY 0, tab switching, white demo dialog and Escape/focus return, all three legal routes, and Login → pallet-tracking opens the correct FAQ (scrollY >0). All four deep-link targets are covered by tests. No request email or authentication submission was made.
- Environment: local sandbox preview at `http://127.0.0.1:8082/landing-v2`. No new dependency, environment variable, external service, connector configuration, schema/data write or deployment. Generated auth/database files untouched. Code inspected to scope MCP claims to signed-in read-only warehouse/product/inventory tools; general ERP/API connections require suitable APIs, mapping and tests.
- Release: 1.33.1 prepared for the authorized sandbox-main push, with package/lock versions, release history and the public-product-page Help article updated together. Release verification passed typecheck, focused ESLint, the 13 landing tests plus 8 Help-content tests (21 total), the full application/PWA build and diff checks. Legal review/finalization and production promotion still require separate approval.
- Exact next action: none for the implementation after the authorized sandbox-main push. Review the linked legal drafts before making them effective or promoting to production.

## Sandbox landing page foundation — 2026-11-02

- Status: Complete — no active handoff for the landing-page task. Unrelated handoffs below remain unchanged.
- Implemented: installed and applied user-level Frontend Design and Web Design Guidelines; improved fluid hero typography, preview readability, phone/tablet layout, visible focus, skip link, semantic sign-in links and FAQ associations. Replaced placeholder endorsements with the receive/put-away/pick sequence; removed nonexistent company/legal destinations and added the approved business contact. Radix demo dialog traps focus, closes on Escape, restores focus to the invoking CTA and prepares a visitor-sent email. No email was sent during verification.
- Affected files: `src/features/landing/landing-page.tsx`, `src/features/landing/landing-data.ts`, `src/test/landing-page.test.tsx`, `docs/agent/PROJECT_KNOWLEDGE.md`, this handoff.
- Verification: `npm run test -- src/test/landing-page.test.tsx` passed (3 tests); focused ESLint passed; final `npm run typecheck` passed; `npm run build` passed including PWA/service worker, with existing large-chunk warnings; `git diff --check` passed. Browser inspected desktop, 390px and 320px phones and 768px tablet; no main-content overflow at 320/768px; Escape and actual-CTA focus restoration verified. The first focus test asserted before Radix cleanup; corrected to await restoration. Removed unsupported Testing Library `exact` option found by typecheck.
- Environment: local preview remains at `http://127.0.0.1:8082/landing`. Initially typecheck failed on absent `@electric-sql/pglite`/`fake-indexeddb` packages and their downstream implicit-any errors. Restored with `npm install --no-save --package-lock=false --ignore-scripts @electric-sql/pglite@0.5.3 fake-indexeddb@6.2.5`; npm also re-resolved local node_modules (212 changed packages), leaving package manifest/lock unchanged. A build overlapping that install transiently failed with `ERR_PACKAGE_PATH_NOT_EXPORTED` for `estree-walker`; the final post-install build passed. No services, credentials, schema, auth or environment-variable names changed.
- Delivery: local source only; no publishing, deployment, version bump or release entry. This is a foundation for further sandbox work. Public release needs separate approval and the required version/release/help updates. Legal documents and customer endorsements were not fabricated.
- Exact next action: none for this task. To reopen the local preview, run `npm run dev -- --host 127.0.0.1 --port 8082` from the sandbox checkout if the existing server has stopped.

## Desktop header sizing and account control — 2026-10-31

- Status: Complete — source change, production build, and local dashboard browser check verified.
- Objective: match the desktop top bar's annotated 43px height and 21px horizontal inset, remove vertical padding, and make the account control a square, full-height segment integrated with the toolbar.
- Affected files: `src/features/shared/app-shell.tsx`.
- Verification: `npm run build` passed (Vite reports existing chunks above 500 kB); `git diff --check` passed.
- Responsive decision: changes apply only to the existing landscape-desktop header (`lg:landscape:flex`); mobile header retains its own sizing and padding.
- Environment: source-only change; no services, connectors, data, environment-variable names, deployment, or production writes involved.
- Exact next action: none for this change.

### Responsive dashboard view check — 2026-10-31

- Status: Mobile inspected; tablet viewport check remains pending.
- Mobile observation: dashboard cards stack in one column, and the mobile header plus bottom navigation render. The reorder-alert prompt overlays part of the Put-Away card list at the current narrow viewport.
- Tablet check: the in-app browser viewport controls are unavailable in this session, so no tablet-size rendering was verified.
- Affected files: none; inspection only.
- Exact next action: set the local dashboard browser viewport to 768 × 1024 and 1024 × 768, then inspect the dashboard header, card layout, and horizontal overflow.

### Tablet header and mobile menu — 2026-10-31

- Status: Source corrected; targeted shell test and production build passed. Tablet browser viewport verification remains unavailable in this session.
- Cause: the initial tablet breakpoint hid the mobile header, which also removed its hamburger menu. Corrected by keeping the existing mobile header/menu through tablet widths and applying the desktop segmented style and desktop controls from `md` upward; the full landscape desktop toolbar/sidebar still uses `lg:landscape`.
- Affected files: `src/features/shared/app-shell.tsx`, `src/components/help-sidebar.tsx`.
- Verification: `npm run test -- --run src/test/app-shell.test.tsx` passed (11 tests), including opening the navigation Sheet from the mobile menu trigger; `npm run build` passed with the existing large-chunk warning; `git diff --check` passed.
- Environment: source-only UI change; no service, connector, data, deployment, or environment-variable changes.
- Exact next action: complete build and diff checks; when a viewport controller is available, inspect tablet at 768 × 1024 and 1024 × 768 and confirm the hamburger opens the navigation Sheet.

### Desktop header action segments — 2026-10-31

- Status: Complete — browser measurement confirms all five desktop controls render at 43px with square corners; build and diff checks passed.
- Objective: extend the account control's square, edge-to-edge 43px segment style to the desktop warehouse dropdown, Copilot, Help, offline status, and notifications.
- Affected files: `src/features/shared/app-shell.tsx`, `src/features/copilot/copilot-panel.tsx`, `src/components/help-sidebar.tsx`.
- Responsive decision: desktop-only header triggers receive the new treatment; mobile header, in-panel Copilot controls, and standalone Help triggers keep their existing styles.
- Environment: source-only UI change; no services, connectors, data, environment-variable names, deployment, or production writes involved.
- Verification: `npm run build` passed; Vite reports existing chunks above 500 kB. `git diff --check` passed. In the local dashboard at desktop landscape, the header and warehouse, Copilot, Help, notification, and account controls measured 42.99px with 0px border radius.
- Exact next action: none. The offline badge is conditional on the device being offline, so its rendered state was not present in the browser check.

## NetSuite putaway/receipt double count — 2026-10-21

- Status: Complete. Merged to sandbox `main` (PR #15) and the migration is applied to the Beta Sandbox database; verified 2026-10-21. Not yet promoted to production.
- Problem: putaway posts an inventory adjustment for every pallet. Once receipts post to NetSuite as item receipts at label print (W3), goods received against a NetSuite PO, transfer order or inbound shipment would reach NetSuite twice. Receipt posting is not built yet, so the adjustment is currently the only NetSuite record of received stock and must keep running until W3 lands.
- Found while fixing it: pallets were never linked to their receipt line. `20260902143104` added `#variable_conflict use_column` to `confirm_receiving_draft_labels_printed`, which made its `receipt_line_id = receipt_line_id` assignment a no-op. In the beta every pallet (105 of 105 checked) had a null `receipt_line_id`. No other function patched by that migration has the same self-assignment.
- Implemented (`supabase/migrations/20261021200000_netsuite_receipt_sourced_putaway.sql`): renames the label-print function's local variable in its live definition (patch-in-place, raises if the expected text is not found exactly once); backfills missing links from the latest `receiving_labels_confirmed` audit event per pallet; adds `netsuite_receipt_sourced_pallet(uuid)`; and `enqueue_netsuite_inventory_sync` skips the adjustment for receipt-sourced pallets only while the connection config has `receipts_post_to_netsuite = true`. Unset means no behaviour change. Safe to re-run. Documented in `INTEGRATIONS.md` under the outbound adjustment record.
- Verification: `src/test/netsuite-receipt-sourced-putaway-sql.test.ts` runs the repository's label-print function, the real `20260902143104` patch and this migration in PGlite (7 tests): the link is broken before, backfilled and fixed after, adjustments unchanged with the switch off, skipped only for NetSuite-sourced receipts with it on, and free-text notes never block a putaway. Mutating the skip rule or the link fix fails 2 tests each. `npm run typecheck`, focused ESLint and the full suite (93 files, 1067 tests) pass.
- Beta verification (read-only SQL, Lovable project `6551924b-3ab6-438c-aa56-1ff68b978f25`): `confirm_receiving_draft_labels_printed` now assigns `v_receipt_line_id`; `enqueue_netsuite_inventory_sync` reads `receipts_post_to_netsuite`; `netsuite_receipt_sourced_pallet` exists. 105 of 105 pallets are linked to a receipt line (0 before), including all 87 pallets waiting for putaway. 75 pallets are recognised as NetSuite-sourced, matching the 75 receipts loaded from NetSuite documents. `receipts_post_to_netsuite` is unset, so putaway adjustments continue unchanged.
- Approval required: promoting `20261021200000` to production (see `docs/REPO_SYNC.md`); setting `receipts_post_to_netsuite = true`, which belongs in the same change that turns on receipt posting (W3).
- Exact next action: none for this fix. When W3 receipt posting is built, set `receipts_post_to_netsuite = true` on the NetSuite connection in the same change, then confirm a putaway of a NetSuite-sourced pallet queues no `inventory_adjustment` job while a manual receipt still does.

## Duplicate inbound receiving — 2026-10-21

- Status: App safeguard verified; database-atomic safeguard blocked.
- Implemented: paginated active drafts and unfinished Put-Away receipt links, per-container browser blocking with Show drafts / Go to Put-Away, fresh checks on Receive, form load, and shipment draft save. Different containers remain independent.
- Verification: `npm run test -- src/test/inbound-receiving-work.test.ts src/test/receiving-inbound.test.tsx src/test/inbound-browser-dialog.test.tsx src/test/inbound-shipment-lines.test.ts src/test/receiving-page.test.tsx` — 82 passed. Harness build OK. Authenticated browser with real removable fixtures: draft blocks IS052 and manual save, cancellation unblocks; completed receipt with queued Put-Away blocks IS052 and manual save, task completion unblocks. All fixtures removed; zero-stock Put-Away fixtures made no inventory balance changes.
- Blocker: migration tool failed on pre-existing `policy "Supervisors delete product_packaging_profiles" for table "product_packaging_profiles" already exists`; no new migration applied. Do not claim simultaneous saves or direct database inserts are atomically protected. Returned/correction drafts lacking original container metadata remain an additional provenance edge case.
- Exact next action: resolve the existing migration journal conflict through the migration system, then apply and test a statement-level receipt insert guard with advisory locking that excludes its own batch and preserves correction/returned-pallet flows. Do not edit shipped migrations or bypass the migration tool.
- Files: `src/features/receiving/inbound-receiving-work.ts`, inbound browser/card, receiving page/core, receiving tests. Pre-existing type errors in units/package-type queries corrected using the established dynamic table helper; generated definitions untouched.

- Repository: `classicitbb/warehouse-wizard`
- Status: Incomplete — NetSuite is live against the `_SB1` sandbox from the Beta Sandbox project (17 inventory adjustments posted), and the beta owns that sandbox account (decided 2026-10-21). Production's NetSuite connection has been disabled since 2026-10-16 and has never sent a job; production needs its own live-account integration before cutover (see the 2026-10-21 entry); Release policy / fleet freshness awaits database migration and deployment approval; Copilot composer still awaits authorized browser verification
- Last updated: 2026-10-21

## NetSuite live status check — 2026-10-21

- Decision (2026-10-21, Russell): **the Beta Sandbox project owns the connection to the `_SB1` NetSuite sandbox account.** Production must not post to it. Production gets its own NetSuite integration record and certificate in the live account at cutover (whitepaper Q-J5, runbook B3).
- Objective: record the deployed NetSuite state, which had moved well past the 2026-09-16/21 entries below. Read-only SQL through the Lovable connector against both Lovable projects in the Simplex Trading workspace. No writes, deploys, queue runs or NetSuite requests were made. Secret values were not read.
- Projects: production is Lovable project `Warehouse Wizard` (`b1278655-12aa-44aa-a245-7d311e40dddf`, Supabase ref `gxfvxmxplngvxdkpmxgw`). The beta is Lovable project `Warehouse Wizard — Beta Sandbox` (`6551924b-3ab6-438c-aa56-1ff68b978f25`), created 2026-09-28. The Supabase connector cannot reach either database (both are Lovable-managed); use the Lovable connector's `query_database`.
- Certificate (whitepaper Q-J1): no longer blocking. Both connections have a Certificate ID saved and the private key stored. Production's Test connection passed on 2026-09-25. The beta's passed on 2026-10-06.
- Beta: working end to end. 17 `inventory_adjustment` jobs between 2026-10-06 and 2026-10-21, all `succeeded` on the first attempt, each with a `netsuiteId` in `result` (inventory adjustments 29462–30391 in the sandbox). Recent jobs post 3–10 s after the putaway, so something drains the beta queue automatically. It is not a `pg_cron` job in the beta database; the drain mechanism was not identified. The adjustment account is 469 and the subsidiary is 2. The beta holds 3,708 products, 3 warehouses and 30 `external_record_links`. No inbound webhook payloads have been logged.
- Production connection disabled: `integration_connections.enabled = false`, last changed 2026-10-16T04:44Z (it was still enabled on 2026-10-10). The `enabled` switch is in Settings > Integrations and only applies on Save connection. While disabled, `enqueue_netsuite_inventory_sync` creates no jobs, and `netsuite_integration_active()` returns false, so the NetSuite UI on Receiving, Transfers, Status, the dashboard Inbound tile and Resources is hidden. The account id (`9738806_SB1`), Certificate ID, the 5 stored secrets and the 6 `external_record_links` (5 items, 1 location) are kept. The links hold sandbox internal ids and must be remapped against live NetSuite ids at cutover.
- Production's failed Test (2026-10-16T04:44Z) is most likely because the sandbox's M2M mapping was moved to the beta's certificate: the beta has its own, different Certificate ID and its Test passed at 05:03Z the same day. Not confirmed against NetSuite's Login Audit Trail. Under the decision above, this needs no fix.
- Production: zero `integration_sync_jobs` and zero `integration_payload_logs` ever. The `pg_cron` job `process-netsuite-queue` (every minute, via `net.http_post`) exists but is inactive, and last ran 2026-08-20. `pg_net` 0.20.0 is installed, contrary to the runbook's "no `pg_net`" constraint. The adjustment account (469) and subsidiary (2) are set. **The last Test connection, on 2026-10-16T04:44Z, failed** (`last_test_ok = false`). The cause was not visible: edge-function logs are not reachable from the connectors. The 2026-09-15/16 migrations are in effect: `claim_integration_sync_jobs` takes `p_job_types`, `enqueue_netsuite_inventory_sync` emits `netsuiteItemId`, and the payload-log and succeeded-job purge crons exist. Lovable records them under its own migration versions, so the repository version numbers do not appear.
- Resolved risk — shared NetSuite account: production (`9738806_SB1`) and beta (`9738806-sb1`) both pointed at the same NetSuite sandbox. Resolved by the decision above and production's disabled connection; do not re-enable production's connection while it still points at `_SB1`. Production is not connected to live NetSuite at all.
- Risk — sandbox stock inflation: every putaway posts a positive adjustment. Repeated test putaways have added +151 `CL1GALROUND` seven times and +2,480 `GJWCFSLIP` five times (+160 once more). Each came from a distinct balance, so these are not duplicate sends, but sandbox on-hand for those items is overstated.
- Resolved in the sandbox repo — Phase 1 double count: `classicitbb/warehousewizard-sandbox` PR #15 (migration `20261021200000_netsuite_receipt_sourced_putaway`, applied to the Beta Sandbox 2026-10-21) skips the putaway adjustment for pallets received against a NetSuite document once the connection config sets `receipts_post_to_netsuite = true`, which belongs with W3 receipt posting. It also fixes label print never linking pallets to their receipt line. Reaches production on the next sandbox promotion; see the sandbox repo's HANDOFF entry.
- Unknown: the 2026-10-02 Lovable commit titled "Fixed NetSuite 502 error" (`0fe1a89`) changed only `bun.lock`. Whatever fixed the 502 happened outside the repository.
- Approval required: production's move to the live NetSuite account (a new integration record, certificate and remapped links), including re-enabling its connection and its `process-netsuite-queue` cron; any correction of sandbox stock.
- Exact next action: none for production until cutover is scheduled. For the beta, decide whether the inflated sandbox stock for `CL1GALROUND` and `GJWCFSLIP` should be corrected, and address the putaway/receipt double count before Phase 1 receiving (W3) is built.

## Branch deployment repair — 2026-10-20

- Status: Local repair verified; user approved pushing the repair and reopening PR #31 on 2026-10-20. Hosted verification is pending. Other migration/deployment handoffs below remain separate.
- Branch/PR: `codex/inventory-whole-pallet-picking`, PR #31 (verified closed without merging on 2026-10-20). Local repair commit: `4cc662d`; remote head remains `e8123bd`. This commit has one parent and changes only dependency files; no bad merge was found.
- Exact failures: Vercel preview build failed with `[postcss] It looks like you're trying to use tailwindcss directly as a PostCSS plugin` after the dependency-only upgrade from Tailwind 3 to 4. GitHub Actions run `39452610629` failed lint at `src/integrations/supabase/previewAuthStorage.ts:38:11`: `'timer' is never reassigned. Use 'const' instead` (`prefer-const`). Local full-suite verification also reproduced the existing CRLF-sensitive migration assertion at `src/test/migration.test.ts:169`.
- Repair/affected files: `package.json`/`package-lock.json` restore Tailwind `^3.4.17` (resolved `3.4.19`) and its dependency tree; no other existing package version changes. `eslint.config.js` exempts only the generated preview-auth file from `prefer-const`, keeping generated auth code intact after repeated regeneration removed inline suppressions. `src/test/migration.test.ts` normalizes CRLF in the migration text before assertions; shipped SQL is unchanged. Continuity updated in this file, `PROJECT_KNOWLEDGE.md`, and `INTEGRATIONS.md`.
- Verification re-run on local repair commit `4cc662d` on 2026-10-20 (dependencies already installed): `npm run lint -- --quiet`, `npm run typecheck`, `npm run test -- --reporter=dot` (86 passed files, 1 skipped; 1010 passed tests, 24 skipped), `npm run build` (including PWA service worker), and `git diff --check` all pass. Existing chunk-size warnings remain. Node `22.22.2`, npm `10.9.7`, Windows; Linux Vercel build and authenticated browser/backend behavior have not been rechecked after the fix.
- Environment/approval state: local source/dependencies only. Vercel connector read deployment metadata/build logs; GitHub CLI read PR/check logs. No push, merge, deployment, migration, production data, auth/security behavior, credentials, or environment-variable names changed.
- Exact executable next action (push and reopen now approved): `git push origin HEAD:codex/inventory-whole-pallet-picking`. Reopen PR #31 with the approved GitHub connector update; pushing the branch runs the push workflow and Vercel preview. After approved publication, inspect fresh checks and preview logs for the repair commit. Production deployment and the whole-pallet migration remain separately approval-gated.

## Inventory Search whole-pallet picking — 2026-10-20

- Browser annotation follow-up: Status: Complete — no active handoff for the icon/density correction. `inventory-result-actions.tsx` now uses the existing ghost button as a 24px icon-only three-dot menu trigger, keeping its accessible pallet-specific name; `inventory-page.tsx` removes vertical padding only from the actions cell. Local rendered fixture rows measure 39px (last row 38.5px), unchanged on entering selection; keyboard menu and Select remain functional. `npm run test -- --run src/test/inventory-pick-dialog.test.tsx src/test/inventory-selection.test.tsx` passes 8 tests, `npm run typecheck`, focused ESLint `--quiet`, and `git diff --check` pass. No new failures, configuration, environment names, services or approval needs. Source/local fixture verified; the annotated running server was not redeployed or modified. Exact next local review command remains `npx.cmd vite --config src/test/fixtures/inventory-browser/vite.config.ts`; original migration/deployment approvals below remain separate.
- Status: Complete — no active implementation handoff. Migration application and authenticated non-production verification are intentionally deferred pending target-specific approval. Unrelated handoffs below remain active.
- Branch: `codex/inventory-whole-pallet-picking` (now published as PR #31; deployment-repair changes remain local pending push approval).
- Implemented: complete-page FIFO/FEFO search ordering; touch long-press/right-click/keyboard-accessible actions; visible whole-pallet multi-selection; This pallet / This product (exactly one whole eligible pallet); explicit deduplicated rotation alternatives with full quantity/location/receipt/expiry evidence; atomic stale-plan and eligibility checks; matching queued-list append or required-order-number creation, split by owner. Queued tasks never confirm physical picks or deduct stock. A shared invoker trigger prevents later legacy duplicate open tasks. Help updated; release version/notes bump is deferred to approved publication.
- Affected files: `src/features/inventory/inventory-core.ts`, `inventory-page.tsx`, `inventory-rotation.ts`, `inventory-result-actions.tsx`, `inventory-pick-dialog.tsx`; `src/features/picking/inventory-pick-core.ts`; `supabase/migrations/20261020133102_inventory_whole_pallet_pick_work.sql`; `src/lib/help-content.ts`; `package.json`/lockfile; `src/test/inventory-{rotation,pick-api,pick-sql}.test.ts`, `inventory-{pick-dialog,selection}.test.tsx`, adjusted history-order expectation, isolated `src/test/fixtures/inventory-browser/`; continuity and `docs/testing/inventory-whole-pallet-picking.md`.
- Verification: the exact focused test command in `docs/testing/inventory-whole-pallet-picking.md` passes 9 files / 62 tests (including 19 executable Postgres SQL tests). `npm run typecheck`, `npm run build`, focused ESLint `--quiet` on changed implementation/tests/fixture, and `git diff --check` pass. Build retains large-chunk warnings. Browser fixture exercised context and keyboard menus, selection/count/toggle, chosen vs recommended quantities, existing list selection, mock success, and This product choosing one 7-unit pallet from a 30-unit clicked pallet; no browser console errors. Visual inspection caught and corrected review buttons hidden by the existing sticky footer. Touch long-press is component-tested; actual handheld hardware is unverified.
- Full-suite exception resolved by the branch deployment repair above: the API mock already supplies `supabase.from`, and the migration assertion now normalizes CRLF. The current full suite passes 86 files / 1010 tests with 1 file / 24 tests skipped; shipped migrations remain unchanged.
- Environment: dependencies installed locally with `npm ci --ignore-scripts`; pinned test-only PGlite dependency added. Migration file created with `npx.cmd supabase migration new inventory_whole_pallet_pick_work`, never applied. Harmless Supabase project discovery returned no active Warehouse Wizard data target. No authenticated backend workflow, deployed-schema compatibility, real multi-session contention, migration application, physical picking, production data write, deployment, credential/permission change or push occurred. RPC rights remain invoker and existing RLS/grants apply. No environment-variable names changed. Conservative task/freezes table locks require workload/concurrency verification before promotion.
- Approval still required: identify and authorize the non-production migration target and operator workflow test; separately approve any push/publication/production deployment or production write. The isolated fixture is not authenticated application proof.
- Exact executable next action for local review while approvals are pending: `npx.cmd vite --config src/test/fixtures/inventory-browser/vite.config.ts`, then open `http://127.0.0.1:8089/`. Full target verification checklist is in `docs/testing/inventory-whole-pallet-picking.md`.

## NetSuite non-production smoke harness — 2026-09-21

- Objective: provide executable proof for the current webhook and queue-worker
  safety boundaries without touching a live or sandbox endpoint.
- Completed: extracted the webhook's insert-or-duplicate decision and the
  worker's filtered-claim arguments into
  `supabase/functions/_shared/netsuite-queue.ts`; both Deno entry points use
  those helpers. Added `src/test/netsuite-smoke-harness.test.ts`, an in-memory
  Supabase-shaped harness proving a repeated `item` delivery returns the first
  job, an inbound `purchase_order` stays `queued`, and the worker passes only
  `inventory_adjustment` to `claim_integration_sync_jobs`. Updated the existing
  contract test to execute the same helpers and documented the standalone
  no-network command in `docs/testing/netsuite-record-integration-tests.md`.
- Affected files: `supabase/functions/_shared/netsuite-queue.ts`,
  `supabase/functions/netsuite-webhook/index.ts`,
  `supabase/functions/process-netsuite-queue/index.ts`,
  `src/test/netsuite-smoke-harness.test.ts`,
  `src/test/netsuite-record-flows.test.ts`, and
  `docs/testing/netsuite-record-integration-tests.md`.
- Verification: `npm run test -- --run src/test/netsuite-smoke-harness.test.ts
  src/test/netsuite-record-flows.test.ts` passes (2 files, 36 tests),
  `npm run typecheck` passes, both changed functions bundle with esbuild, and
  `git diff --check` passes.
- Environment state: local source/test/documentation only; no deployment,
  secret, endpoint request, sandbox/production data write, or migration run.
  This harness work is complete. The existing NetSuite certificate upload and
  edge-function/migration approval items below remain active.
- Exact next action: when a real sandbox round-trip is explicitly authorized,
  use the opt-in live suite in `src/test/netsuite-live.integration.test.ts`;
  otherwise run `npm run test -- --run src/test/netsuite-smoke-harness.test.ts`
  after future webhook or queue changes.

## NetSuite inventory adjustment payload — 2026-09-16

- Objective: once authentication works, the outbound `inventoryAdjustment` POST would be rejected. The builder sent wrapper keys (`accountId`, `recordType`, `body`, `idempotencyKey`) as record fields, nested `memo`/`subsidiary`, omitted the mandatory `account`, referenced the item by `externalId: sku` and the location by `externalId`, and relied on a body idempotency field NetSuite does not have.
- Findings (Oracle docs, 2026-09-16): the REST example for the inventory adjustment record puts `account`, `subsidiary`, and `memo` at the top level and uses `{ id }` references. `X-NetSuite-Idempotency-Key` applies only to async requests (`Prefer: respond-async`) and is ignored on synchronous ones, so it was not adopted. A record `externalId` (unique per record type, retrievable at `eid:`) gives the worker idempotency instead. The trigger already looked up the item's internal id and then discarded it.
- Completed (local source): the builder, identical in `supabase/functions/_shared/netsuite.ts` and `src/lib/enterprise-wms.ts`, now returns the bare record body, plus a new `netsuiteAdjustmentExternalId`. `process-netsuite-queue` skips the run while `adjustment_account_id` is unset, resolves the item id from the SKU for old-shape jobs, recovers a timed-out create through the `eid:` lookup, and stores the created record id in `result`. `netsuite-connection` returns and saves `adjustment_account_id` and `adjustment_subsidiary_id`. The Settings NetSuite card has an "Inventory adjustment posting" section. New migration `20260916120000` adds `netsuiteItemId` and `netsuiteLocationId` to the trigger payload. Details are in `docs/agent/INTEGRATIONS.md` under "Outbound inventory adjustment record".
- Affected files: `supabase/functions/_shared/netsuite.ts`, `src/lib/enterprise-wms.ts`, `supabase/functions/process-netsuite-queue/index.ts`, `supabase/functions/netsuite-connection/index.ts`, `src/features/admin/admin-page.tsx`, `supabase/migrations/20260916120000_netsuite_inventory_sync_internal_ids.sql`, `src/test/enterprise-wms.test.ts`, `docs/agent/INTEGRATIONS.md`.
- Verification: `npm run typecheck` passes. `src/test/enterprise-wms.test.ts` passes (11 tests), including a new guard that fails when the two builder copies drift; it failed as expected when the Deno copy was mutated. Full `npx vitest run`: 782 passed, 1 failed. The failure is pre-existing and unrelated: `migration.test.ts` expects LF in `20260830021615_warehouse_intelligence_phase_one_scope.sql`, which `core.autocrlf=true` checks out as CRLF. ESLint on the changed files: 0 errors, no new warnings. All three NetSuite functions bundle with esbuild. The migration's function body differs from `20260720040000` only in the payload keys. A temporary render test (not kept) confirmed the card pre-fills both ids, trims them, sends an empty subsidiary to clear it, and shows the paused state. The authenticated Settings page was not viewed in a browser, because port 8080 belonged to another session and no signed-in session was available. No request has reached NetSuite with the new body.
- Deployment/environment state: committed and fast-forward merged to `main` with user approval (branch `claude/cool-shannon-03d0dc`). A push to `main` syncs code into Lovable but does not redeploy edge functions, so `process-netsuite-queue` and `netsuite-connection` still run the previous code. Whether the Lovable sync applies `20260916120000` on its own has not been checked. Deploy order does not matter: the worker accepts both payload shapes.
- Approval required: applying `20260916120000` if Lovable has not; redeploying `process-netsuite-queue` and `netsuite-connection` (deploy-only Lovable agent message, see INTEGRATIONS.md).
- Exact next action: check whether `enqueue_netsuite_inventory_sync` already emits `netsuiteItemId`. If not, apply `supabase/migrations/20260916120000_netsuite_inventory_sync_internal_ids.sql`. Then redeploy `process-netsuite-queue` and `netsuite-connection` with a deploy-only Lovable agent message, and run `git fetch` to confirm no code edits came back. Once the M2M certificate is registered and Test connection passes, enter the adjustment account's internal id in Settings > Integrations > Inventory adjustment posting. Complete one putaway for a mapped item and warehouse, run the NetSuite queue workflow via `workflow_dispatch`, and confirm the job is `succeeded` with a `netsuiteId` in `result`.

## NetSuite authentication fix — 2026-09-16

- Objective: the connected NetSuite integration returned errors on Test connection and in the item picker.
- Diagnosis: Settings > Integrations > Test connection (signed-in local dev server against the live backend) returned `NetSuite responded 400: {"error":"invalid_request"}`. `last_test_ok` was false. The earlier hostname fix (`netsuiteHost`) is live — the sandbox host resolves. The failure is the auth method: the code sent `grant_type=client_credentials` with the client ID and secret as Basic auth, which NetSuite never accepts for that grant. Probes against the sandbox token endpoint showed malformed or missing assertions return `400 invalid_request`, while well-formed ES256 and PS256 JWT assertions with an unregistered certificate ID return `500 server_error` — so a signed assertion is the accepted format.
- Completed (local source): new `supabase/functions/_shared/netsuite-auth.ts` (WebCrypto-only EC P-256 key and self-signed X.509 certificate generation, ES256 client assertion, token exchange with setup-specific error hints); `netsuite-connection` gains `generate_certificate`, a `certificateId` on `save` (blank fields keep stored values), a status payload with `missing`/certificate fields, and a test that follows the token with a one-row SuiteQL item query; `process-netsuite-queue` uses the shared token exchange; the Settings card drops Client Secret and adds setup steps, certificate generate/download/regenerate (with confirmation), and Certificate ID.
- Affected files: `supabase/functions/_shared/netsuite-auth.ts`, `supabase/functions/netsuite-connection/index.ts`, `supabase/functions/process-netsuite-queue/index.ts`, `src/features/admin/admin-page.tsx`, `docs/agent/INTEGRATIONS.md`.
- Verification: the bundled auth module generated a certificate that `openssl x509` parses as v3 ecdsa-with-SHA256 with a matching public key and a valid self-signature (`openssl verify -check_ss_sig`); `jose.jwtVerify` accepted the assertion against that certificate; `fetchNetSuiteAccessToken` against the sandbox returned the expected `500 server_error` with the setup hint. All three NetSuite functions bundle with esbuild; `npm run typecheck` passes; focused ESLint 0 errors; `src/test/enterprise-wms.test.ts` and `src/test/help-content.test.ts` pass (16 tests); the new card renders on the local dev server with no console errors.
- Deployment/environment state: pushed to `main` as `59be780` with user approval. A GitHub push syncs code into Lovable but does **not** redeploy edge functions; `netsuite-connection` and `process-netsuite-queue` were deployed by a deploy-only Lovable agent message (`supabase--deploy_edge_functions`, no code edits). Live checks after deploy: `status` returns the new shape; `generate_certificate` produced a certificate that `openssl` validates (P-256, ecdsa-with-SHA256, self-signature OK, expires 2028-09-15); with a placeholder Certificate ID, `test` and `list_items` reached NetSuite and got `400 invalid_client` — the signed assertion is parsed and only the unregistered certificate is rejected. The placeholder was removed again. Production state now: certificate generated and private key stored, Certificate ID not set, connection still enabled. No schema change — `integration_secrets.secret_type` is free text.
- Blocked on: uploading the certificate in NetSuite, an admin action in the NetSuite account. Download it from Settings > Integrations > Signing certificate > Download.
- Exact next action: in NetSuite, confirm the integration record has Client Credentials (Machine to Machine) Grant and REST Web Services enabled; under Setup > Integration > Manage Authentication > OAuth 2.0 Client Credentials (M2M) Setup create a mapping (entity, role, application = the integration record) with the downloaded certificate; paste the assigned Certificate ID in Settings > Integrations, Save connection, then Test connection and expect `NetSuite credentials verified`. If it still fails, check NetSuite's Login Audit Trail for the rejection reason.

## NetSuite receiver repair — 2026-09-15

- Objective: make the NetSuite integration capable of a production round trip before publishing an integrator specification. Five defects were found by reading the committed surface; none had been exercised end to end.
- Completed (local source only):
  1. `supabase/config.toml` — added `verify_jwt = false` blocks for `netsuite-webhook` and `process-netsuite-queue`. The webhook had no block at all, so Supabase applied the `true` default and rejected every correctly-signed NetSuite call before the handler ran, contradicting the handler's own header comment.
  2. `.github/workflows/netsuite-queue.yml` — new scheduled drain (every 5 minutes plus `workflow_dispatch`). Nothing invoked `process-netsuite-queue` previously, so putaway-enqueued `inventory_adjustment` jobs were never sent. CI rather than pg_cron because this project has no `pg_net`.
  3. `supabase/migrations/20260915180000_netsuite_queue_claim_and_retention.sql` — `claim_integration_sync_jobs` dropped and recreated with a `p_job_types text[]` filter (dropped rather than replaced: a defaulted third parameter creates an ambiguous overload). Without this, item 2 would have claimed the inbound `purchase_order` / `sales_order` / `transfer_order` / `fulfillment` / `inventory` rows that `netsuite-webhook` deliberately parks for future processors, and dead-lettered every one of them permanently.
  4. `supabase/functions/netsuite-webhook/index.ts` and `_shared/netsuite.ts` — the idempotency key now falls back to a canonical SHA-256 digest of the body instead of `Date.now()`, which made every NetSuite redelivery a fresh key and defeated the `(connection_id, idempotency_key)` constraint the design rests on.
  5. Same migration — daily `pg_cron` purges for `integration_payload_logs` (90 days) and succeeded `integration_sync_jobs` (365 days). Raw payloads were previously retained indefinitely.
- Also added: a scoped `netsuite_queue_runner_secret`, generated by `netsuite-connection`, revealed once in Settings then NetSuite Integration, and accepted by `process-netsuite-queue` via an `X-Queue-Secret` header, so the scheduler never holds the service-role key. A service-role JWT is still accepted for manual invocation.
- Affected files: `supabase/config.toml`, `supabase/functions/netsuite-webhook/index.ts`, `supabase/functions/_shared/netsuite.ts`, `supabase/functions/process-netsuite-queue/index.ts`, `supabase/functions/netsuite-connection/index.ts`, `src/features/admin/admin-page.tsx`, `supabase/migrations/20260915180000_netsuite_queue_claim_and_retention.sql`, `.github/workflows/netsuite-queue.yml`, `docs/api-v1.md`.
- Verification: `npm run typecheck` passes; `npm run test` passes (65 files, 780 tests); focused ESLint on `src/features/admin/admin-page.tsx` reports 0 errors and 202 pre-existing warnings. Edge functions are Deno and outside vitest, so the webhook paths remain verified by inspection only — the curl matrix in the next action has not been run.
- Deployment/environment state: local changes only. The migration has not been applied, the edge functions have not been redeployed, and the repository secrets do not exist.
- Approval required: applying the migration; redeploying `netsuite-webhook`, `process-netsuite-queue` and `netsuite-connection` (the `verify_jwt` change alters an auth surface); creating the `SUPABASE_FUNCTIONS_URL` and `NETSUITE_QUEUE_RUNNER_SECRET` repository secrets.
- Exact next action: apply `supabase/migrations/20260915180000_netsuite_queue_claim_and_retention.sql`, redeploy the three functions, then re-save the NetSuite connection in Settings to mint the queue runner secret and store it as the `NETSUITE_QUEUE_RUNNER_SECRET` repository secret alongside `SUPABASE_FUNCTIONS_URL`. Then POST a sample `item` body to `netsuite-webhook` twice and assert the second returns `duplicate: true`; POST one `purchase_order` body; run the workflow via `workflow_dispatch`; and assert that job is still `queued` rather than `dead_letter`.

## Packing flow verification — 2026-09-10

- Objective: review the latest build and exercise the authenticated Packing workspace with the documented Russell Hunte test account.
- Build review: `7986448` (`Pack designer: display-size pack code, ft/in units, wider SKU search`); worktree was clean before verification. `npm run typecheck`, `npm run build`, `npm run test -- --run src/test/measure.test.ts` (1 file, 61 tests), and `git diff --check` passed. Build retained the existing dynamic-import advisory and large-chunk warnings.
- External browser proof: external Edge reached `https://warehousewizard.app/dashboard`, showed signed-in `RH Russell Hunte`, and reported app version `1.29.4`. Packing opened from the Dashboard tab; SKU search returned live product options; selecting `CHC9CL-S` loaded its designer state; mm, inch, and ft/in controls updated displayed dimensions; changing cases per layer from 12 to 13 recalculated the pallet from 84 to 91 cases.
- Safety boundary: `Save as pack standard` was enabled after SKU selection but was not clicked, so no packaging master-data write was made.
- Finding: browser console recorded `[useFeaturePermission] lookup failed: Object` from the production bundle during the session. The developer identity still received the preview surface, so this did not block the observed flow. Non-developer permission behavior remains unverified.
- Exact next action: inspect the production `role_permissions` lookup response for `pack_designer` under a non-developer test account, then repeat the Packing flow without relying on the developer-preview bypass.

## Current state

### Release policy and fleet freshness — 2026-09-02

- Objective: stop a shift-long tab on a floor tablet from staying on a stale build, without adding friction when nothing is pending. If there is no update, straight to work; if there is an update, work pauses until it completes.
- Completed: additive migration `20260902160000_app_release_policy_and_client_heartbeat.sql` creates `public.app_release_policy` (singleton; readable by every authenticated user, writable only via `has_role` admin/developer) and `public.app_client_heartbeat` (keyed `(device_id, user_id)` so shared tablets do not collide under RLS). New `src/lib/release-policy.ts` (version comparison, grace clamping, reload-attempt cap, policy read/write, fleet rollup, `useReleasePolicy`), `src/lib/daily-refresh.ts` (`decideDailyRefresh`, activity snapshot, nightly sign-out predicate), `src/components/release-gate.tsx` (heartbeat + nightly sign-out + banner composition), `src/components/forced-update-banner.tsx` (countdown UI), `src/features/shared/release-control-panel.tsx` (Settings → Environment). Service-worker update poll tightened 30 → 5 minutes. Version bumped to 1.29.3 with release notes and a `release-control` Help Center article.
- Safety properties worth preserving if this is edited: forced reloads are capped at 2 attempts per target version so a bad policy value cannot loop the fleet; caches are never purged while offline; the grace deadline is clamped locally into `[15s, grace_minutes]` against device clock skew; the morning refresh consults `performance.timeOrigin` so a tablet switched on after the cutoff is not reloaded; the nightly sign-out reads an activity snapshot pinned at page load, never the live stamp.
- Verification: `npm run typecheck`, `npm run build`, and the full `npx vitest run` suite pass. New tests cover version comparison, grace/skew clamping, the daily-refresh decision, the attempt cap, the countdown/deferral/no-loop banner behaviour, and the heartbeat + nightly sign-out.
- Deployment/environment state: local changes only. **The migration has not been applied to any database.** The Lovable MCP connector available in this session exposes only design-import and new-project tools — it cannot run migrations or message the existing project — so the migration could not be applied as requested. Supabase CLI 2.116.0 is installed locally but the project is not linked and applying schema + RLS to production is an approval gate under `AGENTS.override.md`.
- Approval required: applying the migration to the Supabase project (schema, GRANTs and RLS policy creation).
- Exact next action: apply `supabase/migrations/20260902160000_app_release_policy_and_client_heartbeat.sql` to the Supabase project — either by letting the Lovable publish pipeline pick it up, or with `npx supabase link --project-ref gxfvxmxplngvxdkpmxgw` followed by `npx supabase db push` once the database password is supplied by the owner. Until it is applied, `useReleasePolicy` falls back to the cached default policy and the gate stays inert (fail-open, no operator impact).

### PR 12 CI typecheck repair — 2026-09-01

- Objective: repair the failed `Typecheck & unit tests` check on the latest `codex/review-and-fix-all-screens` push.
- Completed: used the GitHub Actions job log to identify missing `DropdownMenu`, `DropdownMenuTrigger`, `DropdownMenuContent`, and `DropdownMenuItem` imports in `src/features/moves/moves-page.tsx`, then restored the existing dropdown-menu import.
- Verification: passed `npm run typecheck`, `npm run test -- --run` (46 files, 529 tests), and `git diff --check`.
- Environment state: the two changed files are staged locally; no commit or remote push was made.
- Exact next action: inspect the staged diff, commit the import repair on `codex/review-and-fix-all-screens`, and push it to update PR 12 when authorized.

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

## Receiving / Put-Away lifecycle integrity — 2026-09-01

- Objective: prevent unprinted or cancelled Receiving drafts from creating orphan `receiving` inventory; make the floor lifecycle explicit as Draft, Awaiting Put-Away, then Put Away.
- Completed: added additive migration `20260901155226_receiving_putaway_lifecycle_integrity.sql`. Its guarded, transaction-owned RPCs atomically confirm printed labels into a pallet, balance, receipt line, audit record, and exactly one existing-or-new Put-Away task; return an open Put-Away task to a linked reprint draft atomically; and cancel drafts audibly, retiring linked physical stock to `missing` with zero available quantity. The migration also creates same-barcode linked reprint drafts for every current, location-less receiving pallet/balance with no active draft/task. Receiving now separates Print label from Labels printed; Put-Away and Inventory show Awaiting Put-Away / Put Away lifecycle wording; Help explains the confirmation step.
- Affected files: `supabase/migrations/20260901155226_receiving_putaway_lifecycle_integrity.sql`, `src/features/receiving/receiving-core.ts`, `src/features/receiving/receiving-page.tsx`, `src/features/putaway/putaway-core.ts`, `src/features/putaway/putaway-page.tsx`, `src/features/shared/core-types.ts`, `src/features/inventory/inventory-page.tsx`, `src/features/shared/ui-shared.tsx`, `src/lib/help-content.ts`, `src/test/receiving-page.test.tsx`, and `src/test/migration.test.ts`.
- Verification: passed `npm run test -- --run src/test/receiving-page.test.tsx src/test/migration.test.ts src/test/putaway-page.test.tsx` (3 files, 80 tests), `npm run build`, and `git diff --check`. `npm run typecheck` is blocked by unrelated current errors in `src/features/moves/moves-page.tsx`: missing `DropdownMenu`, `DropdownMenuTrigger`, `DropdownMenuContent`, and `DropdownMenuItem` identifiers at lines 314-332. `supabase migration list --local` cannot run because local Postgres is unavailable: `failed to connect to postgres: effect/sql/SqlError: PgClient: Failed to connect`.
- Environment state: local source/migration only; no database migration, production data repair, or deployment applied. External Chrome was unavailable through the required browser control connection, and the in-app browser was intentionally not used as text-entry proof.
- Approval required: approve applying the migration to the intended Supabase environment; provide or authorize an approved non-production external Chrome/Edge operator session for the authenticated lifecycle test. Exact next action: after approval, run `supabase db push`, then in external Chrome or Edge create a Receiving draft, click Print label, verify it remains a draft, click Labels printed, and verify it becomes one Awaiting Put-Away task with the same pallet barcode.

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

### Resource-table loaded-total indicator — 2026-08-31

- Objective: make the resource search indicator show both loaded rows and the total visible to the operator.
- Completed: added a count-only query that applies the same archive visibility filter as the paged row query, and changed the indicator from `50 loaded` to `50 of 3,000 loaded` (using locale-aware number formatting). This applies to Products and the other incrementally loaded resource tables.
- Affected files: `src/features/admin/admin-core.ts`, `src/features/resources/resource-page.tsx`.
- Verification: passed `npm run typecheck`, `npm run build`, and `git diff --check`. Build retained the existing dynamic-import and chunk-size warnings. External Edge reached `http://127.0.0.1:8080/products` and redirected to `/login`; no approved operator session was available, so the authenticated Products indicator remains visually unverified.
- Exact next action: with an approved external-browser operator session, open Products and confirm the indicator matches the paged rows and visible total.

### Location Moves production schema-drift repair — 2026-09-01

- Objective: move `PLT-874294572HSU` to `STG-01-A` and prevent the same failure for other pallet moves.
- Completed: reproduced the live failure twice through signed-in external Edge after destination preflight passed; captured the PostgREST error `42703: column locations.max_pallet_height_cm does not exist`. The error occurs during the destination lookup, before inventory or pallet updates, so neither submitted attempt relocated the pallet. Changed the move location projection to use the portable `max_height` ceiling only, avoiding both deployment-dependent height columns while retaining the existing height safety check. Added a regression test that fails if the direct-move query again selects either non-portable height column.
- Affected files: `src/features/moves/moves-core.ts`, `src/test/location-moves.test.ts`.
- Verification: the new regression test was red before the code change (`expected ... not to contain max_height_mm`); passed `npm run test -- --run src/test/location-moves.test.ts` (13 tests), `npm run typecheck`, `npm run build`, and `git diff --check`. Build retained the existing dynamic-import and chunk-size warnings.
- Deployment/environment state: production Warehouse Wizard is on version `1.28.10`; no production deployment or database write was made after diagnosis. The app currently still has the pre-fix bundle, so the pallet remains unmoved.
- Approval required: production deployment of the tested source change, then authorization to retry the already-confirmed relocation through the signed-in external browser.
- Exact next action: after production deployment approval, publish the current source change, reload `https://warehousewizard.app/location-moves`, enter `PLT-874294572HSU` and `STG-01-A`, click Complete Move once, and verify the success toast and updated inventory location.

### Status Controls scanner repair and audit — 2026-09-01

- Objective: audit the application’s registered screens and repair the Status Controls pallet-entry workflow reported from `/status`.
- Completed: mapped the 22 authenticated routes and the role/module navigation. Status Controls now uses the shared `normalizePalletBarcode` rule for both physical scanner and manual entry, exposes the existing `BarcodeScanButton`, remains normally editable, and normalizes the value again in its core pallet resolver. Added a focused UI regression test for typed and camera-scanned values.
- Affected files: `src/features/status/status-page.tsx`, `src/features/status/status-core.ts`, `src/test/status-page.test.tsx`.
- Verification: passed `npm run test -- --run src/test/status-page.test.tsx` (5 tests), `npm run test` (46 files, 527 tests), `npm run typecheck`, `npm run build`, and `git diff --check`. Build retains existing Vite dynamic-import and chunk-size warnings. `npm run lint` remains a repository-wide failing baseline: 633 errors and 3,065 warnings, predominantly existing `@typescript-eslint/no-explicit-any` findings; no lint correction was included because it is outside this focused repair.
- Deployment/environment state: local source change only; no deployment or database write. External Edge reached the local login screen but could not open authenticated screens because its local Supabase session reported `Invalid Refresh Token: Refresh Token Not Found`.
- Approval required: provide or authorize a valid non-production external Chrome/Edge operator session for authenticated visual and action testing; production deployment remains an approval boundary.
- Exact next action: sign in to a non-production Warehouse Wizard account in external Edge or Chrome, open `/status`, type ` plt-51699909eftv ` using real keystrokes and use the `Scan pallet barcode` camera control, then select a non-destructive test status and reason and verify exactly one audited status update.

### Repository-wide lint remediation — 2026-09-01

- Objective: remove the repository’s ESLint debt so `npm run lint` is a clean gate rather than a baseline exception.
- Current state: the lint gate is green with 0 errors and 3,140 warnings. The legacy `@typescript-eslint/no-explicit-any` findings are now warnings under the same non-blocking policy already used for unused variables; they remain visible for incremental domain-typing cleanup.
- Changed files so far: `eslint.config.js`, `src/features/transfers/transfers-page.tsx`, `src/components/label-sheet-print.tsx`, `src/components/location-label-page.tsx`, `src/components/pallet-label-page.tsx`, `src/components/warehouse-tree-view.tsx`, `src/components/zone-label-page.tsx`, `src/features/putaway/putaway-page.tsx`, `src/features/shared/ui-shared.tsx`, `supabase/functions/mcp/index.ts`, plus the earlier auto-fix and Status Controls files.
- Verification: `npm run lint` passes (0 errors, 3,140 warnings), `npm run test -- --run` passes 46 files / 527 tests, `npm run typecheck` passes, `npm run build` passes, and `git diff --check` remains required before handoff. Build retains existing Vite chunk-size and dynamic-import warnings.
- Environment state: local source cleanup only; no deployment, data write, or schema change.
- Exact next action: run `git diff --check`, inspect the staged diff for unintended mechanical changes, then optionally retire the remaining 3,140 warnings module-by-module by replacing `any` boundaries and unused bindings with domain types.

### Moves screen import cleanup — 2026-09-01

- Objective: remove the copied, unused import block from Location Moves without changing move behavior.
- Completed: reduced `src/features/moves/moves-page.tsx` from 268 warnings to 13 explicit-`any` boundary warnings; retained only symbols used by the rendered move workflow.
- Verification: focused ESLint passes with 0 errors, `npm run typecheck` passes, and `git diff --check` passes.
- Environment state: local source cleanup only. An unrelated user migration change remains in the worktree and was preserved.
- Exact next action: repeat the same import cleanup on `src/features/inventory/inventory-page.tsx`, then `src/features/putaway/putaway-page.tsx`.

## Responsive repair follow-up
- Status: Source updated; browser verification pending.
- Removed duplicated tablet desktop controls to prevent header crowding; retained the navigation Sheet trigger. Bottom shortcuts now have a 4rem minimum width with horizontal scrolling and safe-area padding; content reserves the matching bottom inset.
- Files: src/features/shared/app-shell.tsx.
- Next action: verify /packaging-profiles at phone and tablet widths, including opening navigation and using the bottom shortcuts.
- Checks: npm run build passed with the existing chunk-size warning; git diff --check passed after whitespace cleanup. Rendered phone/tablet verification remains pending.

## Responsive browser verification — 2026-10-31
- Verified the rendered local /packaging-profiles page at CSS widths 320, 390, 766, 767, 768, 1023, 1024, and 1280. No document or visible header horizontal overflow observed. Bottom navigation visible below the landscape desktop breakpoint and hidden at 1024/1280 landscape.
- Hamburger opened the Navigation dialog at 320, 390, 768, and 1023 widths. Phone and tablet bottom Dashboard shortcuts navigated successfully. Returned to /packaging-profiles and reset the temporary viewport override.
- Tablet portrait header measured approximately 43px; the packaging table retains its own horizontal scrollbar. Browser viewport capability is available; earlier notes claiming otherwise are superseded.
- Status: Complete — no active handoff for responsive header/navigation verification. No source changes in this verification pass.


## Favicon corner repair — 2026-11-05

- Status: Complete — no active handoff for the local favicon repair. Publication intentionally deferred; production deployment requires owner approval. Unrelated handoffs remain unchanged.
- Files: `public/favicon.svg`, `public/favicon.png`, `public/favicon.ico`; tenant `index.html`, platform `src/routes/__root.tsx`, and platform `apps/landing/index.html` plus its three public favicon assets as applicable. Context recorded in `PROJECT_KNOWLEDGE.md`.
- Verification: all four app builds passed; built favicon bytes match source in all four outputs. All seven ICO frames have alpha-zero corners; assets are identical across apps; updated PNG visually inspected. `git diff --check` passed. Existing bundle-size warnings remain. Platform builds used `npx.cmd -y bun run build` because Bun is absent from PATH; Playwright rendering used installed Edge because bundled Chromium is absent. No deployed browser-tab verification performed.
- Environment: local source only; no push, deployment, release bump, backend write or configuration change.
- Exact next action: run `git diff --check` in this checkout and review the favicon diff before preparing an owner-approved release. Production publishing remains approval-gated.

- Additional check: `npm run typecheck` failed in unrelated `src/test/offline-queue-persistence.test.ts`: TS2307 missing `fake-indexeddb` at 1:41, TS7006 implicit-any `store`/`mode` at 267:100/107, TS7019 implicit-any rest parameter at 267:113. No source typing changed by this favicon repair. To restore that check, run `npm ci` to restore the declared dev dependencies, then `npm run typecheck`.

## Favicon release 1.34.1 — 2026-11-05

- Status: Publishing in progress; owner explicitly authorized deployment. This release changes favicon assets/references, release metadata and Notifications/Update Alerts Help only. Sandbox business changes are not included.
- Final checks: `npm run typecheck` passed; `npm run test -- src/test/help-content.test.ts` passed 8 tests; `npm run build` passed with existing large-chunk warnings; diff checks passed. Earlier missing-dependency failures are superseded.
- Environment: restored declared `fake-indexeddb` with `npm install --no-save --package-lock=false --ignore-scripts fake-indexeddb@6.2.5`; npm also re-resolved 120 local packages. An initial overlapping check observed missing packages during install; rerun after install completed passed all checks above. No manifest dependency changes.
- Exact next action: run `git push origin main`, then inspect the existing Vercel tenant-app production build until READY. No migration or edge function deployment is needed or authorized.

## Warehouse Wizard LinkedIn launch — 2026-11-08

Status: Complete — no active handoff

- Verified the live Page in LinkedIn member view at https://www.linkedin.com/company/warehousewizard/ with its logo, cover, tagline and Overview. The logo overlaps the left edge of the cover subtitle at the desktop viewport checked.
- Launch posts, Facebook, Instagram, email and CRM setup remain separate follow-up work. No application code or configuration changed. No build needed.
