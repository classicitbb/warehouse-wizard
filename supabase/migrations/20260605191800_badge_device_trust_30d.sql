-- Badge sign-in hardening: trusted mobile/tablet device only, 30-day expiry,
-- active trust records, and same client IP enforcement.

alter table public.user_device_trust
  add column if not exists last_known_ip text,
  add column if not exists is_active boolean not null default true;

create index if not exists idx_user_device_trust_active_device
  on public.user_device_trust (user_id, device_id, is_active, expires_at);

drop function if exists public.refresh_user_device_trust(text, text);

create or replace function public.refresh_user_device_trust(
  in_device_id text,
  in_user_agent text default null,
  in_last_known_ip text default null,
  in_is_desktop boolean default false
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

  if in_is_desktop then
    raise exception 'Trusted badge sign-in is only available on mobile or tablet devices';
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
    last_known_ip,
    is_active,
    updated_at
  )
  values (
    auth.uid(),
    clean_device_id,
    timezone('utc', now()),
    timezone('utc', now()) + interval '30 days',
    timezone('utc', now()),
    nullif(left(coalesce(in_user_agent, ''), 500), ''),
    nullif(left(coalesce(in_last_known_ip, ''), 128), ''),
    true,
    timezone('utc', now())
  )
  on conflict (user_id, device_id) do update
    set trusted_at = excluded.trusted_at,
        expires_at = excluded.expires_at,
        last_used_at = excluded.last_used_at,
        user_agent = excluded.user_agent,
        last_known_ip = excluded.last_known_ip,
        is_active = true,
        updated_at = excluded.updated_at;
end;
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
begin
  raise exception 'Badge sign-in requires a trusted mobile or tablet device';
end;
$$;

create or replace function public.start_badge_device_login(
  in_badge_code text,
  in_pin text,
  in_device_id text,
  in_current_ip text,
  in_is_desktop boolean
)
returns table(user_id uuid, email text)
language plpgsql
security definer
set search_path = public
as $$
declare
  clean_badge text := upper(trim(coalesce(in_badge_code, '')));
  clean_device_id text := nullif(trim(in_device_id), '');
  clean_ip text := nullif(left(trim(coalesce(in_current_ip, '')), 128), '');
  matched_profile record;
begin
  if in_is_desktop then
    raise exception 'Badge sign-in is unavailable';
  end if;

  if clean_badge = '' then
    raise exception 'Badge sign-in is unavailable';
  end if;

  if clean_device_id is null or char_length(clean_device_id) < 16 or char_length(clean_device_id) > 128 then
    raise exception 'Badge sign-in is unavailable';
  end if;

  select p.id, p.email, p.pin_hash
    into matched_profile
  from public.profiles p
  where p.active = true
    and p.approved = true
    and upper(coalesce(p.badge_code, '')) = clean_badge
  limit 1;

  if matched_profile.id is null then
    raise exception 'Badge sign-in is unavailable';
  end if;

  if matched_profile.pin_hash is null
    or matched_profile.pin_hash <> extensions.crypt(trim(coalesce(in_pin, '')), matched_profile.pin_hash) then
    raise exception 'Badge sign-in is unavailable';
  end if;

  if not exists (
    select 1
    from public.user_device_trust udt
    where udt.user_id = matched_profile.id
      and udt.device_id = clean_device_id
      and udt.is_active = true
      and udt.expires_at > timezone('utc', now())
      and coalesce(udt.last_known_ip, '') = coalesce(clean_ip, '')
  ) then
    raise exception 'Badge sign-in is unavailable';
  end if;

  update public.user_device_trust udt
  set last_used_at = timezone('utc', now()),
      updated_at = timezone('utc', now())
  where udt.user_id = matched_profile.id
    and udt.device_id = clean_device_id;

  return query select matched_profile.id::uuid, matched_profile.email::text;
end;
$$;

grant execute on function public.refresh_user_device_trust(text, text, text, boolean) to authenticated;
grant execute on function public.start_badge_device_login(text, text, text) to service_role;
grant execute on function public.start_badge_device_login(text, text, text, text, boolean) to service_role;
