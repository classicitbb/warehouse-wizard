// Pure pieces of the NetSuite outbound order poll (outbound picking design,
// slice C: D2, D8, D9, O1-O3, T1): the SuiteQL builders, cursor validation and
// row mapping into public.orders, public.order_lines, public.order_fulfillments
// and public.order_fulfillment_lines. No network, so Vitest runs it directly
// (see src/test/netsuite-orders.test.ts).
//
// Column names were confirmed against the Simplex sandbox (9738806-sb1) on
// 2026-10-31:
// - transaction.status is the bare letter ('B'), not 'SalesOrd:B'.
// - The header location is on the main line (transactionline.mainline = 'T').
// - transactionline quantity / quantitycommitted / quantityshiprecv are in the
//   unit type's BASE unit (SO1943 line 7: SuiteQL -1500, REST 3 x CASE of 500).
//   quantity is negative on outbound lines.
// - A TO item has three lines: the order line, a source-side shipping line
//   (negative, has transferorderitemlineid and quantitycommitted) and a
//   destination-side receiving line. WW fulfils the shipping line.
// - NextTransactionLineLink links each IF item line (nextline) to the SO or TO
//   line it fulfils (previousline); linktype PickPack (SO) or ShipRcpt (TO).
// - custbody_truck / custbody_simplex_trip_number / custbody_simplex_picked_by
//   are on both the SO and the IF (V29).
//
// No imports, like netsuite-customers.ts: the app's compiler rejects the `.ts`
// import paths Deno needs, and Vitest loads this file straight from the test.

/** SuiteQL caps a page at 1,000 rows. */
export const ORDER_PAGE_SIZE = 1000
/** Transactions per line query, so the IN list stays short. */
export const LINE_BATCH_SIZE = 100

/** SalesOrd / TrnfrOrd B Pending Fulfillment, D Partially Fulfilled, E Pending Billing/Partially Fulfilled. */
export const OPEN_ORDER_STATUSES = ['B', 'D', 'E'] as const
/** ItemShip A Picked, B Packed (unused at Simplex), C Shipped. */
export const OPEN_FULFILLMENT_STATUSES = ['A', 'B'] as const

/** Item types that are picked from stock; services, discounts and tax lines are not. */
const PICKABLE_ITEM_TYPES = ['InvtPart', 'Assembly']

/** `YYYY-MM-DD HH24:MI:SS` in the NetSuite account's own time zone. */
const CURSOR_PATTERN = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

export type OrderKind = 'sales' | 'transfer'

export type OrderHeaderRow = {
  id?: string
  tranid?: string
  type?: string
  status?: string
  trandate?: string
  shipdate?: string
  entity?: string
  entityname?: string
  otherrefnum?: string
  location?: string
  transferlocation?: string
  transferlocationname?: string
  truck_id?: string
  truck?: string
  trip?: string
  picker?: string
  printed?: string
  shipcomplete?: string
  modified?: string
}

export type OrderLineRow = {
  transaction?: string
  id?: string
  linesequencenumber?: string
  uniquekey?: string
  item?: string
  units?: string
  quantity?: string | number
  quantitycommitted?: string | number
  quantityshiprecv?: string | number
  isclosed?: string
}

export type FulfillmentHeaderRow = {
  id?: string
  tranid?: string
  status?: string
  trandate?: string
  createdfrom?: string
  location?: string
  truck_id?: string
  truck?: string
  trip?: string
  picker_id?: string
  picker?: string
  modified?: string
}

export type FulfillmentLineRow = {
  transaction?: string
  id?: string
  item?: string
  units?: string
  quantity?: string | number
  previousline?: string
}

export type MappedOrder = {
  externalId: string
  locationId: string
  order_number: string
  order_type: OrderKind
  external_status: string
  status: TaskStatus
  order_date: string | null
  requested_ship_date: string | null
  customer_external_id: string | null
  customer_name: string | null
  customer_reference: string | null
  destination_location_external_id: string | null
  destination_location_name: string | null
  truck_external_id: string | null
  truck_name: string | null
  trip_number: string | null
  picker_name: string | null
  picking_ticket_printed: boolean
  ship_complete: boolean
  source_modified_at: string | null
}

