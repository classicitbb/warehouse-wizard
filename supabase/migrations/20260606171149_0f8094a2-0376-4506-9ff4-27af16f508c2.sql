
-- Protect developer profile from deletion
CREATE OR REPLACE FUNCTION public.prevent_developer_profile_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF lower(coalesce(OLD.email,'')) = 'russelljhunte@gmail.com'
     OR EXISTS (
       SELECT 1 FROM public.user_roles ur
       JOIN public.roles r ON r.id = ur.role_id
       WHERE ur.user_id = OLD.id AND r.code = 'developer'
     )
  THEN
    RAISE EXCEPTION 'The developer account cannot be deleted';
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS protect_developer_profile_delete ON public.profiles;
CREATE TRIGGER protect_developer_profile_delete
BEFORE DELETE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.prevent_developer_profile_delete();

-- Force developer profile to remain approved/active
CREATE OR REPLACE FUNCTION public.enforce_developer_approved()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF lower(coalesce(NEW.email,'')) = 'russelljhunte@gmail.com'
     OR EXISTS (
       SELECT 1 FROM public.user_roles ur
       JOIN public.roles r ON r.id = ur.role_id
       WHERE ur.user_id = NEW.id AND r.code = 'developer'
     )
  THEN
    NEW.approved := true;
    NEW.active := true;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_developer_approved ON public.profiles;
CREATE TRIGGER enforce_developer_approved
BEFORE INSERT OR UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.enforce_developer_approved();

-- When developer role is granted, auto-approve the profile
CREATE OR REPLACE FUNCTION public.auto_approve_on_developer_role()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.roles WHERE id = NEW.role_id AND code = 'developer') THEN
    UPDATE public.profiles
       SET approved = true, active = true, updated_at = timezone('utc', now())
     WHERE id = NEW.user_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS auto_approve_on_developer_role ON public.user_roles;
CREATE TRIGGER auto_approve_on_developer_role
AFTER INSERT ON public.user_roles
FOR EACH ROW EXECUTE FUNCTION public.auto_approve_on_developer_role();

-- Apply to existing developers now
UPDATE public.profiles p
   SET approved = true, active = true
 WHERE lower(coalesce(p.email,'')) = 'russelljhunte@gmail.com'
    OR EXISTS (
      SELECT 1 FROM public.user_roles ur
      JOIN public.roles r ON r.id = ur.role_id
      WHERE ur.user_id = p.id AND r.code = 'developer'
    );
