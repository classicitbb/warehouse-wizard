// Trip departure -> NetSuite item fulfillment at Shipped (outbound picking
// design, slice F: D3/D10 as changed by O1 and O4, roadmap 2.2).
//
// The office made the IF at Picked (O1). When the trip departs, depart_trip
// queues one 'fulfillment_ship' job per IF. The worker PATCHes the IF:
// shipStatus C, the KPI times WW scanned (V19: the KPI script accepts them),
// and each line's picked quantity in the line unit (D9). A line picked short
// ships short (D10); a line with nothing picked is sent itemReceive false.
//
// V7 is still open: can REST lower an IF line at Picked? If NetSuite refuses
// the line change, the job parks in the dead-letter queue with NetSuite's
// message, and the office corrects the IF by hand.

export type FulfillmentShipLine = {
  line: string
  itemId?: string | null
  unitId?: string | null
  plannedBase: number
  pickedBase: number
  /** Picked quantity in the NetSuite line unit. */
  quantity: number
}

export type FulfillmentShipPayload = {
  fulfillmentId: string
  documentNumber?: string
  externalRef: string
  wwFulfillmentId?: string
  locationId?: string | null
  pickedAt?: string | null
  packedAt?: string | null
  shippedAt: string
  lines: FulfillmentShipLine[]
}

/** IF body field ids for the KPI times; set in the connection config `fulfillment_kpi_fields`. */
export type FulfillmentKpiFields = { picked?: string; packed?: string; shipped?: string }

export const DEFAULT_FULFILLMENT_KPI_FIELDS: FulfillmentKpiFields = { picked: 'custbody_spx_kpi_picked_at' }

const FIELD_ID = /^custbody[a-z0-9_]+$/

export function resolveFulfillmentKpiFields(config: Record<string, unknown>): FulfillmentKpiFields {
  const raw = config.fulfillment_kpi_fields
  if (!raw || typeof raw !== 'object') return DEFAULT_FULFILLMENT_KPI_FIELDS
  const out: FulfillmentKpiFields = {}
  for (const key of ['picked', 'packed', 'shipped'] as const) {
    const v = (raw as Record<string, unknown>)[key]
    if (typeof v === 'string' && FIELD_ID.test(v.trim())) out[key] = v.trim()
  }
  return out
}

export function validateFulfillmentShipPayload(p: Partial<FulfillmentShipPayload>): string | null {
  if (!p.fulfillmentId || !/^\d+$/.test(String(p.fulfillmentId))) return 'missing or invalid NetSuite fulfillment id'
  if (!p.externalRef) return 'missing externalRef'
  if (!p.shippedAt) return 'missing shippedAt'
  if (!Array.isArray(p.lines) || p.lines.length === 0) return 'no lines'
  if (!p.lines.some((l) => Number(l.quantity) > 0)) return 'nothing picked on any line'
  for (const l of p.lines) {
    if (!/^\d+$/.test(String(l.line))) return `invalid line id ${l.line}`
    if (!Number.isFinite(Number(l.quantity)) || Number(l.quantity) < 0) return `invalid quantity on line ${l.line}`
  }
  return null
}

/** True when any line ships less than the office planned (D10). */
export function isShipShort(p: Pick<FulfillmentShipPayload, 'lines'>): boolean {
  return p.lines.some((l) => Number(l.pickedBase) < Number(l.plannedBase))
}

/** PATCH body for itemFulfillment/{id}. */
export function buildFulfillmentShipPatch(p: FulfillmentShipPayload, kpi: FulfillmentKpiFields = DEFAULT_FULFILLMENT_KPI_FIELDS): Record<string, unknown> {
  const body: Record<string, unknown> = {
    shipStatus: { id: 'C' },
    memo: `Warehouse Wizard ${p.externalRef}${isShipShort(p) ? ' (shipped short)' : ''}`,
    item: {
      items: p.lines.map((l) => (
        Number(l.quantity) > 0
          ? { line: Number(l.line), itemReceive: true, quantity: Number(l.quantity) }
          : { line: Number(l.line), itemReceive: false }
      )),
    },
  }
  const times: [keyof FulfillmentKpiFields, string | null | undefined][] = [
    ['picked', p.pickedAt], ['packed', p.packedAt], ['shipped', p.shippedAt],
  ]
  for (const [key, value] of times) {
    const field = kpi[key]
    if (field && value) body[field] = new Date(value).toISOString()
  }
  return body
}

/** A 4xx other than auth/rate limit is a record problem that retrying cannot fix. */
export function isPermanentFulfillmentFailure(httpStatus: number | null): boolean {
  return httpStatus != null && httpStatus >= 400 && httpStatus < 500 && ![401, 403, 408, 429].includes(httpStatus)
}
