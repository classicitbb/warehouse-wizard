// Web Push for warehouse work: pick tickets and put-away batches.
//
// POST { action: 'config' }                              -> { publicKey }
// POST { action: 'subscribe', subscription, deviceLabel } -> { saved: true }
// POST { action: 'unsubscribe', endpoint }               -> { removed: n }
// POST { action: 'dispatch', eventId }                   -> { sent, deferred? }
// POST { action: 'sweep' }                               -> { dispatched: n }
//
// WHY THE CLIENT DRIVES DISPATCH
// This project has no pg_net, so a database trigger cannot call an edge
// function. The trigger only records that a notification is due; the client
// that caused the event invokes 'dispatch'. That client is online by
// definition — it just committed the row. 'sweep' is the safety net for a tab
// that died between the commit and the invoke, and the compare-and-set inside
// claim_notification_dispatch keeps several tablets sweeping at once from
// sending duplicates.
//
// Like send-notification-email, this returns HTTP 200 on failure: a broken
// notification must never surface as a failed warehouse operation.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.58.0'
import { clampPayload, configureVapid, sendToAll, type PushSubscriptionRow } from './push.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

type Client = ReturnType<typeof createClient>

type ClaimRow = {
  event_ids: string[]
  kind: string
  group_key: string | null
  warehouse_id: string | null
  payload: Record<string, unknown>
  event_count: number
}

/** Human-facing copy for one claimed group. */
async function renderNotification(sb: Client, claim: ClaimRow) {
  const payload = claim.payload ?? {}
  const warehouse = typeof payload.warehouse_code === 'string' ? payload.warehouse_code : null

  if (claim.kind === 'pick_list_created') {
    const number = String(payload.pick_list_number ?? 'Pick ticket')
    const order = typeof payload.order_number === 'string' ? payload.order_number : null

    // Counted here rather than in the trigger: pick_tasks are written after
    // the pick_lists header, so at AFTER INSERT time the count is always 0.
    let lines = 0
    const entityId = await sb
      .from('notification_events')
      .select('entity_id')
      .eq('id', claim.event_ids[0])
      .maybeSingle()
    const pickListId = (entityId.data as { entity_id?: string } | null)?.entity_id
    if (pickListId) {
      const { count } = await sb
        .from('pick_tasks')
        .select('id', { count: 'exact', head: true })
        .eq('pick_list_id', pickListId)
      lines = count ?? 0
    }

    const parts = [order ? `Order ${order}` : null, lines ? `${lines} line${lines === 1 ? '' : 's'}` : null, warehouse]
      .filter(Boolean)
      .join(' · ')

    return {
      title: `Pick ticket ${number} released`,
      body: parts || 'A new pick ticket is ready to pick.',
      url: '/pick-lists',
      // The ring. Everything else is silent.
      silent: false,
      tag: `ww-pick-${pickListId ?? claim.event_ids[0]}`,
    }
  }

  // Put-away: one notification for the whole batch, deliberately silent so it
  // does not interrupt someone mid-task.
  const count = claim.event_count
  const container = typeof payload.container_number === 'string' ? payload.container_number : null
  const po = typeof payload.po_number === 'string' ? payload.po_number : null
  const detail = [container ? `Container ${container}` : null, po ? `PO ${po}` : null, warehouse]
    .filter(Boolean)
    .join(' · ')

  return {
    title: count === 1 ? '1 pallet ready for put-away' : `${count} pallets ready for put-away`,
    body: detail || 'New put-away work is waiting.',
    url: '/putaway-tasks',
    silent: true,
    tag: `ww-putaway-${claim.group_key ?? claim.event_ids[0]}`,
  }
}

