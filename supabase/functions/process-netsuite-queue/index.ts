import { createClient } from 'npm:@supabase/supabase-js@2'
import { buildNetSuiteInventoryAdjustment, netsuiteHost, timingSafeEqual } from '../_shared/netsuite.ts'

// Mirrors process-email-queue: service-role JWT gate, batch claim with a
// visibility-timeout-style "running" flip via claim_integration_sync_jobs
// (SELECT ... FOR UPDATE SKIP LOCKED under the hood), MAX_RETRIES=5 before
// dead-letter, log every attempt to integration_payload_logs.
const MAX_RETRIES = 5
const BATCH_SIZE = 20

// Job types this worker knows how to push to NetSuite. Inbound record types
// (purchase_order, sales_order, transfer_order, fulfillment, inventory) also
// sit in integration_sync_jobs as 'queued', parked by netsuite-webhook for
// processors that do not exist yet. Claiming them here would run them through
// the isPermanent branch below and dead-letter them permanently, so the claim
// is filtered to the types that actually have an outbound implementation.
const OUTBOUND_JOB_TYPES = ['inventory_adjustment']

function parseJwtClaims(token: string): Record<string, unknown> | null {
  const parts = token.split('.')
  if (parts.length < 2) return null
  try {
    const payload = parts[1]
      .replaceAll('-', '+')
      .replaceAll('_', '/')
      .padEnd(Math.ceil(parts[1].length / 4) * 4, '=')
    return JSON.parse(atob(payload)) as Record<string, unknown>
  } catch {
    return null
  }
}

type SyncJob = {
  id: string
  connection_id: string | null
  job_type: string
  status: string
  idempotency_key: string
  payload: Record<string, unknown>
  attempts: number
}

