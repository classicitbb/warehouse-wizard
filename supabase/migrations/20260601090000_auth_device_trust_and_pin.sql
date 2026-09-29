-- Auth hardening phase 0: separate badge PINs from passwords and add
-- per-user/per-device trust renewal for fast badge login.

alter table public.profiles
  add column if not exists pin_hash text;

create table if not exists public.user_device_trust (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  device_id text not null,
  trusted_at timestamptz not null default timezone('utc', now()),
  expires_at timestamptz not null default (timezone('utc', now()) + interval '90 days'),
  last_used_at timestamptz not null default timezone('utc', now()),
  user_agent text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (user_id, device_id),
  constraint user_device_trust_device_id_length check (char_length(trim(device_id)) between 16 and 128)
);

alter table public.user_device_trust enable row level security;

drop policy if exists "user_device_trust self read" on public.user_device_trust;
create policy "user_device_trust self read"
  on public.user_device_trust for select
  using (auth.uid() = user_id);

drop policy if exists "user_device_trust self delete" on public.user_device_trust;
create policy "user_device_trust self delete"
  on public.user_device_trust for delete
  using (auth.uid() = user_id);

create index if not exists idx_user_device_trust_user_expires
  on public.user_device_trust (user_id, expires_at);

create or replace function public.refresh_user_device_trust(
  in_device_id text,
  in_user_agent text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  clean_device_id text := nullif(trim(in_device_id), '');
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if clean_device_id is null or char_length(clean_device_id) < 16 or char_length(clean_device_id) > 128 then
    raise exception 'Invalid device identifier';
  end if;

  insert into public.user_device_trust (
    user_id,
    device_id,
    trusted_at,
    expires_at,
    last_used_at,
    user_agent,
    updated_at
  )
  values (
    auth.uid(),
    clean_device_id,
    timezone('utc', now()),
    timezone('utc', now()) + interval '90 days',
    timezone('utc', now()),
    nullif(left(coalesce(in_user_agent, ''), 500), ''),
    timezone('utc', now())
  )
  on conflict (user_id, device_id) do update
    set trusted_at = excluded.trusted_at,
        expires_at = excluded.expires_at,
        last_used_at = excluded.last_used_at,
        user_agent = excluded.user_agent,
        updated_at = excluded.updated_at;
end;
$$;

create or replace function public.admin_update_user_pin(
  in_user_id uuid,
  in_pin text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  clean_pin text := trim(coalesce(in_pin, ''));
begin
  if not (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'developer')) then
    raise exception 'Only admins and developers can update badge PINs';
  end if;

  if public.has_role(in_user_id, 'developer') and not public.has_role(auth.uid(), 'developer') then
    raise exception 'Admin accounts cannot change a developer''s badge PIN';
  end if;

  if clean_pin !~ '^[0-9]{4,7}$' then
    raise exception 'Badge PIN must be 4-7 digits';
  end if;

  update public.profiles
  set pin_hash = extensions.crypt(clean_pin, extensions.gen_salt('bf'::text)),
      updated_at = timezone('utc', now())
  where id = in_user_id;

  if not found then
    raise exception 'User not found';
  end if;
end;
$$;

create or replace function public.verify_user_pin(
  in_user_id uuid,
  in_pin text
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = in_user_id
      and p.active = true
      and p.approved = true
      and p.pin_hash is not null
      and p.pin_hash = extensions.crypt(trim(coalesce(in_pin, '')), p.pin_hash)
  );
$$;

create or replace function public.start_badge_device_login(
  in_badge_code text,
  in_pin text,
  in_device_id text
)
returns table(user_id uuid, email text)
language plpgsql
security definer
set search_path = public
as $$
declare
  clean_badge text := upper(trim(coalesce(in_badge_code, '')));
  clean_device_id text := nullif(trim(in_device_id), '');
  matched_profile record;
begin
  if clean_badge = '' then
    raise exception 'Badge code is required';
  end if;

  if clean_device_id is null or char_length(clean_device_id) < 16 or char_length(clean_device_id) > 128 then
    raise exception 'Invalid device identifier';
  end if;

  select p.id, p.email, p.pin_hash
    into matched_profile
  from public.profiles p
  where p.active = true
    and p.approved = true
    and upper(coalesce(p.badge_code, '')) = clean_badge
  limit 1;

  if matched_profile.id is null then
    raise exception 'No active approved user matched that badge';
  end if;

  if matched_profile.pin_hash is null
    or matched_profile.pin_hash <> extensions.crypt(trim(coalesce(in_pin, '')), matched_profile.pin_hash) then
    raise exception 'Invalid badge PIN';
  end if;

  if not exists (
    select 1
    from public.user_device_trust udt
    where udt.user_id = matched_profile.id
      and udt.device_id = clean_device_id
      and udt.expires_at > timezone('utc', now())
  ) then
    raise exception 'Email sign-in is required on this device before badge login';
  end if;

  update public.user_device_trust udt
  set last_used_at = timezone('utc', now()),
      updated_at = timezone('utc', now())
  where udt.user_id = matched_profile.id
    and udt.device_id = clean_device_id;

  return query select matched_profile.id::uuid, matched_profile.email::text;
end;
$$;

grant execute on function public.resolve_login_code(text) to anon, authenticated;
grant execute on function public.refresh_user_device_trust(text, text) to authenticated;
grant execute on function public.admin_update_user_pin(uuid, text) to authenticated;
grant execute on function public.verify_user_pin(uuid, text) to service_role;
grant execute on function public.start_badge_device_login(text, text, text) to service_role;
