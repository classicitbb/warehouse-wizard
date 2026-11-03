# Warehouse Wizard as a Platform — System Design

Status: Proposal for Russell's review. Nothing implemented by this document.
Date: 2026-11-02
Builds on: `docs/multi-tenant-licensing-architecture-plan.md` (2026-07-17). That plan's routing,
registry and storage-key decisions still stand. This document adds what it lacked: the commercial
and legal gate, the code/migration fan-out, the admin console's API contract, onboarding, and
the sequencing.

## 0. The decision that comes before the architecture

Simplex has used the app and received features, but has not signed. Until a signed agreement exists,
neither side has clear paper on who owns what, and every new feature widens that gap.

Facts from the repo: `legal/Warehouse_Wizard_Software_License_Agreement.docx` is a perpetual
*license* (not a sale): s2.3 reserves all IP to the Licensor, s3 bars hosting to third parties and
derivative works, s6.1 gives the client its data. It is an unsigned template with blanks.

Recommendation (not legal advice; have a Barbados attorney review):
1. Before any second tenant goes live, get Simplex to sign this license, or at minimum a short
   interim written agreement stating that the Licensor owns the software, Simplex holds a licence,
   and the fee and support terms are as agreed.
2. Decide whether any feature built *for* Simplex is Simplex-specific (their NetSuite mappings) or
   product (everything else). Product features stay Licensor IP; Simplex-specific config lives in
   Simplex's tenant config, not in the shared code.
3. Record the answer in the repo (`legal/`), not just email.

The architecture below makes this cleaner: Simplex becomes tenant #1 with its own database, so the
data boundary in s6.1 is physically true.

## 1. Requirements

Functional
- Public landing page: what it is, modules, pricing/demo request, login.
- One login at the public domain; the user ends up inside their company's system.
- Admin console (Russell only): create/suspend tenants, set modules and license, see health and
  usage, roll out new versions, apply database changes to every tenant.
- Per-client customization without per-client code forks.
- Admin console and tenants talk over defined APIs.

Non-functional
- Tenant data isolation is absolute. One client can never see another's rows, users or secrets.
- One codebase. A fix ships once.
- Installed Android app (TWA) keeps working: its start URL is `/?source=twa`, scope is the whole
  `warehousewizard.app` origin, and it cannot be changed on installed devices.
- Solo operator now; must not need a team to run 10-20 tenants.
- Lovable remains the build surface for the app (it syncs `main`, applies migrations only to its
  own linked project, and does not redeploy edge functions on push).

Constraints: Vite/React SPA on Vercel, Supabase per environment, NetSuite integration per client,
forward-only additive migrations, `docs/REPO_SYNC.md` process.

## 2. Answers to your direct questions

**Public domain, then login into the company system?** Yes. `warehousewizard.app` is the front
door. The login form looks up the email in a directory (a pointer, never a password store), finds
the company, signs the user into that company's backend and sends them to `/{company-slug}/...`.

**Keep the codebase synced?** One repo, one build, many tenants. Clients differ by *configuration*
(modules, variables, branding, NetSuite settings), never by branch. Section 5.

**Keep customer databases separate?** One Supabase project per client. Same schema, separate
data, auth, storage and secrets. This avoids retrofitting a `tenant_id` and new RLS across the 89
`warehouse_id` references and 157 migrations of a live schema.

**Keep domains in order?** Section 4. Short version: path-per-company on one domain now, because
that is the only option the installed Android app can follow. Custom client domains later, as a
paid add-on.

## 3. High-level design

```
                    Internet
                       |
   +-------------------+----------------------+
   |                   |                      |
 warehousewizard.app   admin.warehousewizard.app   (future) wms.client.com
 (Vercel project A)    (Vercel project B)          -> same project A, alias
   |                       |
   |  /            landing + login      Control plane Supabase (yours alone)
   |  /{slug}/*    the WMS app (SPA)      tenants, domains, licenses, modules,
   |                  |                    release_rings, migration_ledger,
   |                  |                    user_directory, heartbeats, audit
   |                  v                          ^            |
   |      Tenant Supabase (one per client)       |            | Management API
   |      auth, Postgres, storage, edge fns      |            v
   |      + platform-agent edge function ----heartbeat----> provisioning
   |                  |                                      + migration runner
   |                  v                                      (GitHub Actions)
   |           NetSuite (per client account)
```

