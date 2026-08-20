# Error handling & mutation audit — 2026-08-20

Sweep of all 95 `useMutation` call sites, the React Query cache handlers, the
global error listeners, and every swallowed-error pattern in `src/**` and
`supabase/functions/**`. Fixed items are marked ✅; the rest is the open list
this document exists to record.

Method: scripted extraction of every `useMutation` block (balanced-brace parse)
compared against the query keys each screen reads; a second pass for
`catch {}` / `.catch(() => {})` / bare `void promise`; and a diff of query keys
that are read but never invalidated.

---

## 1. Fixed in this pass

### 1.1 Partial batch writes reported as total failures ✅

**`src/features/receiving/receiving-page.tsx` — `batchReceiveMutation`**

`for (const draft of drafts) { await completeReceiptFromDraft(...) }` inside a
`mutationFn`. Each iteration creates a real pallet and a real put-away task. A
failure on draft 3 of 5 threw, so React Query took the `onError` path and
`onSuccess` never ran — meaning:

- no cache invalidation, so `draft-receipts` still listed all five as pending;
- `selectedDraftIds` was never trimmed;
- the operator saw a bare "Receiving failed".

The natural next action is to re-run the print job, which receives drafts 1–2 a
**second time**: duplicate pallets, duplicate put-away tasks, inventory that
does not match the floor.

Fixed with `src/lib/batch-mutation.ts` (`runBatch` / `PartialBatchError`):

- committed results are carried on the thrown error;
- the message names how many committed and warns against repeating them;
- invalidation moved to `onSettled`, because a partial write is still a write;
- committed drafts are dropped from the selection so a retry sends only what is
  left;
- when *nothing* committed, the original error is rethrown untouched, so
  `RULE_VIOLATION:` prefixes and the offline copy still match.

Covered by `src/test/batch-mutation.test.ts` and four integration cases in
`src/test/receiving-page.test.tsx`.

### 1.2 Same defect in the bulk location editor ✅

**`src/components/warehouse-tree-view.tsx` — Edit Location Range**

Identical row-at-a-time loop over `targets`. A mid-way failure left earlier
locations patched while the tree, `locations` and `zone-locations` caches all
still showed the old values. Now uses `runBatch` with invalidation in
`onSettled`.

### 1.3 Mutations with no error handler ✅

`admin-page.tsx` `visibilityMutation` and `profileMutation` had no `onError`.
The `MutationCache` fallback in `query-client.ts` did toast them, but with a
generic message and no context about which action failed. Both now report in
their own terms.

### 1.4 Stale caches after a successful write ✅

| Query key | Was stale after | Fix |
| --- | --- | --- |
| `pickable-stock-summary` | releasing or cancelling a pick list (both change reserved stock) | invalidated in both mutations |
| `pending-access-requests` | approving/disabling a user — the banner hung around for up to its 60 s poll (`ui-shared.tsx:1943`) | added to `invalidateOptions()` |
| `inventory-search` | cancelling a pick list | added |

`picking-page.tsx`'s cancel mutation also fired its invalidations without
awaiting them; now awaited like every other mutation on that page.

### 1.5 Wrong label for a single-position location ✅

`describeInventoryStructureScope` called a four-segment code (`A-08-C-P2`) a
"Level". `RACK-BAY-LEVEL-P#` is a single location. This was the one failing test
in the suite at the start of this pass.

### 1.6 Silent copilot persistence failures ✅

`copilot-panel.tsx` swallowed three failures with bare `catch {}` /
`.catch(() => {})`: conversation creation, message save, and opening a saved
chat. The last of those made the History button look dead. All three now log
telemetry (severity `warning`, no toast — they must not interrupt floor work),
and a failed open says so in the thread. This matters more now that operator
problem reports run through the same conversation.

### 1.7 Suppressed network rejections left no trace ✅

`main.tsx` deliberately drops network-shaped unhandled rejections so the offline
banner is the single source of truth (`main.tsx:25`). Reasonable — but it also
skipped telemetry entirely, so "it just did nothing" reports arrived with no
record of the thing that broke. Suppressed rejections now still leave a habit
breadcrumb (flagged `suppressed: true`), which is attached to any report the
operator files.

---

## 2. Open — unhandled or silently swallowed

Ordered by what would actually cost someone a shift.

### 2.1 `npx tsc --noEmit` does not typecheck anything — **high**

`AGENTS.md §3.4` instructs agents to run `bunx tsc --noEmit` before declaring
done. The root `tsconfig.json` has `"files": []` and only project references, so
that command compiles **zero files** and always exits 0.

The real check is:

```bash
npx tsc -p tsconfig.app.json --noEmit
```

Under the real config the pre-existing `src/**` tree is clean, so this is a
latent gap rather than a backlog — but any agent following AGENTS.md literally
is running a no-op. Recommend adding `"typecheck": "tsc -p tsconfig.app.json --noEmit"`
to `package.json` and updating AGENTS.md to name it.

