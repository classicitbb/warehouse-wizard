// Small NetSuite REST client shared by the on-demand functions. It loads the
// enabled connection, authenticates with the M2M client assertion, and wraps the
// two calls the lookup needs (SuiteQL and GET record).
//
// `netsuite-connection` still carries its own copies of the credential loading
// and SuiteQL helper; it was left alone so the admin screen keeps working
// while this is proven. Move it onto this module once W2 is accepted.

import { netsuiteHost } from './netsuite.ts'
import { fetchNetSuiteAccessToken, type NetSuiteScope } from './netsuite-auth.ts'
import { buildRestletUrl, resolveRestletTarget, type RestletTarget } from './netsuite-restlet.ts'

export type NetSuiteSession = { accountId: string; token: string; restlet: RestletTarget }

export type NetSuiteSessionResult =
  | { ok: true; session: NetSuiteSession }
  | { ok: false; reason: 'not_configured' | 'disabled' | 'incomplete' | 'auth_failed'; message: string }

// deno-lint-ignore no-explicit-any
type ServiceClient = any

export class NetSuiteHttpError extends Error {
  status: number
  /** NetSuite throttles per account. A 429 (or a concurrency error) is worth retrying shortly. */
  retryable: boolean
  constructor(status: number, body: string) {
    super(`NetSuite ${status}: ${body.slice(0, 300)}`)
    this.status = status
    this.retryable = status === 429 || /CONCURRENCY_LIMIT_EXCEEDED/i.test(body)
  }
}

async function loadSecret(admin: ServiceClient, connectionId: string, type: string): Promise<string | null> {
  const { data, error } = await admin
    .from('integration_secrets')
    .select('secret_value')
    .eq('connection_id', connectionId)
    .eq('secret_type', type)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data?.secret_value ?? null
}

/**
 * Loads the NetSuite connection and exchanges the certificate for an access
 * token. Pass `restlets` in `scopes` for calls to a RESTlet: a token only
 * carries the scopes it was asked for.
 */
export async function openNetSuiteSession(
  admin: ServiceClient,
  scopes?: NetSuiteScope[],
): Promise<NetSuiteSessionResult> {
  const { data: connection, error } = await admin
    .from('integration_connections')
    .select('id, enabled, config')
    .eq('system', 'netsuite')
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!connection) return { ok: false, reason: 'not_configured', message: 'NetSuite is not configured' }
  if (!connection.enabled) return { ok: false, reason: 'disabled', message: 'The NetSuite connection is disabled' }

  const config = (connection.config ?? {}) as Record<string, unknown>
  const creds = {
    accountId: typeof config.account_id === 'string' ? config.account_id : '',
    clientId: (await loadSecret(admin, connection.id, 'netsuite_client_id')) ?? '',
    certificateId: typeof config.certificate_id === 'string' ? config.certificate_id : '',
    privateKeyPem: (await loadSecret(admin, connection.id, 'netsuite_private_key')) ?? '',
  }
  if (!creds.accountId || !creds.clientId || !creds.certificateId || !creds.privateKeyPem) {
    return { ok: false, reason: 'incomplete', message: 'NetSuite credentials are incomplete' }
  }

  const tokenResult = await fetchNetSuiteAccessToken(creds, scopes)
  if (!tokenResult.ok) return { ok: false, reason: 'auth_failed', message: tokenResult.error }
  return {
    ok: true,
    session: { accountId: creds.accountId, token: tokenResult.token, restlet: resolveRestletTarget(config) },
  }
}

async function readOrThrow(res: Response): Promise<unknown> {
  if (!res.ok) throw new NetSuiteHttpError(res.status, await res.text())
  return await res.json()
}

export async function netsuiteSuiteQL<T = Record<string, unknown>>(
  session: NetSuiteSession,
  q: string,
  limit = 100,
  offset = 0,
): Promise<T[]> {
  const res = await fetch(
    `https://${netsuiteHost(session.accountId)}/services/rest/query/v1/suiteql?limit=${limit}&offset=${offset}`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.token}`, 'Content-Type': 'application/json', Prefer: 'transient' },
      body: JSON.stringify({ q }),
    },
  )
  const payload = (await readOrThrow(res)) as { items?: T[] }
  return payload.items ?? []
}

export async function netsuiteGetRecord(
  session: NetSuiteSession,
  recordType: string,
  internalId: string,
): Promise<unknown> {
  const res = await fetch(
    `https://${netsuiteHost(session.accountId)}/services/rest/record/v1/${recordType}/${encodeURIComponent(internalId)}?expandSubResources=true`,
    { headers: { Authorization: `Bearer ${session.token}`, Accept: 'application/json' } },
  )
  return await readOrThrow(res)
}

/** Read-only GET against the inbound shipment RESTlet. The session must have been opened with the `restlets` scope. */
export async function netsuiteRestletGet(
  session: NetSuiteSession,
  params: Record<string, string>,
): Promise<unknown> {
  const res = await fetch(buildRestletUrl(session.accountId, session.restlet, params), {
    headers: { Authorization: `Bearer ${session.token}`, Accept: 'application/json' },
  })
  return await readOrThrow(res)
}

/** Field-level schema for a REST record type, from the account's metadata catalog. */
export async function netsuiteGetMetadataCatalog(session: NetSuiteSession, recordType: string): Promise<unknown> {
  const res = await fetch(
    `https://${netsuiteHost(session.accountId)}/services/rest/record/v1/metadata-catalog/${encodeURIComponent(recordType)}`,
    { headers: { Authorization: `Bearer ${session.token}`, Accept: 'application/schema+json' } },
  )
  return await readOrThrow(res)
}
