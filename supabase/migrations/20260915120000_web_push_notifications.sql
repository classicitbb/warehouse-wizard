-- Warehouse push notifications: pick tickets ring, put-away batches badge.
--
-- WHY THIS EXISTS
-- The floor misses new work. A pick ticket is released, or a container is
-- received and staged for put-away, and nobody is told until they happen to
-- look at the right page. This adds a durable notification_events spine plus
-- the Web Push subscriptions needed to deliver from it, including to devices
-- with the app closed.
--
-- TWO DESIGN POINTS THAT ARE NOT OBVIOUS
--
-- 1. A put-away "batch" is not one INSERT. receiving-page.tsx runs
--    completeReceiptFromDraft once per draft through a sequential runBatch
--    loop, so a 12-pallet container produces 12 separate putaway_tasks INSERTs
--    in 12 separate transactions, milliseconds apart. A counter incremented on
--    insert would therefore be read and sent before drafts 2..N landed, and
--    the operator would get "1 pallet ready for put-away" for a full
--    container. So every task gets its own event row and the collapsing
--    happens at DISPATCH time: the dispatcher waits out a short quiet period,
--    then claims the whole group atomically and sends one notification.
--
-- 2. This project has no pg_net, so a trigger cannot call an edge function.
--    Dispatch follows the pattern already used for reorder alerts: the
--    database only records that a notification is due, and the client that
--    caused the event invokes the sender. push_claimed_at is what makes that
--    safe when several tablets sweep for stragglers at once - the claim is a
--    compare-and-set, so exactly one caller wins and the rest get nothing.
--
-- Nothing here may ever break a warehouse commit. putaway_tasks rows are
-- inserted inside confirm_receiving_draft_labels_printed and three other
-- security-definer RPCs on the receiving critical path, so both triggers
-- swallow their own errors and log instead of raising.

-- ============================================================
-- 1. Push subscriptions (one row per browser/device per user)
-- ============================================================

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  -- The push service endpoint is the subscription identity. It rotates, and a
  -- rotated or revoked endpoint 404/410s on send, which is how dead rows get
  -- pruned.
  endpoint text not null unique check (char_length(endpoint) between 8 and 2048),
  p256dh text not null check (char_length(p256dh) between 8 and 255),
  auth text not null check (char_length(auth) between 4 and 255),
  device_label text check (device_label is null or char_length(device_label) <= 120),
  user_agent text check (user_agent is null or char_length(user_agent) <= 400),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  last_success_at timestamptz,
  last_failed_at timestamptz,
  failure_count integer not null default 0 check (failure_count >= 0),
  last_error text check (last_error is null or char_length(last_error) <= 1000)
);

create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);

create or replace function public.push_subscriptions_touch()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'A push subscription requires a signed-in session';
  end if;
  new.user_id := auth.uid();
  new.last_seen_at := now();
  return new;
end;
$$;

drop trigger if exists push_subscriptions_touch on public.push_subscriptions;
create trigger push_subscriptions_touch before insert or update on public.push_subscriptions
  for each row execute function public.push_subscriptions_touch();

alter table public.push_subscriptions enable row level security;

-- A device manages only its own subscriptions. Fan-out reads happen in the
-- edge function under the service role, never from the client.
drop policy if exists "push subscriptions self" on public.push_subscriptions;
create policy "push subscriptions self" on public.push_subscriptions
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

grant select, insert, update, delete on public.push_subscriptions to authenticated;
grant all on public.push_subscriptions to service_role;
revoke execute on function public.push_subscriptions_touch() from public, anon, authenticated;

-- ============================================================
-- 2. Notification events (the durable spine)
-- ============================================================

create table if not exists public.notification_events (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('pick_list_created', 'putaway_task_created')),
  -- Null means "notify on its own, immediately". Non-null means this event is
  -- one member of a batch that must collapse into a single notification.
  group_key text check (group_key is null or char_length(group_key) <= 200),
  entity_table text check (entity_table is null or char_length(entity_table) <= 80),
  entity_id uuid,
  warehouse_id uuid references public.warehouses (id) on delete set null,
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  created_at timestamptz not null default now(),
  push_claimed_at timestamptz,
  push_claimed_by uuid,
  push_dispatched_at timestamptz,
  email_dispatched_at timestamptz,
  dispatch_error text check (dispatch_error is null or char_length(dispatch_error) <= 1000)
);

