-- Fix: write_system_log() could insert NULL into system_logs.message, which
-- violates a NOT NULL constraint on that column (a legacy column predating
-- the log_type/severity/title rework in 20260609195501). Any caller that
-- omitted `message` -- e.g. reports-core.ts snapshotRecordCounts(), which
-- only sets title/table_name/record_count -- failed with:
--   null value in column "message" of relation "system_logs" violates
--   not-null constraint (23502)
--
-- Fix at the RPC boundary so every caller is covered, not just the one that
-- happened to trigger this: fall back to the title when no message is given.

CREATE OR REPLACE FUNCTION public.write_system_log(
  in_log_type text,
  in_severity text,
  in_title text,
  in_message text DEFAULT NULL,
  in_details jsonb DEFAULT NULL,
  in_source text DEFAULT NULL,
  in_table_name text DEFAULT NULL,
  in_record_count integer DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_id uuid;
  resolved_title text;
BEGIN
  resolved_title := COALESCE(NULLIF(btrim(in_title), ''), 'Untitled');

  INSERT INTO public.system_logs (
    log_type, severity, title, message, details, source,
    table_name, record_count, created_by, user_id, level
  ) VALUES (
    COALESCE(in_log_type, 'info'),
    COALESCE(in_severity, 'info'),
    resolved_title,
    COALESCE(NULLIF(btrim(in_message), ''), resolved_title),
    in_details,
    COALESCE(NULLIF(btrim(in_source), ''), 'app'),
    in_table_name,
    in_record_count,
    auth.uid(),
    auth.uid(),
    CASE WHEN in_severity IN ('debug','info','warning','error','critical')
         THEN in_severity::public.system_log_level
         ELSE 'info'::public.system_log_level END
  ) RETURNING id INTO new_id;
  RETURN new_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.write_system_log(text,text,text,text,jsonb,text,text,integer) TO authenticated;

-- Defensive backstop: also give the column a default so any future direct
-- insert (the "Staff can insert system logs" policy allows WITH CHECK true)
-- can't hit the same 23502 error.
ALTER TABLE public.system_logs ALTER COLUMN message SET DEFAULT '';
