// Pure pieces of the NetSuite customer import (outbound picking design, slice
// B): the SuiteQL builder, cursor validation and row mapping into
// public.customers. No network, so Vitest runs it directly (see
// src/test/netsuite-customers.test.ts).
//
// Column names were confirmed against the Simplex sandbox (9738806-sb1) on
// 2026-10-16: 3,581 active customers, 3,575 with a default shipping address,
// oncredithold / custentity_spx_credit_review_req / shipcomplete as 'T'/'F',
// and BUILTIN.DF(custentity_simplex_zone) returning a zone name or "0".
//
// No imports, like netsuite-inbound.ts: the app's compiler rejects the `.ts`
// import paths Deno needs, and Vitest loads this file straight from the test.

/** SuiteQL caps a page at 1,000 rows. */
export const CUSTOMER_PAGE_SIZE = 1000

/** The zones Simplex uses in custentity_simplex_zone; anything else is stored as null. */
export const DELIVERY_ZONES = ['North', 'South', 'East', 'West', 'Central'] as const
export type DeliveryZone = (typeof DELIVERY_ZONES)[number]

/** `YYYY-MM-DD HH24:MI:SS` in the NetSuite account's own time zone. */
const CURSOR_PATTERN = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/

export type CustomerRow = {
  id?: string
  entityid?: string
  companyname?: string
  altname?: string
  email?: string
  phone?: string
  zone?: string
  oncredithold?: string
  credit_review?: string
  shipcomplete?: string
  isinactive?: string
  modified?: string
  addressee?: string
  attention?: string
  addr1?: string
  addr2?: string
  addr3?: string
  city?: string
  state?: string
  zip?: string
  country?: string
  addrphone?: string
}

export type ShipAddress = {
  addressee: string | null
  attention: string | null
  addr1: string | null
  addr2: string | null
  addr3: string | null
  city: string | null
  state: string | null
  zip: string | null
  country: string | null
  phone: string | null
}

export type MappedCustomer = {
  externalId: string
  customer_number: string
  name: string
  delivery_zone: DeliveryZone | null
  default_ship_address: ShipAddress | null
  email: string | null
  phone: string | null
  on_credit_hold: boolean
  credit_review_required: boolean
  ship_complete: boolean
  active: boolean
  source_modified_at: string | null
}

/** A cursor the delta may embed in SuiteQL, or null if it is not one. */
export function normalizeCursor(value: unknown): string | null {
  if (typeof value !== 'string') return null
  // Postgres returns `timestamp without time zone` as `YYYY-MM-DDTHH:MM:SS`.
  const text = value.trim().replace('T', ' ').slice(0, 19)
  return CURSOR_PATTERN.test(text) ? text : null
}

/**
 * One keyset page of customers, ordered by internal id. `import` reads only
 * active customers; `delta` reads every customer changed at or after the
 * cursor, inactive ones included, so deactivations reach the local table.
 */
export function buildCustomerPageQuery(opts: { afterId: number; since?: string | null }): string {
  const afterId = Number.isFinite(opts.afterId) && opts.afterId > 0 ? Math.floor(opts.afterId) : 0
  const since = normalizeCursor(opts.since ?? null)
  const filter = since
    ? `c.lastmodifieddate >= TO_DATE('${since}', 'YYYY-MM-DD HH24:MI:SS')`
    : `c.isinactive = 'F'`
  return [
    'SELECT c.id, c.entityid, c.companyname, c.altname, c.email, c.phone,',
    ' BUILTIN.DF(c.custentity_simplex_zone) AS zone, c.oncredithold,',
    ' c.custentity_spx_credit_review_req AS credit_review, c.shipcomplete, c.isinactive,',
    " TO_CHAR(c.lastmodifieddate, 'YYYY-MM-DD HH24:MI:SS') AS modified,",
    ' a.addressee, a.attention, a.addr1, a.addr2, a.addr3, a.city, a.state, a.zip, a.country, a.addrphone',
    ' FROM customer c LEFT JOIN entityaddress a ON a.nkey = c.defaultshippingaddress',
    ` WHERE ${filter} AND c.id > ${afterId}`,
    ' ORDER BY c.id',
  ].join('')
}

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

function flag(value: unknown): boolean {
  return value === 'T' || value === true
}

export function normalizeZone(value: unknown): DeliveryZone | null {
  const raw = text(value)
  if (!raw) return null
  return DELIVERY_ZONES.find((z) => z.toLowerCase() === raw.toLowerCase()) ?? null
}

function mapAddress(row: CustomerRow): ShipAddress | null {
  const address: ShipAddress = {
    addressee: text(row.addressee),
    attention: text(row.attention),
    addr1: text(row.addr1),
    addr2: text(row.addr2),
    addr3: text(row.addr3),
    city: text(row.city),
    state: text(row.state),
    zip: text(row.zip),
    country: text(row.country),
    phone: text(row.addrphone),
  }
  return Object.values(address).some((v) => v !== null) ? address : null
}

/** Maps one SuiteQL row; null when it lacks the internal id or entity id. */
export function mapCustomerRow(row: CustomerRow): MappedCustomer | null {
  const externalId = text(row.id)
  const customerNumber = text(row.entityid)
  if (!externalId || !customerNumber) return null
  return {
    externalId,
    customer_number: customerNumber,
    name: text(row.companyname) ?? text(row.altname) ?? customerNumber,
    delivery_zone: normalizeZone(row.zone),
    default_ship_address: mapAddress(row),
    email: text(row.email),
    phone: text(row.phone),
    on_credit_hold: flag(row.oncredithold),
    credit_review_required: flag(row.credit_review),
    ship_complete: flag(row.shipcomplete),
    active: !flag(row.isinactive),
    source_modified_at: normalizeCursor(row.modified),
  }
}

/** One line for the Customers page, e.g. "Spooners Hill, St. Michael, BB". */
export function formatShipAddress(address: Partial<ShipAddress> | null | undefined): string {
  if (!address) return ''
  return [address.addr1, address.addr2, address.addr3, address.city, address.state, address.zip, address.country]
    .filter((part): part is string => typeof part === 'string' && part.trim() !== '')
    .join(', ')
}
