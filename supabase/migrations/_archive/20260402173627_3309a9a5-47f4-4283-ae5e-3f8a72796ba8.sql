-- Allow the handle_new_user trigger (SECURITY DEFINER) to insert profiles
CREATE POLICY "Users can insert own profile"
ON public.profiles
FOR INSERT
TO authenticated
WITH CHECK (id = auth.uid());