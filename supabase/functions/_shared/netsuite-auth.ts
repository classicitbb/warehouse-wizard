// NetSuite OAuth 2.0 client credentials (machine-to-machine) flow.
//
// NetSuite does not accept a client secret for this grant: a Basic-auth
// `grant_type=client_credentials` request is rejected with `invalid_request`.
// The token request must instead carry a JWT client assertion signed with a
// private key whose X.509 certificate has been uploaded under
// Setup > Integration > Manage Authentication > OAuth 2.0 Client Credentials
// (M2M) Setup. The Certificate ID NetSuite assigns on upload is the JWT `kid`.
//
// Keys are EC P-256 / ES256 (one of the three algorithms NetSuite accepts) so
// key generation stays well inside the edge runtime's CPU budget. Plain
// WebCrypto only - no npm dependencies - so this runs unchanged under Deno.

import { netsuiteHost } from './netsuite.ts'

const JWT_BEARER = 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer'
// NetSuite caps an assertion's lifetime at 60 minutes.
const ASSERTION_TTL_SECONDS = 1800
// NetSuite shortens any certificate valid for more than two years.
const CERTIFICATE_VALIDITY_DAYS = 729

export type NetSuiteM2MCredentials = {
  accountId: string
  clientId: string
  certificateId: string
  privateKeyPem: string
}

export type NetSuiteTokenResult = { ok: true; token: string } | { ok: false; error: string }

export function netsuiteTokenUrl(accountId: string): string {
  return `https://${netsuiteHost(accountId)}/services/rest/auth/oauth2/v1/token`
}

// ── encoding helpers ────────────────────────────────────────────────────────

// WebCrypto's BufferSource type wants a plain ArrayBuffer; a Uint8Array's
// backing buffer is ArrayBufferLike, so copy the exact bytes out of it.
function asBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer as ArrayBuffer
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let offset = 0
  for (const p of parts) {
    out.set(p, offset)
    offset += p.length
  }
  return out
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary)
}

function base64Url(input: Uint8Array | string): string {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input
  return bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function toPem(label: string, der: Uint8Array): string {
  const body = bytesToBase64(der).match(/.{1,64}/g)?.join('\n') ?? ''
  return `-----BEGIN ${label}-----\n${body}\n-----END ${label}-----\n`
}

function fromPem(pem: string): Uint8Array {
  const binary = atob(pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, ''))
  return Uint8Array.from(binary, (c) => c.charCodeAt(0))
}

// ── minimal DER writer, just enough for a self-signed certificate ───────────

function tlv(tag: number, ...content: Uint8Array[]): Uint8Array {
  const body = concat(...content)
  const len = body.length
  const header = len < 0x80
    ? [tag, len]
    : len < 0x100
      ? [tag, 0x81, len]
      : [tag, 0x82, len >> 8, len & 0xff]
  return concat(Uint8Array.from(header), body)
}

const derSequence = (...content: Uint8Array[]) => tlv(0x30, ...content)

function derInteger(bytes: Uint8Array): Uint8Array {
  let start = 0
  while (start < bytes.length - 1 && bytes[start] === 0) start++
  const trimmed = bytes.slice(start)
  // A set high bit would read as negative, so pad with a zero byte.
  return tlv(0x02, trimmed[0] & 0x80 ? concat(Uint8Array.of(0), trimmed) : trimmed)
}

function derOid(oid: string): Uint8Array {
  const [first, second, ...rest] = oid.split('.').map(Number)
  const bytes = [first * 40 + second]
  for (const arc of rest) {
    const chunk = [arc & 0x7f]
    for (let v = arc >> 7; v > 0; v >>= 7) chunk.unshift((v & 0x7f) | 0x80)
    bytes.push(...chunk)
  }
  return tlv(0x06, Uint8Array.from(bytes))
}

function derTime(date: Date): Uint8Array {
  const iso = date.toISOString().replace(/[-:T]/g, '').slice(0, 14) + 'Z' // YYYYMMDDHHMMSSZ
  // RFC 5280: UTCTime through 2049, GeneralizedTime from 2050.
  return date.getUTCFullYear() < 2050
    ? tlv(0x17, new TextEncoder().encode(iso.slice(2)))
    : tlv(0x18, new TextEncoder().encode(iso))
}

function derName(commonName: string): Uint8Array {
  return derSequence(tlv(0x31, derSequence(derOid('2.5.4.3'), tlv(0x0c, new TextEncoder().encode(commonName)))))
}

// WebCrypto returns ECDSA signatures as raw r||s. JWS wants exactly that, but
// an X.509 signature must be a DER SEQUENCE { INTEGER r, INTEGER s }.
function ecdsaRawToDer(raw: Uint8Array): Uint8Array {
  const half = raw.length / 2
  return derSequence(derInteger(raw.slice(0, half)), derInteger(raw.slice(half)))
}

// ── public API ──────────────────────────────────────────────────────────────

