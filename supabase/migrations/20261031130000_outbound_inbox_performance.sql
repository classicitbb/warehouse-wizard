-- Orders inbox speed (outbound picking design, slice C). Measured in the beta
-- sandbox with 546 NetSuite orders and 8,633 lines.
--
-- 1. order_lines had no index on order_id, so outbound_order_inbox scanned the
--    whole table once per order (780 ms without RLS; 12 ms with the index).
create index if not exists order_lines_order_id_idx on public.order_lines (order_id);

-- 2. As a security_invoker view, every order line it aggregated ran the
--    order_lines RLS policy (an orders lookup plus can_access_warehouse), so a
--    signed-in user still waited about 3.7 s. The view now runs as its owner and
--    applies the same rule as the orders read policy once per order. Lines,
--    fulfillments and the customer are only reached through those orders, so
--    nobody sees more than the orders policy already allows.
create or replace view public.outbound_order_inbox
with (security_invoker = false)
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
where o.source = 'netsuite'
  and public.is_approved()
  and public.can_access_warehouse(o.warehouse_id);

revoke all on public.outbound_order_inbox from anon, public;
grant select on public.outbound_order_inbox to authenticated;
