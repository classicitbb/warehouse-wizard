# Plan: Silent activity for developer users

## Scope note on the pasted SQL

The pasted migration (`company_settings`, `docstudio_billing_documents`, `docstudio_billing_sequences`, `next_billing_number`, `copilot_workflow_settings`, `copilot_actions`) targets a **different project** — Doc Studio / Classic Visions billing. None of those tables or functions exist in this Warehouse Wizard database, and running it here would either fail or create billing machinery this app does not use. It is excluded from this plan. If it was meant for another Lovable project, it should be run there.

## What this plan does

From the Settings → Activity feedback: developer users' activity should not be logged — it should be silent.

### 1. Migration: skip logging for developers

Update `public.record_user_action_events(jsonb)` (security definer, already the single ingestion point for activity events):

- At the top, after the auth check, add an early return:
  ```sql
  if public.has_role(auth.uid(), 'developer') then
    return 0;
  end if;
  ```
- Returns `0` inserted, no exception — the client call succeeds silently, so the dev experience is unchanged and no errors surface.
- No policy or grant changes needed; the function signature and permissions stay identical.

### 2. Data cleanup: remove existing developer activity rows

Via run_sql (data operation, not schema):

- Delete `public.user_action_events` rows whose `user_id` belongs to a user with the `developer` role.
- Delete matching `public.user_habit_profiles` rows for those users so the Activity tab no longer shows historical dev stats.

### 3. Verification

- Run the habit-tracking and operator-feedback test suites.
- Confirm the Activity tab in Settings renders empty for a developer account and still logs for non-dev roles.

## Technical details

- Function touched: `public.record_user_action_events(jsonb)` — defined in `supabase/migrations/20260820120000_operator_feedback_tickets_and_habits.sql`; new migration will `create or replace` it.
- Role check uses the existing `public.has_role(uuid, text)` security-definer helper with role code `'developer'` — same pattern used by the other dev-gating triggers (`enforce_developer_approved`, `auto_approve_on_developer_role`).
- Silent-by-design: no UI banner, no system log entry for the skip (logging the skip would defeat the purpose).
- No version bump: internal telemetry change, not user-facing.
