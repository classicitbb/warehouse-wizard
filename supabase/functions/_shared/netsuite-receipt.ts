// Idempotency for receipt jobs (W3d). Pure, no Deno globals.
//
// Every receipt job carries one `externalRef`. For an inbound shipment it is
// sent in the RESTlet's `custbody_spx_ww_external_ref` Item Receipt field, and a
// retry then comes back with `alreadyProcessed: true` and the existing ids. For
// purchase order and transfer order transforms it is sent as the Item Receipt
// `externalId`, which NetSuite refuses a second time. The key is derived from
// the Warehouse Wizard shipment (draft group) and never from the clock or the
// attempt number, so every retry of the same posting sends the same reference.

export type NetSuiteReceiptDocumentType = 'purchase_order' | 'transfer_order' | 'inbound_shipment'

export const RECEIPT_JOB_TYPES = {
  purchase_order: 'receipt_purchase_order',
  transfer_order: 'receipt_transfer_order',
  inbound_shipment: 'receipt_inbound_shipment',
} as const satisfies Record<NetSuiteReceiptDocumentType, string>

// External ids allow letters, digits, `_` and `-`. Capped so the ref fits a
// custom body field comfortably.
const MAX_REF_LENGTH = 64

function clean(value: string): string {
  return value.trim().replace(/[^A-Za-z0-9_-]/g, '-')
}

/** Stable reference for one receipt posting, e.g. `ww-rcpt-po-shipment-1f3a…`. */
export function netsuiteReceiptExternalRef(documentType: NetSuiteReceiptDocumentType, postingKey: string): string {
  const key = clean(postingKey)
  if (!key) throw new Error('A receipt posting needs a non-empty key')
  const tag = documentType === 'purchase_order' ? 'po' : documentType === 'transfer_order' ? 'to' : 'ship'
  return `ww-rcpt-${tag}-${key}`.slice(0, MAX_REF_LENGTH)
}

/** `integration_sync_jobs.idempotency_key`: one job per posting, whatever the retries. */
export function receiptIdempotencyKey(documentType: NetSuiteReceiptDocumentType, postingKey: string): string {
  return `receipt:${documentType}:${clean(postingKey)}`
}

export type ReceiptLinePayload = {
  /** NetSuite `lineUniqueKey` or line number, as stored on the draft (W4). */
  lineKey: string | null
  lineNumber: number | null
  itemId: string
  quantity: number
}

export type ReceiptJobPayload = {
  documentType: NetSuiteReceiptDocumentType
  documentId: string
  externalRef: string
  locationId: string | null
  lines: ReceiptLinePayload[]
}

/** The payload every receipt job must carry: the document, the lines, and the externalRef. */
export function buildReceiptJobPayload(input: {
  documentType: NetSuiteReceiptDocumentType
  documentId: string
  postingKey: string
  locationId?: string | null
  lines: ReceiptLinePayload[]
}): ReceiptJobPayload {
  if (!input.documentId.trim()) throw new Error('A receipt job needs the NetSuite document id')
  const lines = input.lines.filter((l) => l.quantity > 0)
  if (lines.length === 0) throw new Error('A receipt job needs at least one line with a quantity')
  return {
    documentType: input.documentType,
    documentId: input.documentId.trim(),
    externalRef: netsuiteReceiptExternalRef(input.documentType, input.postingKey),
    locationId: input.locationId ?? null,
    lines,
  }
}

export type ReceiptOutcome = { ok: true; receiptIds: string[]; alreadyProcessed: boolean } | { ok: false; reason: string }

/**
 * Reads a RESTlet response. `alreadyProcessed: true` is a success, and a
 * response can carry several Item Receipt ids (one per PO), all of which are kept.
 */
export function interpretReceiptResponse(body: unknown): ReceiptOutcome {
  const b = (body ?? {}) as Record<string, unknown>
  const ids = new Set<string>()
  const add = (v: unknown) => { if (v != null && String(v).trim()) ids.add(String(v).trim()) }
  add(b.itemReceiptId)
  add(b.id)
  for (const key of ['itemReceiptIds', 'itemReceipts', 'receiptIds']) {
    const list = b[key]
    if (Array.isArray(list)) {
      for (const entry of list) add(entry && typeof entry === 'object' ? (entry as Record<string, unknown>).id ?? (entry as Record<string, unknown>).itemReceiptId : entry)
    }
  }
  const alreadyProcessed = b.alreadyProcessed === true
  if (b.success === false || (ids.size === 0 && !alreadyProcessed)) {
    return { ok: false, reason: typeof b.error === 'string' ? b.error : typeof b.message === 'string' ? b.message : 'No item receipt id returned' }
  }
  return { ok: true, receiptIds: [...ids], alreadyProcessed }
}
