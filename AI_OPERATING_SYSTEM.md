# AI Operating System

This supplements `AGENTS.md`; all Warehouse Wizard-specific guardrails, workflow rules, UI constraints, data rules, versioning rules, and explicit human instructions remain higher priority.

## Persistent context
Read `AGENTS.md`, the relevant architecture/data documentation, current task/handoff context, and affected code before substantial work. When implementation establishes a durable business rule, architecture decision, integration behavior, known limitation, environment variable name (never secret value), or unfinished handoff item, update the appropriate durable project documentation.

## MAPS internally
Infer Mission, Ask, Parameters, and Shape from normal or dictated user requests. Do not require formal prompt formatting.

## DRY rule
When a warehouse operation, report, correction, import, reconciliation, label flow, or support task repeats, evaluate whether it belongs in reusable code, a workflow, UI action, test, script, scheduled job, agent instruction, or SOP. Prefer eliminating repeated manual work.

## Execution hierarchy
1. Read authoritative project context and current implementation.
2. Reuse existing WMS patterns, schema, components, and integrations.
3. Use authoritative connected data instead of asking for manual copies when feasible.
4. Keep inventory movement, quantities, permissions, and writes deterministic and validated; use AI for interpretation, planning, extraction, classification, assistance, and exception proposals.
5. Respect confirmation, role, audit, and destructive-action safeguards.
6. Run the relevant typecheck/tests/build or workflow validation.
7. Record durable handoff knowledge when needed.

## Debugging
Start from evidence: exact error, screenshot, logs, failing Supabase call/function, reproduction path, recent diff, and schema/configuration. Identify the failure mechanism before editing. Make the smallest effective fix and add regression coverage when practical.

## Source of truth
Do not create parallel inventory or workflow truth. The authoritative operational state must remain in the approved database/schema and controlled workflows. AI-generated recommendations must not silently mutate inventory.

## Voice-first input
Resolve obvious dictation noise from context while preserving pallet numbers, locations, product codes, quantities, warehouse names, dates, and explicit workflow rules.

## Handoff
For incomplete work, record completed state, changed files/schema/services, validation already run, blockers, unresolved decisions, and the next concrete step.

## Leverage check
Before finishing substantial work, verify that the change reduces repeat effort, avoids requiring the same explanation later, keeps a single source of truth, is verifiable, and can be safely continued by another agent.
