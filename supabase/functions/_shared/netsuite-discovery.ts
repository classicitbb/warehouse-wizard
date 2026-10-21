// Read-only discovery of NetSuite field and sublist ids (J10). The real names
// come from the account itself: the metadata catalog for standard REST
// records, and the RESTlet's own GET for the inbound shipment, which is not in
// the catalog.

// The records the receiving flows touch. Fixed on purpose: this function takes
// no free-form path, so it cannot be pointed at anything else.
export const DISCOVERY_RECORDS = [
  'purchaseOrder',
  'transferOrder',
  'salesOrder',
  'returnAuthorization',
  'itemReceipt',
  'itemFulfillment',
] as const

export type DiscoveryRecord = (typeof DISCOVERY_RECORDS)[number]

export function isDiscoveryRecord(value: unknown): value is DiscoveryRecord {
  return typeof value === 'string' && (DISCOVERY_RECORDS as readonly string[]).includes(value)
}

type JsonObject = Record<string, unknown>

function asObject(value: unknown): JsonObject | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonObject) : null
}

function describeType(schema: JsonObject): string {
  if (typeof schema.$ref === 'string') return `ref:${schema.$ref.split('/').pop()}`
  const type = schema.type
  const base = Array.isArray(type) ? type.join('|') : typeof type === 'string' ? type : 'unknown'
  const format = typeof schema.format === 'string' ? `(${schema.format})` : ''
  return `${base}${format}`
}

function fieldTypes(properties: JsonObject): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [name, def] of Object.entries(properties)) {
    const obj = asObject(def)
    out[name] = obj ? describeType(obj) : 'unknown'
  }
  return out
}

export type SchemaSummary = {
  bodyFields: Record<string, string>
  /** Sublist id -> its line field ids. */
  sublists: Record<string, Record<string, string>>
}

/**
 * Reduces a NetSuite record JSON schema to field ids and types. A sublist is
 * an object with an `items` array of line objects (the REST sublist shape);
 * `$ref` targets are followed through `definitions` / `$defs` when present.
 */
export function summariseSchema(schema: unknown): SchemaSummary {
  const root = asObject(schema) ?? {}
  const definitions = asObject(root.definitions) ?? asObject(root.$defs) ?? {}

  const resolve = (node: unknown): JsonObject | null => {
    const obj = asObject(node)
    if (!obj) return null
    if (typeof obj.$ref === 'string') {
      const target = asObject(definitions[obj.$ref.split('/').pop() ?? ''])
      return target ?? obj
    }
    return obj
  }

  const bodyFields: Record<string, string> = {}
  const sublists: Record<string, Record<string, string>> = {}
  const properties = asObject(resolve(root)?.properties) ?? {}

  for (const [name, def] of Object.entries(properties)) {
    const node = resolve(def)
    const lineItems = resolve(asObject(asObject(node?.properties)?.items)?.items)
    const linePropertiesNode = asObject(lineItems?.properties)
    if (linePropertiesNode) {
      sublists[name] = fieldTypes(linePropertiesNode)
    } else {
      bodyFields[name] = node ? describeType(node) : 'unknown'
    }
  }
  return { bodyFields, sublists }
}
