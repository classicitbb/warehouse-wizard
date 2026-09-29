
create or replace function public.reconcile_location_occupancy(
  in_location_code text,
  in_apply boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_loc record;
  v_code text := upper(btrim(coalesce(in_location_code, '')));
  v_phantom_balances jsonb := '[]'::jsonb;
  v_phantom_pallets jsonb := '[]'::jsonb;
  v_balance_ids uuid[] := '{}';
  v_pallet_ids uuid[] := '{}';
  v_real_count integer := 0;
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if v_code = '' then
    raise exception 'A location code is required';
  end if;

  select l.id, l.code, l.warehouse_id, l.max_pallets
    into v_loc
  from public.locations l
  where upper(l.code) = v_code
  limit 1;

  if v_loc.id is null then
    raise exception 'Location % was not found', v_code;
  end if;

  if not public.can_access_warehouse(v_loc.warehouse_id) then
    raise exception 'You do not have access to this warehouse';
  end if;

  -- Stock rows that still claim the bay but whose pallet is gone, retired,
  -- superseded by a correction, or physically recorded somewhere else.
  select coalesce(jsonb_agg(jsonb_build_object(
           'balance_id', b.id,
           'pallet_barcode', p.pallet_barcode,
           'quantity', b.quantity,
           'reason', case
             when p.id is null then 'no pallet record'
             when p.status::text in ('shipped','in_transit','missing') then 'pallet ' || p.status::text
             when coalesce(p.correction_state,'') = 'superseded' then 'pallet superseded by a correction'
             else 'pallet recorded in another location'
           end)), '[]'::jsonb),
         coalesce(array_agg(b.id), '{}')
    into v_phantom_balances, v_balance_ids
  from public.inventory_balances b
  left join public.pallets p on p.id = b.pallet_id
  where b.location_id = v_loc.id
    and b.status::text not in ('shipped','in_transit','missing','receiving')
    and coalesce(b.correction_state,'') <> 'superseded'
    and b.quantity > 0
    and (
      p.id is null
      or p.status::text in ('shipped','in_transit','missing')
      or coalesce(p.correction_state,'') = 'superseded'
      or p.current_location_id is distinct from v_loc.id
    );

  -- Pallets parked on the location with no live stock behind them.
  select coalesce(jsonb_agg(jsonb_build_object(
           'pallet_id', p.id,
           'pallet_barcode', p.pallet_barcode,
           'quantity', p.quantity,
           'reason', 'no stock balance in this location')), '[]'::jsonb),
         coalesce(array_agg(p.id), '{}')
    into v_phantom_pallets, v_pallet_ids
  from public.pallets p
  where p.current_location_id = v_loc.id
    and p.status::text not in ('shipped','in_transit','missing','receiving')
    and coalesce(p.correction_state,'') <> 'superseded'
    and not exists (
      select 1 from public.inventory_balances b
      where b.pallet_id = p.id
        and b.location_id = v_loc.id
        and b.quantity > 0
        and coalesce(b.correction_state,'') <> 'superseded'
        and b.status::text not in ('shipped','in_transit','missing')
    );

  select count(*) into v_real_count
  from public.inventory_balances b
  join public.pallets p on p.id = b.pallet_id
  where b.location_id = v_loc.id
    and b.quantity > 0
    and coalesce(b.correction_state,'') <> 'superseded'
    and b.status::text not in ('shipped','in_transit','missing','receiving')
    and p.current_location_id = v_loc.id
    and p.status::text not in ('shipped','in_transit','missing')
    and coalesce(p.correction_state,'') <> 'superseded';

  if in_apply and (array_length(v_balance_ids, 1) > 0 or array_length(v_pallet_ids, 1) > 0) then
    foreach v_id in array v_balance_ids loop
      perform public.log_audit_event(
        'location_occupancy_cleared', 'inventory_balances', v_id, v_loc.warehouse_id,
        null, v_loc.id, null,
        jsonb_build_object('location_code', v_loc.code, 'source', 'reconcile_location_occupancy')
      );
    end loop;

    foreach v_id in array v_pallet_ids loop
      perform public.log_audit_event(
        'location_occupancy_cleared', 'pallets', v_id, v_loc.warehouse_id,
        v_id, v_loc.id, null,
        jsonb_build_object('location_code', v_loc.code, 'source', 'reconcile_location_occupancy')
      );
    end loop;

    update public.inventory_balances
       set status = 'missing', location_id = null, updated_at = now()
     where id = any(v_balance_ids);

    update public.pallets
       set status = 'missing', current_location_id = null, is_stored = false, updated_at = now()
     where id = any(v_pallet_ids);

    perform public.write_system_log(
      'inventory', 'warning',
      'Location occupancy cleared',
      format('%s stock record(s) with no physical pallet were cleared from %s. They are now listed as missing and can be recovered from Status.',
             coalesce(array_length(v_balance_ids,1),0) + coalesce(array_length(v_pallet_ids,1),0), v_loc.code),
      jsonb_build_object('location_code', v_loc.code, 'balances', v_phantom_balances, 'pallets', v_phantom_pallets),
      'location-occupancy-fix', 'locations',
      coalesce(array_length(v_balance_ids,1),0) + coalesce(array_length(v_pallet_ids,1),0)
    );
  end if;

  return jsonb_build_object(
    'location_id', v_loc.id,
    'location_code', v_loc.code,
    'max_pallets', v_loc.max_pallets,
    'stored_pallets', v_real_count,
    'applied', in_apply,
    'cleared', case when in_apply
      then coalesce(array_length(v_balance_ids,1),0) + coalesce(array_length(v_pallet_ids,1),0)
      else 0 end,
    'phantom_count', coalesce(array_length(v_balance_ids,1),0) + coalesce(array_length(v_pallet_ids,1),0),
    'phantom_balances', v_phantom_balances,
    'phantom_pallets', v_phantom_pallets
  );
end;
$$;

revoke all on function public.reconcile_location_occupancy(text, boolean) from public, anon;
grant execute on function public.reconcile_location_occupancy(text, boolean) to authenticated, service_role;
