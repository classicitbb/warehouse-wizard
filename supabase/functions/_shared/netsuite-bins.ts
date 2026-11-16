// Pure pieces of the bin mirror (Phase 1 task W5): the SuiteQL builder and the
// plan that matches Warehouse Wizard locations to NetSuite bins. No network, so
// Vitest runs it directly (see src/test/netsuite-bins.test.ts).
//
// Model: a WW warehouse is a NetSuite location (external_record_links,
// local_table 'warehouses', type 'location'); a WW location is a NetSuite bin
// (local_table 'locations', type 'bin'). The bin number is the WW location code,
// so a pallet's bin reads the same in both systems.
//
// Confirmed in the Simplex sandbox (9738806-sb1) on 2026-11-16: both NetSuite
// locations have usebins = 'T', the bin table is readable (binnumber, location,
// isinactive) and empty, and the role can list bin, binTransfer and binWorksheet.
//
// No imports, like netsuite-units.ts: the app's compiler rejects the `.ts`
// import paths Deno needs, and Vitest loads this file straight from the test.

/** SuiteQL caps a page at 1,000 rows. */
export const BINS_PAGE_SIZE = 1000

/** Bins created per call, so one request stays well inside the edge timeout. */
export const BIN_CREATE_BATCH = 100

export type NetSuiteBinRow = {
  id?: string | number
  binnumber?: string
  location?: string | number
  isinactive?: string
}

export type NetSuiteLocationRow = {
  id?: string | number
  name?: string
  usebins?: string
  isinactive?: string
}

export type WwLocation = {
  id: string
  code: string
  warehouseId: string
  status: string
}

export type WarehouseLink = {
  warehouseId: string
  warehouseName: string
  netsuiteLocationId: string
}

export type BinPlanWarehouse = {
  warehouseId: string
  warehouseName: string
  netsuiteLocationId: string
  netsuiteLocationName: string | null
  /** False when the NetSuite location is missing, inactive or has Use Bins off. */
  usesBins: boolean
  locations: number
  /** WW locations already linked to a NetSuite bin. */
  linked: number
  /** A bin with the same number exists in NetSuite but is not linked yet. */
  toLink: number
  /** No bin with this number at the location: one would be created. */
  toCreate: number
  /** The matching NetSuite bin is inactive; it is linked but left inactive. */
  inactiveMatches: number
}

export type BinAction =
  | { kind: 'link'; locationId: string; code: string; netsuiteBinId: string; netsuiteLocationId: string }
  | { kind: 'create'; locationId: string; code: string; netsuiteLocationId: string }

export type BinPlan = {
  warehouses: BinPlanWarehouse[]
  /** Warehouses with WW locations but no NetSuite location mapping. */
  unmappedWarehouses: string[]
  actions: BinAction[]
}

const text = (v: unknown) => (v === null || v === undefined ? '' : String(v).trim())

/** Bin numbers compare case-insensitively: NetSuite treats them as one name. */
export const binKey = (netsuiteLocationId: string, binNumber: string) =>
  `${netsuiteLocationId}|${binNumber.trim().toUpperCase()}`

/** Keyset page over every bin, oldest first. */
export function buildBinsPageQuery(afterId: number): string {
  const after = Number.isFinite(afterId) && afterId > 0 ? Math.floor(afterId) : 0
  return `SELECT id, binnumber, location, isinactive FROM bin WHERE id > ${after} ORDER BY id`
}

export function buildLocationsQuery(): string {
  return 'SELECT id, name, usebins, isinactive FROM location'
}

/**
 * Works out what to do for each WW location. `existingLinks` maps a WW
 * location id to the NetSuite bin id it is already linked to; a link whose bin
 * no longer exists in NetSuite is treated as missing and the bin is recreated.
 */
export function planBins(input: {
  warehouses: WarehouseLink[]
  unmappedWarehouses?: string[]
  locations: WwLocation[]
  netsuiteLocations: NetSuiteLocationRow[]
  netsuiteBins: NetSuiteBinRow[]
  existingLinks: Map<string, string>
}): BinPlan {
  const nsLocations = new Map<string, NetSuiteLocationRow>()
  for (const row of input.netsuiteLocations) nsLocations.set(text(row.id), row)

  const binsByKey = new Map<string, NetSuiteBinRow>()
  const binIds = new Set<string>()
  for (const bin of input.netsuiteBins) {
    const id = text(bin.id)
    if (!id) continue
    binIds.add(id)
    const number = text(bin.binnumber)
    if (number) binsByKey.set(binKey(text(bin.location), number), bin)
  }

  const byWarehouse = new Map<string, WwLocation[]>()
  for (const loc of input.locations) {
    const list = byWarehouse.get(loc.warehouseId) ?? []
    list.push(loc)
    byWarehouse.set(loc.warehouseId, list)
  }

  const actions: BinAction[] = []
  const warehouses: BinPlanWarehouse[] = []
  for (const wh of input.warehouses) {
    const nsLocation = nsLocations.get(wh.netsuiteLocationId)
    const usesBins = !!nsLocation && text(nsLocation.usebins) === 'T' && text(nsLocation.isinactive) !== 'T'
    const summary: BinPlanWarehouse = {
      warehouseId: wh.warehouseId,
      warehouseName: wh.warehouseName,
      netsuiteLocationId: wh.netsuiteLocationId,
      netsuiteLocationName: nsLocation ? text(nsLocation.name) || null : null,
      usesBins,
      locations: 0,
      linked: 0,
      toLink: 0,
      toCreate: 0,
      inactiveMatches: 0,
    }
    const seen = new Set<string>()
    for (const loc of (byWarehouse.get(wh.warehouseId) ?? []).sort((a, b) => a.code.localeCompare(b.code))) {
      const code = loc.code.trim()
      if (!code) continue
      const key = binKey(wh.netsuiteLocationId, code)
      // Two WW locations with the same code at one location would share a bin.
      if (seen.has(key)) continue
      seen.add(key)
      summary.locations++

      const linkedBin = input.existingLinks.get(loc.id)
      if (linkedBin && binIds.has(linkedBin)) {
        summary.linked++
        continue
      }
      const match = binsByKey.get(key)
      if (match) {
        summary.toLink++
        if (text(match.isinactive) === 'T') summary.inactiveMatches++
        actions.push({ kind: 'link', locationId: loc.id, code, netsuiteBinId: text(match.id), netsuiteLocationId: wh.netsuiteLocationId })
        continue
      }
      summary.toCreate++
      if (usesBins) actions.push({ kind: 'create', locationId: loc.id, code, netsuiteLocationId: wh.netsuiteLocationId })
    }
    warehouses.push(summary)
  }

  return { warehouses, unmappedWarehouses: input.unmappedWarehouses ?? [], actions }
}

/** REST body for POST /record/v1/bin. */
export function buildBinCreateBody(action: Extract<BinAction, { kind: 'create' }>) {
  return { binNumber: action.code, location: { id: action.netsuiteLocationId } }
}
