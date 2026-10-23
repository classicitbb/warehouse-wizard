-- Customers mirrored from NetSuite (outbound picking design, slice B / D1).
-- Separate from public.clients on purpose: clients own stock
-- (products.client_owner_id, inventory_balances.client_id), whereas customers
-- are the ship-to parties on sales orders. Rows are written by the
-- netsuite-customers edge function (service role) and linked through
-- external_record_links (local_table 'customers', external_record_type
-- 'customer'). Balances and credit notes are deliberately not stored.
create table if not exists public.customers (
  id                     uuid primary key default gen_random_uuid(),
  customer_number        text not null,
  name                   text not null,
  delivery_zone          text,
  default_ship_address   jsonb,
  email                  text,
  phone                  text,
  on_credit_hold         boolean not null default false,
  credit_review_required boolean not null default false,
  ship_complete          boolean not null default false,
  active                 boolean not null default true,
  -- NetSuite lastmodifieddate in the account's own time zone; the delta cursor.
  source_modified_at     timestamp without time zone,
  last_synced_at         timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create index if not exists customers_customer_number_idx on public.customers (customer_number);
create index if not exists customers_name_idx on public.customers (lower(name));
create index if not exists customers_delivery_zone_idx on public.customers (delivery_zone);
create index if not exists customers_source_modified_at_idx on public.customers (source_modified_at);

drop trigger if exists set_customers_updated_at on public.customers;
create trigger set_customers_updated_at
  before update on public.customers
  for each row execute function public.update_updated_at_column();

-- Data API access: the RLS policies below scope everything to approved
-- authenticated users, so no anon grant.
grant select, insert, update, delete on public.customers to authenticated;
grant all on public.customers to service_role;

-- Same RLS as the other master-data tables: any approved user reads, the
-- warehouse_manager tier (admin/developer inherit) writes.
alter table public.customers enable row level security;

drop policy if exists "Approved users can read customers" on public.customers;
create policy "Approved users can read customers" on public.customers
  for select to authenticated using (public.is_approved());

drop policy if exists "Managers write customers" on public.customers;
create policy "Managers write customers" on public.customers
  for insert to authenticated
  with check (public.is_approved() and public.has_min_role(auth.uid(), 'warehouse_manager'));

drop policy if exists "Managers update customers" on public.customers;
create policy "Managers update customers" on public.customers
  for update to authenticated
  using (public.is_approved() and public.has_min_role(auth.uid(), 'warehouse_manager'))
  with check (public.is_approved() and public.has_min_role(auth.uid(), 'warehouse_manager'));

drop policy if exists "Managers delete customers" on public.customers;
create policy "Managers delete customers" on public.customers
  for delete to authenticated
  using (public.is_approved() and public.has_min_role(auth.uid(), 'warehouse_manager'));