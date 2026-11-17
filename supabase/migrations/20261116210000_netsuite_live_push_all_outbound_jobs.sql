-- Push every outbound NetSuite job the moment Warehouse Wizard queues it.
--
-- kick_netsuite_queue() (trigger trg_kick_netsuite_queue, after insert on
-- integration_sync_jobs) only woke the queue for inventory_adjustment and
-- receipt_purchase_order. Inbound shipment receipts and fulfillments sat in
-- the queue until something else woke it, so the office did not see a
-- received shipment in NetSuite. Kick for all outbound job types, and give the
-- call long enough that pg_net does not drop it while the worker posts.

create or replace function public.kick_netsuite_queue()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare v_conn uuid; v_url text; v_secret text;
begin
  if not exists (
    select 1 from new_jobs
    where status = 'queued'
      and job_type in ('inventory_adjustment', 'receipt_purchase_order', 'receipt_inbound_shipment', 'fulfillment_ship')
  ) then return null; end if;
  select id into v_conn from integration_connections where enabled = true order by created_at limit 1;
  if v_conn is null then return null; end if;
  select secret_value into v_url from integration_secrets where connection_id = v_conn and secret_type = 'live_sync_function_url';
  select secret_value into v_secret from integration_secrets where connection_id = v_conn and secret_type = 'netsuite_queue_runner_secret';
  if v_url is null or v_secret is null then return null; end if;
  begin
    perform net.http_post(
      url := v_url,
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-queue-secret', v_secret),
      body := '{"trigger":"live"}'::jsonb,
      timeout_milliseconds := 120000
    );
  exception when others then null;
  end;
  return null;
end; $$;
