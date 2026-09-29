create or replace function public.directed_putaway_candidates(in_pallet_id uuid)
returns table (
  location_id   uuid,
  location_code text,
  score         numeric,
  reason        text
)
language sql
stable
set search_path = public
as $$
  with pallet_context as (
    select p.id, p.client_id, p.product_id, p.length, p.width, p.height, p.weight,
           p.current_warehouse_id as warehouse_id,
           pr.product_family, pr.temperature_requirement
    from public.pallets p
    join public.products pr on pr.id = p.product_id
    where p.id = in_pallet_id
  ),
  location_fill as (
    select ib.location_id,
           count(*) as pallet_count,
           bool_or(ib.product_id <> pc.product_id) as has_other_sku,
           bool_or(ib.client_id is distinct from pc.client_id) as has_other_client
    from public.inventory_balances ib
    join pallet_context pc on true
    where ib.location_id is not null
      and ib.status not in ('shipped', 'in_transit', 'missing')
    group by ib.location_id
  )
  select
    l.id as location_id,
    l.code as location_code,
    (
      case when l.temperature_class = pc.temperature_requirement then 50 else 0 end +
      case when coalesce(lf.pallet_count, 0) = 0 then 15 else 0 end +
      greatest(0, 10 - coalesce(l.putaway_sequence, 0) / 10.0) +
      case when coalesce(lf.has_other_sku, false) then -40 else 5 end +
      case when coalesce(lf.has_other_client, false) then -25 else 5 end
    )::numeric as score,
    concat_ws(
      '; ',
      case when l.temperature_class = pc.temperature_requirement then 'temperature_match' else 'temperature_mismatch' end,
      case when coalesce(lf.pallet_count, 0) = 0 then 'empty_slot' else 'consolidation_slot' end,
      case when l.allowed_product_family is null or l.allowed_product_family = pc.product_family then 'family_ok' else 'family_restricted' end
    ) as reason
  from public.locations l
  join pallet_context pc on pc.warehouse_id = l.warehouse_id
  left join location_fill lf on lf.location_id = l.id
  where l.location_type = 'rack'
    and l.status = 'active'
    and l.temperature_class = pc.temperature_requirement
    and (l.allowed_product_family is null or l.allowed_product_family = pc.product_family)
    and (l.max_length is null or pc.length is null or l.max_length >= pc.length)
    and (l.max_width is null or pc.width is null or l.max_width >= pc.width)
    and (l.max_height is null or pc.height is null or l.max_height >= pc.height)
    and (l.max_weight is null or pc.weight is null or l.max_weight >= pc.weight)
    and (coalesce(lf.pallet_count, 0) < l.max_pallets)
    and (l.mixed_sku_allowed or not coalesce(lf.has_other_sku, false))
  order by score desc, l.putaway_sequence asc nulls last, l.code asc
  limit 20;
$$;