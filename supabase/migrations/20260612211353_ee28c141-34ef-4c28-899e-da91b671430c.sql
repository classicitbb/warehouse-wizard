GRANT SELECT (id, full_name, email, phone, approved, created_at, updated_at, active, default_warehouse_id, user_code) ON public.profiles TO authenticated;
GRANT INSERT (id, full_name, email, phone, approved, active, default_warehouse_id, user_code) ON public.profiles TO authenticated;
GRANT UPDATE (full_name, email, phone, active, default_warehouse_id, user_code) ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;