async function dispatchEvent(sb: Client, eventId: string) {
  const { data, error } = await sb.rpc('claim_notification_dispatch', { in_event_id: eventId })
  if (error) throw new Error(error.message)

  const rows = (data ?? []) as ClaimRow[]
  if (rows.length === 0) {
    // Either already dispatched, already claimed by another caller, or still
    // inside the quiet period while the rest of the batch commits.
    return { deferred: true, sent: 0 }
  }
  const claim = rows[0]

  const rendered = await renderNotification(sb, claim)

  // Recipients are resolved in the database so that the person's own switches
  // (pick ticket ring / put-away badge) and their warehouse access decide who
  // gets buzzed - a blanket read here pushed every alert to every device.
  const { data: subs, error: subError } = await sb.rpc('notification_push_recipients', {
    in_kind: claim.kind,
    in_warehouse_id: claim.warehouse_id,
  })
  if (subError) throw new Error(subError.message)


  const subscriptions = (subs ?? []) as PushSubscriptionRow[]

  let sent = 0
  if (subscriptions.length > 0) {
    configureVapid()
    const body = clampPayload({
      eventId: claim.event_ids[0],
      kind: claim.kind,
      title: rendered.title,
      body: rendered.body,
      url: rendered.url,
      silent: rendered.silent,
      tag: rendered.tag,
      count: claim.event_count,
    })

    const results = await sendToAll(subscriptions, body)
    const goneEndpoints: string[] = []

    for (const result of results) {
      if (result.ok) {
        sent += 1
        await sb
          .from('push_subscriptions')
          .update({ last_success_at: new Date().toISOString(), failure_count: 0, last_error: null })
          .eq('endpoint', result.endpoint)
        continue
      }

      if (result.gone) {
        goneEndpoints.push(result.endpoint)
        continue
      }

      // 429 is a back-off, not a failure worth counting toward pruning.
      if (result.status === 429) continue

      const previous = subscriptions.find((s) => s.endpoint === result.endpoint)?.failure_count ?? 0
      const nextCount = previous + 1
      if (nextCount >= 5) {
        goneEndpoints.push(result.endpoint)
        continue
      }
      await sb
        .from('push_subscriptions')
        .update({
          last_failed_at: new Date().toISOString(),
          failure_count: nextCount,
          last_error: result.error,
        })
        .eq('endpoint', result.endpoint)
    }

    if (goneEndpoints.length > 0) {
      await sb.from('push_subscriptions').delete().in('endpoint', goneEndpoints)
    }
  }

  await sb.rpc('complete_notification_dispatch', {
    in_event_ids: claim.event_ids,
    in_channel: 'push',
    in_error: null,
  })

  // Email is a separate channel and only for released pick tickets. Failure
  // here must not undo the push that already went out.
  if (claim.kind === 'pick_list_created') {
    try {
      await sb.functions.invoke('send-notification-email', {
        body: { kind: 'pick_list_created', id: claim.event_ids[0] },
      })
    } catch (error) {
      console.warn('Pick ticket email could not be queued', error)
    }
  }

  return { sent, subscriptions: subscriptions.length, events: claim.event_count, kind: claim.kind }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceRoleKey) return json({ error: 'Push is not configured' }, 500)

  let body: {
    action?: string
    eventId?: string
    endpoint?: string
    deviceLabel?: string
    subscription?: { endpoint?: string; keys?: { p256dh?: string; auth?: string } }
  }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Invalid request body' }, 400)
  }

  const action = String(body.action ?? '').trim()

  // 'config' hands out the VAPID public key at runtime. It is not a build-time
  // env var because .env is generated by the Lovable toolchain and must not be
  // hand-edited; serving it from here also means the public and private halves
  // can never drift, since both come from the same secrets.
  if (action === 'config') {
    const publicKey = Deno.env.get('VAPID_PUBLIC_KEY')
    if (!publicKey) return json({ error: 'VAPID_PUBLIC_KEY is not set', publicKey: null }, 200)
    return json({ publicKey })
  }

  const sb = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  try {
    if (action === 'subscribe') {
      // Subscriptions belong to the caller, so resolve the user from their own
      // JWT rather than trusting anything in the body. Same shape as
      // copilot-transcribe: an anon client carrying the caller's header.
      const authHeader = req.headers.get('Authorization') ?? ''
      if (!authHeader.startsWith('Bearer ')) return json({ error: 'Not authenticated' }, 401)
      const publishableKey =
        Deno.env.get('SUPABASE_PUBLISHABLE_KEY') ?? Deno.env.get('SUPABASE_ANON_KEY') ?? ''
      const caller = createClient(supabaseUrl, publishableKey, {
        global: { headers: { Authorization: authHeader } },
        auth: { persistSession: false, autoRefreshToken: false },
      })
      const token = authHeader.slice('Bearer '.length).trim()
      const { data: claimsData, error: claimsError } = await caller.auth.getClaims(token)
      const userId = typeof claimsData?.claims?.sub === 'string' ? claimsData.claims.sub : null
      if (claimsError || !userId) return json({ error: 'Not authenticated' }, 401)

      const endpoint = String(body.subscription?.endpoint ?? '').trim()
      const p256dh = String(body.subscription?.keys?.p256dh ?? '').trim()
      const auth = String(body.subscription?.keys?.auth ?? '').trim()
      if (!endpoint || !p256dh || !auth) return json({ error: 'Incomplete subscription' }, 400)

      const { error } = await sb.from('push_subscriptions').upsert(
        {
          user_id: userId,
          endpoint,
          p256dh,
          auth,
          device_label: body.deviceLabel ? String(body.deviceLabel).slice(0, 120) : null,
          user_agent: (req.headers.get('user-agent') ?? '').slice(0, 400) || null,
          last_seen_at: new Date().toISOString(),
          failure_count: 0,
          last_error: null,
        },
        { onConflict: 'endpoint' },
      )
      if (error) throw new Error(error.message)
      return json({ saved: true })
    }

    if (action === 'unsubscribe') {
      const endpoint = String(body.endpoint ?? '').trim()
      if (!endpoint) return json({ error: 'endpoint is required' }, 400)
      const { error } = await sb.from('push_subscriptions').delete().eq('endpoint', endpoint)
      if (error) throw new Error(error.message)
      return json({ removed: true })
    }

    if (action === 'dispatch') {
      const eventId = String(body.eventId ?? '').trim()
      if (!eventId) return json({ error: 'eventId is required' }, 400)
      return json(await dispatchEvent(sb, eventId))
    }

    if (action === 'sweep') {
      // Args must be explicit: PostgREST resolves an overload by the argument
      // names supplied, so an empty body looks for a zero-argument function
      // that does not exist and never falls back to the SQL defaults.
      const { data, error } = await sb.rpc('pending_notification_dispatch', {
        in_older_than_seconds: 60,
        in_limit: 20,
      })
      if (error) throw new Error(error.message)
      const pending = (data ?? []) as Array<{ event_id: string }>
      let dispatched = 0
      for (const row of pending) {
        const result = await dispatchEvent(sb, row.event_id)
        if (!('deferred' in result)) dispatched += 1
      }
      return json({ dispatched, pending: pending.length })
    }

    return json({ error: `Unknown action: ${action || '(none)'}` }, 400)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('Push notify failed', { action, message })
    // Never fail the operation that triggered the notification.
    return json({ error: message, sent: 0 }, 200)
  }
})
