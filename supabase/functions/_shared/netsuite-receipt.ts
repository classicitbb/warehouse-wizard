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
  /** Identity of the line across lookups, as stored on the draft (W4). Not what NetSuite is sent: name the source line with `lineNumber` (`orderLine` on the receipt). */
  lineKey: string | null
  lineNumber: number | null
  itemId: string
  quantity: number
  /** Inbound shipment lines: the PO the line belongs to, and the lot the pallet carries. */
  poId?: string | null
  lotNumber?: string | null
  expiryDate?: string | null
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

/**
 * The body POSTed to the inbound shipment RESTlet (customscript_spx_ww_inb_receipt_rl).
 * Shape follows the contract proposed in the Developer Brief; the RESTlet returns
 * `{ ok, itemReceiptIds, alreadyProcessed }`. `shipmentLineKey` is the PO line's
 * unique key saved with the draft (W4). Bins are not sent until W5 maps them.
 */
export type InboundShipmentRestletBody = {
  inboundShipmentId: string
  externalRef: string
  lines: {
    shipmentLineKey: string
    quantity: number
    poId?: string
    lineNumber?: number
    location?: string
    inventoryAssignment?: { receiptInventoryNumber: string; expirationDate?: string; quantity: number }[]
  }[]
}

/**
 * The RESTlet takes each shipment line once per call (it answers DUPLICATE_LINE_KEY
 * otherwise). Pallets of the same PO line are merged into one line: quantities add
 * up and each lot becomes one `inventoryAssignment` entry.
 */
export function buildInboundShipmentRestletBody(job: ReceiptJobPayload): InboundShipmentRestletBody {
  if (job.documentType !== 'inbound_shipment') throw new Error('Not an inbound shipment receipt job')
  if (!job.externalRef.trim()) throw new Error('A receipt job needs its externalRef')
  const byKey = new Map<string, InboundShipmentRestletBody['lines'][number]>()
  for (const l of job.lines.filter((l) => l.quantity > 0)) {
    const key = l.lineKey?.trim()
    if (!key) throw new Error('An inbound shipment receipt line needs its shipment line key')
    const lot = l.lotNumber?.trim()
    const existing = byKey.get(key)
    if (!existing) {
      byKey.set(key, {
        shipmentLineKey: key,
        quantity: l.quantity,
        ...(l.poId ? { poId: String(l.poId) } : {}),
        ...(l.lineNumber != null ? { lineNumber: l.lineNumber } : {}),
        ...(job.locationId ? { location: job.locationId } : {}),
        ...(lot
          ? { inventoryAssignment: [{ receiptInventoryNumber: lot, ...(l.expiryDate ? { expirationDate: l.expiryDate } : {}), quantity: l.quantity }] }
          : {}),
      })
      continue
    }
    if (!!lot !== !!existing.inventoryAssignment) {
      throw new Error(`Shipment line ${key} mixes lot-tracked and untracked pallets; the lots would not add up to the line quantity`)
    }
    existing.quantity += l.quantity
    if (lot) {
      const same = existing.inventoryAssignment!.find((a) => a.receiptInventoryNumber === lot && a.expirationDate === (l.expiryDate || undefined))
      if (same) same.quantity += l.quantity
      else existing.inventoryAssignment!.push({ receiptInventoryNumber: lot, ...(l.expiryDate ? { expirationDate: l.expiryDate } : {}), quantity: l.quantity })
    }
  }
  const lines = [...byKey.values()]
  if (lines.length === 0) throw new Error('A receipt job needs at least one line with a quantity')
  return { inboundShipmentId: job.documentId, externalRef: job.externalRef, lines }
}

/** One PO line as it sits on an inbound shipment (SuiteQL `inboundshipmentitem`). */
export type ShipmentLineCandidate = { shipmentId: string; lineNumber: number; lineKey: string; remaining: number }

export type ShipmentReceiptPlan =
  | { ok: true; shipmentId: string; lines: { lineNumber: number; lineKey: string; quantity: number }[] }
  | { ok: false; reason: string }

/**
 * A PO line that is on an inbound shipment cannot be received from the PO: NetSuite's
 * item receipt transform has nothing to receive and answers 400. Pick the one shipment
 * that can take every line. A line on several shipments uses the one with the most left.
 */
export function planShipmentReceipt(
  candidates: ShipmentLineCandidate[],
  wanted: { lineNumber: number; quantity: number }[],
): ShipmentReceiptPlan {
  let shipmentIds = null as Set<string> | null
  for (const w of wanted) {
    const ids = new Set(candidates.filter((c) => c.lineNumber === w.lineNumber && c.remaining >= w.quantity).map((c) => c.shipmentId))
    if (ids.size === 0) {
      const onShipments = candidates.filter((c) => c.lineNumber === w.lineNumber)
      return {
        ok: false,
        reason: onShipments.length === 0
          ? `line ${w.lineNumber} is not on an inbound shipment`
          : `line ${w.lineNumber}: ${w.quantity} to receive but no inbound shipment has that much left (${onShipments.map((c) => `shipment ${c.shipmentId}: ${c.remaining}`).join(', ')})`,
      }
    }
    shipmentIds = shipmentIds ? new Set([...shipmentIds].filter((id) => ids.has(id))) : ids
  }
  if (!shipmentIds || shipmentIds.size === 0) return { ok: false, reason: 'the lines are on different inbound shipments; receive each through its shipment' }
  const shipmentId = [...shipmentIds].sort((a, b) => remainingOn(candidates, b, wanted) - remainingOn(candidates, a, wanted))[0]
  return {
    ok: true,
    shipmentId,
    lines: wanted.map((w) => ({
      lineNumber: w.lineNumber,
      lineKey: candidates.find((c) => c.shipmentId === shipmentId && c.lineNumber === w.lineNumber)!.lineKey,
      quantity: w.quantity,
    })),
  }
}

function remainingOn(candidates: ShipmentLineCandidate[], shipmentId: string, wanted: { lineNumber: number }[]): number {
  return candidates
    .filter((c) => c.shipmentId === shipmentId && wanted.some((w) => w.lineNumber === c.lineNumber))
    .reduce((sum, c) => sum + c.remaining, 0)
}

export type ReceiptOutcome =
  | { ok: true; receiptIds: string[]; alreadyProcessed: boolean }
  | { ok: false; reason: string; retryable: boolean; code?: string }

/**
 * Reads a RESTlet response. `alreadyProcessed: true` is a success, and a
 * response can carry several Item Receipt ids (one per PO), all of which are kept.
 * A failure is `{ ok: false, code, retryable, error }` with HTTP 200: only
 * `retryable: true` is worth another attempt (an over-receipt or closed shipment
 * never succeeds on retry). A failure in any other shape stays retryable.
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
  if (b.ok === false || b.success === false || (ids.size === 0 && !alreadyProcessed)) {
    const code = typeof b.code === 'string' && b.code ? b.code : undefined
    const message = typeof b.error === 'string' ? b.error : typeof b.message === 'string' ? b.message : 'No item receipt id returned'
    return {
      ok: false,
      reason: code ? `${code}: ${message}` : message,
      retryable: typeof b.retryable === 'boolean' ? b.retryable : true,
      ...(code ? { code } : {}),
    }
  }
  return { ok: true, receiptIds: [...ids], alreadyProcessed }
}
