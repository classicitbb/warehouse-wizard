-- Update reset_wms_data to include all enterprise WMS tables added after the original migration.
-- The original TRUNCATE CASCADE should handle FK-linked tables, but explicitly listing them
-- guarantees non-FK tables (integration_connections, ai_recommendations, etc.) are cleared too.

create or replace function public.reset_wms_data()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.has_role(auth.uid(), 'admin') then
    raise exception 'Only admins can reset the WMS environment';
  end if;

  update public.profiles
  set default_warehouse_id = null
  where default_warehouse_id is not null;

  update public.user_roles
  set warehouse_id = null,
      is_hidden = false,
      hidden_at = null,
      hidden_reason = null;

  -- Enterprise WMS extension tables (no FK to core tables – must be cleared explicitly)
  truncate table
    public.ai_recommendations,
    public.integration_payload_logs,
    public.integration_dead_letters,
    public.integration_sync_jobs,
    public.external_record_links,
    public.integration_connections,
    public.report_exports,
    public.report_definitions,
    public.print_jobs,
    public.label_templates,
    public.printer_stations,
    public.work_templates
  restart identity cascade;

  -- Core operational tables in safe dependency order; CASCADE handles any remaining FKs
  truncate table
    public.audit_events,
    public.barcode_labels,
    public.stock_adjustments,
    public.cycle_count_lines,
    public.cycle_counts,
    public.staging_loads,
    public.dock_appointments,
    public.replenishment_tasks,
    public.quality_inspections,
    public.return_authorizations,
    public.transfer_lines,
    public.transfers,
    public.pick_tasks,
    public.pick_lists,
    public.order_lines,
    public.orders,
    public.move_tasks,
    public.putaway_tasks,
    public.inventory_balances,
    public.pallets,
    public.receipt_lines,
    public.receipts,
    public.inventory_lots,
    public.product_packaging_profiles,
    public.products,
    public.clients,
    public.locations,
    public.zones,
    public.warehouses
  restart identity cascade;

  return jsonb_build_object(
    'status', 'ok',
    'message', 'Warehouse data reset complete. Launch the setup wizard to rebuild the environment.'
  );
end;
$$;

-- Drop the guard that prevents re-running the setup wizard when warehouses already exist.
-- Instead we upsert (on conflict do update) so the wizard is idempotent.
-- This also means Reset All is no longer a hard prerequisite – the wizard can overwrite
-- existing structure when the user explicitly clicks "Create".

create or replace function public.run_warehouse_setup(setup_payload jsonb, seed_mode text default 'starter_ops')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_user uuid := auth.uid();
  warehouse_item jsonb;
  zone_item jsonb;
  template_item jsonb;
  warehouse_row record;
  starter_client record;
  warehouse_id uuid;
  zone_id uuid;
  source_warehouse_id uuid;
  destination_warehouse_id uuid;
  staging_location_id uuid;
  dispatch_location_id uuid;
  storage_location_id uuid;
  receiving_location_id uuid;
  cool_location_id uuid;
  client_id uuid;
  product_id uuid;
  packaging_profile_id uuid;
  receipt_id uuid;
  receipt_line_id uuid;
  pallet_id uuid;
  pick_order_id uuid;
  pick_list_id uuid;
  transfer_id uuid;
  cycle_count_id uuid;
  generated_locations integer := 0;
  warehouses_created integer := 0;
  zones_created integer := 0;
  letter_index integer;
  bay_index integer;
  level_index integer;
  aisle_code text;
  location_code text;
