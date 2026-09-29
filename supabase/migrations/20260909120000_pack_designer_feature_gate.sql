-- Pack Pak Designer: pallet space allowance, a release gate for unshipped
-- features, and making the Role Matrix actually govern the packaging feature.
--
-- Additive only. Three independent pieces:
--   1. warehouses.pallet_space_allowance_* — the slot envelope a pallet lives in.
--   2. permission_features.is_released — a generic gate for unshipped surfaces.
--   3. has_feature_permission() + widened RLS on product_packaging_profiles,
--      so an inventory clerk can record a pack standard on the floor instead of
--      being shown a button the database refuses.

-- ============================================================
-- 1. Pallet space allowance
-- ============================================================
-- The pallet itself (product_packaging_profiles.pallet_footprint_*) is smaller
-- than the slot it stands in. Keeping both lets the renderer draw the envelope
-- and make overhang visible, which a single number hides.
alter table public.warehouses
  add column if not exists pallet_space_allowance_length_mm integer not null default 1250,
  add column if not exists pallet_space_allowance_width_mm  integer not null default 1250;

comment on column public.warehouses.pallet_space_allowance_length_mm is
  'Slot envelope length in mm. Pallets sit slightly smaller inside it. Default 1250.';
comment on column public.warehouses.pallet_space_allowance_width_mm is
  'Slot envelope width in mm. Pallets sit slightly smaller inside it. Default 1250.';

-- ============================================================
-- 2. Release gate on a feature
-- ============================================================
-- Existing rows default to released, so this is behaviour-preserving. An
-- unreleased feature is visible only to developers, whatever the matrix says.
alter table public.permission_features
  add column if not exists is_released boolean not null default true;

comment on column public.permission_features.is_released is
  'False hides the feature from everyone but developers, regardless of role_permissions. Flip to release without a deploy.';

insert into public.permission_features (code, name, description, sort_order, is_released)
values ('pack_designer', 'Pallet Pak Designer', 'Design pallet build standards and preview the stack', 145, false)
on conflict (code) do update set
  name        = excluded.name,
  description = excluded.description,
  sort_order  = excluded.sort_order,
  updated_at  = timezone('utc', now());
-- Note: is_released is deliberately NOT in the DO UPDATE list. Re-running this
-- migration must never un-release a feature an admin has already released.

-- Seed the end state now, so releasing is one toggle rather than a
-- configuration exercise performed under pressure.
insert into public.role_permissions (role_id, feature_id, can_view, can_edit)
select r.id, f.id,
  r.code::text in ('admin', 'developer', 'warehouse_manager', 'warehouse_supervisor', 'inventory_clerk'),
  r.code::text in ('admin', 'developer', 'warehouse_manager', 'warehouse_supervisor')
from public.roles r
cross join public.permission_features f
where f.code = 'pack_designer'
on conflict (role_id, feature_id) do nothing;

-- ------------------------------------------------------------
-- Repair: the 20260820204306 matrix seed grants warehouse_manager and
-- warehouse_supervisor can_edit on 'packaging' but omits 'packaging' from
-- their can_view list, which contradicts role_permissions_edit_requires_view.
-- Any row in that state would have aborted the original insert, so the rows
-- may be missing or inconsistent depending on when a database was built.
-- Reconcile before anything starts reading the matrix for real.
-- ------------------------------------------------------------
update public.role_permissions set can_view = true, updated_at = timezone('utc', now())
where can_edit and not can_view;

insert into public.role_permissions (role_id, feature_id, can_view, can_edit)
select r.id, f.id, true, true
from public.roles r
cross join public.permission_features f
where f.code = 'packaging'
  and r.code::text in ('admin', 'developer', 'warehouse_manager', 'warehouse_supervisor')
on conflict (role_id, feature_id) do update set
  can_view = true,
  can_edit = true,
  updated_at = timezone('utc', now());

-- ============================================================
-- 3. Feature permission function
-- ============================================================
create or replace function public.has_feature_permission(
  _user_id uuid,
  _feature_code text,
  _mode text default 'view'
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_roles ur
    join public.roles r on r.id = ur.role_id
    join public.role_permissions rp on rp.role_id = r.id
    join public.permission_features pf on pf.id = rp.feature_id
    where ur.user_id = _user_id
      and pf.code = _feature_code
      and case when _mode = 'edit' then rp.can_edit else rp.can_view end
      -- An unreleased feature is developer-only, whatever the matrix says.
      -- Client and server apply one rule here on purpose: the packaging mess
      -- this replaces is what happens when the two disagree.
      and (pf.is_released or r.code::text = 'developer')
  );
$$;

comment on function public.has_feature_permission(uuid, text, text) is
  'Role Matrix lookup for one feature. Honours permission_features.is_released, which restricts an unreleased feature to developers.';

revoke execute on function public.has_feature_permission(uuid, text, text) from anon, public;
grant execute on function public.has_feature_permission(uuid, text, text) to authenticated;

-- ============================================================
-- 4. Packaging profile writes follow the matrix
-- ============================================================
-- Only this table changes. The other master tables keep the manager-tier gate.
--
-- The has_min_role arm stays alongside the matrix arm deliberately: a missing
-- or malformed matrix row must never be able to lock a warehouse manager out
-- of master data. The matrix can only widen access here, never narrow it.
drop policy if exists "Managers write product_packaging_profiles" on public.product_packaging_profiles;
drop policy if exists "Managers update product_packaging_profiles" on public.product_packaging_profiles;
drop policy if exists "Managers delete product_packaging_profiles" on public.product_packaging_profiles;

create policy "Packaging writers insert profiles"
  on public.product_packaging_profiles for insert to authenticated
  with check (
    public.is_approved()
    and (
      public.has_min_role(auth.uid(), 'warehouse_manager')
      or public.has_feature_permission(auth.uid(), 'packaging', 'edit')
    )
  );

create policy "Packaging writers update profiles"
  on public.product_packaging_profiles for update to authenticated
  using (
    public.is_approved()
    and (
      public.has_min_role(auth.uid(), 'warehouse_manager')
      or public.has_feature_permission(auth.uid(), 'packaging', 'edit')
    )
  )
  with check (
    public.is_approved()
    and (
      public.has_min_role(auth.uid(), 'warehouse_manager')
      or public.has_feature_permission(auth.uid(), 'packaging', 'edit')
    )
  );

-- Deletes stay manager-tier. Widening who may *create* a standard on the floor
-- is the point of this change; widening who may destroy one is not.
create policy "Managers delete product_packaging_profiles"
  on public.product_packaging_profiles for delete to authenticated
  using (public.is_approved() and public.has_min_role(auth.uid(), 'warehouse_manager'));
