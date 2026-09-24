# Beta sandbox and cutover runbook

Operational companion to `docs/whitepaper-netsuite-integration-proposal.md` §10. That document
carries the strategy and the safeguards for a business audience. This one carries the steps, for
whoever performs them — including agents.

**Nothing here has been executed.** This is the intended procedure, written before the work starts
so it can be reviewed rather than improvised. Every step that touches production is an approval
gate.

---

## 0. The rules that must not be broken

1. **The beta may never hold credentials that reach live NetSuite.** Isolation is enforced by the
   credentials themselves, not by care. A separate NetSuite integration record, a separate
   certificate, and a sandbox account id.
2. **Structure and code move forward. Data stays where it lives.** The beta database is
   disposable. Production is only ever altered, never replaced. See §5.
3. **Production edge functions are never redeployed as a side effect.** A push to `main` syncs code
   into Lovable but does *not* redeploy edge functions. Deployment is a deliberate, separate act.
4. **Every schema change is a forward migration with a written reversal**, rehearsed against a
   restore of production data before it runs against production.

---

## 1. Environment topology

| | Production (live) | Beta sandbox |
|---|---|---|
| Application | current deployment, untouched | separate deployment, own URL |
| Supabase project | current, Lovable-managed | **separate Supabase project** |
| NetSuite account | live account | **`_SB1` sandbox account** |
| NetSuite integration record | existing | **new, separate record** |
| Signing certificate | existing (pending upload, see whitepaper Q-J1) | **separate certificate** |
| Webhook / queue secrets | existing | **regenerated, different values** |
| Queue drain | GitHub Actions schedule | separate workflow or manual dispatch only |
| Users | real | test accounts only |

### Known environment constraints

These are established facts about this project. They shape the procedure below.

- **The Supabase project is Lovable-managed and is not linked in the local CLI.** Migrations and
  edge-function deploys route through Lovable, not `supabase db push` from a workstation.
- **There is no `pg_net` in this database.** Database triggers cannot call edge functions. The
  outbound queue is drained by a scheduled GitHub Actions workflow calling
  `process-netsuite-queue` with a runner secret. The beta needs its own equivalent, or manual
  dispatch.
- **A push to `main` syncs code into Lovable but does not redeploy edge functions.** Changed
  functions are deployed with a deploy-only Lovable agent message, after which `git fetch` should
  confirm no code edits came back.
- **The repository has mixed line endings, including within single files.** Whole-file rewrites
  explode the diff and obscure review. Edit surgically.
- **`tsc --noEmit` checks zero files here.** Use `npm run typecheck`.

---

## 2. Standing up the beta

### 2.1 Supabase

1. Create a new Supabase project for the beta. Record its project ref, URL and keys.
2. Apply the full migration history from `supabase/migrations/` in order, to reach parity with
   production structure.
3. **Seed, do not copy.** Use `supabase/seed.example.sql` plus a purpose-built beta seed. Do not
   restore a production dump into the beta: it would put real customer, supplier and stock data in
   a lower-trust environment for no testing benefit.
   - Exception: if a migration must be rehearsed against realistic volume (§5.3), restore a
     production backup into a **throwaway** project for that rehearsal only, then destroy it.
4. Set the edge function environment: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
   `SUPABASE_ANON_KEY` for the beta project.
5. Deploy the edge functions to the beta project.

### 2.2 NetSuite sandbox wiring

Requires Jan (whitepaper Q-J5).

1. New integration record in the **sandbox** account, with the Client Credentials (Machine to
   Machine) grant and the REST Web Services scope.
2. In the beta app: Settings → Integrations → NetSuite → generate a **new** certificate. Download
   it.
3. Jan uploads it under Setup → Integration → Manage Authentication → OAuth 2.0 Client Credentials
   (M2M) Setup, mapping entity, role and application, and returns the assigned Certificate ID.
4. Save the sandbox account id (ends `_SB1` or similar), client id and Certificate ID in the beta.
5. Test connection. Expect `NetSuite credentials verified`.
6. Configure the beta's location mapping against **sandbox** location internal ids, and the
   adjustment posting account against a **sandbox** GL account.

**Verification that isolation holds:** the beta's stored account id must end in the sandbox suffix.
Add an assertion to the beta deployment checklist that refuses a non-sandbox account id. A live
account id in the beta is a stop-work condition.

### 2.3 Application

1. Branch from `main`. All Phase work lands on this branch, not `main`.
2. Deploy to a separate host target with its own environment variables pointing at the beta
   Supabase project.
3. Create test users covering each role: admin, supervisor, receiver, picker.

---

## 3. Working in the beta

- Feature work merges into the beta branch and deploys to the beta host.
- `main` continues to serve production and receives only defect fixes for the live system.
- Rebase the beta branch onto `main` regularly so the eventual cutover diff stays small. Long-lived
  divergence is the main avoidable risk in this plan.
- Each work package (W1–W16 in the whitepaper) is demonstrable in the beta on its own and signed
  off on its own.

### Test data for acceptance

Simplex needs real-shaped documents in the NetSuite sandbox before UAT:

- one local purchase order (PO → receipt path)
- one inbound shipment carrying **two** purchase orders (the multi-PO case demonstrated in the
  meeting)
