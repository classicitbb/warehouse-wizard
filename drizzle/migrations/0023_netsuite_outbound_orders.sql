-- NetSuite outbound orders mirrored into WW (outbound picking design, slice C:
-- D2, D8, D9, O1-O3, T1, N2, N4).
--
-- The netsuite-orders edge function (service role) polls open sales orders
-- (SalesOrd B/D/E) and transfer orders (TrnfrOrd B/D/E) whose source location
-- maps to a WW warehouse, and the item fulfillments (ItemShip) that the office
-- makes for them on the Fulfill Orders page. Both land in the existing
-- public.orders / public.order_lines, with source = 'netsuite'; fulfillments get
-- their own tables. WW does not write any of this back to NetSuite yet.
--
-- Quantities from NetSuite are base units (SuiteQL transactionline quantities
-- are already in the unit type's base unit; confirmed on SO1943 in _SB1 on
-- 2026-10-31). The line's own unit is kept so the UI can show "3 CASE".
--
-- Additive only.

-- ============================================================
-- orders: NetSuite header fields
-- ============================================================
alter table public.orders
  add column if not exists source                          text not null default 'manual',
  add column if not exists external_record_id              text,
  add column if not exists external_status                 text,
  add column if not exists order_date                      date,
  add column if not exists customer_id                     uuid references public.customers (id) on delete set null,
  add column if not exists customer_external_id            text,
  add column if not exists customer_name                   text,
  add column if not exists customer_reference              text,
  add column if not exists destination_warehouse_id        uuid references public.warehouses (id) on delete set null,
  add column if not exists destination_location_external_id text,
  add column if not exists destination_location_name       text,
  -- The office's plan as it stands on the order (custbody_truck,
  -- custbody_simplex_trip_number, custbody_simplex_picked_by). The invoice
  -- copies these from the SO (V29), so the SO value is what the driver app sees.
  add column if not exists truck_external_id               text,
  add column if not exists truck_name                      text,
  add column if not exists trip_number                     text,
  add column if not exists picker_name                     text,
  add column if not exists picking_ticket_printed          boolean not null default false,
  add column if not exists ship_complete                   boolean not null default false,
  add column if not exists unmapped_line_count             integer not null default 0,
  -- NetSuite lastmodifieddate in the account's own time zone.
  add column if not exists source_modified_at              timestamp without time zone,
  add column if not exists last_synced_at                  timestamptz;

alter table public.orders drop constraint if exists orders_source_check;
alter table public.orders add constraint orders_source_check check (source in ('manual', 'netsuite'));

create unique index if not exists orders_netsuite_record_idx
  on public.orders (external_record_id) where source = 'netsuite';
create index if not exists orders_source_status_idx on public.orders (source, external_status);
create index if not exists orders_customer_idx on public.orders (customer_id);

comment on column public.orders.source is 'manual = made in WW; netsuite = mirrored by netsuite-orders.';
comment on column public.orders.external_status is 'NetSuite status letter (SalesOrd/TrnfrOrd B, D, E, ...).';

-- ============================================================
-- order_lines: NetSuite line fields (base units, D9)
-- ============================================================
alter table public.order_lines
  add column if not exists external_line_id   text,
  add column if not exists external_line_key  text,
  add column if not exists line_number        integer,
  add column if not exists ns_unit_id         text,
  add column if not exists unit_id            uuid references public.uom_units (id) on delete set null,
  add column if not exists committed_quantity numeric(18,4) not null default 0,
  add column if not exists fulfilled_quantity numeric(18,4) not null default 0,
  add column if not exists is_closed          boolean not null default false;

create unique index if not exists order_lines_external_line_idx
  on public.order_lines (order_id, external_line_id) where external_line_id is not null;

comment on column public.order_lines.external_line_id is 'NetSuite transactionline id of the line WW fulfils: the SO item line, or the TO source-side shipping line (the one with transferorderitemlineid). Item fulfillment lines link to it through NextTransactionLineLink.previousline.';
comment on column public.order_lines.external_line_key is 'NetSuite lineuniquekey of the line WW fulfils.';
comment on column public.order_lines.committed_quantity is 'NetSuite quantitycommitted, base units. D8: only this quantity can be picked.';
comment on column public.order_lines.fulfilled_quantity is 'NetSuite quantityshiprecv, base units.';

