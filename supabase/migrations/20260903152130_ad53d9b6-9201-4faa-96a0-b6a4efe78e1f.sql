CREATE OR REPLACE FUNCTION public.product_quantity_totals()
 RETURNS TABLE(product_id uuid, total_quantity numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select ib.product_id, sum(coalesce(ib.quantity, ib.available_quantity, 0))::numeric
  from public.inventory_balances ib
  where ib.status not in ('shipped', 'missing')
  group by ib.product_id
$function$;