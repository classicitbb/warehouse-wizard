-- Fleet freshness: a server-controlled minimum build version plus a per-device
-- heartbeat so an admin can see who is actually running the hot fix.
--
-- app_release_policy is a singleton: one row, readable by every authenticated
-- client (the version gate runs on every tablet) and writable only by admins
-- and developers.

create table if not exists public.app_release_policy (
  id boolean primary key default true check (id),
  -- Builds older than this must reload. Null disables the gate entirely.
  min_required_version text check (min_required_version is null or char_length(min_required_version) between 1 and 40),
  -- When the grace period ends. Null falls back to grace_minutes from first sight.
  force_after timestamptz,
  grace_minutes integer not null default 10 check (grace_minutes between 0 and 240),
  message text check (message is null or char_length(message) <= 300),
  nightly_signout_enabled boolean not null default false,
  daily_refresh_enabled boolean not null default true,
  daily_refresh_hour integer not null default 4 check (daily_refresh_hour between 0 and 23),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

insert into public.app_release_policy (id) values (true) on conflict (id) do nothing;

create or replace function public.app_release_policy_touch()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.id := true;
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;

drop trigger if exists app_release_policy_touch on public.app_release_policy;
create trigger app_release_policy_touch before insert or update on public.app_release_policy
  for each row execute function public.app_release_policy_touch();

alter table public.app_release_policy enable row level security;

-- Every signed-in client reads the policy; nobody but admin/developer writes it.
drop policy if exists "release policy readable" on public.app_release_policy;
create policy "release policy readable" on public.app_release_policy
  for select to authenticated using (true);

drop policy if exists "release policy admin update" on public.app_release_policy;
create policy "release policy admin update" on public.app_release_policy
  for update to authenticated
  using (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'developer'))
  with check (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'developer'));

grant select, update on public.app_release_policy to authenticated;
grant all on public.app_release_policy to service_role;
revoke execute on function public.app_release_policy_touch() from public, anon, authenticated;

-- ── Client heartbeat ─────────────────────────────────────────────────────────
-- One row per signed-in session on a device, upserted every few minutes with
-- the build it is running. This is what makes "force everyone onto vX"
-- verifiable: an admin can see the fleet drain off the old version instead of
-- hoping it did.
--
-- Keyed on (device_id, user_id), not device_id alone. Floor tablets are shared:
-- with a device-only key, the second operator to sign in would collide with the
-- first operator's row, and RLS (which only lets a user write their own row)
-- would refuse the upsert — so exactly the shared devices this feature exists
-- to track would silently vanish from the fleet count.

create table if not exists public.app_client_heartbeat (
  device_id text not null check (char_length(device_id) between 8 and 128),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  app_version text not null check (char_length(app_version) between 1 and 40),
  last_seen_at timestamptz not null default now(),
  user_label text check (user_label is null or char_length(user_label) <= 120),
  primary key (device_id, user_id)
);

create index if not exists app_client_heartbeat_last_seen_idx
  on public.app_client_heartbeat (last_seen_at desc);

create or replace function public.app_client_heartbeat_touch()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Heartbeat requires a signed-in session'; end if;
  new.user_id := auth.uid();
  new.last_seen_at := now();
  return new;
end;
$$;

drop trigger if exists app_client_heartbeat_touch on public.app_client_heartbeat;
create trigger app_client_heartbeat_touch before insert or update on public.app_client_heartbeat
  for each row execute function public.app_client_heartbeat_touch();

alter table public.app_client_heartbeat enable row level security;

-- A device writes only its own row; supervisors and above read the fleet.
drop policy if exists "heartbeat own write" on public.app_client_heartbeat;
create policy "heartbeat own write" on public.app_client_heartbeat
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists "heartbeat own update" on public.app_client_heartbeat;
create policy "heartbeat own update" on public.app_client_heartbeat
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "heartbeat readable" on public.app_client_heartbeat;
create policy "heartbeat readable" on public.app_client_heartbeat
  for select to authenticated
  using (
    user_id = auth.uid()
    or public.has_role(auth.uid(), 'admin')
    or public.has_role(auth.uid(), 'developer')
    or public.has_role(auth.uid(), 'warehouse_manager')
  );

grant select, insert, update on public.app_client_heartbeat to authenticated;
grant all on public.app_client_heartbeat to service_role;
revoke execute on function public.app_client_heartbeat_touch() from public, anon, authenticated;
