// Turns a NetSuite lookup result into Receiving shipment lines. Pure, so the
// mapping is unit-tested without rendering the screen.

import { newShipmentLine, type ReceivingShipmentLineState } from "@/features/receiving/receiving-form-state";
import type { NetSuiteDocumentType, NetSuiteLookupDocument } from "@/features/receiving/netsuite-lookup";

export function documentTypeForReceipt(receiptType: string): NetSuiteDocumentType | null {
  if (receiptType === "po") return "purchase_order";
  if (receiptType === "transfer") return "transfer_order";
  return null;
}

export type SkippedNetSuiteLine = {
  lineNumber: number | null;
  itemName: string;
  reason: "item_not_imported" | "nothing_remaining";
};

export type NetSuiteLineLoad = {
  lines: ReceivingShipmentLineState[];
  skipped: SkippedNetSuiteLine[];
};

export type NetSuiteLineLoadHelpers = {
  productExpiryTracked: (productId: string) => boolean;
  defaultExpiryDate: () => string;
  defaultPackagingProfileId: (productId: string) => string;
};

/**
 * One shipment line per NetSuite line that can still be received. Quantity
 * starts at what NetSuite still expects; the operator changes it to what is
 * physically there. It is deliberately not pre-split into pallets: the split
 * depends on the pack standard and on what is actually on the floor.
 */
export function buildShipmentLinesFromLookup(
  document: NetSuiteLookupDocument,
  helpers: NetSuiteLineLoadHelpers,
): NetSuiteLineLoad {
  const lines: ReceivingShipmentLineState[] = [];
  const skipped: SkippedNetSuiteLine[] = [];

  for (const source of document.lines) {
    const info = { lineNumber: source.lineNumber, itemName: source.itemName || source.description };
    if (source.quantityRemaining <= 0) {
      skipped.push({ ...info, reason: "nothing_remaining" });
      continue;
    }
    if (!source.localProductId) {
      skipped.push({ ...info, reason: "item_not_imported" });
      continue;
    }
    const productId = source.localProductId;
    lines.push({
      ...newShipmentLine(productId),
      total_quantity: source.quantityRemaining,
      quantity_per_pallet: source.quantityRemaining,
      pallet_count: 1,
      packaging_profile_id: helpers.defaultPackagingProfileId(productId),
      expiry_date: helpers.productExpiryTracked(productId) ? helpers.defaultExpiryDate() : "",
      netsuite: {
        lineKey: source.lineKey,
        lineNumber: source.lineNumber,
        itemName: source.itemName,
        ordered: source.quantityOrdered,
        received: source.quantityReceived,
        remaining: source.quantityRemaining,
      },
    });
  }
  return { lines, skipped };
}

/**
 * Merges freshly loaded lines into the form. Untouched blank lines make way;
 * lines the operator already filled in are kept, except those that came from
 * the same NetSuite line, which the new load replaces (so looking a document
 * up twice cannot duplicate it).
 */
export function mergeLoadedLines(
  current: ReceivingShipmentLineState[],
  loaded: ReceivingShipmentLineState[],
): ReceivingShipmentLineState[] {
  const incomingKeys = new Set(loaded.map((l) => l.netsuite?.lineKey).filter((k): k is string => Boolean(k)));
  const kept = current.filter((l) => {
    if (!l.product_id) return false;
    const key = l.netsuite?.lineKey;
    return !(key && incomingKeys.has(key));
  });
  return [...kept, ...loaded];
}

export type LineVariance = { kind: "exact" } | { kind: "short" | "over"; by: number };

/** How the quantity being received compares with what NetSuite still expected. */
export function lineVariance(line: Pick<ReceivingShipmentLineState, "total_quantity" | "netsuite">): LineVariance | null {
  if (!line.netsuite) return null;
  const received = Number(line.total_quantity) || 0;
  const diff = received - line.netsuite.remaining;
  if (diff === 0) return { kind: "exact" };
  return diff < 0 ? { kind: "short", by: -diff } : { kind: "over", by: diff };
}
