-- Notification email templates (plaintext + HTML) + reorder-alert run_id fix
--
-- ROOT CAUSE FIXED HERE
-- evaluate_reorder_alert previously enqueued transactional emails with a
-- fabricated 'run_id' (gen_random_uuid()). The Lovable Email API validates
-- run_id against real agent/webhook runs and returns
--   404 {"type":"run_not_found","title":"Run not found or expired"}
-- for any random UUID, so every reorder-alert email failed all 5 retries and
-- landed in the transactional_emails_dlq. run_id is OPTIONAL for transactional
-- sends (it is only used as an idempotency fallback in @lovable.dev/email-js),
-- so we now omit it entirely and set an explicit idempotency_key instead.
--
-- This migration also introduces a reusable notification-email template layer
-- so every notification type renders a consistent plaintext + HTML body from a
-- single place (public.render_notification_email).

-- ============================================================
-- 1. Shared, email-safe HTML shell for all notification types
-- ============================================================
create or replace function public.notification_email_shell(in_title text, in_body_html text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select
    '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">'
    || '<meta name="viewport" content="width=device-width, initial-scale=1"></head>'
    || '<body style="margin:0;padding:0;background:#f4f5f7;'
    || 'font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">'
    || '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" '
    || 'style="background:#f4f5f7;padding:24px 0;"><tr><td align="center">'
    || '<table role="presentation" width="600" cellpadding="0" cellspacing="0" '
    || 'style="max-width:600px;width:100%;background:#ffffff;border-radius:8px;'
    || 'overflow:hidden;border:1px solid #e5e7eb;">'
    || '<tr><td style="background:#0f172a;padding:20px 28px;">'
    || '<span style="color:#ffffff;font-size:18px;font-weight:600;">Warehouse Wizard</span></td></tr>'
    || '<tr><td style="padding:28px;">'
    || format('<h1 style="margin:0 0 16px;font-size:20px;color:#0f172a;">%s</h1>', in_title)
    || in_body_html
    || '</td></tr>'
    || '<tr><td style="padding:18px 28px;border-top:1px solid #e5e7eb;color:#94a3b8;font-size:12px;">'
    || 'This is an automated notification from Warehouse Wizard.</td></tr>'
    || '</table></td></tr></table></body></html>';
$$;

-- ============================================================
-- 2. Notification template registry
--    Returns a rendered (subject, html_body, text_body) for a
--    given notification kind + data payload. Add new notification
--    types as additional branches here so all types stay in one place.
-- ============================================================
create or replace function public.render_notification_email(in_kind text, in_data jsonb)
returns table(subject text, html_body text, text_body text)
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  sku text;
  pname text;
  wh text;
  available text;
  reorder_point text;
  recommended text;
  body_html text;
begin
  if in_kind = 'reorder-alert' then
    sku           := coalesce(in_data->>'sku', '');
    pname         := coalesce(in_data->>'product_name', '');
    wh            := coalesce(nullif(in_data->>'warehouse_name', ''), 'your warehouse');
    available     := coalesce(in_data->>'available', '0');
    reorder_point := coalesce(in_data->>'reorder_point', '0');
    recommended   := coalesce(in_data->>'recommended', '0');

    subject := format('Reorder alert: %s (%s)', sku, pname);

    body_html :=
      format('<p style="margin:0 0 16px;color:#334155;font-size:15px;line-height:1.5;">'
        || '<strong>%s &mdash; %s</strong> in <strong>%s</strong> has dropped to '
        || '<strong>%s</strong> units available.</p>', sku, pname, wh, available)
      || '<table role="presentation" cellpadding="0" cellspacing="0" '
      || 'style="width:100%;border-collapse:collapse;margin:0 0 20px;">'
      || format('<tr><td style="padding:8px 0;color:#64748b;font-size:14px;">Available</td>'
        || '<td style="padding:8px 0;text-align:right;color:#0f172a;font-size:14px;font-weight:600;">%s</td></tr>',
        available)
      || format('<tr><td style="padding:8px 0;color:#64748b;font-size:14px;border-top:1px solid #f1f5f9;">Reorder point</td>'
        || '<td style="padding:8px 0;text-align:right;color:#0f172a;font-size:14px;font-weight:600;border-top:1px solid #f1f5f9;">%s</td></tr>',
        reorder_point)
      || format('<tr><td style="padding:8px 0;color:#64748b;font-size:14px;border-top:1px solid #f1f5f9;">Recommended replenishment</td>'
        || '<td style="padding:8px 0;text-align:right;color:#0f172a;font-size:14px;font-weight:600;border-top:1px solid #f1f5f9;">%s</td></tr>',
        recommended)
      || '</table>'
      || '<p style="margin:0;color:#64748b;font-size:13px;line-height:1.5;">'
      || 'Review this item in Warehouse Wizard and raise a purchase order if needed.</p>';

    html_body := public.notification_email_shell(subject, body_html);

    text_body :=
         format(E'Reorder alert: %s — %s\n\n', sku, pname)
      || format(E'Warehouse: %s\n', wh)
      || format(E'Available: %s\n', available)
      || format(E'Reorder point: %s\n', reorder_point)
      || format(E'Recommended replenishment: %s\n\n', recommended)
      || E'Review this item in Warehouse Wizard and raise a purchase order if needed.\n\n'
      || E'— Warehouse Wizard (automated notification)';

    return next;
    return;
  end if;

  -- Generic fallback: any future notification kind can pass subject/body/text.
  subject   := coalesce(nullif(in_data->>'subject', ''), 'Warehouse Wizard notification');
  text_body := coalesce(nullif(in_data->>'text', ''), subject);
  html_body := public.notification_email_shell(
    subject,
    format('<p style="margin:0;color:#334155;font-size:15px;line-height:1.5;">%s</p>',
      coalesce(nullif(in_data->>'body', ''), text_body)));
  return next;
end;
$$;

revoke all on function public.notification_email_shell(text, text) from public, anon, authenticated;
revoke all on function public.render_notification_email(text, jsonb) from public, anon, authenticated;

-- ============================================================
-- 2b. Per-recipient unsubscribe token (get-or-create).
--     The Lovable Email API rejects transactional sends that lack an
--     unsubscribe_token (400 missing_unsubscribe), so every notification
--     recipient needs a stable token embedded in the List-Unsubscribe link.
-- ============================================================
create or replace function public.get_or_create_unsubscribe_token(in_email text)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  tok text;
begin
  select token into tok from public.email_unsubscribe_tokens where email = lower(in_email);
  if tok is not null then
    return tok;
  end if;
  tok := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  insert into public.email_unsubscribe_tokens (token, email)
  values (tok, lower(in_email))
  on conflict (email) do update set email = excluded.email
  returning token into tok;
  return tok;
end;
$$;

revoke all on function public.get_or_create_unsubscribe_token(text) from public, anon, authenticated;

-- ============================================================
-- 3. Reorder-alert evaluation: render via the template layer and enqueue
--    WITHOUT a fabricated run_id, WITH a required unsubscribe_token and a
--    per-message idempotency_key.
--    Lovable Email API contract (discovered by testing):
--      * run_id  -> auth emails only; a fabricated one 404s (run_not_found).
--      * app/transactional emails require an idempotency_key (400 otherwise).
--      * transactional emails require an unsubscribe_token (400 otherwise).
--    idempotency_key = message_id (unique per queued message). A key is only
--    poisoned (409 run_failed) if a first send attempt reaches the API and
--    fails; the normal path succeeds on the first attempt. Rate-limit (429)
--    retries do not create a run, so re-sending with the same key is safe.
-- ============================================================
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

      -- Render once; the body is identical for every recipient.
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
            -- NOTE: no run_id — the Lovable Email API rejects fabricated run ids
            -- with 404 run_not_found. idempotency_key is required for app emails.
            'message_id', msg_id,
            'idempotency_key', msg_id,
            'unsubscribe_token', unsub,
            'to', recipient.email,
            'from', 'Warehouse Wizard <noreply@warehousewizard.app>',
            'sender_domain', 'notify.warehousewizard.app',
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
