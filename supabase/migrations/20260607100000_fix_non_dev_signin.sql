-- Fix non-dev user sign-in.
--
-- Root cause 1: admin_invite_user inserted directly into auth.users but never
-- created a matching auth.identities row. GoTrue requires auth.identities for
-- email/password authentication; without it every invited user gets
-- "invalid credentials" on sign-in.
--
-- Root cause 2 (badge login): start_badge_device_login(text,text,text) was
-- replaced with a stub that always raises (migration 20260605191800). The
-- badge-login edge function still called that 3-arg form, breaking badge
-- sign-in for all users. The real logic is now in the 5-arg overload.
-- The edge function is updated separately; this migration patches the DB side.

-- ── 1. Fix admin_invite_user ───────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.admin_invite_user(
  in_email        text,
  in_full_name    text,
  in_password     text,
  in_role_code    text DEFAULT NULL,
  in_warehouse_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_user_id     uuid;
  role_id         uuid;
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
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at
  )
  VALUES (
    '00000000-0000-0000-0000-000000000000',
    new_user_id,
    'authenticated',
    'authenticated',
    lower(btrim(in_email)),
    extensions.crypt(in_password, extensions.gen_salt('bf'::text)),
    timezone('utc', now()),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('full_name', btrim(in_full_name)),
    timezone('utc', now()),
    timezone('utc', now())
  );

  -- GoTrue requires an auth.identities row for email/password sign-in.
  -- Without this the user is in auth.users but always gets "invalid credentials".
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
      id, user_id, role_id, created_at, warehouse_id, is_hidden
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
  SET full_name  = coalesce(nullif(btrim(in_full_name), ''), full_name),
      email      = coalesce(nullif(lower(btrim(in_email)), ''), email),
      approved   = true,
      active     = true,
      updated_at = timezone('utc', now())
  WHERE id = new_user_id;

  RETURN new_user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_invite_user(text, text, text, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_invite_user(text, text, text, text, uuid) TO service_role;

-- ── 3. Allow developers to approve users ──────────────────────────────────────
--
-- admin_invite_user (migration 20260606173146) was updated to allow developers to
-- create users, but the prevent_self_approval trigger still only allowed admins to
-- change the approved status.  Extend the check to cover developers so a developer
-- who calls admin_invite_user can fully on-board the user in one step.

CREATE OR REPLACE FUNCTION public.prevent_self_approval()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.approved IS DISTINCT FROM OLD.approved
     AND NOT EXISTS (
       SELECT 1 FROM public.user_roles ur
       JOIN public.roles r ON r.id = ur.role_id
       WHERE ur.user_id = auth.uid()
         AND r.code IN ('admin', 'developer')
     )
  THEN
    RAISE EXCEPTION 'Only admins and developers can change the approved status';
  END IF;
  RETURN NEW;
END;
$$;

-- ── 2. Backfill missing auth.identities for already-invited users ──────────
--
-- Users created before this fix have no identity row and cannot sign in.
-- Insert the missing rows now so existing accounts immediately work.

DO $$
DECLARE
  rows_inserted integer;
BEGIN
  INSERT INTO auth.identities (
    provider_id,
    user_id,
    identity_data,
    provider,
    last_sign_in_at,
    created_at,
    updated_at
  )
  SELECT
    lower(u.email),
    u.id,
    jsonb_build_object('sub', u.id::text, 'email', lower(u.email)),
    'email',
    u.created_at,
    u.created_at,
    u.created_at
  FROM auth.users u
  WHERE u.encrypted_password IS NOT NULL
    AND u.email IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM   auth.identities i
      WHERE  i.user_id  = u.id
        AND  i.provider = 'email'
    )
  ON CONFLICT DO NOTHING;

  GET DIAGNOSTICS rows_inserted = ROW_COUNT;
  RAISE NOTICE 'auth.identities backfill: % row(s) inserted', rows_inserted;
END $$;
