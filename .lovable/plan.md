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

## Principles kept from the existing build

- WMS stays the system of record; the copilot is an assist layer that can fail without blocking any workflow.
- No model-generated SQL, no direct table writes. Tools only.
- Every tool runs through the caller's client so RLS enforces role/warehouse/client scope.
- Consequential writes are prepared as drafts and require an explicit human approval click.
- Uploaded documents and OCR text are data, never instructions.
- Every tool call, suggestion, acceptance and rejection is audited.

## 1. Shared tool registry

Move tool definitions into `src/lib/copilot-tools/` — one file per tool, each declaring: name, description, Zod input schema, `kind` (`read` | `draft` | `ui`), required roles, and a handler that receives `(input, ctx)` where `ctx` gives the caller's Supabase client, user id, roles and active warehouse.

Two thin adapters consume the registry:
- The copilot edge function turns them into OpenAI-style function definitions and executes them in its existing tool loop.
- The MCP entry wraps each one in `defineTool`, so external assistants get the same catalog, minus the `ui` kind (no browser to drive).

Result: adding a tool once exposes it in the app chat and over MCP.

## 2. Module opening from chat (`ui` tools)

New tool kind that returns a **UI directive** instead of data: `{ action: "navigate", route, params, label }`. The edge function passes directives back alongside the answer; the panel renders them as buttons ("Open Putaway task PTA-1042") and navigates with react-router when clicked. Nothing auto-navigates — the click is the consent.

Tools: `open_module` (dashboard, receiving, putaway, picking, inventory, moves, transfers, cycle counts, reports, settings), `open_record` (pallet, product, location, receipt, pick list, putaway task), `start_workflow` (new receipt draft, new pick list, new count) which lands on the pre-filled screen rather than creating anything.

## 3. Reporting

`run_report` over a whitelist of named, parameterised reports (stock on hand by warehouse/client, expiring stock, receiving throughput, pick productivity, adjustments, movement history, empty/over-capacity locations). Each report is a server-side definition with typed params — the model chooses a report id and parameters, never SQL.

Output returns as a structured table the panel renders inline, with CSV/PDF export and an "Open in Reports" directive. Same tool is available over MCP so an external assistant can pull the numbers.

## 4. File ingestion

Chat panel gets attach + camera. Files upload to a private `copilot-uploads` bucket scoped to the user, then `ingest_document` classifies and extracts:

- Photos of container fronts → reuse the existing `container-vision` path (ISO 6346 + check digit).
- Packing lists / PO / invoice PDFs and images → vision extraction into a typed line-item draft.
- CSV / XLSX → parsed to rows for the import path below.

Extraction always produces a **draft with confidence per field**; anything below threshold is flagged for review. The reply shows a diff-style preview and the actions "Open in Receiving", "Create import", or "Discard". The artifact and its extraction are retained for audit.

## 5. Product / data imports

Three-step gated flow, mirroring the safe-import pattern:
1. `create_draft_import` — takes parsed rows plus a column mapping the model proposes; stores a draft, never touches live tables.
2. `validate_import` — deterministic schema + business-rule checks (SKU uniqueness, UOM, temperature class, required fields), returns per-row errors and warnings.
3. `commit_import` — refuses unless the draft is valid **and** carries an approval token minted by the user clicking Approve in the UI. Writes through the existing admin upsert service, logs an audit event, and supports a summary of created vs updated rows.

Supported targets: products, clients, locations, and receipt lines. Import mappings are remembered per client/file-shape so repeat files map themselves.

## 6. Voice

- **Input:** press-and-hold mic in the panel and on the mobile toolbar. Web Speech API where available (instant, free); fallback to recording and a gateway speech-to-text call so handhelds and iOS work. Transcript lands in the composer for review — never auto-sent — except in an explicit hands-free mode.
- **Hands-free mode** for forklift/handheld: continuous listening with a wake phrase, short spoken confirmations, and a strict rule that only `read` and `ui` tools may run by voice; anything that writes requires the on-screen approval tap.
- **Output:** optional spoken replies via gateway text-to-speech, off by default, with answers written short when voice is on.
- Warehouse vocabulary hinting (SKUs, location codes, client names) to improve recognition of codes.

## 7. Safety and audit

- Role gate per tool, re-checked server-side; roles come from the WMS, never the prompt.
- Approval tokens: single-use, short-lived, bound to draft id + user, issued only by a UI click.
- Rate limits per user on ingestion and model calls.
- Injection defense: extracted document text is wrapped as untrusted data in the prompt, and any instruction-like content in it is ignored by policy plus tested.
- `copilot_tool_calls` extended with kind, approval id, and outcome; drafts and approvals get their own audit rows.

## 8. Rollout order

1. Shared registry + move existing 9 read tools onto it; MCP inherits them.
2. `ui` directives and module/record opening.
3. `run_report` + inline tables and export.
4. Voice input (Web Speech, then STT fallback), then optional TTS.
5. File ingestion with drafts and previews.
6. Gated import pipeline (draft → validate → approve → commit).

Each step ships behind the existing copilot preview flag before going to production.

## Technical notes

- New: `src/lib/copilot-tools/*` (registry + tools), `src/features/copilot/directives.tsx` (renders navigate/approve actions), `src/features/copilot/voice.ts`, `supabase/functions/copilot-ingest/index.ts`.
- Changed: `supabase/functions/copilot/index.ts` (registry adapter, directives, approval tokens), `src/lib/mcp/index.ts` + tools (registry adapter), `src/features/copilot/copilot-panel.tsx` (attachments, mic, directive buttons, report tables).
- Migrations: `copilot_uploads` bucket with owner-scoped policies, `copilot_import_drafts`, `copilot_import_mappings`, `copilot_approvals`, plus grants and RLS on each.
- MCP manifest regenerated and the `mcp` function redeployed on every tool change.
