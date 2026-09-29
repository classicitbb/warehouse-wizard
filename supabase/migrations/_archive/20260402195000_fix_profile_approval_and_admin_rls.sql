alter table public.profiles
  add column if not exists phone text,
  add column if not exists approved boolean not null default false;

update public.profiles p
set approved = true
where coalesce(p.approved, false) = false
  and exists (
    select 1
    from public.user_roles ur
    where ur.user_id = p.id
  );

drop policy if exists "Users can insert own profile" on public.profiles;
create policy "Users can insert own profile"
on public.profiles
for insert
to authenticated
with check (id = auth.uid());

drop policy if exists "Users read own or admin reads all user_roles" on public.user_roles;
create policy "Users read own or admin reads all user_roles"
  on public.user_roles for select
  to authenticated
  using (
    user_id = auth.uid() or public.has_role(auth.uid(), 'admin')
  );

drop policy if exists "Admins can insert user_roles" on public.user_roles;
create policy "Admins can insert user_roles"
  on public.user_roles for insert
  to authenticated
  with check (public.has_role(auth.uid(), 'admin'));

drop policy if exists "Admins can update user_roles" on public.user_roles;
create policy "Admins can update user_roles"
  on public.user_roles for update
  to authenticated
  using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));

drop policy if exists "Admins can delete user_roles" on public.user_roles;
create policy "Admins can delete user_roles"
  on public.user_roles for delete
  to authenticated
  using (public.has_role(auth.uid(), 'admin'));
