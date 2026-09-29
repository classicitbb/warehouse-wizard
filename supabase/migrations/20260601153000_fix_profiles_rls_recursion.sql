-- Fix profiles RLS recursion.
--
-- The previous "Users can update own profile" policy queried public.profiles
-- from inside a public.profiles policy. PostgreSQL rejects that path with
-- 42P17 infinite recursion. Approval changes remain protected by the
-- prevent_self_approval trigger.

drop policy if exists "Users can update own profile" on public.profiles;

drop policy if exists "profiles self update" on public.profiles;

create policy "profiles admins update users"
  on public.profiles
  for update
  to authenticated
  using (
    public.has_role(auth.uid(), 'admin')
    or public.has_role(auth.uid(), 'developer')
  )
  with check (
    public.has_role(auth.uid(), 'admin')
    or public.has_role(auth.uid(), 'developer')
  );

create policy "profiles users update own row"
  on public.profiles
  for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());
