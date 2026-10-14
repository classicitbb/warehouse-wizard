// Pure pieces of the inbound shipment browser (Receiving > View inbound): input
// validation, the SuiteQL builders, and mapping result rows into the shapes the
// Receiving screen consumes. No network, so Vitest runs it directly (see
// src/test/netsuite-inbound.test.ts).
//
// Table and column names follow Oracle's Inbound Shipment record reference and a
// published SuiteQL example (InboundShipment joined to InboundShipmentItem,
// Transaction on purchaseordertransaction, TransactionLine on
// shipmentitemtransaction = uniquekey). They have NOT been confirmed against the
// Simplex account; see docs/inbound-shipment-browser-design.md §9. Status codes
// below are the likely SuiteQL values and are kept in one place for that reason.

// No imports, like netsuite-lookup.ts: the app's compiler rejects the `.ts` import
// paths Deno needs, and Vitest loads this file straight from the test.

// ── status ───────────────────────────────────────────────────────────────────

/** Only these can be received, so they are what the browser shows by default. [Verify values] */
export const INBOUND_OPEN_STATUSES = ['inTransit', 'partiallyReceived'] as const
export const INBOUND_RECEIVED_STATUSES = ['received', 'closed'] as const

export type InboundStatusFilter = 'open' | 'received' | 'all'
export type InboundSortKey = 'expected_delivery' | 'shipment_number' | 'status'
export type InboundSortDirection = 'asc' | 'desc'

export const INBOUND_PAGE_SIZE = 25
export const INBOUND_MAX_ROWS = 200

export function isInboundStatusFilter(value: unknown): value is InboundStatusFilter {
  return value === 'open' || value === 'received' || value === 'all'
}
export function isInboundSortKey(value: unknown): value is InboundSortKey {
  return value === 'expected_delivery' || value === 'shipment_number' || value === 'status'
}

/**
 * Human label for a shipment status code. NetSuite will not resolve it for us —
 * `BUILTIN.DF(s.shipmentstatus)` is rejected with "Static field is not supported",
 * because the status is a static list rather than a record reference — so the
 * label is derived from the code. Handles both the camelCase and the
 * UPPER_SNAKE spellings accounts use for the same value.
 */
export function inboundStatusLabel(code: string): string {
  const words = code
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(' ')
    .filter(Boolean)
  return words.map((w) => w[0].toUpperCase() + w.slice(1)).join(' ')
}

// ── input ────────────────────────────────────────────────────────────────────

// Same pattern as `normalizeDocumentNumber` in netsuite-lookup.ts: the term ends up
// inside a SuiteQL string literal, so accept only what a shipment, container or PO
// number can plausibly contain rather than trying to escape everything.
const SEARCH_TERM_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 ._/-]{0,39}$/

/** A search term is optional. Empty means "no search"; anything else must look like a document number. */
export function normalizeSearchTerm(input: unknown): string | undefined {
  if (input === undefined || input === null) return ''
  if (typeof input !== 'string') return undefined
  const trimmed = input.trim().replace(/\s+/g, ' ')
  if (trimmed === '') return ''
  return SEARCH_TERM_PATTERN.test(trimmed) ? trimmed : undefined
}

/** NetSuite internal ids are plain integers. Anything else never reaches a query. */
export function normalizeInternalId(input: unknown): string | null {
  const text = typeof input === 'number' ? String(input) : typeof input === 'string' ? input.trim() : ''
  return /^\d{1,12}$/.test(text) ? text : null
}

