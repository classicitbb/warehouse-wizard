create or replace function public.save_inventory_pallet_correction_as_draft(
  in_draft_id uuid,
  in_quantity numeric default null,
  in_expiry_date date default null,
  in_expiry_provided boolean default false
)
returns table (draft_id uuid, draft_pallet_barcode text, quantity numeric, expiry_date date)
language plpgsql
security definer
set search_path = public
as $$
declare
  draft_row public.receipts%rowtype;
  meta jsonb;
  old_pallet public.pallets%rowtype;
  old_balance public.inventory_balances%rowtype;
  eff_quantity numeric;
  eff_expiry date;
  new_barcode text;
begin
  if auth.uid() is null or not public.has_min_role(auth.uid(), 'inventory_clerk') then
    raise exception 'Inventory pallet corrections require Receiving permission.';
  end if;

  select * into draft_row from public.receipts where id = in_draft_id for update;
  if not found then raise exception 'Correction draft was not found.'; end if;
  meta := coalesce(draft_row.notes::jsonb, '{}'::jsonb);
  if meta->>'source_type' <> 'inventory_pallet_correction' or draft_row.status <> 'draft' then
    raise exception 'This correction has already been completed or cancelled.';
  end if;

  select * into old_pallet from public.pallets where id = (meta->>'correction_source_pallet_id')::uuid for update;
  select * into old_balance from public.inventory_balances where id = (meta->>'correction_source_balance_id')::uuid for update;
  if old_pallet.correction_state <> 'pending' or old_balance.correction_state <> 'pending' then
    raise exception 'The original pallet is no longer reserved for this correction.';
  end if;
  if coalesce(old_balance.reserved_quantity, 0) > 0 or coalesce(old_pallet.reserved_quantity, 0) > 0 then
    raise exception 'Clear reserved or allocated stock before returning this pallet to Drafts.';
  end if;

  eff_quantity := coalesce(in_quantity, (meta->>'quantity')::numeric, old_balance.quantity, old_pallet.quantity);
  if coalesce(eff_quantity, 0) <= 0 then
    raise exception 'Quantity per pallet must be greater than zero.';
  end if;
  eff_expiry := case when in_expiry_provided then in_expiry_date else (meta->>'expiry_date')::date end;
  new_barcode := coalesce(meta->>'replacement_pallet_barcode', draft_row.draft_pallet_barcode, public.inventory_correction_code('PLT'));

  update public.pallets
    set correction_state = 'superseded', quantity = 0, available_quantity = 0, current_location_id = null, is_stored = false
    where id = old_pallet.id;
  update public.inventory_balances
    set correction_state = 'superseded', quantity = 0, available_quantity = 0, location_id = null, zone_id = null
    where id = old_balance.id;

  update public.receipts set
    status = 'draft',
    draft_pallet_barcode = new_barcode,
    notes = (meta || jsonb_build_object(
      '_draft', true,
      '_standalone_pallet', true,
      'entry_mode', 'pallet',
      'receipt_type', 'other',
      'source_type', 'inventory_pallet_edit_draft',
      'source_label', 'Pallet edit returned to drafts',
      'draft_pallet_barcode', new_barcode,
      'quantity', eff_quantity,
      'expiry_date', eff_expiry,
      'superseded_pallet_id', old_pallet.id,
      'superseded_pallet_barcode', old_pallet.pallet_barcode,
      'returned_to_drafts_at', now()
    ))::text
    where id = in_draft_id;

  insert into public.audit_events (event_type, entity_table, entity_id, warehouse_id, pallet_id, from_location_id, actor_user_id, metadata)
  values (
    'inventory_pallet_edit_returned_to_drafts', 'pallets', old_pallet.id, old_balance.warehouse_id, old_pallet.id,
    (meta->>'former_location_id')::uuid, auth.uid(),
    jsonb_build_object(
      'draft_id', in_draft_id,
      'superseded_pallet_barcode', old_pallet.pallet_barcode,
      'draft_pallet_barcode', new_barcode,
      'quantity', eff_quantity,
      'expiry_date', eff_expiry,
      'previous_quantity', old_pallet.quantity,
      'blank_edit', in_quantity is null and not in_expiry_provided
    )
  );

  return query select in_draft_id, new_barcode, eff_quantity, eff_expiry;
end;
$$;

revoke all on function public.save_inventory_pallet_correction_as_draft(uuid, numeric, date, boolean) from public, anon;
grant execute on function public.save_inventory_pallet_correction_as_draft(uuid, numeric, date, boolean) to authenticated;

create sequence if not exists public.operator_ticket_seq;

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

