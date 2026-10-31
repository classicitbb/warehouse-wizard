import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { authenticateCronRequest } from '../_shared/cron-auth.ts'
import { NetSuiteHttpError, netsuiteSuiteQL, openNetSuiteSession, type NetSuiteSession } from '../_shared/netsuite-client.ts'
import {
  LINE_BATCH_SIZE,
  ORDER_PAGE_SIZE,
  buildFulfillmentHeaderQuery,
  buildFulfillmentLinesQuery,
  buildOrderHeaderQuery,
  buildOrderLinesQuery,
  isOpenOrderStatus,
  laterCursor,
  mapFulfillmentHeader,
  mapFulfillmentLine,
  mapOrderHeader,
  mapOrderLine,
  normalizeCursor,
  type FulfillmentHeaderRow,
  type FulfillmentLineRow,
  type MappedFulfillment,
  type MappedFulfillmentLine,
  type MappedOrder,
  type MappedOrderLine,
  type OrderHeaderRow,
  type OrderLineRow,
} from '../_shared/netsuite-orders.ts'

// Polls NetSuite for outbound orders (outbound picking design, slice C: D2, O2,
// T1). Reads open sales and transfer orders at mapped locations into
// public.orders / public.order_lines (source 'netsuite'), then the item
// fulfillments the office makes on the Fulfill Orders page into
// public.order_fulfillments / public.order_fulfillment_lines. Read only towards
// NetSuite.
//
// Callers: a manager from the Orders inbox ("Sync now"), or a scheduler with
// the Lovable cron secret.
//
// Body:    { action: 'sync' }  changes since the stored cursors (first run reads
//                              every open order and Picked/Packed fulfillment)
//          { action: 'full' }  ignores the cursors and re-reads every open one
// Returns: { ok: true, orders: {...}, fulfillments: {...} }
//          | { unavailable: true, reason, message }

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
}

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

const SYNC_ROLES = ['admin', 'developer', 'warehouse_manager', 'warehouse_supervisor']
// PostgREST puts `.in()` filters in the URL, so lookups are chunked.
const LOOKUP_CHUNK = 200
// Guards against a runaway loop if NetSuite ever stops advancing the keyset.
const MAX_PAGES = 20
const MAX_LINE_PAGES = 20

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

/** Every row of a line query, offset-paged. */
async function fetchAll<T>(session: NetSuiteSession, q: string): Promise<T[]> {
  const rows: T[] = []
  for (let page = 0; page < MAX_LINE_PAGES; page++) {
    const batch = await netsuiteSuiteQL<T>(session, q, ORDER_PAGE_SIZE, page * ORDER_PAGE_SIZE)
    rows.push(...batch)
    if (batch.length < ORDER_PAGE_SIZE) break
  }
  return rows
}

async function isAuthorized(req: Request, supabaseUrl: string, anonKey: string): Promise<boolean> {
  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return false
  const callerClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false },
    global: { headers: { Authorization: authHeader } },
  })
  const { data: { user } } = await callerClient.auth.getUser()
  if (!user) return authenticateCronRequest(req) === null
  const { data: roleRows } = await callerClient.from('user_roles').select('roles!inner(code)').eq('user_id', user.id)
  const roles: string[] = (roleRows ?? []).flatMap((r: any) => {
    const nested = r.roles
    if (Array.isArray(nested)) return nested.map((x: any) => String(x.code))
    return nested?.code ? [String(nested.code)] : []
  })
  return roles.some((r) => SYNC_ROLES.includes(r))
}

/** external_id → local_id for one link family. */
async function loadLinks(admin: SupabaseClient, localTable: string, recordType: string, externalIds: string[]) {
  const map = new Map<string, string>()
  for (const ids of chunks([...new Set(externalIds)], LOOKUP_CHUNK)) {
    const { data, error } = await admin
      .from('external_record_links')
      .select('external_id, local_id')
      .eq('system', 'netsuite')
      .eq('local_table', localTable)
      .eq('external_record_type', recordType)
      .in('external_id', ids)
    if (error) throw new Error(error.message)
    for (const link of data ?? []) map.set(String(link.external_id), String(link.local_id))
  }
  return map
}

/** NetSuite location id → WW warehouse id, for every mapped warehouse. */
async function loadLocationMap(admin: SupabaseClient) {
  const { data, error } = await admin
    .from('external_record_links')
    .select('external_id, local_id')
    .eq('system', 'netsuite')
    .eq('local_table', 'warehouses')
    .eq('external_record_type', 'location')
  if (error) throw new Error(error.message)
  return new Map((data ?? []).map((l) => [String(l.external_id), String(l.local_id)]))
}

