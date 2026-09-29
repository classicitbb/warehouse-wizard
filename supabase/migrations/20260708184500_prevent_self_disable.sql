-- Users must not be able to disable their own account, even if they can edit
-- their profile or manage other users.

CREATE OR REPLACE FUNCTION public.prevent_self_disable()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.id = auth.uid()
     AND NEW.active IS DISTINCT FROM OLD.active
     AND NEW.active = false THEN
    RAISE EXCEPTION 'Users cannot disable their own account';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_self_disable ON public.profiles;
CREATE TRIGGER trg_prevent_self_disable
BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.prevent_self_disable();

REVOKE EXECUTE ON FUNCTION public.prevent_self_disable() FROM PUBLIC, anon, authenticated;
