import { createClient } from 'npm:@supabase/supabase-js@2'
import {
  NetSuiteHttpError,
  netsuiteCreateRecord,
  netsuiteSuiteQL,
  openNetSuiteSession,
} from '../_shared/netsuite-client.ts'
import {
  BINS_PAGE_SIZE,
  BIN_CREATE_BATCH,
  buildBinCreateBody,
  buildBinsPageQuery,
  buildLocationsQuery,
  planBins,
  type NetSuiteBinRow,
  type NetSuiteLocationRow,
  type WarehouseLink,
  type WwLocation,
} from '../_shared/netsuite-bins.ts'

// Mirrors Warehouse Wizard locations into NetSuite bins (Phase 1 task W5).
// Admin/developer only, started from Settings > Integrations > NetSuite bins.
//
// Body:    { action: 'preview' }  -> the plan, nothing written
//          { action: 'sync' }     -> links every bin that already exists by
//                                    number, then creates up to BIN_CREATE_BATCH
//                                    missing bins. Call again while remaining > 0.
// Returns: { ok: true, warehouses, unmappedWarehouses, linked, created, failed,
//            errors, remaining } | { unavailable: true, reason, message }
//
// A WW location links to its bin in external_record_links (local_table
// 'locations', external_record_type 'bin'). Hidden WW locations are skipped.
// Bins are never deleted or renamed from here.

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

