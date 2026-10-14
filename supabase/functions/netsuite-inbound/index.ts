import { createClient } from 'npm:@supabase/supabase-js@2'
import { NetSuiteHttpError, netsuiteSuiteQL, openNetSuiteSession } from '../_shared/netsuite-client.ts'
import {
  INBOUND_MAX_ROWS,
  INBOUND_PAGE_SIZE,
  buildInboundLinesQuery,
  buildInboundListQuery,
  buildInboundReceivedQuery,
  buildInboundTotalsQuery,
  buildShipmentsForPoQuery,
  findContainerField,
  indexReceived,
  indexTotals,
  isInboundSortKey,
  isInboundStatusFilter,
  mapShipmentDetail,
  mapShipmentSummary,
  normalizeFieldId,
  normalizeInternalId,
  normalizeSearchTerm,
} from '../_shared/netsuite-inbound.ts'

// Read-only browser for NetSuite inbound shipments (Receiving > View inbound).
// User-initiated only: nothing here polls NetSuite, which keeps integration use
// inside the account's concurrency allowance (J4).
//
// Body, one of:
//   { action: 'list', search?, status?: 'open'|'received'|'all', sort?, direction?, limit? }
//   { action: 'detail', shipmentId }
//   { action: 'for_po', poId }       open shipments that carry this PO
// Returns { shipments, hasMore, containerField } | { detail } | { shipments } | { unavailable: true, reason, message }

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
}

// The custom "Container No" field's script id. Set `inbound_container_field` on the
// NetSuite connection to pin it; otherwise it is read from the record's columns.
// Remembered per isolate (a miss only briefly, so adding the field is picked up).
let containerFieldCache: { value: string | null; at: number } | null = null
const MISS_TTL_MS = 5 * 60 * 1000

