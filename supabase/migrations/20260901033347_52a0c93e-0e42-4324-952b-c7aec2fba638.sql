alter table public.locations
  add column if not exists max_pallet_height_cm integer check (max_pallet_height_cm > 0);

comment on column public.locations.max_pallet_height_cm is
  'Legacy hard ceiling for this bin in centimetres. Read through public.location_clearance_mm / resolveLocationClearanceMm, which take the least non-null of max_height_mm, max_height * 10, and max_pallet_height_cm * 10.';