### 2.2 Dead duplicate page components in `ui-shared.tsx` — **medium**

`src/features/shared/ui-shared.tsx` still defines `AppShell` (line 1519),
`DashboardPage` (3563) and `ReceivingPage` (4426). `src/components/wms-ui.tsx`
exports the `src/features/**` versions, so these copies are unreachable — and
they have diverged: the dead `ReceivingPage` batch-receive mutation has neither
the `assertOnline()` guard, the offline-message translation, nor the partial-batch
fix from §1.1.

Risk is not runtime, it is maintenance: a fix applied to the wrong copy looks
correct in review and changes nothing. Out of scope for this pass under
AGENTS.md §1 ("no while-you're-there refactors"), but it should be deleted
deliberately.

### 2.3 Container-vision failures fall back silently — **medium**

`src/components/barcode-scan-button.tsx:435` — when the `container-vision` edge
function is offline, rate-limited or erroring, the scanner drops to local OCR
with no signal at all. Accuracy quietly drops and nobody can tell whether the
model is even reachable. Recommend a `warning`-level telemetry entry (not a
toast — the fallback is the right behaviour) so the failure rate is visible in
the system log.

### 2.4 Notification delivery failures are invisible — **medium**

`src/hooks/use-reorder-alert-notifications.ts:66` and `:76` — both the service
worker path and the page-level `Notification` constructor swallow their errors.
An operator who believes they are receiving reorder alerts and is not has no way
to discover it. Recommend recording the failure once per session.

### 2.5 Import archive failures are invisible — **low**

`src/features/reports/reports-core.ts:493` — the source file upload to the
`imports` bucket is `catch { /* ignore */ }`. The import itself succeeded, so
this is correctly non-fatal, but it means the audit copy of what was imported
can be missing with no record. Recommend telemetry.

### 2.6 Deliberate and correct — no action

For completeness, these swallow patterns were reviewed and are right as they
stand: `localStorage`/`sessionStorage` writes (quota and private mode),
service-worker unregister and cache purge in `main.tsx`, camera frame reads that
are not ready yet, `getSupportedFormats` feature detection, and scanner-learning
persistence. All are commented with why.

### 2.7 Lint baseline — **informational**

`npx eslint .` reports 589 errors / 3064 warnings across the repo, overwhelmingly
`@typescript-eslint/no-explicit-any`. New modules added in this pass
(`batch-mutation.ts`, `habit-tracking.ts`, `feedback-core.ts`) are lint-clean;
new test files use `any` only in mock-payload helpers, matching the existing
test style. Worth a separate, dedicated pass rather than incidental cleanup.

---

## 3. Error-handling architecture (verified, unchanged)

Confirmed working and left alone:

- `MutationCache.onMutate` calls `assertOnline()`, and React Query routes a
  throw there into the mutation's own `onError` — verified against
  `query-core/mutation.js`, so the offline freeze cannot be bypassed.
- `MutationCache.onError` logs telemetry for **every** failed mutation and only
  toasts when the mutation has no `onError` of its own, so failures are never
  double-reported.
- Mutation variables are logged with the failure, and `system-telemetry`'s
  `SENSITIVE_KEY_PATTERN` redacts `password` / `pin` / `token` / `secret` before
  the row is written. Covered by a test.
- `window.onerror`, `unhandledrejection`, `console.error` and the React error
  boundary all feed `system_logs`.
- Mutations never retry (`retry: 0`) — retrying a put-away confirm would
  double-store a pallet.

---

## 4. Test coverage added

| File | What it pins down |
| --- | --- |
| `src/test/batch-mutation.test.ts` | ordering, progress, partial-failure payload, original-error passthrough |
| `src/test/receiving-page.test.tsx` (+4) | the duplicate-receive regression end to end |
| `src/test/offline-queue.test.ts` | network-vs-business error classification, dead-lettering, drain ordering, concurrent flush |
| `src/test/network-status.test.ts` | the offline freeze, the health probe, `guardMutation` |
| `src/test/error-boundary.test.tsx` | isolation, telemetry severity, chunk-reload loop guard, "Report this" |
| `src/test/system-telemetry.test.ts` (rewritten) | redaction, truncation, circular refs, signed-out skip, failing writes |
| `src/test/query-client.test.ts` (extended) | global error fallback, double-toast suppression, habit signal |
| `src/test/habit-tracking.test.ts` | redaction, route normalising, summarisation, flush retry/disable |
| `src/test/operator-feedback.test.ts` | the report interview, agent brief, edge-function drift guard, migration contract |
| `src/test/copilot-core.test.ts` | error-message extraction, grounding context, report request bus |

Suite: 216 → 379 tests, all passing.