async function loadUnits(admin: SupabaseClient, nsUnitIds: string[]) {
  const map = new Map<string, string>()
  for (const ids of chunks([...new Set(nsUnitIds)], LOOKUP_CHUNK)) {
    const { data, error } = await admin.from('uom_units').select('id, ns_internal_id').in('ns_internal_id', ids)
    if (error) throw new Error(error.message)
    for (const u of data ?? []) map.set(String(u.ns_internal_id), String(u.id))
  }
  return map
}

/** WW orders already mirrored, by NetSuite id. */
async function loadOrders(admin: SupabaseClient, externalIds: string[]) {
  const map = new Map<string, { id: string; warehouse_id: string }>()
  for (const ids of chunks([...new Set(externalIds)], LOOKUP_CHUNK)) {
    const { data, error } = await admin
      .from('orders')
      .select('id, warehouse_id, external_record_id')
      .eq('source', 'netsuite')
      .in('external_record_id', ids)
    if (error) throw new Error(error.message)
    for (const o of data ?? []) map.set(String(o.external_record_id), { id: String(o.id), warehouse_id: String(o.warehouse_id) })
  }
  return map
}

async function readCursor(admin: SupabaseClient, key: string): Promise<string | null> {
  const { data, error } = await admin.from('netsuite_poll_cursors').select('cursor').eq('key', key).maybeSingle()
  if (error) throw new Error(error.message)
  return normalizeCursor(data?.cursor ?? null)
}