-- ============================================================
-- order_fulfillments: NetSuite item fulfillments (O1-O3)
-- ============================================================
create table if not exists public.order_fulfillments (
  id                   uuid primary key default gen_random_uuid(),
  order_id             uuid not null references public.orders (id) on delete cascade,
  warehouse_id         uuid not null references public.warehouses (id) on delete restrict,
  external_record_id   text not null unique,
  document_number      text not null,
  -- ItemShip A Picked, B Packed, C Shipped.
  external_status      text not null,
  fulfillment_date     date,
  truck_external_id    text,
  truck_name           text,
  trip_number          text,
  picker_external_id   text,
  picker_name          text,
  source_modified_at   timestamp without time zone,
  last_synced_at       timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index if not exists order_fulfillments_order_idx on public.order_fulfillments (order_id);
-- O3: a trip is the IF date + truck + trip number.
create index if not exists order_fulfillments_trip_idx
  on public.order_fulfillments (warehouse_id, fulfillment_date, truck_external_id, trip_number);
create index if not exists order_fulfillments_status_idx on public.order_fulfillments (external_status);

create table if not exists public.order_fulfillment_lines (
  id                      uuid primary key default gen_random_uuid(),
  fulfillment_id          uuid not null references public.order_fulfillments (id) on delete cascade,
  order_line_id           uuid references public.order_lines (id) on delete set null,
  external_line_id        text not null,
  order_external_line_id  text,
  product_id              uuid references public.products (id) on delete set null,
  ns_item_id              text,
  ns_unit_id              text,
  quantity                numeric(18,4) not null default 0,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  unique (fulfillment_id, external_line_id)
);

create index if not exists order_fulfillment_lines_order_line_idx on public.order_fulfillment_lines (order_line_id);

drop trigger if exists set_order_fulfillments_updated_at on public.order_fulfillments;
create trigger set_order_fulfillments_updated_at
  before update on public.order_fulfillments
  for each row execute function public.set_updated_at();

drop trigger if exists set_order_fulfillment_lines_updated_at on public.order_fulfillment_lines;
create trigger set_order_fulfillment_lines_updated_at
  before update on public.order_fulfillment_lines
  for each row execute function public.set_updated_at();

-- Read by users who can see the warehouse; written by the service role only.
alter table public.order_fulfillments enable row level security;
alter table public.order_fulfillment_lines enable row level security;

drop policy if exists "Scoped read order_fulfillments" on public.order_fulfillments;
create policy "Scoped read order_fulfillments" on public.order_fulfillments
  for select to authenticated using (public.is_approved() and public.can_access_warehouse(warehouse_id));

drop policy if exists "Scoped read order_fulfillment_lines" on public.order_fulfillment_lines;
create policy "Scoped read order_fulfillment_lines" on public.order_fulfillment_lines
  for select to authenticated using (
    exists (
      select 1 from public.order_fulfillments f
      where f.id = order_fulfillment_lines.fulfillment_id
        and public.is_approved()
        and public.can_access_warehouse(f.warehouse_id)
    )
  );

-- ============================================================
-- Poll cursors: one row per NetSuite record family. Kept apart from the
-- mirrored rows so orders that close before WW ever stores them still move
-- the cursor forward.
-- ============================================================
create table if not exists public.netsuite_poll_cursors (
  key          text primary key,
  cursor       text,
  last_run_at  timestamptz,
  last_result  jsonb,
  updated_at   timestamptz not null default now()
);

alter table public.netsuite_poll_cursors enable row level security;

drop policy if exists "Approved users can read netsuite_poll_cursors" on public.netsuite_poll_cursors;
create policy "Approved users can read netsuite_poll_cursors" on public.netsuite_poll_cursors
  for select to authenticated using (public.is_approved());

-- ============================================================
-- Orders inbox view: one row per NetSuite order with line totals, the
-- customer's credit flags (D8) and the latest open fulfillment (O2, N2).
-- security_invoker keeps the orders / order_lines RLS in force.
-- ============================================================
create or replace view public.outbound_order_inbox
with (security_invoker = true)
as
select
  o.id,
  o.order_number,
  o.order_type,
  o.warehouse_id,
  w.name as warehouse_name,
  o.external_record_id,
  o.external_status,
  o.order_date,
  o.requested_ship_date,
  o.customer_id,
  coalesce(c.name, o.customer_name) as customer_name,
  c.customer_number,
  c.delivery_zone,
  coalesce(c.on_credit_hold, false) as on_credit_hold,
  coalesce(c.credit_review_required, false) as credit_review_required,
  o.customer_reference,
  o.destination_warehouse_id,
  o.destination_location_name,
  o.truck_name,
  o.trip_number,
  o.picker_name,
  o.picking_ticket_printed,
  o.ship_complete,
  o.unmapped_line_count,
  o.last_synced_at,
  coalesce(l.line_count, 0) as line_count,
  coalesce(l.ordered_quantity, 0) as ordered_quantity,
  coalesce(l.committed_quantity, 0) as committed_quantity,
  coalesce(l.fulfilled_quantity, 0) as fulfilled_quantity,
  coalesce(f.fulfillment_count, 0) as fulfillment_count,
  coalesce(f.open_fulfillment_count, 0) as open_fulfillment_count,
  f.latest_fulfillment_number,
  f.latest_fulfillment_status,
  f.latest_fulfillment_date,
  f.latest_truck_name,
  f.latest_trip_number,
  f.latest_picker_name
from public.orders o
join public.warehouses w on w.id = o.warehouse_id
left join public.customers c on c.id = o.customer_id
left join lateral (
  select
    count(*) as line_count,
    sum(ol.quantity) as ordered_quantity,
    sum(ol.committed_quantity) as committed_quantity,
    sum(ol.fulfilled_quantity) as fulfilled_quantity
  from public.order_lines ol
  where ol.order_id = o.id and not ol.is_closed
) l on true
left join lateral (
  select
    count(*) as fulfillment_count,
    count(*) filter (where ff.external_status <> 'C') as open_fulfillment_count,
    (array_agg(ff.document_number order by ff.fulfillment_date desc nulls last, ff.document_number desc))[1] as latest_fulfillment_number,
    (array_agg(ff.external_status order by ff.fulfillment_date desc nulls last, ff.document_number desc))[1] as latest_fulfillment_status,
    max(ff.fulfillment_date) as latest_fulfillment_date,
    (array_agg(ff.truck_name order by ff.fulfillment_date desc nulls last, ff.document_number desc))[1] as latest_truck_name,
    (array_agg(ff.trip_number order by ff.fulfillment_date desc nulls last, ff.document_number desc))[1] as latest_trip_number,
    (array_agg(ff.picker_name order by ff.fulfillment_date desc nulls last, ff.document_number desc))[1] as latest_picker_name
  from public.order_fulfillments ff
  where ff.order_id = o.id
) f on true
where o.source = 'netsuite';

grant select on public.outbound_order_inbox to authenticated;