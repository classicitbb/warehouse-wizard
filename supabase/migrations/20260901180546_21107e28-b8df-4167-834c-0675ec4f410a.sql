create or replace function public.evaluate_reorder_alert(in_product_id uuid, in_warehouse_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  product_row public.products%rowtype;
  settings_row public.reorder_forecast_settings%rowtype;
  available_stock numeric := 0;
  usage_total numeric := 0;
  daily_usage numeric := 0;
  projected_usage numeric := 0;
  threshold numeric := 0;
  target_quantity numeric := 0;
  created_alert_id uuid;
begin
  select * into product_row from public.products where id = in_product_id;
  if not found then
    return;
  end if;

  if product_row.maximum_stock_level <= 0 then
    update public.reorder_alerts
       set status = 'resolved', resolved_at = now()
     where product_id = in_product_id
       and warehouse_id = in_warehouse_id
       and status = 'active';
    return;
  end if;

  select * into settings_row from public.reorder_forecast_settings where id = true;
  if not found then
    insert into public.reorder_forecast_settings (id) values (true)
      on conflict (id) do nothing;
    select * into settings_row from public.reorder_forecast_settings where id = true;
  end if;

  select coalesce(sum(ib.available_quantity), 0)
    into available_stock
    from public.inventory_balances ib
   where ib.product_id = in_product_id
     and ib.warehouse_id = in_warehouse_id
     and ib.status = 'available';

  select coalesce(sum(pt.confirmed_quantity), 0)
    into usage_total
    from public.pick_tasks pt
    join public.pick_lists pl on pl.id = pt.pick_list_id
    join public.pallets pallet on pallet.id = pt.pallet_id
   where pallet.product_id = in_product_id
     and pl.warehouse_id = in_warehouse_id
     and pt.status = 'completed'
     and pt.completed_at >= now() - make_interval(days => settings_row.lookback_days);

  daily_usage := usage_total / greatest(settings_row.lookback_days, 1);
  projected_usage := daily_usage * (product_row.supplier_lead_time_days + settings_row.safety_lead_days);
  threshold := greatest(product_row.minimum_stock_level, projected_usage)
    * (settings_row.alert_threshold_percent / 100.0);
  target_quantity := greatest(product_row.maximum_stock_level - available_stock, 0);

  if available_stock <= threshold then
    insert into public.reorder_alerts (
      product_id, warehouse_id, available_quantity, daily_demand,
      projected_lead_demand, reorder_point, recommended_quantity
    )
    values (
      in_product_id, in_warehouse_id, available_stock, daily_usage,
      projected_usage, threshold, target_quantity
    )
    on conflict (product_id, warehouse_id) where status = 'active' do nothing
    returning id into created_alert_id;
  else
    update public.reorder_alerts
       set status = 'resolved', resolved_at = now()
     where product_id = in_product_id
       and warehouse_id = in_warehouse_id
       and status = 'active';
  end if;
end;
$function$;

create or replace function public.notify_operator_ticket_submitted()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  reporter_email text;
  wh_name text;
  log_severity text;
  log_type text;
  ticket_ref text;
begin
  ticket_ref := coalesce(new.ticket_number, left(new.id::text, 8));

  select p.email into reporter_email
    from public.profiles p where p.id = new.reported_by;
  if new.warehouse_id is not null then
    select w.name into wh_name from public.warehouses w where w.id = new.warehouse_id;
  end if;

  log_type := case when new.kind = 'bug' then 'bug' else 'info' end;
  log_severity := case new.severity
    when 'critical' then 'critical'
    when 'high' then 'error'
    else 'info' end;

  begin
    insert into public.system_logs (
      level, source, message, log_type, severity, title, details, table_name, created_by
    ) values (
      log_severity::public.system_log_level,
      'copilot.report',
      coalesce(nullif(new.title, ''), 'Operator report'),
      log_type,
      log_severity,
      format('Report %s — %s', ticket_ref, coalesce(nullif(new.title, ''), 'Operator report')),
      jsonb_build_object(
        'ticket_id', new.id,
        'ticket_number', new.ticket_number,
        'kind', new.kind,
        'severity', new.severity,
        'route', new.route,
        'module', new.module,
        'app_version', new.app_version,
        'warehouse', wh_name,
        'reported_by', new.reported_by,
        'reporter_email', reporter_email,
        'screenshot_path', new.screenshot_path,
        'actual_behavior', new.actual_behavior,
        'expected_behavior', new.expected_behavior,
        'steps_to_reproduce', new.steps_to_reproduce,
        'summary', new.summary
      ),
      'operator_tickets',
      new.reported_by
    );
  exception when others then
    raise warning 'operator ticket system log failed: %', sqlerrm;
  end;

  return new;
end;
$function$;