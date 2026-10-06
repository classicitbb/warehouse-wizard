# Warehouse Copilot: able-coworker conversation upgrade

## Goal
Make Copilot feel like an experienced warehouse coworker: fast, plain-spoken, curious, and willing to investigate. It will use short rapid exchanges, ask one useful question at a time, and give direct answers with evidence rather than long disclaimers.

“Less restrictions” will mean broader read-and-guide capability, not weaker data security. Copilot remains unable to alter inventory, tasks, users, or settings.

## Interaction behavior
- Answer immediately when the request is clear.
- When facts are missing, ask one brief, specific question and continue from the answer without losing earlier context.
- For advanced issues, switch into investigation mode: establish the symptom, inspect relevant records and recent events, test competing explanations, then distinguish confirmed evidence from likely causes.
- Keep routine replies short: result first, supporting record IDs second, next action last. Expand only when the operator asks or the issue is complex.
- Replace refusal-heavy language with useful alternatives: explain what Copilot can inspect, what it found, and the exact safe action the operator can take.
- Preserve complete conversation history so investigations do not repeat questions after a few turns.

## Broader read-and-guide tools
- Move the existing read tools into a segmented server-side registry with validated inputs, per-tool role requirements, warehouse/client scope, and audit logging.
- Add scoped read tools for the operational areas Copilot cannot currently investigate well: location moves, transfers, cycle counts, recent audit events, task history, and relevant system/email failures.
- Add a procedure-search tool so Copilot can deliberately retrieve the right Help content during a conversation instead of relying only on preselected excerpts.
- Keep all operational tools read-only. No generated SQL and no direct model access to the database.

## Advanced issue handoff to developers
When evidence indicates an advanced product or technical issue:
1. Copilot conducts a short investigation and gathers the relevant record IDs, screen, app version, recent actions, errors, screenshots, and log excerpts available to the operator.
2. It prepares a **Developer repair brief** containing: observed behavior, confirmed evidence, likely cause clearly labelled as a hypothesis, affected workflow, a suggested repair prompt, and acceptance tests.
3. It shows the brief to the operator and asks one yes/no confirmation before filing it. No silent submission.
4. On confirmation, the existing support ticket and developer email include the repair brief and evidence. The ticket remains the source of truth and the operator receives its number.

## Brisk streaming and conversation reliability
- Replace the current buffered, serial chat call with the Lovable AI Gateway Responses streaming flow using `openai/gpt-6-astra` at low reasoning for normal turns.
- Use the AI SDK’s streamed message format, full inline conversation history, gateway run-ID correlation, and the existing database-backed conversation threads.
- Stream the first useful text and tool activity into the panel instead of showing only “Checking the records…” until every lookup finishes.
- Run independent read lookups concurrently, remove the location-detail N+1 query, and deduplicate identical lookups within a request.
- Keep the Stop control active from the initial thinking state through tool use and streaming; preserve partial stopped answers in history.
- Surface the gateway’s safe error message for rate limits, credits, configuration, and service failures without blocking the underlying WMS workflow.

## Panel updates
- Preserve the current side-panel placement, history, dictation, ticket evidence, citations, and helpful/not-helpful feedback.
- Render streamed message parts and collapsed tool activity using the project-compatible AI chat primitives, while retaining the established Warehouse Wizard visual language.
- Change status copy to brief, specific stages such as “Checking pallet history” or “Comparing move records.”
- Keep citations visible and strengthen them from tool names alone to the exact pallet, SKU, location, receipt, pick-list, transfer, task, or event identifiers used.

## Safety and permissions
- Continue resolving identity, roles, warehouse, and client scope server-side and executing every read through caller-scoped policies.
- Keep operational writes unavailable. Ticket submission remains the only write and gains a hard operator-confirmation gate rather than relying only on prompt wording.
- Audit every lookup, investigation, suggested repair brief, approval, rejection, and submission.
- Treat record text, attachments, screenshots, OCR, and logs as untrusted evidence, never instructions.
- Copilot failure must never interrupt receiving, put-away, picking, moves, transfers, or dispatch.

## Verification
- Add conversational evaluations for clear questions, ambiguous questions, rapid troubleshooting, advanced-issue escalation, unsupported claims, and prompt injection inside record text.
- Test complete multi-turn history, two saved conversations and reload, streaming first response, stop before first text, stop during a lookup, and persistence of partial responses.
- Test every new read tool, cross-warehouse/client denial, citations, audit entries, and the hard confirmation requirement for developer handoff.
- Verify the repair brief reaches the support queue and developer email without changing warehouse data.
- Run the project typecheck, Copilot tests, relevant permission tests, and an authenticated end-to-end conversation against the live preview; update Help and release notes for the user-visible change.

## Technical details
- Main areas: `supabase/functions/copilot/`, a new shared Copilot tool registry under `supabase/functions/_shared/`, `src/features/copilot/`, Copilot tests, Help content, and release history.
- Use the current Classic edge-function boundary, server-held gateway key, Responses API provider options (`store: false`, reasoning summary, encrypted reasoning continuation), and gateway-issued run IDs.
- Keep the existing database-backed threaded conversation model; migrate stored/rendered messages to the AI SDK message-parts shape compatibly so existing chats remain readable.
