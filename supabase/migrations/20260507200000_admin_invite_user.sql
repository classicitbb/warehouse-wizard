-- Admin function to create warehouse users from the management dashboard.
-- Requires the calling session to have the admin role.
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
  caller_role text;
begin
  -- Verify caller is admin
  select r.code into caller_role
  from public.user_roles ur
  join public.roles r on r.id = ur.role_id
  where ur.user_id = auth.uid()
    and r.code = 'admin'
  limit 1;

  if caller_role is null then
    raise exception 'Only admins can invite users';
  end if;

  -- Verify email not already taken
  if exists (select 1 from auth.users where email = in_email) then
    raise exception 'A user with that email already exists';
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
    lower(trim(in_email)),
    crypt(in_password, gen_salt('bf')),
    timezone('utc', now()),
    '{"provider":"email","providers":["email"]}',
    jsonb_build_object('full_name', in_full_name),
    timezone('utc', now()),
    timezone('utc', now())
  );

  -- Mark profile as approved immediately (created by admin)
  update public.profiles
  set approved = true,
      active = true,
      full_name = coalesce(nullif(trim(in_full_name), ''), full_name)
  where id = new_user_id;

  -- Optionally assign role
  if in_role_code is not null and in_role_code <> '' then
    select id into role_id from public.roles where code = in_role_code;
    if role_id is not null then
      insert into public.user_roles (user_id, role_id, warehouse_id)
      values (new_user_id, role_id, in_warehouse_id)
      on conflict do nothing;
    end if;
  end if;

  return new_user_id;
end;
$$;

-- Allow authenticated users to call it (the function itself checks for admin role)
grant execute on function public.admin_invite_user to authenticated;