-- The first two are partial: once an event is dispatched it is history and the
-- dispatcher never looks at it again.
create index if not exists notification_events_group_pending_idx
  on public.notification_events (group_key)
  where push_dispatched_at is null;

create index if not exists notification_events_pending_idx
  on public.notification_events (created_at)
  where push_dispatched_at is null;

create index if not exists notification_events_recent_idx
  on public.notification_events (created_at desc);

alter table public.notification_events enable row level security;

-- Readable by approved users for warehouses they may see; this backs the
-- notification bell and the in-app poll fallback. Rows are only ever written
-- by the triggers below (security definer) and the dispatcher (service role),
-- so there is deliberately no insert or update policy.
drop policy if exists "notification events readable" on public.notification_events;
create policy "notification events readable" on public.notification_events
  for select to authenticated
  using (
    public.is_approved()
    and (warehouse_id is null or public.can_access_warehouse(warehouse_id))
  );

grant select on public.notification_events to authenticated;
grant all on public.notification_events to service_role;

-- ============================================================
-- 3. Per-user notification preferences
-- ============================================================

create table if not exists public.user_notification_preferences (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  -- Whether a released pick ticket rings on this user's devices.
  pick_list_ring boolean not null default true,
  -- Whether put-away batches raise a (silent) notification at all.
  putaway_badge boolean not null default true,
  -- Email is separate from push: a user may want the ring but not the inbox.
  -- A hard unsubscribe still goes through suppressed_emails, which wins.
  email_pick_list boolean not null default true,
  updated_at timestamptz not null default now()
);

create or replace function public.user_notification_preferences_touch()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'Notification preferences require a signed-in session';
  end if;
  new.user_id := auth.uid();
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists user_notification_preferences_touch on public.user_notification_preferences;
create trigger user_notification_preferences_touch before insert or update on public.user_notification_preferences
  for each row execute function public.user_notification_preferences_touch();

alter table public.user_notification_preferences enable row level security;

drop policy if exists "notification preferences self" on public.user_notification_preferences;
create policy "notification preferences self" on public.user_notification_preferences
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

grant select, insert, update on public.user_notification_preferences to authenticated;
grant all on public.user_notification_preferences to service_role;
revoke execute on function public.user_notification_preferences_touch() from public, anon, authenticated;

-- ============================================================
-- 4. Event triggers
-- ============================================================

-- Both triggers skip the rows written by run_warehouse_setup. Those seed rows
-- are named PKL-<CODE>-01 / PTA-<CODE>-01, whereas every real number comes
-- from buildPalletCode or inventory_correction_code and contains exactly one
-- hyphen. Matching on a second hyphen is therefore a reliable discriminator
-- and does not depend on the literal word SETUP.

create or replace function public.notify_pick_list_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_warehouse_code text;
  v_order_number text;
begin
  select w.code into v_warehouse_code from public.warehouses w where w.id = new.warehouse_id;

  if new.order_id is not null then
    select o.order_number into v_order_number from public.orders o where o.id = new.order_id;
  end if;

  insert into public.notification_events (kind, group_key, entity_table, entity_id, warehouse_id, payload)
  values (
    'pick_list_created',
    null,
    'pick_lists',
    new.id,
    new.warehouse_id,
    jsonb_build_object(
      'pick_list_number', new.pick_list_number,
      'warehouse_code', v_warehouse_code,
      'order_number', v_order_number
    )
  );

  return new;
exception when others then
  -- A notification must never be able to fail the release of a pick ticket.
  begin
    perform public.write_system_log(
      'error', 'warning',
      'Pick list notification trigger failed',
      sqlerrm, jsonb_build_object('pick_list_id', new.id),
      'trigger.notify_pick_list_created', 'pick_lists', null
    );
  exception when others then
    null;
  end;
  return new;
end;
$$;

drop trigger if exists notify_pick_list_created on public.pick_lists;
create trigger notify_pick_list_created
after insert on public.pick_lists
for each row
when (new.status <> 'draft' and new.pick_list_number not like '%-%-%')
execute function public.notify_pick_list_created();