Components
1. **Public site + login** (`/`): lightweight, static-ish. Cold-launch target for the Android app.
2. **Tenant app** (`/{slug}/*`): the existing SPA, mounted under a tenant provider that resolves
   Supabase URL/key, license state and module flags at runtime.
3. **Control plane**: its own Supabase project and its own auth. Holds no client business data.
4. **Admin console** (`admin.warehousewizard.app`): separate Vercel project and separate login,
   so a bug in the client app can never expose it. Reads/writes the control plane only.
5. **platform-agent** (new edge function in every tenant): the only door between control plane and
   tenant. Accepts signed commands (apply flags, suspend, report version), sends heartbeats.
6. **Release pipeline** (GitHub Actions): applies migrations and deploys edge functions to every
   tenant in rings. Needed because Lovable only manages its own linked project.

## 4. Domains

| Layer | Now | Later |
|---|---|---|
| Marketing + login | `warehousewizard.app` | same |
| Client app | `warehousewizard.app/{slug}` | optional `wms.clientname.com` alias for that tenant |
| Admin | `admin.warehousewizard.app` | same |
| Staging | sandbox Vercel/Lovable URL | `sandbox.warehousewizard.app` |

Why path, not `slug.warehousewizard.app`: a subdomain is a different origin from the one the
installed TWA trusts, so users would leave the app shell into a browser bar. Path routing keeps
every installed device working with no APK change.

Custom client domains: add the domain to the Vercel project, point it at the same deployment, and
store it in `tenant_domains`. The app resolves tenant by hostname first, then by path. A client
that wants its own installable Android app needs its own TWA build and asset links; price that.

Rules: slugs are lowercase, unique, immutable once issued, and reserved words (`admin`, `api`,
`login`, `app`, `www`, `support`, `status`, `sandbox`) are blocked.

## 5. Keeping one codebase while clients differ

Customization ladder (use the lowest rung that works):
1. **Module flags** per tenant. Already exists (`use-feature-flags`, STARTER_MODULES). Control plane
   becomes the source of truth and pushes to the tenant.
2. **Client variables / settings** per tenant. Already exists (`client-variables-panel`).
3. **Branding**: name, logo, colors, labels, from a `tenant_branding` row.
4. **Integration config**: NetSuite account and mappings in tenant secrets and settings.
5. **Bespoke feature**: lives in the same repo behind a flag named for the capability, not the
   client (`flag: serial_tracking`, not `flag: acme_stuff`). Any client can buy it later.
6. Never: a branch or fork per client.

Known debt to clear first: "simplex" appears in the NetSuite shared code and several migrations
(`supabase/functions/_shared/netsuite-*.ts`, `push-notify`, `send-notification-email`,
`20260821*`, `20260827*`, `20261016*`, `20261031*`). Audit each: if it is a client name used as
data, make it config; if hard-coded behavior, extract it.

### Release flow

```
feature branch -> sandbox repo main -> sandbox tenant (ring 0, your own test data)
      -> canary tenant (ring 1, Simplex or a friendly client)
      -> everyone else (ring 2)
```
- Frontend: one Vercel deployment serves all tenants, so a frontend release is instant for all.
  Mitigate with feature flags (REPO_SYNC rule 7) and Vercel rolling releases/instant rollback.
- Migrations: forward-only and additive (already your rule). The runner records each tenant's
  applied migrations in `migration_ledger`, runs ring 0, then ring 1, waits for a health check,
  then ring 2. A failed tenant halts the ring and pages you.
- Edge functions: same ring order via Supabase CLI in CI.
- Prod vs sandbox repos: keep `scripts/repo-sync.sh` as is. "Prod" stops being a client and becomes
  the platform release branch; every client, Simplex included, is a tenant of it.
- Compatibility rule: the frontend must tolerate a tenant that is one migration behind during a
  rollout window. Expand-then-contract only.

## 6. Data model (control plane)

