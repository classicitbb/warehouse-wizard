-- Add new role codes to the enum
alter type public.app_role_code add value if not exists 'developer';
alter type public.app_role_code add value if not exists 'warehouse_supervisor';

-- Seed the new roles
insert into public.roles (code, name, description)
values
  ('developer',           'Developer',           'Full system capabilities including developer tooling, role management, and all configuration'),
  ('warehouse_supervisor','Warehouse Supervisor', 'Operational oversight with team scheduling, task assignment, and escalation handling')
on conflict (code) do update
  set name        = excluded.name,
      description = excluded.description,
      updated_at  = timezone('utc', now());

-- Extend password-update RPC:
--   - developer: may update any user's password
--   - admin: may update any user's password EXCEPT a developer's
--   - others: denied
-- Also fixes gen_salt(unknown) by using the extensions schema qualifier.
create or replace function public.admin_update_user_password(
  in_user_id uuid,
  in_password text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'developer')) then
    raise exception 'Only admins and developers can update user passwords';
  end if;

  -- Admins cannot change a developer's password
  if public.has_role(in_user_id, 'developer') and not public.has_role(auth.uid(), 'developer') then
    raise exception 'Admin accounts cannot change a developer''s password';
  end if;

  if in_password is null or length(in_password) < 4 then
    raise exception 'Password or PIN is too short';
  end if;

  update auth.users
  set encrypted_password = extensions.crypt(in_password, extensions.gen_salt('bf'::text)),
      updated_at = timezone('utc', now()),
      recovery_token = '',
      recovery_sent_at = null
  where id = in_user_id;

  if not found then
    raise exception 'User not found';
  end if;
end;
$$;

grant execute on function public.admin_update_user_password(uuid, text) to authenticated;

-- Extend invite-user RPC to allow developer role (gen_salt fix included)
create or replace function public.admin_invite_user(
  in_email        text,
  in_full_name    text,
  in_password     text,
  in_role_code    text default null,
  in_warehouse_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_user_id uuid;
  role_id     uuid;
  caller_role text;
begin
  select r.code into caller_role
  from public.user_roles ur
  join public.roles r on r.id = ur.role_id
  where ur.user_id = auth.uid() and r.code in ('admin', 'developer')
  limit 1;

  if caller_role is null then
    raise exception 'Only admins and developers can invite users';
  end if;

  if exists (select 1 from auth.users where email = in_email) then
    raise exception 'A user with that email already exists';
  end if;

  new_user_id := gen_random_uuid();

  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  )
  values (
    '00000000-0000-0000-0000-000000000000',
    new_user_id, 'authenticated', 'authenticated',
    lower(trim(in_email)),
    extensions.crypt(in_password, extensions.gen_salt('bf'::text)),
    timezone('utc', now()),
    '{"provider":"email","providers":["email"]}',
    jsonb_build_object('full_name', in_full_name),
    timezone('utc', now()),
    timezone('utc', now())
  );

  update public.profiles
  set approved  = true,
      active    = true,
      full_name = coalesce(nullif(trim(in_full_name), ''), full_name)
  where id = new_user_id;

  if in_role_code is not null and in_role_code <> '' then
    select id into role_id from public.roles where code = in_role_code::public.app_role_code;
    if role_id is not null then
      insert into public.user_roles (user_id, role_id, warehouse_id)
      values (new_user_id, role_id, in_warehouse_id)
      on conflict do nothing;
    end if;
  end if;

  return new_user_id;
end;
$$;

grant execute on function public.admin_invite_user to authenticated;
