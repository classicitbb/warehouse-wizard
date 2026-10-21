// Pure pieces of the on-demand NetSuite document lookup (Phase 1, W2): input
// validation, the SuiteQL search, and normalising a NetSuite REST record into
// the shape the receiving screen consumes. No network and no imports, so
// Vitest runs it directly (see src/test/netsuite-lookup.test.ts).
//
// The REST field names read here were confirmed against the Simplex sandbox
// metadata catalog on 2026-10-21 (Developer Brief, J10); the captured field
// lists are in src/test/fixtures/netsuite/. Where records differ, so does this
// code:
//   - Line number: `line` on both records (`orderLine` is the back-reference on
//     item receipt and fulfilment lines, and is never read here).
//   - Line key: a purchase order line has `uniqueKey`. A transfer order line has
//     no key of any kind, so one is built from the document id and `line`.
//   - Status: a purchase order has `status`; a transfer order only `orderStatus`.

export const LOOKUP_DOCUMENT_TYPES = {
  purchase_order: { recordType: 'purchaseOrder', tranType: 'PurchOrd', label: 'Purchase order' },
  transfer_order: { recordType: 'transferOrder', tranType: 'TrnfrOrd', label: 'Transfer order' },
} as const

export type LookupDocumentType = keyof typeof LOOKUP_DOCUMENT_TYPES

export function isLookupDocumentType(value: unknown): value is LookupDocumentType {
  return typeof value === 'string' && Object.hasOwn(LOOKUP_DOCUMENT_TYPES, value)
}

// The number is typed or scanned from the printed receiving report and ends up
// inside a SuiteQL string literal, so accept only what a document number can
// plausibly contain rather than trying to escape everything.
const DOCUMENT_NUMBER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 ._/-]{0,39}$/

export function normalizeDocumentNumber(input: unknown): string | null {
  if (typeof input !== 'string') return null
  const trimmed = input.trim().replace(/\s+/g, ' ')
  return DOCUMENT_NUMBER_PATTERN.test(trimmed) ? trimmed : null
}

/** Finds the internal id(s) for a document number. Exact match, case-insensitive. */
export function buildDocumentSearchQuery(type: LookupDocumentType, documentNumber: string): string {
  const { tranType } = LOOKUP_DOCUMENT_TYPES[type]
  const literal = documentNumber.replace(/'/g, "''")
  return `SELECT t.id, t.tranid, t.trandate, BUILTIN.DF(t.status) AS statusname, BUILTIN.DF(t.entity) AS entityname `
    + `FROM transaction t WHERE t.type = '${tranType}' AND UPPER(t.tranid) = UPPER('${literal}') ORDER BY t.id`
}

// ── normalised result ───────────────────────────────────────────────────────

export type NamedRef = { id: string; name: string }

export type LookupLine = {
  /**
   * Stable identity of the line across lookups. A purchase order line's
   * `uniqueKey`; for a transfer order, `<internal id>:<line>` because its lines
   * have no key and `line` alone repeats across documents. Not the value to
   * send back to NetSuite: receipts name the line with `lineNumber` (`orderLine`).
   */
  lineKey: string | null
  /** The source line number. Not sequential in NetSuite, so never assume position. */
  lineNumber: number | null
  itemId: string | null
  itemName: string
  description: string
  quantityOrdered: number
  /** Transfer orders only: what the sending warehouse has shipped so far. */
  quantityFulfilled: number | null
  quantityReceived: number
  /** What can still be received against this line. Zero when the line is closed. */
  quantityRemaining: number
  unit: string | null
  location: NamedRef | null
  closed: boolean
}

export type LookupDocument = {
  type: LookupDocumentType
  internalId: string
  number: string
  status: { code: string | null; label: string }
  entity: NamedRef | null
  location: NamedRef | null
  tranDate: string | null
  memo: string
  lines: LookupLine[]
}

type Json = Record<string, unknown>

function asObject(value: unknown): Json | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Json) : null
}

function str(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() === '' ? null : value
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return null
}

function num(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value)
    return Number.isFinite(n) ? n : null
  }
  return null
}

function bool(value: unknown): boolean {
  return value === true || value === 'T' || value === 'true'
}

function ref(value: unknown): NamedRef | null {
  const obj = asObject(value)
  if (obj) {
    const id = str(obj.id)
    if (!id) return null
    return { id, name: str(obj.refName) ?? str(obj.name) ?? id }
  }
  const id = str(value)
  return id ? { id, name: id } : null
}

export function normalizeLine(type: LookupDocumentType, raw: unknown, documentInternalId?: string): LookupLine {
  const line = asObject(raw) ?? {}
  const item = ref(line.item)
  const lineNumber = num(line.line)
  const ordered = num(line.quantity) ?? 0
  const received = num(line.quantityReceived) ?? 0
  const fulfilled = type === 'transfer_order' ? (num(line.quantityFulfilled) ?? 0) : null
  const closed = bool(line.isClosed)

  // A transfer order line can only be received up to what has been shipped.
  const receivable = type === 'transfer_order' ? Math.min(ordered, fulfilled ?? 0) : ordered
  const remaining = closed ? 0 : Math.max(receivable - received, 0)

  return {
    lineKey: type === 'purchase_order'
      ? str(line.uniqueKey)
      : documentInternalId && lineNumber !== null ? `${documentInternalId}:${lineNumber}` : null,
    lineNumber,
    itemId: item?.id ?? null,
    itemName: item?.name ?? '',
    description: str(line.description) ?? '',
    quantityOrdered: ordered,
    quantityFulfilled: fulfilled,
    quantityReceived: received,
    quantityRemaining: remaining,
    unit: ref(line.units)?.name ?? null,
    location: ref(line.location),
    closed,
  }
}

/** Turns the REST record (fetched with `expandSubResources=true`) into a LookupDocument. */
export function normalizeDocument(type: LookupDocumentType, internalId: string, record: unknown): LookupDocument {
  const doc = asObject(record) ?? {}
  // A transfer order has no `status`, only `orderStatus`.
  const status = asObject(doc.status) ?? asObject(doc.orderStatus)
  const itemSublist = asObject(doc.item)
  const rawLines = Array.isArray(itemSublist?.items) ? (itemSublist.items as unknown[]) : []

  return {
    type,
    internalId,
    number: str(doc.tranId) ?? '',
    status: {
      code: str(status?.id) ?? (typeof doc.status === 'string' ? doc.status : null),
      label: str(status?.refName) ?? '',
    },
    entity: ref(doc.entity),
    location: ref(doc.location),
    tranDate: str(doc.tranDate),
    memo: str(doc.memo) ?? '',
    lines: rawLines.map((l) => normalizeLine(type, l, internalId)),
  }
}