/**
 * Generates an EC P-256 key pair and a self-signed X.509 certificate for it.
 * The certificate is public and is what an admin uploads to NetSuite; the
 * PKCS#8 private key must only ever be stored server-side.
 */
export async function generateNetSuiteCertificate(commonName: string): Promise<{
  certificatePem: string
  privateKeyPem: string
  expiresAt: string
}> {
  const keyPair = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify'],
  ) as CryptoKeyPair
  const spki = new Uint8Array(await crypto.subtle.exportKey('spki', keyPair.publicKey))
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', keyPair.privateKey))

  const serial = crypto.getRandomValues(new Uint8Array(16))
  serial[0] &= 0x7f
  const notBefore = new Date(Date.now() - 5 * 60 * 1000)
  const notAfter = new Date(notBefore.getTime() + CERTIFICATE_VALIDITY_DAYS * 24 * 60 * 60 * 1000)
  const ecdsaWithSha256 = derSequence(derOid('1.2.840.10045.4.3.2'))
  const name = derName(commonName)

  const extensions = tlv(0xa3, derSequence(
    // basicConstraints: CA false
    derSequence(derOid('2.5.29.19'), tlv(0x04, derSequence())),
    // keyUsage (critical): digitalSignature
    derSequence(derOid('2.5.29.15'), tlv(0x01, Uint8Array.of(0xff)), tlv(0x04, tlv(0x03, Uint8Array.of(0x07, 0x80)))),
  ))

  const tbs = derSequence(
    tlv(0xa0, derInteger(Uint8Array.of(2))), // v3
    derInteger(serial),
    ecdsaWithSha256,
    name,
    derSequence(derTime(notBefore), derTime(notAfter)),
    name,
    spki,
    extensions,
  )
  const signature = new Uint8Array(
    await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, keyPair.privateKey, asBuffer(tbs)),
  )
  const certificate = derSequence(
    tbs,
    ecdsaWithSha256,
    tlv(0x03, Uint8Array.of(0), ecdsaRawToDer(signature)),
  )

  return {
    certificatePem: toPem('CERTIFICATE', certificate),
    privateKeyPem: toPem('PRIVATE KEY', pkcs8),
    expiresAt: notAfter.toISOString(),
  }
}

export async function buildClientAssertion(
  creds: NetSuiteM2MCredentials,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<string> {
  const key = await crypto.subtle.importKey(
    'pkcs8',
    asBuffer(fromPem(creds.privateKeyPem)),
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  )
  const header = { alg: 'ES256', typ: 'JWT', kid: creds.certificateId.trim() }
  const claims = {
    iss: creds.clientId.trim(),
    scope: ['rest_webservices'],
    aud: netsuiteTokenUrl(creds.accountId),
    iat: nowSeconds,
    exp: nowSeconds + ASSERTION_TTL_SECONDS,
  }
  const signingInput = `${base64Url(JSON.stringify(header))}.${base64Url(JSON.stringify(claims))}`
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    asBuffer(new TextEncoder().encode(signingInput)),
  )
  return `${signingInput}.${base64Url(new Uint8Array(signature))}`
}

// NetSuite's token endpoint answers with a bare error code - a certificate ID
// it does not recognise comes back as `500 server_error` - so name the setup
// steps that usually cause each code. Login Audit Trail has the real reason.
function describeTokenError(status: number, body: string): string {
  const code = (() => {
    try { return String((JSON.parse(body) as { error?: string }).error ?? '') } catch { return '' }
  })()
  const raw = `NetSuite responded ${status}: ${body.trim().slice(0, 200)}`
  if (code === 'invalid_scope') {
    return `${raw}. Enable the REST Web Services scope on the NetSuite integration record.`
  }
  if (['server_error', 'invalid_client', 'unauthorized_client', 'invalid_grant', 'invalid_request'].includes(code)) {
    return `${raw}. Check that the Certificate ID matches a certificate uploaded under Setup > Integration > Manage Authentication > OAuth 2.0 Client Credentials (M2M) Setup for this integration record, that the Client ID belongs to that integration record, and that the record has the Client Credentials (Machine to Machine) grant enabled. NetSuite's Login Audit Trail shows the exact reason.`
  }
  return raw
}

export async function fetchNetSuiteAccessToken(creds: NetSuiteM2MCredentials): Promise<NetSuiteTokenResult> {
  let assertion: string
  try {
    assertion = await buildClientAssertion(creds)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, error: `Could not sign the NetSuite client assertion - regenerate the certificate (${message})` }
  }

  try {
    const res = await fetch(netsuiteTokenUrl(creds.accountId), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_assertion_type: JWT_BEARER,
        client_assertion: assertion,
      }).toString(),
    })
    const text = await res.text()
    if (!res.ok) return { ok: false, error: describeTokenError(res.status, text) }
    let token = ''
    try { token = String((JSON.parse(text) as { access_token?: string }).access_token ?? '') } catch { /* handled below */ }
    if (!token) return { ok: false, error: 'NetSuite token response missing access_token' }
    return { ok: true, token }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
