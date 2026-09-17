import { createClient } from 'npm:@supabase/supabase-js@2'
import { mapNetSuiteItemToProduct, netsuiteHost, upsertProductFromNetSuiteItem, type NetSuiteItemPayload } from '../_shared/netsuite.ts'
import { fetchNetSuiteAccessToken, generateNetSuiteCertificate, type NetSuiteM2MCredentials } from '../_shared/netsuite-auth.ts'

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

function maskTail(value: string | null | undefined, keep = 4): string | null {
  if (!value) return null
  const trimmed = value.trim()
  if (!trimmed) return null
  if (trimmed.length <= keep) return '••••' + trimmed
  return '••••' + trimmed.slice(-keep)
}

function randomHex(bytes = 32): string {
  const buf = new Uint8Array(bytes)
  crypto.getRandomValues(buf)
  return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('')
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405)
  }

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return json({ error: 'Unauthorized' }, 401)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  if (!supabaseUrl || !serviceRoleKey || !anonKey) {
    return json({ error: 'Server configuration error' }, 500)
  }

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
    return json({ error: 'Only admins and developers can manage integrations' }, 403)
  }

  let body: {
    action?: 'save' | 'generate_certificate' | 'test' | 'status' | 'list_items' | 'import_items'
    accountId?: string
    clientId?: string
    certificateId?: string
    // Unlike the credential fields, these are not masked, so a string (even an
    // empty one) replaces the stored value and only `undefined` keeps it.
    adjustmentAccountId?: string
    adjustmentSubsidiaryId?: string
    webhookSecret?: string
    queueRunnerSecret?: string
    enabled?: boolean
    search?: string
    limit?: number
    offset?: number
    items?: Array<{ externalId?: string; itemId?: string; displayName?: string; upcCode?: string; active?: boolean }>
  }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Invalid request body' }, 400)
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  async function loadConnection() {
    const { data, error } = await admin
      .from('integration_connections')
      .select('id, enabled, config')
      .eq('system', 'netsuite')
      .maybeSingle()
    if (error) throw new Error(error.message)
    return data
  }

  async function loadSecret(connectionId: string, type: string): Promise<string | null> {
    const { data, error } = await admin
      .from('integration_secrets')
      .select('secret_value')
      .eq('connection_id', connectionId)
      .eq('secret_type', type)
      .maybeSingle()
    if (error) throw new Error(error.message)
    return data?.secret_value ?? null
  }

  // OAuth 2.0 client credentials (M2M): the private key is a secret, while the
  // certificate, its NetSuite-assigned ID and expiry are public and live in
  // config. A client secret plays no part in this grant.
  async function loadCredentials(connection: { id: string; config: unknown }): Promise<{ creds: NetSuiteM2MCredentials; missing: string[] }> {
    const config = (connection.config ?? {}) as Record<string, unknown>
    const creds = {
      accountId: typeof config.account_id === 'string' ? config.account_id : '',
      clientId: (await loadSecret(connection.id, 'netsuite_client_id')) ?? '',
      certificateId: typeof config.certificate_id === 'string' ? config.certificate_id : '',
      privateKeyPem: (await loadSecret(connection.id, 'netsuite_private_key')) ?? '',
    }
    const missing = [
      !creds.accountId && 'Account ID',
      !creds.clientId && 'Client ID',
      !creds.privateKeyPem && 'certificate (generate one)',
      !creds.certificateId && 'Certificate ID',
    ].filter((m): m is string => Boolean(m))
    return { creds, missing }
  }

  async function runSuiteQL(accountId: string, token: string, q: string, limit: number, offset: number): Promise<Response> {
    return await fetch(`https://${netsuiteHost(accountId)}/services/rest/query/v1/suiteql?limit=${limit}&offset=${offset}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Prefer: 'transient',
      },
      body: JSON.stringify({ q }),
    })
  }

  const action = body.action ?? 'status'

  try {
    if (action === 'status') {
      const connection = await loadConnection()
      if (!connection) {
        return json({ configured: false, enabled: false, missing: [], accountIdMasked: null, clientIdMasked: null, certificateId: null, certificatePem: null, certificateExpiresAt: null, adjustmentAccountId: null, adjustmentSubsidiaryId: null, queueRunnerConfigured: false, lastTestedAt: null, lastTestOk: null })
      }
      const config = (connection.config ?? {}) as Record<string, unknown>
      const { creds, missing } = await loadCredentials(connection)
      const queueRunnerSecret = await loadSecret(connection.id, 'netsuite_queue_runner_secret')
      return json({
        configured: missing.length === 0,
        enabled: Boolean(connection.enabled),
        missing,
        accountIdMasked: maskTail(creds.accountId),
        clientIdMasked: maskTail(creds.clientId),
        certificateId: creds.certificateId || null,
        certificatePem: creds.privateKeyPem && typeof config.certificate_pem === 'string' ? config.certificate_pem : null,
        certificateExpiresAt: typeof config.certificate_expires_at === 'string' ? config.certificate_expires_at : null,
        adjustmentAccountId: typeof config.adjustment_account_id === 'string' && config.adjustment_account_id ? config.adjustment_account_id : null,
        adjustmentSubsidiaryId: typeof config.adjustment_subsidiary_id === 'string' && config.adjustment_subsidiary_id ? config.adjustment_subsidiary_id : null,
        queueRunnerConfigured: Boolean(queueRunnerSecret),
        lastTestedAt: typeof config.last_tested_at === 'string' ? config.last_tested_at : null,
        lastTestOk: typeof config.last_test_ok === 'boolean' ? config.last_test_ok : null,
      })
    }

    if (action === 'save') {
      // Blank fields keep what is stored, so saving a Certificate ID does not
      // require re-typing the Account ID and Client ID.
      const accountIdInput = (body.accountId ?? '').trim()
      const clientIdInput = (body.clientId ?? '').trim()
      const certificateIdInput = (body.certificateId ?? '').trim()
      const enabled = Boolean(body.enabled)

      const existing = await loadConnection()
      const existingConfig = (existing?.config ?? {}) as Record<string, unknown>
      const accountId = accountIdInput || (typeof existingConfig.account_id === 'string' ? existingConfig.account_id : '')
      const clientId = clientIdInput || (existing ? (await loadSecret(existing.id, 'netsuite_client_id')) ?? '' : '')
      if (!accountId || !clientId) {
        return json({ error: 'Account ID and Client ID are required' }, 400)
      }
      const nextConfig = {
        ...existingConfig,
        account_id: accountId,
        ...(certificateIdInput ? { certificate_id: certificateIdInput } : {}),
        ...(typeof body.adjustmentAccountId === 'string' ? { adjustment_account_id: body.adjustmentAccountId.trim() } : {}),
        ...(typeof body.adjustmentSubsidiaryId === 'string' ? { adjustment_subsidiary_id: body.adjustmentSubsidiaryId.trim() } : {}),
      }

      let connectionId: string
      if (existing) {
        const { error } = await admin
          .from('integration_connections')
          .update({ enabled, config: nextConfig, name: 'NetSuite' })
          .eq('id', existing.id)
        if (error) throw new Error(error.message)
        connectionId = existing.id
      } else {
        const { data, error } = await admin
          .from('integration_connections')
          .insert({ system: 'netsuite', name: 'NetSuite', enabled, config: nextConfig, created_by: caller.id })
          .select('id')
          .single()
        if (error) throw new Error(error.message)
        connectionId = data.id
      }

      if (clientIdInput) {
        const { error } = await admin.from('integration_secrets').upsert(
          { connection_id: connectionId, secret_type: 'netsuite_client_id', secret_value: clientIdInput },
          { onConflict: 'connection_id,secret_type' },
        )
        if (error) throw new Error(error.message)
      }

      // Shared secrets for the two server-to-server callers: the NetSuite
      // SuiteScript hitting netsuite-webhook, and the scheduled runner hitting
      // process-netsuite-queue. Use a caller-provided value, else preserve what
      // is stored, else generate. The plaintext is returned exactly once - on
      // generation, or when the caller set it deliberately - and is never read
      // back to the browser afterwards.
      async function ensureSharedSecret(secretType: string, provided: string | undefined): Promise<string | null> {
        let value = (provided ?? '').trim()
        let reveal: string | null = null
        const existing = await loadSecret(connectionId, secretType)
        if (!value && !existing) {
          value = randomHex(32)
          reveal = value
        }
        if (value) {
          await admin.from('integration_secrets').upsert(
            { connection_id: connectionId, secret_type: secretType, secret_value: value },
            { onConflict: 'connection_id,secret_type' },
          )
          if (provided) reveal = value
        }
        return reveal
      }

      const webhookSecretReturned = await ensureSharedSecret('netsuite_webhook_secret', body.webhookSecret)
      const queueRunnerSecretReturned = await ensureSharedSecret('netsuite_queue_runner_secret', body.queueRunnerSecret)

      return json({
        ok: true,
        accountIdMasked: maskTail(accountId),
        clientIdMasked: maskTail(clientId),
        webhookSecret: webhookSecretReturned,
        queueRunnerSecret: queueRunnerSecretReturned,
      })
    }

    if (action === 'generate_certificate') {
      const connection = await loadConnection()
      if (!connection) return json({ error: 'Save the Account ID and Client ID before generating a certificate' }, 400)

      const cert = await generateNetSuiteCertificate('Warehouse Wizard NetSuite M2M')
      const { error: keyError } = await admin.from('integration_secrets').upsert(
        { connection_id: connection.id, secret_type: 'netsuite_private_key', secret_value: cert.privateKeyPem },
        { onConflict: 'connection_id,secret_type' },
      )
      if (keyError) throw new Error(keyError.message)

      // The old Certificate ID names a certificate for the key just replaced.
      const { certificate_id: _replaced, ...config } = (connection.config ?? {}) as Record<string, unknown>
      const { error: configError } = await admin
        .from('integration_connections')
        .update({ config: { ...config, certificate_pem: cert.certificatePem, certificate_expires_at: cert.expiresAt, last_test_ok: false } })
        .eq('id', connection.id)
      if (configError) throw new Error(configError.message)

      return json({ ok: true, certificatePem: cert.certificatePem, certificateExpiresAt: cert.expiresAt })
    }

    if (action === 'test') {
      const connection = await loadConnection()
      if (!connection) return json({ ok: false, error: 'No NetSuite connection configured' })
      const { creds, missing } = await loadCredentials(connection)
      if (missing.length > 0) {
        return json({ ok: false, error: `Credentials incomplete - missing ${missing.join(', ')}` })
      }

      const tokenResult = await fetchNetSuiteAccessToken(creds)
      let ok = tokenResult.ok
      let errorMessage = tokenResult.ok ? null : tokenResult.error

      // A token only proves authentication. The item browser also needs the
      // role to run SuiteQL against items, so check that here rather than
      // letting it surface later as an empty picker.
      if (tokenResult.ok) {
        try {
          const res = await runSuiteQL(creds.accountId, tokenResult.token, 'SELECT id FROM item', 1, 0)
          if (!res.ok) {
            ok = false
            errorMessage = `Authenticated, but the SuiteQL item query failed (${res.status}): ${(await res.text()).slice(0, 300)}. Give the mapped role REST Web Services and item view permissions.`
          }
        } catch (err) {
          ok = false
          errorMessage = err instanceof Error ? err.message : String(err)
        }
      }

      const config = (connection.config ?? {}) as Record<string, unknown>
      const nextConfig = { ...config, last_tested_at: new Date().toISOString(), last_test_ok: ok }
      await admin
        .from('integration_connections')
        .update({ config: nextConfig })
        .eq('id', connection.id)

      return ok ? json({ ok: true }) : json({ ok: false, error: errorMessage ?? 'Unknown error' })
    }

    if (action === 'list_items') {
      const connection = await loadConnection()
      if (!connection) return json({ notConfigured: true, items: [], hasMore: false })
      const { creds, missing } = await loadCredentials(connection)
      if (missing.length > 0) {
        return json({ notConfigured: true, items: [], hasMore: false })
      }

      const tokenResult = await fetchNetSuiteAccessToken(creds)
      if (!tokenResult.ok) {
        return json({ error: tokenResult.error }, 502)
      }

      const rawLimit = typeof body.limit === 'number' ? Math.floor(body.limit) : 50
      const limit = Math.max(1, Math.min(rawLimit, 100))
      const rawOffset = typeof body.offset === 'number' ? Math.floor(body.offset) : 0
      const offset = Math.max(0, rawOffset)
      const search = typeof body.search === 'string' ? body.search.trim() : ''
      // Escape single quotes for SuiteQL string literal; strip other risky chars.
      const safeSearch = search.replace(/'/g, "''").replace(/[;\\]/g, '')
      const where = safeSearch
        ? `WHERE isinactive = 'F' AND (UPPER(itemid) LIKE UPPER('%${safeSearch}%') OR UPPER(displayname) LIKE UPPER('%${safeSearch}%'))`
        : `WHERE isinactive = 'F'`
      const q = `SELECT id, itemid, displayname, upccode, isinactive FROM item ${where} ORDER BY itemid`

      let suiteqlRes: Response
      try {
        suiteqlRes = await runSuiteQL(creds.accountId, tokenResult.token, q, limit, offset)
      } catch (err) {
        return json({ error: err instanceof Error ? err.message : String(err) }, 502)
      }
      if (!suiteqlRes.ok) {
        const text = await suiteqlRes.text()
        return json({ error: `NetSuite SuiteQL ${suiteqlRes.status}: ${text.slice(0, 300)}` }, 502)
      }
      const payload = await suiteqlRes.json().catch(() => null) as {
        items?: Array<{ id?: string; itemid?: string; displayname?: string; upccode?: string; isinactive?: string }>
        hasMore?: boolean
      } | null
      const rows = payload?.items ?? []
      const externalIds = rows.map((r) => String(r.id ?? '')).filter(Boolean)

      let linkedIds = new Set<string>()
      if (externalIds.length > 0) {
        const { data: links, error: linksError } = await admin
          .from('external_record_links')
          .select('external_id')
          .eq('system', 'netsuite')
          .eq('local_table', 'products')
          .eq('external_record_type', 'item')
          .in('external_id', externalIds)
        if (linksError) throw new Error(linksError.message)
        linkedIds = new Set((links ?? []).map((l: any) => String(l.external_id)))
      }

      const items = rows.map((r) => ({
        externalId: String(r.id ?? ''),
        itemId: r.itemid ?? '',
        displayName: r.displayname ?? '',
        upcCode: r.upccode ?? '',
        active: (r.isinactive ?? 'F') !== 'T',
        alreadyImported: linkedIds.has(String(r.id ?? '')),
      }))
      return json({ items, hasMore: Boolean(payload?.hasMore), limit, offset })
    }

    if (action === 'import_items') {
      const items = Array.isArray(body.items) ? body.items : []
      if (items.length === 0) {
        return json({ error: 'No items provided' }, 400)
      }
      if (items.length > 100) {
        return json({ error: 'Import at most 100 items at a time' }, 400)
      }

      // Deliberately does NOT re-query NetSuite for each item — uses the
      // fields already returned by list_items (id, itemId, displayName,
      // upcCode, active) that the picker UI selected from. This avoids a
      // second NetSuite round-trip and any risk of guessing at custom field
      // internal IDs (custitem_temperature_class etc.) that vary per
      // NetSuite account; mapNetSuiteItemToProduct already degrades
      // gracefully to keyword categorisation when those aren't present.
      const results: Array<{ externalId: string; ok: boolean; sku?: string; error?: string }> = []

      for (const item of items) {
        const externalId = (item.externalId ?? '').trim()
        const itemId = (item.itemId ?? '').trim()
        if (!externalId || !itemId) {
          results.push({ externalId: externalId || '(missing)', ok: false, error: 'Missing externalId or itemId' })
          continue
        }
        try {
          const payload: NetSuiteItemPayload = {
            id: externalId,
            itemId,
            displayName: item.displayName || undefined,
            upcCode: item.upcCode || undefined,
            isInactive: item.active === false,
          }
          const mapped = mapNetSuiteItemToProduct(payload)
          await upsertProductFromNetSuiteItem(admin, mapped, externalId)
          results.push({ externalId, ok: true, sku: mapped.sku })
        } catch (err) {
          results.push({ externalId, ok: false, error: err instanceof Error ? err.message : String(err) })
        }
      }

      const succeeded = results.filter((r) => r.ok).length
      return json({ ok: true, succeeded, failed: results.length - succeeded, results })
    }

    return json({ error: 'Unknown action' }, 400)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('netsuite-connection error', message)
    return json({ error: message }, 500)
  }
})