async function writeCursor(admin: SupabaseClient, key: string, cursor: string | null, result: Record<string, unknown>) {
  const { error } = await admin.from('netsuite_poll_cursors').upsert({
    key,
    cursor,
    last_run_at: new Date().toISOString(),
    last_result: result,
    updated_at: new Date().toISOString(),
  })
  if (error) throw new Error(error.message)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  if (!supabaseUrl || !serviceRoleKey || !anonKey) return json({ error: 'Server configuration error' }, 500)

  if (!(await isAuthorized(req, supabaseUrl, anonKey))) {
    return json({ error: 'Only managers, supervisors, admins and the scheduler can sync orders' }, 403)
  }

  let body: { action?: unknown } = {}
  try {
    body = await req.json()
  } catch {
    // An empty body from the scheduler means 'sync'.
  }
  const action = body.action ?? 'sync'
  if (action !== 'sync' && action !== 'full') return json({ error: "action must be 'sync' or 'full'" }, 400)

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  // ── orders ────────────────────────────────────────────────────────────────

  async function saveOrderLines(session: NetSuiteSession, orders: { id: string; externalId: string }[]) {
    const byExternal = new Map(orders.map((o) => [o.externalId, o.id]))
    const lines: MappedOrderLine[] = []
    for (const batch of chunks(orders.map((o) => o.externalId), LINE_BATCH_SIZE)) {
      const q = buildOrderLinesQuery(batch)
      if (!q) continue
      const rows = await fetchAll<OrderLineRow>(session, q)
      lines.push(...rows.map(mapOrderLine).filter((r): r is MappedOrderLine => r !== null))
    }

    const products = await loadLinks(admin, 'products', 'item', lines.map((l) => l.itemExternalId))
    const units = await loadUnits(admin, lines.map((l) => l.ns_unit_id).filter((u): u is string => !!u))

    // Existing lines, so ids are kept and lines removed in NetSuite are deleted.
    const existing = new Map<string, string>()
    const orderIds = orders.map((o) => o.id)
    for (const ids of chunks(orderIds, LOOKUP_CHUNK)) {
      const { data, error } = await admin
        .from('order_lines')
        .select('id, order_id, external_line_id')
        .in('order_id', ids)
        .not('external_line_id', 'is', null)
      if (error) throw new Error(error.message)
      for (const l of data ?? []) existing.set(`${l.order_id}:${l.external_line_id}`, String(l.id))
    }

    const unmapped = new Map<string, number>()
    const rows: Record<string, unknown>[] = []
    const kept = new Set<string>()
    for (const line of lines) {
      const orderId = byExternal.get(line.orderExternalId)
      if (!orderId) continue
      const productId = products.get(line.itemExternalId)
      if (!productId) {
        unmapped.set(orderId, (unmapped.get(orderId) ?? 0) + 1)
        continue
      }
      const key = `${orderId}:${line.external_line_id}`
      kept.add(key)
      const { orderExternalId: _o, itemExternalId: _i, ...fields } = line
      rows.push({
        id: existing.get(key) ?? crypto.randomUUID(),
        order_id: orderId,
        product_id: productId,
        unit_id: line.ns_unit_id ? units.get(line.ns_unit_id) ?? null : null,
        ...fields,
      })
    }
    for (const batch of chunks(rows, 500)) {
      const { error } = await admin.from('order_lines').upsert(batch, { onConflict: 'id' })
      if (error) throw new Error(error.message)
    }
    const stale = [...existing.entries()].filter(([key]) => !kept.has(key)).map(([, id]) => id)
    for (const ids of chunks(stale, LOOKUP_CHUNK)) {
      const { error } = await admin.from('order_lines').delete().in('id', ids)
      if (error) throw new Error(error.message)
    }
    for (const order of orders) {
      const { error } = await admin
        .from('orders')
        .update({ unmapped_line_count: unmapped.get(order.id) ?? 0 })
        .eq('id', order.id)
      if (error) throw new Error(error.message)
    }
    return { lines: rows.length, unmappedLines: [...unmapped.values()].reduce((a, b) => a + b, 0), removedLines: stale.length }
  }

  async function syncOrders(session: NetSuiteSession, locations: Map<string, string>, since: string | null) {
    const totals = { fetched: 0, inserted: 0, updated: 0, skipped: 0, lines: 0, unmappedLines: 0, removedLines: 0 }
    const syncedAt = new Date().toISOString()
    let cursor = since
    let afterId = 0
    for (let page = 0; page < MAX_PAGES; page++) {
      const q = buildOrderHeaderQuery({ afterId, since, locationIds: [...locations.keys()] })
      if (!q) break
      const rows = await netsuiteSuiteQL<OrderHeaderRow>(session, q, ORDER_PAGE_SIZE)
      if (rows.length === 0) break
      totals.fetched += rows.length
      const mapped = rows.map(mapOrderHeader).filter((r): r is MappedOrder => r !== null)
      for (const r of mapped) cursor = laterCursor(cursor, r.source_modified_at)

      const existing = await loadOrders(admin, mapped.map((r) => r.externalId))
      const customers = await loadLinks(admin, 'customers', 'customer', mapped.map((r) => r.customer_external_id).filter((c): c is string => !!c))
      const orderRows: Record<string, unknown>[] = []
      const openOrders: { id: string; externalId: string }[] = []
      for (const r of mapped) {
        const warehouseId = locations.get(r.locationId)
        const known = existing.get(r.externalId)
        // A delta also returns orders that closed before WW ever stored them.
        if (!warehouseId || (!known && !isOpenOrderStatus(r.external_status))) {
          totals.skipped++
          continue
        }
        const id = known?.id ?? crypto.randomUUID()
        if (known) totals.updated++
        else totals.inserted++
        const { externalId, locationId: _l, ...fields } = r
        orderRows.push({
          id,
          source: 'netsuite',
          external_record_id: externalId,
          warehouse_id: warehouseId,
          customer_id: r.customer_external_id ? customers.get(r.customer_external_id) ?? null : null,
          destination_warehouse_id: r.destination_location_external_id ? locations.get(r.destination_location_external_id) ?? null : null,
          last_synced_at: syncedAt,
          ...fields,
        })
        if (isOpenOrderStatus(r.external_status)) openOrders.push({ id, externalId })
      }
      totals.skipped += rows.length - mapped.length
      for (const batch of chunks(orderRows, 500)) {
        const { error } = await admin.from('orders').upsert(batch, { onConflict: 'id' })
        if (error) throw new Error(error.message)
      }
      if (openOrders.length > 0) {
        const saved = await saveOrderLines(session, openOrders)
        totals.lines += saved.lines
        totals.unmappedLines += saved.unmappedLines
        totals.removedLines += saved.removedLines
      }

      const lastId = Number(rows[rows.length - 1].id)
      if (!Number.isFinite(lastId) || lastId <= afterId) break
      afterId = lastId
      if (rows.length < ORDER_PAGE_SIZE) break
    }
    return { totals, cursor }
  }

  // ── fulfillments ──────────────────────────────────────────────────────────

  async function syncFulfillments(session: NetSuiteSession, locations: Map<string, string>, since: string | null) {
    const totals = { fetched: 0, saved: 0, skipped: 0, lines: 0 }
    const syncedAt = new Date().toISOString()
    let cursor = since
    let afterId = 0
    for (let page = 0; page < MAX_PAGES; page++) {
      const q = buildFulfillmentHeaderQuery({ afterId, since, locationIds: [...locations.keys()] })
      if (!q) break
      const rows = await netsuiteSuiteQL<FulfillmentHeaderRow>(session, q, ORDER_PAGE_SIZE)
      if (rows.length === 0) break
      totals.fetched += rows.length
      const mapped = rows.map(mapFulfillmentHeader).filter((r): r is MappedFulfillment => r !== null)
      for (const r of mapped) cursor = laterCursor(cursor, r.source_modified_at)

      // Only fulfillments of orders WW holds; older shipped ones are history.
      const orders = await loadOrders(admin, mapped.map((r) => r.orderExternalId))
      const headerRows: Record<string, unknown>[] = []
      for (const r of mapped) {
        const order = orders.get(r.orderExternalId)
        if (!order) {
          totals.skipped++
          continue
        }
        const { externalId, orderExternalId: _o, locationId, ...fields } = r
        headerRows.push({
          order_id: order.id,
          warehouse_id: (locationId && locations.get(locationId)) || order.warehouse_id,
          external_record_id: externalId,
          last_synced_at: syncedAt,
          ...fields,
        })
      }
      totals.skipped += rows.length - mapped.length

      const savedIds = new Map<string, { id: string; order_id: string }>()
      for (const batch of chunks(headerRows, 500)) {
        const { data, error } = await admin
          .from('order_fulfillments')
          .upsert(batch, { onConflict: 'external_record_id' })
          .select('id, order_id, external_record_id')
        if (error) throw new Error(error.message)
        for (const f of data ?? []) savedIds.set(String(f.external_record_id), { id: String(f.id), order_id: String(f.order_id) })
      }
      totals.saved += savedIds.size

      if (savedIds.size > 0) {
        const lines: MappedFulfillmentLine[] = []
        for (const batch of chunks([...savedIds.keys()], LINE_BATCH_SIZE)) {
          const lq = buildFulfillmentLinesQuery(batch)
          if (!lq) continue
          const lineRows = await fetchAll<FulfillmentLineRow>(session, lq)
          lines.push(...lineRows.map(mapFulfillmentLine).filter((r): r is MappedFulfillmentLine => r !== null))
        }
        const products = await loadLinks(admin, 'products', 'item', lines.map((l) => l.ns_item_id).filter((i): i is string => !!i))
        const orderLineIds = new Map<string, string>()
        for (const ids of chunks([...new Set([...savedIds.values()].map((f) => f.order_id))], LOOKUP_CHUNK)) {
          const { data, error } = await admin.from('order_lines').select('id, order_id, external_line_id').in('order_id', ids)
          if (error) throw new Error(error.message)
          for (const l of data ?? []) orderLineIds.set(`${l.order_id}:${l.external_line_id}`, String(l.id))
        }
        const lineRows = lines.flatMap((l) => {
          const f = savedIds.get(l.fulfillmentExternalId)
          if (!f) return []
          const { fulfillmentExternalId: _f, ...fields } = l
          return [{
            fulfillment_id: f.id,
            order_line_id: l.order_external_line_id ? orderLineIds.get(`${f.order_id}:${l.order_external_line_id}`) ?? null : null,
            product_id: l.ns_item_id ? products.get(l.ns_item_id) ?? null : null,
            ...fields,
          }]
        })
        for (const batch of chunks(lineRows, 500)) {
          const { error } = await admin.from('order_fulfillment_lines').upsert(batch, { onConflict: 'fulfillment_id,external_line_id' })
          if (error) throw new Error(error.message)
        }
        totals.lines += lineRows.length
      }

      const lastId = Number(rows[rows.length - 1].id)
      if (!Number.isFinite(lastId) || lastId <= afterId) break
      afterId = lastId
      if (rows.length < ORDER_PAGE_SIZE) break
    }
    return { totals, cursor }
  }

  try {
    const locations = await loadLocationMap(admin)
    if (locations.size === 0) {
      return json({ ok: true, message: 'No warehouse is mapped to a NetSuite location.', orders: null, fulfillments: null })
    }

    const opened = await openNetSuiteSession(admin)
    if (!opened.ok) return json({ unavailable: true, reason: opened.reason, message: opened.message })
    const { session } = opened

    const orderSince = action === 'full' ? null : await readCursor(admin, 'orders')
    const orders = await syncOrders(session, locations, orderSince)
    const ordersResult = { mode: orderSince ? 'delta' : 'import', ...orders.totals }
    await writeCursor(admin, 'orders', orders.cursor, ordersResult)

    const fulfillmentSince = action === 'full' ? null : await readCursor(admin, 'fulfillments')
    const fulfillments = await syncFulfillments(session, locations, fulfillmentSince)
    const fulfillmentsResult = { mode: fulfillmentSince ? 'delta' : 'import', ...fulfillments.totals }
    await writeCursor(admin, 'fulfillments', fulfillments.cursor, fulfillmentsResult)

    return json({ ok: true, orders: ordersResult, fulfillments: fulfillmentsResult })
  } catch (err) {
    if (err instanceof NetSuiteHttpError) {
      console.error('netsuite-orders NetSuite error', err.status, err.message)
      if (err.retryable) return json({ error: 'NetSuite is busy. Try again in a few seconds.', retryable: true }, 503)
      return json({ error: err.message }, 502)
    }
    const message = err instanceof Error ? err.message : String(err)
    console.error('netsuite-orders error', message)
    return json({ error: message }, 500)
  }
})
