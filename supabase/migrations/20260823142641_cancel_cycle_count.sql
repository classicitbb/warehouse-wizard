alter table public.cycle_counts
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancelled_by uuid references auth.users (id) on delete set null,
  add column if not exists cancellation_reason text;

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create or replace function private.assert_cycle_count_accepts_work()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status public.count_status;
  v_archived_at timestamptz;
begin
  if tg_table_name = 'inventory_freezes' and new.status <> 'active' then
    return new;
  end if;

  select count.status, count.archived_at
    into v_status, v_archived_at
  from public.cycle_counts as count
  where count.id = new.cycle_count_id
  for key share;

  if not found or v_archived_at is not null or v_status::text in ('closed', 'cancelled') then
    raise exception 'Cycle count no longer accepts new work or active freezes.'
      using errcode = '55000';
  end if;

  return new;
end;
$$;

revoke execute on function private.assert_cycle_count_accepts_work() from public, anon, authenticated;

drop trigger if exists cycle_count_lines_require_active_header on public.cycle_count_lines;
create trigger cycle_count_lines_require_active_header
  before insert or update of cycle_count_id
  on public.cycle_count_lines
  for each row execute function private.assert_cycle_count_accepts_work();

drop trigger if exists inventory_freezes_require_active_header on public.inventory_freezes;
create trigger inventory_freezes_require_active_header
  before insert or update of cycle_count_id, status
  on public.inventory_freezes
  for each row execute function private.assert_cycle_count_accepts_work();

create or replace function private.cancel_cycle_count(
  p_count_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_count public.cycle_counts%rowtype;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_cancelled_at timestamptz := timezone('utc', now());
  v_freezes_released integer := 0;
  v_claims_cleared integer := 0;
  v_adjustments_retained integer := 0;
begin
  if v_actor_id is null
    or not public.is_approved()
    or not public.has_min_role(v_actor_id, 'warehouse_manager')
  then
    raise exception 'Only an approved warehouse manager can cancel a cycle count.'
      using errcode = '42501';
  end if;

  if char_length(v_reason) < 4 then
    raise exception 'A cancellation reason of at least 4 characters is required.'
      using errcode = '22023';
  end if;
  if char_length(v_reason) > 500 then
    raise exception 'Cancellation reason must be 500 characters or fewer.'
      using errcode = '22023';
  end if;

  select cc.*
    into v_count
  from public.cycle_counts as cc
  where cc.id = p_count_id
  for update;

  if not found or not public.can_access_warehouse(v_count.warehouse_id) then
    raise exception 'Cycle count not found or outside your warehouse access.'
      using errcode = 'P0002';
  end if;

  if v_count.archived_at is not null then
    raise exception 'Archived cycle counts are immutable and cannot be cancelled.'
      using errcode = '22023';
  end if;

  if v_count.status::text not in ('draft', 'frozen', 'counting', 'review', 'approved') then
    raise exception 'Cycle count in % status cannot be cancelled.', v_count.status
      using errcode = '22023';
  end if;

  select count(*)::integer
    into v_adjustments_retained
  from public.cycle_count_lines as line
  where line.cycle_count_id = p_count_id
    and line.adjustment_id is not null;

  update public.inventory_balances as balance
  set available_quantity = coalesce(balance.available_quantity, 0) + coalesce(balance.held_quantity, 0),
      held_quantity = 0,
      updated_at = v_cancelled_at
  where balance.warehouse_id = v_count.warehouse_id
    and coalesce(balance.held_quantity, 0) > 0
    and exists (
      select 1
      from public.inventory_freezes as inv_freeze
      where inv_freeze.cycle_count_id = p_count_id
        and inv_freeze.status = 'active'
        and inv_freeze.location_id = balance.location_id
    );

  update public.pallets as pallet
  set available_quantity = coalesce(pallet.available_quantity, 0) + coalesce(pallet.held_quantity, 0),
      held_quantity = 0,
      updated_at = v_cancelled_at
  where coalesce(pallet.held_quantity, 0) > 0
    and exists (
      select 1
      from public.inventory_balances as balance
      join public.inventory_freezes as inv_freeze
        on inv_freeze.location_id = balance.location_id
       and inv_freeze.cycle_count_id = p_count_id
       and inv_freeze.status = 'active'
      where balance.pallet_id = pallet.id
        and balance.warehouse_id = v_count.warehouse_id
    );

  update public.inventory_freezes
  set status = 'released',
      released_at = v_cancelled_at,
      released_by = v_actor_id
  where cycle_count_id = p_count_id
    and status = 'active';
  get diagnostics v_freezes_released = row_count;

  update public.cycle_count_lines
  set claimed_by_user_id = null,
      claimed_at = null,
      claim_expires_at = null,
      updated_at = v_cancelled_at
  where cycle_count_id = p_count_id
    and (claimed_by_user_id is not null or claim_expires_at is not null);
  get diagnostics v_claims_cleared = row_count;

  update public.cycle_counts
  set status = 'cancelled',
      cancelled_at = v_cancelled_at,
      cancelled_by = v_actor_id,
      cancellation_reason = v_reason,
      notes = concat_ws(
        E'\n',
        nullif(notes, ''),
        'Cancelled by warehouse manager: ' || v_reason
      ),
      updated_at = v_cancelled_at
  where id = p_count_id;

  insert into public.audit_events (
    event_type,
    entity_table,
    entity_id,
    warehouse_id,
    actor_user_id,
    metadata
  ) values (
    'cycle_count_cancelled',
    'cycle_counts',
    p_count_id,
    v_count.warehouse_id,
    v_actor_id,
    jsonb_build_object(
      'count_number', v_count.count_number,
      'previous_status', v_count.status::text,
      'reason', v_reason,
      'freezes_released', v_freezes_released,
      'claims_cleared', v_claims_cleared,
      'adjustments_retained', v_adjustments_retained
    )
  );

  return jsonb_build_object(
    'count_id', p_count_id,
    'previous_status', v_count.status::text,
    'status', 'cancelled',
    'freezes_released', v_freezes_released,
    'claims_cleared', v_claims_cleared,
    'adjustments_retained', v_adjustments_retained,
    'cancelled_at', v_cancelled_at
  );
end;
$$;

revoke execute on function private.cancel_cycle_count(uuid, text) from public, anon;
grant execute on function private.cancel_cycle_count(uuid, text) to authenticated;

create or replace function public.cancel_cycle_count(
  p_count_id uuid,
  p_reason text
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.cancel_cycle_count(p_count_id, p_reason);
$$;

revoke execute on function public.cancel_cycle_count(uuid, text) from public, anon;
grant execute on function public.cancel_cycle_count(uuid, text) to authenticated;
