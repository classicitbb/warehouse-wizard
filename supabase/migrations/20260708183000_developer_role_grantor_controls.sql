-- Track who granted each role assignment so Developer access can only be
-- unassigned by the original grantor.

ALTER TABLE public.user_roles
  ADD COLUMN IF NOT EXISTS assigned_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_user_roles_assigned_by
  ON public.user_roles (assigned_by);

-- Existing non-root Developer assignments predate assigned_by tracking. Treat
-- Russell Hunte as the grantor so he can clean them up from User Management.
WITH russell AS (
  SELECT id
  FROM public.profiles
  WHERE lower(coalesce(email, '')) = 'russelljhunte@gmail.com'
  LIMIT 1
),
developer_role AS (
  SELECT id
  FROM public.roles
  WHERE code = 'developer'
  LIMIT 1
)
UPDATE public.user_roles ur
SET assigned_by = CASE
  WHEN ur.user_id = (SELECT id FROM russell) THEN NULL
  ELSE (SELECT id FROM russell)
END
WHERE ur.role_id = (SELECT id FROM developer_role)
  AND ur.assigned_by IS NULL
  AND EXISTS (SELECT 1 FROM russell)
  AND EXISTS (SELECT 1 FROM developer_role);

CREATE OR REPLACE FUNCTION public.set_user_role_assigned_by()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.assigned_by IS NULL AND auth.uid() IS NOT NULL THEN
    NEW.assigned_by := auth.uid();
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_user_role_assigned_by ON public.user_roles;
CREATE TRIGGER set_user_role_assigned_by
BEFORE INSERT ON public.user_roles
FOR EACH ROW EXECUTE FUNCTION public.set_user_role_assigned_by();

CREATE OR REPLACE FUNCTION public.preserve_user_role_assigned_by()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.assigned_by IS DISTINCT FROM OLD.assigned_by THEN
    RAISE EXCEPTION 'Role assignment grantor cannot be changed';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS preserve_user_role_assigned_by ON public.user_roles;
CREATE TRIGGER preserve_user_role_assigned_by
BEFORE UPDATE ON public.user_roles
FOR EACH ROW EXECUTE FUNCTION public.preserve_user_role_assigned_by();

CREATE OR REPLACE FUNCTION public.enforce_developer_role_unassigner()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  role_code text;
BEGIN
  SELECT code::text
  INTO role_code
  FROM public.roles
  WHERE id = OLD.role_id;

  IF role_code IS DISTINCT FROM 'developer' THEN
    RETURN OLD;
  END IF;

  IF OLD.assigned_by IS NULL THEN
    RAISE EXCEPTION 'Original developer assignment cannot be unassigned from user management';
  END IF;

  IF auth.uid() IS DISTINCT FROM OLD.assigned_by THEN
    RAISE EXCEPTION 'Only the developer who assigned this role can unassign it';
  END IF;

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS enforce_developer_role_unassigner ON public.user_roles;
CREATE TRIGGER enforce_developer_role_unassigner
BEFORE DELETE ON public.user_roles
FOR EACH ROW EXECUTE FUNCTION public.enforce_developer_role_unassigner();