create or replace function public.operator_ticket_touch()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.updated_at := now();

  if new.status <> 'draft' and new.ticket_number is null then
    new.ticket_number := public.next_operator_ticket_number();
  end if;

  if tg_op = 'INSERT' then
    if new.status <> 'draft' and new.submitted_at is null then
      new.submitted_at := now();
    end if;
    if new.status <> 'draft' and coalesce(new.agent_brief, '') = '' then
      new.agent_brief := public.operator_ticket_fallback_brief(new);
    end if;
    return new;
  end if;

  if new.status is distinct from old.status then
    if old.status = 'draft' and new.status <> 'draft' and new.submitted_at is null then
      new.submitted_at := now();
    end if;
    if new.status in ('resolved', 'wont_fix') and new.resolved_at is null then
      new.resolved_at := now();
    end if;
    if new.status not in ('resolved', 'wont_fix') then
      new.resolved_at := null;
    end if;
  end if;

  if new.status <> 'draft' and coalesce(new.agent_brief, '') = '' then
    new.agent_brief := public.operator_ticket_fallback_brief(new);
  end if;

  return new;
end;
$$;

drop trigger if exists operator_tickets_touch on public.operator_tickets;
create trigger operator_tickets_touch
  before insert or update on public.operator_tickets
  for each row execute function public.operator_ticket_touch();

create or replace function public.operator_ticket_log_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.operator_ticket_events (ticket_id, actor_id, actor_kind, event, detail)
    values (new.id, auth.uid(), 'user', 'created',
            jsonb_build_object('status', new.status, 'kind', new.kind, 'severity', new.severity));
    return new;
  end if;

  if new.status is distinct from old.status then
    insert into public.operator_ticket_events (ticket_id, actor_id, actor_kind, event, detail)
    values (new.id, auth.uid(), 'user', 'status_changed',
            jsonb_build_object('from', old.status, 'to', new.status));
  end if;

  if new.assigned_to is distinct from old.assigned_to then
    insert into public.operator_ticket_events (ticket_id, actor_id, actor_kind, event, detail)
    values (new.id, auth.uid(), 'user', 'assigned',
            jsonb_build_object('assigned_to', new.assigned_to));
  end if;

  return new;
end;
$$;

drop trigger if exists operator_tickets_log_status on public.operator_tickets;
create trigger operator_tickets_log_status
  after insert or update on public.operator_tickets
  for each row execute function public.operator_ticket_log_status();

grant usage on sequence public.operator_ticket_seq to authenticated, service_role;
revoke execute on function public.next_operator_ticket_number() from anon, public;
grant execute on function public.next_operator_ticket_number() to authenticated, service_role;

create table if not exists public.user_action_events (
  id bigserial primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  warehouse_id uuid references public.warehouses(id) on delete set null,
  route text not null default '',
  action text not null,
  target text,
  outcome text not null default 'ok' check (outcome in ('ok', 'error', 'abandoned')),
  duration_ms integer check (duration_ms is null or duration_ms >= 0),
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);

create index if not exists user_action_events_user_idx
  on public.user_action_events (user_id, occurred_at desc);
create index if not exists user_action_events_action_idx
  on public.user_action_events (action, occurred_at desc);
create index if not exists user_action_events_outcome_idx
  on public.user_action_events (outcome, occurred_at desc) where outcome <> 'ok';

create table if not exists public.user_habit_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  warehouse_id uuid references public.warehouses(id) on delete set null,
  top_routes jsonb not null default '[]'::jsonb,
  top_actions jsonb not null default '[]'::jsonb,
  friction_points jsonb not null default '[]'::jsonb,
  active_hours jsonb not null default '[]'::jsonb,
  sample_size integer not null default 0,
  window_days integer not null default 30,
  updated_at timestamptz not null default now()
);

grant select, insert on public.user_action_events to authenticated;
grant select on public.user_habit_profiles to authenticated;
grant all on public.user_action_events to service_role;
grant all on public.user_habit_profiles to service_role;

alter table public.user_action_events enable row level security;
alter table public.user_habit_profiles enable row level security;

drop policy if exists "user action events own" on public.user_action_events;
create policy "user action events own"
  on public.user_action_events for select to authenticated
  using (
    user_id = auth.uid()
    or (
      public.has_min_role(auth.uid(), 'warehouse_manager')
      and public.can_access_warehouse(warehouse_id)
    )
  );

drop policy if exists "user action events insert own" on public.user_action_events;
create policy "user action events insert own"
  on public.user_action_events for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists "user habit profiles read" on public.user_habit_profiles;
