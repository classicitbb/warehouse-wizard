import { createClient } from 'npm:@supabase/supabase-js@2'
import {
  NetSuiteHttpError,
  netsuiteGetMetadataCatalog,
  netsuiteGetRecord,
  netsuiteRestletGet,
  netsuiteSuiteQL,
  openNetSuiteSession,
} from '../_shared/netsuite-client.ts'
import { DISCOVERY_RECORDS, isDiscoveryRecord, isReadOnlySuiteQL, summariseSchema } from '../_shared/netsuite-discovery.ts'

// Read-only discovery of the real NetSuite field and sublist ids (J10).
// Admins and developers only. Never writes to NetSuite: it makes GET calls,
// and the record types it can read are a fixed list.
//
// Body:
//   { action: 'restlet_get', inboundShipmentId: string }
//       -> the inbound shipment RESTlet's own field report for that shipment
//   { action: 'catalog', records?: string[], raw?: boolean }
//       -> field and sublist ids per record from the metadata catalog
//   { action: 'record', record: string, internalId: string }
//       -> one record exactly as the REST API returns it (expandSubResources),
//          to see what a field really looks like rather than what the catalog says
//   { action: 'suiteql', q: string, limit?: number, offset?: number }
//       -> rows from one SELECT (or WITH ... SELECT) query, up to 1000 per page.
//          The SuiteQL endpoint cannot write; the statement is checked anyway

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
  if (!callerRoles.includes('admin') && !callerRoles.includes('developer')) {
    return json({ error: 'Only admins and developers can run NetSuite discovery' }, 403)
  }

  let body: { action?: string; inboundShipmentId?: unknown; records?: unknown; raw?: unknown; record?: unknown; internalId?: unknown; q?: unknown; limit?: unknown; offset?: unknown }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Invalid request body' }, 400)
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  try {
    if (body.action === 'restlet_get') {
      const id = String(body.inboundShipmentId ?? '').trim()
      if (!/^\d{1,12}$/.test(id)) return json({ error: 'inboundShipmentId must be the shipment internal id (digits only)' }, 400)

      const opened = await openNetSuiteSession(admin, ['restlets'])
      if (!opened.ok) return json({ unavailable: true, reason: opened.reason, message: opened.message })
      const result = await netsuiteRestletGet(opened.session, { inboundShipmentId: id })
      return json({ ok: true, restlet: opened.session.restlet, result: result as Record<string, unknown> })
    }

    if (body.action === 'catalog') {
      const requested = Array.isArray(body.records) && body.records.length > 0 ? body.records : [...DISCOVERY_RECORDS]
      const records = requested.filter(isDiscoveryRecord)
      if (records.length === 0) return json({ error: `records must be from: ${DISCOVERY_RECORDS.join(', ')}` }, 400)

      const opened = await openNetSuiteSession(admin)
      if (!opened.ok) return json({ unavailable: true, reason: opened.reason, message: opened.message })

      const out: Record<string, unknown> = {}
      for (const record of records) {
        try {
          const schema = await netsuiteGetMetadataCatalog(opened.session, record)
          out[record] = body.raw === true ? schema : summariseSchema(schema)
        } catch (err) {
          out[record] = { error: err instanceof Error ? err.message : String(err) }
        }
      }
      return json({ ok: true, records: out })
    }

    if (body.action === 'record') {
      if (!isDiscoveryRecord(body.record)) return json({ error: `record must be one of: ${DISCOVERY_RECORDS.join(', ')}` }, 400)
      const id = String(body.internalId ?? '').trim()
      if (!/^\d{1,12}$/.test(id)) return json({ error: 'internalId must be digits only' }, 400)

      const opened = await openNetSuiteSession(admin)
      if (!opened.ok) return json({ unavailable: true, reason: opened.reason, message: opened.message })
      return json({ ok: true, record: await netsuiteGetRecord(opened.session, body.record, id) as Record<string, unknown> })
    }

    if (body.action === 'suiteql') {
      const q = String(body.q ?? '').trim()
      if (!isReadOnlySuiteQL(q)) return json({ error: 'q must be a single SELECT or WITH query' }, 400)
      const limit = Math.min(Math.max(Math.trunc(Number(body.limit) || 100), 1), 1000)
      const offset = Math.max(Math.trunc(Number(body.offset) || 0), 0)

      const opened = await openNetSuiteSession(admin)
      if (!opened.ok) return json({ unavailable: true, reason: opened.reason, message: opened.message })
      const items = await netsuiteSuiteQL(opened.session, q, limit, offset)
      return json({ ok: true, count: items.length, items })
    }

    return json({ error: "action must be 'restlet_get', 'catalog', 'record' or 'suiteql'" }, 400)
  } catch (err) {
    if (err instanceof NetSuiteHttpError) {
      console.error('netsuite-discovery NetSuite error', err.status, err.message)
      return json({ error: err.message, status: err.status }, 502)
    }
    const message = err instanceof Error ? err.message : String(err)
    console.error('netsuite-discovery error', message)
    return json({ error: message }, 500)
  }
})
