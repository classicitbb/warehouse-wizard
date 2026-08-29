-- Pallet Pack Standards — Phase 1: slotting reads the millimetre clearance.
--
-- Only the height filter changes. It compared `l.max_height` (centimetres)
-- against `pc.height` (the carton height receiving used to write), so every
-- bin passed for every pallet. It now compares the pallet's built height in
-- millimetres against the bin's effective clearance: the least non-null of
-- max_height_mm, max_height * 10, and max_pallet_height_cm * 10, less the
-- warehouse safety margin — the same expression the put-away block uses.
--
-- Scoring is untouched. Best-fit, height bands, and family affinity are
-- Phase 5.
--
-- Replaces the definition in 20260710120000 without editing that file.

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
           p.standard_height_mm,
           p.current_warehouse_id as warehouse_id,
           pr.product_family, pr.temperature_requirement, pr.velocity_class
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
  ),
  placement_hints as (
    select h.product_id, h.warehouse_id, h.hint_value, h.confidence
    from public.ai_product_hints h
    where h.hint_type = 'placement'
  ),
  velocity_hints as (
    select h.product_id, h.warehouse_id, h.hint_value, h.confidence
    from public.ai_product_hints h
    where h.hint_type = 'velocity'
  )
  select
    l.id as location_id,
    l.code as location_code,
    (
      case when l.temperature_class = pc.temperature_requirement then 50 else 0 end +
      case when coalesce(lf.pallet_count, 0) = 0 then 15 else 0 end +
      greatest(0, 10 - coalesce(l.putaway_sequence, 0) / 10.0) +
      case when coalesce(lf.has_other_sku, false) then -40 else 5 end +
      case when coalesce(lf.has_other_client, false) then -25 else 5 end +
      coalesce((
        select max((entry->>'frequency')::numeric) * 8 * greatest(coalesce(ph.confidence, 0), 0.25)
        from jsonb_array_elements(coalesce(ph.hint_value, '[]'::jsonb)) entry
        where entry->>'location_id' = l.id::text
      ), 0) +
      coalesce((
        select max((entry->>'frequency')::numeric) * 3 * greatest(coalesce(ph.confidence, 0), 0.25)
        from jsonb_array_elements(coalesce(ph.hint_value, '[]'::jsonb)) entry
        where nullif(entry->>'zone_name', '') = z.name
      ), 0) +
      case coalesce(vh.hint_value->>'class', pc.velocity_class::text, 'C')
        when 'A' then greatest(0, 20 - coalesce(l.pick_sequence, l.putaway_sequence, 0) / 10.0)
        when 'B' then greatest(0, 10 - coalesce(l.pick_sequence, l.putaway_sequence, 0) / 20.0)
        else greatest(0, 4 - coalesce(l.putaway_sequence, 0) / 50.0)
      end
    )::numeric as score,
    concat_ws(
      '; ',
      case when l.temperature_class = pc.temperature_requirement then 'temperature_match' else 'temperature_mismatch' end,
      case when coalesce(lf.pallet_count, 0) = 0 then 'empty_slot' else 'consolidation_slot' end,
      case when l.allowed_product_family is null or l.allowed_product_family = pc.product_family then 'family_ok' else 'family_restricted' end,
      case when ph.hint_value is not null then 'placement_history' end,
      case coalesce(vh.hint_value->>'class', pc.velocity_class::text, null)
        when 'A' then 'fast_turnover'
        when 'B' then 'medium_turnover'
        when 'C' then 'slow_turnover'
      end
    ) as reason
  from public.locations l
  join pallet_context pc on pc.warehouse_id = l.warehouse_id
  left join public.zones z on z.id = l.zone_id
  left join public.warehouses w on w.id = l.warehouse_id
  left join location_fill lf on lf.location_id = l.id
  left join placement_hints ph on ph.product_id = pc.product_id and ph.warehouse_id = pc.warehouse_id
  left join velocity_hints vh on vh.product_id = pc.product_id and vh.warehouse_id = pc.warehouse_id
  where l.location_type = 'rack'
    and l.status = 'active'
    and l.temperature_class = pc.temperature_requirement
    and (l.allowed_product_family is null or l.allowed_product_family = pc.product_family)
    and (l.max_length is null or pc.length is null or l.max_length >= pc.length)
    and (l.max_width is null or pc.width is null or l.max_width >= pc.width)
    -- Height is the only filter this migration changes: it now compares the
    -- pallet's built height in millimetres against the bin's effective
    -- clearance — the least non-null of the three ceilings, less the
    -- warehouse safety margin. Best-fit, height-band, and family-affinity
    -- scoring stay out of this phase.
    and (
      public.effective_clearance_mm(
        public.location_clearance_mm(l.max_height_mm, l.max_height, null),
        w.clearance_safety_margin_mm
      ) is null
      or public.pallet_height_mm(pc.standard_height_mm, pc.height) is null
      or public.effective_clearance_mm(
           public.location_clearance_mm(l.max_height_mm, l.max_height, null),
           w.clearance_safety_margin_mm
         ) >= public.pallet_height_mm(pc.standard_height_mm, pc.height)
    )
    and (l.max_weight is null or pc.weight is null or l.max_weight >= pc.weight)
    and (coalesce(lf.pallet_count, 0) < l.max_pallets)
    and (l.mixed_sku_allowed or not coalesce(lf.has_other_sku, false))
  order by score desc, l.putaway_sequence asc nulls last, l.code asc
  limit 20;
$$;