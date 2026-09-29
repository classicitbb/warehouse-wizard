alter table public.cycle_counts
  add column if not exists location_ids uuid[],
  add column if not exists product_ids uuid[];

update public.cycle_counts
set location_ids = array[location_id]
where location_id is not null
  and (location_ids is null or cardinality(location_ids) = 0);

create table if not exists public.cycle_count_assignees (
  cycle_count_id uuid not null references public.cycle_counts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  assigned_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  primary key (cycle_count_id, user_id)
);

alter table public.cycle_count_lines
  add column if not exists claimed_by_user_id uuid references auth.users(id) on delete set null,
  add column if not exists claimed_at timestamptz,
  add column if not exists claim_expires_at timestamptz;

create index if not exists idx_cycle_count_assignees_user
  on public.cycle_count_assignees (user_id, cycle_count_id);
create index if not exists idx_cycle_count_lines_claim_expiry
  on public.cycle_count_lines (claim_expires_at)
  where claim_expires_at is not null;

alter table public.cycle_count_assignees enable row level security;

create policy "Cycle-count team members can read their assignments"
  on public.cycle_count_assignees for select to authenticated
  using (user_id = auth.uid() or public.has_min_role(auth.uid(), 'warehouse_supervisor'));

create policy "Supervisors manage cycle-count teams"
  on public.cycle_count_assignees for all to authenticated
  using (public.has_min_role(auth.uid(), 'warehouse_supervisor'))
  with check (public.has_min_role(auth.uid(), 'warehouse_supervisor'));

drop policy if exists "Cycle count headers visible by role or assignment" on public.cycle_counts;
create policy "Cycle count headers visible by role or team"
  on public.cycle_counts for select to authenticated
  using (
    public.has_min_role(auth.uid(), 'warehouse_supervisor')
    or initiated_by = auth.uid()
    or exists (
      select 1 from public.cycle_count_assignees assignee
      where assignee.cycle_count_id = cycle_counts.id
        and assignee.user_id = auth.uid()
    )
  );

drop policy if exists "Cycle count lines visible by role or assignment" on public.cycle_count_lines;
create policy "Cycle count lines visible by role or team"
  on public.cycle_count_lines for select to authenticated
  using (
    public.has_min_role(auth.uid(), 'warehouse_supervisor')
    or assigned_user_id = auth.uid()
    or assigned_user_id is null
    or exists (
      select 1 from public.cycle_count_assignees assignee
      where assignee.cycle_count_id = cycle_count_lines.cycle_count_id
        and assignee.user_id = auth.uid()
    )
  );

drop policy if exists "Counters update assigned open count lines" on public.cycle_count_lines;
create policy "Counters update claimed open count lines"
  on public.cycle_count_lines for update to authenticated
  using (
    public.has_min_role(auth.uid(), 'warehouse_supervisor')
    or (
      line_status in ('queued', 'recount')
      and claimed_by_user_id = auth.uid()
      and claim_expires_at > timezone('utc', now())
      and (
        assigned_user_id = auth.uid()
        or assigned_user_id is null
        or exists (
          select 1 from public.cycle_count_assignees assignee
          where assignee.cycle_count_id = cycle_count_lines.cycle_count_id
            and assignee.user_id = auth.uid()
        )
      )
    )
  )
  with check (
    public.has_min_role(auth.uid(), 'warehouse_supervisor')
    or (
      line_status in ('queued', 'recount', 'reconciled', 'variance_hold', 'exception')
      and approved_by is null
      and approved_at is null
      and adjustment_id is null
      and (
        claimed_by_user_id = auth.uid()
        or (line_status = 'recount' and claimed_by_user_id is null)
      )
    )
  );

create or replace function public.claim_cycle_count_line(p_line_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_line public.cycle_count_lines%rowtype;
  v_warehouse_id uuid;
begin
  if auth.uid() is null then raise exception 'Sign in is required.'; end if;

  select line.*
    into v_line
  from public.cycle_count_lines line
  where line.id = p_line_id
  for update of line;

  if not found then raise exception 'Count line was not found.'; end if;
  select warehouse_id into v_warehouse_id
  from public.cycle_counts
  where id = v_line.cycle_count_id;
  if v_line.line_status not in ('queued', 'recount') then raise exception 'This count line is no longer open.'; end if;
  if v_line.line_status = 'recount' and v_line.first_counted_by = auth.uid() then
    raise exception 'A different counter must perform the recount.';
  end if;
  if v_line.claimed_by_user_id is not null
    and v_line.claimed_by_user_id <> auth.uid()
    and v_line.claim_expires_at > timezone('utc', now()) then
    raise exception 'Another counter has already claimed this line.';
  end if;
  if not (
    public.has_min_role(auth.uid(), 'warehouse_supervisor')
    or v_line.assigned_user_id = auth.uid()
    or exists (
      select 1 from public.cycle_count_assignees assignee
      where assignee.cycle_count_id = v_line.cycle_count_id and assignee.user_id = auth.uid()
    )
    or (
      v_line.assigned_user_id is null
      and exists (
        select 1
        from public.user_roles ur
        join public.roles r on r.id = ur.role_id
        join public.profiles profile on profile.id = ur.user_id
        where ur.user_id = auth.uid()
          and ur.warehouse_id = v_warehouse_id
          and not ur.is_hidden
          and profile.approved and profile.active
          and r.code::text in ('developer', 'admin', 'warehouse_manager', 'warehouse_supervisor', 'inventory_clerk', 'warehouse_operator')
      )
    )
  ) then
    raise exception 'You are not assigned to this cycle count.';
  end if;

  update public.cycle_count_lines
  set claimed_by_user_id = auth.uid(),
      claimed_at = timezone('utc', now()),
      claim_expires_at = timezone('utc', now()) + interval '15 minutes'
  where id = p_line_id;
end;
$$;

create or replace function public.release_cycle_count_line_claim(p_line_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.cycle_count_lines
  set claimed_by_user_id = null, claimed_at = null, claim_expires_at = null
  where id = p_line_id
    and claimed_by_user_id = auth.uid()
    and line_status in ('queued', 'recount');
  if not found then raise exception 'Only the current counter can release this claim.'; end if;
end;
$$;

grant execute on function public.claim_cycle_count_line(uuid) to authenticated;
grant execute on function public.release_cycle_count_line_claim(uuid) to authenticated;
