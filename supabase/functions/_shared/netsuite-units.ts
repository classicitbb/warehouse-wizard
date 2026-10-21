// Pure pieces of the NetSuite units import (outbound picking design, slice A):
// the SuiteQL builders and row mapping into public.uom_types, public.uom_units
// and the product unit columns. No network, so Vitest runs it directly (see
// src/test/netsuite-units.test.ts).
//
// Column names were confirmed against the Simplex sandbox (9738806-sb1) on
// 2026-10-16: 327 unitstype rows, 701 unitstypeuom rows (internalid, unitstype,
// unitname, pluralname, abbreviation, pluralabbreviation, conversionrate,
// baseunit 'T'/'F', inuse 'T'/'F'), exactly one base unit per type, integer
// conversion rates, and 5,484 items with unitstype / stockunit / saleunit /
// purchaseunit holding unitstypeuom internal ids.
//
// No imports, like netsuite-customers.ts: the app's compiler rejects the `.ts`
// import paths Deno needs, and Vitest loads this file straight from the test.

/** SuiteQL caps a page at 1,000 rows. */
export const UNITS_PAGE_SIZE = 1000

export type UnitRow = {
  type_id?: string
  type_name?: string
  type_inactive?: string
  unit_id?: string
  unitname?: string
  pluralname?: string
  abbreviation?: string
  pluralabbreviation?: string
  conversionrate?: string | number
  baseunit?: string
  inuse?: string
}

export type ItemUnitRow = {
  id?: string
  unitstype?: string
  stockunit?: string
  saleunit?: string
  purchaseunit?: string
}

export type MappedUomType = {
  ns_internal_id: string
  name: string
  is_inactive: boolean
}

export type MappedUomUnit = {
  typeExternalId: string
  ns_internal_id: string
  unit_name: string
  plural_name: string | null
  abbreviation: string | null
  plural_abbreviation: string | null
  conversion_rate: number
  is_base: boolean
  in_use: boolean
}

export type MappedItemUnits = {
  itemId: string
  unitstype: string | null
  stockunit: string | null
  saleunit: string | null
  purchaseunit: string | null
}

function safeAfterId(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0
}

/** One keyset page of units joined to their type, ordered by unit internal id. */
export function buildUnitsPageQuery(afterId: number): string {
  return [
    'SELECT t.id AS type_id, t.name AS type_name, t.isinactive AS type_inactive,',
    ' u.internalid AS unit_id, u.unitname, u.pluralname, u.abbreviation, u.pluralabbreviation,',
    ' u.conversionrate, u.baseunit, u.inuse',
    ' FROM unitstype t JOIN unitstypeuom u ON u.unitstype = t.id',
    ` WHERE u.internalid > ${safeAfterId(afterId)}`,
    ' ORDER BY u.internalid',
  ].join('')
}

/** One keyset page of items that carry a unit type, ordered by internal id. */
export function buildItemUnitsPageQuery(afterId: number): string {
  return [
    'SELECT i.id, i.unitstype, i.stockunit, i.saleunit, i.purchaseunit',
    ' FROM item i',
    ` WHERE i.unitstype IS NOT NULL AND i.id > ${safeAfterId(afterId)}`,
    ' ORDER BY i.id',
  ].join('')
}

function text(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

function flag(value: unknown): boolean {
  return value === 'T' || value === true
}

/** Maps one joined row to its type and unit; null when an id or the unit name is missing or the rate is not positive. */
export function mapUnitRow(row: UnitRow): { type: MappedUomType; unit: MappedUomUnit } | null {
  const typeId = text(row.type_id)
  const unitId = text(row.unit_id)
  const unitName = text(row.unitname)
  const rate = Number(text(row.conversionrate))
  if (!typeId || !unitId || !unitName || !Number.isFinite(rate) || rate <= 0) return null
  return {
    type: {
      ns_internal_id: typeId,
      name: text(row.type_name) ?? typeId,
      is_inactive: flag(row.type_inactive),
    },
    unit: {
      typeExternalId: typeId,
      ns_internal_id: unitId,
      unit_name: unitName,
      plural_name: text(row.pluralname),
      abbreviation: text(row.abbreviation),
      plural_abbreviation: text(row.pluralabbreviation),
      conversion_rate: rate,
      is_base: flag(row.baseunit),
      // NetSuite leaves inuse blank on some rows; treat blank as in use.
      in_use: row.inuse === undefined || row.inuse === null || row.inuse === '' ? true : flag(row.inuse),
    },
  }
}

/** Maps a page of joined rows, de-duplicating the types. */
export function collectUnits(rows: UnitRow[]): { types: MappedUomType[]; units: MappedUomUnit[]; skipped: number } {
  const types = new Map<string, MappedUomType>()
  const units: MappedUomUnit[] = []
  let skipped = 0
  for (const row of rows) {
    const mapped = mapUnitRow(row)
    if (!mapped) {
      skipped++
      continue
    }
    types.set(mapped.type.ns_internal_id, mapped.type)
    units.push(mapped.unit)
  }
  return { types: [...types.values()], units, skipped }
}

/** Maps one item row; null without an internal id. */
export function mapItemUnitRow(row: ItemUnitRow): MappedItemUnits | null {
  const itemId = text(row.id)
  if (!itemId) return null
  return {
    itemId,
    unitstype: text(row.unitstype),
    stockunit: text(row.stockunit),
    saleunit: text(row.saleunit),
    purchaseunit: text(row.purchaseunit),
  }
}
