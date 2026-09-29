-- Fix infinite recursion in profiles update policy introduced by 20260606183312.
--
-- The WITH CHECK clause contained subqueries that SELECT from public.profiles
-- while inside a public.profiles UPDATE policy, triggering PostgreSQL 42P17.
-- The prevent_self_approval trigger (trg_prevent_self_approval) already blocks
-- non-admins from changing the approved column, so the guard in WITH CHECK is
-- redundant. Restore the simple self-row-only policy.

DROP POLICY IF EXISTS "profiles users update own row" ON public.profiles;

CREATE POLICY "profiles users update own row"
  ON public.profiles
  FOR UPDATE
  TO authenticated
  USING  (id = auth.uid())
  WITH CHECK (id = auth.uid());
