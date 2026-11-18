-- Cancelling a draft that was split off an edited Put-Away return no longer marks the
-- original (held/superseded) pallet missing; only the draft that owns it retires it.
-- Forward-only: create or replace, same signature and behaviour otherwise.

create or replace function public.cancel_receiving_draft(in_draft_id uuid, in_reason text default 'Receiving draft cancelled')
returns void
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  receipt_row public.receipts%rowtype;
  receipt_meta jsonb;
  v_pallet_id uuid;
begin
  if auth.uid() is null or not public.has_min_role(auth.uid(), 'inventory_clerk') then
    raise exception 'Cancelling a Receiving draft requires Receiving permission.';
  end if;
  select * into receipt_row from public.receipts where id = in_draft_id for update;
  if not found or receipt_row.status not in ('draft', 'queued') then raise exception 'This Receiving draft is no longer available.'; end if;
  if not public.can_access_warehouse(receipt_row.warehouse_id) then raise exception 'You do not have access to this warehouse.'; end if;
  receipt_meta := coalesce(nullif(receipt_row.notes, '')::jsonb, '{}'::jsonb);
  v_pallet_id := nullif(receipt_meta->>'returned_pallet_id', '')::uuid;
  -- A Put-Away return holds the old pallet as 'pending' under a brand-new draft number.
  -- A draft split off an edited draft (split_from_draft_id) shares the source reference but
  -- never owns the held pallet, so cancelling it must not retire that pallet.
  if v_pallet_id is null and receipt_meta->>'source_type' = 'putaway_returned'
     and not (receipt_meta ? 'split_from_draft_id') then
    v_pallet_id := nullif(receipt_meta->>'superseded_pallet_id', '')::uuid;
  end if;

  if v_pallet_id is not null then
    perform 1 from public.pallets where id = v_pallet_id for update;
    if not found then raise exception 'The pallet linked to this returned draft no longer exists.'; end if;
    update public.pallets set status = 'missing', correction_state = null, current_location_id = null, is_stored = false, available_quantity = 0 where id = v_pallet_id;
    update public.inventory_balances set status = 'missing', correction_state = null, location_id = null, zone_id = null, available_quantity = 0 where pallet_id = v_pallet_id;
  end if;

  update public.receipts set status = 'cancelled' where id = receipt_row.id;
  insert into public.audit_events (event_type, entity_table, entity_id, warehouse_id, pallet_id, actor_user_id, metadata)
  values ('receiving_draft_cancelled', 'receipts', receipt_row.id, receipt_row.warehouse_id, v_pallet_id, auth.uid(),
    jsonb_build_object('reason', nullif(trim(in_reason), ''), 'retired_linked_pallet', v_pallet_id is not null));
end;
$$;