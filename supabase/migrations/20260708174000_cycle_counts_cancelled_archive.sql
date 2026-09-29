alter table public.cycle_counts
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid references auth.users (id) on delete set null;

create index if not exists idx_cycle_counts_archived_at
  on public.cycle_counts (archived_at)
  where archived_at is not null;
