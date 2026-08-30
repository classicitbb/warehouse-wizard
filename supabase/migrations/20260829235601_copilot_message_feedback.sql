-- One durable, warehouse-derived usefulness vote per operator/answer. This is
-- feedback only: it never grants access or authorizes an operational action.
create table if not exists public.copilot_message_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  conversation_id uuid references public.copilot_conversations(id) on delete set null,
  warehouse_id uuid references public.warehouses(id) on delete set null,
  message_id text not null check (char_length(message_id) between 1 and 120),
  vote text not null check (vote in ('helpful', 'not_helpful')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, message_id)
);

create index if not exists copilot_message_feedback_conversation_idx
  on public.copilot_message_feedback (conversation_id, created_at desc);

create or replace function public.copilot_message_feedback_set_context()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or new.user_id <> auth.uid() then raise exception 'Copilot feedback must belong to the signed-in operator'; end if;
  select p.default_warehouse_id into new.warehouse_id from public.profiles p where p.id = auth.uid();
  new.updated_at := now();
  return new;
end;
$$;

create trigger copilot_message_feedback_set_context before insert or update on public.copilot_message_feedback
  for each row execute function public.copilot_message_feedback_set_context();
grant select, insert, update on public.copilot_message_feedback to authenticated;
grant all on public.copilot_message_feedback to service_role;
alter table public.copilot_message_feedback enable row level security;
create policy "copilot feedback own" on public.copilot_message_feedback for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
revoke execute on function public.copilot_message_feedback_set_context() from public, anon, authenticated;
