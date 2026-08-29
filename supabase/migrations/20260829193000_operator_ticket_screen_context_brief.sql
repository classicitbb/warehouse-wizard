-- Operator reports opened from the life buoy now carry what was on screen —
-- the selected product, the quantities that were typed, and the receiving
-- session behind them — plus any screenshot or log excerpt the reporter added.
-- Both live in `telemetry`, so the fallback brief has to read them or an agent
-- picking the ticket up never sees them.

create or replace function public.operator_ticket_fallback_brief(t public.operator_tickets)
returns text
language sql
stable
set search_path = public
as $$
  select concat_ws(E'\n',
    '# ' || coalesce(nullif(t.title, ''), 'Untitled operator report'),
    '',
    format('**Kind:** %s  |  **Severity:** %s  |  **Module:** %s', t.kind, t.severity, coalesce(t.module, 'unknown')),
    format('**Screen:** `%s`  |  **App version:** %s', coalesce(t.route, 'unknown'), coalesce(t.app_version, 'unknown')),
    format('**Filed:** %s', to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SSOF')),
    '',
    case when coalesce(t.actual_behavior, '') <> ''
      then E'## What happened\n\n' || t.actual_behavior || E'\n' end,
    case when coalesce(t.expected_behavior, '') <> ''
      then E'## What should happen\n\n' || t.expected_behavior || E'\n' end,
    case when coalesce(t.steps_to_reproduce, '') <> ''
      then E'## Steps to reproduce\n\n' || t.steps_to_reproduce || E'\n' end,
    case when coalesce(t.summary, '') <> ''
      then E'## Detail\n\n' || t.summary || E'\n' end,
    case when jsonb_typeof(t.telemetry -> 'screenContext') = 'object' then
      E'## What was on screen\n\n'
      || format(E'Screen: %s\n', coalesce(t.telemetry -> 'screenContext' ->> 'screen', 'unknown'))
      || coalesce((
           select string_agg(format('- %s: %s', d ->> 'label', d ->> 'value'), E'\n')
             from jsonb_array_elements(
                    case when jsonb_typeof(t.telemetry -> 'screenContext' -> 'details') = 'array'
                      then t.telemetry -> 'screenContext' -> 'details'
                      else '[]'::jsonb end
                  ) as d
         ), '')
      || E'\n'
    end,
    case when jsonb_typeof(t.telemetry -> 'attachments') = 'array'
              and jsonb_array_length(t.telemetry -> 'attachments') > 0 then
      E'## Attachments\n\n'
      || coalesce((
           select string_agg(
                    case when a ->> 'kind' = 'screenshot'
                      then format('- Screenshot (%s) — `%s`', coalesce(a ->> 'source', 'operator'), coalesce(a ->> 'path', 'no path'))
                      else format(E'- Log excerpt (%s)\n\n```\n%s\n```',
                                  coalesce(a ->> 'name', 'pasted by the reporter'),
                                  coalesce(a ->> 'excerpt', ''))
                    end,
                    E'\n'
                  )
             from jsonb_array_elements(t.telemetry -> 'attachments') as a
         ), '')
      || E'\n'
    end,
    case when jsonb_array_length(coalesce(t.clarifications, '[]'::jsonb)) > 0 then
      E'## Clarifying exchange\n\n' || (
        select string_agg(
          format('- **%s** — %s' || E'\n  > %s', c ->> 'field', c ->> 'question', c ->> 'answer'),
          E'\n'
        )
        from jsonb_array_elements(t.clarifications) as c
      ) || E'\n'
    end,
    E'## Ground rules for the repair\n',
    '- Read `AGENTS.md` first; keep the diff scoped to this report.',
    '- `supabase/migrations/**` is additive only — never edit an existing migration.',
    '- Add or update a test under `src/test/**` that fails before the fix and passes after.',
    ''
  );
$$;
