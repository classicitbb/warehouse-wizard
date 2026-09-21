import { createClient } from 'npm:@supabase/supabase-js@2'
import { buildNetSuiteInventoryAdjustment, netsuiteAdjustmentExternalId, netsuiteHost, timingSafeEqual } from '../_shared/netsuite.ts'
import { fetchNetSuiteAccessToken } from '../_shared/netsuite-auth.ts'
import { netSuiteOutboundClaimArgs } from '../_shared/netsuite-queue.ts'

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
  const privateKeyPem = secretMap.get('netsuite_private_key') ?? ''
  const certificateId = typeof config.certificate_id === 'string' ? config.certificate_id : ''

  if (!accountId || !clientId || !privateKeyPem || !certificateId) {
    return new Response(
      JSON.stringify({ skipped: true, reason: 'credentials_incomplete' }),
      { headers: { 'Content-Type': 'application/json' } },
    )
  }

  // The adjustment account is mandatory on the NetSuite record. Without it every
  // job would fail and dead-letter, so leave the queue untouched until an admin
  // sets it in Settings > Integrations.
  const adjustmentAccountId = typeof config.adjustment_account_id === 'string' ? config.adjustment_account_id.trim() : ''
  const adjustmentSubsidiaryId = typeof config.adjustment_subsidiary_id === 'string' ? config.adjustment_subsidiary_id.trim() : ''
  if (!adjustmentAccountId) {
    return new Response(
      JSON.stringify({ skipped: true, reason: 'adjustment_account_not_configured' }),
      { headers: { 'Content-Type': 'application/json' } },
    )
  }

  // 3. Exchange a signed client assertion for a short-lived OAuth2 token (kept in-memory only).
  const tokenResult = await fetchNetSuiteAccessToken({ accountId, clientId, certificateId, privateKeyPem })
  if (!tokenResult.ok) {
    console.error('NetSuite token exchange failed', tokenResult.error)
    return new Response(JSON.stringify({ error: tokenResult.error }), {
      status: 502, headers: { 'Content-Type': 'application/json' },
    })
  }
  const accessToken = tokenResult.token

  // 4. Claim a batch atomically (flips queued -> running with FOR UPDATE SKIP LOCKED).
  const { data: claimed, error: claimErr } = await supabase.rpc(
    'claim_integration_sync_jobs',
    netSuiteOutboundClaimArgs(connection.id, BATCH_SIZE),
  )
  if (claimErr) {
    console.error('Failed to claim NetSuite jobs', claimErr)
    return new Response(JSON.stringify({ error: claimErr.message }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    })
  }
  const jobs: SyncJob[] = (claimed as SyncJob[] | null) ?? []

  const recordUrl = `https://${netsuiteHost(accountId)}/services/rest/record/v1/inventoryAdjustment`

  // Jobs enqueued before migration 20260916120000 carry only the SKU, so the
  // item's internal id is resolved from the same link the trigger checked.
  async function resolveItemIdBySku(sku: string): Promise<string | null> {
    const { data: product } = await supabase.from('products').select('id').eq('sku', sku).maybeSingle()
    if (!product?.id) return null
    const { data: link } = await supabase
      .from('external_record_links')
      .select('external_id')
      .eq('system', 'netsuite')
      .eq('local_table', 'products')
      .eq('local_id', product.id)
      .eq('external_record_type', 'item')
      .maybeSingle()
    return link?.external_id ?? null
  }

  // Internal id of an adjustment already created with this externalId, or null.
  async function findExistingAdjustment(externalId: string): Promise<string | null> {
    try {
      const res = await fetch(`${recordUrl}/eid:${externalId}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      })
      if (!res.ok) return null
      const record = await res.json().catch(() => null) as { id?: string | number } | null
      return record?.id != null ? String(record.id) : null
    } catch {
      return null
    }
  }

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
          netsuiteItemId?: string
          netsuiteLocationId?: string
          locationExternalId?: string // pre-20260916120000 name; it held the internal id
          quantityDelta?: number
          memo?: string
        }
        const itemId = p.netsuiteItemId ?? (p.sku ? await resolveItemIdBySku(p.sku) : null)
        const locationId = p.netsuiteLocationId ?? p.locationExternalId
        if (!itemId || !locationId || typeof p.quantityDelta !== 'number') {
          failureReason = itemId
            ? 'Invalid inventory_adjustment payload'
            : `No NetSuite item link for SKU ${p.sku ?? '(missing)'}`
        } else {
          const externalId = netsuiteAdjustmentExternalId(job.idempotency_key)
          requestBody = buildNetSuiteInventoryAdjustment({
            externalId,
            adjustmentAccountId,
            subsidiaryId: adjustmentSubsidiaryId || null,
            itemId,
            locationId,
            quantityDelta: p.quantityDelta,
            memo: p.memo ?? '',
          }) as unknown as Record<string, unknown>

          try {
            const res = await fetch(recordUrl, {
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
              // A create answers 204 with the new record's URL in Location.
              const location = res.headers.get('Location')
              ok = true
              responsePayload = { netsuiteId: location?.split('/').pop() ?? null, location }
            } else {
              failureReason = `NetSuite responded ${res.status}: ${text.slice(0, 200)}`
            }
          } catch (err) {
            failureReason = err instanceof Error ? err.message : String(err)
          }

          // A timed-out attempt, or a run that crashed before recording its
          // result, may already have created the record. NetSuite then refuses
          // the duplicate externalId, so treat an existing record as success.
          if (!ok) {
            const existingId = await findExistingAdjustment(externalId)
            if (existingId) {
              ok = true
              responsePayload = { netsuiteId: existingId, alreadyPosted: true, postError: failureReason }
            }
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
