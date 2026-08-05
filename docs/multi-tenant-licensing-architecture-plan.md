# Multi-Tenant Routing, Licensing & Admin Portal — Brief & Implementation Plan

Status: Draft for review
Owner: Russell Hunte
Date: 2026-07-17

## 1. Goal

Today `warehousewizard.app` serves one client from one Vite/React SPA talking to one Supabase project. To sell perpetual licenses and support multiple companies from a single domain, the app needs to become a light **fleet shell**:

- `/` — public home page + single login
- `/{company-slug}/*` — the existing app, unchanged, scoped to that company
- `/admin` — Russell-only portal to manage companies and licenses, and trigger new deployments

Constraint from the client conversation: existing users (browser or the installed Android app) must **not** feel a workflow change. They open the app, it resolves who they are, and they land exactly where they do today. The only new step is a one-time login prompt at the root domain before the app knows which company they belong to.

## 2. Current State (confirmed from the codebase)

- **Stack**: Vite + React 18 + TypeScript, React Router v6, TanStack Query, Supabase (Auth + Postgres + Storage), deployed to Vercel with an SPA rewrite (`vercel.json`: everything not under `/assets/` resolves to `/index.html`).
- **Tenancy**: none. Every table keys off `warehouse_id` (89 references in the core schema). There is no `company_id`/`tenant_id` anywhere, and RLS policies are written assuming a single Supabase project = single company.
- **Routing**: flat, e.g. `/login`, `/dashboard`, `/inventory-search`, `/users`, `/settings`, etc. (`src/App.tsx`, `RequireAuth`, `LoginPage`). Login already supports a `?next=` redirect param that only accepts internal paths.
- **Auth**: Supabase Auth against a single project. Session persistence is Supabase's default (localStorage under the app's origin).
- **Android app**: not a separate native codebase — it's a Bubblewrap-generated Trusted Web Activity (TWA) wrapper (`android-twa/twa-manifest.json`). Key facts:
  - `host`: `warehousewizard.app`, `fullScopeUrl`: `https://warehousewizard.app/` — the TWA trusts the *whole origin*, so any path under the domain (including `/{company-slug}/...`) opens inside the app with no APK change.
  - `startUrl`: `/?source=twa` — **baked into already-installed APKs**. Existing installs always launch at `/`. This cannot be changed retroactively; the new root page must handle this launch path gracefully (see §5.5).

**Implication**: this is not a "add company_id and retrofit RLS" job — that would touch a large, live, production schema and its policies for no real benefit. The lower-risk path is **one isolated Supabase project (or database) per company**, exactly like today, with a thin routing/identity layer in front that decides which project a given request or login belongs to. The existing app, its RLS, and its 80+ migrations are untouched per company.

## 3. Target Architecture

```
warehousewizard.app/
├── /                     → Home + universal login (new, small, static-ish page)
├── /admin                → Russell-only control plane (new)
└── /{company-slug}/*     → Existing SPA, mounted with that company's Supabase config
    e.g. /simplex-trading/dashboard, /simplex-trading/receiving, ...
```

One Vite build, one Vercel deployment, one codebase. The company workspace is the *same* React app that exists today — it just becomes a mounted sub-app rather than the whole site, and it resolves its Supabase URL/anon key at runtime from the slug instead of from a build-time `.env`.

### 3.1 Control plane (new, small)

