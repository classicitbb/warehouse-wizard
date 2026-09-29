create or replace function public.cancel_inventory_pallet_correction(in_draft_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  draft_row public.receipts%rowtype;
  meta jsonb;
  v_pallet_id uuid;
  v_balance_id uuid;
begin
  if auth.uid() is null or not public.has_min_role(auth.uid(), 'inventory_clerk') then
    raise exception 'Inventory pallet corrections require Receiving permission.';
  end if;
  select * into draft_row from public.receipts where id = in_draft_id for update;
  if not found then raise exception 'Correction draft was not found.'; end if;
  meta := coalesce(draft_row.notes::jsonb, '{}'::jsonb);
  if meta->>'source_type' <> 'inventory_pallet_correction' or draft_row.status <> 'draft' then
    raise exception 'This correction can no longer be cancelled.';
  end if;
  v_pallet_id := (meta->>'correction_source_pallet_id')::uuid;
  v_balance_id := (meta->>'correction_source_balance_id')::uuid;

  update public.pallets set
    correction_state = null,
    status = (meta->'original_pallet'->>'status')::public.inventory_status,
    quantity = (meta->'original_pallet'->>'quantity')::numeric,
    available_quantity = (meta->'original_pallet'->>'available_quantity')::numeric,
    is_stored = coalesce((meta->'original_pallet'->>'is_stored')::boolean, true),
    current_location_id = (meta->'original_pallet'->>'current_location_id')::uuid
    where id = v_pallet_id;

  update public.inventory_balances set
    correction_state = null,
    status = (meta->'original_balance'->>'status')::public.inventory_status,
    quantity = (meta->'original_balance'->>'quantity')::numeric,
    available_quantity = (meta->'original_balance'->>'available_quantity')::numeric,
    location_id = (meta->'original_balance'->>'location_id')::uuid,
    zone_id = (meta->'original_balance'->>'zone_id')::uuid
    where id = v_balance_id;

  update public.receipts set status = 'cancelled' where id = in_draft_id;

  insert into public.audit_events (event_type, entity_table, entity_id, warehouse_id, pallet_id, actor_user_id, metadata)
  select 'inventory_correction_cancelled', 'pallets', p.id, b.warehouse_id, p.id, auth.uid(), jsonb_build_object('draft_id', in_draft_id)
  from public.pallets p join public.inventory_balances b on b.pallet_id = p.id where p.id = v_pallet_id;
end;
$$;