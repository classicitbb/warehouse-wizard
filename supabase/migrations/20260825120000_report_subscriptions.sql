-- Report subscriptions: a user subscribes to a catalog report for one warehouse
-- (or all warehouses they can see, i.e. overseer scope when warehouse_id is null).
-- Additive only. Row access is limited to the owner; warehouse visibility of the
-- underlying data is still enforced by the existing warehouse-scoped RLS.

create table if not exists public.report_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  report_id text not null,
  warehouse_id uuid references public.warehouses (id) on delete cascade,
  frequency text not null default 'weekly' check (frequency in ('daily', 'weekly', 'monthly')),
  email_delivery boolean not null default false,
  active boolean not null default true,
  last_delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists report_subscriptions_unique_scope
  on public.report_subscriptions (user_id, report_id, coalesce(warehouse_id, '00000000-0000-0000-0000-000000000000'::uuid));

alter table public.report_subscriptions enable row level security;

drop policy if exists "report_subscriptions_select_own" on public.report_subscriptions;
create policy "report_subscriptions_select_own" on public.report_subscriptions
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "report_subscriptions_insert_own" on public.report_subscriptions;
create policy "report_subscriptions_insert_own" on public.report_subscriptions
  for insert to authenticated
  with check (user_id = auth.uid() and (warehouse_id is null or public.can_access_warehouse(warehouse_id)));

drop policy if exists "report_subscriptions_update_own" on public.report_subscriptions;
create policy "report_subscriptions_update_own" on public.report_subscriptions
  for update to authenticated using (user_id = auth.uid())
  with check (user_id = auth.uid() and (warehouse_id is null or public.can_access_warehouse(warehouse_id)));

drop policy if exists "report_subscriptions_delete_own" on public.report_subscriptions;
create policy "report_subscriptions_delete_own" on public.report_subscriptions
  for delete to authenticated using (user_id = auth.uid());

grant select, insert, update, delete on public.report_subscriptions to authenticated;
