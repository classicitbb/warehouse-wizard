-- Functions that RETURN TABLE(...) expose their output column names as
-- PL/pgSQL variables.  Where an output name matches a real table column
-- (pallet_id, pallet_barcode, location_id, quantity, ...) any bare reference
-- inside the body raises 42702 "column reference is ambiguous", which broke
-- receiving label confirmation.  Recreate each affected function with the
-- plpgsql `#variable_conflict use_column` directive so bare references always
-- resolve to the table column.  Bodies are otherwise untouched.
DO $do$
DECLARE
  sig text;
  def text;
  patched text;
BEGIN
  FOREACH sig IN ARRAY ARRAY[
    'public.confirm_receiving_draft_labels_printed(uuid)',
    'public.return_putaway_to_receiving_draft(uuid)',
    'public.save_inventory_pallet_correction_as_draft(uuid,numeric,date,boolean)',
    'public.begin_inventory_pallet_correction(uuid)',
    'public.complete_inventory_pallet_correction(uuid,numeric,date,boolean)',
    'public.complete_inventory_pallet_correction_in_place(uuid,numeric)',
    'public.recover_missing_pallet_to_putaway(uuid)',
    'public.recover_missing_pallet_to_draft(uuid,numeric)'
  ] LOOP
    def := pg_get_functiondef(sig::regprocedure);
    IF position('#variable_conflict' in def) > 0 OR position('LANGUAGE plpgsql' in def) = 0 THEN
      CONTINUE;
    END IF;
    patched := regexp_replace(
      def,
      'AS \$function\$',
      E'AS $function$\n#variable_conflict use_column',
      ''
    );
    IF patched = def THEN
      RAISE EXCEPTION 'Could not patch function %', sig;
    END IF;
    EXECUTE patched;
  END LOOP;
END
$do$;