const PAGE = 1000
const LINK_CHUNK = 200
const MAX_PAGES = 50

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

  const { data: roleRows } = await callerClient
    .from('user_roles')
    .select('roles!inner(code)')
    .eq('user_id', caller.id)
  const callerRoles: string[] = (roleRows ?? []).flatMap((r: any) => {
    const nested = r.roles
    if (Array.isArray(nested)) return nested.map((x: any) => String(x.code))
    return nested?.code ? [String(nested.code)] : []
  })
  if (!callerRoles.some((r) => ['admin', 'developer'].includes(r))) {
    return json({ error: 'Only admins and developers can sync NetSuite bins' }, 403)
  }

  let body: { action?: unknown }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Invalid request body' }, 400)
  }
  if (body.action !== 'preview' && body.action !== 'sync') {
    return json({ error: "action must be 'preview' or 'sync'" }, 400)
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  async function loadAll<T>(build: (from: number) => any): Promise<T[]> {
    const out: T[] = []
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await build(from).range(from, from + PAGE - 1)
      if (error) throw new Error(error.message)
      out.push(...((data ?? []) as T[]))
      if (!data || data.length < PAGE) return out
    }
  }

  async function saveLinks(rows: { locationId: string; binId: string }[], syncedAt: string) {
    for (let i = 0; i < rows.length; i += LINK_CHUNK) {
      const chunk = rows.slice(i, i + LINK_CHUNK).map((r) => ({
        system: 'netsuite',
        local_table: 'locations',
        local_id: r.locationId,
        external_record_type: 'bin',
        external_id: r.binId,
        last_synced_at: syncedAt,
      }))
      const { error } = await admin
        .from('external_record_links')
        .upsert(chunk, { onConflict: 'system,local_table,local_id,external_record_type' })
      if (error) throw new Error(error.message)
    }
  }

  try {
    // Warehouse -> NetSuite location mappings (Settings > NetSuite warehouses).
    const whLinks = await loadAll<{ local_id: string; external_id: string }>(() =>
      admin
        .from('external_record_links')
        .select('local_id, external_id')
        .eq('system', 'netsuite')
        .eq('local_table', 'warehouses')
        .eq('external_record_type', 'location'),
    )
    const warehouseRows = await loadAll<{ id: string; name: string }>(() =>
      admin.from('warehouses').select('id, name').order('id'),
    )
    const nameById = new Map(warehouseRows.map((w) => [String(w.id), String(w.name)]))
    const mappedIds = new Set(whLinks.map((l) => String(l.local_id)))
    const warehouses: WarehouseLink[] = whLinks.map((l) => ({
      warehouseId: String(l.local_id),
      warehouseName: nameById.get(String(l.local_id)) ?? String(l.local_id),
      netsuiteLocationId: String(l.external_id),
    }))

    const locations: WwLocation[] = (
      await loadAll<{ id: string; code: string; warehouse_id: string; status: string }>(() =>
        admin.from('locations').select('id, code, warehouse_id, status').eq('is_hidden', false).order('id'),
      )
    ).map((l) => ({ id: String(l.id), code: String(l.code ?? ''), warehouseId: String(l.warehouse_id), status: String(l.status) }))

    const withLocations = new Set(locations.map((l) => l.warehouseId))
    const unmappedWarehouses = [...withLocations].filter((id) => !mappedIds.has(id)).map((id) => nameById.get(id) ?? id)

    const existingLinks = new Map<string, string>()
    for (const row of await loadAll<{ local_id: string; external_id: string }>(() =>
      admin
        .from('external_record_links')
        .select('local_id, external_id')
        .eq('system', 'netsuite')
        .eq('local_table', 'locations')
        .eq('external_record_type', 'bin')
        .order('id'),
    )) existingLinks.set(String(row.local_id), String(row.external_id))

    const opened = await openNetSuiteSession(admin)
    if (!opened.ok) return json({ unavailable: true, reason: opened.reason, message: opened.message })
    const { session } = opened

    const netsuiteLocations = await netsuiteSuiteQL<NetSuiteLocationRow>(session, buildLocationsQuery(), 1000)
    const netsuiteBins: NetSuiteBinRow[] = []
    let after = 0
    for (let page = 0; page < MAX_PAGES; page++) {
      const rows = await netsuiteSuiteQL<NetSuiteBinRow>(session, buildBinsPageQuery(after), BINS_PAGE_SIZE)
      netsuiteBins.push(...rows)
      const lastId = Number(rows[rows.length - 1]?.id)
      if (rows.length < BINS_PAGE_SIZE || !Number.isFinite(lastId) || lastId <= after) break
      after = lastId
    }

    const plan = planBins({ warehouses, unmappedWarehouses, locations, netsuiteLocations, netsuiteBins, existingLinks })
    const toCreate = plan.actions.filter((a) => a.kind === 'create')

    if (body.action === 'preview') {
      return json({
        ok: true,
        warehouses: plan.warehouses,
        unmappedWarehouses: plan.unmappedWarehouses,
        linked: 0,
        created: 0,
        failed: 0,
        errors: [],
        remaining: toCreate.length,
      })
    }

    const syncedAt = new Date().toISOString()

    // 1. Link bins that already exist by number. Cheap: no NetSuite writes.
    const links = plan.actions.flatMap((a) => (a.kind === 'link' ? [{ locationId: a.locationId, binId: a.netsuiteBinId }] : []))
    await saveLinks(links, syncedAt)

    // 2. Create one batch of missing bins, linking each as it lands so a
    //    timeout part-way never leaves a created bin unlinked for long: the
    //    next run matches it by number.
    const batch = toCreate.slice(0, BIN_CREATE_BATCH)
    let pending: { locationId: string; binId: string }[] = []
    let createdCount = 0
    const errors: { code: string; error: string }[] = []
    for (const action of batch) {
      try {
        const binId = await netsuiteCreateRecord(session, 'bin', buildBinCreateBody(action))
        pending.push({ locationId: action.locationId, binId })
        createdCount++
      } catch (err) {
        if (err instanceof NetSuiteHttpError && err.retryable) {
          errors.push({ code: action.code, error: 'NetSuite is busy; run sync again' })
          break
        }
        errors.push({ code: action.code, error: err instanceof Error ? err.message : String(err) })
        // A permission or validation error usually hits every bin: stop early.
        if (errors.length >= 5 && createdCount === 0) break
      }
      if (pending.length >= 25) {
        await saveLinks(pending, syncedAt)
        pending = []
      }
    }
    await saveLinks(pending, syncedAt)

    return json({
      ok: true,
      warehouses: plan.warehouses,
      unmappedWarehouses: plan.unmappedWarehouses,
      linked: links.length,
      created: createdCount,
      failed: errors.length,
      errors: errors.slice(0, 20),
      remaining: Math.max(0, toCreate.length - createdCount),
    })
  } catch (err) {
    if (err instanceof NetSuiteHttpError) {
      console.error('netsuite-bins NetSuite error', err.status, err.message)
      if (err.retryable) return json({ error: 'NetSuite is busy. Try again in a few seconds.', retryable: true }, 503)
      return json({ error: err.message }, 502)
    }
    const message = err instanceof Error ? err.message : String(err)
    console.error('netsuite-bins error', message)
    return json({ error: message }, 500)
  }
})
