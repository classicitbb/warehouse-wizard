-- Live NetSuite sync: when stock-change jobs are queued, immediately ping the
-- queue processor (pg_net, async). The scheduled run remains the safety net.
-- Each backend needs its own 'live_sync_function_url' row in
-- integration_secrets (never copied between repos); no row = no-op.
CREATE OR REPLACE FUNCTION public.kick_netsuite_queue()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_conn uuid; v_url text; v_secret text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM new_jobs WHERE status = 'queued' AND job_type = 'inventory_adjustment') THEN RETURN NULL; END IF;
  SELECT id INTO v_conn FROM integration_connections WHERE enabled = true ORDER BY created_at LIMIT 1;
  IF v_conn IS NULL THEN RETURN NULL; END IF;
  SELECT secret_value INTO v_url FROM integration_secrets WHERE connection_id = v_conn AND secret_type = 'live_sync_function_url';
  SELECT secret_value INTO v_secret FROM integration_secrets WHERE connection_id = v_conn AND secret_type = 'netsuite_queue_runner_secret';
  IF v_url IS NULL OR v_secret IS NULL THEN RETURN NULL; END IF;
  BEGIN
    PERFORM net.http_post(url := v_url,
      headers := jsonb_build_object('Content-Type','application/json','x-queue-secret', v_secret),
      body := '{"trigger":"live"}'::jsonb);
  EXCEPTION WHEN OTHERS THEN NULL; -- never block a stock change
  END;
  RETURN NULL;
END; $$;
REVOKE ALL ON FUNCTION public.kick_netsuite_queue() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_kick_netsuite_queue ON public.integration_sync_jobs;
CREATE TRIGGER trg_kick_netsuite_queue AFTER INSERT ON public.integration_sync_jobs
REFERENCING NEW TABLE AS new_jobs FOR EACH STATEMENT EXECUTE FUNCTION public.kick_netsuite_queue();