-- Feedback and feature-request tickets should also notify admin users,
-- alongside the reporter and developers, so suggestions reach the main admin.
CREATE OR REPLACE FUNCTION public.notify_operator_ticket_submitted()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
declare
  reporter_email text;
  reporter_name text;
  wh_name text;
  log_severity text;
  log_type text;
  subject text;
  body_html text;
  text_body text;
  clar_html text := '';
  clar_text text := '';
  clar jsonb;
  recipient text;
  msg_id text;
  unsub text;
  ticket_ref text;
  is_feedback boolean;
begin
  ticket_ref := coalesce(new.ticket_number, left(new.id::text, 8));
  is_feedback := new.kind in ('feedback', 'request');

  select p.email, p.full_name into reporter_email, reporter_name
    from public.profiles p where p.id = new.reported_by;
  if new.warehouse_id is not null then
    select w.name into wh_name from public.warehouses w where w.id = new.warehouse_id;
  end if;

  -- 1. System log entry -------------------------------------------------
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

  -- 2. Email ticket -----------------------------------------------------
  begin
    for clar in select jsonb_array_elements(coalesce(new.clarifications, '[]'::jsonb))
    loop
      clar_html := clar_html
        || format('<p style="margin:0 0 10px;color:#334155;font-size:14px;line-height:1.5;">'
                  || '<strong>%s</strong><br>%s</p>',
                  coalesce(clar->>'question', ''), coalesce(clar->>'answer', ''));
      clar_text := clar_text
        || format(E'%s\n  %s\n', coalesce(clar->>'question', ''), coalesce(clar->>'answer', ''));
    end loop;

    subject := format('[%s] %s report %s — %s',
      upper(new.severity), initcap(new.kind), ticket_ref,
      coalesce(nullif(new.title, ''), 'Operator report'));

    body_html :=
         format('<p style="margin:0 0 16px;color:#334155;font-size:15px;line-height:1.5;">'
             || '<strong>%s</strong> filed by %s%s.</p>',
             coalesce(nullif(new.title, ''), 'Operator report'),
             coalesce(nullif(reporter_name, ''), coalesce(reporter_email, 'an operator')),
             case when wh_name is null then '' else ' at ' || wh_name end)
      || '<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin:0 0 20px;">'
      || format('<tr><td style="padding:6px 0;color:#64748b;font-size:14px;">Ticket</td><td style="padding:6px 0;text-align:right;color:#0f172a;font-size:14px;font-weight:600;">%s</td></tr>', ticket_ref)
      || format('<tr><td style="padding:6px 0;color:#64748b;font-size:14px;">Kind</td><td style="padding:6px 0;text-align:right;color:#0f172a;font-size:14px;">%s</td></tr>', new.kind)
      || format('<tr><td style="padding:6px 0;color:#64748b;font-size:14px;">Severity</td><td style="padding:6px 0;text-align:right;color:#0f172a;font-size:14px;">%s</td></tr>', new.severity)
      || format('<tr><td style="padding:6px 0;color:#64748b;font-size:14px;">Screen</td><td style="padding:6px 0;text-align:right;color:#0f172a;font-size:14px;">%s</td></tr>', coalesce(new.route, '—'))
      || format('<tr><td style="padding:6px 0;color:#64748b;font-size:14px;">Module</td><td style="padding:6px 0;text-align:right;color:#0f172a;font-size:14px;">%s</td></tr>', coalesce(new.module, '—'))
      || format('<tr><td style="padding:6px 0;color:#64748b;font-size:14px;">App version</td><td style="padding:6px 0;text-align:right;color:#0f172a;font-size:14px;">%s</td></tr>', coalesce(new.app_version, '—'))
      || '</table>'
      || case when coalesce(new.summary, '') = '' then '' else
           format('<h2 style="margin:0 0 6px;font-size:15px;color:#0f172a;">Summary</h2><p style="margin:0 0 16px;color:#334155;font-size:14px;line-height:1.5;">%s</p>', new.summary) end
      || case when coalesce(new.actual_behavior, '') = '' then '' else
           format('<h2 style="margin:0 0 6px;font-size:15px;color:#0f172a;">What happened</h2><p style="margin:0 0 16px;color:#334155;font-size:14px;line-height:1.5;">%s</p>', new.actual_behavior) end
      || case when coalesce(new.expected_behavior, '') = '' then '' else
           format('<h2 style="margin:0 0 6px;font-size:15px;color:#0f172a;">Expected</h2><p style="margin:0 0 16px;color:#334155;font-size:14px;line-height:1.5;">%s</p>', new.expected_behavior) end
      || case when coalesce(new.steps_to_reproduce, '') = '' then '' else
           format('<h2 style="margin:0 0 6px;font-size:15px;color:#0f172a;">Steps</h2><p style="margin:0 0 16px;color:#334155;font-size:14px;line-height:1.5;">%s</p>', new.steps_to_reproduce) end
      || case when clar_html = '' then '' else
           '<h2 style="margin:0 0 6px;font-size:15px;color:#0f172a;">Questions asked</h2>' || clar_html end;

    text_body :=
         format(E'%s\n\n', subject)
      || format(E'Filed by: %s (%s)\n', coalesce(nullif(reporter_name, ''), '—'), coalesce(reporter_email, '—'))
      || format(E'Screen: %s   Module: %s   App version: %s\n', coalesce(new.route, '—'), coalesce(new.module, '—'), coalesce(new.app_version, '—'))
      || case when wh_name is null then '' else format(E'Warehouse: %s\n', wh_name) end
      || case when coalesce(new.summary, '') = '' then '' else format(E'\nSummary:\n%s\n', new.summary) end
      || case when coalesce(new.actual_behavior, '') = '' then '' else format(E'\nWhat happened:\n%s\n', new.actual_behavior) end
      || case when coalesce(new.expected_behavior, '') = '' then '' else format(E'\nExpected:\n%s\n', new.expected_behavior) end
      || case when coalesce(new.steps_to_reproduce, '') = '' then '' else format(E'\nSteps:\n%s\n', new.steps_to_reproduce) end
      || case when clar_text = '' then '' else E'\nQuestions asked:\n' || clar_text end
      || E'\n— Warehouse Wizard (automated notification)';

    for recipient in
      select distinct e from (
        select lower(trim(reporter_email)) as e
        union
        select 'wms@simplextrading.net'
        union
        select lower(trim(p.email))
          from public.profiles p
          join public.user_roles ur on ur.user_id = p.id and coalesce(ur.is_hidden, false) = false
          join public.roles r on r.id = ur.role_id
         where p.active = true and p.email is not null
           and r.code::text in ('dev', 'developer')
        union
        select lower(trim(p.email))
          from public.profiles p
          join public.user_roles ur on ur.user_id = p.id and coalesce(ur.is_hidden, false) = false
          join public.roles r on r.id = ur.role_id
         where is_feedback and p.active = true and p.email is not null
           and r.code::text = 'admin'
      ) s
      where e is not null and e <> ''
    loop
      msg_id := gen_random_uuid()::text;
      unsub := public.get_or_create_unsubscribe_token(recipient);
      perform public.enqueue_email(
        'transactional_emails',
        jsonb_build_object(
          'message_id', msg_id,
          'idempotency_key', msg_id,
          'unsubscribe_token', unsub,
          'to', recipient,
          'from', 'Warehouse Wizard <noreply@mail.warehousewizard.app>',
          'sender_domain', 'mail.warehousewizard.app',
          'subject', subject,
          'html', public.notification_email_shell(subject, body_html),
          'text', text_body,
          'purpose', 'transactional',
          'label', 'operator-ticket',
          'queued_at', now()::text
        )
      );
    end loop;
  exception when others then
    raise warning 'operator ticket email failed: %', sqlerrm;
  end;

  return new;
end;
$$;
