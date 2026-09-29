create or replace function public.reset_wms_data()
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  actor_user uuid := auth.uid();
  preserved_user_ids uuid[];
  preserved_user_count integer := 0;
  removed_user_count integer := 0;
  developer_role_id uuid;
  admin_role_id uuid;
  preserved_id uuid;
  reset_group_one text[] := array[
    'email_send_log',
    'suppressed_emails',
    'email_unsubscribe_tokens',
    'user_device_trust',
    'ai_recommendations',
    'integration_payload_logs',
    'integration_dead_letters',
    'integration_sync_jobs',
    'external_record_links',
    'integration_connections',
    'report_exports',
    'report_definitions',
    'print_jobs',
    'label_templates',
    'printer_stations',
    'work_templates',
    'client_variables',
    'licence_events',
    'deployment_subscription',
    'system_logs'
  ];
  reset_group_two text[] := array[
    'audit_events',
    'barcode_labels',
    'stock_adjustments',
    'cycle_count_lines',
    'cycle_counts',
    'staging_loads',
    'dock_appointments',
    'replenishment_tasks',
    'quality_inspections',
    'return_authorizations',
    'transfer_lines',
    'transfers',
    'pick_tasks',
    'pick_lists',
    'order_lines',
    'orders',
    'move_tasks',
    'putaway_tasks',
    'inventory_balances',
    'pallets',
    'receipt_lines',
    'receipts',
    'inventory_lots',
    'product_packaging_profiles',
    'products',
    'clients',
    'locations',
    'zones',
    'warehouses'
  ];
  existing_tables text[];
  truncate_list text;
  has_user_roles_hidden_at boolean := false;
  has_user_roles_hidden_reason boolean := false;
  has_user_roles_updated_at boolean := false;
  user_roles_update_sql text := 'update public.user_roles set warehouse_id = null, is_hidden = false';
