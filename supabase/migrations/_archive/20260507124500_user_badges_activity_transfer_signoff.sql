alter type public.movement_type add value if not exists 'user_sign_in';
alter type public.movement_type add value if not exists 'user_access_change';
alter type public.movement_type add value if not exists 'transfer_driver_signoff';

alter table public.profiles
  add column if not exists user_code text,
  add column if not exists badge_code text;

create unique index if not exists idx_profiles_user_code_unique
  on public.profiles (upper(user_code))
  where user_code is not null and user_code <> '';

create unique index if not exists idx_profiles_badge_code_unique
  on public.profiles (upper(badge_code))
  where badge_code is not null and badge_code <> '';

alter table public.transfers
  add column if not exists dispatch_signed_off_by uuid references public.profiles(id) on delete set null,
  add column if not exists dispatch_signed_off_at timestamptz,
  add column if not exists dispatch_signoff_code text;

create or replace function public.resolve_login_code(in_login_code text)
returns text
language sql
security definer
set search_path = public
as $$
  select email
  from public.profiles
  where active = true
    and approved = true
    and (
      upper(coalesce(user_code, '')) = upper(trim(in_login_code))
      or upper(coalesce(badge_code, '')) = upper(trim(in_login_code))
    )
  limit 1;
$$;

grant execute on function public.resolve_login_code(text) to anon, authenticated;

update public.profiles
set user_code = case id
    when '11111111-1111-1111-1111-111111111111' then 'ADMIN01'
    when '22222222-2222-2222-2222-222222222222' then 'MGR01'
    when '33333333-3333-3333-3333-333333333333' then 'CLK01'
    when '44444444-4444-4444-4444-444444444444' then 'OPR01'
    when '55555555-5555-5555-5555-555555555555' then 'DRV01'
    when '66666666-6666-6666-6666-666666666666' then 'SUP01'
    else user_code
  end,
  badge_code = case id
    when '11111111-1111-1111-1111-111111111111' then 'BADGE-ADMIN01'
    when '22222222-2222-2222-2222-222222222222' then 'BADGE-MGR01'
    when '33333333-3333-3333-3333-333333333333' then 'BADGE-CLK01'
    when '44444444-4444-4444-4444-444444444444' then 'BADGE-OPR01'
    when '55555555-5555-5555-5555-555555555555' then 'BADGE-DRV01'
    when '66666666-6666-6666-6666-666666666666' then 'BADGE-SUP01'
    else badge_code
  end
where id in (
  '11111111-1111-1111-1111-111111111111',
  '22222222-2222-2222-2222-222222222222',
  '33333333-3333-3333-3333-333333333333',
  '44444444-4444-4444-4444-444444444444',
  '55555555-5555-5555-5555-555555555555',
  '66666666-6666-6666-6666-666666666666'
);
