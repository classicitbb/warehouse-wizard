insert into auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
)
values
  (
    '00000000-0000-0000-0000-000000000000',
    '77777777-7777-7777-7777-777777777777',
    'authenticated',
    'authenticated',
    'russelljhunte@gmail.com',
    crypt('Falcon-Crate-92!Tundra', gen_salt('bf')),
    timezone('utc', now()),
    '{"provider":"email","providers":["email"]}',
    '{"full_name":"Russell Hunte"}',
    timezone('utc', now()),
    timezone('utc', now())
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '11111111-1111-1111-1111-111111111111',
    'authenticated',
    'authenticated',
    'admin@warehousewizard.local',
    crypt('Warehouse123!', gen_salt('bf')),
    timezone('utc', now()),
    '{"provider":"email","providers":["email"]}',
    '{"full_name":"System Admin"}',
    timezone('utc', now()),
    timezone('utc', now())
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '22222222-2222-2222-2222-222222222222',
    'authenticated',
    'authenticated',
    'manager@warehousewizard.local',
    crypt('Warehouse123!', gen_salt('bf')),
    timezone('utc', now()),
    '{"provider":"email","providers":["email"]}',
    '{"full_name":"Shanice Jordan"}',
    timezone('utc', now()),
    timezone('utc', now())
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '33333333-3333-3333-3333-333333333333',
    'authenticated',
    'authenticated',
    'clerk@warehousewizard.local',
    crypt('Warehouse123!', gen_salt('bf')),
    timezone('utc', now()),
    '{"provider":"email","providers":["email"]}',
    '{"full_name":"Darnell Clarke"}',
    timezone('utc', now()),
    timezone('utc', now())
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '44444444-4444-4444-4444-444444444444',
    'authenticated',
    'authenticated',
    'operator@warehousewizard.local',
    crypt('Warehouse123!', gen_salt('bf')),
    timezone('utc', now()),
    '{"provider":"email","providers":["email"]}',
    '{"full_name":"Kemar Holder"}',
    timezone('utc', now()),
    timezone('utc', now())
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '55555555-5555-5555-5555-555555555555',
    'authenticated',
    'authenticated',
    'driver@warehousewizard.local',
    crypt('Warehouse123!', gen_salt('bf')),
    timezone('utc', now()),
    '{"provider":"email","providers":["email"]}',
    '{"full_name":"Janelle Ifill"}',
    timezone('utc', now()),
    timezone('utc', now())
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '66666666-6666-6666-6666-666666666666',
    'authenticated',
    'authenticated',
    'supervisor@warehousewizard.local',
    crypt('Warehouse123!', gen_salt('bf')),
    timezone('utc', now()),
    '{"provider":"email","providers":["email"]}',
    '{"full_name":"Andre Wilde"}',
    timezone('utc', now()),
    timezone('utc', now())
  )
on conflict (id) do update
set email = excluded.email,
    raw_user_meta_data = excluded.raw_user_meta_data,
    updated_at = excluded.updated_at;

insert into public.profiles (id, email, full_name, active, approved, user_code, badge_code)
values
  ('77777777-7777-7777-7777-777777777777', 'russelljhunte@gmail.com', 'Russell Hunte', true, true, 'DEV01', 'BADGE-DEV01'),
  ('11111111-1111-1111-1111-111111111111', 'admin@warehousewizard.local', 'System Admin', true, true, 'ADMIN01', 'BADGE-ADMIN01'),
  ('22222222-2222-2222-2222-222222222222', 'manager@warehousewizard.local', 'Shanice Jordan', true, true, 'MGR01', 'BADGE-MGR01'),
  ('33333333-3333-3333-3333-333333333333', 'clerk@warehousewizard.local', 'Darnell Clarke', true, true, 'CLK01', 'BADGE-CLK01'),
  ('44444444-4444-4444-4444-444444444444', 'operator@warehousewizard.local', 'Kemar Holder', true, true, 'OPR01', 'BADGE-OPR01'),
  ('55555555-5555-5555-5555-555555555555', 'driver@warehousewizard.local', 'Janelle Ifill', true, true, 'DRV01', 'BADGE-DRV01'),
  ('66666666-6666-6666-6666-666666666666', 'supervisor@warehousewizard.local', 'Andre Wilde', true, true, 'SUP01', 'BADGE-SUP01')
on conflict (id) do update
set email = excluded.email,
    full_name = excluded.full_name,
    active = excluded.active,
    approved = excluded.approved,
    user_code = excluded.user_code,
    badge_code = excluded.badge_code,
    updated_at = timezone('utc', now());

do $$
declare
  admin_user constant uuid := '11111111-1111-1111-1111-111111111111';
  developer_user constant uuid := '77777777-7777-7777-7777-777777777777';
  manager_user constant uuid := '22222222-2222-2222-2222-222222222222';
  clerk_user constant uuid := '33333333-3333-3333-3333-333333333333';
  operator_user constant uuid := '44444444-4444-4444-4444-444444444444';
  driver_user constant uuid := '55555555-5555-5555-5555-555555555555';
  supervisor_user constant uuid := '66666666-6666-6666-6666-666666666666';
  original_wh uuid;
  wildey_wh uuid;
  new_wh uuid;
  orig_stg uuid;
  orig_dsp uuid;
  wild_amb uuid;
  wild_stg uuid;
  wild_dsp uuid;
  new_cr1 uuid;
  new_cr2 uuid;
  new_cr3 uuid;
  new_cr4 uuid;
  new_stg uuid;
  new_dsp uuid;
  new_qtn uuid;
  zone_row record;
  balance_row record;
  stock_row record;
  product_id uuid;
  client_id uuid;
  lot_id uuid;
  receipt_id uuid;
  receipt_line_id uuid;
  pallet_id uuid;
  pallet_profile_id uuid;
  order_id uuid;
  order_line_id uuid;
  pick_list_id uuid;
  transfer_id uuid;
  cycle_count_id uuid;
  assigned_zone_id uuid;
  assigned_location_id uuid;
  assigned_warehouse_id uuid;
  assigned_status public.inventory_status;
  assigned_quantity numeric(14,2);
  assigned_available numeric(14,2);
  assigned_profile_units integer;
  product_temp public.temperature_class;
  product_expiry_tracked boolean;
  location_type_value public.location_type;
  level_value integer;
  max_pallets_value integer;
  max_weight_value numeric(12,2);
  max_height_value numeric(10,2);
  aisle_letter text;
  side_code text;
  bay_code text;
  location_code text;
  product_sku text;
  product_name text;
  product_barcode text;
  product_family text;
  product_trait text;
  packaging_kind text;
  client_code text;
  manufacture_date_value date;
  expiry_date_value date;
  receipt_status public.task_status;
  receipt_type_value public.receipt_type;
  transfer_status public.task_status;
  count_status public.task_status;
  item_index integer;
  slot_index integer;
  pick_index integer;
  transfer_index integer;
  count_index integer;
  client_codes text[] := array['ARCTIC', 'ISLAND', 'TROPIC', 'PHARMA', 'BIMSUP', 'SUNBAY'];
  ambient_families text[] := array['Dry Goods', 'Beverages', 'Paper Goods', 'Home Care', 'Personal Care', 'Bulk Retail'];
  cool_families text[] := array['Chilled Dairy', 'Prepared Meals', 'Fresh Produce', 'Cold Chain Pharma'];
