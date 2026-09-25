// Receiving shipment form state: line maths, draft conversion and label printing.
import { type ReactNode } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { type DraftReceipt, receivingSchema } from "@/lib/wms-core";
import { buildPalletLabelBatchPrintHtml, type PalletLabelPageProps } from "@/components/pallet-label-page";

export type ReceivingShipmentLineState = {
  id: string;
  product_id: string;
  total_quantity: number | string;
  quantity_per_pallet: number | string;
  pallet_count: number | string;
  expiry_date: string;
  lot_number: string;
  batch_number: string;
  packaging_profile_id: string;
  remainder_action: "waive" | "manual" | "special" | "";
};

export type ReceivingShipmentFormState = {
  receipt_type: "po" | "transfer" | "other";
  warehouse_id: string;
  client_id: string;
  container_number: string;
  po_number: string;
  reference_number: string;
  lines: ReceivingShipmentLineState[];
};

export function newShipmentLine(productId = ""): ReceivingShipmentLineState {
  return {
    id: typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `line-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    product_id: productId,
    total_quantity: 1,
    quantity_per_pallet: 1,
    pallet_count: 1,
    expiry_date: "",
    lot_number: "",
    batch_number: "",
    packaging_profile_id: "",
    remainder_action: "",
  };
}

export function distributeShipmentLine(line: ReceivingShipmentLineState, changed: "total" | "perPallet" | "count"): ReceivingShipmentLineState {
  const total = Math.max(0, Number(line.total_quantity) || 0);
  const perPallet = Math.max(1, Number(line.quantity_per_pallet) || 1);
  let palletCount = Math.max(1, Math.floor(Number(line.pallet_count) || 1));

  if (changed !== "count") {
    palletCount = Math.max(1, Math.floor(total / perPallet) || 1);
  }

  const remainder = total - (perPallet * palletCount);
  return {
    ...line,
    total_quantity: total,
    quantity_per_pallet: perPallet,
    pallet_count: palletCount,
    remainder_action: remainder > 0 ? line.remainder_action : "",
  };
}

export function parseDraftMeta(notes: string | null | undefined): Record<string, any> {
  if (!notes) return {};
  try {
    const parsed = JSON.parse(notes);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function remainderForLine(line: ReceivingShipmentLineState) {
  return Math.max(0, Number(line.total_quantity || 0) - (Number(line.quantity_per_pallet || 0) * Number(line.pallet_count || 0)));
}

export function ShipmentFieldLabel({ children }: { children: ReactNode }) {
  return <label className="text-sm font-medium leading-none text-foreground">{children}</label>;
}

export function productRequiresExpiry(product?: { expiry_tracked?: boolean } | null) {
  return Boolean(product?.expiry_tracked);
}

export function defaultExpiryDate() {
  const date = new Date();
  date.setDate(date.getDate() + 30);
  return date.toISOString().slice(0, 10);
}

function normalizeDraftReceiptType(value: unknown): z.infer<typeof receivingSchema>["receipt_type"] {
  return value === "po" || value === "transfer" || value === "other" ? value : "other";
}

export function draftToReceivingValues(draft: DraftReceipt): z.infer<typeof receivingSchema> {
  const meta = parseDraftMeta(draft.notes);
  return {
    receipt_type: normalizeDraftReceiptType(draft.receipt_type ?? meta.receipt_type),
    reference_number: draft.reference_number ?? draft.po_number ?? "",
    container_number: draft.container_number ?? meta.container_number ?? "",
    po_number: draft.po_number ?? meta.po_number ?? "",
    warehouse_id: draft.warehouse_id,
    client_id: draft.client_id ?? "",
    product_id: (meta.product_id as string) ?? draft.product_id ?? "",
    packaging_profile_id: (meta.packaging_profile_id as string) ?? "",
    quantity: Number(meta.quantity ?? draft.quantity ?? 1),
    lot_number: (meta.lot_number as string) ?? "",
    batch_number: (meta.batch_number as string) ?? "",
    manufacture_date: (meta.manufacture_date as string) ?? "",
    expiry_date: (meta.expiry_date as string) ?? draft.expiry_date ?? "",
    loading_date: (meta.loading_date as string) ?? "",
    rotation_date: (meta.rotation_date as string) ?? "",
    override_length: (meta.override_length as number) ?? undefined,
    override_width: (meta.override_width as number) ?? undefined,
    override_height: (meta.override_height as number) ?? undefined,
    override_weight: (meta.override_weight as number) ?? undefined,
    reuse_pallet_barcode: (meta.reuse_pallet_barcode as string) ?? "",
    pallet_barcode: draft.draft_pallet_barcode ?? meta.draft_pallet_barcode ?? "",
    draft_group_id: draft.draft_group_id ?? meta.draft_group_id ?? undefined,
    draft_sequence: draft.draft_sequence ?? meta.draft_sequence ?? undefined,
    draft_count: draft.draft_count ?? meta.draft_count ?? undefined,
  };
}

export function printDraftLabels(
  drafts: DraftReceipt[],
  products: Array<{ id: string; sku: string; name: string; temperature_requirement?: string | null }>,
  clients: Array<{ id: string; name: string }>,
  warehouses: Array<{ id: string; name: string; code?: string | null }>,
  packagingProfiles: Array<{ id: string; name?: string | null; unit_name?: string | null; unit_of_measure?: string | null }>,
) {
  if (drafts.length === 0) {
    toast.error("Select at least one draft label to print.");
    return false;
  }
  const labels: PalletLabelPageProps[] = drafts.map((draft) => {
    const meta = parseDraftMeta(draft.notes);
    const product = products.find((p) => p.id === (draft.product_id ?? meta.product_id));
    const client = clients.find((item) => item.id === draft.client_id);
    const warehouse = warehouses.find((item) => item.id === draft.warehouse_id);
    const packaging = packagingProfiles.find((item) => item.id === meta.packaging_profile_id);
    const barcode = draft.draft_pallet_barcode ?? meta.draft_pallet_barcode ?? draft.receipt_number;

    return {
      barcode,
      productSku: product?.sku,
      productName: product?.name,
      quantity: Number(draft.quantity ?? meta.quantity ?? 1),
      lotNumber: draft.lot_number ?? meta.lot_number,
      batchNumber: draft.batch_number ?? meta.batch_number,
      expiryDate: draft.expiry_date ?? meta.expiry_date,
      containerNumber: draft.container_number ?? meta.container_number,
      poNumber: draft.po_number ?? meta.po_number,
      clientName: client?.name,
      warehouseName: warehouse ? `${warehouse.code ? `${warehouse.code} - ` : ""}${warehouse.name}` : undefined,
      receiptReference: draft.reference_number ?? draft.receipt_number,
      packaging: packaging?.name ?? packaging?.unit_name ?? packaging?.unit_of_measure,
      draftSequence: draft.draft_sequence,
      draftCount: draft.draft_count,
      temperatureClass: product?.temperature_requirement ?? undefined,
    };
  });
  const win = window.open("", "_blank", "width=900,height=1100");
  if (!win) {
    toast.error("Print window was blocked. Allow popups, then try again.");
    return false;
  }
  win.document.write(buildPalletLabelBatchPrintHtml(labels));
  win.document.close();
  return true;
}
