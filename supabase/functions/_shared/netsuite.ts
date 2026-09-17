// IMPORTANT: This is a Deno-side copy of `netsuiteAdjustmentExternalId`,
// `buildNetSuiteInventoryAdjustment` and `mapNetSuiteItemToProduct` from `src/lib/enterprise-wms.ts`
// (plus its dependencies `inferProductCategory` / `normalizeTemperature`
// from `src/features/reports/reports-core.ts` and `src/lib/enterprise-wms.ts`).
// Deno edge functions cannot import from `src/lib`, so we keep a duplicate here.
// If you change one, change the other so the payload shape stays byte-for-byte identical.

// NetSuite REST hostnames use the account id lowercased with underscores
// replaced by hyphens (e.g. `9738806_SB1` -> `9738806-sb1.suitetalk...`).
// Passing the raw account id produces a DNS lookup failure.
export function netsuiteHost(accountId: string): string {
  return `${accountId.trim().toLowerCase().replace(/_/g, '-')}.suitetalk.api.netsuite.com`;
}


// NetSuite's X-NetSuite-Idempotency-Key header is honoured only for async
// (`Prefer: respond-async`) requests and ignored on synchronous ones. Instead,
// the record carries an externalId derived from the sync job's idempotency key:
// NetSuite rejects a second record with the same externalId, and the worker can
// look an earlier attempt up at `inventoryAdjustment/eid:<externalId>`.
// External IDs allow only letters, digits, `_` and `-`.
export function netsuiteAdjustmentExternalId(jobIdempotencyKey: string): string {
  return `ww-inventory-adjustment-${jobIdempotencyKey.replace(/[^A-Za-z0-9_-]/g, "-")}`;
}

// The request body for POST /services/rest/record/v1/inventoryAdjustment.
// Every reference is a NetSuite internal id. Subsidiary is sent only when
// configured; otherwise NetSuite applies its default.
export function buildNetSuiteInventoryAdjustment(input: {
  externalId: string;
  adjustmentAccountId: string;
  subsidiaryId?: string | null;
  itemId: string;
  locationId: string;
  quantityDelta: number;
  memo: string;
}) {
  return {
    externalId: input.externalId,
    account: { id: input.adjustmentAccountId },
    ...(input.subsidiaryId ? { subsidiary: { id: input.subsidiaryId } } : {}),
    memo: input.memo,
    inventory: {
      items: [
        {
          item: { id: input.itemId },
          location: { id: input.locationId },
          adjustQtyBy: input.quantityDelta,
        },
      ],
    },
  };
}

// ── mapNetSuiteItemToProduct (Deno copy) ────────────────────────────────────

export type NetSuiteItemPayload = {
  id: string;
  itemId: string;
  displayName?: string;
  upcCode?: string;
  custitem_temperature_class?: string;
  custitem_lot_tracked?: boolean;
  custitem_expiry_tracked?: boolean;
  isInactive?: boolean;
};

export type MappedProductPayload = {
  external_system: string;
  external_id: string;
  sku: string;
  barcode: string | null;
  name: string;
  temperature_requirement: string;
  lot_tracked: boolean;
  expiry_tracked: boolean;
  batch_tracked: boolean;
  rotation_method: string;
  active: boolean;
  auto_categorised: boolean;
  category_label: string | null;
};

type ProductCategory = {
  label: string;
  temperature_requirement: string;
  rotation_method: string;
  expiry_tracked: boolean;
  lot_tracked: boolean;
  batch_tracked: boolean;
};

const CATEGORY_RULES: { label: string; keywords: RegExp; category: Omit<ProductCategory, "label"> }[] = [
  {
    label: "Medical / PPE",
    keywords: /\b(glove|nitrile|latex|vinyl|exam\s*glove|surgical|mask|ppe|medical|pharmaceutical|pharma|drug|medication|bandage|dressing)\b/i,
    category: { temperature_requirement: "ambient", rotation_method: "fefo", expiry_tracked: true, lot_tracked: true, batch_tracked: true },
  },
  {
    label: "Cleaning / Chemical",
    keywords: /\b(disinfectant|cleaner|detergent|sanitizer|bleach|degreaser|dishwash|laundry|soap|chemical|solvent|acid|alkali)\b/i,
    category: { temperature_requirement: "ambient", rotation_method: "fifo", expiry_tracked: true, lot_tracked: false, batch_tracked: false },
  },
  {
    label: "Paper / Disposables",
    keywords: /\b(tissue|toilet\s*paper|paper\s*towel|napkin|bathroom\s*tissue|roll\s*towel|pan\s*liner|parchment|wrap|film|bag|cup|plate|container|tray|box|carton|packaging|disposable|cutlery|straw)\b/i,
    category: { temperature_requirement: "ambient", rotation_method: "fifo", expiry_tracked: false, lot_tracked: false, batch_tracked: false },
  },
  {
    label: "Household / Cleaning Supplies",
    keywords: /\b(sponge|scouring|cloth|wipe|mop|broom|brush|scrub|pad)\b/i,
    category: { temperature_requirement: "ambient", rotation_method: "fifo", expiry_tracked: false, lot_tracked: false, batch_tracked: false },
  },
];

