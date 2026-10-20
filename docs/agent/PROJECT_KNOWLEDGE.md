# Project Knowledge

- Repository: `classicitbb/warehouse-wizard`
- Default branch: `main`
- Visibility: `public`
- Last verified: 2026-08-24
- Business owner: Russell Hunte
- Existing project instructions: `AGENTS.md`
- Existing status ledger: none detected

## Purpose

Warehouse Wizard is a production-oriented internal WMS app for a 3PL-style warehouse operation. It supports warehouse setup, product master data, receiving, directed putaway, pallet-level inventory search, picking, transfers, cycle counts, 

## Verified stack

- React (^18.3.1)
- Vite (^7.3.1)
- TypeScript (^5.8.3)
- Tailwind CSS (^3.4.17)
- Supabase (^2.106.2)
- TanStack Query (^5.100.14)
- Vitest (^4.1.8)
- Playwright (^1.60.0)
- Lovable-origin or Lovable-managed workflow is referenced by repository evidence.
- Vercel project linkage verified: `warehouse-wizard`.

## Commands

Evidence: `package.json`.

| Script | Agent command | Implementation |
|---|---|---|
| dev | `npm run dev` | `vite` |
| build | `npm run build` | `vite build` |
| build:dev | `npm run build:dev` | `vite build --mode development` |
| lint | `npm run lint` | `eslint .` |
| typecheck | `npm run typecheck` | `tsc -p tsconfig.app.json --noEmit` |
| preview | `npm run preview` | `vite preview` |
| test | `npm run test` | `vitest run` |
| test:watch | `npm run test:watch` | `vitest` |

Use the repository lockfile’s package manager. Commands above are discovered, not necessarily executed during this rollout.

## Environment-variable names

Names are defined in the repository environment example; inspect it only as required and do not duplicate private topology here.

Update this section whenever code introduces, removes, or renames configuration. Record names and purpose only, never values.

## Sources of truth

- Code and behavior: this repository.
- Commands/dependencies: package manifest and lockfile.
- Current work: `docs/agent/HANDOFF.md` until a project-native status file is established.
- Project rules: existing `AGENTS.md`, then the continuity override.
- Hosting: verified Vercel linkage `warehouse-wizard`.
- Database/schema: `supabase/**` where present.

## Durable decisions

- Keep verified project context and resumable handoff state in `docs/agent/`.
- Inventory row actions use a 24px icon-only ghost trigger with an accessible pallet-specific name; its cell has no vertical padding so it cannot enlarge the established text/badge row height, including during selection (2026-10-20 browser annotation follow-up). Existing table tokens/padding elsewhere remain unchanged.
- Inventory Search whole-pallet pick work (2026-10-20, local feature branch): complete stable inventory pages are read before product FIFO/FEFO sorting and display pagination; receipt and pallet/balance IDs break ties, missing dates sort last. Effective expiry is lot expiry with balance expiry fallback. The dedicated invoker RPC `inventory_whole_pallet_pick_work` previews and atomically creates/appends queued work; This product chooses one whole pallet, never quantity allocation. Rotation overrides require explicit review, stale plans fail closed, and owner groups receive separate new lists. The additive migration is authored only, not applied; existing policies/privileges remain authoritative. See `docs/testing/inventory-whole-pallet-picking.md` for eligibility, lock/concurrency constraints, commands and verification boundaries. No environment-variable names changed. `@electric-sql/pglite` is a pinned test-only dependency for executing migration behavior locally; the explicit browser fixture replaces backend/auth context only in its own Vite configuration and makes no real backend calls.
- Update continuity during the same build/change that reveals new facts.
- Do not infer working behavior from UI placeholders or documentation alone.
- Warehouse Copilot requests require a signed-in operator with a verified default warehouse. The Edge Function derives that warehouse server-side and scopes its operational reads to it; the browser never supplies the warehouse scope.
- Copilot response feedback is an idempotent Helpful/Not helpful vote per operator and message. The additive `copilot_message_feedback` migration derives its warehouse context from the signed-in profile and is not an operational authorization channel.
- Fleet build freshness is server-controlled from a singleton `app_release_policy` row: it names the minimum required build, the grace period, an optional operator message, the local morning-refresh hour, and whether nightly sign-out is on. Clients poll it (there is no realtime infrastructure in this app) and fail open — an unreadable policy or an unparseable running version never forces anything. A companion `app_client_heartbeat` row per `(device_id, user_id)` is what makes "did the floor actually take the fix?" answerable.
- The version gate must never be able to loop the fleet: forced reloads are capped per target version, caches are never purged while offline, and the admin control can only require the build the admin is already running.
- Copilot dictation records a maximum one-minute clip in the browser, sends it only to the JWT-protected `copilot-transcribe` Edge Function, and inserts the returned transcript for operator review. The function requires a verified active warehouse, uses `LOVABLE_API_KEY` only server-side, and audits metadata without retaining audio or transcripts.
