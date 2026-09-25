// eslint-disable-next-line @typescript-eslint/ban-ts-comment -- @ts-expect-error would be flagged as unused under Deno, which allows .ts imports.
// @ts-ignore Deno requires the source extension; Vitest resolves it during transform.
import { payloadDigest } from './netsuite.ts'

/**
 * The only job type the current NetSuite worker is allowed to claim. Inbound
 * records deliberately share the job table but remain queued until their own
 * processors exist.
 */
export const NETSUITE_OUTBOUND_JOB_TYPES = ['inventory_adjustment'] as const

export type NetSuiteWebhookEnvelope = {
  recordType: string
  externalId: string
  action?: string
  payload?: Record<string, unknown>
  lastModified?: string | number
}

type SyncJobRow = { id: string } | null
type SyncJobError = { code?: string; message?: string } | null

/**
 * The small database boundary needed by the webhook's idempotent enqueue.
 * Keeping it independent of Supabase lets the smoke harness run entirely in
 * memory while the edge function still supplies the production adapter.
 */
export type NetSuiteWebhookJobRepository = {
  insert(input: {
    connectionId: string
    jobType: string
    idempotencyKey: string
    payload: Record<string, unknown>
  }): Promise<{ data: SyncJobRow; error: SyncJobError }>
  findByIdempotencyKey(input: {
    connectionId: string
    idempotencyKey: string
  }): Promise<SyncJobRow>
}

export async function netSuiteWebhookIdempotencyKey(body: NetSuiteWebhookEnvelope): Promise<string> {
  const recordType = String(body.recordType ?? '').toLowerCase().trim()
  const externalId = String(body.externalId ?? '').trim()
  const payload = body.payload ?? {}
  const lastModifiedKey = body.lastModified
    ?? payload.lastModified
    ?? `sha256-${await payloadDigest(body)}`
  return `${recordType}:${externalId}:${lastModifiedKey}`
}

/**
 * Insert an inbound delivery once. A unique-constraint collision is the
 * normal NetSuite redelivery path, never a second product/order operation.
 */
export async function enqueueNetSuiteWebhookDelivery(
  repository: NetSuiteWebhookJobRepository,
  input: {
    connectionId: string
    body: NetSuiteWebhookEnvelope
  },
): Promise<{ jobId: string | null; duplicate: boolean; idempotencyKey: string }> {
  const idempotencyKey = await netSuiteWebhookIdempotencyKey(input.body)
  const { data, error } = await repository.insert({
    connectionId: input.connectionId,
    jobType: input.body.recordType.toLowerCase().trim(),
    idempotencyKey,
    payload: input.body as Record<string, unknown>,
  })

  if (!error) {
    return { jobId: data?.id ?? null, duplicate: false, idempotencyKey }
  }
  if (error.code !== '23505') {
    throw new Error(error.message ?? 'Failed to record sync job')
  }

  const existing = await repository.findByIdempotencyKey({
    connectionId: input.connectionId,
    idempotencyKey,
  })
  return { jobId: existing?.id ?? null, duplicate: true, idempotencyKey }
}

/** Build the exact filtered RPC argument used by the outbound worker. */
export function netSuiteOutboundClaimArgs(connectionId: string, limit: number) {
  return {
    p_connection_id: connectionId,
    p_limit: limit,
    p_job_types: [...NETSUITE_OUTBOUND_JOB_TYPES],
  }
}
