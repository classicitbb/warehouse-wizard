import { createClient } from 'npm:@supabase/supabase-js@2'
import { NetSuiteHttpError, netsuiteGetRecord, netsuiteSuiteQL, openNetSuiteSession } from '../_shared/netsuite-client.ts'
import {
  LOOKUP_DOCUMENT_TYPES,
  buildDocumentSearchQuery,
  isLookupDocumentType,
  normalizeDocument,
  normalizeDocumentNumber,
} from '../_shared/netsuite-lookup.ts'

// On-demand lookup of a NetSuite purchase order or transfer order by document
// number (Phase 1, W2). User-initiated only: the operator scans or types the
// number from the printed receiving report. Nothing here polls NetSuite, which
// keeps integration usage inside the account's concurrency allowance (J4).
//
// Body:    { documentType: 'purchase_order' | 'transfer_order', documentNumber: string }
// Returns: { found: true, document } | { found: false } | { ambiguous: true, candidates }
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

  // Anyone who can act on the Receiving screen may look a document up; the
  // Role Matrix decides that, exactly as it does for the screen's own writes.
  const { data: allowed, error: permError } = await callerClient.rpc('has_feature_permission', {
    _user_id: caller.id,
    _feature_code: 'receiving',
    _mode: 'edit',
  })
  if (permError || allowed !== true) return json({ error: 'You do not have permission to receive against NetSuite documents' }, 403)

  let body: { documentType?: unknown; documentNumber?: unknown }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Invalid request body' }, 400)
  }
  if (!isLookupDocumentType(body.documentType)) {
    return json({ error: `documentType must be one of: ${Object.keys(LOOKUP_DOCUMENT_TYPES).join(', ')}` }, 400)
  }
  const documentType = body.documentType
  const documentNumber = normalizeDocumentNumber(body.documentNumber)
  if (!documentNumber) return json({ error: 'Enter a valid document number' }, 400)

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  try {
    const opened = await openNetSuiteSession(admin)
    if (!opened.ok) return json({ unavailable: true, reason: opened.reason, message: opened.message })
    const { session } = opened

    const matches = await netsuiteSuiteQL<{
      id?: string; tranid?: string; trandate?: string; statusname?: string; entityname?: string
    }>(session, buildDocumentSearchQuery(documentType, documentNumber))

    if (matches.length === 0) return json({ found: false })
    if (matches.length > 1) {
      return json({
        ambiguous: true,
        candidates: matches.map((m) => ({
          internalId: String(m.id ?? ''),
          number: m.tranid ?? '',
          tranDate: m.trandate ?? null,
          status: m.statusname ?? '',
          entity: m.entityname ?? '',
        })),
      })
    }

    const internalId = String(matches[0].id ?? '')
    const record = await netsuiteGetRecord(session, LOOKUP_DOCUMENT_TYPES[documentType].recordType, internalId)
    const document = normalizeDocument(documentType, internalId, record)

    // Flag lines whose item has not been imported yet, so the receiving screen
    // can say so instead of failing when the operator reaches that line.
    const itemIds = [...new Set(document.lines.map((l) => l.itemId).filter((id): id is string => Boolean(id)))]
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

    return json({
      found: true,
      document: {
        ...document,
        lines: document.lines.map((l) => ({ ...l, localProductId: l.itemId ? (localByItem.get(l.itemId) ?? null) : null })),
      },
    })
  } catch (err) {
    if (err instanceof NetSuiteHttpError) {
      console.error('netsuite-lookup NetSuite error', err.status, err.message)
      if (err.retryable) {
        return json({ error: 'NetSuite is busy. Try again in a few seconds.', retryable: true }, 503)
      }
      return json({ error: err.message }, 502)
    }
    const message = err instanceof Error ? err.message : String(err)
    console.error('netsuite-lookup error', message)
    return json({ error: message }, 500)
  }
})
