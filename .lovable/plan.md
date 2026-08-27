# Plan: Silence dev-user activity logging

Developer users stop generating activity records; everything else stays the same.

## Changes

### 1. Migration: guard the event-ingestion function

`create or replace` `public.record_user_action_events(jsonb)` with one addition right after the auth check:

```sql
-- Developer activity is silent: accept the call but record nothing.
if public.has_role(auth.uid(), 'developer') then
  return 0;
end if;
```

- The call succeeds and returns `0` inserted — no error, no UI change, completely silent.
- Role check uses the existing `has_role(uuid, text)` helper (verified: it matches `roles.code = 'developer'`; 1 developer user exists).
- All other roles keep logging as before. No table, policy, or grant changes.

### 2. Data cleanup (run_sql, not schema)

- Delete existing `user_action_events` rows belonging to users with the developer role.
- Delete those users' `user_habit_profiles` rows so the Settings → Activity tab no longer shows historical dev stats.

### 3. Verification

- Run the habit-tracking and operator-feedback tests.
- Confirm Activity tab is empty for the dev account and still records for other roles.

No version bump — internal telemetry change only.