Deno.serve(async (req) => {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceRoleKey) {
    console.error('Missing required environment variables')
    return new Response(JSON.stringify({ error: 'Server configuration error' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    })
  }

  // Two credentials are accepted:
  //   1. a service_role JWT, for manual or administrative invocation
  //   2. the scoped 'netsuite_queue_runner_secret' in X-Queue-Secret, used by
  //      .github/workflows/netsuite-queue.yml so the scheduler never has to
  //      hold the service-role key
  // The runner secret hangs off the connection row, so that half of the check
  // has to wait until the connection is loaded below.
  const authHeader = req.headers.get('Authorization')
  const bearer = authHeader?.startsWith('Bearer ') ? authHeader.slice('Bearer '.length).trim() : ''
  const hasServiceRoleJwt = bearer ? parseJwtClaims(bearer)?.role === 'service_role' : false
  const providedQueueSecret = req.headers.get('x-queue-secret') ?? ''

  if (!hasServiceRoleJwt && !providedQueueSecret) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { 'Content-Type': 'application/json' },
    })
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey)

  // 1. Load the enabled NetSuite connection. No-op if none.
  const { data: connection, error: connErr } = await supabase
    .from('integration_connections')
    .select('id, enabled, config')
    .eq('system', 'netsuite')
    .eq('enabled', true)
    .maybeSingle()

  if (connErr) {
    console.error('Failed to load NetSuite connection', connErr)
    return new Response(JSON.stringify({ error: connErr.message }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    })
  }
  if (!connection) {
    // With no connection there is no runner secret to compare against, so a
    // caller holding only a secret must not learn from this response whether
    // the connection is merely absent or their secret is wrong.
    if (!hasServiceRoleJwt) {
      return new Response(JSON.stringify({ error: 'Forbidden' }), {
        status: 403, headers: { 'Content-Type': 'application/json' },
      })
    }
    return new Response(JSON.stringify({ skipped: true, reason: 'no_netsuite_connection' }), {
      headers: { 'Content-Type': 'application/json' },
    })
  }

  if (!hasServiceRoleJwt) {
    const { data: runnerSecretRow } = await supabase
      .from('integration_secrets')
      .select('secret_value')
      .eq('connection_id', connection.id)
      .eq('secret_type', 'netsuite_queue_runner_secret')
      .maybeSingle()
    const expectedQueueSecret = runnerSecretRow?.secret_value ?? ''
    if (!expectedQueueSecret || !timingSafeEqual(providedQueueSecret, expectedQueueSecret)) {
      return new Response(JSON.stringify({ error: 'Forbidden' }), {
        status: 403, headers: { 'Content-Type': 'application/json' },
      })
    }
  }

  // Reclaim any jobs stuck in 'running' from a crashed prior run. Deliberately
  // after authorization - it mutates rows.
  await supabase.rpc('reclaim_stale_integration_sync_jobs')

  const config = (connection.config ?? {}) as Record<string, unknown>
  const accountId = typeof config.account_id === 'string' ? config.account_id : ''

  // 2. Load credentials via service role.
  const { data: secrets, error: secretsErr } = await supabase
    .from('integration_secrets')
    .select('secret_type, secret_value')
    .eq('connection_id', connection.id)

  if (secretsErr) {
    console.error('Failed to load NetSuite secrets', secretsErr)
    return new Response(JSON.stringify({ error: secretsErr.message }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    })
  }
  const secretMap = new Map((secrets ?? []).map((s) => [s.secret_type, s.secret_value]))
  const clientId = secretMap.get('netsuite_client_id') ?? ''
  const clientSecret = secretMap.get('netsuite_client_secret') ?? ''

  if (!accountId || !clientId || !clientSecret) {
    return new Response(
      JSON.stringify({ skipped: true, reason: 'credentials_incomplete' }),
      { headers: { 'Content-Type': 'application/json' } },
    )
  }

  // 3. Exchange for a short-lived OAuth2 token (kept in-memory only).
  const tokenUrl = `https://${netsuiteHost(accountId)}/services/rest/auth/oauth2/v1/token`
  const basic = btoa(`${clientId}:${clientSecret}`)
  let accessToken = ''
  try {
    const tokenRes = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    })
    if (!tokenRes.ok) {
      const text = await tokenRes.text()
      console.error('NetSuite token exchange failed', tokenRes.status, text.slice(0, 200))
      return new Response(
        JSON.stringify({ error: `Token exchange failed (${tokenRes.status})` }),
        { status: 502, headers: { 'Content-Type': 'application/json' } },
      )
    }
    const tokenPayload = await tokenRes.json()
    accessToken = String(tokenPayload?.access_token ?? '')
    if (!accessToken) {
      return new Response(JSON.stringify({ error: 'No access_token in NetSuite response' }), {
        status: 502, headers: { 'Content-Type': 'application/json' },
      })
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('NetSuite token exchange error', message)
    return new Response(JSON.stringify({ error: message }), {
      status: 502, headers: { 'Content-Type': 'application/json' },
    })
  }

  // 4. Claim a batch atomically (flips queued -> running with FOR UPDATE SKIP LOCKED).
  const { data: claimed, error: claimErr } = await supabase.rpc('claim_integration_sync_jobs', {
    p_connection_id: connection.id,
    p_limit: BATCH_SIZE,
    p_job_types: OUTBOUND_JOB_TYPES,
  })
  if (claimErr) {
    console.error('Failed to claim NetSuite jobs', claimErr)
    return new Response(JSON.stringify({ error: claimErr.message }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    })
  }
  const jobs: SyncJob[] = (claimed as SyncJob[] | null) ?? []

  let succeeded = 0
  let failed = 0
  let deadLettered = 0

  for (const job of jobs) {
    const nextAttempts = (job.attempts ?? 0) + 1
    let requestBody: Record<string, unknown> | null = null
    let httpStatus: number | null = null
    let responsePayload: unknown = null
    let ok = false
    let failureReason: string | null = null

    try {
      if (job.job_type === 'inventory_adjustment') {
        const p = job.payload as {
          sku?: string
          locationExternalId?: string
          quantityDelta?: number
          memo?: string
        }
        if (!p.sku || !p.locationExternalId || typeof p.quantityDelta !== 'number') {
          failureReason = 'Invalid inventory_adjustment payload'
        } else {
          requestBody = buildNetSuiteInventoryAdjustment({
            accountId,
            sku: p.sku,
            locationExternalId: p.locationExternalId,
            quantityDelta: p.quantityDelta,
            memo: p.memo ?? '',
          }) as unknown as Record<string, unknown>

          const url = `https://${netsuiteHost(accountId)}/services/rest/record/v1/inventoryAdjustment`
          const res = await fetch(url, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(requestBody),
          })
          httpStatus = res.status
          const text = await res.text()
          try { responsePayload = text ? JSON.parse(text) : null } catch { responsePayload = { raw: text.slice(0, 4000) } }
          if (res.ok) {
            ok = true
          } else {
            failureReason = `NetSuite responded ${res.status}: ${text.slice(0, 200)}`
          }
        }
      } else {
        failureReason = `Unsupported job_type for outbound sync: ${job.job_type}`
      }
    } catch (err) {
      failureReason = err instanceof Error ? err.message : String(err)
    }

    // Log the attempt regardless of outcome.
    await supabase.from('integration_payload_logs').insert({
      sync_job_id: job.id,
      direction: 'outbound',
      payload: (requestBody ?? job.payload) as unknown,
      response: responsePayload as unknown,
      http_status: httpStatus,
    })

    if (ok) {
      await supabase
        .from('integration_sync_jobs')
        .update({
          status: 'succeeded',
          attempts: nextAttempts,
          result: (responsePayload ?? null) as unknown,
          error_message: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', job.id)
      succeeded++
      continue
    }

    // Unsupported job types never retry — go straight to dead_letter.
    const isPermanent = job.job_type !== 'inventory_adjustment'

    if (isPermanent || nextAttempts >= MAX_RETRIES) {
      const reason = failureReason ?? 'Unknown error'
      await supabase.from('integration_dead_letters').insert({
        sync_job_id: job.id,
        reason,
        payload: (job.payload ?? {}) as unknown,
      })
      await supabase
        .from('integration_sync_jobs')
        .update({
          status: 'dead_letter',
          attempts: nextAttempts,
          error_message: reason,
          updated_at: new Date().toISOString(),
        })
        .eq('id', job.id)
      deadLettered++
    } else {
      // Retry: return to 'queued' for the next cron tick (mirrors PGMQ's VT-expiry retry).
      await supabase
        .from('integration_sync_jobs')
        .update({
          status: 'queued',
          attempts: nextAttempts,
          error_message: failureReason,
          updated_at: new Date().toISOString(),
        })
        .eq('id', job.id)
      failed++
    }
  }

  return new Response(
    JSON.stringify({ processed: jobs.length, succeeded, failed, deadLettered }),
    { headers: { 'Content-Type': 'application/json' } },
  )
})