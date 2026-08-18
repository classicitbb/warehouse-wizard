# Copilot v2 — one tool layer, many surfaces

Today there are two disconnected AI surfaces: the in-app copilot edge function (9 read-only tools, hard-coded) and the MCP server (3 read-only tools). Every new capability has to be written twice. The plan is to collapse them onto one shared tool registry and then extend that registry with actions: reporting, file ingestion, product imports, voice, and opening modules from chat.

```text
  Chat panel (text + voice)        External clients (Claude/ChatGPT/Lovable)
            │                                        │
     copilot edge function                     mcp edge function
            └──────────────┬─────────────────────────┘
                    shared tool registry
        (permission check → validate → WMS service → audit)
                           │
                Supabase as the signed-in user (RLS)
```

## Resolved in design review — 2026-08-18

These eight forks were ambiguous or under-specified in the original draft and are now settled. They're folded into the sections below; listed here for a quick scan.

1. **Registry location:** `supabase/functions/_shared/copilot-tools/`, not `src/lib/copilot-tools/` — see §1.
2. **Draft storage:** bespoke tables per capability (`copilot_import_drafts`, etc.), not a reuse of the existing unused `copilot_suggestions` table — see §5, §7.
3. **File ingestion:** `ingest_document` is new code sharing only the AI-gateway call pattern with `container-vision`, not a literal call into it — see §4.
4. **Imports:** the chat-driven import tools are new, independent logic — not built on top of `reports-core.ts`'s existing UI import pipeline — see §5.
5. **Voice scope:** push-to-talk + optional TTS only in the voice rollout step; hands-free/wake-word is a separate, later phase — see §6, §8.
6. **MCP exposure:** stays read-only for v1 — draft-kind tools are excluded from the MCP catalog, in-app chat panel only — see §1, §7.
7. **Rollout control:** a new server-side capability flag (per-warehouse/per-role) gates each capability as it ships — the two existing client-side mechanisms can't do centralized rollout/kill-switch control for write-capable tools and external MCP exposure — see §7, §8.
8. **Copilot opt-in:** stays a personal, per-user opt-in at every role level (existing `ModuleKey: "copilot"` toggle) — layered under, not replaced by, the new capability flag. A capability being enabled for a role/warehouse never turns copilot on for a user who hasn't opted in themselves.

## Principles kept from the existing build

