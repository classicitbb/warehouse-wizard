create table if not exists public.copilot_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  warehouse_id uuid references public.warehouses(id) on delete set null,
  title text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.copilot_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.copilot_conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('user', 'assistant', 'system')),
  content text not null default '',
  citations jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.copilot_tool_calls (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid references public.copilot_conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  warehouse_id uuid references public.warehouses(id) on delete set null,
  tool_name text not null,
  tool_input jsonb not null default '{}'::jsonb,
  outcome text not null default 'ok',
  row_count integer,
  error_message text,
  latency_ms integer,
  created_at timestamptz not null default now()
);

create table if not exists public.copilot_suggestions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  warehouse_id uuid references public.warehouses(id) on delete set null,
  surface text not null,
  suggestion jsonb not null default '{}'::jsonb,
  decision text not null default 'pending' check (decision in ('pending', 'accepted', 'rejected')),
  decided_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists copilot_conversations_user_idx on public.copilot_conversations (user_id, updated_at desc);
create index if not exists copilot_messages_conversation_idx on public.copilot_messages (conversation_id, created_at);
create index if not exists copilot_tool_calls_user_idx on public.copilot_tool_calls (user_id, created_at desc);
create index if not exists copilot_suggestions_user_idx on public.copilot_suggestions (user_id, created_at desc);

grant select, insert, update, delete on public.copilot_conversations to authenticated;
grant select, insert on public.copilot_messages to authenticated;
grant select on public.copilot_tool_calls to authenticated;
grant select, insert, update on public.copilot_suggestions to authenticated;
grant all on public.copilot_conversations to service_role;
grant all on public.copilot_messages to service_role;
grant all on public.copilot_tool_calls to service_role;
grant all on public.copilot_suggestions to service_role;

alter table public.copilot_conversations enable row level security;
alter table public.copilot_messages enable row level security;
alter table public.copilot_tool_calls enable row level security;
alter table public.copilot_suggestions enable row level security;

drop policy if exists "copilot conversations own" on public.copilot_conversations;
create policy "copilot conversations own"
  on public.copilot_conversations for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "copilot messages own" on public.copilot_messages;
create policy "copilot messages own"
  on public.copilot_messages for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "copilot tool calls own" on public.copilot_tool_calls;
create policy "copilot tool calls own"
  on public.copilot_tool_calls for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "copilot suggestions own" on public.copilot_suggestions;
create policy "copilot suggestions own"
  on public.copilot_suggestions for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());