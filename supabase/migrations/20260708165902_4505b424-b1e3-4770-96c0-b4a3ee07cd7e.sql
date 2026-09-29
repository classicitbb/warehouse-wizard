-- Normalize rack location scan codes to rack-bay-level-position only.
with parsed as (
  select id, code, regexp_split_to_array(upper(code), '-') as parts
  from public.locations
  where location_type = 'rack' and code is not null
),
legacy as (
  select id, code, parts, array_length(parts, 1) as part_count
  from parsed
  where array_length(parts, 1) >= 5
    and parts[array_length(parts, 1) - 1] ~ '^L[0-9]+$'
    and parts[array_length(parts, 1)] ~ '^P[0-9]+$'
)
update public.locations as locations
set code = concat(
  legacy.parts[legacy.part_count - 4], '-',
  lpad(legacy.parts[legacy.part_count - 2], 2, '0'),
  '-L', lpad(regexp_replace(legacy.parts[legacy.part_count - 1], '^L', ''), 2, '0'),
  '-P', regexp_replace(legacy.parts[legacy.part_count], '^P', '')
)
from legacy
where locations.id = legacy.id
  and locations.code <> concat(
    legacy.parts[legacy.part_count - 4], '-',
    lpad(legacy.parts[legacy.part_count - 2], 2, '0'),
    '-L', lpad(regexp_replace(legacy.parts[legacy.part_count - 1], '^L', ''), 2, '0'),
    '-P', regexp_replace(legacy.parts[legacy.part_count], '^P', '')
  );

-- Location level-style support
alter table public.locations
  add column if not exists level_style text not null default 'numeric';
update public.locations set level_style = 'numeric' where level_style is null;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'locations_level_style_check') then
    alter table public.locations
      add constraint locations_level_style_check check (level_style in ('numeric', 'alpha'));
  end if;
end $$;

create or replace function public.enforce_location_level_style()
returns trigger language plpgsql as $$
declare zone_conflict integer; bay_conflict integer;
begin
  select count(*) into zone_conflict from public.locations l
  where l.zone_id = new.zone_id and l.id <> new.id
    and coalesce(l.level_style, 'numeric') <> coalesce(new.level_style, 'numeric');
  if zone_conflict > 0 then
    raise exception 'Level style "%" conflicts with existing locations in this zone; a zone must use one level style.', new.level_style using errcode = '23514';
  end if;
  select count(*) into bay_conflict from public.locations l
  where l.warehouse_id = new.warehouse_id
    and l.aisle is not distinct from new.aisle
    and l.bay is not distinct from new.bay
    and l.id <> new.id
    and coalesce(l.level_style, 'numeric') <> coalesce(new.level_style, 'numeric');
  if bay_conflict > 0 then
    raise exception 'Level style "%" conflicts with existing locations in this bay; a bay must use one level style.', new.level_style using errcode = '23514';
  end if;
  return new;
end; $$;

drop trigger if exists trg_enforce_location_level_style on public.locations;
create trigger trg_enforce_location_level_style
  before insert or update of level_style, zone_id, warehouse_id, aisle, bay
  on public.locations for each row
  execute function public.enforce_location_level_style();

-- Omit P1 suffix for single-position bay-levels
with parsed as (
  select l.id, l.warehouse_id, l.zone_id, l.aisle, l.bay, l.level, l.position, l.code,
         regexp_replace(l.code, '-P0?1$', '', 'i') as base_code
  from public.locations as l
  where l.code ~* '-P0?1$' and coalesce(l.position, 1) = 1
),
single_position as (
  select parsed.id, parsed.base_code
  from parsed
  where not exists (
    select 1 from public.locations as sibling
    where sibling.id <> parsed.id
      and sibling.warehouse_id = parsed.warehouse_id
      and sibling.zone_id = parsed.zone_id
      and coalesce(sibling.aisle, '') = coalesce(parsed.aisle, '')
      and coalesce(sibling.bay, '') = coalesce(parsed.bay, '')
      and coalesce(sibling.level, -1) = coalesce(parsed.level, -1)
  )
  and not exists (
    select 1 from public.locations as existing
    where existing.id <> parsed.id and upper(existing.code) = upper(parsed.base_code)
  )
)
update public.locations as l
set code = single_position.base_code
from single_position where l.id = single_position.id;

-- Cycle counts live-safe foundation
alter type public.count_scope add value if not exists 'abc';

do $$ begin
  create type public.count_status as enum ('draft','frozen','counting','review','approved','closed','cancelled');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.count_line_status as enum ('queued','counted','recount','variance_hold','approved','adjusted','reconciled','exception');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.freeze_status as enum ('active','released','expired','overridden');
