// Client for the netsuite-inbound edge function (Receiving > View inbound). Types
// mirror the function's response; the query building and row mapping live in
// supabase/functions/_shared/netsuite-inbound.ts.

import { supabase } from "@/integrations/supabase/client";
import { describeInvokeError } from "@/features/receiving/netsuite-lookup";

export type InboundStatusFilter = "open" | "received" | "all";
export type InboundSortKey = "expected_delivery" | "shipment_number" | "status";
export type InboundSortDirection = "asc" | "desc";

export const INBOUND_PAGE_SIZE = 25;
export const INBOUND_MAX_ROWS = 200;

export interface InboundShipmentSummary {
  id: string;
  number: string;
  /** From the shipment's Container No field. One shipment can hold several. */
  containers: string[];
  /** The carrier's reference, where the container number is expected. */
  externalDocumentNumber: string;
  billOfLading: string;
  vesselNumber: string;
  status: { code: string | null; label: string };
  expectedDeliveryDate: string | null;
  actualShippingDate: string | null;
  memo: string;
  poCount: number;
  lineCount: number;
  quantityExpected: number;
}

export interface InboundShipmentLine {
  shipmentLineId: string;
  lineKey: string | null;
  lineNumber: number | null;
  itemId: string | null;
  itemName: string;
  description: string;
  quantityExpected: number;
  quantityReceived: number | null;
  quantityRemaining: number;
  unit: string | null;
  location: { id: string; name: string } | null;
  /** Null when the NetSuite item has not been imported into Warehouse Wizard. */
  localProductId: string | null;
}

export interface InboundShipmentPo {
  poId: string;
  poNumber: string;
  vendor: string;
  lines: InboundShipmentLine[];
}

export interface InboundShipmentDetail {
  shipmentId: string;
  pos: InboundShipmentPo[];
  receivedKnown: boolean;
}

export interface InboundListParams {
  search: string;
  status: InboundStatusFilter;
  sort: InboundSortKey;
  direction: InboundSortDirection;
  limit: number;
}

export type InboundListResult =
  /** `containerField` is null when NetSuite's Container No field could not be found. */
  | { kind: "ok"; shipments: InboundShipmentSummary[]; hasMore: boolean; containerField: string | null }
  | { kind: "unavailable"; message: string };

export type InboundDetailResult =
  | { kind: "ok"; detail: InboundShipmentDetail }
  | { kind: "unavailable"; message: string };

async function invoke(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke("netsuite-inbound", { body });
  if (error) throw new Error(await describeInvokeError(error));
  return data;
}

export async function listInboundShipments(params: InboundListParams): Promise<InboundListResult> {
  const data = await invoke({ action: "list", ...params });
  if (data?.unavailable) return { kind: "unavailable", message: String(data.message ?? "NetSuite is unavailable") };
  return { kind: "ok", shipments: (data?.shipments ?? []) as InboundShipmentSummary[], hasMore: Boolean(data?.hasMore), containerField: typeof data?.containerField === "string" ? data.containerField : null };
}

export async function getInboundShipmentDetail(shipmentId: string): Promise<InboundDetailResult> {
  const data = await invoke({ action: "detail", shipmentId });
  if (data?.unavailable) return { kind: "unavailable", message: String(data.message ?? "NetSuite is unavailable") };
  return { kind: "ok", detail: data.detail as InboundShipmentDetail };
}

/** Shared by the preview and the Receive button, so opening a card and receiving it make one call. */
export function inboundDetailQuery(shipmentId: string) {
  return {
    queryKey: ["netsuite-inbound-detail", shipmentId] as const,
    queryFn: () => getInboundShipmentDetail(shipmentId),
    staleTime: 30_000,
  };
}

/** Open shipments that carry this PO. An unavailable NetSuite reads as "none", so it never blocks the PO lookup. */
export async function findOpenShipmentsForPo(poId: string): Promise<InboundShipmentSummary[]> {
  try {
    const data = await invoke({ action: "for_po", poId });
    return data?.unavailable ? [] : ((data?.shipments ?? []) as InboundShipmentSummary[]);
  } catch {
    return [];
  }
}