// deno-lint-ignore no-explicit-any
async function resolveContainerField(admin: any, session: Parameters<typeof netsuiteSuiteQL>[0]): Promise<string | null> {
  if (containerFieldCache && (containerFieldCache.value || Date.now() - containerFieldCache.at < MISS_TTL_MS)) {
    return containerFieldCache.value
  }
  let value: string | null = null
  const { data: connection } = await admin.from('integration_connections').select('config').eq('system', 'netsuite').maybeSingle()
  const configured = normalizeFieldId((connection?.config as Record<string, unknown> | null)?.inbound_container_field)
  if (configured) {
    value = configured
  } else {
    try {
      const rows = await netsuiteSuiteQL<Record<string, unknown>>(session, 'SELECT * FROM inboundshipment FETCH FIRST 1 ROWS ONLY', 1)
      value = rows[0] ? findContainerField(Object.keys(rows[0])) : null
    } catch (err) {
      if (err instanceof NetSuiteHttpError && err.retryable) throw err
      console.warn('netsuite-inbound: could not read inbound shipment columns', err instanceof Error ? err.message : err)
    }
  }
  containerFieldCache = { value, at: Date.now() }
  return value
}

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return json({ error: 'Unauthorized' }, 401)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  if (!supabaseUrl || !serviceRoleKey || !anonKey) return json({ error: 'Server configuration error' }, 500)

  const callerClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false },
    global: { headers: { Authorization: authHeader } },
  })
  const { data: { user: caller } } = await callerClient.auth.getUser()
  if (!caller) return json({ error: 'Unauthorized' }, 401)

  // Same gate as netsuite-lookup: whoever may act on Receiving may browse inbound.
  const { data: allowed, error: permError } = await callerClient.rpc('has_feature_permission', {
    _user_id: caller.id,
    _feature_code: 'receiving',
    _mode: 'edit',
  })
  if (permError || allowed !== true) return json({ error: 'You do not have permission to receive against NetSuite documents' }, 403)

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Invalid request body' }, 400)
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  try {
    const opened = await openNetSuiteSession(admin)
    if (!opened.ok) return json({ unavailable: true, reason: opened.reason, message: opened.message })
    const { session } = opened

    if (body.action === 'list') {
      const search = normalizeSearchTerm(body.search)
      if (search === undefined) return json({ error: 'Enter a valid shipment, container or PO number' }, 400)
      const status = body.status === undefined ? 'open' : body.status
      if (!isInboundStatusFilter(status)) return json({ error: 'Unknown status filter' }, 400)
      const sort = body.sort === undefined ? 'expected_delivery' : body.sort
      if (!isInboundSortKey(sort)) return json({ error: 'Unknown sort' }, 400)
      const direction = body.direction === 'desc' ? 'desc' : 'asc'
      const requested = typeof body.limit === 'number' && Number.isFinite(body.limit) ? Math.floor(body.limit) : INBOUND_PAGE_SIZE
      const limit = Math.min(Math.max(requested, 1), INBOUND_MAX_ROWS)

      let containerField = await resolveContainerField(admin, session)

      // One extra row tells us whether there is more without a count query.
      const runList = (field: string | null) =>
        netsuiteSuiteQL<Record<string, unknown>>(session, buildInboundListQuery({ search, status, sort, direction }, field), limit + 1)
      let rows: Record<string, unknown>[]
      try {
        rows = await runList(containerField)
      } catch (err) {
        // A pinned or guessed container field that NetSuite rejects must not take the whole list down.
        if (!containerField || !(err instanceof NetSuiteHttpError) || err.retryable || err.status !== 400) throw err
        console.warn('netsuite-inbound: container field rejected, listing without it', containerField)
        containerFieldCache = { value: null, at: Date.now() }
        containerField = null
        rows = await runList(null)
      }
      const hasMore = rows.length > limit
      const page = rows.slice(0, limit)

      const totalsQuery = buildInboundTotalsQuery(page.map((r) => String(r.id ?? '')))
      const totals = totalsQuery
        ? indexTotals(await netsuiteSuiteQL<Record<string, unknown>>(session, totalsQuery, 1000))
        : new Map()
      return json({
        shipments: page.map((r) => mapShipmentSummary(r, totals.get(String(r.id ?? '')))),
        hasMore,
        containerField,
      })
    }

    if (body.action === 'detail') {
      const shipmentId = normalizeInternalId(body.shipmentId)
      if (!shipmentId) return json({ error: 'Invalid inbound shipment id' }, 400)

      const lineRows = await netsuiteSuiteQL<Record<string, unknown>>(session, buildInboundLinesQuery(shipmentId), 1000)

      // Received quantities are best effort (column unconfirmed): a rejected
      // column should cost the "already received" figure, not the whole preview.
      let received: Map<string, number> | null = null
      try {
        received = indexReceived(await netsuiteSuiteQL<Record<string, unknown>>(session, buildInboundReceivedQuery(shipmentId), 1000))
      } catch (err) {
        if (err instanceof NetSuiteHttpError && err.retryable) throw err
        console.warn('netsuite-inbound: received quantities unavailable', err instanceof Error ? err.message : err)
      }
      const detail = mapShipmentDetail(shipmentId, lineRows, received)

      // Flag lines whose item has not been imported yet, as the PO lookup does.
      const itemIds = [...new Set(detail.pos.flatMap((po) => po.lines.map((l) => l.itemId)).filter((id): id is string => Boolean(id)))]
      const localByItem = new Map<string, string>()
      if (itemIds.length > 0) {
        const { data: links, error: linkError } = await admin
          .from('external_record_links')
          .select('external_id, local_id')
          .eq('system', 'netsuite')
          .eq('local_table', 'products')
          .eq('external_record_type', 'item')
          .in('external_id', itemIds)
        if (linkError) throw new Error(linkError.message)
        for (const link of links ?? []) localByItem.set(String(link.external_id), String(link.local_id))
      }
      for (const po of detail.pos) {
        for (const line of po.lines) line.localProductId = line.itemId ? (localByItem.get(line.itemId) ?? null) : null
      }
      return json({ detail })
    }

    if (body.action === 'for_po') {
      const poId = normalizeInternalId(body.poId)
      if (!poId) return json({ error: 'Invalid purchase order id' }, 400)
      const rows = await netsuiteSuiteQL<Record<string, unknown>>(session, buildShipmentsForPoQuery(poId), 20)
      return json({ shipments: rows.map((r) => mapShipmentSummary(r)) })
    }

    return json({ error: "action must be 'list', 'detail' or 'for_po'" }, 400)
  } catch (err) {
    if (err instanceof NetSuiteHttpError) {
      console.error('netsuite-inbound NetSuite error', err.status, err.message)
      if (err.retryable) return json({ error: 'NetSuite is busy. Try again in a few seconds.', retryable: true }, 503)
      return json({ error: err.message }, 502)
    }
    const message = err instanceof Error ? err.message : String(err)
    console.error('netsuite-inbound error', message)
    return json({ error: message }, 500)
  }
})
