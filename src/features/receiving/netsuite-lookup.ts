// Client for the netsuite-lookup edge function (Phase 1, W2). Types mirror the
// function's response; the normalising itself lives in
// supabase/functions/_shared/netsuite-lookup.ts.

import { supabase } from "@/integrations/supabase/client";

export type NetSuiteDocumentType = "purchase_order" | "transfer_order";

export interface NetSuiteLookupLine {
  lineKey: string | null;
  lineNumber: number | null;
  itemId: string | null;
  itemName: string;
  description: string;
  quantityOrdered: number;
  quantityFulfilled: number | null;
  quantityReceived: number;
  quantityRemaining: number;
  unit: string | null;
  location: { id: string; name: string } | null;
  closed: boolean;
  /** Null when the NetSuite item has not been imported into Warehouse Wizard. */
  localProductId: string | null;
}

export interface NetSuiteLookupDocument {
  type: NetSuiteDocumentType;
  internalId: string;
  number: string;
  status: { code: string | null; label: string };
  entity: { id: string; name: string } | null;
  location: { id: string; name: string } | null;
  tranDate: string | null;
  memo: string;
  lines: NetSuiteLookupLine[];
}

export interface NetSuiteLookupCandidate {
  internalId: string;
  number: string;
  tranDate: string | null;
  status: string;
  entity: string;
}

export type NetSuiteLookupResult =
  | { kind: "found"; document: NetSuiteLookupDocument }
  | { kind: "not_found" }
  | { kind: "ambiguous"; candidates: NetSuiteLookupCandidate[] }
  | { kind: "unavailable"; message: string };

// supabase-js reports any non-2xx as "Edge Function returned a non-2xx status
// code" and keeps the function's own message on error.context. Surface that
// message (permission denied, NetSuite busy, ...) rather than the generic one.
export async function describeInvokeError(error: { message: string; context?: unknown }): Promise<string> {
  const context = error.context;
  if (context instanceof Response) {
    const body = await context.clone().json().catch(() => null);
    if (body && typeof body.error === "string") return body.error;
    return `NetSuite lookup failed (${context.status}).`;
  }
  return "Could not reach the NetSuite lookup. Check the connection and try again.";
}

export async function lookupNetSuiteDocument(
  documentType: NetSuiteDocumentType,
  documentNumber: string,
): Promise<NetSuiteLookupResult> {
  const { data, error } = await supabase.functions.invoke("netsuite-lookup", {
    body: { documentType, documentNumber },
  });
  if (error) throw new Error(await describeInvokeError(error));

  if (data?.unavailable) return { kind: "unavailable", message: String(data.message ?? "NetSuite is unavailable") };
  if (data?.ambiguous) return { kind: "ambiguous", candidates: data.candidates as NetSuiteLookupCandidate[] };
  if (data?.found) return { kind: "found", document: data.document as NetSuiteLookupDocument };
  return { kind: "not_found" };
}
