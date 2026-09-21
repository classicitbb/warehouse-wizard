// Inbound NetSuite webhook receiver.
// Called server-to-server by a NetSuite SuiteScript (User Event or Scheduled
// script) — NOT from a browser. Authenticates via the shared
// `netsuite_webhook_secret` from `integration_secrets`, using an
// `X-Webhook-Secret` header. There is no Supabase JWT in play.
//
// Expected request body (JSON):
//   {
//     "recordType": "item" | "purchase_order" | "sales_order"
//                 | "transfer_order" | "fulfillment" | "inventory",
//     "externalId": string,          // NetSuite internal id or externalId
//     "action":     "create" | "update" | "delete",   // optional, informational
//     "payload":    { ... }          // record-shaped body (see mapNetSuiteItemToProduct
//                                    //   for the "item" shape we consume today)
//     "lastModified": string | number // optional, but send it: it is folded
//                                    //   into the idempotency key, and without it
//                                    //   we fall back to hashing the body
//   }
//
// Response: { received: true, jobId, recordType, processed: boolean }
// `processed` is true only for the fully-wired `item` flow. Other record
// types are logged + queued for a future processor and return processed=false.

import { createClient } from 'npm:@supabase/supabase-js@2'
import { mapNetSuiteItemToProduct, timingSafeEqual, upsertProductFromNetSuiteItem, type NetSuiteItemPayload } from '../_shared/netsuite.ts'
import { enqueueNetSuiteWebhookDelivery, type NetSuiteWebhookEnvelope } from '../_shared/netsuite-queue.ts'

const SUPPORTED_RECORD_TYPES = new Set([
  'item',
  'purchase_order',
  'sales_order',
  'transfer_order',
  'fulfillment',
  'inventory',
])

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceRoleKey) {
    return json({ error: 'Server configuration error' }, 500)
  }

  const service = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  })

  // ── 1. Load the enabled NetSuite connection ──────────────────────────────
  const { data: connection, error: connErr } = await service
    .from('integration_connections')
    .select('id, enabled')
    .eq('system', 'netsuite')
    .eq('enabled', true)
    .maybeSingle()

  if (connErr || !connection) {
    return json({ error: 'Unauthorized' }, 401)
  }

  // ── 2. Verify the shared webhook secret (constant-time) ──────────────────
  const providedSecret = req.headers.get('x-webhook-secret') ?? ''
  const { data: secretRow } = await service
    .from('integration_secrets')
    .select('secret_value')
    .eq('connection_id', connection.id)
    .eq('secret_type', 'netsuite_webhook_secret')
    .maybeSingle()

  const expectedSecret = secretRow?.secret_value ?? ''
  if (!expectedSecret || !providedSecret || !timingSafeEqual(providedSecret, expectedSecret)) {
    return json({ error: 'Unauthorized' }, 401)
  }

  // ── 3. Parse body ────────────────────────────────────────────────────────
  let body: {
    recordType?: string
    externalId?: string
    action?: string
    payload?: Record<string, unknown>
    lastModified?: string | number
  }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Invalid JSON body' }, 400)
  }

  const recordType = String(body.recordType ?? '').toLowerCase().trim()
  const externalId = String(body.externalId ?? '').trim()
  const payload = (body.payload ?? {}) as Record<string, unknown>

  if (!recordType || !SUPPORTED_RECORD_TYPES.has(recordType)) {
    return json({ error: `Unsupported recordType: ${recordType || '(missing)'}` }, 400)
  }
  if (!externalId) {
    return json({ error: 'externalId is required' }, 400)
  }

  // The fallback is a digest of the body, never a timestamp. NetSuite retries a
  // failed delivery with the *same* body, so a Date.now() fallback made every
  // redelivery a fresh idempotency key and defeated the unique constraint that
  // this whole design rests on.
  // ── 4. Insert sync job (idempotent on connection_id + idempotency_key) ───
  let delivery: Awaited<ReturnType<typeof enqueueNetSuiteWebhookDelivery>>
  try {
    delivery = await enqueueNetSuiteWebhookDelivery({
      async insert(input) {
        const { data, error } = await service
          .from('integration_sync_jobs')
          .insert({
            connection_id: input.connectionId,
            job_type: input.jobType,
            status: 'queued',
            idempotency_key: input.idempotencyKey,
            payload: input.payload,
          })
          .select('id')
          .maybeSingle()
        return { data, error }
      },
      async findByIdempotencyKey(input) {
        const { data } = await service
          .from('integration_sync_jobs')
          .select('id')
          .eq('connection_id', input.connectionId)
          .eq('idempotency_key', input.idempotencyKey)
          .maybeSingle()
        return data
      },
    }, {
      connectionId: connection.id,
      body: body as NetSuiteWebhookEnvelope,
    })
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    return json({ error: 'Failed to record sync job', detail }, 500)
  }

  const jobId = delivery.jobId

  // Always log the raw inbound payload, even on redelivery — useful for
  // debugging NetSuite-side retries.
  await service.from('integration_payload_logs').insert({
    sync_job_id: jobId,
    direction: 'inbound',
    payload: body as unknown as Record<string, unknown>,
    http_status: 200,
  })

  // Redelivery: return 200 without re-processing.
  if (delivery.duplicate) {
    return json({ received: true, jobId, recordType, processed: false, duplicate: true })
  }

  // ── 5. Branch on record type ─────────────────────────────────────────────
  let processed = false

  if (recordType === 'item') {
    try {
      const mapped = mapNetSuiteItemToProduct(payload as unknown as NetSuiteItemPayload)
      const { localProductId } = await upsertProductFromNetSuiteItem(service, mapped, externalId)

      await service
        .from('integration_sync_jobs')
        .update({
          status: 'succeeded',
          result: { mapped, local_product_id: localProductId } as unknown as Record<string, unknown>,
          updated_at: new Date().toISOString(),
        })
        .eq('id', jobId!)

      processed = true
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      await service
        .from('integration_sync_jobs')
        .update({
          status: 'failed',
          error_message: message,
          attempts: 1,
          updated_at: new Date().toISOString(),
        })
        .eq('id', jobId!)
      // Still return 200 so NetSuite doesn't retry-storm; the failure is
      // captured in the sync job for later review.
      return json({ received: true, jobId, recordType, processed: false, error: message })
    }
  }
  // else: purchase_order | sales_order | transfer_order | fulfillment | inventory
  // → leave status='queued', wait for a future processor. Already logged above.

  return json({ received: true, jobId, recordType, processed })
})