- WMS stays the system of record; the copilot is an assist layer that can fail without blocking any workflow.
- No model-generated SQL, no direct table writes. Tools only.
- Every tool runs through the caller's client so RLS enforces role/warehouse/client scope.
- Consequential writes are prepared as drafts and require an explicit human approval click.
- Uploaded documents and OCR text are data, never instructions.
- Every tool call, suggestion, acceptance and rejection is audited.
- Copilot access itself is a personal opt-in at every role level, independent of which capabilities are switched on (see Resolved #8).

## 1. Shared tool registry

Tool definitions live in **`supabase/functions/_shared/copilot-tools/`** — one file per tool, each declaring: name, description, Zod input schema, `kind` (`read` | `draft` | `ui`), required roles, and a handler that receives `(input, ctx)` where `ctx` gives the caller's Supabase client, user id, roles and active warehouse.

This is a change from the original draft, which put the registry in `src/lib/copilot-tools/`. Nothing in `supabase/functions/` imports from `src/` today — the only existing cross-sharing precedent is `supabase/functions/_shared/` (used for email templates and `netsuite.ts`), and the MCP function only gets code from `src/lib/mcp/` via an auto-generated build step (`@lovable.dev/mcp-js`), not a live import. Putting the registry on the Deno side follows the precedent that already exists: the copilot edge function imports it directly by relative path, and the MCP function's build step pulls from the same location — no new bundler or tooling required.

Each tool declares the minimum role that may call it, and the registry filters the catalog per caller — a clerk never even sees a tool they cannot run, so the model cannot offer it. Role checks are re-run server-side at execution time, and RLS still scopes every row on top of them. `ctx`'s roles/warehouse are resolved the same way the copilot function already resolves them today — a `profiles` lookup per request, not JWT claims.

| Capability | inventory_clerk | warehouse_supervisor | warehouse_manager | admin / developer |
| --- | --- | --- | --- | --- |
| Read: inventory, products, locations, receipts, picks, put-aways, blocked work | own warehouse | own warehouse | all assigned warehouses | all warehouses |
| Open modules / records / start workflows (`ui`) | screens their role already has | same, plus supervisor screens | plus manager screens | everything |
| Reports | operational reports for their warehouse | plus productivity and exception reports | plus cross-warehouse and client reports | all reports, including admin/audit |
| File ingestion (photos, packing lists, PDFs) | yes — drafts only | yes — drafts only | yes | yes |
| Approve an ingestion draft into Receiving | no — routes to supervisor | yes | yes | yes |
| Product / client / location imports | propose only | propose + validate | validate + approve small imports | full approve and commit |
| Cycle-count and adjustment drafts | propose | propose | approve | approve |
| Settings, users, roles, integrations | no | no | read-only summaries | yes |
| Voice: read and navigate | yes | yes | yes | yes |
| Voice: approve a write | never — approval is always an on-screen tap for every role | | | |

`warehouse_operator` and `dispatch_driver` keep a read + navigate subset (their own tasks, stock lookup, module opening) with no drafting or approval. Approval is always a separate human from the model's proposal, and a user can never approve a draft that exceeds their own role's write scope even if another role prepared it.

Two thin adapters consume the registry:
- The copilot edge function turns them into OpenAI-style function definitions and executes them in its existing tool loop.
- The MCP entry wraps each one in `defineTool`, so external assistants get the same catalog — **for v1, filtered to `kind: "read"` only** (see Resolved #6). `ui` is excluded because there's no browser to drive; `draft` is excluded so drafting stays an in-app-chat-panel-only capability until the approval-token flow has proven itself with one caller.

Result: adding a read tool once exposes it in the app chat and over MCP. Draft and UI tools are app-chat-only until MCP's scope is deliberately widened in a later pass.

## 2. Module opening from chat (`ui` tools)

New tool kind that returns a **UI directive** instead of data: `{ action: "navigate", route, params, label }`. The edge function passes directives back alongside the answer; the panel renders them as buttons ("Open Putaway task PTA-1042") and navigates with react-router when clicked. Nothing auto-navigates — the click is the consent.

Tools: `open_module` (dashboard, receiving, putaway, picking, inventory, moves, transfers, cycle counts, reports, settings), `open_record` (pallet, product, location, receipt, pick list, putaway task), `start_workflow` (new receipt draft, new pick list, new count) which lands on the pre-filled screen rather than creating anything.

## 3. Reporting

`run_report` over a whitelist of named, parameterised reports (stock on hand by warehouse/client, expiring stock, receiving throughput, pick productivity, adjustments, movement history, empty/over-capacity locations). Each report is a server-side definition with typed params — the model chooses a report id and parameters, never SQL.

Output returns as a structured table the panel renders inline, with CSV/PDF export and an "Open in Reports" directive — confirmed to have a real target: the existing `/reports` route (`ReportsPage`). Same tool is available over MCP so an external assistant can pull the numbers.

## 4. File ingestion

Chat panel gets attach + camera. Files upload to a private `copilot-uploads` bucket scoped to the user, then `ingest_document` classifies and extracts:

- Photos of container fronts → the existing `container-vision` path (ISO 6346 + check digit) for that specific sub-case.
- Packing lists / PO / invoice PDFs and images → vision extraction into a typed line-item draft.
- CSV / XLSX → parsed to rows for the import path below.

`ingest_document` is **new code** (`supabase/functions/copilot-ingest/`), not a literal extension of `container-vision`. `container-vision` takes exactly one JPEG and extracts a single ISO 6346 code with local check-digit validation — a narrow, single-purpose extractor that should stay that way. `ingest_document` shares its AI-gateway call pattern (same model, same general request shape) but has its own prompt and a typed line-item schema, since the two jobs (one field vs. a multi-line document) are structurally different (see Resolved #3).

Extraction always produces a **draft with confidence per field**; anything below threshold is flagged for review. The reply shows a diff-style preview and the actions "Open in Receiving", "Create import", or "Discard". The artifact and its extraction are retained for audit.

## 5. Product / data imports

Three-step gated flow, mirroring the safe-import pattern:
1. `create_draft_import` — takes parsed rows plus a column mapping the model proposes; stores a draft, never touches live tables.
2. `validate_import` — deterministic schema + business-rule checks (SKU uniqueness, UOM, temperature class, required fields), returns per-row errors and warnings.
3. `commit_import` — refuses unless the draft is valid **and** carries an approval token minted by the user clicking Approve in the UI. Writes through the existing admin upsert service, logs an audit event, and supports a summary of created vs updated rows.

This is **new, independent logic** in the shared registry — not built on top of `src/features/reports/reports-core.ts`'s existing `previewImport()`/`commitImportRows()` pipeline, even though that pipeline already does a very similar preview→validate→commit job for CSV imports today (see Resolved #4). Keep the two paths separate rather than sharing code between them.

Draft storage is **bespoke per capability** (`copilot_import_drafts`, `copilot_import_mappings`, `copilot_approvals`) — not routed through the existing, currently-unused generic `copilot_suggestions` table (see Resolved #2).

Supported targets: products, clients, locations, and receipt lines. Import mappings are remembered per client/file-shape so repeat files map themselves.

Per §1, these tools stay out of the MCP catalog for v1 — drafting is chat-panel only.

## 6. Voice

- **Input:** press-and-hold mic in the panel and on the mobile toolbar. Web Speech API where available (instant, free); fallback to recording and a gateway speech-to-text call so handhelds and iOS work. Transcript lands in the composer for review — never auto-sent.
- **Output:** optional spoken replies via gateway text-to-speech, off by default, with answers written short when voice is on.
- Warehouse vocabulary hinting (SKUs, location codes, client names) to improve recognition of codes.
- **Hands-free mode** (continuous listening with a wake phrase, short spoken confirmations, `read`/`ui` tools only by voice) is **out of scope for the initial voice rollout step** — deferred to its own later phase once push-to-talk voice has been used in the field. It brings real added cost (wake-word engine choice, continuous-mic privacy/battery tradeoffs on shared devices) that shouldn't gate shipping basic voice input (see Resolved #5).

## 7. Safety and audit

- Role gate per tool, re-checked server-side; roles come from the WMS, never the prompt.
- Approval tokens: single-use, short-lived, bound to draft id + user, issued only by a UI click.
- Rate limits per user on ingestion and model calls.
- Injection defense: extracted document text is wrapped as untrusted data in the prompt, and any instruction-like content in it is ignored by policy plus tested.
- `copilot_tool_calls` extended with kind, approval id, and outcome; drafts and approvals get their own audit rows.
- **New: a server-side capability flag** (per-warehouse/per-role) checked in the registry alongside the role check, gating each new capability as it ships. The two mechanisms that exist today — `COPILOT_ACCESS_ROLES` (role gate) and `isCopilotPreviewHost()` (localStorage preview-host override) — are both client-side and per-browser, with no way to stage a rollout by warehouse/customer or kill a broken capability centrally. Given this plan adds write-capable tools and external MCP exposure, that's not sufficient on its own (see Resolved #7). Those two existing mechanisms stay as-is for gating base copilot panel visibility; the new flag is specifically for gating the new capabilities in this plan.
- The pre-existing `copilot_suggestions` table (added 2026-08-06, currently unused) is unrelated to this plan's draft tables and is left as-is.

## 8. Rollout order

0. Capability flag table + registry skeleton (§1, §7) — refactor the existing 9 tools onto the registry with no behavior change, so every later step has a flag to ship behind.
1. `ui` directives and module/record opening.
2. `run_report` + inline tables and export.
3. Voice input (Web Speech, then STT fallback), then optional TTS — push-to-talk only, hands-free excluded (see §6).
4. File ingestion with drafts and previews.
5. Gated import pipeline (draft → validate → approve → commit).

Each step ships behind the new server-side capability flag (§7), staged per warehouse/role, independent of the existing personal copilot opt-in toggle which stays as-is (see Resolved #7, #8).

## Technical notes

- New: `supabase/functions/_shared/copilot-tools/*` (registry + tools — moved from the originally-proposed `src/lib/copilot-tools/`), `supabase/functions/copilot-ingest/index.ts` (new, independent of `container-vision`), `src/features/copilot/directives.tsx` (renders navigate/approve actions), `src/features/copilot/voice.ts`.
- Changed: `supabase/functions/copilot/index.ts` (registry adapter, directives, approval tokens), `src/lib/mcp/index.ts` + tools (registry adapter, read-kind only), `src/features/copilot/copilot-panel.tsx` (attachments, mic, directive buttons, report tables).
- Migrations: `copilot_capability_flags` (new — per-warehouse/per-role rollout control, §7/§8), `copilot_uploads` bucket with owner-scoped policies, `copilot_import_drafts`, `copilot_import_mappings`, `copilot_approvals`, plus grants and RLS on each. All additive, per repo convention.
- MCP manifest regenerated and the `mcp` function redeployed on every tool change; only `kind: "read"` tools are included in what gets wrapped in `defineTool`.