exception when duplicate_object then null; end $$;

alter table public.warehouses
  add column if not exists variance_value_floor numeric(14,2) not null default 500,
  add column if not exists supervisor_approval_cap numeric(14,2) not null default 1000,
  add column if not exists freeze_default_hours integer not null default 4;

alter table public.products
  add column if not exists velocity_class char(1) not null default 'C' check (velocity_class in ('A','B','C')),
  add column if not exists unit_cost numeric(14,2);

alter table public.cycle_counts
  add column if not exists snapshot_at timestamptz,
  add column if not exists freeze_expires_at timestamptz,
  add column if not exists schedule_id uuid,
  add column if not exists initiated_by uuid references auth.users(id);

alter table public.cycle_counts alter column status drop default;
alter table public.cycle_counts alter column status type public.count_status
using (case status::text
  when 'draft' then 'draft' when 'queued' then 'draft'
  when 'assigned' then 'counting' when 'in_progress' then 'counting'
  when 'completed' then 'closed' when 'cancelled' then 'cancelled'
  when 'exception' then 'review' else 'draft' end)::public.count_status;
alter table public.cycle_counts alter column status set default 'draft'::public.count_status;

alter table public.cycle_count_lines
  add column if not exists assigned_user_id uuid references auth.users(id),
  add column if not exists line_status public.count_line_status not null default 'queued',
  add column if not exists first_count_qty numeric(14,2),
  add column if not exists first_counted_by uuid references auth.users(id),
  add column if not exists first_counted_at timestamptz,
  add column if not exists recount_qty numeric(14,2),
  add column if not exists recounted_by uuid references auth.users(id),
  add column if not exists recounted_at timestamptz,
  add column if not exists approved_by uuid references auth.users(id),
  add column if not exists approved_at timestamptz,
  add column if not exists adjustment_id uuid references public.stock_adjustments(id) on delete set null,
  add column if not exists exception_reason text;

update public.cycle_count_lines
set line_status = case status::text
  when 'completed' then 'reconciled' when 'exception' then 'exception' else 'queued'
end::public.count_line_status
where line_status = 'queued'::public.count_line_status
  and status::text in ('completed','exception');

create table if not exists public.inventory_freezes (
  id uuid primary key default gen_random_uuid(),
  cycle_count_id uuid not null references public.cycle_counts(id) on delete cascade,
  warehouse_id uuid not null references public.warehouses(id),
  location_id uuid references public.locations(id),
  pallet_id uuid references public.pallets(id),
  status public.freeze_status not null default 'active',
  frozen_at timestamptz not null default timezone('utc', now()),
  expires_at timestamptz not null,
  released_at timestamptz,
  released_by uuid references auth.users(id),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default timezone('utc', now())
);
grant select, insert, update, delete on public.inventory_freezes to authenticated;
grant all on public.inventory_freezes to service_role;

create unique index if not exists uniq_active_freeze_per_location
  on public.inventory_freezes(location_id)
  where status = 'active' and location_id is not null;
create index if not exists idx_inventory_freezes_cycle_count on public.inventory_freezes(cycle_count_id);
create index if not exists idx_inventory_freezes_pallet_active on public.inventory_freezes(pallet_id) where status = 'active';

create table if not exists public.cycle_count_schedules (
  id uuid primary key default gen_random_uuid(),
  warehouse_id uuid not null references public.warehouses(id),
  name text not null,
  velocity_class char(1) check (velocity_class in ('A','B','C')),
  zone_id uuid references public.zones(id),
  frequency_days integer not null,
  variance_threshold_percent numeric(5,2) not null default 5,
  next_run_at timestamptz not null,
  active boolean not null default true,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default timezone('utc', now())
);
grant select, insert, update, delete on public.cycle_count_schedules to authenticated;
grant all on public.cycle_count_schedules to service_role;

alter table public.cycle_counts drop constraint if exists cycle_counts_schedule_id_fkey;
alter table public.cycle_counts
  add constraint cycle_counts_schedule_id_fkey
  foreign key (schedule_id) references public.cycle_count_schedules(id) on delete set null;

alter table public.cycle_count_lines
  drop constraint if exists cycle_count_lines_recount_different_counter,
  add constraint cycle_count_lines_recount_different_counter
  check (recounted_by is null or first_counted_by is null or recounted_by <> first_counted_by);

