import { createClient } from 'npm:@supabase/supabase-js@2'
import { NetSuiteHttpError, netsuiteSuiteQL, openNetSuiteSession } from '../_shared/netsuite-client.ts'
import {
  CUSTOMER_PAGE_SIZE,
  buildCustomerPageQuery,
  mapCustomerRow,
  normalizeCursor,
  type CustomerRow,
  type MappedCustomer,
} from '../_shared/netsuite-customers.ts'

// Mirrors NetSuite customers into public.customers (outbound picking design,
// slice B / D1). Admin/developer only, started from the Customers page.
//
// Body:    { action: 'import' }  every active customer, keyset-paged by internal id
//          { action: 'delta' }   customers changed since the newest
//                                source_modified_at already stored (inactive
//                                ones included, so deactivations land);
//                                falls back to a full import on an empty table
// Returns: { ok: true, mode, fetched, inserted, updated, skipped, cursor }
//          | { unavailable: true, reason, message }
//
// Rows are linked through external_record_links (local_table 'customers',
// external_record_type 'customer'). Balances and credit notes are not stored.

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

// PostgREST puts `.in()` filters in the URL, so link lookups are chunked.
const LINK_LOOKUP_CHUNK = 200
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
    return json({ error: 'Only admins and developers can import customers' }, 403)
  }

  let body: { action?: unknown }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Invalid request body' }, 400)
  }
  if (body.action !== 'import' && body.action !== 'delta') {
    return json({ error: "action must be 'import' or 'delta'" }, 400)
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  async function loadLinks(externalIds: string[]): Promise<Map<string, string>> {
    const byExternal = new Map<string, string>()
    for (let i = 0; i < externalIds.length; i += LINK_LOOKUP_CHUNK) {
      const { data, error } = await admin
        .from('external_record_links')
        .select('external_id, local_id')
        .eq('system', 'netsuite')
        .eq('local_table', 'customers')
        .eq('external_record_type', 'customer')
        .in('external_id', externalIds.slice(i, i + LINK_LOOKUP_CHUNK))
      if (error) throw new Error(error.message)
      for (const link of data ?? []) byExternal.set(String(link.external_id), String(link.local_id))
    }
    return byExternal
  }

  async function savePage(rows: MappedCustomer[], syncedAt: string) {
    const links = await loadLinks(rows.map((r) => r.externalId))
    let inserted = 0
    let updated = 0
    let skipped = 0
    const customerRows: Record<string, unknown>[] = []
    const linkRows: Record<string, unknown>[] = []
    for (const row of rows) {
      const existingId = links.get(row.externalId)
      // A delta also returns customers that were never imported because they
      // were already inactive; there is nothing to deactivate for those.
      if (!existingId && !row.active) {
        skipped++
        continue
      }
      const id = existingId ?? crypto.randomUUID()
      if (existingId) updated++
      else inserted++
      const { externalId, ...fields } = row
      customerRows.push({ id, ...fields, last_synced_at: syncedAt })
      linkRows.push({
        system: 'netsuite',
        local_table: 'customers',
        local_id: id,
        external_record_type: 'customer',
        external_id: externalId,
        last_synced_at: syncedAt,
      })
    }
    if (customerRows.length > 0) {
      const { error } = await admin.from('customers').upsert(customerRows, { onConflict: 'id' })
      if (error) throw new Error(error.message)
      const { error: linkError } = await admin
        .from('external_record_links')
        .upsert(linkRows, { onConflict: 'system,local_table,local_id,external_record_type' })
      if (linkError) throw new Error(linkError.message)
    }
    return { inserted, updated, skipped }
  }

  try {
    let since: string | null = null
    if (body.action === 'delta') {
      const { data, error } = await admin
        .from('customers')
        .select('source_modified_at')
        .not('source_modified_at', 'is', null)
        .order('source_modified_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (error) throw new Error(error.message)
      since = normalizeCursor(data?.source_modified_at ?? null)
    }
    const mode = since ? 'delta' : 'import'

    const opened = await openNetSuiteSession(admin)
    if (!opened.ok) return json({ unavailable: true, reason: opened.reason, message: opened.message })
    const { session } = opened

    const syncedAt = new Date().toISOString()
    const totals = { fetched: 0, inserted: 0, updated: 0, skipped: 0 }
    let cursor = since
    let afterId = 0
    for (let page = 0; page < MAX_PAGES; page++) {
      const rows = await netsuiteSuiteQL<CustomerRow>(
        session,
        buildCustomerPageQuery({ afterId, since }),
        CUSTOMER_PAGE_SIZE,
      )
      if (rows.length === 0) break
      totals.fetched += rows.length
      const mapped = rows.map(mapCustomerRow).filter((r): r is MappedCustomer => r !== null)
      const saved = await savePage(mapped, syncedAt)
      totals.inserted += saved.inserted
      totals.updated += saved.updated
      totals.skipped += saved.skipped + (rows.length - mapped.length)
      for (const r of mapped) {
        if (r.source_modified_at && (!cursor || r.source_modified_at > cursor)) cursor = r.source_modified_at
      }
      const lastId = Number(rows[rows.length - 1].id)
      if (!Number.isFinite(lastId) || lastId <= afterId) break
      afterId = lastId
      if (rows.length < CUSTOMER_PAGE_SIZE) break
    }

    return json({ ok: true, mode, ...totals, cursor })
  } catch (err) {
    if (err instanceof NetSuiteHttpError) {
      console.error('netsuite-customers NetSuite error', err.status, err.message)
      if (err.retryable) return json({ error: 'NetSuite is busy. Try again in a few seconds.', retryable: true }, 503)
      return json({ error: err.message }, 502)
    }
    const message = err instanceof Error ? err.message : String(err)
    console.error('netsuite-customers error', message)
    return json({ error: message }, 500)
  }
})
