// Turns an inbound shipment (header + PO lines) into Receiving shipment lines, and
// answers the two questions the browser needs about the form and the drafts:
// which container to prefill, and whether the shipment already has drafts. Pure,
// so it is unit-tested without rendering the screen.

import { newShipmentLine, parseDraftMeta, type ReceivingShipmentLineState } from "@/features/receiving/receiving-form-state";
import type { NetSuiteLineLoad, NetSuiteLineLoadHelpers, SkippedNetSuiteLine } from "@/features/receiving/netsuite-lookup-lines";
import type { InboundShipmentDetail, InboundShipmentSummary } from "@/features/receiving/netsuite-inbound";
import { normalizeContainerNumber, validateIso6346ContainerNumber } from "@/lib/container-number";

/**
 * The containers on a shipment. Simplex keeps them in a custom Container No field
 * ("SMLU7872173, SMLU3120938"), which the edge function has already split. If that
 * field is empty or could not be found, fall back to the carrier reference, bill
 * of lading and vessel number: the first that is a valid ISO 6346 number, else the
 * carrier reference as typed so the form shows it flagged rather than blank.
 */
export function containersOf(shipment: Pick<InboundShipmentSummary, "containers" | "externalDocumentNumber" | "billOfLading" | "vesselNumber">): string[] {
  if (shipment.containers?.length) return shipment.containers.map((c) => normalizeContainerNumber(c)).filter(Boolean);
  const candidates = [shipment.externalDocumentNumber, shipment.billOfLading, shipment.vesselNumber].map((v) => v.trim()).filter(Boolean);
  for (const candidate of candidates) {
    const result = validateIso6346ContainerNumber(candidate);
    if (result.valid) return [result.normalized];
  }
  return candidates[0] ? [normalizeContainerNumber(candidates[0]) || candidates[0]] : [];
}

/** The first container, for callers that need exactly one (search hints, "show drafts"). */
export function pickContainerNumber(shipment: Parameters<typeof containersOf>[0]): string {
  return containersOf(shipment)[0] ?? "";
}

/**
 * One shipment line per NetSuite line still receivable, across every PO on the
 * shipment. As with the PO lookup, quantity starts at what NetSuite still expects
 * and is deliberately not pre-split into pallets.
 */
export function buildShipmentLinesFromInbound(
  shipment: Pick<InboundShipmentSummary, "id" | "number"> & Partial<Pick<InboundShipmentSummary, "containers" | "externalDocumentNumber" | "billOfLading" | "vesselNumber">>,
  detail: InboundShipmentDetail,
  helpers: NetSuiteLineLoadHelpers,
): NetSuiteLineLoad {
  const lines: ReceivingShipmentLineState[] = [];
  const skipped: SkippedNetSuiteLine[] = [];
  const containerCount = containersOf({ containers: [], externalDocumentNumber: "", billOfLading: "", vesselNumber: "", ...shipment }).length;

  for (const po of detail.pos) {
    for (const source of po.lines) {
      const info = { lineNumber: source.lineNumber, itemName: source.itemName || source.description, poNumber: po.poNumber };
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
          ordered: source.quantityExpected,
          received: source.quantityReceived ?? 0,
          remaining: source.quantityRemaining,
          poId: po.poId,
          poNumber: po.poNumber,
          inboundShipmentId: shipment.id,
          inboundShipmentNumber: shipment.number,
          ...(containerCount > 1 ? { inboundContainerCount: containerCount } : {}),
        },
      });
    }
  }
  return { lines, skipped };
}

/** The shipment and POs the form's lines came from; null when none came from an inbound shipment. */
export function summarizeInboundLines(
  lines: Pick<ReceivingShipmentLineState, "netsuite">[],
): { shipmentNumber: string; poNumbers: string[]; containerCount: number } | null {
  const first = lines.find((l) => l.netsuite?.inboundShipmentId);
  if (!first?.netsuite) return null;
  const poNumbers = [...new Set(lines.map((l) => l.netsuite?.poNumber).filter((n): n is string => Boolean(n)))];
  return { shipmentNumber: first.netsuite.inboundShipmentNumber ?? "", poNumbers, containerCount: first.netsuite.inboundContainerCount ?? 1 };
}

type DraftLike = { container_number?: string | null; notes?: string | null };

/**
 * Drafts that already stand for this shipment, or for one container of it. A draft
 * counts when it is for the same container, or (only when the shipment holds a single
 * container) carries the shipment's NetSuite id. With several containers the id alone
 * proves nothing: receiving the second container must not be blocked by the first's drafts.
 */
export function findShipmentDrafts<T extends DraftLike>(drafts: T[], shipment: InboundShipmentSummary, container?: string): T[] {
  const containers = containersOf(shipment);
  const wanted = new Set((container ? [container] : containers).map((c) => (normalizeContainerNumber(c) || c).toUpperCase()));
  const singleContainer = containers.length <= 1;
  return drafts.filter((draft) => {
    const meta = parseDraftMeta(draft.notes);
    if (singleContainer && meta.netsuite?.inboundShipmentId === shipment.id) return true;
    const draftContainer = String(draft.container_number ?? meta.container_number ?? "").trim();
    return Boolean(draftContainer && wanted.has((normalizeContainerNumber(draftContainer) || draftContainer).toUpperCase()));
  });
}
