-- Restore profile login-code columns for self-serve user access.

alter table public.profiles
  add column if not exists user_code text,
  add column if not exists badge_code text;

create unique index if not exists idx_profiles_user_code_unique
  on public.profiles (upper(user_code))
  where user_code is not null and user_code <> '';

create unique index if not exists idx_profiles_badge_code_unique
  on public.profiles (upper(badge_code))
  where badge_code is not null and badge_code <> '';

create or replace function public.resolve_login_code(in_login_code text)
returns text
language sql
stable
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

revoke execute on function public.resolve_login_code(text) from anon;
grant execute on function public.resolve_login_code(text) to authenticated;