- one transfer order between two sandbox locations
- one sales order with a multi-level unit-of-measure item (the rice bale/bag case)
- one return authorisation
- at least one lot-tracked item and one item with bins

`docs/testing/netsuite-record-integration-tests.md` already describes this shape for the existing
adapter and should be extended rather than duplicated.

---

## 4. Acceptance gates

A work package is accepted when all of the following hold. Record the evidence against each.

| Gate | Evidence |
|---|---|
| Functional | Named Simplex reviewer has run the scenario in the beta and signed it off |
| Round trip | The document appears correctly in the NetSuite sandbox, with the right quantities and links |
| Idempotent | A deliberate retry or timeout produces no duplicate document in NetSuite |
| Failure path | A deliberate failure dead-letters cleanly, with a readable reason, and does not corrupt state |
| Reconciliation | Warehouse Wizard and NetSuite sandbox agree on stock for the affected items |
| Regression | `npm run typecheck` clean; full test suite green; focused lint clean |

---

## 5. Cutover to production

### 5.1 Pre-cutover

1. Beta branch rebased onto `main`; diff reviewed in full.
2. Every migration in the release reviewed for reversibility, with the reversal written.
3. Migrations rehearsed against a **restore of production data** in a throwaway project. Record
   run time — long-running migrations on large tables need a maintenance window.
4. Production backup taken and its restorability confirmed.
5. Rollback triggers agreed in writing: what specifically would cause a rollback, who decides, and
   the time budget.
6. Window agreed with Roget, outside operating hours.

### 5.2 Cutover sequence

Order matters. Deploying application code that expects a column the database does not have breaks
production immediately.

1. **Additive migrations first.** New tables and new nullable columns. These are safe while the old
   application is still running.
2. **Backfill** existing rows where needed (for example the NetSuite line references from W4),
   in batches, reversibly.
3. **Merge the beta branch to `main`** and let Lovable sync.
4. **Deploy the edge functions deliberately** — the push does not do it. Confirm with `git fetch`
   that no code edits came back.
5. **Deploy the application.**
6. **Configure production**: NetSuite location mapping, adjustment account, and any new settings,
   against **live** NetSuite ids.
7. **Destructive migrations last, and only in a later release.** Dropping or renaming anything the
   previous application version still reads must wait until that version is no longer running.

### 5.3 The data rule, restated

The beta database is never promoted. Only migrations and code move forward. Where live data needs
reshaping to fit new structure, that is a backfill: additive, batched, rehearsed, and reversible.

### 5.4 Post-cutover watch

1. First real container received with the team present.
2. Check `integration_sync_jobs` for the new job types: status, attempts, results.
3. Check `integration_dead_letters` is empty.
4. Confirm the item receipt in live NetSuite matches what the floor recorded.
5. Run the reconciliation report (W14, if in scope) or a manual stock comparison for the affected
   items.
6. Hold the rollback decision open for one full operating day.

### 5.5 Rollback

1. Revert the application deployment to the previous build.
2. Revert the edge functions to the previous version.
3. Apply migration reversals **only if** the new structure actively breaks the old application.
   Additive columns are usually harmless and are better left in place than dropped under pressure.
4. Restore from backup only as a last resort, and only with explicit sign-off — it loses everything
   recorded since the backup.
5. Drain or quarantine any queued outbound jobs created by the new code before the old worker sees
   them.

---

## 6. Secrets inventory

Names only. Values live in Supabase and GitHub secrets, never in the repository.

| Name | Production | Beta |
|---|---|---|
| `netsuite_client_id` | live integration record | **sandbox integration record** |
| `netsuite_private_key` | live signing key | **separate key** |
| `netsuite_webhook_secret` | live | **regenerated** |
| `netsuite_queue_runner_secret` | live | **regenerated** |
| `integration_connections.config.account_id` | live account | **must end in sandbox suffix** |
| `integration_connections.config.certificate_id` | live | separate |
| `integration_connections.config.adjustment_account_id` | live GL account | sandbox GL account |
| `SUPABASE_FUNCTIONS_URL` (repo secret) | production project | beta project |
| `NETSUITE_QUEUE_RUNNER_SECRET` (repo secret) | production | beta |

Both webhook and queue runner secrets are revealed **once**, on the save that creates them.
Re-save to rotate.

---

## 7. Decommissioning the beta

After a successful cutover and the watch period:

1. Keep the beta running for one further cycle as a rehearsal environment for the next phase.
2. When retired: revoke the sandbox certificate in NetSuite, delete the sandbox integration record,
   delete the beta Supabase project, remove the beta host target and its repository secrets.
3. Do not leave a beta with valid credentials running unattended.

---

## 8. Open items owned by this runbook

| # | Item | Owner | Blocks |
|---|---|---|---|
| B1 | Confirm whether a second Supabase project can be created under the current Lovable arrangement, or whether beta must be a separate Lovable project | Russell / Lovable | §2.1 |
| B2 | Confirm Lovable's deploy path for a non-`main` branch, or whether beta needs its own repository | Russell | §2.3, §3 |
| B3 | Sandbox NetSuite integration record, certificate and access | Jan | §2.2 |
| B4 | Decide whether the beta gets its own scheduled queue drain or manual dispatch only | Russell | §2.1 |
| B5 | Agree the cutover window and rollback authority | Roget | §5.1 |
