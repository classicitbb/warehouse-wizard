# Integrations and Connector Contract

| Service | Purpose | Verification | Write boundary |
|---|---|---|---|
| GitHub | Source control and review | Verified repository access | Feature branches/PRs within task scope |
| Vercel | Hosting | Project `warehouse-wizard` linkage verified | Preview first; production approval boundary |
| Supabase | Database/auth/storage/functions as used by code | Repository configuration detected | Verify project/account before writes |
| Lovable | Project editing/generation workflow | MCP connector reachable 2026-09-02, but exposes only design-import and new-project tools — no migration, project-message, or diff capability in this session | Review generated diffs; verify publish path |
| Supabase CLI | Applying migrations locally | `npx supabase --version` → 2.116.0 on 2026-09-02; project not linked | Linking and `db push` against the production project remain an approval gate |
| NetSuite | ERP master data inbound, inventory adjustments outbound | Not verified — no NetSuite account was reachable in this session; the adapter is verified by code reading only | Inbound `item` upserts `products` + `external_record_links`; outbound posts `inventoryAdjustment` only |
| GitHub Actions | Scheduled drain of the NetSuite outbound queue | Workflow added 2026-09-15; never run, because its repository secrets do not exist yet | Calls `process-netsuite-queue` with a scoped runner secret, not the service-role key |

Add every real external service when verified. Access to one service does not imply access to another.

## Rules

- Prefer installed/authenticated MCP, then approved CLI/SDK, then controlled browser interaction.
- Verify the target project/account with a harmless read before writes.
- Store credential values only in approved secret systems.
- Use least privilege, idempotency, bounded retries, audit context, and reconciliation for automated writes.
- Production deployments/data, auth/security, credentials, billing, external messages, and destructive actions remain approval gates unless explicitly authorized.

## NetSuite adapter

Three edge functions and one trigger, sharing the `integration_*` job spine.

- `netsuite-webhook` — inbound. `verify_jwt = false`; the only credential is the
  `netsuite_webhook_secret` shared secret in an `X-Webhook-Secret` header, compared in
  constant time. Only `recordType: "item"` is processed; the other five accepted record
  types are logged and left `queued` for processors that do not exist yet.
- `process-netsuite-queue` — outbound. `verify_jwt = false`; accepts either a service-role
  JWT or the `netsuite_queue_runner_secret` in an `X-Queue-Secret` header. Claims only
  `inventory_adjustment` jobs, so the parked inbound rows above are never dead-lettered.
- `netsuite-connection` — admin-only configuration, SuiteQL item browser, item import.
  Requires a signed-in `admin` or `developer`.
- `enqueue_netsuite_inventory_sync` — trigger on `inventory_balances`, fires only on the
  `receiving` → `available` transition, and no-ops unless both the product and the
  warehouse have `external_record_links` rows.

Credential and configuration **names** (values live only in Supabase and GitHub secrets):

- `integration_secrets.secret_type`: `netsuite_client_id`, `netsuite_client_secret`,
  `netsuite_webhook_secret`, `netsuite_queue_runner_secret`. Table is service-role only —
  RLS is enabled with no anon/authenticated policies.
- `integration_connections.config`: `account_id`, `last_tested_at`, `last_test_ok`.
- Edge function environment: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`.
- Repository secrets for the scheduled drain: `SUPABASE_FUNCTIONS_URL`,
  `NETSUITE_QUEUE_RUNNER_SECRET`.

Retention: `integration_payload_logs` purges at 90 days and succeeded `integration_sync_jobs`
at 365 days, both by `pg_cron` (see migration `20260915180000`). Dead letters are never aged out.