begin
  if actor_user is null or not public.has_role(actor_user, 'admin') then
    raise exception 'Only admins can run warehouse setup';
  end if;

  -- Warehouses: upsert on code so the wizard is idempotent (no hard dependency on Reset All)
  for warehouse_item in
    select value from jsonb_array_elements(coalesce(setup_payload -> 'warehouses', '[]'::jsonb))
  loop
    insert into public.warehouses (
      code,
      name,
      city,
      country,
      has_cool_zone,
      active,
      created_by
    )
    values (
      upper(trim(warehouse_item ->> 'code')),
      trim(warehouse_item ->> 'name'),
      nullif(trim(warehouse_item ->> 'city'), ''),
      coalesce(nullif(trim(warehouse_item ->> 'country'), ''), 'Barbados'),
      coalesce((warehouse_item ->> 'hasCoolZone')::boolean, false),
      true,
      actor_user
    )
    on conflict (code) do update
      set name         = excluded.name,
          city         = excluded.city,
          country      = excluded.country,
          has_cool_zone = excluded.has_cool_zone,
          active       = excluded.active,
          updated_at   = now()
    returning id into warehouse_id;

    warehouses_created := warehouses_created + 1;
  end loop;

  -- Zones: upsert on (warehouse_id, code)
  for zone_item in
    select value from jsonb_array_elements(coalesce(setup_payload -> 'zones', '[]'::jsonb))
  loop
    select id into warehouse_id
    from public.warehouses
    where code = upper(trim(zone_item ->> 'warehouseCode'));

    if warehouse_id is null then
      raise exception 'Zone references unknown warehouse code %', zone_item ->> 'warehouseCode';
    end if;

    insert into public.zones (
      warehouse_id,
      code,
      name,
      temperature_class,
      is_staging,
      is_dispatch,
      is_quarantine,
      sort_order,
      created_by
    )
    values (
      warehouse_id,
      upper(trim(zone_item ->> 'code')),
      trim(zone_item ->> 'name'),
      coalesce((zone_item ->> 'temperatureClass')::public.temperature_class, 'ambient'),
      coalesce((zone_item ->> 'isStaging')::boolean, false),
      coalesce((zone_item ->> 'isDispatch')::boolean, false),
      coalesce((zone_item ->> 'isQuarantine')::boolean, false),
      coalesce((zone_item ->> 'sortOrder')::integer, 0),
      actor_user
    )
    on conflict (warehouse_id, code) do update
      set name              = excluded.name,
          temperature_class = excluded.temperature_class,
          is_staging        = excluded.is_staging,
          is_dispatch       = excluded.is_dispatch,
          is_quarantine     = excluded.is_quarantine,
          sort_order        = excluded.sort_order,
          updated_at        = now()
    returning id into zone_id;

    zones_created := zones_created + 1;
  end loop;

  -- Location templates: generate locations; skip codes that already exist
  for template_item in
    select value from jsonb_array_elements(coalesce(setup_payload -> 'locationTemplates', '[]'::jsonb))
  loop
    select w.id, z.id
      into warehouse_id, zone_id
    from public.warehouses w
    join public.zones z on z.warehouse_id = w.id
    where w.code = upper(trim(template_item ->> 'warehouseCode'))
      and z.code = upper(trim(template_item ->> 'zoneCode'));

    if warehouse_id is null or zone_id is null then
      raise exception 'Location template references unknown warehouse/zone pair % / %',
        template_item ->> 'warehouseCode',
        template_item ->> 'zoneCode';
    end if;

    for letter_index in 1..greatest(coalesce((template_item ->> 'aisleCount')::integer, 1), 1) loop
      aisle_code := chr(64 + least(letter_index, 26));
      for bay_index in 1..greatest(coalesce((template_item ->> 'baysPerAisle')::integer, 1), 1) loop
        for level_index in 1..greatest(coalesce((template_item ->> 'levels')::integer, 1), 1) loop
          location_code := format(
            '%s-%s-%s-%02s-L%02s',
            upper(trim(template_item ->> 'warehouseCode')),
            upper(trim(template_item ->> 'zoneCode')),
            aisle_code,
            bay_index,
            level_index
          );

          insert into public.locations (
            warehouse_id,
            zone_id,
            code,
            aisle,
            bay,
            level,
            depth,
            location_type,
            temperature_class,
            max_pallets,
            mixed_sku_allowed,
            mixed_lot_allowed,
            pick_sequence,
            putaway_sequence,
            status,
            created_by
          )
          values (
            warehouse_id,
            zone_id,
            location_code,
            aisle_code,
            lpad(bay_index::text, 2, '0'),
            level_index,
            1,
            coalesce((template_item ->> 'locationType')::public.location_type, 'rack'),
            coalesce((template_item ->> 'temperatureClass')::public.temperature_class, 'ambient'),
            greatest(coalesce((template_item ->> 'maxPallets')::integer, 1), 1),
            coalesce((template_item ->> 'mixedSkuAllowed')::boolean, false),
            coalesce((template_item ->> 'mixedLotAllowed')::boolean, false),
            (letter_index * 1000) + (bay_index * 10) + level_index,
            (letter_index * 1000) + (bay_index * 10) + level_index,
            coalesce(nullif(template_item ->> 'status', ''), 'active'),
            actor_user
          )
          on conflict (code) do nothing;

          generated_locations := generated_locations + 1;
        end loop;
      end loop;
    end loop;
  end loop;

  -- Seed starter operational data only when seed_mode = 'starter_ops'
  -- and no clients have been seeded yet (idempotency guard)
  if coalesce(seed_mode, 'starter_ops') = 'starter_ops'
     and not exists (select 1 from public.clients limit 1)
  then
    insert into public.clients (code, name, require_expiry, active, created_by)
    values
      ('GEN', 'General Merchandise', false, true, actor_user),
      ('COLD', 'Cold Chain Foods', true, true, actor_user);

    for starter_client in
      select
        c.id,
        row_number() over (order by c.code) as idx,
        c.code
      from public.clients c
      order by c.code
    loop
      insert into public.products (
        sku,
        barcode,
        name,
        description,
        client_owner_id,
        product_family,
        temperature_requirement,
        lot_tracked,
        batch_tracked,
        expiry_tracked,
        rotation_method,
        active,
        created_by
      )
      values (
        format('SKU-%s-01', starter_client.code),
        format('28%s000001', starter_client.idx),
        format('%s Starter Product', starter_client.code),
        'Starter product seeded by the warehouse setup wizard.',
        starter_client.id,
        case when starter_client.code = 'COLD' then 'Cold Chain' else 'General' end,
        case when starter_client.code = 'COLD' then 'cool'::public.temperature_class else 'ambient'::public.temperature_class end,
        true,
        false,
        starter_client.code = 'COLD',
        case when starter_client.code = 'COLD' then 'fefo'::public.rotation_method else 'fifo'::public.rotation_method end,
        true,
        actor_user
      )
      returning id into product_id;

      insert into public.product_packaging_profiles (
        product_id,
        profile_name,
        package_type,
        units_per_package,
        length,
        width,
        height,
        weight,
        is_default,
        created_by
      )
      values (
        product_id,
        'Default',
        'pallet',
        48,
        120,
        100,
        case when starter_client.code = 'COLD' then 150 else 175 end,
        case when starter_client.code = 'COLD' then 700 else 850 end,
        true,
        actor_user
      )
      returning id into packaging_profile_id;
    end loop;

    for warehouse_row in
      select *
      from public.warehouses
      order by code
    loop
      select l.id into staging_location_id
      from public.locations l
      join public.zones z on z.id = l.zone_id
      where l.warehouse_id = warehouse_row.id
        and z.is_staging = true
      order by l.code
      limit 1;

      select l.id into dispatch_location_id
      from public.locations l
      join public.zones z on z.id = l.zone_id
      where l.warehouse_id = warehouse_row.id
        and z.is_dispatch = true
      order by l.code
      limit 1;

      select l.id into storage_location_id
      from public.locations l
      join public.zones z on z.id = l.zone_id
      where l.warehouse_id = warehouse_row.id
        and z.is_staging = false
        and z.is_dispatch = false
        and z.is_quarantine = false
        and l.temperature_class = 'ambient'
      order by l.code
      limit 1;

      select l.id into cool_location_id
      from public.locations l
      where l.warehouse_id = warehouse_row.id
        and l.temperature_class = 'cool'
      order by l.code
      limit 1;

      receiving_location_id := coalesce(staging_location_id, storage_location_id, dispatch_location_id, cool_location_id);

      select c.id into client_id from public.clients c where c.code = 'GEN';
      select p.id into product_id from public.products p where p.sku = 'SKU-GEN-01';
      select ppf.id into packaging_profile_id from public.product_packaging_profiles ppf where ppf.product_id = product_id limit 1;

      insert into public.receipts (
        receipt_number,
        receipt_type,
        reference_number,
        warehouse_id,
        client_id,
        status,
        notes,
        created_by
      )
      values (
        format('RCT-%s-01', warehouse_row.code),
        'po',
        format('SETUP-%s-01', warehouse_row.code),
        warehouse_row.id,
        client_id,
        'queued',
        'Starter receipt awaiting putaway.',
        actor_user
      )
      returning id into receipt_id;

      insert into public.receipt_lines (
        receipt_id,
        product_id,
        packaging_profile_id,
        client_id,
        quantity,
        received_quantity,
        notes,
        created_by
      )
      values (
        receipt_id,
        product_id,
        packaging_profile_id,
        client_id,
        24,
        24,
        'Starter receipt line.',
        actor_user
      )
      returning id into receipt_line_id;

      insert into public.pallets (
        pallet_code,
        pallet_barcode,
        product_id,
        client_id,
        receipt_line_id,
        current_location_id,
        current_warehouse_id,
        packaging_profile_id,
        quantity,
        available_quantity,
        status,
        is_stored,
        created_by
      )
      values (
        format('PLT-%s-01', warehouse_row.code),
        format('PBC-%s-01', warehouse_row.code),
        product_id,
        client_id,
        receipt_line_id,
        null,
        warehouse_row.id,
        packaging_profile_id,
        24,
        24,
        'receiving',
        false,
        actor_user
      )
      returning id into pallet_id;

      insert into public.inventory_balances (
        pallet_id,
        product_id,
        client_id,
        warehouse_id,
        location_id,
        status,
        quantity,
        available_quantity
      )
      values (
        pallet_id,
        product_id,
        client_id,
        warehouse_row.id,
        null,
        'receiving',
        24,
        24
      );

      if receiving_location_id is not null then
        insert into public.putaway_tasks (
          task_number,
          pallet_id,
          warehouse_id,
          suggested_location_id,
          assigned_user_id,
          status,
          created_by
        )
        values (
          format('PTA-%s-01', warehouse_row.code),
          pallet_id,
          warehouse_row.id,
          receiving_location_id,
          actor_user,
          'queued',
          actor_user
        );
      end if;

      if storage_location_id is not null then
        insert into public.pallets (
          pallet_code,
          pallet_barcode,
          product_id,
          client_id,
          current_location_id,
          current_warehouse_id,
          packaging_profile_id,
          quantity,
          available_quantity,
          status,
          is_stored,
          created_by
        )
        values (
          format('PLT-%s-02', warehouse_row.code),
          format('PBC-%s-02', warehouse_row.code),
          product_id,
          client_id,
          storage_location_id,
          warehouse_row.id,
          packaging_profile_id,
          18,
          18,
          'available',
          true,
          actor_user
        )
        returning id into pallet_id;

        insert into public.inventory_balances (
          pallet_id,
          product_id,
          client_id,
          warehouse_id,
          zone_id,
          location_id,
          status,
          quantity,
          available_quantity
        )
        select
          pallet_id,
          product_id,
          client_id,
          warehouse_row.id,
          l.zone_id,
          storage_location_id,
          'available',
          18,
          18
        from public.locations l
        where l.id = storage_location_id;
      end if;
    end loop;

    select w.id into source_warehouse_id
    from public.warehouses w
    order by w.code
    limit 1;

    select w.id into destination_warehouse_id
    from public.warehouses w
    order by w.code
    offset 1
    limit 1;

    if source_warehouse_id is not null then
      select c.id into client_id from public.clients c where c.code = 'GEN';
      select p.id into product_id from public.products p where p.sku = 'SKU-GEN-01';
      select l.id into dispatch_location_id
      from public.locations l
      join public.zones z on z.id = l.zone_id
      where l.warehouse_id = source_warehouse_id
        and z.is_dispatch = true
      order by l.code
      limit 1;

      insert into public.orders (
        order_number,
        order_type,
        client_id,
        warehouse_id,
        status,
        requested_ship_date,
        notes,
        created_by
      )
      values (
        'ORD-SETUP-01',
        'sales',
        client_id,
        source_warehouse_id,
        'queued',
        current_date + 1,
        'Starter outbound order.',
        actor_user
      )
      returning id into pick_order_id;

      insert into public.pick_lists (
        pick_list_number,
        warehouse_id,
        client_id,
        order_id,
        consolidated,
        status,
        released_at,
        notes,
        created_by
      )
      values (
        'PKL-SETUP-01',
        source_warehouse_id,
        client_id,
        pick_order_id,
        false,
        'queued',
        timezone('utc', now()),
        'Starter pick list.',
        actor_user
      )
      returning id into pick_list_id;

      select ib.pallet_id, ib.location_id into pallet_id, storage_location_id
      from public.inventory_balances ib
      where ib.warehouse_id = source_warehouse_id
        and ib.status = 'available'
      order by ib.created_at
      limit 1;

      if pallet_id is not null then
        insert into public.order_lines (
          order_id,
          product_id,
          quantity,
          allocated_quantity,
          notes,
          created_by
        )
        values (
          pick_order_id,
          product_id,
          6,
          6,
          'Starter order line.',
          actor_user
        );

        insert into public.pick_tasks (
          task_number,
          pick_list_id,
          pallet_id,
          location_id,
          staging_location_id,
          assigned_user_id,
          requested_quantity,
          status,
          created_by
        )
        values (
          'PKT-SETUP-01',
          pick_list_id,
          pallet_id,
          storage_location_id,
          dispatch_location_id,
          actor_user,
          6,
          'queued',
          actor_user
        );
      end if;
    end if;

    if source_warehouse_id is not null and destination_warehouse_id is not null then
      select ib.pallet_id into pallet_id
      from public.inventory_balances ib
      where ib.warehouse_id = source_warehouse_id
        and ib.status = 'available'
      order by ib.created_at
      limit 1;

      if pallet_id is not null then
        insert into public.transfers (
          transfer_number,
          transfer_type,
          source_warehouse_id,
          destination_warehouse_id,
          status,
          notes,
          created_by
        )
        values (
          'TRF-SETUP-01',
          'inter_warehouse',
          source_warehouse_id,
          destination_warehouse_id,
          'queued',
          'Starter replenishment transfer.',
          actor_user
        )
        returning id into transfer_id;

        insert into public.transfer_lines (
          transfer_id,
          pallet_id,
          product_id,
          client_id,
          quantity,
          created_by
        )
        select
          transfer_id,
          pallet_id,
          ib.product_id,
          ib.client_id,
          least(ib.available_quantity, 6),
          actor_user
        from public.inventory_balances ib
        where ib.pallet_id = pallet_id;
      end if;
    end if;

    if source_warehouse_id is not null then
      insert into public.cycle_counts (
        count_number,
        warehouse_id,
        scope,
        status,
        assigned_user_id,
        variance_threshold_percent,
        notes,
        created_by
      )
      values (
        'CNT-SETUP-01',
        source_warehouse_id,
        'spot',
        'queued',
        actor_user,
        5,
        'Starter cycle count.',
        actor_user
      )
      returning id into cycle_count_id;

      insert into public.cycle_count_lines (
        cycle_count_id,
        location_id,
        product_id,
        pallet_id,
        expected_quantity,
        counted_quantity,
        variance_quantity,
        variance_percent,
        status,
        notes,
        created_by
      )
      select
        cycle_count_id,
        ib.location_id,
        ib.product_id,
        ib.pallet_id,
        ib.quantity,
        ib.quantity,
        0,
        0,
        'queued',
        'Starter cycle count line.',
        actor_user
      from public.inventory_balances ib
      where ib.warehouse_id = source_warehouse_id
      order by ib.created_at
      limit 1;
    end if;

    insert into public.audit_events (
      event_type,
      entity_table,
      entity_id,
      warehouse_id,
      actor_user_id,
      metadata
    )
    select
      'receipt',
      'warehouses',
      w.id,
      w.id,
      actor_user,
      jsonb_build_object('setup_seeded', true, 'warehouse_code', w.code)
    from public.warehouses w;
  end if;

  return jsonb_build_object(
    'status', 'ok',
    'warehouses_created', warehouses_created,
    'zones_created', zones_created,
    'locations_created', generated_locations,
    'seed_mode', coalesce(seed_mode, 'starter_ops')
  );
end;
$$;