```
tenants(id, slug, display_name, status[trial|active|past_due|suspended|cancelled],
        supabase_ref, supabase_url, anon_key, region, ring[0|1|2],
        license_type[subscription|license_hosted|license_self_hosted], license_ends_at,
        contract_signed_at, contract_doc_url, created_at)
tenant_domains(tenant_id, hostname, verified_at, is_primary)
tenant_modules(tenant_id, module_key, enabled, config jsonb)
tenant_branding(tenant_id, logo_url, primary_color, labels jsonb)
user_directory(email_hash, tenant_id)          -- pointer only, no credentials
release_versions(id, git_sha, created_at, notes)
migration_ledger(tenant_id, migration_name, applied_at, status, error)
heartbeats(tenant_id, app_version, schema_version, active_users_7d, last_seen, errors_24h)
leads(id, name, company, email, source, status, notes, created_at)
audit_log(actor, action, tenant_id, detail, at)
```
Service-role keys and per-tenant agent secrets live in the control plane's secrets/vault, never in
the browser, never in the repo.

## 7. API contracts between admin and tenants

Admin -> tenant (signed with a per-tenant secret, short-lived, replay-protected):
- `POST /functions/v1/platform-agent/apply-config` modules, branding, license status
- `POST /functions/v1/platform-agent/suspend` and `/resume`
- `GET  /functions/v1/platform-agent/health`

Tenant -> control plane:
- `POST heartbeat` every few minutes: versions, counts, error rate. No row data.

Browser -> control plane (public, rate-limited, anon):
- `rpc resolve_tenant(email)` returns slug only, with a generic response for unknown emails to
  prevent enumeration.
- `rpc get_tenant_public_config(slug)` returns URL, anon key, status, modules, branding.

The control plane never reads client business tables. Support access, when needed, goes through the
client's own impersonation/support role and is logged (matches license s6.1).

## 8. Provisioning a new client (target: one button)

1. Admin console: "New company" (name, slug, plan, modules, first admin email).
2. Management API creates the Supabase project; wait until healthy.
3. Runner replays `supabase/migrations/*` in order, then a *clean* seed (not Simplex data).
4. Deploy edge functions; set secrets (agent secret, NetSuite later).
5. Insert tenant, modules, branding, directory pointer; send the first admin an invite
   (`invite-user` exists).
6. Send welcome email with `warehousewizard.app` and their slug.
Phase 1 does this by hand with a checklist; automate once you have done it three times.

## 9. Landing page and sales funnel

