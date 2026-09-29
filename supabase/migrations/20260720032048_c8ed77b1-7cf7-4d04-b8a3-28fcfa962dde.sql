DROP POLICY IF EXISTS "Developers manage external_record_links" ON public.external_record_links;
CREATE POLICY "Developers manage external_record_links"
  ON public.external_record_links
  FOR ALL
  TO authenticated
  USING (public.has_any_role(ARRAY['dev'::public.app_role_code]))
  WITH CHECK (public.has_any_role(ARRAY['dev'::public.app_role_code]));