function literal(value: string): string {
  return value.replace(/'/g, "''")
}

function quoteList(values: readonly string[]): string {
  return values.map((v) => `'${literal(v)}'`).join(', ')
}

function statusClause(filter: InboundStatusFilter): string | null {
  if (filter === 'open') return `s.shipmentstatus IN (${quoteList(INBOUND_OPEN_STATUSES)})`
  if (filter === 'received') return `s.shipmentstatus IN (${quoteList(INBOUND_RECEIVED_STATUSES)})`
  return null
}

// ── queries ──────────────────────────────────────────────────────────────────

const SORT_COLUMNS: Record<InboundSortKey, string> = {
  expected_delivery: 's.expecteddeliverydate',
  shipment_number: 's.shipmentnumber',
  status: 's.shipmentstatus',
}

export type InboundListParams = {
  search: string
  status: InboundStatusFilter
  sort: InboundSortKey
  direction: InboundSortDirection
}

// ── container field ──────────────────────────────────────────────────────────
//
// Simplex keeps the container number(s) in a custom "Container No" field on the
// inbound shipment (e.g. "SMLU7872173, SMLU3120938": a shipment can hold several
// containers). Its script id is account-specific, so it is found from the record's
// columns, or set explicitly with `inbound_container_field` on the NetSuite
// connection. The id is inlined into SQL, so it must look like a script id.

const FIELD_ID_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,59}$/

export function normalizeFieldId(value: unknown): string | null {
  return typeof value === 'string' && FIELD_ID_PATTERN.test(value.trim()) ? value.trim().toLowerCase() : null
}

/** Picks the custom container-number column from a `SELECT *` row. Null when nothing plausible is there. */
export function findContainerField(columns: string[]): string | null {
  const candidates = columns
    .map((c) => normalizeFieldId(c))
    .filter((c): c is string => c !== null && c.startsWith('cust') && c.includes('container'))
    .filter((c) => !/(size|status|type|line|count|seal|date|weight)/.test(c))
  const numbered = candidates.find((c) => /(no|num|number|numbers|nos)$/.test(c))
  return numbered ?? candidates[0] ?? null
}

/** "SMLU7872173, SMLU3120938" → two containers. Splits on commas, semicolons, slashes and whitespace. */
export function parseContainers(value: unknown): string[] {
  const raw = typeof value === 'string' ? value : ''
  const parts = raw.split(/[\s,;/]+/).map((p) => p.toUpperCase().replace(/[^A-Z0-9]/g, '')).filter(Boolean)
  return [...new Set(parts)]
}

/**
 * Shipment headers, filtered, searched and sorted by NetSuite. The search term
 * matches the shipment number, the container field (when known), the carrier's
 * reference, bill of lading, vessel number, or the number of any PO on the shipment.
 */
export function buildInboundListQuery(params: InboundListParams, containerField: string | null = null): string {
  const field = containerField ? normalizeFieldId(containerField) : null
  const where: string[] = []
  const status = statusClause(params.status)
  if (status) where.push(status)

  const term = params.search.trim()
  if (term) {
    const like = `'%${literal(term.toUpperCase())}%'`
    where.push(
      `(UPPER(s.shipmentnumber) LIKE ${like} OR UPPER(s.externaldocumentnumber) LIKE ${like} `
      + (field ? `OR UPPER(s.${field}) LIKE ${like} ` : '')
      + `OR UPPER(s.billoflading) LIKE ${like} OR UPPER(s.vesselnumber) LIKE ${like} `
      + `OR s.id IN (SELECT i.inboundshipment FROM inboundshipmentitem i `
      + `JOIN transaction po ON po.id = i.purchaseordertransaction WHERE UPPER(po.tranid) LIKE ${like}))`,
    )
  }

  const direction = params.direction === 'asc' ? 'ASC' : 'DESC'
  const nulls = 'NULLS LAST'
  return `SELECT s.id, s.shipmentnumber, s.externaldocumentnumber, s.billoflading, s.vesselnumber, `
    + (field ? `s.${field} AS containerno, ` : '')
    + `s.shipmentstatus AS statuscode, `
    + `s.expecteddeliverydate, s.actualshippingdate, s.shipmentmemo `
    + `FROM inboundshipment s${where.length ? ` WHERE ${where.join(' AND ')}` : ''} `
    + `ORDER BY ${SORT_COLUMNS[params.sort]} ${direction} ${nulls}, s.id DESC`
}

