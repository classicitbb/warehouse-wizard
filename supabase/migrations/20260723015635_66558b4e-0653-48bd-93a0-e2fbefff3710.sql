
CREATE OR REPLACE FUNCTION public.get_deployment_licence()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  row_json jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_approved() THEN
    RETURN NULL;
  END IF;

  SELECT to_jsonb(ds)
    INTO row_json
    FROM public.deployment_subscription ds
   WHERE ds.is_active = true
   ORDER BY ds.created_at DESC
   LIMIT 1;

  IF row_json IS NULL THEN
    RETURN NULL;
  END IF;

  IF public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'developer') THEN
    RETURN row_json;
  END IF;

  RETURN row_json - 'licence_key' - 'notes';
END;
$$;

CREATE OR REPLACE FUNCTION public.log_audit_event(
  in_event_type       text,
  in_entity_table     text,
  in_entity_id        uuid,
  in_warehouse_id     uuid DEFAULT NULL,
  in_pallet_id        uuid DEFAULT NULL,
  in_from_location_id uuid DEFAULT NULL,
  in_to_location_id   uuid DEFAULT NULL,
  in_metadata         jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE new_id uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_approved() THEN
    RAISE EXCEPTION 'Not authorized to write audit events';
  END IF;

  IF in_warehouse_id IS NOT NULL AND NOT public.can_access_warehouse(in_warehouse_id) THEN
    RAISE EXCEPTION 'Not authorized for this warehouse';
  END IF;

  INSERT INTO public.audit_events (
    event_type, entity_table, entity_id, warehouse_id,
    pallet_id, from_location_id, to_location_id, actor_user_id, metadata
  )
  VALUES (
    in_event_type, in_entity_table, in_entity_id, in_warehouse_id,
    in_pallet_id, in_from_location_id, in_to_location_id, auth.uid(), in_metadata
  )
  RETURNING id INTO new_id;
  RETURN new_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_location_level_style()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE zone_conflict integer; bay_conflict integer;
BEGIN
  SELECT count(*) INTO zone_conflict FROM public.locations l
   WHERE l.zone_id = new.zone_id AND l.id <> new.id
     AND coalesce(l.level_style, 'numeric') <> coalesce(new.level_style, 'numeric');
  IF zone_conflict > 0 THEN
    RAISE EXCEPTION 'Level style "%" conflicts with existing locations in this zone; a zone must use one level style.', new.level_style USING errcode = '23514';
  END IF;
  SELECT count(*) INTO bay_conflict FROM public.locations l
   WHERE l.warehouse_id = new.warehouse_id
     AND l.aisle IS NOT DISTINCT FROM new.aisle
     AND l.bay   IS NOT DISTINCT FROM new.bay
     AND l.id <> new.id
     AND coalesce(l.level_style, 'numeric') <> coalesce(new.level_style, 'numeric');
  IF bay_conflict > 0 THEN
    RAISE EXCEPTION 'Level style "%" conflicts with existing locations in this bay; a bay must use one level style.', new.level_style USING errcode = '23514';
  END IF;
  RETURN new;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.refresh_reorder_alert_from_settings() FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.refresh_reorder_alert_from_product()  FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.refresh_reorder_alert_from_balance()  FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.compute_cycle_count_line_variance()   FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.email_queue_wake()                    FROM anon, PUBLIC, authenticated;

DROP POLICY IF EXISTS "Developers manage external_record_links" ON public.external_record_links;
CREATE POLICY "Developers manage external_record_links"
  ON public.external_record_links
  FOR ALL
  TO authenticated
  USING (public.has_any_role(ARRAY['developer'::public.app_role_code]))
  WITH CHECK (public.has_any_role(ARRAY['developer'::public.app_role_code]));

DROP POLICY IF EXISTS "profiles users update own row" ON public.profiles;
DROP POLICY IF EXISTS "profiles self update"          ON public.profiles;

CREATE POLICY "profiles self update"
  ON public.profiles
  FOR UPDATE
  TO authenticated
  USING (id = auth.uid())
  WITH CHECK (
    id = auth.uid()
    AND (
      public.has_role(auth.uid(), 'admin')
      OR public.has_role(auth.uid(), 'developer')
      OR (
        approved IS NOT DISTINCT FROM (SELECT p.approved FROM public.profiles p WHERE p.id = auth.uid())
        AND active   IS NOT DISTINCT FROM (SELECT p.active   FROM public.profiles p WHERE p.id = auth.uid())
      )
    )
  );

DROP POLICY IF EXISTS "Public read email-assets" ON storage.objects;
CREATE POLICY "Public read email-assets"
  ON storage.objects
  FOR SELECT
  USING (
    bucket_id = 'email-assets'
    AND name IS NOT NULL
    AND coalesce((storage.foldername(name))[1], '') = 'public'
  );
