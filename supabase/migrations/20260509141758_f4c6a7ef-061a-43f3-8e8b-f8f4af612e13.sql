
-- Add is_hidden archive flag to tables the app filters by it
alter table public.zones add column if not exists is_hidden boolean not null default false;
alter table public.locations add column if not exists is_hidden boolean not null default false;
alter table public.product_packaging_profiles add column if not exists is_hidden boolean not null default false;
alter table public.user_roles add column if not exists is_hidden boolean not null default false;
alter table public.clients add column if not exists is_hidden boolean not null default false;
alter table public.products add column if not exists is_hidden boolean not null default false;
alter table public.warehouses add column if not exists is_hidden boolean not null default false;

-- Seed profile rows for the demo auth users so RLS (is_approved) lets them see and write data.
insert into public.profiles (id, email, full_name, active, approved)
values
  ('11111111-1111-1111-1111-111111111111', 'admin@warehousewizard.local',      'System Admin',     true, true),
  ('22222222-2222-2222-2222-222222222222', 'manager@warehousewizard.local',    'Shanice Jordan',   true, true),
  ('33333333-3333-3333-3333-333333333333', 'clerk@warehousewizard.local',      'Darnell Clarke',   true, true),
  ('44444444-4444-4444-4444-444444444444', 'operator@warehousewizard.local',   'Kemar Holder',     true, true),
  ('55555555-5555-5555-5555-555555555555', 'driver@warehousewizard.local',     'Janelle Ifill',    true, true),
  ('66666666-6666-6666-6666-666666666666', 'supervisor@warehousewizard.local', 'Andre Wilde',      true, true)
on conflict (id) do update
  set email = excluded.email,
      full_name = excluded.full_name,
      active = excluded.active,
      approved = excluded.approved,
      updated_at = now();
