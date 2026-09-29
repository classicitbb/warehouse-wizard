-- Persist Command Center tile visibility per user and tile layout per user/device.

create table if not exists public.dashboard_tile_visibility (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  mode text not null,
  tile_id text not null,
  visible boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (user_id, mode, tile_id),
  constraint dashboard_tile_visibility_mode_check check (mode in ('floor', 'dock', 'office')),
  constraint dashboard_tile_visibility_tile_id_length check (char_length(trim(tile_id)) between 1 and 120)
);

create table if not exists public.dashboard_device_tile_layout (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  device_id text not null,
  mode text not null,
  layout jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (user_id, device_id, mode),
  constraint dashboard_device_tile_layout_mode_check check (mode in ('floor', 'dock', 'office')),
  constraint dashboard_device_tile_layout_device_id_length check (char_length(trim(device_id)) between 16 and 128),
  constraint dashboard_device_tile_layout_is_array check (jsonb_typeof(layout) = 'array')
);

alter table public.dashboard_tile_visibility enable row level security;
alter table public.dashboard_device_tile_layout enable row level security;

drop policy if exists "dashboard_tile_visibility self read" on public.dashboard_tile_visibility;
create policy "dashboard_tile_visibility self read"
  on public.dashboard_tile_visibility for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "dashboard_tile_visibility self insert" on public.dashboard_tile_visibility;
create policy "dashboard_tile_visibility self insert"
  on public.dashboard_tile_visibility for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "dashboard_tile_visibility self update" on public.dashboard_tile_visibility;
create policy "dashboard_tile_visibility self update"
  on public.dashboard_tile_visibility for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "dashboard_tile_visibility self delete" on public.dashboard_tile_visibility;
create policy "dashboard_tile_visibility self delete"
  on public.dashboard_tile_visibility for delete
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "dashboard_device_tile_layout self read" on public.dashboard_device_tile_layout;
create policy "dashboard_device_tile_layout self read"
  on public.dashboard_device_tile_layout for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "dashboard_device_tile_layout self insert" on public.dashboard_device_tile_layout;
create policy "dashboard_device_tile_layout self insert"
  on public.dashboard_device_tile_layout for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "dashboard_device_tile_layout self update" on public.dashboard_device_tile_layout;
create policy "dashboard_device_tile_layout self update"
  on public.dashboard_device_tile_layout for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "dashboard_device_tile_layout self delete" on public.dashboard_device_tile_layout;
create policy "dashboard_device_tile_layout self delete"
  on public.dashboard_device_tile_layout for delete
  to authenticated
  using (auth.uid() = user_id);

create index if not exists idx_dashboard_tile_visibility_user
  on public.dashboard_tile_visibility (user_id);

create index if not exists idx_dashboard_device_tile_layout_user_device
  on public.dashboard_device_tile_layout (user_id, device_id);
