-- `original_pallet_id` and `original_location_id` add second relationships
-- from pick_tasks. Reload PostgREST's schema cache after the relationship
-- additions so the explicitly qualified embeds are immediately available.
notify pgrst, 'reload schema';
