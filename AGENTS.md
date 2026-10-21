# AGENTS.md — Implementation Guardrails

<!-- LOVABLE:BEGIN -->
Microsoft OAuth uses the managed Lovable helper and a public login callback, separate from password/badge handlers, so existing profile, role, and approval guards remain authoritative.
<!-- LOVABLE:END -->

## Scope and UI
- Treat the established UI as intentional, not frozen. Make the narrow UI, data, handler, state, query, or backend changes needed for the user's request without extra approval solely because a rendered surface changes.
- Preserve existing shadcn primitives, semantic tokens (`src/index.css`, `tailwind.config.ts`), navigation, terminology, density, and workflow ergonomics. No new tokens unless asked; no broad redesign, restyling, copy rewrites, workflow reordering, unrelated refactors, formatting/import churn, or marketing-style operational screens.
- Prefer surgical edits. Explain a necessary broader rewrite before or during implementation. If backend work needs matching UI, make the narrowest usable change and mention it in the final response.
- Do not extend another agent's unrelated redesign; flag scope issues and focus on the current task. Clarify genuine ambiguity rather than guessing. These guardrails take precedence over generic design-improvement guidance.

## Data and compatibility
- Duplicate inbound receiving uses paginated warehouse-scoped drafts and original-receipt Put-Away links, rechecked before load and save; database-atomic enforcement remains separate from these client preflights.
- `supabase/migrations/**`: additive migrations only; never edit shipped files.
- `supabase/config.toml`: function-specific blocks only, never project-level settings.
- Never hand-edit auto-generated `.env`, `src/integrations/supabase/client.ts`, or `types.ts`.
- Business logic/helpers/content in `src/lib/wms-core.ts`, `enterprise-wms.ts`, and `help-content.ts` may evolve; keep exported shapes compatible unless coordinating a required change. Hooks may evolve while preserving return shapes for existing consumers.
- Backend work may include migrations, edge functions, RLS, seed data, and library logic; tests belong under `src/test/**`.

## Verification
- Keep changes limited to the goal and directly affected files; verify functionality before reporting completion.
- Use the harness build or project `npm run typecheck` according to the active environment's instructions. Bare `tsc --noEmit` covers nothing: root tsconfig has `files: []`; the project script targets app and service-worker configs.

## UI baseline history
- The full, unchanged historical approval log is in `docs/agent/UI_BASELINE_HISTORY.md`; read relevant entries before altering an established surface.
- Append a dated, one-line baseline entry there only when the user explicitly asks to record a UI baseline shift. Historical entries are not permission for unrelated changes.

## Releases
- On publishing a solid user-visible improvement, bump `package.json` version (`__APP_VERSION__`), update `RELEASE_HISTORY` (currently `src/lib/release-history.ts`, imported by App; drives Release Notes and What's New), and update affected Help topics together. Update the baseline log only when explicitly requested. No release bump for an internal refactor or unfinished fix.
- Patch numbering includes 10, then rolls: `1.28.9 -> 1.28.10 -> 1.29.0`; likewise `1.29.10 -> 1.30.0`. Minor rollover follows `1.9.x -> 1.10.x -> 2.0.0`.
