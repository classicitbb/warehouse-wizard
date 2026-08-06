# Warehouse Copilot — AI assist layer around the WMS

An intelligence layer that surrounds the existing WMS. The WMS stays the system of record; every
copilot feature degrades to today's manual workflow if AI is unavailable. Scope for this build:
**Ask + Assist** (grounded answers, data-entry help, document OCR, code reading, summaries).
No automatic writes — anything that changes data is prepared as a draft a human confirms.

## Recommended surface

A **global context-aware side panel plus quiet inline hints** — the panel is the copilot's home,
and the same engine feeds small suggestions inside Receiving, Putaway, Picking and Counts.

Why: operators live inside task screens on handhelds; sending them to a separate Copilot page
breaks the flow and loses the on-screen context (selected pallet, location, receipt). A panel
opened from the header keeps the current screen visible, and inline hints put the help exactly
where the mistake would happen. Managers get depth in the panel; floor staff mostly never open it.

```text
Header  [ Warehouse Wizard ]            ... [ Ask Copilot ]
+-----------------------------+---------------------------+
| Receiving / Putaway / etc.  |  Copilot panel            |
|                             |   - knows this screen     |
|  [inline hint chip]         |   - answers with record   |
|  "Usual pallet qty 48"      |     IDs + timestamps      |
|                             |   - drafts, never commits |
+-----------------------------+---------------------------+
```

## What it can do

**Ask (grounded answers, read-only)**

- "Where is SKU 4412?", "What's blocking receipt R-1043?", "Which pallets expire this week in CH2?",
"Why can't I put away to A-01-02-3?", "What are my open tasks?"
- Every operational answer cites the records it used (pallet IDs, location codes, timestamps).
If the tools return nothing, the copilot says so — it never invents stock.
- Procedure/how-to answers come from the existing Help Center content, labelled by source
(official procedure vs. system behaviour vs. AI explanation).

**Assist**

- **Receiving from a document (vision).** Photograph or upload a packing list / BOL / invoice.
The copilot OCRs it, matches SKUs against the catalog, and pre-fills a receiving draft for
line-by-line review. Low-confidence fields are flagged, never silently accepted. Nothing is
committed until the user presses the existing confirm.
- **Label / container code reading (vision).** When a barcode won't scan, the camera reads pallet,
location or container codes from the printed text and drops the value into the scan field —
shown for confirmation and cross-checked against the existing container-number validator.
- **Data-entry help.** Explains validation failures in plain language and suggests the fix
("this location is temperature-incompatible with this product — nearest valid bay is ...").
- **Training.** New-operator Q&A over the help content plus how this warehouse actually works.
- **Shift and manager summaries.** On-demand summary of receipts, putaways, picks, exceptions and
expiring stock for the active warehouse, built only from tool results.

## Safety rules (non-negotiable)

- The model never writes to the database and never generates SQL. It may only call a fixed set of
server-side tools, each of which re-checks the caller's role and warehouse scope.
- Warehouse/client scope comes from the signed-in user's session, never from the prompt.
- Uploaded documents and OCR text are treated as data, never instructions.
- Every tool call, suggestion, acceptance and rejection is logged to the audit trail.
- If the AI service is down, rate-limited or out of credits, the panel shows a clear error and the
underlying screens keep working exactly as they do today.

## Technical plan

**Backend — one new edge function `copilot**` (Lovable AI Gateway, `google/gemini-3.6-flash`,
streaming, key stays server-side):

- Resolves a *context envelope* server-side from the caller's JWT: user, roles, active warehouse,
client scope, current screen, selected entity. Client context is a hint only and is re-validated.
- Dispatches a controlled tool catalog. Each tool = permission check -> input validation ->
existing service/RPC or approved read view -> structured result -> audit event.
  - Read tools: `search_inventory`, `get_product_details`, `get_location_details`,
  `get_receipt_status`, `get_pick_list_status`, `get_putaway_tasks`, `get_expiring_inventory`,
  `get_blocked_workflows`, `get_open_tasks`, `search_procedures`.
  - Draft tools (return a preview payload to the UI, never persist):
  `draft_receiving_from_document`, `read_code_from_image`, `prepare_shift_summary`.
- Reuses the read logic already in `src/features/*/*-core.ts` and the existing MCP tools as the
pattern for scoped reads.
- Vision path: image/PDF sent as a multimodal message; the model returns a strict schema
(lines, SKU, qty, lot, expiry, plus per-field confidence). Result is schema-validated and
business-rule-checked (SKU exists, qty > 0, expiry sane) before it reaches the UI.

**Procedure index**: reuse `src/lib/help-content.ts` as the retrieval corpus (module + title +
body passed as candidate context), so no new documentation store is needed for v1.

**Side stores (copilot-owned, non-authoritative)** — new tables, RLS + grants per project rules:

- `copilot_conversations` / `copilot_messages` — one conversation per user per warehouse,
restartable; scoped to the owner.
- `copilot_tool_calls` — tool name, inputs (redacted), outcome, latency, for audit.
- `copilot_suggestions` — suggestion, whether it was accepted or rejected, for measuring value.
- `copilot_documents` — uploaded doc reference + OCR artifact + confidence, retained for review.

**Frontend**

- `src/features/copilot/` — `copilot-core.ts` (client calls, streaming, context assembly) and
`copilot-panel.tsx` (the side panel), plus a small `useCopilotContext()` hook that reports the
current screen and selection.
- Panel trigger added to the existing header and the mobile toolbar; nothing else in the shell moves.
- Inline hint chips inside Receiving, Putaway and Picking reuse the existing hint-button pattern
(`src/components/hint-button.tsx`) and the current `ai-assist.ts` statistical hints, so learned
pallet quantities and placements sit next to the copilot's answers.
- Document capture reuses the existing scan/camera components; the OCR draft opens the current
receiving draft form pre-filled, not a new flow.

**Existing pieces reused**: `ai-assist.ts` (pallet-qty / placement / velocity learning),
`container-number.ts` + `container-scanner-*` (code validation and region learning),
`help-content.ts`, the MCP scoped-read tools, and the audit/system-log RPCs.

## Build order

1. Tool layer + `copilot` edge function + context envelope, with audit logging. Read tools only.
2. Side panel UI, streaming answers with citations, procedure/how-to answers.
3. Inline hints in Receiving / Putaway / Picking wired to the same engine.
4. Document OCR -> receiving draft (review before commit).
5. Label / container code reading from camera.
6. Shift + manager summaries.

Voice is deliberately out of scope for now; the tool layer built in step 1 is what a later
push-to-talk mode would sit on top of.

## Out of scope for this build

Automatic actions, model-issued writes, inventory adjustments, purchase suggestions, and any
capability that would change WMS state without an explicit human confirmation.  
  
make a new draft of the website to test this feaure on separate to the public build. 