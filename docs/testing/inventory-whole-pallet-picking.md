# Inventory Search whole-pallet work

Source implementation: `src/features/inventory/inventory-page.tsx`, its `inventory-pick-dialog.tsx` / `inventory-result-actions.tsx` components, `inventory-rotation.ts`, `src/features/picking/inventory-pick-core.ts`, and additive migration `20261020133102_inventory_whole_pallet_pick_work.sql`.

## Contract

- Search fetches complete stable pages ordered by balance ID before grouping products and sorting their FIFO receipt / FEFO expiry order. Missing dates sort last; FEFO ties use receipt time, then pallet and balance IDs. Display pagination occurs after rotation. This requires a full in-scope inventory read; the row cache is reused for subsequent display pages.
- Exact pallet and multi-selection retain identities. This product requests exactly one whole eligible pallet, independent of the clicked pallet's quantity. No quantity input or quantity allocator is used.
- Preview/commit share one invoker-rights RPC. Alternatives are top N **per product and owner**, with no duplicated pallet identities. Keep selected, Use recommended and Cancel are explicit choices. Effective expiry is lot expiry, falling back to balance expiry, in both search and candidate review.
- Existing table privileges/RLS and existing approval/warehouse predicates apply. No policies, grants, generated client/types, credentials or environment files are changed.
- Eligibility requires matching balance/pallet product, owner, warehouse, location and full quantity; active visible product, matching product owner if set, active location, zero reserved/held/damaged amounts, no correction, no active location/pallet/warehouse freeze, and no open pick task (including exception work).
- Commit locks the shared task/freezes tables and warehouse balance/pallet/location rows, rebuilds the preview, and checks its token before any insert. A change requires a fresh operator review. A shared invoker trigger also rejects subsequent legacy inserts that would duplicate open work. Task/freezes table locks are deliberately conservative; validate contention with the real non-production workload before promotion.
- Queued, order-backed, non-transfer lists must match the warehouse/owner and an open draft/queued order. New lists require an order number (at least two characters), create the existing order/lines/list/tasks/label records, and split by owner if necessary. All inserts roll back together. Stock and physical confirmation are unchanged.
- Work is never stored for offline replay. Reconnect, refresh and review after an availability error. An RPC timeout can have an uncertain outcome: inspect existing lists before retrying; the open-task guard prevents a second active task for the same pallet.

## Local checks

```powershell
npm ci --ignore-scripts
npm run test -- --run src/test/inventory-pick-sql.test.ts src/test/inventory-pick-api.test.ts src/test/inventory-rotation.test.ts src/test/inventory-pick-dialog.test.tsx src/test/inventory-selection.test.tsx src/test/inventory-search-history.test.ts src/test/inventory-count.test.ts src/test/inventory-search-terms.test.ts src/test/pick-allocation.test.ts
npm run typecheck
npm run build
git diff --check
```

`@electric-sql/pglite` is a pinned development dependency. SQL tests execute the actual new migration in an isolated Postgres WASM runtime, against source-derived baseline columns/enums plus required later columns. Fixtures stub identity/warehouse predicates and exercise invoker table permissions and one warehouse RLS policy. This proves SQL behavior, not compatibility with every deployed migration/trigger/policy or real concurrent sessions.

## Rendered fixture

```powershell
npx.cmd vite --config src/test/fixtures/inventory-browser/vite.config.ts
```

Open `http://127.0.0.1:8089/`. This separate Vite entry mocks the backend and operator context; it has no credentials or real work submission. Every unexpected backend read/RPC throws. It is not an authenticated application session. Stop it with Ctrl+C after inspection.

Inspect right-click/Actions menus; keyboard Enter/Escape; multi-selection toggle/count; This pallet vs This product; chosen/recommended receipt/expiry/quantity evidence; sticky review buttons; list selection; Cancel; and mock success. Automated component tests exercise touch long-press and stale-review errors. Actual handheld touch, authenticated non-production RLS, deployed schema, multi-session concurrency and real list/execution/label integration still require an approved non-production environment and migration application. Do not perform a physical pick merely to test list creation.

## Promotion boundary

Migration authored with `npx.cmd supabase migration new inventory_whole_pallet_pick_work`. It has **not** been applied. Obtain target-specific migration/deployment approval before applying it, and use an authorized non-production operator session for the full backend workflow. A version/Release Notes bump belongs with the approved publication, not this unshipped branch. No new environment-variable names are introduced.
