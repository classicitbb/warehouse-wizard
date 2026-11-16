-- Run the NetSuite outbound queue every two minutes as a sweep behind the
-- instant push (kick_netsuite_queue). It picks up retries, which otherwise wait
-- for the next new job, and links inbound shipment item receipts that NetSuite
-- creates in the background after the RESTlet has answered.
-- The URL and runner secret are read from integration_secrets on each run, so
-- nothing secret is stored in the cron command.

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') and exists (select 1 from pg_extension where extname = 'pg_net') then
    if exists (select 1 from cron.job where jobname = 'netsuite-queue-sweep') then
      perform cron.unschedule('netsuite-queue-sweep');
    end if;
    perform cron.schedule(
      'netsuite-queue-sweep',
      '*/2 * * * *',
      $job$
      select net.http_post(
        url := u.secret_value,
        headers := jsonb_build_object('Content-Type', 'application/json', 'x-queue-secret', s.secret_value),
        body := '{"trigger":"sweep"}'::jsonb,
        timeout_milliseconds := 120000
      )
      from public.integration_connections c
      join public.integration_secrets u on u.connection_id = c.id and u.secret_type = 'live_sync_function_url'
      join public.integration_secrets s on s.connection_id = c.id and s.secret_type = 'netsuite_queue_runner_secret'
      where c.system = 'netsuite' and c.enabled = true
      limit 1
      $job$
    );
  end if;
end $$;
