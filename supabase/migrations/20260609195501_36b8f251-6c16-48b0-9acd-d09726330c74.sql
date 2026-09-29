-- Extend system_logs to match application shape
ALTER TABLE public.system_logs
  ADD COLUMN IF NOT EXISTS log_type text NOT NULL DEFAULT 'info',
  ADD COLUMN IF NOT EXISTS severity text NOT NULL DEFAULT 'info',
  ADD COLUMN IF NOT EXISTS title text,
  ADD COLUMN IF NOT EXISTS details jsonb,
  ADD COLUMN IF NOT EXISTS table_name text,
  ADD COLUMN IF NOT EXISTS record_count integer,
  ADD COLUMN IF NOT EXISTS resolved boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS resolved_at timestamptz,
  ADD COLUMN IF NOT EXISTS created_by uuid,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- Backfill from legacy columns
UPDATE public.system_logs
  SET title = COALESCE(title, message),
      severity = COALESCE(NULLIF(severity,''), level::text, 'info'),
      created_by = COALESCE(created_by, user_id)
  WHERE title IS NULL OR created_by IS NULL;

ALTER TABLE public.system_logs ALTER COLUMN title SET NOT NULL;

-- FK to profiles for PostgREST embed
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'system_logs_created_by_profiles_fkey'
  ) THEN
    ALTER TABLE public.system_logs
      ADD CONSTRAINT system_logs_created_by_profiles_fkey
      FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;
  END IF;
END $$;

-- RLS policies: allow admins & developers to read/insert/update
DROP POLICY IF EXISTS "Admins can read system logs" ON public.system_logs;
DROP POLICY IF EXISTS "Admins can insert system logs" ON public.system_logs;
DROP POLICY IF EXISTS "Staff can read system logs" ON public.system_logs;
DROP POLICY IF EXISTS "Staff can insert system logs" ON public.system_logs;
DROP POLICY IF EXISTS "Staff can update system logs" ON public.system_logs;

CREATE POLICY "Staff can read system logs" ON public.system_logs
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'developer') OR public.has_role(auth.uid(), 'manager'));

CREATE POLICY "Staff can insert system logs" ON public.system_logs
  FOR INSERT TO authenticated
  WITH CHECK (true);

CREATE POLICY "Staff can update system logs" ON public.system_logs
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'developer'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'developer'));

GRANT SELECT, INSERT, UPDATE ON public.system_logs TO authenticated;
GRANT ALL ON public.system_logs TO service_role;

-- write_system_log RPC
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
BEGIN
  INSERT INTO public.system_logs (
    log_type, severity, title, message, details, source,
    table_name, record_count, created_by, user_id, level
  ) VALUES (
    COALESCE(in_log_type, 'info'),
    COALESCE(in_severity, 'info'),
    COALESCE(NULLIF(btrim(in_title), ''), 'Untitled'),
    in_message,
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