create or replace function public.notify_putaway_task_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group_key text;
  v_warehouse_code text;
  v_container text;
  v_po text;
begin
  -- Batch identity, best available first.
  --
  -- The `interval '1 hour'` guards on the first two branches are essential.
  -- The correction RPCs (complete_inventory_pallet_correction,
  -- recover_missing_pallet_to_putaway, ensure_putaway_task_for_pallet)
  -- re-queue pallets that already exist and still carry the receipt_line_id of
  -- their original receipt, possibly months old. Without the guard a
  -- correction today would join the group of a receipt from March, and if that
  -- group was already dispatched the new task would be swallowed silently.
  select
    coalesce(
      -- 1. Batch receive: every draft in one print job shares draft_group_id.
      (select 'putaway:draft:' || r.draft_group_id
         from public.pallets p
         join public.receipt_lines rl on rl.id = p.receipt_line_id
         join public.receipts r on r.id = rl.receipt_id
        where p.id = new.pallet_id
          and r.draft_group_id is not null
          and now() - r.created_at < interval '1 hour'
        limit 1),
      -- 2. Single receive with no draft group: collapse per receipt.
      (select 'putaway:receipt:' || rl.receipt_id::text
         from public.pallets p
         join public.receipt_lines rl on rl.id = p.receipt_line_id
         join public.receipts r on r.id = rl.receipt_id
        where p.id = new.pallet_id
          and now() - r.created_at < interval '1 hour'
        limit 1),
      -- 3. Transfers, corrections, recovered pallets: no correlating parent,
      --    so collapse per warehouse into five-minute buckets. This is
      --    honestly "at most one per warehouse per five minutes", not "one per
      --    batch", and a burst straddling a boundary yields two notifications.
      --    Accepted: this notification is silent, and the alternative is a
      --    stateful debounce table.
      'putaway:wh:' || new.warehouse_id::text || ':' ||
        to_char(
          date_trunc('hour', now())
            + (floor(extract(minute from now()) / 5) * interval '5 minutes'),
          'YYYYMMDDHH24MI')
    )
  into v_group_key;

  select w.code into v_warehouse_code from public.warehouses w where w.id = new.warehouse_id;

  select r.container_number, r.po_number
    into v_container, v_po
    from public.pallets p
    join public.receipt_lines rl on rl.id = p.receipt_line_id
    join public.receipts r on r.id = rl.receipt_id
   where p.id = new.pallet_id
   limit 1;

  insert into public.notification_events (kind, group_key, entity_table, entity_id, warehouse_id, payload)
  values (
    'putaway_task_created',
    v_group_key,
    'putaway_tasks',
    new.id,
    new.warehouse_id,
    jsonb_build_object(
      'task_number', new.task_number,
      'warehouse_code', v_warehouse_code,
      'container_number', v_container,
      'po_number', v_po
    )
  );

  return new;
exception when others then
  -- putaway_tasks INSERTs sit inside the receiving critical path. Log and
  -- carry on; never raise.
  begin
    perform public.write_system_log(
      'error', 'warning',
      'Put-away notification trigger failed',
      sqlerrm, jsonb_build_object('putaway_task_id', new.id),
      'trigger.notify_putaway_task_created', 'putaway_tasks', null
    );
  exception when others then
    null;
  end;
  return new;
end;
$$;

drop trigger if exists notify_putaway_task_created on public.putaway_tasks;
create trigger notify_putaway_task_created
after insert on public.putaway_tasks
for each row
when (
  new.status in ('queued', 'assigned')
  and new.task_number not like '%-%-%'
)
execute function public.notify_putaway_task_created();

revoke execute on function public.notify_pick_list_created() from public, anon, authenticated;
revoke execute on function public.notify_putaway_task_created() from public, anon, authenticated;

-- ============================================================
-- 5. Dispatch API
--
-- supabase-js cannot run arbitrary SQL, so the compare-and-set claim has to
-- live in the database as an RPC. These are service-role only: the edge
-- function is the sole caller.
-- ============================================================