Landing: hero, the problem, module tour, NetSuite integration, pricing/plans, "Request a demo"
form (writes a `leads` row and emails you), Login. Keep it separate from the app bundle so the
Android cold launch stays fast. Add Stripe later for subscription plans and one-time licenses;
webhook updates `tenants.status` so non-payment suspends access automatically (the license allows
suspension after 30 days' notice, s4.4).

## 10. Risks and trade-offs

| Decision | Gain | Cost |
|---|---|---|
| DB per tenant | Hard isolation, simple RLS, matches contract and self-host option | N projects to patch and pay for; migration fan-out is mandatory tooling |
| Path routing | Android app keeps working | One shared origin: storage keys must be namespaced (already built in `tenantClient.ts`); no per-client cookie isolation |
| One Vercel deployment | One fix ships to all | A bad release hits all; needs flags and rollback discipline |
| Separate admin project | Blast-radius control | Extra project to maintain |
| Control-plane directory | Single login | Directory is a sensitive pointer table; hash emails, rate-limit lookup |

Other risks: Supabase project quotas/cost per tenant (confirm current plan limits); NetSuite
credentials per client; backups are the client's job under s5.4 unless you sell hosting, so decide
whether managed backups is a paid tier; and your own bus-factor, which is why runbooks matter.

Revisit when: tenants exceed ~25 (migration time, cost; consider pooled schema for small clients),
a client demands data residency, or you need per-tenant release pinning.

## 11. Current repo state (verified 2026-11-02)

- Done: `src/integrations/supabase/tenantClient.ts` (storage-key-namespaced client factory) and
  `src/hooks/use-tenant-path.ts` (path seam). Both are **unused**, intentionally.
- Not started: `/:companySlug/*` mount, TenantProvider, root landing/login, directory, admin console,
  platform-agent, migration runner, legacy-path redirect shim.
- Existing assets to reuse: module flags, client variables, license-agreement screen, invite-user,
  `scripts/repo-sync.sh`, `docs/REPO_SYNC.md`.

## 12. Phased plan

| Phase | Deliverable | Gate |
|---|---|---|
| 0 | Signed Simplex agreement; Simplex-name audit; ADRs for DB-per-tenant and path routing | Paper signed |
| 1a | New platform repo; control plane project; admin GUI v1 (tenants, variables, secrets, notes, documents, audit); Simplex registered as tenant #1 | Can create/edit a tenant and see its variables, notes and docs without touching the database |
| 1b | `/:companySlug` mount; directory + root login; legacy redirect; TWA auto-resume | Existing Simplex users notice one extra login, nothing else |
| 2 | Landing page + demo-request leads | Public marketing live |
| 3 | Admin console v2: heartbeats, module push, license suspend/resume via platform-agent | Can suspend/resume a tenant |
| 4 | Release pipeline: migration ledger, ring rollout, edge deploy fan-out | Second tenant onboarded by checklist |
| 5 | One-click provisioning, Stripe, custom domains, per-tenant branding | Self-serve-ish onboarding |

## 13. Added 2026-11-02: deployment modes, admin GUI scope, repo layout

### 13.1 Can a client run on its own account, repo and hardware?
Yes. Model it as `tenants.deployment_mode`:

| Mode | Where it runs | Who updates it | Contract |
|---|---|---|---|
| `hosted` (default) | Your Vercel + a Supabase project you own | You, via the release rings | License + support |
| `customer_hosted` | Client's own Vercel/hosting and Supabase (their account) | You ship signed releases; their platform-agent pulls and applies them | License s5.4 already puts hosting and backups on the client |
| `source_buyout` | Client's own repo, account and hardware | Nobody automatically; maintenance is a paid contract | Separate agreement: it ends the single-codebase benefit for that client |

Rules that keep this maintainable:
- Your platform repo stays the source of truth. A customer-hosted install is a downstream release
  copy that is never edited locally; their differences live in config and variables.
- Customer-hosted tenants use a **pull** model: the agent fetches the signed release manifest and
  applies migrations itself. You never hold their database credentials or service-role key.
- On-premise hardware means self-hosting Supabase, which is real operational work. Price it as a
  separate tier. See `Warehouse_Wizard_Cloud_vs_On_Premise_Assessment.docx` in the repo root.
- The current license s3 forbids derivative works and source access. A source buyout needs a new
  contract, priced as such. Do not hand out source under the standard license.

### 13.2 Admin GUI v1 (Phase 1a) scope
Screens: Tenants list and detail; Variables; Secrets; Notes; Documents; Audit log.

```
tenant_variables(tenant_id, key, value, type, scope[app|integration|branding], description,
                 updated_by, updated_at, version)        -- versioned, diffable
tenant_secrets(tenant_id, key, vault_ref, last4, rotated_at, rotated_by, expires_at)
                                                         -- value lives in Supabase Vault, never in this table
tenant_notes(tenant_id, body_md, pinned, author, created_at)
tenant_documents(tenant_id, kind[contract|runbook|onboarding|invoice|other], title,
                 storage_path, version, uploaded_by, uploaded_at)
```
Secret handling: write-only by default (shows `****last4`, rotated date); reveal needs fresh
re-authentication and writes an audit row; secrets reach a tenant only through platform-agent,
never read back out of a tenant; no secret ever appears in the browser bundle, logs or notes.
Every change to variables, secrets and documents is audited with who, when and the old value hash.
Tenant detail shows: status, deployment_mode, ring, app/schema version, contract signed date and
document, modules, domains, open notes.

### 13.3 Repos
- **New private repo `classicitbb/warehousewizard-platform`** (control plane + admin console +
  provisioning and release runner in GitHub Actions + control-plane migrations). Not synced to the
  sandbox or prod Lovable projects. Reasons: it holds service-role access and every tenant's
  secrets, so it must never ship in the client bundle; it releases on a different cadence; a
  mistake in it should not be able to touch the client app.
- **App repos stay as they are** (sandbox/prod): tenant app, public landing page, root login, and
  the `platform-agent` function (it versions with the schema and deploys into each tenant).
- A published contract (OpenAPI or typed JSON schema) for platform-agent lives in the platform
  repo and is copied into the app repo's `docs/`.
- Build the admin GUI as its own Lovable project on its own Supabase (control plane). The same
  AI-assisted workflow, a separate blast radius.

