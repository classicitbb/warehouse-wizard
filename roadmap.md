# Roadmap

- [x] Block duplicate inbound receiving during drafts and open Put-Away; verify matching, loading, and save preflights (82 tests and authenticated live fixtures).
- [ ] Add database-atomic duplicate protection for simultaneous operators; blocked by pre-existing migration journal conflict on the packaging-profile supervisor policy.

- [x] Add Microsoft sign-in while preserving existing approvals; button visibility and six automated checks passed.
- [ ] Verify a complete Microsoft sign-in in the hosted preview; local testing lacks the hosted OAuth redirect service and a Microsoft account session.

- [x] Standardize close controls and scrollbar tracks across all dialogs; test every known dialog.
- [x] Prevent hidden role assignments from granting elevated access.
- [x] Simplify alternate-pallet confirmation and improve active pick-row readability.
- [x] Refresh Transfers, Status, and Reports for queue-first operations and future NetSuite visibility.
- [x] Remove Dashboard fit-to-screen and publish the verified release.
- [x] Upgrade Warehouse Copilot to rapid, natural, evidence-led conversations with complete history.
- [x] Add broader read-only investigation tools and confirmed developer repair briefs.
- [x] Stream Copilot responses, preserve stop behavior, and verify the end-to-end coworker flow.

## Platform / multi-tenant (see docs/platform-architecture.md)
- [ ] Get Simplex to sign the license (or a written interim agreement) before onboarding a second tenant; file copy in legal/.
- [ ] Audit hard-coded "simplex" references in NetSuite shared code and migrations; move to tenant config.
- [ ] Write ADRs: database-per-tenant; path routing (TWA-safe) with custom-domain add-on.
- [ ] Control-plane Supabase project (tenants, directory, modules, ledger, heartbeats, leads).
- [ ] Mount app under /:companySlug/* using tenantClient.ts and use-tenant-path.ts; legacy-path redirect; TWA auto-resume.
- [ ] Root landing page + universal login + demo-request form.
- [ ] Admin console (admin subdomain, separate project): tenants, modules, license, health.
- [ ] platform-agent edge function in each tenant (signed commands, heartbeat).
- [ ] Release pipeline: migration ledger, ring rollout (sandbox, canary, all), edge-function fan-out via CI.
- [ ] Automated provisioning, Stripe billing, per-tenant branding, custom domains.
- [ ] Create private repo classicitbb/warehousewizard-platform (control plane + admin console + release runner); separate Lovable project and Supabase.
- [ ] Admin GUI v1 (Phase 1a): tenants, variables, secrets (Vault, write-only), notes, documents, audit log.
- [ ] Add deployment_mode (hosted / customer_hosted / source_buyout) to tenants; define pull-based release manifest for customer-hosted installs.

