-- Product replenishment controls, forecast alerts, and administrator session revocation.

alter table public.products
  add column if not exists minimum_stock_level numeric not null default 0,
  add column if not exists maximum_stock_level numeric not null default 0,
  add column if not exists pick_down_to_level numeric not null default 0,
  add column if not exists supplier_lead_time_days integer not null default 0;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'products_stock_levels_non_negative') then
    alter table public.products add constraint products_stock_levels_non_negative
      check (minimum_stock_level >= 0 and maximum_stock_level >= 0 and pick_down_to_level >= 0 and supplier_lead_time_days >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'products_stock_level_order') then
    alter table public.products add constraint products_stock_level_order
      check (maximum_stock_level >= minimum_stock_level and pick_down_to_level <= maximum_stock_level);
  end if;
end $$;

create table if not exists public.reorder_forecast_settings (
  id boolean primary key default true check (id),
  lookback_days integer not null default 30 check (lookback_days between 7 and 365),
  safety_lead_days integer not null default 0 check (safety_lead_days between 0 and 90),
  alert_threshold_percent numeric not null default 100 check (alert_threshold_percent between 25 and 200),
  email_enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);

insert into public.reorder_forecast_settings (id) values (true) on conflict (id) do nothing;

create table if not exists public.reorder_alerts (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  warehouse_id uuid not null references public.warehouses(id) on delete cascade,
  status text not null default 'active' check (status in ('active', 'resolved')),
  available_quantity numeric not null default 0,
  daily_demand numeric not null default 0,
  projected_lead_demand numeric not null default 0,
  reorder_point numeric not null default 0,
  recommended_quantity numeric not null default 0,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  email_queued_at timestamptz
);

create unique index if not exists reorder_alerts_one_active_per_product_warehouse
  on public.reorder_alerts(product_id, warehouse_id) where status = 'active';
create index if not exists reorder_alerts_active_created_at
  on public.reorder_alerts(status, created_at desc);

alter table public.reorder_forecast_settings enable row level security;
alter table public.reorder_alerts enable row level security;

create policy "Approved users read reorder settings"
  on public.reorder_forecast_settings for select to authenticated using (public.is_approved());
create policy "Admins manage reorder settings"
  on public.reorder_forecast_settings for all to authenticated
  using (public.has_any_role(array['admin'::public.app_role_code, 'developer'::public.app_role_code]))
  with check (public.has_any_role(array['admin'::public.app_role_code, 'developer'::public.app_role_code]));
create policy "Approved users read reorder alerts"
  on public.reorder_alerts for select to authenticated using (public.is_approved());

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
        perform public.enqueue_email(
          'transactional_emails',
          jsonb_build_object(
            'run_id', gen_random_uuid()::text,
            'message_id', gen_random_uuid()::text,
            'to', recipient.email,
            'from', 'Warehouse Wizard <noreply@warehousewizard.app>',
            'sender_domain', 'notify.warehousewizard.app',
            'subject', format('Reorder alert: %s', product_row.sku),
            'html', format('<h2>Reorder alert</h2><p><strong>%s — %s</strong> is at %s available.</p><p>Reorder point: %s. Recommended replenishment: %s.</p>', product_row.sku, product_row.name, available_stock, threshold, target_quantity),
            'text', format('Reorder alert: %s — %s is at %s available. Reorder point: %s. Recommended replenishment: %s.', product_row.sku, product_row.name, available_stock, threshold, target_quantity),
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

create or replace function public.refresh_reorder_alerts()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target record;
begin
  for target in
    select distinct ib.product_id, ib.warehouse_id
      from public.inventory_balances ib
      join public.products p on p.id = ib.product_id
     where p.maximum_stock_level > 0
  loop
    perform public.evaluate_reorder_alert(target.product_id, target.warehouse_id);
  end loop;
end;
$$;

create or replace function public.refresh_reorder_alert_from_balance()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.product_id is not null and new.warehouse_id is not null then
    perform public.evaluate_reorder_alert(new.product_id, new.warehouse_id);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_refresh_reorder_alert_from_balance on public.inventory_balances;
create trigger trg_refresh_reorder_alert_from_balance
  after insert or update of available_quantity, status, product_id, warehouse_id on public.inventory_balances
  for each row execute function public.refresh_reorder_alert_from_balance();

create or replace function public.refresh_reorder_alert_from_product()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.refresh_reorder_alerts();
  return new;
end;
$$;

drop trigger if exists trg_refresh_reorder_alert_from_product on public.products;
create trigger trg_refresh_reorder_alert_from_product
  after update of minimum_stock_level, maximum_stock_level, pick_down_to_level, supplier_lead_time_days on public.products
  for each row execute function public.refresh_reorder_alert_from_product();

create or replace function public.refresh_reorder_alert_from_settings()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.refresh_reorder_alerts();
  return new;
end;
$$;

drop trigger if exists trg_refresh_reorder_alert_from_settings on public.reorder_forecast_settings;
create trigger trg_refresh_reorder_alert_from_settings
  after update of lookback_days, safety_lead_days, alert_threshold_percent, email_enabled on public.reorder_forecast_settings
  for each row execute function public.refresh_reorder_alert_from_settings();

create or replace function public.admin_sign_out_all_sessions(in_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
begin
  if not public.has_any_role(array['admin'::public.app_role_code, 'developer'::public.app_role_code]) then
    raise exception 'Only administrators can sign out user sessions';
  end if;

  delete from auth.sessions where user_id = in_user_id;
  delete from public.user_device_trust where user_id = in_user_id;
end;
$$;

revoke all on function public.evaluate_reorder_alert(uuid, uuid) from public, anon, authenticated;
revoke all on function public.refresh_reorder_alerts() from public, anon;
revoke all on function public.admin_sign_out_all_sessions(uuid) from public, anon;
grant execute on function public.refresh_reorder_alerts() to authenticated;
grant execute on function public.admin_sign_out_all_sessions(uuid) to authenticated;
