-- Accept either badge code or user code for trusted-device PIN login.
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
  clean_code text := upper(trim(coalesce(in_badge_code, '')));
  clean_device_id text := nullif(trim(in_device_id), '');
  clean_ip text := nullif(left(trim(coalesce(in_current_ip, '')), 128), '');
  matched_profile record;
begin
  if in_is_desktop then
    raise exception 'Badge sign-in is unavailable';
  end if;

  if clean_code = '' then
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
    and (
      upper(coalesce(p.badge_code, '')) = clean_code
      or upper(coalesce(p.user_code, '')) = clean_code
    )
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

-- Ensure the primary PIN update function exists before adding the compatibility overload.
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

-- Compatibility overload for schema-cache/client argument-order drift.
create or replace function public.admin_update_user_pin(
  in_pin text,
  in_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.admin_update_user_pin(in_user_id, in_pin);
end;
$$;

grant execute on function public.start_badge_device_login(text, text, text, text, boolean) to service_role;
grant execute on function public.admin_update_user_pin(uuid, text) to authenticated;
grant execute on function public.admin_update_user_pin(text, uuid) to authenticated;
