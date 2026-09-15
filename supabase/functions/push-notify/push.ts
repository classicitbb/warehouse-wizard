// Web Push send + prune layer.
//
// Isolated from index.ts on purpose: the VAPID/encryption library is the one
// part of this feature that depends on what the Supabase Edge Runtime happens
// to support. If npm:web-push ever fails to bundle or throws inside
// createECDH/createCipheriv, swap sendOne() for jsr:@negrel/webpush plus a
// base64url -> JWK shim and nothing outside this file changes.

import webpush from 'npm:web-push@3.6.7'

export type PushSubscriptionRow = {
  id: string
  endpoint: string
  p256dh: string
  auth: string
  failure_count: number
}

export type PushResult = {
  endpoint: string
  /** Delivered. */
  ok: boolean
  /** The endpoint is permanently gone and the row must be deleted. */
  gone: boolean
  status: number | null
  error: string | null
}

let configured = false

/** Throws if the VAPID secrets are missing, so the caller can report it once. */
export function configureVapid() {
  if (configured) return
  const publicKey = Deno.env.get('VAPID_PUBLIC_KEY')
  const privateKey = Deno.env.get('VAPID_PRIVATE_KEY')
  const subject = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:wms@simplextrading.net'
  if (!publicKey || !privateKey) {
    throw new Error('VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY must be set')
  }
  webpush.setVapidDetails(subject, publicKey, privateKey)
  configured = true
}

async function sendOne(sub: PushSubscriptionRow, payload: string): Promise<PushResult> {
  try {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      payload,
      { TTL: 60 * 60 },
    )
    return { endpoint: sub.endpoint, ok: true, gone: false, status: 201, error: null }
  } catch (error) {
    const status = (error as { statusCode?: number }).statusCode ?? null
    const message = error instanceof Error ? error.message : String(error)
    // 404/410 mean the push service has permanently dropped this endpoint —
    // the only statuses that justify deleting a row. Notably 400 does NOT:
    // that is a malformed-VAPID/config error, and pruning on it would wipe
    // every subscription the first time a key was set wrong.
    return {
      endpoint: sub.endpoint,
      ok: false,
      gone: status === 404 || status === 410,
      status,
      error: message.slice(0, 1000),
    }
  }
}

/**
 * Fan out to every subscription in bounded concurrency.
 *
 * Chunked rather than one big Promise.all: edge functions have a wall-clock
 * budget and a whole-fleet fan-out of unbounded fetches will trip it. Uses
 * allSettled semantics throughout so one dead endpoint cannot abort the batch.
 */
export async function sendToAll(
  subs: PushSubscriptionRow[],
  payload: string,
  chunkSize = 10,
): Promise<PushResult[]> {
  const results: PushResult[] = []
  for (let i = 0; i < subs.length; i += chunkSize) {
    const chunk = subs.slice(i, i + chunkSize)
    const settled = await Promise.allSettled(chunk.map((s) => sendOne(s, payload)))
    settled.forEach((outcome, index) => {
      if (outcome.status === 'fulfilled') {
        results.push(outcome.value)
      } else {
        results.push({
          endpoint: chunk[index].endpoint,
          ok: false,
          gone: false,
          status: null,
          error: String(outcome.reason).slice(0, 1000),
        })
      }
    })
  }
  return results
}

/** Push payloads are size-capped by the spec; keep well under it. */
export function clampPayload(value: Record<string, unknown>, maxBytes = 2000): string {
  let json = JSON.stringify(value)
  if (new TextEncoder().encode(json).length <= maxBytes) return json
  const trimmed = { ...value, body: String(value.body ?? '').slice(0, 120) }
  json = JSON.stringify(trimmed)
  return json
}