alter table public.cycle_count_lines
  drop constraint if exists cycle_count_lines_approval_separation,
  add constraint cycle_count_lines_approval_separation
  check (approved_by is null or (
    approved_by <> coalesce(first_counted_by, '00000000-0000-0000-0000-000000000000'::uuid)
    and approved_by <> coalesce(recounted_by, '00000000-0000-0000-0000-000000000000'::uuid)
  ));

create or replace function public.has_min_role(_user_id uuid, _minimum_role text)
returns boolean language sql stable security definer set search_path = public as $$
  with role_rank(code, rank_value) as (
    values ('warehouse_operator',10),('inventory_clerk',20),('warehouse_supervisor',30),
           ('warehouse_manager',40),('admin',50),('developer',60)
  ),
  minimum as (select rank_value from role_rank where code = _minimum_role)
  select exists (
    select 1 from public.user_roles ur
    join public.roles r on r.id = ur.role_id
    join role_rank rr on rr.code = r.code::text
    cross join minimum
    where ur.user_id = _user_id and rr.rank_value >= minimum.rank_value
  );
$$;

create or replace function public.assert_location_not_frozen(in_location_id uuid, in_pallet_id uuid default null)
returns void language plpgsql stable security definer set search_path = public as $$
declare freeze_row record;
begin
  select f.id, cc.count_number, f.expires_at into freeze_row
  from public.inventory_freezes f
  join public.cycle_counts cc on cc.id = f.cycle_count_id
  where f.status = 'active'
    and (f.location_id = in_location_id or (in_pallet_id is not null and f.pallet_id = in_pallet_id))
  order by f.frozen_at desc limit 1;
  if freeze_row.id is not null then
    raise exception 'FROZEN_BIN: Location is locked by cycle count % until %', freeze_row.count_number, freeze_row.expires_at;
  end if;
end; $$;

create or replace function public.compute_cycle_count_line_variance()
returns trigger language plpgsql security definer set search_path = public as $$
declare observed_quantity numeric(14,2);
begin
  observed_quantity := coalesce(new.recount_qty, new.first_count_qty, new.counted_quantity);
  if observed_quantity is not null then
    new.variance_quantity := observed_quantity - coalesce(new.expected_quantity, 0);
    if coalesce(new.expected_quantity, 0) = 0 then
      new.variance_percent := case when new.variance_quantity = 0 then 0 else 100 end;
    else
      new.variance_percent := abs((new.variance_quantity / new.expected_quantity) * 100);
    end if;
  end if;
  return new;
end; $$;

drop trigger if exists trg_compute_cycle_count_line_variance on public.cycle_count_lines;
create trigger trg_compute_cycle_count_line_variance
  before insert or update of first_count_qty, recount_qty, counted_quantity, expected_quantity
  on public.cycle_count_lines for each row execute function public.compute_cycle_count_line_variance();

alter table public.inventory_freezes enable row level security;
alter table public.cycle_count_schedules enable row level security;

do $$ declare pol record;
begin
  for pol in select tablename, policyname from pg_policies
    where schemaname = 'public' and tablename in ('cycle_counts', 'cycle_count_lines')
  loop
    execute format('drop policy if exists %I on public.%I', pol.policyname, pol.tablename);
  end loop;
end $$;

create policy "Cycle count headers visible by role or assignment"
  on public.cycle_counts for select to authenticated
  using (public.has_min_role(auth.uid(), 'warehouse_supervisor') or initiated_by = auth.uid());
create policy "Supervisors create cycle count headers"
  on public.cycle_counts for insert to authenticated
  with check (public.has_min_role(auth.uid(), 'warehouse_supervisor'));
create policy "Supervisors update cycle count headers"
  on public.cycle_counts for update to authenticated
  using (public.has_min_role(auth.uid(), 'warehouse_supervisor'))
  with check (public.has_min_role(auth.uid(), 'warehouse_supervisor'));

create policy "Cycle count lines visible by role or assignment"
  on public.cycle_count_lines for select to authenticated
  using (public.has_min_role(auth.uid(), 'warehouse_supervisor') or assigned_user_id = auth.uid() or assigned_user_id is null);
create policy "Supervisors create cycle count lines"
  on public.cycle_count_lines for insert to authenticated
  with check (public.has_min_role(auth.uid(), 'warehouse_supervisor'));
create policy "Counters update assigned open count lines"
  on public.cycle_count_lines for update to authenticated
  using ((assigned_user_id = auth.uid() or assigned_user_id is null) and line_status in ('queued','recount'))
  with check ((assigned_user_id = auth.uid() or assigned_user_id is null)
    and line_status in ('queued','recount','reconciled','variance_hold','exception')
    and approved_by is null and approved_at is null and adjustment_id is null);
