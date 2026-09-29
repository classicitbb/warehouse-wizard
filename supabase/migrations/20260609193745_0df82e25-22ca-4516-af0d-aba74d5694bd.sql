
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS pin_hash text;

CREATE OR REPLACE FUNCTION public.admin_update_user_pin(in_user_id uuid, in_pin text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  clean_pin text := trim(coalesce(in_pin, ''));
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'developer')) THEN
    RAISE EXCEPTION 'Only admins and developers can update badge PINs';
  END IF;

  IF public.has_role(in_user_id, 'developer') AND NOT public.has_role(auth.uid(), 'developer') THEN
    RAISE EXCEPTION 'Admin accounts cannot change a developer''s badge PIN';
  END IF;

  IF clean_pin !~ '^[0-9]{4,7}$' THEN
    RAISE EXCEPTION 'Badge PIN must be 4-7 digits';
  END IF;

  UPDATE public.profiles
  SET pin_hash = extensions.crypt(clean_pin, extensions.gen_salt('bf'::text)),
      updated_at = timezone('utc', now())
  WHERE id = in_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'User not found';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_update_user_pin(in_pin text, in_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.admin_update_user_pin(in_user_id, in_pin);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_update_user_pin(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_user_pin(text, uuid) TO authenticated;
