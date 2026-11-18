create or replace function public.claim_notification_dispatch(
  in_event_id uuid,
  in_debounce_seconds integer default 4,
  in_claim_ttl_seconds integer default 120
)
returns table (
  event_ids uuid[],
  kind text,
  group_key text,
  warehouse_id uuid,
  payload jsonb,
  event_count integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_seed public.notification_events;
  v_newest timestamptz;
  v_claimed uuid[];
begin
  select * into v_seed from public.notification_events where id = in_event_id;
  if not found or v_seed.push_dispatched_at is not null then
    return;
  end if;

  if v_seed.group_key is not null then
    select max(ne.created_at) into v_newest
      from public.notification_events ne
     where ne.group_key = v_seed.group_key
       and ne.push_dispatched_at is null;

    if v_newest > now() - make_interval(secs => in_debounce_seconds) then
      return;
    end if;
  end if;

  with claimed_rows as (
    update public.notification_events e
       set push_claimed_at = now(),
           push_claimed_by = auth.uid()
     where e.push_dispatched_at is null
       and (e.push_claimed_at is null
             or e.push_claimed_at < now() - make_interval(secs => in_claim_ttl_seconds))
       and (
         (v_seed.group_key is null and e.id = v_seed.id)
         or (v_seed.group_key is not null and e.group_key = v_seed.group_key)
       )
    returning e.id
  )
  select array_agg(cr.id) into v_claimed from claimed_rows cr;

  if v_claimed is null or array_length(v_claimed, 1) is null then
    return;
  end if;

  return query
  select
    v_claimed,
    v_seed.kind,
    v_seed.group_key,
    v_seed.warehouse_id,
    v_seed.payload,
    array_length(v_claimed, 1);
end;
$$;

revoke execute on function public.claim_notification_dispatch(uuid, integer, integer) from public, anon, authenticated;
grant execute on function public.claim_notification_dispatch(uuid, integer, integer) to service_role;