A lightweight registry — a **separate, small Supabase project** (or a couple of tables in a project Russell owns, not any client's) holding:

```
companies
  id, slug (unique, e.g. "simplex-trading"), display_name,
  supabase_url, supabase_anon_key,          -- that company's isolated backend
  license_type   ('subscription' | 'license_hosted' | 'license_self_hosted'),
  license_status ('active' | 'past_due' | 'suspended' | 'cancelled'),
  created_at, notes

user_directory
  email (unique), company_slug, created_at
```

`user_directory` is what makes root-level login possible without merging auth systems: it is a *pointer*, not a credential store. It never holds passwords. It's populated whenever a user is created in a company's own Supabase Auth (via a small hook/edge function on each tenant project, or maintained manually by Russell through the admin portal to start).

This keeps every company's real data and auth fully isolated — identical security posture to today, just with a directory in front.

### 3.2 Root page (`/`)

1. Static-ish marketing/home content (kept intentionally light — this is the page an Android TWA cold-launch hits).
2. A single login form: email + password (or user code/badge, same inputs as today).
3. On submit:
   - Look up `email` in `user_directory` → get `company_slug`.
   - If not found: show "we couldn't find your company" (or, later, fall back to `/admin`-driven company creation for brand-new signups).
   - If found: construct a Supabase client for that company (`supabase_url` + `supabase_anon_key` from the registry) and attempt `signInWithPassword` **from the root page**, so the user only enters credentials once.
   - On success: write a small `localStorage["ww.lastCompany"] = slug` pointer (namespaced, see §5.5) and `navigate(`/${slug}/dashboard`)` (or the original deep link if one was requested).
   - On failure: show the same friendly auth errors the app already has (`friendlyAuthError` in `App.tsx` — reuse it).

This matches exactly what was described: type your login, it finds your company, it logs you in.

### 3.3 Company workspace (`/{slug}/*`)

- React Router gets one new top-level route: `/:companySlug/*`, rendering the existing `App` routes underneath it (existing `RequireAuth`, `LoginPage`, dashboard, etc. — unchanged).
- A `TenantProvider` wraps this subtree: on mount, it reads `companySlug` from the URL params, fetches that company's `supabase_url`/`anon_key`/`license_status` from the control-plane registry (small, cached, edge-function or direct read with a public/limited RLS policy), and constructs the Supabase client the rest of the app already expects at `@/integrations/supabase/client`.
- If `license_status` is `suspended`/`cancelled`, short-circuit to a "your access has been paused, contact support" screen before any tenant data loads — this gives license enforcement for free at the routing layer, without touching per-tenant code.
- Every internal link/redirect the existing app already generates (`/dashboard`, `/login`, etc.) needs to be prefixed with the resolved slug. Practically: keep all existing route definitions relative, and mount the whole `<Routes>` tree under `<Route path="/:companySlug/*">` — React Router's relative linking (`<NavLink to="dashboard">` instead of `to="/dashboard"`) makes this a mechanical, low-risk change rather than a rewrite. Any absolute `to="/..."` or `window.location`/`navigate("/...")` calls need to be swept and made slug-relative (see §6, Phase 1 checklist).

### 3.4 Admin portal (`/admin`)

- Separate auth: Russell signs in against the **control-plane** Supabase project directly (not any tenant's), gated to his account only (mirrors the existing `developer` role pattern already in `RequireAuth`).
- Phase 1 (manual-assisted): CRUD screen over the `companies` table — add a company (slug, display name, paste in the Supabase project URL/anon key once it's manually created), toggle `license_type`/`license_status`, view basic list.
- Phase 2 (automated provisioning): a "Deploy new company" action that calls the Supabase Management API to create a new project, runs the existing migration set (`supabase/migrations/*.sql` in order, already timestamp-ordered) and `seed.sql`, then writes the resulting URL/keys back into the registry automatically. This is the part worth deferring — it's real engineering effort (Management API auth, migration runner, error handling) and isn't needed to close the Matthew Hunte deal.

## 4. Session/storage namespacing (important, easy to miss)

Supabase's JS client stores the session under a fixed localStorage key by default. If two companies' sessions ever coexist under the same browser origin (`warehousewizard.app` — which they will, since it's now one domain for everyone), the second login silently overwrites the first. Every tenant Supabase client must be constructed with a **company-scoped `storageKey`**, e.g. `sb-${slug}-auth-token`, via the `auth.storageKey` option. This is a one-line change per client construction but is the single most important correctness detail in this plan — skipping it causes cross-company session collisions.

## 5. Backward compatibility & zero-perceived-change requirements

1. **Existing bookmarks**: any user with `warehousewizard.app/dashboard` (or `/inventory-search`, etc.) bookmarked today needs it to keep working. Add a redirect shim at the old flat paths: if `/dashboard` (no slug) is hit and a `ww.lastCompany` pointer exists, 302 to `/{lastCompany}/dashboard`; otherwise fall back to `/` (home/login) with the original path preserved as a `?next=` so login lands them in the right place.
2. **Android TWA cold launch**: always hits `/`. With `ww.lastCompany` set and a valid namespaced session already in localStorage, the root page should skip the login form entirely and auto-redirect straight to `/{slug}/dashboard` — same perceived behavior as today (open app → straight to dashboard). Only the *very first* open after this change shows one login screen.
3. **The current production client's data**: whichever Supabase project currently backs `warehousewizard.app` becomes company #1 in the registry (e.g. `simplex-trading`) with zero data migration — same project, same RLS, same everything, just addressed via `/simplex-trading/*` going forward instead of `/`.
4. **No changes required to `android-twa/twa-manifest.json`, the signed APK, or Digital Asset Links** — same-origin scope already covers every `/{slug}/...` path.

## 6. Phased Implementation Plan

**Phase 0 — Groundwork (no user-visible change)**
- Sweep `src/App.tsx` and related files for absolute `to="/..."`/`navigate("/...")` usages; convert to slug-relative where they'll live under `/:companySlug/*`.
- Add `auth.storageKey` namespacing to the Supabase client factory.
- Stand up the control-plane Supabase project with `companies` + `user_directory` tables and minimal RLS (public can check slug-by-email via a restricted RPC; only Russell's admin session can write).

**Phase 1 — Routing cutover**
- Introduce `/:companySlug/*` as the mount point for the existing app tree.
- Build the new root `/` home + universal login page (§3.2).
- Add the legacy-path redirect shim (§5.1) and the `ww.lastCompany` auto-resume logic (§5.2).
- Register the current production tenant as company #1 in the registry.
- Ship and verify: existing users experience one login prompt, then normal operation; the TWA app still opens straight to their dashboard on every subsequent launch.

**Phase 2 — Admin portal (manual-assisted)**
- `/admin` CRUD over `companies` (§3.4, Phase 1 scope).
- License status field wired into the `TenantProvider` gate (§3.3) so suspending a company actually locks it out.

**Phase 3 — Self-hosted license path**
- For the "own it outright, migrate to your infrastructure" option discussed separately, document the export/handoff runbook (schema dump + `supabase/migrations` replay + storage bucket export) — this is operationally different from the hosted-license path above and doesn't touch the multi-tenant router at all, since a self-hosted company simply isn't in the registry.

**Phase 4 — Automated provisioning (optional, later)**
- Supabase Management API integration for one-click new-company deploys from `/admin` (§3.4, Phase 2 scope).

## 7. Open Questions for Russell

- Should `/admin` live on `warehousewizard.app/admin`, or on a separate internal-only subdomain for extra isolation from client traffic? (Recommendation: same domain is fine given it's gated by a completely separate auth project, but a subdomain is a cheap extra layer if preferred.)
- For brand-new signups with no existing company, does the home page need a "request access" path, or is every company still hand-provisioned by Russell for now? (Recommendation: hand-provisioned through Phase 2/3 — matches the current sales-led onboarding model.)
- Confirm the slug for the current production tenant before Phase 1 ships (affects the first redirect mapping).