begin
  update public.profiles
  set default_warehouse_id = null
  where default_warehouse_id is not null;

  truncate table
    public.audit_events,
    public.barcode_labels,
    public.stock_adjustments,
    public.cycle_count_lines,
    public.cycle_counts,
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
    public.warehouses,
    public.user_roles,
    public.roles
  restart identity cascade;

  insert into public.roles (code, name, description)
  values
    ('developer', 'Developer', 'Full system capabilities including developer tooling, role management, and all configuration'),
    ('admin', 'Admin', 'Full access across the warehouse management system'),
    ('warehouse_manager', 'Warehouse Manager', 'Operational control across warehouses, stock, and reporting'),
    ('inventory_clerk', 'Inventory Clerk', 'Receiving, product setup, cycle counts, and routine adjustments'),
    ('warehouse_operator', 'Warehouse Operator', 'Forklift and floor execution for putaway, picking, and moves'),
    ('dispatch_driver', 'Dispatch Driver', 'Confirms transfer dispatches and receives stock between facilities');

  insert into public.warehouses (
    code,
    name,
    address_line_1,
    address_line_2,
    city,
    country,
    has_cool_zone,
    active,
    created_by
  )
  values
    ('ORG', 'Original Warehouse', 'Lower Estate Yard 1', 'Next door to New Warehouse', 'Bridgetown', 'Barbados', false, true, admin_user),
    ('WLD', 'Wildey Warehouse', 'Wildey Commercial Estate', 'Block C', 'Wildey', 'Barbados', false, true, admin_user),
    ('NEW', 'New Warehouse', 'Lower Estate Yard 2', 'North gate', 'Bridgetown', 'Barbados', true, true, admin_user);

  select id into original_wh from public.warehouses where code = 'ORG';
  select id into wildey_wh from public.warehouses where code = 'WLD';
  select id into new_wh from public.warehouses where code = 'NEW';

  update public.profiles
  set default_warehouse_id = case id
    when developer_user then new_wh
    when admin_user then new_wh
    when manager_user then new_wh
    when clerk_user then new_wh
    when operator_user then new_wh
    when driver_user then wildey_wh
    when supervisor_user then original_wh
    else default_warehouse_id
  end
  where id in (developer_user, admin_user, manager_user, clerk_user, operator_user, driver_user, supervisor_user);

  insert into public.user_roles (user_id, role_id, warehouse_id)
  select user_id_map.user_id, r.id, user_id_map.warehouse_id
  from public.roles r
  join (
    values
      (developer_user, 'developer', null::uuid),
      (admin_user, 'admin', null::uuid),
      (admin_user, 'warehouse_manager', null::uuid),
      (manager_user, 'warehouse_manager', new_wh),
      (clerk_user, 'inventory_clerk', new_wh),
      (operator_user, 'warehouse_operator', new_wh),
      (driver_user, 'dispatch_driver', wildey_wh),
      (supervisor_user, 'warehouse_manager', original_wh)
  ) as user_id_map(user_id, role_code, warehouse_id)
    on user_id_map.role_code = r.code;

  insert into public.zones (
    warehouse_id,
    code,
    name,
    temperature_class,
    is_dispatch,
    is_quarantine,
    is_staging,
    sort_order,
    notes,
    created_by
  )
  values
    (original_wh, 'STG', 'Original Staging', 'ambient', false, false, true, 10, 'Dispatch preparation and short-term holding.', admin_user),
    (original_wh, 'DSP', 'Original Dispatch', 'ambient', true, false, false, 20, 'Outbound lane for legacy warehouse orders.', admin_user),
    (wildey_wh, 'AMB', 'Wildey Bulk Rack', 'ambient', false, false, false, 10, 'General rack storage for ambient goods.', admin_user),
    (wildey_wh, 'STG', 'Wildey Staging', 'ambient', false, false, true, 20, 'Transfer staging for ambient pallets.', admin_user),
    (wildey_wh, 'DSP', 'Wildey Dispatch', 'ambient', true, false, false, 30, 'Outbound and transfer dispatch lane.', admin_user),
    (new_wh, 'CR1', 'Cool Room Rack 1', 'cool', false, false, false, 10, 'Cool room aisle block 1.', admin_user),
    (new_wh, 'CR2', 'Cool Room Rack 2', 'cool', false, false, false, 20, 'Cool room aisle block 2.', admin_user),
    (new_wh, 'CR3', 'Cool Room Rack 3', 'cool', false, false, false, 30, 'Cool room aisle block 3.', admin_user),
    (new_wh, 'CR4', 'Cool Room Rack 4', 'cool', false, false, false, 40, 'Cool room aisle block 4.', admin_user),
    (new_wh, 'STG', 'New Warehouse Staging', 'ambient', false, false, true, 50, 'Inbound and outbound staging.', admin_user),
    (new_wh, 'DSP', 'New Warehouse Dispatch', 'ambient', true, false, false, 60, 'Primary dispatch lane.', admin_user),
    (new_wh, 'QTN', 'New Warehouse Quarantine', 'ambient', false, true, false, 70, 'Broken, damaged, held, and suspect stock.', admin_user);

  select id into orig_stg from public.zones where warehouse_id = original_wh and code = 'STG';
  select id into orig_dsp from public.zones where warehouse_id = original_wh and code = 'DSP';
  select id into wild_amb from public.zones where warehouse_id = wildey_wh and code = 'AMB';
  select id into wild_stg from public.zones where warehouse_id = wildey_wh and code = 'STG';
  select id into wild_dsp from public.zones where warehouse_id = wildey_wh and code = 'DSP';
  select id into new_cr1 from public.zones where warehouse_id = new_wh and code = 'CR1';
  select id into new_cr2 from public.zones where warehouse_id = new_wh and code = 'CR2';
  select id into new_cr3 from public.zones where warehouse_id = new_wh and code = 'CR3';
  select id into new_cr4 from public.zones where warehouse_id = new_wh and code = 'CR4';
  select id into new_stg from public.zones where warehouse_id = new_wh and code = 'STG';
  select id into new_dsp from public.zones where warehouse_id = new_wh and code = 'DSP';
  select id into new_qtn from public.zones where warehouse_id = new_wh and code = 'QTN';

  for zone_row in
    select z.*, w.code as warehouse_code
    from public.zones z
    join public.warehouses w on w.id = z.warehouse_id
    order by w.code, z.sort_order
  loop
    for slot_index in 1..20 loop
      aisle_letter := chr(64 + ((slot_index - 1) / 2) + 1);
      side_code := case when mod(slot_index, 2) = 1 then 'L' else 'R' end;
      bay_code := lpad((((slot_index - 1) / 2) + 1)::text, 2, '0');
      location_type_value := case
        when zone_row.is_quarantine then 'quarantine'::public.location_type
        when zone_row.is_dispatch then 'dispatch'::public.location_type
        when zone_row.is_staging then 'staging'::public.location_type
        else 'rack'::public.location_type
      end;
      level_value := case when location_type_value = 'rack' then ((slot_index - 1) % 4) + 1 else 1 end;
      max_pallets_value := case
        when zone_row.is_staging then 4
        when zone_row.is_dispatch then 3
        when zone_row.is_quarantine then 1
        else 1
      end;
      max_weight_value := case when zone_row.temperature_class = 'cool' then 900 else 1250 end;
      max_height_value := case when zone_row.temperature_class = 'cool' then 165 else 190 end;
      location_code := format('%s-%s-%s%s-%s-L%02s', zone_row.warehouse_code, zone_row.code, aisle_letter, side_code, bay_code, level_value);

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
        max_length,
        max_width,
        max_height,
        max_weight,
        max_pallets,
        mixed_sku_allowed,
        mixed_lot_allowed,
        allowed_product_family,
        pick_sequence,
        putaway_sequence,
        status,
        notes,
        layout_x,
        layout_y,
        layout_width,
        layout_height,
        created_by
      )
      values (
        zone_row.warehouse_id,
        zone_row.id,
        location_code,
        aisle_letter,
        bay_code || side_code,
        level_value,
        1,
        location_type_value,
        zone_row.temperature_class,
        120,
        100,
        max_height_value,
        max_weight_value,
        max_pallets_value,
        zone_row.is_staging or zone_row.code = 'AMB',
        zone_row.is_staging,
        case when zone_row.temperature_class = 'cool' then 'Cold Chain' else 'Ambient' end,
        (zone_row.sort_order * 100) + slot_index,
        (zone_row.sort_order * 100) + slot_index,
        'active',
        case
          when zone_row.is_quarantine then 'Quarantine lane for investigations.'
          when zone_row.is_dispatch then 'Dispatch-ready lane.'
          when zone_row.is_staging then 'Flexible staging footprint.'
          else 'Primary rack location.'
        end,
        ((slot_index - 1) % 10) * 12,
        floor((slot_index - 1) / 10) * 16,
        10,
        12,
        admin_user
      );
    end loop;
  end loop;

  insert into public.clients (
    code,
    name,
    allow_mixed_stock,
    allow_mixed_sku_pallet,
    allow_mixed_lot_pallet,
    require_expiry,
    active,
    created_by
  )
  values
    ('ARCTIC', 'Arctic Foods Barbados', false, false, false, true, true, admin_user),
    ('ISLAND', 'Island Retail Distribution', true, false, false, false, true, admin_user),
    ('TROPIC', 'Tropic Beverage Co.', false, false, false, true, true, admin_user),
    ('PHARMA', 'BimCare Pharma', false, false, false, true, true, admin_user),
    ('BIMSUP', 'Bim Supply & Home', true, true, false, false, true, admin_user),
    ('SUNBAY', 'Sunbay Grocers', false, false, false, true, true, admin_user);

  for item_index in 1..150 loop
    client_code := client_codes[1 + mod(item_index - 1, array_length(client_codes, 1))];
    select id into client_id from public.clients where code = client_code;

    if mod(item_index, 5) = 0 then
      product_temp := 'cool';
      product_family := cool_families[1 + mod((item_index / 5) - 1, array_length(cool_families, 1))];
    else
      product_temp := 'ambient';
      product_family := ambient_families[1 + mod(item_index - 1, array_length(ambient_families, 1))];
    end if;

    product_trait := case mod(item_index, 4)
      when 0 then 'Heavy'
      when 1 then 'Light'
      when 2 then 'Soft'
      else 'Hard'
    end;

    product_sku := format('SKU-%s', lpad(item_index::text, 4, '0'));
    product_barcode := format('28%s', lpad(item_index::text, 10, '0'));
    product_name := format('%s %s %s', product_trait, product_family, lpad(item_index::text, 3, '0'));

    insert into public.products (
      sku,
      barcode,
      name,
      description,
      client_owner_id,
      product_family,
      temperature_requirement,
      length,
      width,
      height,
      weight,
      stackable,
      max_stack_height,
      lot_tracked,
      batch_tracked,
      expiry_tracked,
      rotation_method,
      active,
      created_by
    )
    values (
      product_sku,
      product_barcode,
      product_name,
      format(
        '%s profile for %s. Designed for %s handling with consistent pallet packing across all Barbados warehouses.',
        product_family,
        client_code,
        lower(product_trait)
      ),
      client_id,
      product_family,
      product_temp,
      28 + (mod(item_index, 5) * 6),
      22 + (mod(item_index, 4) * 5),
      16 + (mod(item_index, 3) * 7),
      4 + (mod(item_index, 6) * 3),
      mod(item_index, 7) <> 0,
      case
        when mod(item_index, 7) = 0 then 2
        when product_temp = 'cool' then 4
        else 5
      end,
      true,
      mod(item_index, 4) in (0, 2),
      product_temp = 'cool' or client_code in ('ARCTIC', 'PHARMA', 'SUNBAY'),
      case when product_temp = 'cool' then 'fefo'::public.rotation_method else 'fifo'::public.rotation_method end,
      true,
      admin_user
    )
    returning id into product_id;

    for packaging_kind in select unnest(array['Each', 'Case', 'Pallet']) loop
      insert into public.product_packaging_profiles (
        product_id,
        profile_name,
        package_type,
        units_per_package,
        length,
        width,
        height,
        weight,
        barcode,
        is_default,
        created_by
      )
      values (
        product_id,
        packaging_kind,
        lower(packaging_kind),
        case packaging_kind
          when 'Each' then 1
          when 'Case' then 4 + mod(item_index, 9)
          else (4 + mod(item_index, 9)) * (4 + mod(item_index, 3))
        end,
        case packaging_kind
          when 'Each' then 28 + (mod(item_index, 5) * 6)
          when 'Case' then 42 + (mod(item_index, 4) * 8)
          else 120
        end,
        case packaging_kind
          when 'Each' then 22 + (mod(item_index, 4) * 5)
          when 'Case' then 30 + (mod(item_index, 3) * 8)
          else 100
        end,
        case packaging_kind
          when 'Each' then 16 + (mod(item_index, 3) * 7)
          when 'Case' then 24 + (mod(item_index, 4) * 8)
          else case when product_temp = 'cool' then 155 else 175 end
        end,
        case packaging_kind
          when 'Each' then 4 + (mod(item_index, 6) * 3)
          when 'Case' then (4 + (mod(item_index, 6) * 3)) * (4 + mod(item_index, 9))
          else ((4 + (mod(item_index, 6) * 3)) * (4 + mod(item_index, 9)) * (4 + mod(item_index, 3))) + 18
        end,
        format(
          '%s%s',
          case packaging_kind when 'Each' then '91' when 'Case' then '92' else '93' end,
          lpad(item_index::text, 11, '0')
        ),
        packaging_kind = 'Pallet',
        admin_user
      );
    end loop;
  end loop;

  for item_index in 1..180 loop
    product_sku := format('SKU-%s', lpad((((item_index - 1) % 150) + 1)::text, 4, '0'));

    select
      p.id,
      p.client_owner_id,
      p.temperature_requirement,
      p.expiry_tracked
    into
      product_id,
      client_id,
      product_temp,
      product_expiry_tracked
    from public.products p
    where p.sku = product_sku;

    select id, units_per_package
    into pallet_profile_id, assigned_profile_units
    from public.product_packaging_profiles
    where public.product_packaging_profiles.product_id = (
      select p.id
      from public.products p
      where p.sku = product_sku
    )
      and profile_name = 'Pallet';

    assigned_quantity := assigned_profile_units;
    assigned_status := case
      when item_index between 1 and 8 then 'receiving'::public.inventory_status
      when item_index between 9 and 12 then 'quarantine'::public.inventory_status
      when item_index between 13 and 15 then 'damaged'::public.inventory_status
      when item_index between 16 and 18 then 'hold'::public.inventory_status
      when item_index = 19 then 'missing'::public.inventory_status
      else 'available'::public.inventory_status
    end;

    if product_temp = 'cool' then
      assigned_warehouse_id := new_wh;
      assigned_zone_id := case mod(item_index, 4)
        when 1 then new_cr1
        when 2 then new_cr2
        when 3 then new_cr3
        else new_cr4
      end;
    else
      assigned_warehouse_id := case mod(item_index, 3)
        when 1 then wildey_wh
        when 2 then original_wh
        else new_wh
      end;
      assigned_zone_id := case
        when assigned_warehouse_id = wildey_wh then wild_amb
        when assigned_warehouse_id = original_wh then case when mod(item_index, 2) = 0 then orig_stg else orig_dsp end
        else new_stg
      end;
    end if;

    if assigned_status = 'quarantine' then
      assigned_warehouse_id := new_wh;
      assigned_zone_id := new_qtn;
    elsif assigned_status in ('damaged', 'hold') then
      assigned_warehouse_id := new_wh;
      assigned_zone_id := new_qtn;
    elsif assigned_status = 'missing' then
      assigned_zone_id := null;
    elsif assigned_status = 'receiving' then
      assigned_zone_id := null;
    end if;

    if assigned_zone_id is null then
      assigned_location_id := null;
    else
      select id
      into assigned_location_id
      from public.locations
      where zone_id = assigned_zone_id
      order by code
      offset mod(item_index - 1, 20)
      limit 1;
    end if;

    assigned_available := case when assigned_status = 'available' then assigned_quantity else 0 end;
    manufacture_date_value := current_date - (25 + mod(item_index, 90));
    expiry_date_value := case
      when product_expiry_tracked then current_date + (45 + mod(item_index, 150))
      else null
    end;

    insert into public.inventory_lots (
      product_id,
      client_id,
      lot_number,
      batch_number,
      manufacture_date,
      expiry_date,
      loading_date,
      rotation_date,
      created_by
    )
    values (
      product_id,
      client_id,
      format('LOT-%s-%03s', right(product_sku, 4), ((item_index - 1) / 2) + 1),
      format('BAT-%s-%03s', right(product_sku, 4), ((item_index - 1) / 3) + 1),
      manufacture_date_value,
      expiry_date_value,
      current_date - mod(item_index, 18),
      coalesce(expiry_date_value, current_date + 180),
      clerk_user
    )
    returning id into lot_id;

    receipt_type_value := case when mod(item_index, 6) = 0 then 'transfer'::public.receipt_type else 'po'::public.receipt_type end;
    receipt_status := case when assigned_status = 'receiving' then 'queued'::public.task_status else 'completed'::public.task_status end;

    insert into public.receipts (
      receipt_number,
      receipt_type,
      reference_number,
      warehouse_id,
      source_warehouse_id,
      client_id,
      status,
      notes,
      created_by
    )
    values (
      format('RCT-BB-%04s', item_index),
      receipt_type_value,
      format('REF-%04s', item_index),
      assigned_warehouse_id,
      case when receipt_type_value = 'transfer' then wildey_wh else null end,
      client_id,
      receipt_status,
      case
        when assigned_status = 'receiving' then 'Awaiting putaway to directed location.'
        when assigned_status = 'quarantine' then 'Received with quality concern and directed to quarantine.'
        else 'Operational demo receipt.'
      end,
      clerk_user
    )
    returning id into receipt_id;

    insert into public.receipt_lines (
      receipt_id,
      product_id,
      packaging_profile_id,
      client_id,
      quantity,
      received_quantity,
      inventory_lot_id,
      notes,
      created_by
    )
    values (
      receipt_id,
      product_id,
      pallet_profile_id,
      client_id,
      assigned_quantity,
      case when assigned_status = 'receiving' then 0 else assigned_quantity end,
      lot_id,
      format('Seeded pallet %s', item_index),
      clerk_user
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
      inventory_lot_id,
      packaging_profile_id,
      quantity,
      available_quantity,
      reserved_quantity,
      held_quantity,
      damaged_quantity,
      status,
      is_stored,
      last_counted_at,
      length,
      width,
      height,
      weight,
      stack_height,
      created_by
    )
    values (
      format('PLT-%05s', item_index),
      format('PBC-%05s', item_index),
      product_id,
      client_id,
      receipt_line_id,
      assigned_location_id,
      assigned_warehouse_id,
      lot_id,
      pallet_profile_id,
      assigned_quantity,
      assigned_available,
      0,
      case when assigned_status = 'hold' then assigned_quantity else 0 end,
      case when assigned_status = 'damaged' then assigned_quantity else 0 end,
      assigned_status,
      assigned_location_id is not null,
      case when item_index > 20 then timezone('utc', now()) - make_interval(days => mod(item_index, 14)) else null end,
      120,
      100,
      case when product_temp = 'cool' then 155 else 175 end,
      (assigned_quantity * 10) + 18,
      case when product_temp = 'cool' then 4 else 5 end,
      clerk_user
    )
    returning id into pallet_id;

    insert into public.inventory_balances (
      pallet_id,
      product_id,
      client_id,
      warehouse_id,
      zone_id,
      location_id,
      inventory_lot_id,
      status,
      quantity,
      available_quantity,
      reserved_quantity,
      held_quantity,
      damaged_quantity,
      received_at,
      expiry_date
    )
    values (
      pallet_id,
      product_id,
      client_id,
      assigned_warehouse_id,
      assigned_zone_id,
      assigned_location_id,
      lot_id,
      assigned_status,
      assigned_quantity,
      assigned_available,
      0,
      case when assigned_status = 'hold' then assigned_quantity else 0 end,
      case when assigned_status = 'damaged' then assigned_quantity else 0 end,
      timezone('utc', now()) - make_interval(days => mod(item_index, 20)),
      expiry_date_value
    );

    insert into public.barcode_labels (
      label_type,
      entity_id,
      label_code,
      printed_by,
      reprint_count,
      last_printed_at
    )
    values (
      'pallet',
      pallet_id,
      format('PBC-%05s', item_index),
      clerk_user,
      0,
      timezone('utc', now()) - make_interval(days => mod(item_index, 10))
    );

    if assigned_status = 'receiving' then
      select id
      into assigned_location_id
      from public.locations
      where zone_id = case when product_temp = 'cool' then new_cr1 else new_stg end
      order by code
      offset mod(item_index - 1, 20)
      limit 1;

      insert into public.putaway_tasks (
        task_number,
        pallet_id,
        warehouse_id,
        suggested_location_id,
        assigned_user_id,
        status,
        alternative_requested,
        created_by
      )
      values (
        format('PTA-%05s', item_index),
        pallet_id,
        assigned_warehouse_id,
        assigned_location_id,
        operator_user,
        'queued',
        false,
        clerk_user
      );
    end if;
  end loop;

  for pick_index in 1..6 loop
    select ib.*, p.client_id
    into balance_row
    from public.inventory_balances ib
    join public.pallets p on p.id = ib.pallet_id
    where ib.status = 'available'
      and ib.warehouse_id = new_wh
      and ib.location_id is not null
    order by ib.created_at, ib.id
    offset (pick_index - 1) * 3
    limit 1;

    if balance_row.id is null then
      continue;
    end if;

    insert into public.orders (
      order_number,
      order_type,
      client_id,
      warehouse_id,
      status,
      priority,
      requested_ship_date,
      notes,
      created_by
    )
    values (
      format('ORD-%04s', pick_index),
      'sales',
      balance_row.client_id,
      new_wh,
      case when pick_index <= 2 then 'assigned'::public.task_status else 'queued'::public.task_status end,
      1 + mod(pick_index, 3),
      current_date + pick_index,
      'Seeded customer order for pick execution.',
      manager_user
    )
    returning id into order_id;

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
      format('PKL-%04s', pick_index),
      new_wh,
      balance_row.client_id,
      order_id,
      true,
      case
        when pick_index = 1 then 'in_progress'::public.task_status
        when pick_index = 2 then 'assigned'::public.task_status
        else 'queued'::public.task_status
      end,
      timezone('utc', now()) - make_interval(hours => pick_index),
      'Directed pick list with live pallet locations.',
      manager_user
    )
    returning id into pick_list_id;

    for stock_row in
      select ib.*, p.client_id
      from public.inventory_balances ib
      join public.pallets p on p.id = ib.pallet_id
      where ib.status = 'available'
        and ib.warehouse_id = new_wh
        and ib.location_id is not null
      order by ib.created_at, ib.id
      offset (pick_index - 1) * 3
      limit 3
    loop
      insert into public.order_lines (
        order_id,
        product_id,
        quantity,
        allocated_quantity,
        picked_quantity,
        inventory_lot_id,
        notes,
        created_by
      )
      values (
        order_id,
        stock_row.product_id,
        greatest(1, least(stock_row.available_quantity, 6)),
        greatest(1, least(stock_row.available_quantity, 6)),
        0,
        stock_row.inventory_lot_id,
        'Seeded order line.',
        manager_user
      )
      returning id into order_line_id;

      insert into public.pick_tasks (
        task_number,
        pick_list_id,
        order_line_id,
        pallet_id,
        location_id,
        staging_location_id,
        assigned_user_id,
        requested_quantity,
        confirmed_quantity,
        status,
        completed_at,
        created_by
      )
      values (
        format('PKT-%04s-%s', pick_index, right(stock_row.pallet_id::text, 4)),
        pick_list_id,
        order_line_id,
        stock_row.pallet_id,
        stock_row.location_id,
        (select id from public.locations where zone_id = new_dsp order by code limit 1 offset mod(pick_index - 1, 20)),
        operator_user,
        greatest(1, least(stock_row.available_quantity, 6)),
        0,
        case
          when pick_index = 1 then 'assigned'::public.task_status
          when pick_index = 2 then 'queued'::public.task_status
          else 'queued'::public.task_status
        end,
        null,
        manager_user
      );
    end loop;

    insert into public.barcode_labels (
      label_type,
      entity_id,
      label_code,
      printed_by,
      reprint_count,
      last_printed_at
    )
    values (
      'pick_list',
      pick_list_id,
      format('PKL-%04s', pick_index),
      manager_user,
      0,
      timezone('utc', now())
    );
  end loop;

  for transfer_index in 1..4 loop
    select ib.*, p.client_id
    into balance_row
    from public.inventory_balances ib
    join public.pallets p on p.id = ib.pallet_id
    where ib.status = 'available'
      and ib.warehouse_id in (wildey_wh, original_wh)
      and ib.location_id is not null
    order by ib.created_at, ib.id
    offset (transfer_index - 1) * 2
    limit 1;

    if balance_row.id is null then
      continue;
    end if;

    transfer_status := case
      when transfer_index = 1 then 'in_progress'::public.task_status
      when transfer_index = 2 then 'queued'::public.task_status
      else 'completed'::public.task_status
    end;

    insert into public.transfers (
      transfer_number,
      transfer_type,
      source_warehouse_id,
      destination_warehouse_id,
      status,
      dispatched_at,
      received_at,
      notes,
      created_by
    )
    values (
      format('TRF-%04s', transfer_index),
      'inter_warehouse',
      balance_row.warehouse_id,
      new_wh,
      transfer_status,
      case when transfer_status in ('in_progress', 'completed') then timezone('utc', now()) - make_interval(hours => transfer_index * 2) else null end,
      case when transfer_status = 'completed' then timezone('utc', now()) - make_interval(hours => transfer_index) else null end,
      'Inter-warehouse replenishment between Barbados facilities.',
      driver_user
    )
    returning id into transfer_id;

    insert into public.transfer_lines (
      transfer_id,
      pallet_id,
      product_id,
      client_id,
      quantity,
      inventory_lot_id,
      created_by
    )
    values (
      transfer_id,
      balance_row.pallet_id,
      balance_row.product_id,
      balance_row.client_id,
      greatest(1, least(balance_row.available_quantity, balance_row.quantity)),
      balance_row.inventory_lot_id,
      driver_user
    );

    insert into public.move_tasks (
      task_number,
      pallet_id,
      from_location_id,
      to_location_id,
      warehouse_id,
      transfer_id,
      assigned_user_id,
      status,
      reason,
      completed_at,
      created_by
    )
    values (
      format('MOV-%04s', transfer_index),
      balance_row.pallet_id,
      balance_row.location_id,
      (select id from public.locations where zone_id = new_stg order by code limit 1 offset mod(transfer_index - 1, 20)),
      balance_row.warehouse_id,
      transfer_id,
      driver_user,
      case
        when transfer_status = 'completed' then 'completed'::public.task_status
        when transfer_status = 'in_progress' then 'in_progress'::public.task_status
        else 'queued'::public.task_status
      end,
      'Seeded transfer move task.',
      case when transfer_status = 'completed' then timezone('utc', now()) - make_interval(hours => transfer_index) else null end,
      driver_user
    );

    insert into public.barcode_labels (
      label_type,
      entity_id,
      label_code,
      printed_by,
      reprint_count,
      last_printed_at
    )
    values (
      'transfer_document',
      transfer_id,
      format('TRF-%04s', transfer_index),
      driver_user,
      0,
      timezone('utc', now())
    );

    if transfer_status = 'in_progress' then
      update public.pallets
      set status = 'in_transit',
          current_location_id = null
      where id = balance_row.pallet_id;

      update public.inventory_balances
      set status = 'in_transit',
          zone_id = null,
          location_id = null
      where id = balance_row.id;
    elsif transfer_status = 'completed' then
      update public.pallets
      set current_warehouse_id = new_wh,
          current_location_id = (select id from public.locations where zone_id = new_stg order by code limit 1 offset mod(transfer_index - 1, 20)),
          status = 'available',
          is_stored = true
      where id = balance_row.pallet_id;

      update public.inventory_balances
      set warehouse_id = new_wh,
          zone_id = new_stg,
          location_id = (select id from public.locations where zone_id = new_stg order by code limit 1 offset mod(transfer_index - 1, 20)),
          status = 'available'
      where id = balance_row.id;
    end if;
  end loop;

  for count_index in 1..5 loop
    count_status := case when count_index <= 2 then 'assigned'::public.task_status else 'queued'::public.task_status end;

    insert into public.cycle_counts (
      count_number,
      warehouse_id,
      zone_id,
      location_id,
      scope,
      status,
      assigned_user_id,
      variance_threshold_percent,
      notes,
      created_by
    )
    values (
      format('CNT-%04s', count_index),
      case when count_index <= 3 then new_wh else wildey_wh end,
      case
        when count_index = 1 then new_cr1
        when count_index = 2 then new_stg
        when count_index = 3 then new_qtn
        else wild_amb
      end,
      null,
      case when count_index % 2 = 0 then 'zone'::public.count_scope else 'spot'::public.count_scope end,
      count_status,
      clerk_user,
      5,
      'Seeded cycle count workload.',
      clerk_user
    )
    returning id into cycle_count_id;

    for stock_row in
      select ib.*
      from public.inventory_balances ib
      where ib.warehouse_id = case when count_index <= 3 then new_wh else wildey_wh end
      order by ib.created_at, ib.id
      offset (count_index - 1) * 4
      limit 4
    loop
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
      values (
        cycle_count_id,
        stock_row.location_id,
        stock_row.product_id,
        stock_row.pallet_id,
        stock_row.quantity,
        case when count_index = 2 and mod(stock_row.quantity::integer, 2) = 0 then stock_row.quantity - 2 else stock_row.quantity end,
        case when count_index = 2 and mod(stock_row.quantity::integer, 2) = 0 then -2 else 0 end,
        case when count_index = 2 and mod(stock_row.quantity::integer, 2) = 0 then 10 else 0 end,
        case when count_index = 2 and mod(stock_row.quantity::integer, 2) = 0 then 'exception'::public.task_status else 'completed'::public.task_status end,
        'Seeded count line.',
        clerk_user
      );
    end loop;

    insert into public.barcode_labels (
      label_type,
      entity_id,
      label_code,
      printed_by,
      reprint_count,
      last_printed_at
    )
    values (
      'count_sheet',
      cycle_count_id,
      format('CNT-%04s', count_index),
      clerk_user,
      0,
      timezone('utc', now())
    );
  end loop;

  insert into public.stock_adjustments (
    adjustment_number,
    pallet_id,
    inventory_balance_id,
    adjustment_type,
    quantity_delta,
    old_status,
    new_status,
    reason,
    created_by
  )
  select
    format('STS-%04s', row_number() over (order by ib.id)),
    ib.pallet_id,
    ib.id,
    'status_change',
    0,
    'available'::public.inventory_status,
    ib.status,
    case ib.status
      when 'quarantine' then 'Broken pallet held for QA review'
      when 'damaged' then 'Outer wrap torn and pallet damaged'
      when 'hold' then 'Awaiting customer release'
      when 'missing' then 'Location audit could not find pallet'
      else 'Operational adjustment'
    end,
    clerk_user
  from public.inventory_balances ib
  where ib.status in ('quarantine', 'damaged', 'hold', 'missing');

  insert into public.audit_events (
    event_type,
    entity_table,
    entity_id,
    warehouse_id,
    pallet_id,
    from_location_id,
    to_location_id,
    actor_user_id,
    metadata
  )
  select
    'receipt',
    'receipts',
    r.id,
    r.warehouse_id,
    null,
    null,
    null,
    clerk_user,
    jsonb_build_object('receipt_number', r.receipt_number, 'reference_number', r.reference_number)
  from public.receipts r
  order by r.receipt_number
  limit 20;

  insert into public.audit_events (
    event_type,
    entity_table,
    entity_id,
    warehouse_id,
    pallet_id,
    from_location_id,
    to_location_id,
    actor_user_id,
    metadata
  )
  select
    'putaway',
    'putaway_tasks',
    pt.id,
    pt.warehouse_id,
    pt.pallet_id,
    null,
    pt.suggested_location_id,
    operator_user,
    jsonb_build_object('task_number', pt.task_number)
  from public.putaway_tasks pt;

  insert into public.audit_events (
    event_type,
    entity_table,
    entity_id,
    warehouse_id,
    pallet_id,
    from_location_id,
    to_location_id,
    actor_user_id,
    metadata
  )
  select
    'pick',
    'pick_tasks',
    pt.id,
    pl.warehouse_id,
    pt.pallet_id,
    pt.location_id,
    pt.staging_location_id,
    operator_user,
    jsonb_build_object('task_number', pt.task_number, 'pick_list_number', pl.pick_list_number)
  from public.pick_tasks pt
  join public.pick_lists pl on pl.id = pt.pick_list_id;

  insert into public.audit_events (
    event_type,
    entity_table,
    entity_id,
    warehouse_id,
    pallet_id,
    from_location_id,
    to_location_id,
    actor_user_id,
    metadata
  )
  select
    'transfer_dispatch',
    'transfers',
    t.id,
    t.source_warehouse_id,
    tl.pallet_id,
    null,
    null,
    driver_user,
    jsonb_build_object('transfer_number', t.transfer_number, 'status', t.status)
  from public.transfers t
  join public.transfer_lines tl on tl.transfer_id = t.id;

  insert into public.audit_events (
    event_type,
    entity_table,
    entity_id,
    warehouse_id,
    pallet_id,
    from_location_id,
    to_location_id,
    actor_user_id,
    metadata
  )
  select
    'cycle_count',
    'cycle_counts',
    c.id,
    c.warehouse_id,
    null,
    null,
    null,
    clerk_user,
    jsonb_build_object('count_number', c.count_number, 'scope', c.scope)
  from public.cycle_counts c;

  insert into public.audit_events (
    event_type,
    entity_table,
    entity_id,
    warehouse_id,
    pallet_id,
    from_location_id,
    to_location_id,
    actor_user_id,
    metadata
  )
  select
    'status_change',
    'pallets',
    sa.pallet_id,
    ib.warehouse_id,
    sa.pallet_id,
    ib.location_id,
    ib.location_id,
    clerk_user,
    jsonb_build_object('reason', sa.reason, 'new_status', sa.new_status)
  from public.stock_adjustments sa
  join public.inventory_balances ib on ib.id = sa.inventory_balance_id;