create policy "user habit profiles read"
  on public.user_habit_profiles for select to authenticated
  using (
    user_id = auth.uid()
    or (
      public.has_min_role(auth.uid(), 'warehouse_manager')
      and public.can_access_warehouse(warehouse_id)
    )
  );

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

create or replace function public.refresh_user_habit_profile(in_user_id uuid default null, in_window_days integer default 30)
returns public.user_habit_profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  target_id uuid := coalesce(in_user_id, auth.uid());
  v_window_days integer := greatest(1, least(365, coalesce(in_window_days, 30)));
  cutoff timestamptz;
  result public.user_habit_profiles;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if target_id <> auth.uid() and not public.has_min_role(auth.uid(), 'warehouse_manager') then
    raise exception 'Only a warehouse manager can refresh another user''s habit profile.';
  end if;

  cutoff := now() - make_interval(days => v_window_days);

  insert into public.user_habit_profiles as p (
    user_id, warehouse_id, top_routes, top_actions, friction_points, active_hours,
    sample_size, window_days, updated_at
  )
  select
    target_id,
    (select e.warehouse_id from public.user_action_events e
      where e.user_id = target_id and e.occurred_at >= cutoff and e.warehouse_id is not null
      group by e.warehouse_id order by count(*) desc limit 1),
    coalesce((
      select jsonb_agg(row_to_json(r)) from (
        select e.route, count(*)::int as count
        from public.user_action_events e
        where e.user_id = target_id and e.occurred_at >= cutoff and e.route <> ''
        group by e.route order by count(*) desc limit 10
      ) r
    ), '[]'::jsonb),
    coalesce((
      select jsonb_agg(row_to_json(r)) from (
        select e.action, count(*)::int as count
        from public.user_action_events e
        where e.user_id = target_id and e.occurred_at >= cutoff
        group by e.action order by count(*) desc limit 10
      ) r
    ), '[]'::jsonb),
    coalesce((
      select jsonb_agg(row_to_json(r)) from (
        select
          e.action,
          e.route,
          count(*) filter (where e.outcome = 'error')::int as errors,
          count(*)::int as attempts,
          round((count(*) filter (where e.outcome = 'error'))::numeric / nullif(count(*), 0), 3) as error_rate
        from public.user_action_events e
        where e.user_id = target_id and e.occurred_at >= cutoff
        group by e.action, e.route
        having count(*) filter (where e.outcome = 'error') > 0
        order by count(*) filter (where e.outcome = 'error') desc, count(*) desc
        limit 10
      ) r
    ), '[]'::jsonb),
    coalesce((
      select jsonb_agg(row_to_json(r)) from (
        select extract(hour from e.occurred_at at time zone 'UTC')::int as hour, count(*)::int as count
        from public.user_action_events e
        where e.user_id = target_id and e.occurred_at >= cutoff
        group by 1 order by count(*) desc limit 24
      ) r
    ), '[]'::jsonb),
    (select count(*)::int from public.user_action_events e
      where e.user_id = target_id and e.occurred_at >= cutoff),
    v_window_days,
    now()
  on conflict (user_id) do update set
    warehouse_id = excluded.warehouse_id,
    top_routes = excluded.top_routes,
    top_actions = excluded.top_actions,
    friction_points = excluded.friction_points,
    active_hours = excluded.active_hours,
    sample_size = excluded.sample_size,
    window_days = excluded.window_days,
    updated_at = excluded.updated_at
  returning p.* into result;

  return result;
end;
$$;

revoke execute on function public.record_user_action_events(jsonb) from anon, public;
revoke execute on function public.refresh_user_habit_profile(uuid, integer) from anon, public;
grant execute on function public.record_user_action_events(jsonb) to authenticated;
grant execute on function public.refresh_user_habit_profile(uuid, integer) to authenticated;

create or replace view public.operator_ticket_queue
with (security_invoker = true)
as
select
  t.id,
  t.ticket_number,
  t.kind,
  t.status,
  t.severity,
  t.title,
  t.summary,
  t.steps_to_reproduce,
  t.expected_behavior,
  t.actual_behavior,
  t.route,
  t.module,
  t.app_version,
  t.labels,
  t.agent_brief,
  t.warehouse_id,
  t.reported_by,
  t.assigned_to,
  t.submitted_at,
  t.created_at,
  t.updated_at,
  (select count(*) from public.operator_ticket_events e where e.ticket_id = t.id) as event_count
from public.operator_tickets t
where t.status in ('open', 'triaged', 'in_progress')
order by
  case t.severity when 'critical' then 0 when 'high' then 1 when 'normal' then 2 else 3 end,
  t.submitted_at desc nulls last;

grant select on public.operator_ticket_queue to authenticated, service_role;