begin
  if actor_user is null or not (
    public.has_role(actor_user, 'admin') or public.has_role(actor_user, 'developer')
  ) then
    raise exception 'Only admins and developers can reset the WMS environment';
  end if;

  select coalesce(array_agg(distinct preserved.id), '{}'::uuid[])
  into preserved_user_ids
  from (
    select au.id
    from auth.users au
    left join public.user_roles ur on ur.user_id = au.id
    left join public.roles r on r.id = ur.role_id
    left join public.profiles p on p.id = au.id
    where r.code = 'developer'
       or lower(coalesce(au.email, '')) = 'russelljhunte@gmail.com'
       or lower(coalesce(p.email, '')) = 'russelljhunte@gmail.com'
  ) preserved;

  if coalesce(array_length(preserved_user_ids, 1), 0) = 0 then
    preserved_user_ids := array[actor_user];
  elsif not actor_user = any(preserved_user_ids) then
    preserved_user_ids := array_append(preserved_user_ids, actor_user);
  end if;

  insert into public.profiles (id, full_name, email, phone, approved, active)
  select
    au.id,
    coalesce(au.raw_user_meta_data->>'full_name', au.raw_user_meta_data->>'name', ''),
    coalesce(au.email, ''),
    coalesce(au.raw_user_meta_data->>'phone', au.phone, ''),
    true,
    true
  from auth.users au
  where au.id = any(preserved_user_ids)
  on conflict (id) do update
    set full_name = coalesce(excluded.full_name, public.profiles.full_name),
        email = coalesce(nullif(excluded.email, ''), public.profiles.email),
        phone = coalesce(nullif(excluded.phone, ''), public.profiles.phone),
        approved = true,
        active = true,
        updated_at = timezone('utc', now());

  select count(*) into removed_user_count
  from auth.users
  where not (id = any(preserved_user_ids));

  update public.profiles
  set default_warehouse_id = null,
      active = true,
      approved = true,
      updated_at = timezone('utc', now())
  where id = any(preserved_user_ids);

  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'user_roles' and column_name = 'hidden_at'
  ) into has_user_roles_hidden_at;

  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'user_roles' and column_name = 'hidden_reason'
  ) into has_user_roles_hidden_reason;

  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'user_roles' and column_name = 'updated_at'
  ) into has_user_roles_updated_at;

  if has_user_roles_hidden_at then
    user_roles_update_sql := user_roles_update_sql || ', hidden_at = null';
  end if;
  if has_user_roles_hidden_reason then
    user_roles_update_sql := user_roles_update_sql || ', hidden_reason = null';
  end if;
  if has_user_roles_updated_at then
    user_roles_update_sql := user_roles_update_sql || ', updated_at = timezone(''utc'', now())';
  end if;

  user_roles_update_sql := user_roles_update_sql || ' where user_id = any($1)';
  execute user_roles_update_sql using preserved_user_ids;

  select array_agg(format('%I.%I', table_schema, table_name) order by array_position(reset_group_one, table_name))
  into existing_tables
  from information_schema.tables
  where table_schema = 'public'
    and table_name = any(reset_group_one);

  if coalesce(array_length(existing_tables, 1), 0) > 0 then
    truncate_list := array_to_string(existing_tables, ', ');
    execute 'truncate table ' || truncate_list || ' restart identity cascade';
  end if;

  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'email_send_state'
  ) then
    insert into public.email_send_state (
      id,
      retry_after_until,
      batch_size,
      send_delay_ms,
      auth_email_ttl_minutes,
      transactional_email_ttl_minutes,
      updated_at
    )
    values (1, null, 10, 200, 15, 60, timezone('utc', now()))
    on conflict (id) do update
      set retry_after_until = excluded.retry_after_until,
          batch_size = excluded.batch_size,
          send_delay_ms = excluded.send_delay_ms,
          auth_email_ttl_minutes = excluded.auth_email_ttl_minutes,
          transactional_email_ttl_minutes = excluded.transactional_email_ttl_minutes,
          updated_at = excluded.updated_at;
  end if;

  select array_agg(format('%I.%I', table_schema, table_name) order by array_position(reset_group_two, table_name))
  into existing_tables
  from information_schema.tables
  where table_schema = 'public'
    and table_name = any(reset_group_two);

  if coalesce(array_length(existing_tables, 1), 0) > 0 then
    truncate_list := array_to_string(existing_tables, ', ');
    execute 'truncate table ' || truncate_list || ' restart identity cascade';
  end if;

  delete from auth.users
  where not (id = any(preserved_user_ids));

  delete from public.profiles
  where not (id = any(preserved_user_ids));

  delete from public.user_roles
  where not (user_id = any(preserved_user_ids));

  select id into developer_role_id from public.roles where code = 'developer';
  select id into admin_role_id from public.roles where code = 'admin';

  foreach preserved_id in array preserved_user_ids loop
    insert into public.profiles (id, full_name, email, phone, approved, active)
    select
      au.id,
      coalesce(au.raw_user_meta_data->>'full_name', au.raw_user_meta_data->>'name', ''),
      coalesce(au.email, ''),
      coalesce(au.raw_user_meta_data->>'phone', au.phone, ''),
      true,
      true
    from auth.users au
    where au.id = preserved_id
    on conflict (id) do update
      set email = coalesce(nullif(excluded.email, ''), public.profiles.email),
          phone = coalesce(nullif(excluded.phone, ''), public.profiles.phone),
          approved = true,
          active = true,
          updated_at = timezone('utc', now());

    if developer_role_id is not null
       and exists (select 1 from public.profiles where id = preserved_id)
       and not exists (
         select 1 from public.user_roles
         where user_id = preserved_id and role_id = developer_role_id and warehouse_id is null
       )
    then
      insert into public.user_roles (user_id, role_id, warehouse_id)
      values (preserved_id, developer_role_id, null);
    end if;

    if admin_role_id is not null
       and exists (select 1 from public.profiles where id = preserved_id)
       and not exists (
         select 1 from public.user_roles
         where user_id = preserved_id and role_id = admin_role_id and warehouse_id is null
       )
    then
      insert into public.user_roles (user_id, role_id, warehouse_id)
      values (preserved_id, admin_role_id, null);
    end if;
  end loop;

  select count(*) into preserved_user_count
  from public.profiles
  where id = any(preserved_user_ids);

  return jsonb_build_object(
    'status', 'ok',
    'message', 'Warehouse data reset complete. Launch the setup wizard to rebuild the environment.',
    'removed_users', removed_user_count,
    'deleted_users', removed_user_count,
    'preserved_users', preserved_user_count,
    'kept_users', preserved_user_count
  );
end;
$function$;