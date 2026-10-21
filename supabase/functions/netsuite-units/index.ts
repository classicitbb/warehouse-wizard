import { createClient } from 'npm:@supabase/supabase-js@2'
import { NetSuiteHttpError, netsuiteSuiteQL, openNetSuiteSession } from '../_shared/netsuite-client.ts'
import {
  UNITS_PAGE_SIZE,
  buildItemUnitsPageQuery,
  buildUnitsPageQuery,
  collectUnits,
  mapItemUnitRow,
  type ItemUnitRow,
  type MappedItemUnits,
  type MappedUomType,
  type MappedUomUnit,
  type UnitRow,
} from '../_shared/netsuite-units.ts'

// Mirrors NetSuite units of measure into public.uom_types / public.uom_units
// and backfills each linked product's unit type and stock/sale/purchase units
// (outbound picking design, slice A / D6). Admin/developer only, started from
// Settings > Integrations > NetSuite units.
//
// Body:    { action: 'import' }
// Returns: { ok: true, types, units, unitsSkipped, items, productsLinked, productsUpdated }
//          | { unavailable: true, reason, message }
//
// Products are matched through external_record_links (local_table 'products',
// external_record_type 'item'); items not imported into WW are ignored.
// uom_units.package_type_id is filled by a database trigger from the unit name.

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

// PostgREST puts `.in()` filters in the URL, so lookups are chunked.
const LOOKUP_CHUNK = 200
// Guards against a runaway loop if NetSuite ever stops advancing the keyset.
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
    return json({ error: 'Only admins and developers can import NetSuite units' }, 403)
  }

  let body: { action?: unknown }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Invalid request body' }, 400)
  }
  if (body.action !== 'import') return json({ error: "action must be 'import'" }, 400)

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  async function saveUnits(types: MappedUomType[], units: MappedUomUnit[], syncedAt: string) {
    const typeIdByExternal = new Map<string, string>()
    for (let i = 0; i < types.length; i += LOOKUP_CHUNK) {
      const chunk = types.slice(i, i + LOOKUP_CHUNK).map((t) => ({ ...t, last_synced_at: syncedAt }))
      const { data, error } = await admin
        .from('uom_types')
        .upsert(chunk, { onConflict: 'ns_internal_id' })
        .select('id, ns_internal_id')
      if (error) throw new Error(error.message)
      for (const row of data ?? []) typeIdByExternal.set(String(row.ns_internal_id), String(row.id))
    }
    const unitRows = units
      .filter((u) => typeIdByExternal.has(u.typeExternalId))
      .map(({ typeExternalId, ...fields }) => ({
        ...fields,
        uom_type_id: typeIdByExternal.get(typeExternalId),
        last_synced_at: syncedAt,
      }))
    for (let i = 0; i < unitRows.length; i += LOOKUP_CHUNK) {
      // package_type_id is left out so a re-import keeps an admin's override.
      const { error } = await admin
        .from('uom_units')
        .upsert(unitRows.slice(i, i + LOOKUP_CHUNK), { onConflict: 'ns_internal_id' })
      if (error) throw new Error(error.message)
    }
    return unitRows.length
  }

  async function saveItemUnits(items: MappedItemUnits[]) {
    let linked = 0
    let updated = 0
    for (let i = 0; i < items.length; i += LOOKUP_CHUNK) {
      const chunk = items.slice(i, i + LOOKUP_CHUNK)
      const { data: links, error } = await admin
        .from('external_record_links')
        .select('external_id, local_id')
        .eq('system', 'netsuite')
        .eq('local_table', 'products')
        .eq('external_record_type', 'item')
        .in('external_id', chunk.map((item) => item.itemId))
      if (error) throw new Error(error.message)
      const productByItem = new Map<string, string>()
      for (const link of links ?? []) productByItem.set(String(link.external_id), String(link.local_id))
      const rows = chunk
        .filter((item) => productByItem.has(item.itemId))
        .map(({ itemId, ...units }) => ({ product_id: productByItem.get(itemId), ...units }))
      if (rows.length === 0) continue
      linked += rows.length
      const { data: count, error: applyError } = await admin.rpc('apply_netsuite_product_units', { p_rows: rows })
      if (applyError) throw new Error(applyError.message)
      updated += Number(count ?? 0)
    }
    return { linked, updated }
  }

  try {
    const opened = await openNetSuiteSession(admin)
    if (!opened.ok) return json({ unavailable: true, reason: opened.reason, message: opened.message })
    const { session } = opened

    const syncedAt = new Date().toISOString()

    // 1. Unit types and their units.
    const types = new Map<string, MappedUomType>()
    const units: MappedUomUnit[] = []
    let unitsSkipped = 0
    let afterUnit = 0
    for (let page = 0; page < MAX_PAGES; page++) {
      const rows = await netsuiteSuiteQL<UnitRow>(session, buildUnitsPageQuery(afterUnit), UNITS_PAGE_SIZE)
      if (rows.length === 0) break
      const collected = collectUnits(rows)
      for (const t of collected.types) types.set(t.ns_internal_id, t)
      units.push(...collected.units)
      unitsSkipped += collected.skipped
      const lastId = Number(rows[rows.length - 1].unit_id)
      if (!Number.isFinite(lastId) || lastId <= afterUnit || rows.length < UNITS_PAGE_SIZE) break
      afterUnit = lastId
    }
    const savedUnits = await saveUnits([...types.values()], units, syncedAt)

    // 2. Item unit assignments onto linked products. Runs after the units are
    //    saved so every referenced unit id resolves.
    const totals = { items: 0, productsLinked: 0, productsUpdated: 0 }
    let afterItem = 0
    for (let page = 0; page < MAX_PAGES; page++) {
      const rows = await netsuiteSuiteQL<ItemUnitRow>(session, buildItemUnitsPageQuery(afterItem), UNITS_PAGE_SIZE)
      if (rows.length === 0) break
      totals.items += rows.length
      const mapped = rows.map(mapItemUnitRow).filter((r): r is MappedItemUnits => r !== null)
      const saved = await saveItemUnits(mapped)
      totals.productsLinked += saved.linked
      totals.productsUpdated += saved.updated
      const lastId = Number(rows[rows.length - 1].id)
      if (!Number.isFinite(lastId) || lastId <= afterItem || rows.length < UNITS_PAGE_SIZE) break
      afterItem = lastId
    }

    return json({ ok: true, types: types.size, units: savedUnits, unitsSkipped, ...totals })
  } catch (err) {
    if (err instanceof NetSuiteHttpError) {
      console.error('netsuite-units NetSuite error', err.status, err.message)
      if (err.retryable) return json({ error: 'NetSuite is busy. Try again in a few seconds.', retryable: true }, 503)
      return json({ error: err.message }, 502)
    }
    const message = err instanceof Error ? err.message : String(err)
    console.error('netsuite-units error', message)
    return json({ error: message }, 500)
  }
})
