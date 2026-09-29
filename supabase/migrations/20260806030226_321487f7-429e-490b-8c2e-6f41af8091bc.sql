create or replace function public.evaluate_reorder_alert(in_product_id uuid, in_warehouse_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
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
  recipient record;
  wh_name text;
  tpl record;
  msg_id text;
  unsub text;
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

    if created_alert_id is not null and settings_row.email_enabled then
      select w.name into wh_name from public.warehouses w where w.id = in_warehouse_id;

      select r.subject, r.html_body, r.text_body
        into tpl
        from public.render_notification_email(
          'reorder-alert',
          jsonb_build_object(
            'sku', product_row.sku,
            'product_name', product_row.name,
            'warehouse_name', coalesce(wh_name, ''),
            'available', round(available_stock, 2)::text,
            'reorder_point', round(threshold, 2)::text,
            'recommended', round(target_quantity, 2)::text
          )
        ) r;

      for recipient in
        select distinct p.email
          from public.profiles p
          join public.user_roles ur on ur.user_id = p.id and coalesce(ur.is_hidden, false) = false
          join public.roles r on r.id = ur.role_id
         where p.active = true
           and p.approved = true
           and p.email is not null
           and r.code::text in ('admin', 'warehouse_manager')
      loop
        msg_id := gen_random_uuid()::text;
        unsub := public.get_or_create_unsubscribe_token(recipient.email);
        perform public.enqueue_email(
          'transactional_emails',
          jsonb_build_object(
            'message_id', msg_id,
            'idempotency_key', msg_id,
            'unsubscribe_token', unsub,
            'to', recipient.email,
            'from', 'Warehouse Wizard <noreply@mail.warehousewizard.app>',
            'sender_domain', 'mail.warehousewizard.app',
            'subject', tpl.subject,
            'html', tpl.html_body,
            'text', tpl.text_body,
            'purpose', 'transactional',
            'label', 'reorder-alert',
            'queued_at', now()::text
          )
        );
      end loop;
      update public.reorder_alerts set email_queued_at = now() where id = created_alert_id;
    end if;
  else
    update public.reorder_alerts
       set status = 'resolved', resolved_at = now()
     where product_id = in_product_id
       and warehouse_id = in_warehouse_id
       and status = 'active';
  end if;
end;
$$;