export type MappedOrderLine = {
  orderExternalId: string
  itemExternalId: string
  external_line_id: string
  external_line_key: string | null
  line_number: number | null
  ns_unit_id: string | null
  quantity: number
  committed_quantity: number
  fulfilled_quantity: number
  is_closed: boolean
}

export type MappedFulfillment = {
  externalId: string
  orderExternalId: string
  locationId: string | null
  document_number: string
  external_status: string
  fulfillment_date: string | null
  truck_external_id: string | null
  truck_name: string | null
  trip_number: string | null
  picker_external_id: string | null
  picker_name: string | null
  source_modified_at: string | null
}

export type MappedFulfillmentLine = {
  fulfillmentExternalId: string
  external_line_id: string
  order_external_line_id: string | null
  ns_item_id: string | null
  ns_unit_id: string | null
  quantity: number
}

export type TaskStatus = 'queued' | 'in_progress' | 'completed' | 'cancelled'

/** A cursor the delta may embed in SuiteQL, or null if it is not one. */
export function normalizeCursor(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const text = value.trim().replace('T', ' ').slice(0, 19)
  return CURSOR_PATTERN.test(text) ? text : null
}

/** Only digits reach SuiteQL as ids. */
export function safeIds(values: readonly unknown[]): string[] {
  const ids = new Set<string>()
  for (const value of values) {
    const text = typeof value === 'number' ? String(value) : typeof value === 'string' ? value.trim() : ''
    if (/^\d{1,12}$/.test(text)) ids.add(text)
  }
  return [...ids]
}

function safeAfterId(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0
}

function quoted(values: readonly string[]): string {
  return values.map((v) => `'${v}'`).join(',')
}

/**
 * One keyset page of SO and TO headers whose main-line location is mapped.
 * Without a cursor it reads the open statuses only (first import). With a
 * cursor it reads every order changed since then, so orders that close or are
 * billed leave the inbox.
 */
export function buildOrderHeaderQuery(opts: { afterId: number; since?: string | null; locationIds: readonly string[] }): string | null {
  const locations = safeIds(opts.locationIds)
  if (locations.length === 0) return null
  const since = normalizeCursor(opts.since ?? null)
  const filter = since
    ? `t.lastmodifieddate >= TO_DATE('${since}', 'YYYY-MM-DD HH24:MI:SS')`
    : `t.status IN (${quoted(OPEN_ORDER_STATUSES)})`
  return [
    'SELECT t.id, t.tranid, t.type, t.status,',
    " TO_CHAR(t.trandate, 'YYYY-MM-DD') AS trandate, TO_CHAR(t.shipdate, 'YYYY-MM-DD') AS shipdate,",
    ' t.entity, BUILTIN.DF(t.entity) AS entityname, t.otherrefnum, ml.location,',
    ' t.transferlocation, BUILTIN.DF(t.transferlocation) AS transferlocationname,',
    ' t.custbody_truck AS truck_id, BUILTIN.DF(t.custbody_truck) AS truck,',
    ' t.custbody_simplex_trip_number AS trip, BUILTIN.DF(t.custbody_simplex_picked_by) AS picker,',
    ' t.custbody_picking_ticket_printed AS printed, t.shipcomplete,',
    " TO_CHAR(t.lastmodifieddate, 'YYYY-MM-DD HH24:MI:SS') AS modified",
    " FROM transaction t JOIN transactionline ml ON ml.transaction = t.id AND ml.mainline = 'T'",
    ` WHERE t.type IN ('SalesOrd', 'TrnfrOrd') AND ml.location IN (${locations.join(',')})`,
    ` AND ${filter} AND t.id > ${safeAfterId(opts.afterId)}`,
    ' ORDER BY t.id',
  ].join('')
}

/**
 * The lines WW fulfils for a batch of orders: SO item lines, and the TO
 * source-side shipping line (it carries transferorderitemlineid and a negative
 * quantity). Ordered for offset paging.
 */
