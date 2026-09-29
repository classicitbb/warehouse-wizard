-- Keep mobile shortcut choices personal to each authenticated user.

create table if not exists public.user_mobile_toolbar_preferences (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  module_keys jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint user_mobile_toolbar_preferences_module_keys_is_array check (jsonb_typeof(module_keys) = 'array')
);

alter table public.user_mobile_toolbar_preferences enable row level security;

drop policy if exists "user_mobile_toolbar_preferences self read" on public.user_mobile_toolbar_preferences;
create policy "user_mobile_toolbar_preferences self read"
  on public.user_mobile_toolbar_preferences for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "user_mobile_toolbar_preferences self insert" on public.user_mobile_toolbar_preferences;
create policy "user_mobile_toolbar_preferences self insert"
  on public.user_mobile_toolbar_preferences for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "user_mobile_toolbar_preferences self update" on public.user_mobile_toolbar_preferences;
create policy "user_mobile_toolbar_preferences self update"
  on public.user_mobile_toolbar_preferences for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
