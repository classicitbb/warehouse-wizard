create table if not exists public.integration_secrets (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references public.integration_connections(id) on delete cascade,
  secret_type text not null,
  secret_value text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (connection_id, secret_type)
);

grant all on public.integration_secrets to service_role;

alter table public.integration_secrets enable row level security;

-- Intentionally no policies for anon/authenticated. Only service_role
-- (edge functions) can read or write this table.

drop trigger if exists trg_integration_secrets_updated on public.integration_secrets;
create trigger trg_integration_secrets_updated
  before update on public.integration_secrets
  for each row execute function public.update_updated_at_column();