export function buildOrderLinesQuery(transactionIds: readonly string[]): string | null {
  const ids = safeIds(transactionIds)
  if (ids.length === 0) return null
  return [
    'SELECT tl.transaction, tl.id, tl.linesequencenumber, tl.uniquekey, tl.item, tl.units,',
    ' tl.quantity, tl.quantitycommitted, tl.quantityshiprecv, tl.isclosed',
    ' FROM transactionline tl JOIN transaction t ON t.id = tl.transaction',
    ` WHERE tl.transaction IN (${ids.join(',')})`,
    " AND tl.mainline = 'F' AND tl.taxline = 'F' AND tl.item IS NOT NULL",
    ` AND tl.itemtype IN (${quoted(PICKABLE_ITEM_TYPES)})`,
    " AND (t.type = 'SalesOrd' OR (tl.transferorderitemlineid IS NOT NULL AND tl.quantity < 0))",
    ' ORDER BY tl.transaction, tl.id',
  ].join('')
}

/**
 * One keyset page of item fulfillments made from an SO or TO at a mapped
 * location. Without a cursor it reads Picked and Packed only; with a cursor it
 * reads every IF changed since then, so Shipped ones update too.
 */
export function buildFulfillmentHeaderQuery(opts: { afterId: number; since?: string | null; locationIds: readonly string[] }): string | null {
  const locations = safeIds(opts.locationIds)
  if (locations.length === 0) return null
  const since = normalizeCursor(opts.since ?? null)
  const filter = since
    ? `t.lastmodifieddate >= TO_DATE('${since}', 'YYYY-MM-DD HH24:MI:SS')`
    : `t.status IN (${quoted(OPEN_FULFILLMENT_STATUSES)})`
  return [
    "SELECT t.id, t.tranid, t.status, TO_CHAR(t.trandate, 'YYYY-MM-DD') AS trandate,",
    ' ml.createdfrom, ml.location,',
    ' t.custbody_truck AS truck_id, BUILTIN.DF(t.custbody_truck) AS truck,',
    ' t.custbody_simplex_trip_number AS trip,',
    ' t.custbody_simplex_picked_by AS picker_id, BUILTIN.DF(t.custbody_simplex_picked_by) AS picker,',
    " TO_CHAR(t.lastmodifieddate, 'YYYY-MM-DD HH24:MI:SS') AS modified",
    " FROM transaction t JOIN transactionline ml ON ml.transaction = t.id AND ml.mainline = 'T'",
    ` WHERE t.type = 'ItemShip' AND ml.location IN (${locations.join(',')})`,
    ` AND ${filter} AND t.id > ${safeAfterId(opts.afterId)}`,
    ' ORDER BY t.id',
  ].join('')
}