end;
$$;

do $$
declare
  admin_user constant uuid := '11111111-1111-1111-1111-111111111111';
  manager_user constant uuid := '22222222-2222-2222-2222-222222222222';
  clerk_user constant uuid := '33333333-3333-3333-3333-333333333333';
  operator_user constant uuid := '44444444-4444-4444-4444-444444444444';
  new_wh uuid;
  wildey_wh uuid;
  first_receipt uuid;
  cold_receipt uuid;
  source_pallet uuid;
  source_product uuid;
  source_client uuid;
  source_lot uuid;
  source_location uuid;
  dest_location uuid;
  intra_transfer uuid;
  dock_id uuid;
  pick_list_row record;
  label_row record;
  netsuite_connection_id uuid;
  pallet_row record;
begin
  select id into new_wh from public.warehouses where code = 'NEW';
  select id into wildey_wh from public.warehouses where code = 'WLD';

  select id into first_receipt
  from public.receipts
  where receipt_type = 'po'
  order by created_at
  limit 1;

  select r.id into cold_receipt
  from public.receipts r
  join public.receipt_lines rl on rl.receipt_id = r.id
  join public.products p on p.id = rl.product_id
  where r.receipt_type = 'po'
    and p.temperature_requirement = 'cool'
  order by r.created_at
  limit 1;

  update public.receipts
  set reference_number = 'PO-BIM-2026-0509',
      notes = 'Demo inbound PO and shipping manifest: Manifest WW-MAN-2026-0509 from Bridgetown Port, carrier Seawell Logistics, seal BGI-88421, container CMAU-441208-7. Receive, label, inspect, and release to directed putaway.'
  where id = first_receipt;

  update public.receipts
  set reference_number = 'PO-CHILL-2026-0510',
      notes = 'Demo cold-chain PO and refrigerated manifest: Manifest WW-MAN-2026-0510, reefer set point 4 C, QA temperature check required before putaway.'
  where id = cold_receipt;

  insert into public.integration_connections (system, name, base_url, enabled, config, created_by)
  values (
    'netsuite',
    'Demo NetSuite Sandbox',
    'https://netsuite.example.invalid',
    true,
    '{"account":"WW-DEMO","environment":"sandbox","memo":"Seeded for full-flow demo only"}'::jsonb,
    admin_user
  )
  on conflict do nothing;

  select id into netsuite_connection_id
  from public.integration_connections
  where name = 'Demo NetSuite Sandbox'
  order by created_at
  limit 1;

  if netsuite_connection_id is not null then
    insert into public.integration_sync_jobs (connection_id, job_type, status, idempotency_key, payload, result, attempts)
    values
      (
        netsuite_connection_id,
        'purchase_order_import',
        'succeeded',
        'demo-po-bim-2026-0509',
        '{"poNumber":"PO-BIM-2026-0509","manifestNumber":"WW-MAN-2026-0509","carrier":"Seawell Logistics","container":"CMAU-441208-7","lines":4}'::jsonb,
        '{"recordsCreated":["receipts","receipt_lines","pallets","putaway_tasks"]}'::jsonb,
        1
      ),
      (
        netsuite_connection_id,
        'inventory_adjustment_export',
        'queued',
        'demo-cycle-count-adjustments',
        '{"reason":"cycle_count_variance","source":"Warehouse Wizard demo"}'::jsonb,
        null,
        0
      )
    on conflict (connection_id, idempotency_key) do nothing;

    insert into public.external_record_links (system, local_table, local_id, external_record_type, external_id, external_url, last_synced_at)
    select 'netsuite', 'receipts', r.id, 'purchaseOrder', r.reference_number, format('https://netsuite.example.invalid/app/accounting/transactions/purchord.nl?id=%s', r.reference_number), timezone('utc', now())
    from public.receipts r
    where r.reference_number in ('PO-BIM-2026-0509', 'PO-CHILL-2026-0510')
    on conflict (system, local_table, local_id, external_record_type) do update
    set external_id = excluded.external_id,
        external_url = excluded.external_url,
        last_synced_at = excluded.last_synced_at;
  end if;

  insert into public.ai_recommendations (recommendation_key, title, severity, audience, reason, next_action, context)
  values
    (
      'demo-receiving-putaway',
      'Inbound PO is ready for receiving and directed putaway',
      'info',
      array['warehouse_manager'::public.app_role_code, 'inventory_clerk'::public.app_role_code],
      'The demo manifest PO-BIM-2026-0509 has pallet labels, receipt lines, and queued putaway tasks.',
      'Open Receiving, confirm the PO reference, then work the Putaway queue by scanning pallet and location.',
      '{"po":"PO-BIM-2026-0509","manifest":"WW-MAN-2026-0509"}'::jsonb
    ),
    (
      'demo-transfer-flow',
      'Transfer lanes show queued, in-transit, received, and completed work',
      'warning',
      array['warehouse_manager'::public.app_role_code, 'dispatch_driver'::public.app_role_code],
      'Seeded inter-warehouse and intra-warehouse transfers cover driver sign-off, receiving, and post-transfer putaway.',
      'Dispatch TRF-0002, receive TRF-0001, and compare completed transfer audit history.',
      '{"flows":["inter_warehouse","intra_warehouse","driver_signoff"]}'::jsonb
    )
  on conflict do nothing;

  insert into public.dock_appointments (appointment_number, warehouse_id, dock_door, carrier, driver_name, scheduled_at, status)
  values
    ('APPT-IN-0509', new_wh, 'IN-02', 'Seawell Logistics', 'Marlon Best', timezone('utc', now()) + interval '2 hours', 'queued'),
    ('APPT-OUT-0510', new_wh, 'OUT-01', 'Island Freight', 'Janelle Ifill', timezone('utc', now()) + interval '5 hours', 'assigned'),
    ('APPT-XFER-WLD', wildey_wh, 'XFER-01', 'Warehouse Wizard Fleet', 'Janelle Ifill', timezone('utc', now()) + interval '1 hour', 'in_progress')
  on conflict (appointment_number) do nothing;

  select id into dock_id
  from public.dock_appointments
  where appointment_number = 'APPT-OUT-0510';

  for pick_list_row in
    select id, pick_list_number, row_number() over (order by created_at) as rn
    from public.pick_lists
    where warehouse_id = new_wh
    order by created_at
    limit 4
  loop
    insert into public.staging_loads (pick_list_id, dock_appointment_id, route_code, load_sequence, status, blocker)
    values (
      pick_list_row.id,
      dock_id,
      format('BGI-%s', lpad(pick_list_row.rn::text, 2, '0')),
      pick_list_row.rn * 10,
      case pick_list_row.rn when 1 then 'ready' when 2 then 'called' when 3 then 'loading' else 'blocked' end,
      case when pick_list_row.rn = 4 then 'QA release required before loading' else null end
    )
    on conflict do nothing;
  end loop;

  insert into public.quality_inspections (inspection_number, pallet_id, receipt_id, disposition, pass_fail_criteria, root_cause_code, corrective_action, inspected_by, completed_at)
  select
    format('QA-%s', p.pallet_code),
    p.id,
    r.id,
    case when p.status = 'quarantine' then 'hold'::public.quality_disposition else 'pass'::public.quality_disposition end,
    jsonb_build_object('seal', 'verified', 'temperature', case when pr.temperature_requirement = 'cool' then '4 C' else 'ambient ok' end, 'wrap', 'intact'),
    case when p.status = 'quarantine' then 'DAMAGED_WRAP' else null end,
    case when p.status = 'quarantine' then 'Hold for customer disposition; photograph and rewrap.' else 'Released to putaway.' end,
    clerk_user,
    timezone('utc', now()) - interval '30 minutes'
  from public.pallets p
  join public.receipt_lines rl on rl.id = p.receipt_line_id
  join public.receipts r on r.id = rl.receipt_id
  join public.products pr on pr.id = p.product_id
  where r.id in (first_receipt, cold_receipt)
  order by p.created_at
  limit 8
  on conflict (inspection_number) do nothing;

  insert into public.return_authorizations (rma_number, client_id, warehouse_id, status, disposition, reason, completed_at)
  select 'RMA-DEMO-0509', c.id, new_wh, 'queued', 'pending', 'Customer reports crushed case; receive to quarantine and inspect.', null
  from public.clients c
  where c.code = 'ISLAND'
  on conflict (rma_number) do nothing;

  select ib.pallet_id, ib.product_id, ib.client_id, ib.inventory_lot_id, ib.location_id
    into source_pallet, source_product, source_client, source_lot, source_location
  from public.inventory_balances ib
  where ib.warehouse_id = new_wh
    and ib.status = 'available'
    and ib.location_id is not null
  order by ib.created_at
  limit 1;

  select id into dest_location
  from public.locations
  where warehouse_id = new_wh
    and id <> source_location
    and location_type = 'staging'
  order by code
  limit 1;

  if source_pallet is not null and dest_location is not null then
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
      'TRF-INTRA-0509',
      'intra_warehouse',
      new_wh,
      new_wh,
      'queued',
      'Intra-warehouse slot move from reserve rack to staging for replenishment and demo scanning.',
      manager_user
    )
    on conflict (transfer_number) do update
    set notes = excluded.notes
    returning id into intra_transfer;

    insert into public.transfer_lines (transfer_id, pallet_id, product_id, client_id, quantity, inventory_lot_id, created_by)
    values (intra_transfer, source_pallet, source_product, source_client, 4, source_lot, manager_user)
    on conflict do nothing;

    insert into public.move_tasks (
      task_number,
      pallet_id,
      from_location_id,
      to_location_id,
      warehouse_id,
      transfer_id,
      assigned_user_id,
      status,
      reason,
      created_by
    )
    values (
      'MOV-INTRA-0509',
      source_pallet,
      source_location,
      dest_location,
      new_wh,
      intra_transfer,
      operator_user,
      'queued',
      'Seeded intra-warehouse transfer move.',
      manager_user
    )
    on conflict (task_number) do nothing;

    insert into public.replenishment_tasks (
      task_number,
      product_id,
      warehouse_id,
      from_location_id,
      to_location_id,
      reorder_point,
      target_quantity,
      status,
      assigned_user_id
    )
    values (
      'RPL-DEMO-0509',
      source_product,
      new_wh,
      source_location,
      dest_location,
      10,
      48,
      'queued',
      operator_user
    )
    on conflict (task_number) do nothing;
  end if;

  for pallet_row in
    select p.id, p.pallet_code, ib.id as balance_id, ib.warehouse_id
    from public.pallets p
    join public.inventory_balances ib on ib.pallet_id = p.id
    where ib.status = 'available'
    order by ib.created_at
    limit 2
  loop
    update public.pallets
    set status = case when pallet_row.pallet_code < (select max(pallet_code) from public.pallets) then 'hold'::public.inventory_status else 'missing'::public.inventory_status end
    where id = pallet_row.id;

    update public.inventory_balances
    set status = case when pallet_row.pallet_code < (select max(pallet_code) from public.pallets) then 'hold'::public.inventory_status else 'missing'::public.inventory_status end
    where id = pallet_row.balance_id;

    insert into public.stock_adjustments (
      adjustment_number,
      pallet_id,
      inventory_balance_id,
      adjustment_type,
      quantity_delta,
      old_status,
      new_status,
      reason,
      created_by
    )
    values (
      format('STS-DEMO-%s', right(pallet_row.pallet_code, 5)),
      pallet_row.id,
      pallet_row.balance_id,
      'status_change',
      0,
      'available',
      case when pallet_row.pallet_code < (select max(pallet_code) from public.pallets) then 'hold'::public.inventory_status else 'missing'::public.inventory_status end,
      'Demo controlled-status workflow for hold/missing investigation.',
      clerk_user
    )
    on conflict do nothing;
  end loop;

  for label_row in
    select bl.id, bl.label_code, bl.label_type
    from public.barcode_labels bl
    order by bl.created_at desc
    limit 12
  loop
    insert into public.print_jobs (
      barcode_label_id,
      label_template_id,
      status,
      zpl_payload,
      requested_by,
      sent_at,
      printed_at
    )
    select
      label_row.id,
      lt.id,
      case when label_row.label_type = 'transfer_document' then 'sent'::public.print_job_status else 'printed'::public.print_job_status end,
      format('^XA^FO40,40^A0N,36,36^FD%s^FS^FO40,100^BY2^BCN,80,Y,N,N^FD%s^FS^XZ', upper(label_row.label_type::text), label_row.label_code),
      clerk_user,
      timezone('utc', now()) - interval '10 minutes',
      case when label_row.label_type = 'transfer_document' then null else timezone('utc', now()) - interval '8 minutes' end
    from public.label_templates lt
    where lt.label_type = case when label_row.label_type = 'transfer_document' then 'pallet'::public.label_type else label_row.label_type end
    order by lt.created_at
    limit 1
    on conflict do nothing;
  end loop;

  insert into public.work_templates (code, workflow, priority, query_rules, step_rules)
  values
    ('FULL-FLOW-DEMO-RECEIVE', 'receiving_to_putaway', 10, '{"receiptType":"po","reference":"PO-BIM-2026-0509"}'::jsonb, '["scan_manifest","receive_pallet","print_label","qa_check","directed_putaway"]'::jsonb),
    ('FULL-FLOW-DEMO-TRANSFER', 'interwarehouse_transfer', 20, '{"requiresDriverSignoff":true}'::jsonb, '["create_transfer","stage_pallet","driver_signoff","receive_destination","putaway"]'::jsonb),
    ('FULL-FLOW-DEMO-COUNT', 'cycle_count_variance', 30, '{"varianceThresholdPercent":5}'::jsonb, '["print_count_sheet","count_location","record_variance","adjust_stock","export_netsuite"]'::jsonb)
  on conflict (code) do update
  set query_rules = excluded.query_rules,
      step_rules = excluded.step_rules,
      active = true;
end;
$$;