/** PO / line / unit totals for a page of shipments, fetched in one query rather than per row. */
export function buildInboundTotalsQuery(shipmentIds: string[]): string | null {
  const ids = shipmentIds.map(normalizeInternalId).filter((id): id is string => id !== null)
  if (ids.length === 0) return null
  return `SELECT i.inboundshipment AS shipmentid, COUNT(DISTINCT i.purchaseordertransaction) AS pocount, `
    + `COUNT(*) AS linecount, SUM(i.quantityexpected) AS quantityexpected `
    + `FROM inboundshipmentitem i WHERE i.inboundshipment IN (${ids.join(', ')}) GROUP BY i.inboundshipment`
}

/** Every PO line on one shipment: the preview and the prefill read the same rows. */
export function buildInboundLinesQuery(shipmentId: string): string {
  const id = normalizeInternalId(shipmentId)
  if (!id) throw new Error('Invalid inbound shipment id')
  return `SELECT i.id AS shipmentlineid, po.id AS poid, po.tranid AS ponumber, BUILTIN.DF(po.entity) AS vendor, `
    + `pl.uniquekey AS linekey, pl.linesequencenumber AS linenumber, pl.item AS itemid, BUILTIN.DF(pl.item) AS itemname, `
    + `i.shipmentitemdescription AS description, i.quantityexpected, BUILTIN.DF(i.unit) AS unit, `
    + `i.receivinglocation AS locationid, BUILTIN.DF(i.receivinglocation) AS locationname `
    + `FROM inboundshipmentitem i `
    + `JOIN transaction po ON po.id = i.purchaseordertransaction `
    + `JOIN transactionline pl ON pl.uniquekey = i.shipmentitemtransaction `
    + `WHERE i.inboundshipment = ${id} ORDER BY po.tranid, pl.linesequencenumber`
}

/**
 * Received quantity per shipment line. Run separately and treated as optional:
 * the column name is unconfirmed, and a rejected column must not take the
 * whole preview down with it.
 */
export function buildInboundReceivedQuery(shipmentId: string): string {
  const id = normalizeInternalId(shipmentId)
  if (!id) throw new Error('Invalid inbound shipment id')
  return `SELECT i.id AS shipmentlineid, i.quantityreceived FROM inboundshipmentitem i WHERE i.inboundshipment = ${id}`
}

/** Open shipments carrying a given PO, used to stop the PO lookup receiving it on its own. */
export function buildShipmentsForPoQuery(poInternalId: string): string {
  const id = normalizeInternalId(poInternalId)
  if (!id) throw new Error('Invalid purchase order id')
  return `SELECT DISTINCT s.id, s.shipmentnumber, s.externaldocumentnumber, s.shipmentstatus AS statuscode `
    + `FROM inboundshipmentitem i JOIN inboundshipment s ON s.id = i.inboundshipment `
    + `WHERE i.purchaseordertransaction = ${id} AND s.shipmentstatus IN (${quoteList(INBOUND_OPEN_STATUSES)})`
}

// ── normalised results ───────────────────────────────────────────────────────

export type InboundShipmentSummary = {
  id: string
  number: string
  /** Container numbers from the shipment's Container No field. One shipment can hold several. */
  containers: string[]
  /** The carrier's reference. A fallback when the Container No field is empty or unknown. */
  externalDocumentNumber: string
  billOfLading: string
  vesselNumber: string
  status: { code: string | null; label: string }
  /** ISO date (yyyy-mm-dd) or null. */
  expectedDeliveryDate: string | null
  actualShippingDate: string | null
  memo: string
  poCount: number
  lineCount: number
  quantityExpected: number
}

export type InboundShipmentLine = {
  shipmentLineId: string
  /** PO line `lineuniquekey`: what the shipment, and later the receipt, refer to. */
  lineKey: string | null
  lineNumber: number | null
  itemId: string | null
  itemName: string
  description: string
  quantityExpected: number
  /** Null when NetSuite would not tell us. */
  quantityReceived: number | null
  quantityRemaining: number
  unit: string | null
  location: { id: string; name: string } | null
  /** Filled in by the edge function; null when the NetSuite item is not imported yet. */
  localProductId?: string | null
}

