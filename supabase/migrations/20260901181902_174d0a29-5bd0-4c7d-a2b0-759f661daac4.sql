create or replace function public._patch_function_body(
  in_signature text, in_search text, in_replace text, in_min_hits integer default 1
) returns void
language plpgsql
as $$
declare
  v_def text;
  v_new text;
  v_hits integer;
begin
  select pg_get_functiondef(in_signature::regprocedure) into v_def;
  v_hits := (length(v_def) - length(replace(v_def, in_search, ''))) / greatest(length(in_search), 1);
  if v_hits < in_min_hits then
    raise exception 'Patch pattern % not found in % (hits: %)', in_search, in_signature, v_hits;
  end if;
  v_new := replace(v_def, in_search, in_replace);
  execute v_new;
end;
$$;

do $$
begin
  perform public._patch_function_body(
    'public.confirm_receiving_draft_labels_printed(uuid)',
    'v_quantity, 0, ''receiving'', false,', 'v_quantity, 0, ''putaway'', false,');
  perform public._patch_function_body(
    'public.confirm_receiving_draft_labels_printed(uuid)',
    'available_quantity = 0, status = ''receiving'', is_stored = false',
    'available_quantity = 0, status = ''putaway'', is_stored = false');
  perform public._patch_function_body(
    'public.confirm_receiving_draft_labels_printed(uuid)',
    '''receiving'', v_quantity, 0, lot_row.expiry_date', '''putaway'', v_quantity, 0, lot_row.expiry_date');
  perform public._patch_function_body(
    'public.confirm_receiving_draft_labels_printed(uuid)',
    'inventory_lot_id = v_lot_id, status = ''receiving'',', 'inventory_lot_id = v_lot_id, status = ''putaway'',');

  perform public._patch_function_body(
    'public.recover_missing_pallet_to_putaway(uuid)',
    'status = ''receiving'',', 'status = ''putaway'',', 2);

  perform public._patch_function_body(
    'public.begin_inventory_pallet_correction(uuid)',
    'balance_row.status = ''receiving'' and', 'balance_row.status in (''receiving'', ''putaway'') and');
  perform public._patch_function_body(
    'public.complete_inventory_pallet_correction_in_place(uuid, numeric)',
    'old_balance.status = ''receiving'' and', 'old_balance.status in (''receiving'', ''putaway'') and');

  perform public._patch_function_body(
    'public.complete_inventory_pallet_correction(uuid, numeric, date, boolean)',
    'else ''receiving''::public.inventory_status end', 'else ''putaway''::public.inventory_status end', 2);

  perform public._patch_function_body(
    'public.reconcile_location_occupancy(text, boolean)',
    ',''receiving'')', ',''receiving'',''putaway'')', 3);
end;
$$;

drop function public._patch_function_body(text, text, text, integer);