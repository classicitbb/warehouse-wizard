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

- 2026-10-20 deployment diagnosis: Vercel connector harmless `get_deployment` and `list_deployment_events` reads verified the Warehouse Wizard branch preview failed in PostCSS after `npm ci` succeeded. GitHub CLI `gh pr list --head codex/inventory-whole-pallet-picking --json number,title,url,headRefOid,statusCheckRollup` and `gh run view 39452610629 --log-failed` verified PR #31 and its independent lint failure. No deployment, data, auth, credential or connector settings were changed.
- 2026-10-20 harmless Supabase connector `list_projects` read succeeded, but returned no active Warehouse Wizard data project. No target/schema/data query or write was made. Inventory Search pick work therefore uses isolated PGlite SQL tests and a separate local browser fixture for this branch; authenticated non-production and migration-application proof remain pending. No connector configuration or credentials changed.

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
- When it fires: the adjustment is queued when an `inventory_balances` row first becomes
  `available`, which is putaway confirmed. Label print (`confirm_receiving_draft_labels_printed`)
  completes the receipt and creates the pallet and its balance, but in `receiving` with nothing
  available, so it posts nothing.
- Receipt-sourced pallets (`20261021200000`): once receipts post to NetSuite as item receipts
  (whitepaper W3), set `receipts_post_to_netsuite = true` in the NetSuite connection's `config`
  in the same step. The trigger then skips the putaway adjustment for any pallet whose receipt was
  loaded from a NetSuite purchase order, transfer order or inbound shipment
  (`netsuite_receipt_sourced_pallet()`: the receipt's draft notes carry a `netsuite` line ref),
  because the item receipt already added that stock. Manual and other receipts keep the
  adjustment. Unset (today, everywhere) means no change.
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
`supabase--deploy_edge_functions`), then confirm no code edits came back with `git fetch`.

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

## NetSuite sync job monitor (Settings > Integrations)

Admins and developers can inspect `integration_sync_jobs` from the "NetSuite sync jobs" card
(`src/features/admin/netsuite-sync-jobs.tsx`). It calls the `netsuite-sync-admin` edge function
(`list`, `detail`, `summarize`), which verifies the caller's role and reads with the service role.
Attempt history is the job's `integration_payload_logs` rows (purged after 90 days); the adjustment
ID is `result.netsuiteId`. "Summarize with AI" sends capped, secret-redacted jobs and logs to the
Lovable AI Gateway (`LOVABLE_API_KEY`); the prompt treats record text as data. Prompt and redaction
logic lives in `supabase/functions/_shared/netsuite-sync-summary.ts`.

Migration `20261010210000_restrict_sync_job_reads.sql` limits direct access to sync jobs, payload
logs and dead letters to admin/developer roles, so the Reports page's sync-job panel is empty for
other roles. Deploy the new function with a deploy-only Lovable message after merging.
