create or replace function public.record_user_action_events(in_events jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  inserted integer := 0;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  -- Developer activity is silent: accept the call but record nothing.
  if public.has_role(auth.uid(), 'developer') then
    return 0;
  end if;
  if in_events is null or jsonb_typeof(in_events) <> 'array' then
    return 0;
  end if;

  insert into public.user_action_events (user_id, warehouse_id, route, action, target, outcome, duration_ms, metadata, occurred_at)
  select
    auth.uid(),
    nullif(event ->> 'warehouse_id', '')::uuid,
    coalesce(left(event ->> 'route', 200), ''),
    left(event ->> 'action', 120),
    left(nullif(event ->> 'target', ''), 200),
    case when event ->> 'outcome' in ('ok', 'error', 'abandoned') then event ->> 'outcome' else 'ok' end,
    greatest(0, least(3600000, (nullif(event ->> 'duration_ms', ''))::integer)),
    case when jsonb_typeof(event -> 'metadata') = 'object' then event -> 'metadata' else '{}'::jsonb end,
    coalesce((nullif(event ->> 'occurred_at', ''))::timestamptz, now())
  from jsonb_array_elements(in_events) as event
  where coalesce(event ->> 'action', '') <> ''
  limit 200;

  get diagnostics inserted = row_count;
  return inserted;
end;
$$;