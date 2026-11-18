-- New users must not be able to insert their own profile row already approved
-- and active; approval stays an admin action.
DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;

CREATE POLICY "Users can insert own profile"
ON public.profiles
FOR INSERT
TO authenticated
WITH CHECK (
  id = auth.uid()
  AND (
    has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'developer')
    OR (COALESCE(approved, false) = false AND COALESCE(active, false) = false)
  )
);