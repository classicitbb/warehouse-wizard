# Integrations and Connector Contract

| Service | Purpose | Verification | Write boundary |
|---|---|---|---|
| GitHub | Source control and review | Verified repository access | Feature branches/PRs within task scope |
| Vercel | Hosting | Project `warehouse-wizard` linkage verified | Preview first; production approval boundary |
| Supabase | Database/auth/storage/functions as used by code | Repository configuration detected | Verify project/account before writes |
| Lovable | Project editing/generation workflow | MCP connector reachable 2026-09-02, but exposes only design-import and new-project tools — no migration, project-message, or diff capability in this session | Review generated diffs; verify publish path |
| Supabase CLI | Applying migrations locally | `npx supabase --version` → 2.116.0 on 2026-09-02; project not linked | Linking and `db push` against the production project remain an approval gate |
| NetSuite | ERP master data inbound, inventory adjustments outbound | Sandbox token endpoint reachable 2026-09-16. The deployed `netsuite-connection` signs an assertion NetSuite parses (`400 invalid_client` for an unregistered certificate). A real token has not yet been issued, pending the M2M certificate upload in NetSuite | Inbound `item` upserts `products` + `external_record_links`; outbound posts `inventoryAdjustment` only |
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
- `netsuite-connection` — admin-only configuration, signing-certificate generation, SuiteQL
  item browser, item import. Requires a signed-in `admin` or `developer`.
- `enqueue_netsuite_inventory_sync` — trigger on `inventory_balances`, fires only on the
  `receiving` → `available` transition, and no-ops unless both the product and the
  warehouse have `external_record_links` rows. Since migration `20260916120000` the job
  payload carries those NetSuite internal ids as `netsuiteItemId` and `netsuiteLocationId`.

### Outbound inventory adjustment record

`process-netsuite-queue` POSTs the body from `buildNetSuiteInventoryAdjustment` to
`/services/rest/record/v1/inventoryAdjustment`. The builder lives in `_shared/netsuite.ts` and is
mirrored in `src/lib/enterprise-wms.ts`; `src/test/enterprise-wms.test.ts` fails if the two copies
drift. The shape was checked against Oracle's REST example for the inventory adjustment record on
2026-09-16. No live NetSuite account has accepted it yet, because no access token has been issued.

- The body is the record itself: `externalId`, `account`, optional `subsidiary`, `memo`, and
  `inventory.items[]` with `item`, `location`, `adjustQtyBy`. There are no wrapper keys. The
  earlier builder sent `accountId`, `recordType`, `body`, and `idempotencyKey` as record fields,
  nested `memo`/`subsidiary` under `body`, and had no `account`.
- Every reference is `{ "id": "<internal id>" }`. The item id is the `products`/`item` link in
  `external_record_links` (stored by the import picker and the inbound webhook). The location id
  is the `warehouses`/`location` link from Settings > NetSuite Location Mapping. Jobs queued
  before `20260916120000` hold only `sku` and `locationExternalId`. For those, the worker resolves
  the item id from the SKU and reads `locationExternalId` as the location's internal id.
- `account` is the GL account the adjustment posts to, and the record requires it. Its internal id
  is `integration_connections.config.adjustment_account_id`, set under Settings > Integrations >
  Inventory adjustment posting. Until it is set, the worker returns
  `skipped: adjustment_account_not_configured` without claiming jobs, so nothing dead-letters.
  `adjustment_subsidiary_id` is optional. When blank, `subsidiary` is omitted and NetSuite applies
  its default; the earlier builder hard-coded `1`. In a OneWorld account, set it if the default
  subsidiary does not own the mapped locations.
- Idempotency: NetSuite honours `X-NetSuite-Idempotency-Key` only on asynchronous requests
  (`Prefer: respond-async`) and ignores it on synchronous ones, so the worker does not send it.
  Instead the record's `externalId` is `ww-inventory-adjustment-<job idempotency_key>`. NetSuite
  keeps external IDs unique per record type, so a retry cannot post a second adjustment. When a
  POST fails or times out, the worker looks up `inventoryAdjustment/eid:<externalId>` and marks the
  job succeeded if an earlier attempt already created the record. A create answers `204` with the
  new record's URL in `Location`; the worker stores it and the record id in the job `result`.
- Not handled yet: lot-numbered, serialized, and bin-managed items need an `inventoryDetail`
  subrecord on the line, which is not sent. `unitCost` is not sent either, so check the cost
  NetSuite applies to a positive adjustment during the first live post.

Outbound authentication is OAuth 2.0 client credentials (M2M), in
`supabase/functions/_shared/netsuite-auth.ts`. NetSuite rejects a client ID/secret pair for this
grant with `400 invalid_request`. The token request must carry a JWT client assertion signed
with a key whose X.509 certificate is uploaded under Setup > Integration > Manage Authentication >
OAuth 2.0 Client Credentials (M2M) Setup. `netsuite-connection` generates an EC P-256 key and
self-signed certificate (ES256, 729-day validity); the admin downloads the certificate, uploads
it, and saves the Certificate ID NetSuite assigns (the JWT `kid`). The integration record needs
the Client Credentials grant and the REST Web Services scope. An unregistered certificate comes
back as a bare `400 invalid_client` (or `500 server_error` for an unknown client ID); NetSuite's
Login Audit Trail has the real reason.

Deploying: a push to `main` syncs code into Lovable but does not redeploy edge functions. Deploy
changed functions with a deploy-only Lovable agent message (it runs
`supabase--deploy_edge_functions`), then confirm no code edits came back with `git fetch`. Keep the
message to the deploy: if the agent finds its preview build-errors log, it may keep investigating
(2.3 credits on 2026-09-16).

Migrations can be applied by running the file's SQL through the Lovable MCP `query_database`.
`supabase_migrations.schema_migrations` is not a reliable record on this project; it stops at
`20260910131417` although later migrations are live. Check that a migration is applied by
inspecting the objects it changes, for example `pg_get_functiondef`.

Credential and configuration **names** (values live only in Supabase and GitHub secrets):

- `integration_secrets.secret_type`: `netsuite_client_id`, `netsuite_private_key` (PKCS#8 PEM),
  `netsuite_webhook_secret`, `netsuite_queue_runner_secret`. A legacy `netsuite_client_secret`
  row may exist; nothing reads it. Table is service-role only — RLS is enabled with no
  anon/authenticated policies.
- `integration_connections.config`: `account_id`, `certificate_id`, `certificate_pem` (public),
  `certificate_expires_at`, `adjustment_account_id`, `adjustment_subsidiary_id`, `last_tested_at`,
  `last_test_ok`.
- Edge function environment: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`.
- Repository secrets for the scheduled drain: `SUPABASE_FUNCTIONS_URL`,
  `NETSUITE_QUEUE_RUNNER_SECRET`.

Retention: `integration_payload_logs` purges at 90 days and succeeded `integration_sync_jobs`
at 365 days, both by `pg_cron` (see migration `20260915180000`). Dead letters are never aged out.
