CREATE OR REPLACE FUNCTION public.admin_update_user_password(in_user_id uuid, in_password text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'developer')) THEN
    RAISE EXCEPTION 'Only admins and developers can update user passwords';
  END IF;

  IF public.has_role(in_user_id, 'developer') AND NOT public.has_role(auth.uid(), 'developer') THEN
    RAISE EXCEPTION 'Admin accounts cannot change a developer''s password';
  END IF;

  IF in_password IS NULL OR length(in_password) < 4 THEN
    RAISE EXCEPTION 'Password or PIN is too short';
  END IF;

  UPDATE auth.users
  SET encrypted_password = extensions.crypt(in_password, extensions.gen_salt('bf'::text)),
      updated_at = timezone('utc', now()),
      recovery_token = '',
      recovery_sent_at = null,
      confirmation_token = coalesce(confirmation_token, ''),
      email_change = coalesce(email_change, ''),
      email_change_token_new = coalesce(email_change_token_new, ''),
      email_change_token_current = coalesce(email_change_token_current, ''),
      reauthentication_token = coalesce(reauthentication_token, '')
  WHERE id = in_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'User not found';
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_update_user_password(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_user_password(uuid, text) TO service_role;

CREATE OR REPLACE FUNCTION public.admin_invite_user(
  in_email text,
  in_full_name text,
  in_password text,
  in_role_code text DEFAULT NULL,
  in_warehouse_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_user_id uuid;
  role_id uuid;
  normalized_role text;
BEGIN
  IF NOT (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'developer')
  ) THEN
    RAISE EXCEPTION 'Only admins and developers can invite users';
  END IF;

  IF in_email IS NULL OR btrim(in_email) = '' THEN
    RAISE EXCEPTION 'Email is required';
  END IF;

  IF in_full_name IS NULL OR btrim(in_full_name) = '' THEN
    RAISE EXCEPTION 'Full name is required';
  END IF;

  IF in_password IS NULL OR length(in_password) < 8 THEN
    RAISE EXCEPTION 'Password must be at least 8 characters';
  END IF;

  IF EXISTS (
    SELECT 1 FROM auth.users WHERE lower(email) = lower(btrim(in_email))
  ) THEN
    RAISE EXCEPTION 'A user with that email already exists';
  END IF;

  normalized_role := nullif(lower(btrim(coalesce(in_role_code, ''))), '');

  IF normalized_role IS NOT NULL THEN
    IF normalized_role = 'dev' THEN
      normalized_role := 'developer';
    END IF;

    SELECT r.id INTO role_id
    FROM public.roles r
    WHERE lower(r.code::text) = normalized_role;

    IF role_id IS NULL THEN
      RAISE EXCEPTION 'Invalid role code';
    END IF;
  END IF;

  new_user_id := gen_random_uuid();

  INSERT INTO auth.users (
    instance_id,
    id,
    aud,
    role,
    email,
    encrypted_password,
    email_confirmed_at,
    confirmation_token,
    recovery_token,
    email_change,
    email_change_token_new,
    email_change_token_current,
    reauthentication_token,
    raw_app_meta_data,
    raw_user_meta_data,
    created_at,
    updated_at
  )
  VALUES (
    '00000000-0000-0000-0000-000000000000',
    new_user_id,
    'authenticated',
    'authenticated',
    lower(btrim(in_email)),
    extensions.crypt(in_password, extensions.gen_salt('bf'::text)),
    timezone('utc', now()),
    '',
    '',
    '',
    '',
    '',
    '',
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('full_name', btrim(in_full_name)),
    timezone('utc', now()),
    timezone('utc', now())
  );

  INSERT INTO auth.identities (
    provider_id,
    user_id,
    identity_data,
    provider,
    last_sign_in_at,
    created_at,
    updated_at
  )
  VALUES (
    lower(btrim(in_email)),
    new_user_id,
    jsonb_build_object('sub', new_user_id::text, 'email', lower(btrim(in_email))),
    'email',
    timezone('utc', now()),
    timezone('utc', now()),
    timezone('utc', now())
  )
  ON CONFLICT DO NOTHING;

  IF role_id IS NOT NULL THEN
    INSERT INTO public.user_roles (
      id,
      user_id,
      role_id,
      created_at,
      warehouse_id,
      is_hidden
    )
    VALUES (
      gen_random_uuid(),
      new_user_id,
      role_id,
      timezone('utc', now()),
      in_warehouse_id,
      false
    )
    ON CONFLICT DO NOTHING;
  END IF;

  UPDATE public.profiles
  SET full_name = coalesce(nullif(btrim(in_full_name), ''), full_name),
      email = coalesce(nullif(lower(btrim(in_email)), ''), email),
      approved = true,
      active = true,
      updated_at = timezone('utc', now())
  WHERE id = new_user_id;

  RETURN new_user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_invite_user(text, text, text, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_invite_user(text, text, text, text, uuid) TO service_role;