create policy "Supervisors approve cycle count lines"
  on public.cycle_count_lines for update to authenticated
  using (public.has_min_role(auth.uid(), 'warehouse_supervisor')
    and auth.uid() <> coalesce(first_counted_by, '00000000-0000-0000-0000-000000000000'::uuid)
    and auth.uid() <> coalesce(recounted_by, '00000000-0000-0000-0000-000000000000'::uuid))
  with check (public.has_min_role(auth.uid(), 'warehouse_supervisor')
    and auth.uid() <> coalesce(first_counted_by, '00000000-0000-0000-0000-000000000000'::uuid)
    and auth.uid() <> coalesce(recounted_by, '00000000-0000-0000-0000-000000000000'::uuid));

drop policy if exists "Approved users read inventory_freezes" on public.inventory_freezes;
create policy "Approved users read inventory_freezes"
  on public.inventory_freezes for select to authenticated using (public.is_approved());
drop policy if exists "Supervisors manage inventory_freezes" on public.inventory_freezes;
create policy "Supervisors manage inventory_freezes"
  on public.inventory_freezes for all to authenticated
  using (public.has_min_role(auth.uid(), 'warehouse_supervisor'))
  with check (public.has_min_role(auth.uid(), 'warehouse_supervisor'));

drop policy if exists "Approved users read cycle_count_schedules" on public.cycle_count_schedules;
create policy "Approved users read cycle_count_schedules"
  on public.cycle_count_schedules for select to authenticated using (public.is_approved());
drop policy if exists "Managers manage cycle_count_schedules" on public.cycle_count_schedules;
create policy "Managers manage cycle_count_schedules"
  on public.cycle_count_schedules for all to authenticated
  using (public.has_min_role(auth.uid(), 'warehouse_manager'))
  with check (public.has_min_role(auth.uid(), 'warehouse_manager'));

grant execute on function public.has_min_role(uuid, text) to authenticated;
grant execute on function public.assert_location_not_frozen(uuid, uuid) to authenticated;

-- Restore inventory_freezes FKs for pre-existing tables
do $$ begin
  if to_regclass('public.inventory_freezes') is not null
    and not exists (select 1 from pg_constraint where conname = 'inventory_freezes_cycle_count_id_fkey' and conrelid = 'public.inventory_freezes'::regclass)
  then alter table public.inventory_freezes add constraint inventory_freezes_cycle_count_id_fkey
    foreign key (cycle_count_id) references public.cycle_counts(id) on delete cascade not valid;
  end if;
end $$;
do $$ begin
  if to_regclass('public.inventory_freezes') is not null
    and not exists (select 1 from pg_constraint where conname = 'inventory_freezes_warehouse_id_fkey' and conrelid = 'public.inventory_freezes'::regclass)
  then alter table public.inventory_freezes add constraint inventory_freezes_warehouse_id_fkey
    foreign key (warehouse_id) references public.warehouses(id) not valid;
  end if;
end $$;
do $$ begin
  if to_regclass('public.inventory_freezes') is not null
    and not exists (select 1 from pg_constraint where conname = 'inventory_freezes_location_id_fkey' and conrelid = 'public.inventory_freezes'::regclass)
  then alter table public.inventory_freezes add constraint inventory_freezes_location_id_fkey
    foreign key (location_id) references public.locations(id) not valid;
  end if;
end $$;
do $$ begin
  if to_regclass('public.inventory_freezes') is not null
    and not exists (select 1 from pg_constraint where conname = 'inventory_freezes_pallet_id_fkey' and conrelid = 'public.inventory_freezes'::regclass)
  then alter table public.inventory_freezes add constraint inventory_freezes_pallet_id_fkey
    foreign key (pallet_id) references public.pallets(id) not valid;
  end if;
end $$;
do $$ begin
  if to_regclass('public.inventory_freezes') is not null
    and not exists (select 1 from pg_constraint where conname = 'inventory_freezes_created_by_fkey' and conrelid = 'public.inventory_freezes'::regclass)
  then alter table public.inventory_freezes add constraint inventory_freezes_created_by_fkey
    foreign key (created_by) references auth.users(id) not valid;
  end if;
end $$;
do $$ begin
  if to_regclass('public.inventory_freezes') is not null
    and not exists (select 1 from pg_constraint where conname = 'inventory_freezes_released_by_fkey' and conrelid = 'public.inventory_freezes'::regclass)
  then alter table public.inventory_freezes add constraint inventory_freezes_released_by_fkey
    foreign key (released_by) references auth.users(id) not valid;
  end if;
end $$;

notify pgrst, 'reload schema';