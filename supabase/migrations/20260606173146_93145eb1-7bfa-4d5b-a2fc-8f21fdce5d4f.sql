create or replace function public.admin_invite_user(
  in_email text,
  in_full_name text,
  in_password text,
  in_role_code text default null,
  in_warehouse_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_user_id uuid;
  role_id uuid;
  normalized_role text;
begin
  if not (
    public.has_role(auth.uid(), 'admin')
    or public.has_role(auth.uid(), 'developer')
  ) then
    raise exception 'Only admins and developers can invite users';
  end if;

  if in_email is null or btrim(in_email) = '' then
    raise exception 'Email is required';
  end if;

  if in_full_name is null or btrim(in_full_name) = '' then
    raise exception 'Full name is required';
  end if;

  if in_password is null or length(in_password) < 8 then
    raise exception 'Password must be at least 8 characters';
  end if;

  if exists (
    select 1 from auth.users where lower(email) = lower(btrim(in_email))
  ) then
    raise exception 'A user with that email already exists';
  end if;

  normalized_role := nullif(lower(btrim(coalesce(in_role_code, ''))), '');

  if normalized_role is not null then
    if normalized_role = 'dev' then
      normalized_role := 'developer';
    end if;

    select r.id into role_id
    from public.roles r
    where lower(r.code) = normalized_role;

    if role_id is null then
      raise exception 'Invalid role code';
    end if;
  end if;

  new_user_id := gen_random_uuid();

  insert into auth.users (
    instance_id,
    id,
    aud,
    role,
    email,
    encrypted_password,
    email_confirmed_at,
    raw_app_meta_data,
    raw_user_meta_data,
    created_at,
    updated_at
  )
  values (
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

  if role_id is not null then
    insert into public.user_roles (
      id,
      user_id,
      role_id,
      created_at,
      warehouse_id,
      is_hidden
    )
    values (
      gen_random_uuid(),
      new_user_id,
      role_id,
      timezone('utc', now()),
      in_warehouse_id,
      false
    )
    on conflict do nothing;
  end if;

  update public.profiles
  set full_name = coalesce(nullif(btrim(in_full_name), ''), full_name),
      email = coalesce(nullif(lower(btrim(in_email)), ''), email),
      approved = true,
      active = true,
      updated_at = timezone('utc', now())
  where id = new_user_id;

  return new_user_id;
end;
$$;

grant execute on function public.admin_invite_user(text, text, text, text, uuid) to authenticated;
grant execute on function public.admin_invite_user(text, text, text, text, uuid) to service_role;