/** IF item lines with the SO / TO line each one fulfils. Ordered for offset paging. */
export function buildFulfillmentLinesQuery(transactionIds: readonly string[]): string | null {
  const ids = safeIds(transactionIds)
  if (ids.length === 0) return null
  return [
    'SELECT tl.transaction, tl.id, tl.item, tl.units, tl.quantity, lnk.previousline',
    ' FROM transactionline tl',
    ' JOIN NextTransactionLineLink lnk ON lnk.nextdoc = tl.transaction AND lnk.nextline = tl.id',
    ` WHERE tl.transaction IN (${ids.join(',')})`,
    " AND lnk.linktype IN ('PickPack', 'ShipRcpt')",
    ' ORDER BY tl.transaction, tl.id',
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

function date(value: unknown): string | null {
  const raw = text(value)
  return raw && DATE_PATTERN.test(raw) ? raw : null
}

/** Base-unit quantity without the outbound minus sign. */
function quantity(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(typeof value === 'string' ? value.trim() : NaN)
  return Number.isFinite(n) ? Math.abs(n) : 0
}

/** BUILTIN.DF returns "- None -" or "0" for an empty list field on some accounts. */
function listText(value: unknown): string | null {
  const raw = text(value)
  if (!raw || raw === '0' || /^-\s*none\s*-$/i.test(raw)) return null
  return raw
}

/** WW task status for a NetSuite SO / TO status letter (outbound side). */
export function orderTaskStatus(status: string): TaskStatus {
  if (status === 'B' || status === 'D' || status === 'E') return 'queued'
  if (status === 'C' || status === 'H') return 'cancelled'
  // SO F/G are billed; TO F Pending Receipt / G Received have left the source.
  return 'completed'
}

export function isOpenOrderStatus(status: string): boolean {
  return (OPEN_ORDER_STATUSES as readonly string[]).includes(status)
}

/** Maps one header row; null when it lacks an id, number, type or location. */
export function mapOrderHeader(row: OrderHeaderRow): MappedOrder | null {
  const externalId = text(row.id)
  const orderNumber = text(row.tranid)
  const status = text(row.status)
  const locationId = text(row.location)
  const kind: OrderKind | null = row.type === 'SalesOrd' ? 'sales' : row.type === 'TrnfrOrd' ? 'transfer' : null
  if (!externalId || !orderNumber || !status || !locationId || !kind) return null
  return {
    externalId,
    locationId,
    order_number: orderNumber,
    order_type: kind,
    external_status: status,
    status: orderTaskStatus(status),
    order_date: date(row.trandate),
    requested_ship_date: date(row.shipdate),
    customer_external_id: kind === 'sales' ? text(row.entity) : null,
    customer_name: kind === 'sales' ? text(row.entityname) : null,
    customer_reference: text(row.otherrefnum),
    destination_location_external_id: kind === 'transfer' ? text(row.transferlocation) : null,
    destination_location_name: kind === 'transfer' ? text(row.transferlocationname) : null,
    truck_external_id: listText(row.truck_id),
    truck_name: listText(row.truck),
    trip_number: text(row.trip),
    picker_name: listText(row.picker),
    picking_ticket_printed: flag(row.printed),
    ship_complete: flag(row.shipcomplete),
    source_modified_at: normalizeCursor(row.modified),
  }
}

/** Maps one line row; null when it lacks the order, line id or item. */
export function mapOrderLine(row: OrderLineRow): MappedOrderLine | null {
  const orderExternalId = text(row.transaction)
  const lineId = text(row.id)
  const itemId = text(row.item)
  if (!orderExternalId || !lineId || !itemId) return null
  const seq = Number(row.linesequencenumber)
  return {
    orderExternalId,
    itemExternalId: itemId,
    external_line_id: lineId,
    external_line_key: text(row.uniquekey),
    line_number: Number.isInteger(seq) ? seq : null,
    ns_unit_id: text(row.units),
    quantity: quantity(row.quantity),
    committed_quantity: quantity(row.quantitycommitted),
    fulfilled_quantity: quantity(row.quantityshiprecv),
    is_closed: flag(row.isclosed),
  }
}

export function mapFulfillmentHeader(row: FulfillmentHeaderRow): MappedFulfillment | null {
  const externalId = text(row.id)
  const documentNumber = text(row.tranid)
  const status = text(row.status)
  const orderExternalId = text(row.createdfrom)
  if (!externalId || !documentNumber || !status || !orderExternalId) return null
  return {
    externalId,
    orderExternalId,
    locationId: text(row.location),
    document_number: documentNumber,
    external_status: status,
    fulfillment_date: date(row.trandate),
    truck_external_id: listText(row.truck_id),
    truck_name: listText(row.truck),
    trip_number: text(row.trip),
    picker_external_id: listText(row.picker_id),
    picker_name: listText(row.picker),
    source_modified_at: normalizeCursor(row.modified),
  }
}

export function mapFulfillmentLine(row: FulfillmentLineRow): MappedFulfillmentLine | null {
  const fulfillmentExternalId = text(row.transaction)
  const lineId = text(row.id)
  if (!fulfillmentExternalId || !lineId) return null
  return {
    fulfillmentExternalId,
    external_line_id: lineId,
    order_external_line_id: text(row.previousline),
    ns_item_id: text(row.item),
    ns_unit_id: text(row.units),
    quantity: quantity(row.quantity),
  }
}

/** The newer of two cursors. */
export function laterCursor(a: string | null, b: string | null): string | null {
  if (!a) return b
  if (!b) return a
  return b > a ? b : a
}
