CREATE OR REPLACE FUNCTION public.open_fulfillment_demand(p_warehouse_id uuid, p_product_id uuid)
 RETURNS TABLE(warehouse_id uuid, product_id uuid, quantity numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select f.warehouse_id, ofl.product_id, sum(greatest(ofl.quantity - coalesce(pk.picked, 0), 0))
  from public.order_fulfillment_lines ofl
  join public.order_fulfillments f on f.id = ofl.fulfillment_id
  join public.warehouses w on w.id = f.warehouse_id
  left join lateral (
    select sum(pt.confirmed_quantity) as picked
    from public.pick_tasks pt
    where pt.fulfillment_line_id = ofl.id
      and pt.status in ('in_progress', 'completed')
  ) pk on true
  where f.external_status in ('A', 'B')
    and ofl.product_id is not null
    and coalesce(f.fulfillment_date, f.created_at::date) >= current_date - w.replen_demand_max_age_days
    and (p_warehouse_id is null or f.warehouse_id = p_warehouse_id)
    and (p_product_id is null or ofl.product_id = p_product_id)
  group by f.warehouse_id, ofl.product_id
  having sum(greatest(ofl.quantity - coalesce(pk.picked, 0), 0)) > 0;
$function$;