create or replace function public.claim_notification_dispatch(
  in_event_id uuid,
  in_debounce_seconds integer default 4,
  in_claim_ttl_seconds integer default 120
)
returns table (
  event_ids uuid[],
  kind text,
  group_key text,
  warehouse_id uuid,
  payload jsonb,
  event_count integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_seed public.notification_events;
  v_newest timestamptz;
  v_claimed uuid[];
begin
  select * into v_seed from public.notification_events where id = in_event_id;
  if not found or v_seed.push_dispatched_at is not null then
    return;
  end if;

  if v_seed.group_key is not null then
    -- Quiet period. The rest of the batch is still committing; sending now
    -- would announce the wrong count. The caller retries via the sweeper.
    select max(created_at) into v_newest
      from public.notification_events
     where group_key = v_seed.group_key
       and push_dispatched_at is null;

    if v_newest > now() - make_interval(secs => in_debounce_seconds) then
      return;
    end if;
  end if;

  -- The compare-and-set. With several tablets sweeping at once exactly one
  -- caller updates rows; every other caller sees zero and returns nothing.
  with claimed_rows as (
    update public.notification_events e
       set push_claimed_at = now(),
           push_claimed_by = auth.uid()
     where e.push_dispatched_at is null
       and (e.push_claimed_at is null
            or e.push_claimed_at < now() - make_interval(secs => in_claim_ttl_seconds))
       and (
         (v_seed.group_key is null and e.id = v_seed.id)
         or (v_seed.group_key is not null and e.group_key = v_seed.group_key)
       )
    returning e.id
  )
  select array_agg(id) into v_claimed from claimed_rows;

  if v_claimed is null or array_length(v_claimed, 1) is null then
    return;
  end if;

  return query
  select
    v_claimed,
    v_seed.kind,
    v_seed.group_key,
    v_seed.warehouse_id,
    v_seed.payload,
    array_length(v_claimed, 1);
end;
$$;

create or replace function public.complete_notification_dispatch(
  in_event_ids uuid[],
  in_channel text,
  in_error text default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if in_channel not in ('push', 'email') then
    raise exception 'Unknown notification channel: %', in_channel;
  end if;

  if in_channel = 'push' then
    update public.notification_events
       set push_dispatched_at = now(),
           dispatch_error = in_error
     where id = any(in_event_ids);
  else
    update public.notification_events
       set email_dispatched_at = now(),
           dispatch_error = coalesce(in_error, dispatch_error)
     where id = any(in_event_ids);
  end if;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- One representative (oldest) pending event per group, for the sweeper that
-- covers a tab dying between the commit and the invoke.
create or replace function public.pending_notification_dispatch(
  in_older_than_seconds integer default 60,
  in_limit integer default 20
)
returns table (event_id uuid, kind text, group_key text, created_at timestamptz)
language sql
security definer
set search_path = public
as $$
  select distinct on (coalesce(e.group_key, e.id::text))
         e.id, e.kind, e.group_key, e.created_at
    from public.notification_events e
   where e.push_dispatched_at is null
     and e.created_at < now() - make_interval(secs => in_older_than_seconds)
   order by coalesce(e.group_key, e.id::text), e.created_at
   limit in_limit;
$$;

revoke execute on function public.claim_notification_dispatch(uuid, integer, integer) from public, anon, authenticated;
revoke execute on function public.complete_notification_dispatch(uuid[], text, text) from public, anon, authenticated;
revoke execute on function public.pending_notification_dispatch(integer, integer) from public, anon, authenticated;
grant execute on function public.claim_notification_dispatch(uuid, integer, integer) to service_role;
grant execute on function public.complete_notification_dispatch(uuid[], text, text) to service_role;
grant execute on function public.pending_notification_dispatch(integer, integer) to service_role;

-- ============================================================
-- 6. Retention
--
-- pg_cron is already enabled on this project (see
-- 20260717010000_system_logs_archiving.sql). It cannot call an edge function
-- without pg_net, but it is exactly right for a purge.
-- ============================================================

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'purge-notification-events') then
      perform cron.unschedule('purge-notification-events');
    end if;
    perform cron.schedule(
      'purge-notification-events',
      '15 3 * * *',
      $job$delete from public.notification_events where created_at < now() - interval '30 days'$job$
    );
  end if;
end;
$$;