export function inferProductCategory(name: string, description?: string): ProductCategory | null {
  const haystack = `${name} ${description ?? ""}`.toLowerCase();
  for (const rule of CATEGORY_RULES) {
    if (rule.keywords.test(haystack)) {
      return { label: rule.label, ...rule.category };
    }
  }
  return null;
}

function normalizeTemperature(value: string | undefined) {
  const normalized = value?.toLowerCase();
  if (normalized === "cool" || normalized === "frozen") return normalized;
  return "ambient";
}

export function mapNetSuiteItemToProduct(payload: NetSuiteItemPayload): MappedProductPayload {
  const name = payload.displayName || payload.itemId;
  const hasTemperature = Boolean(payload.custitem_temperature_class?.trim());
  const hasTracking = payload.custitem_lot_tracked != null || payload.custitem_expiry_tracked != null;

  const inferred = (!hasTemperature || !hasTracking) ? inferProductCategory(name) : null;

  const temperature_requirement = hasTemperature
    ? normalizeTemperature(payload.custitem_temperature_class)
    : (inferred?.temperature_requirement ?? "ambient");

  const expiry_tracked = payload.custitem_expiry_tracked != null
    ? Boolean(payload.custitem_expiry_tracked)
    : (inferred?.expiry_tracked ?? false);

  const lot_tracked = payload.custitem_lot_tracked != null
    ? Boolean(payload.custitem_lot_tracked)
    : (inferred?.lot_tracked ?? false);

  const batch_tracked = inferred?.batch_tracked ?? false;
  const rotation_method = expiry_tracked ? "fefo" : (inferred?.rotation_method ?? "fifo");

  return {
    external_system: "netsuite",
    external_id: payload.id,
    sku: payload.itemId,
    barcode: payload.upcCode ?? null,
    name,
    temperature_requirement,
    lot_tracked,
    expiry_tracked,
    batch_tracked,
    rotation_method,
    active: !payload.isInactive,
    auto_categorised: inferred !== null,
    category_label: inferred?.label ?? null,
  };
}

/**
 * Match-by-SKU upsert into `products` plus the `external_record_links` row
 * linking it back to the NetSuite item. Shared by the inbound webhook's
 * `item` flow and the Settings "import selected products" picker so the
 * two entry points can't drift out of sync.
 */
export async function upsertProductFromNetSuiteItem(
  // deno-lint-ignore no-explicit-any
  service: any,
  mapped: MappedProductPayload,
  fallbackExternalId: string,
): Promise<{ localProductId: string }> {
  const { data: existingProduct } = await service
    .from("products")
    .select("id")
    .eq("sku", mapped.sku)
    .maybeSingle();

  const productRow = {
    sku: mapped.sku,
    name: mapped.name,
    barcode: mapped.barcode,
    temperature_requirement: mapped.temperature_requirement as "ambient" | "cool" | "frozen",
    lot_tracked: mapped.lot_tracked,
    expiry_tracked: mapped.expiry_tracked,
    batch_tracked: mapped.batch_tracked,
    rotation_method: mapped.rotation_method as "fifo" | "fefo" | "lifo",
    active: mapped.active,
  };

  let localProductId: string;
  if (existingProduct?.id) {
    localProductId = existingProduct.id;
    const { error: updateErr } = await service
      .from("products")
      .update(productRow)
      .eq("id", existingProduct.id);
    if (updateErr) throw updateErr;
  } else {
    const { data: inserted, error: insertProductErr } = await service
      .from("products")
      .insert(productRow)
      .select("id")
      .single();
    if (insertProductErr || !inserted) throw insertProductErr ?? new Error("Product insert failed");
    localProductId = inserted.id;
  }

  // Unique key on external_record_links is (system, local_table, local_id, external_record_type).
  await service.from("external_record_links").upsert(
    {
      system: "netsuite",
      local_table: "products",
      local_id: localProductId,
      external_record_type: "item",
      external_id: mapped.external_id || fallbackExternalId,
      last_synced_at: new Date().toISOString(),
    },
    { onConflict: "system,local_table,local_id,external_record_type" },
  );

  return { localProductId };
}

/** Constant-time byte comparison for shared secrets. */
export function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  if (ab.byteLength !== bb.byteLength) {
    // Still walk one buffer to keep timing roughly constant.
    let diff = 1;
    for (let i = 0; i < ab.byteLength; i++) diff |= ab[i] ^ ab[i];
    return diff === 0 && false;
  }
  let diff = 0;
  for (let i = 0; i < ab.byteLength; i++) diff |= ab[i] ^ bb[i];
  return diff === 0;
}

/**
 * Deterministic serialisation used to derive an idempotency key from a webhook
 * body. Keys are sorted recursively because NetSuite does not guarantee
 * property order, and two byte-different serialisations of the same record
 * must not yield two different keys.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}

/** Short SHA-256 of `canonicalJson(value)`, for idempotency keys. */
export async function payloadDigest(value: unknown, chars = 16): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson(value));
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, chars);
}