export type InboundShipmentPo = {
  poId: string
  poNumber: string
  vendor: string
  lines: InboundShipmentLine[]
}

export type InboundShipmentDetail = {
  shipmentId: string
  pos: InboundShipmentPo[]
  /** False when received quantities could not be read, so "remaining" is only "expected". */
  receivedKnown: boolean
}

type Row = Record<string, unknown>

function text(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return ''
}

function numberOr(value: unknown, fallback: number): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : fallback
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value)
    return Number.isFinite(n) ? n : fallback
  }
  return fallback
}

/** SuiteQL returns dates as m/d/yyyy or ISO depending on account settings; the UI wants one form. */
export function normalizeNetSuiteDate(value: unknown): string | null {
  const raw = text(value)
  if (!raw) return null
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw)
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(raw)
  if (us) return `${us[3]}-${us[1].padStart(2, '0')}-${us[2].padStart(2, '0')}`
  return null
}

export type InboundTotals = { poCount: number; lineCount: number; quantityExpected: number }

export function indexTotals(rows: Row[]): Map<string, InboundTotals> {
  const map = new Map<string, InboundTotals>()
  for (const row of rows) {
    const id = text(row.shipmentid)
    if (!id) continue
    map.set(id, {
      poCount: numberOr(row.pocount, 0),
      lineCount: numberOr(row.linecount, 0),
      quantityExpected: numberOr(row.quantityexpected, 0),
    })
  }
  return map
}

export function mapShipmentSummary(row: Row, totals?: InboundTotals): InboundShipmentSummary {
  const statuscode = text(row.statuscode)
  return {
    id: text(row.id),
    number: text(row.shipmentnumber),
    containers: parseContainers(row.containerno),
    externalDocumentNumber: text(row.externaldocumentnumber),
    billOfLading: text(row.billoflading),
    vesselNumber: text(row.vesselnumber),
    status: { code: statuscode || null, label: inboundStatusLabel(statuscode) },
    expectedDeliveryDate: normalizeNetSuiteDate(row.expecteddeliverydate),
    actualShippingDate: normalizeNetSuiteDate(row.actualshippingdate),
    memo: text(row.shipmentmemo),
    poCount: totals?.poCount ?? 0,
    lineCount: totals?.lineCount ?? 0,
    quantityExpected: totals?.quantityExpected ?? 0,
  }
}

/**
 * Groups line rows by PO. `received` maps shipment line id to the quantity already
 * received; pass null when it could not be read, and remaining then equals expected.
 */
export function mapShipmentDetail(shipmentId: string, rows: Row[], received: Map<string, number> | null): InboundShipmentDetail {
  const byPo = new Map<string, InboundShipmentPo>()
  for (const row of rows) {
    const poId = text(row.poid)
    if (!poId) continue
    let po = byPo.get(poId)
    if (!po) {
      po = { poId, poNumber: text(row.ponumber), vendor: text(row.vendor), lines: [] }
      byPo.set(poId, po)
    }
    const shipmentLineId = text(row.shipmentlineid)
    const expected = numberOr(row.quantityexpected, 0)
    const got = received ? (received.get(shipmentLineId) ?? 0) : null
    const locationId = text(row.locationid)
    po.lines.push({
      shipmentLineId,
      lineKey: text(row.linekey) || null,
      lineNumber: numberOr(row.linenumber, Number.NaN) || null,
      itemId: text(row.itemid) || null,
      itemName: text(row.itemname),
      description: text(row.description),
      quantityExpected: expected,
      quantityReceived: got,
      quantityRemaining: Math.max(expected - (got ?? 0), 0),
      unit: text(row.unit) || null,
      location: locationId ? { id: locationId, name: text(row.locationname) || locationId } : null,
    })
  }
  return { shipmentId, pos: [...byPo.values()], receivedKnown: received !== null }
}

export function indexReceived(rows: Row[]): Map<string, number> {
  const map = new Map<string, number>()
  for (const row of rows) {
    const id = text(row.shipmentlineid)
    if (id) map.set(id, numberOr(row.quantityreceived, 0))
  }
  return map
}
