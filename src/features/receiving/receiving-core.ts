import { upsertRecord } from "@/features/admin/admin-core";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { validateIso6346ContainerNumber } from "@/lib/container-number";
import { recordPalletQtyObservation } from "@/lib/ai-assist";
import {
  db,
  getStoredPalletCounts,
  formatSupabaseError,
  throwIfSupabaseError,
  receivingSchema,
  escapePostgrestOrValue,
  type InventoryStatus,
} from "@/features/shared/core-types";
import { writeSystemLog } from "@/features/system/system-core";

function buildPalletCode(prefix: string) {
  const time = Date.now().toString().slice(-8);
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `${prefix}-${time}${rand}`;
}

function buildClientId(_prefix?: string) {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
    const rand = Math.floor(Math.random() * 16);
    const value = char === "x" ? rand : (rand & 0x3) | 0x8;
    return value.toString(16);
  });
}

function parseReceiptNotes(notes: string | null | undefined): Record<string, any> {
  if (!notes) return {};
  try {
    const parsed = JSON.parse(notes);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function isMissingReceiptDraftColumn(error: any) {
  const message = String(error?.message ?? "");
  return (
    message.includes("receipts") &&
    message.includes("column") &&
    (message.includes("Could not find") || message.includes("does not exist"))
  );
}

function withoutReceiptDraftColumns(row: Record<string, any>) {
  const {
    container_number,
    po_number,
    draft_group_id,
    draft_pallet_barcode,
    draft_sequence,
    draft_count,
    ...rest
  } = row;
  return rest;
}

function normalizeReferenceNumber(payload: Pick<z.infer<typeof receivingSchema>, "reference_number" | "po_number">, fallback: string) {
  return payload.reference_number || payload.po_number || fallback;
}

async function resolveInventoryLot(payload: z.infer<typeof receivingSchema>) {
  const clientId = payload.client_id || null;
  let selectQuery = db("inventory_lots")
    .select("*")
    .eq("product_id", payload.product_id)
    .eq("lot_number", payload.lot_number ?? null)
    .eq("batch_number", payload.batch_number ?? null);
  if (clientId) {
    selectQuery = selectQuery.eq("client_id", clientId);
  } else {
    selectQuery = selectQuery.is("client_id", null);
  }
  const lotMatch = await selectQuery.maybeSingle();

  if (lotMatch.data) {
    return lotMatch.data;
  }

  const { data, error } = await db("inventory_lots")
    .insert({
      product_id: payload.product_id,
      client_id: clientId,
      lot_number: payload.lot_number ?? null,
      batch_number: payload.batch_number ?? null,
      manufacture_date: payload.manufacture_date || null,
      expiry_date: payload.expiry_date || null,
      loading_date: payload.loading_date || null,
      rotation_date: payload.rotation_date || null,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function createLabelRecord(label_type: string, entityId: string, labelCode: string) {
  const { error } = await db("barcode_labels").insert({
    label_type,
    entity_id: entityId,
    label_code: labelCode,
    last_printed_at: new Date().toISOString(),
  });
  if (error) throw error;
}

export async function createReceiptFlow(input: z.infer<typeof receivingSchema>) {
  let payload = receivingSchema.parse(input);
  if (payload.container_number) {
    const containerValidation = validateIso6346ContainerNumber(payload.container_number);
    if (!containerValidation.valid) throw new Error(containerValidation.message);
    payload = { ...payload, container_number: containerValidation.normalized };
  }
  const lot = await resolveInventoryLot(payload);
  const receiptNumber = buildPalletCode("RCT");
  const palletCode = payload.pallet_barcode?.trim() || buildPalletCode("PLT");

  const { data: product, error: productError } = await db("products")
    .select("*")
    .eq("id", payload.product_id)
    .single();

  if (productError) throw productError;

  const { data: packagingProfile } = payload.packaging_profile_id
    ? await db("product_packaging_profiles").select("*").eq("id", payload.packaging_profile_id).single()
    : { data: null };

  const receiptPayload = {
    receipt_number: receiptNumber,
    receipt_type: payload.receipt_type,
    reference_number: normalizeReferenceNumber(payload, receiptNumber),
    container_number: payload.container_number || null,
    po_number: payload.po_number || null,
    draft_group_id: payload.draft_group_id || null,
    draft_pallet_barcode: palletCode,
    draft_sequence: payload.draft_sequence ?? null,
    draft_count: payload.draft_count ?? null,
    warehouse_id: payload.warehouse_id,
    client_id: payload.client_id,
    status: "completed",
  };
  let receipt: any;
  try {
    receipt = await upsertRecord("receipts", receiptPayload);
  } catch (error: any) {
    if (!isMissingReceiptDraftColumn(error)) throw error;
    receipt = await upsertRecord("receipts", withoutReceiptDraftColumns(receiptPayload));
  }

  const receiptLine = await upsertRecord("receipt_lines", {
    receipt_id: receipt.id,
    product_id: payload.product_id,
    packaging_profile_id: payload.packaging_profile_id || null,
    client_id: payload.client_id,
    quantity: payload.quantity,
    received_quantity: payload.quantity,
    inventory_lot_id: lot.id,
    override_length: payload.override_length ?? null,
    override_width: payload.override_width ?? null,
    override_height: payload.override_height ?? null,
    override_weight: payload.override_weight ?? null,
  });

  // Pallet reuse: if a barcode is provided, look up an empty/blank pallet to reuse
  let reusedPalletId: string | null = null;
  const reusedBarcode = payload.reuse_pallet_barcode?.trim();
  if (reusedBarcode) {
    const escapedReusedBarcode = escapePostgrestOrValue(reusedBarcode);
    const { data: existingPallet } = await db("pallets")
      .select("id, pallet_code, pallet_barcode, product_id, quantity")
      .or(`pallet_code.eq.${escapedReusedBarcode},pallet_barcode.eq.${escapedReusedBarcode}`)
      .single();
    if (existingPallet && (!existingPallet.product_id || existingPallet.quantity === 0)) {
      reusedPalletId = existingPallet.id;
    } else if (existingPallet) {
      throw new Error(`Pallet ${reusedBarcode} still has stock (qty: ${existingPallet.quantity}). Only empty pallets can be reused.`);
    } else {
      throw new Error(`Pallet barcode ${reusedBarcode} not found. Check the barcode and try again.`);
    }
  }

  const palletUpsertPayload: Record<string, unknown> = {
    pallet_code: reusedPalletId ? reusedBarcode : palletCode,
    pallet_barcode: reusedPalletId ? reusedBarcode : palletCode,
    product_id: payload.product_id,
    client_id: payload.client_id,
    receipt_line_id: receiptLine.id,
    current_warehouse_id: payload.warehouse_id,
    inventory_lot_id: lot.id,
    packaging_profile_id: payload.packaging_profile_id || null,
    quantity: payload.quantity,
    available_quantity: 0,
    status: "receiving",
    is_stored: false,
    length: payload.override_length ?? packagingProfile?.length ?? product.length,
    width: payload.override_width ?? packagingProfile?.width ?? product.width,
    height: payload.override_height ?? packagingProfile?.height ?? product.height,
    weight: payload.override_weight ?? packagingProfile?.weight ?? product.weight,
  };
  if (reusedPalletId) {
    palletUpsertPayload.id = reusedPalletId;
  }

  const pallet = await upsertRecord("pallets", palletUpsertPayload);

  await upsertRecord("inventory_balances", {
    pallet_id: pallet.id,
    product_id: payload.product_id,
    client_id: payload.client_id,
    warehouse_id: payload.warehouse_id,
    inventory_lot_id: lot.id,
    status: "receiving",
    quantity: payload.quantity,
    available_quantity: 0,
    expiry_date: lot.expiry_date,
  });

  const suggestions = await (supabase.rpc as any)("directed_putaway_candidates", { in_pallet_id: pallet.id });
  if (suggestions.error) {
    console.error("[createReceiptFlow] directed_putaway_candidates failed:", suggestions.error);
  }
  const topSuggestion = suggestions.data?.[0] ?? null;

  const putawayTask = await upsertRecord("putaway_tasks", {
    task_number: buildPalletCode("PTA"),
    pallet_id: pallet.id,
    warehouse_id: payload.warehouse_id,
    suggested_location_id: topSuggestion?.location_id ?? null,
    status: "queued",
  });

  const auditResult = await (supabase.rpc as any)("log_audit_event", {
    in_event_type: "receipt",
    in_entity_table: "pallets",
    in_entity_id: pallet.id,
    in_pallet_id: pallet.id,
    in_warehouse_id: payload.warehouse_id,
    in_metadata: {
      receipt_id: receipt.id,
      receipt_line_id: receiptLine.id,
      quantity: payload.quantity,
      container_number: payload.container_number || null,
      po_number: payload.po_number || null,
      draft_group_id: payload.draft_group_id || null,
    } as any,
  });
  if (auditResult.error) {
    console.error("[createReceiptFlow] log_audit_event failed:", auditResult.error);
  }

  await createLabelRecord("pallet", pallet.id, palletCode);

  // AI assist: record pallet qty observation (fire-and-forget, never throws)
  recordPalletQtyObservation(payload.product_id, payload.warehouse_id, payload.quantity).catch(
    (err) => console.error("[ai-assist] pallet qty record failed:", err),
  );

  return { receipt, receiptLine, pallet, putawayTask, topSuggestion };
}

// ── Draft receipts ────────────────────────────────────────────────────────────

export type DraftReceipt = {
  id: string;
  receipt_number: string;
  receipt_type: "po" | "transfer" | "return" | "manual" | "other" | null;
  reference_number: string | null;
  container_number: string | null;
  po_number: string | null;
  draft_group_id: string | null;
  draft_pallet_barcode: string | null;
  draft_sequence: number | null;
  draft_count: number | null;
  warehouse_id: string;
  client_id: string | null;
  status: string;
  product_id: string | null;
  quantity: number | null;
  expiry_date: string | null;
  lot_number: string | null;
  batch_number: string | null;
  created_at: string;
  notes: string | null;
  source_label: string | null;
};

export type ShipmentDraftLineInput = {
  product_id: string;
  client_id?: string;
  packaging_profile_id?: string;
  total_quantity: number;
  quantity_per_pallet: number;
  pallet_count: number;
  expiry_date?: string;
  lot_number?: string;
  batch_number?: string;
  manufacture_date?: string;
  loading_date?: string;
  remainder_quantity?: number;
  remainder_action?: "waive" | "manual" | "special";
  create_special_pallet?: boolean;
};

export type ShipmentDraftInput = {
  receipt_type: "po" | "transfer" | "other";
  warehouse_id: string;
  client_id?: string;
  container_number: string;
  po_number?: string;
  reference_number?: string;
  lines: ShipmentDraftLineInput[];
};

export async function saveDraftReceipt(values: z.infer<typeof receivingSchema>): Promise<string> {
  if (values.container_number) {
    const containerValidation = validateIso6346ContainerNumber(values.container_number);
    if (!containerValidation.valid) throw new Error(containerValidation.message);
    values = { ...values, container_number: containerValidation.normalized };
  }
  const receiptNumber = buildPalletCode("RCT");
  const draftBarcode = values.pallet_barcode?.trim() || buildPalletCode("PLT");
  const row = {
    receipt_number: receiptNumber,
    receipt_type: values.receipt_type,
    reference_number: normalizeReferenceNumber(values, receiptNumber),
    container_number: values.container_number || null,
    po_number: values.po_number || null,
    draft_group_id: values.draft_group_id || null,
    draft_pallet_barcode: draftBarcode,
    draft_sequence: values.draft_sequence ?? null,
    draft_count: values.draft_count ?? null,
    warehouse_id: values.warehouse_id,
    client_id: values.client_id || null,
    status: "draft",
    notes: JSON.stringify({
      _draft: true,
      draft_pallet_barcode: draftBarcode,
      container_number: values.container_number,
      po_number: values.po_number,
      draft_group_id: values.draft_group_id,
      draft_sequence: values.draft_sequence,
      draft_count: values.draft_count,
      product_id: values.product_id,
      quantity: values.quantity,
      lot_number: values.lot_number,
      batch_number: values.batch_number,
      expiry_date: values.expiry_date,
      manufacture_date: values.manufacture_date,
      loading_date: values.loading_date,
      packaging_profile_id: values.packaging_profile_id,
      override_length: values.override_length,
      override_width: values.override_width,
      override_height: values.override_height,
      override_weight: values.override_weight,
      reuse_pallet_barcode: values.reuse_pallet_barcode,
    }),
  };
  let { data, error } = await db("receipts").insert(row).select("id").single();
  if (error && isMissingReceiptDraftColumn(error)) {
    ({ data, error } = await db("receipts").insert(withoutReceiptDraftColumns(row)).select("id").single());
  }
  if (error) throw error;
  return data.id;
}

export async function saveShipmentDrafts(input: ShipmentDraftInput): Promise<{ groupId: string; draftIds: string[]; count: number }> {
  if (!input.warehouse_id) throw new Error("Select a warehouse before saving shipment drafts.");
  if (input.receipt_type === "other" && !input.container_number.trim()) {
    input = { ...input, container_number: "" };
  } else {
    const containerValidation = validateIso6346ContainerNumber(input.container_number);
    if (!containerValidation.valid) throw new Error(containerValidation.message);
    input = { ...input, container_number: containerValidation.normalized };
  }
  const entryMode = input.receipt_type === "other" && !input.container_number.trim() ? "pallet" : "shipment";
  if (!input.lines.length) throw new Error("Add at least one SKU line.");

  const groupId = buildClientId("shipment");
  const rows: any[] = [];

  for (const line of input.lines) {
    if (!line.product_id) throw new Error("Each shipment line needs a product.");
    if (line.total_quantity <= 0 || line.quantity_per_pallet <= 0 || line.pallet_count <= 0) {
      throw new Error("Each shipment line needs positive quantity, per-pallet quantity, and pallet count.");
    }
    const fullQty = Number(line.quantity_per_pallet);
    const remainderQty = Number(line.remainder_quantity ?? 0);
    if (remainderQty > 0 && !line.remainder_action) {
      throw new Error("Choose how to handle leftover quantity before creating drafts.");
    }
    const quantities = Array.from({ length: Number(line.pallet_count) }, () => fullQty);
    if (remainderQty > 0 && line.remainder_action === "special" && line.create_special_pallet) {
      quantities.push(remainderQty);
    }

    quantities.forEach((quantity, index) => {
      const receiptNumber = buildPalletCode("RCT");
      const draftBarcode = buildPalletCode("PLT");
      rows.push({
        receipt_number: receiptNumber,
        receipt_type: input.receipt_type,
        reference_number: input.reference_number || input.po_number || receiptNumber,
        container_number: input.container_number.trim(),
        po_number: input.po_number?.trim() || null,
        draft_group_id: groupId,
        draft_pallet_barcode: draftBarcode,
        draft_sequence: index + 1,
        draft_count: quantities.length,
        warehouse_id: input.warehouse_id,
        client_id: line.client_id || input.client_id || null,
        status: "draft",
        notes: JSON.stringify({
          _draft: true,
          _shipment: entryMode === "shipment",
          _standalone_pallet: entryMode === "pallet",
          entry_mode: entryMode,
          receipt_type: input.receipt_type,
          draft_pallet_barcode: draftBarcode,
          draft_group_id: groupId,
          draft_sequence: index + 1,
          draft_count: quantities.length,
          container_number: input.container_number.trim(),
          po_number: input.po_number?.trim() || "",
          product_id: line.product_id,
          quantity,
          total_quantity: line.total_quantity,
          quantity_per_pallet: line.quantity_per_pallet,
          remainder_quantity: remainderQty,
          remainder_action: line.remainder_action ?? null,
          special_pallet: remainderQty > 0 && line.remainder_action === "special" && index === quantities.length - 1,
          lot_number: line.lot_number,
          batch_number: line.batch_number,
          expiry_date: line.expiry_date,
          manufacture_date: line.manufacture_date,
          loading_date: line.loading_date,
          packaging_profile_id: line.packaging_profile_id,
        }),
      });
    });
  }

  let { data, error } = await db("receipts").insert(rows).select("id");
  if (error && isMissingReceiptDraftColumn(error)) {
    ({ data, error } = await db("receipts").insert(rows.map(withoutReceiptDraftColumns)).select("id"));
  }
  if (error) throw error;
  await writeSystemLog({
    log_type: "system_change",
    severity: "info",
    title: `Shipment drafts created for container ${input.container_number.trim()}`,
    message: `${rows.length} pallet draft${rows.length === 1 ? "" : "s"} created.`,
    source: "receiving",
    table_name: "receipts",
    details: { groupId, container_number: input.container_number.trim(), po_number: input.po_number ?? null, draft_count: rows.length },
  }).catch((error) => console.error("[saveShipmentDrafts] writeSystemLog failed:", error));
  return { groupId, draftIds: (data ?? []).map((row: any) => row.id), count: rows.length };
}

export async function updateDraftReceipt(draftId: string, values: z.infer<typeof receivingSchema>): Promise<void> {
  if (values.container_number) {
    const containerValidation = validateIso6346ContainerNumber(values.container_number);
    if (!containerValidation.valid) throw new Error(containerValidation.message);
    values = { ...values, container_number: containerValidation.normalized };
  }
  let { data: existing, error: existingError } = await db("receipts")
    .select("notes, draft_pallet_barcode, draft_group_id, draft_sequence, draft_count, status")
    .eq("id", draftId)
    .in("status", ["draft", "queued"])
    .single();
  if (existingError && isMissingReceiptDraftColumn(existingError)) {
    ({ data: existing, error: existingError } = await db("receipts")
      .select("notes, status")
      .eq("id", draftId)
      .in("status", ["draft", "queued"])
      .single());
  }
  if (existingError) throw existingError;
  const meta = parseReceiptNotes(existing?.notes);
  const draftBarcode = values.pallet_barcode?.trim() || existing?.draft_pallet_barcode || meta.draft_pallet_barcode || buildPalletCode("PLT");
  const nextMeta = {
    ...meta,
    _draft: true,
    draft_pallet_barcode: draftBarcode,
    container_number: values.container_number,
    po_number: values.po_number,
    draft_group_id: values.draft_group_id || existing?.draft_group_id || meta.draft_group_id,
    draft_sequence: values.draft_sequence ?? existing?.draft_sequence ?? meta.draft_sequence,
    draft_count: values.draft_count ?? existing?.draft_count ?? meta.draft_count,
    product_id: values.product_id,
    quantity: values.quantity,
    lot_number: values.lot_number,
    batch_number: values.batch_number,
    expiry_date: values.expiry_date,
    manufacture_date: values.manufacture_date,
    loading_date: values.loading_date,
    packaging_profile_id: values.packaging_profile_id,
    override_length: values.override_length,
    override_width: values.override_width,
    override_height: values.override_height,
    override_weight: values.override_weight,
  };
  const updatePayload: Record<string, any> = {
    receipt_type: values.receipt_type,
    reference_number: normalizeReferenceNumber(values, draftBarcode),
    container_number: values.container_number || null,
    po_number: values.po_number || null,
    draft_group_id: values.draft_group_id || existing?.draft_group_id || meta.draft_group_id || null,
    draft_pallet_barcode: draftBarcode,
    draft_sequence: values.draft_sequence ?? existing?.draft_sequence ?? meta.draft_sequence ?? null,
    draft_count: values.draft_count ?? existing?.draft_count ?? meta.draft_count ?? null,
    warehouse_id: values.warehouse_id,
    client_id: values.client_id || null,
    notes: JSON.stringify(nextMeta),
  };
  if (existing?.status === "queued") {
    updatePayload.status = "draft";
  }
  let { error } = await db("receipts")
    .update({
      ...updatePayload,
    })
    .eq("id", draftId)
    .in("status", ["draft", "queued"]);
  if (error && isMissingReceiptDraftColumn(error)) {
    ({ error } = await db("receipts")
      .update(withoutReceiptDraftColumns(updatePayload))
      .eq("id", draftId)
      .in("status", ["draft", "queued"]));
  }
  if (error) throw error;
  await writeSystemLog({
    log_type: "system_change",
    severity: "info",
    title: "Receiving draft updated",
    message: `Draft ${draftBarcode} was updated.`,
    source: "receiving",
    table_name: "receipts",
    details: { draftId, draft_pallet_barcode: draftBarcode, container_number: values.container_number || null, po_number: values.po_number || null },
  }).catch((error) => console.error("[updateDraftReceipt] writeSystemLog failed:", error));
}

export async function createReturnedPalletDraft({
  palletId,
  warehouseId,
  sourceLabel,
  sourceType,
  sourceId,
  reason,
}: {
  palletId: string;
  warehouseId: string;
  sourceLabel: string;
  sourceType: string;
  sourceId?: string;
  reason?: string;
}): Promise<string> {
  const [{ data: pallet, error: palletError }, { data: balance }] = await Promise.all([
    db("pallets").select("*").eq("id", palletId).single(),
    db("inventory_balances").select("*").eq("pallet_id", palletId).maybeSingle(),
  ]);
  if (palletError) throw palletError;

  if (sourceId) {
    const { data: existingDraft, error: existingError } = await db("receipts")
      .select("id")
      .eq("warehouse_id", warehouseId)
      .eq("status", "draft")
      .ilike("notes", `%${sourceId}%`)
      .maybeSingle();
    if (existingError) throw existingError;
    if (existingDraft?.id) return existingDraft.id;
  }

  const receiptNumber = buildPalletCode("RCT");
  const quantity = Number(balance?.quantity ?? pallet.quantity ?? 0);
  const receiptRow = {
    receipt_number: receiptNumber,
    receipt_type: "other",
    reference_number: pallet.pallet_barcode ?? receiptNumber,
    draft_pallet_barcode: pallet.pallet_barcode ?? receiptNumber,
    warehouse_id: warehouseId,
    client_id: pallet.client_id ?? null,
    status: "draft",
    notes: JSON.stringify({
      _draft: true,
      _returned: true,
      source_label: sourceLabel,
      source_type: sourceType,
      source_id: sourceId ?? null,
      reason: reason ?? null,
      returned_pallet_id: palletId,
      draft_pallet_barcode: pallet.pallet_barcode,
      product_id: pallet.product_id,
      quantity,
      packaging_profile_id: pallet.packaging_profile_id,
      reuse_pallet_barcode: pallet.pallet_barcode,
    }),
  };
  let { data, error } = await db("receipts").insert(receiptRow).select("id").single();
  if (error && isMissingReceiptDraftColumn(error)) {
    ({ data, error } = await db("receipts").insert(withoutReceiptDraftColumns(receiptRow)).select("id").single());
  }
  if (error) throw error;
  return data.id;
}

export type InventoryPalletCorrectionStart = {
  draftId: string;
  replacementPalletBarcode: string;
  formerLocationCode: string;
};

export type InventoryPalletCorrectionResult = {
  inventoryBalanceId: string;
  palletId: string;
  palletBarcode: string;
  putawayTaskId: string | null;
  putawayTaskNumber: string | null;
};

export async function beginInventoryPalletCorrection(inventoryBalanceId: string): Promise<InventoryPalletCorrectionStart> {
  const { data, error } = await (supabase.rpc as any)("begin_inventory_pallet_correction", {
    in_inventory_balance_id: inventoryBalanceId,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.draft_id) throw new Error("The correction draft could not be created.");
  return {
    draftId: row.draft_id,
    replacementPalletBarcode: row.replacement_pallet_barcode,
    formerLocationCode: row.former_location_code,
  };
}

export async function cancelInventoryPalletCorrection(draftId: string): Promise<void> {
  const { error } = await (supabase.rpc as any)("cancel_inventory_pallet_correction", {
    in_draft_id: draftId,
  });
  if (error) throw error;
}

export async function completeInventoryPalletCorrection(input: {
  draftId: string;
  quantity: number;
  expiryDate: string | null;
  stillAtFormerLocation: boolean;
}): Promise<InventoryPalletCorrectionResult> {
  const { data, error } = await (supabase.rpc as any)("complete_inventory_pallet_correction", {
    in_draft_id: input.draftId,
    in_quantity: input.quantity,
    in_expiry_date: input.expiryDate,
    in_still_at_former_location: input.stillAtFormerLocation,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.inventory_balance_id || !row?.pallet_id) throw new Error("The replacement pallet could not be received.");
  return {
    inventoryBalanceId: row.inventory_balance_id,
    palletId: row.pallet_id,
    palletBarcode: row.pallet_barcode,
    putawayTaskId: row.putaway_task_id ?? null,
    putawayTaskNumber: row.putaway_task_number ?? null,
  };
}

export async function listDraftReceipts(warehouseId: string): Promise<DraftReceipt[]> {
  let { data, error } = await db("receipts")
    .select("id, receipt_number, receipt_type, reference_number, container_number, po_number, draft_group_id, draft_pallet_barcode, draft_sequence, draft_count, warehouse_id, client_id, status, created_at, notes, receipt_lines(id, product_id, quantity, received_quantity, inventory_lots(expiry_date, lot_number, batch_number), pallets(id, pallet_barcode, quantity, status))")
    .in("status", ["draft", "queued"])
    .eq("warehouse_id", warehouseId)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error && isMissingReceiptDraftColumn(error)) {
    ({ data, error } = await db("receipts")
      .select("id, receipt_number, receipt_type, reference_number, warehouse_id, client_id, status, created_at, notes, receipt_lines(id, product_id, quantity, received_quantity, inventory_lots(expiry_date, lot_number, batch_number), pallets(id, pallet_barcode, quantity, status))")
      .in("status", ["draft", "queued"])
      .eq("warehouse_id", warehouseId)
      .order("created_at", { ascending: false })
      .limit(200));
  }
  if (error) {
    ({ data, error } = await db("receipts")
      .select("id, receipt_number, receipt_type, reference_number, warehouse_id, client_id, status, created_at, notes")
      .in("status", ["draft", "queued"])
      .eq("warehouse_id", warehouseId)
      .order("created_at", { ascending: false })
      .limit(200));
  }
  if (error) throw error;
  return (data ?? [])
    .filter((row: any) => {
      const meta = parseReceiptNotes(row.notes);
      if (meta._seeded_draft) return false;
      if (String(meta.source_label ?? "").toLowerCase().includes("seeded receiving draft")) return false;
      return row.status === "draft" || meta._draft;
    })
    .map((row: any) => {
    const meta = parseReceiptNotes(row.notes);
    const line = Array.isArray(row.receipt_lines) ? row.receipt_lines[0] : row.receipt_lines;
    const pallet = Array.isArray(line?.pallets) ? line.pallets[0] : line?.pallets;
    const lot = Array.isArray(line?.inventory_lots) ? line.inventory_lots[0] : line?.inventory_lots;
    return {
      ...row,
      receipt_type: row.receipt_type ?? meta.receipt_type ?? null,
      container_number: row.container_number ?? meta.container_number ?? null,
      po_number: row.po_number ?? meta.po_number ?? null,
      draft_group_id: row.draft_group_id ?? meta.draft_group_id ?? null,
      draft_pallet_barcode: row.draft_pallet_barcode ?? meta.draft_pallet_barcode ?? pallet?.pallet_barcode ?? null,
      draft_sequence: row.draft_sequence ?? meta.draft_sequence ?? null,
      draft_count: row.draft_count ?? meta.draft_count ?? null,
      product_id: meta.product_id ?? line?.product_id ?? null,
      quantity: meta.quantity ?? line?.quantity ?? pallet?.quantity ?? null,
      expiry_date: meta.expiry_date ?? lot?.expiry_date ?? null,
      lot_number: meta.lot_number ?? lot?.lot_number ?? null,
      batch_number: meta.batch_number ?? lot?.batch_number ?? null,
      source_label: meta.source_label ?? (row.status === "queued" ? "Seeded receiving draft" : null),
    };
  });
}

async function completeReturnedPalletDraft(
  draftId: string,
  values: z.infer<typeof receivingSchema>,
  meta: any,
): Promise<{ palletBarcode: string; putawayTaskNumber: string }> {
  const palletId = meta.returned_pallet_id as string | undefined;
  if (!palletId) throw new Error("Returned draft is missing its pallet link.");

  const [{ data: pallet, error: palletError }, { data: existingBalance }] = await Promise.all([
    db("pallets").select("*").eq("id", palletId).single(),
    db("inventory_balances").select("*").eq("pallet_id", palletId).maybeSingle(),
  ]);
  if (palletError) throw palletError;

  const lot = await resolveInventoryLot(values);
  const { data: product, error: productError } = await db("products").select("*").eq("id", values.product_id).single();
  if (productError) throw productError;

  const { error: receiptError } = await db("receipts")
    .update({
      receipt_type: values.receipt_type,
      reference_number: values.reference_number || pallet.pallet_barcode,
      warehouse_id: values.warehouse_id,
      client_id: values.client_id || null,
      status: "completed",
    })
    .eq("id", draftId);
  if (receiptError) throw receiptError;

  await upsertRecord("receipt_lines", {
    receipt_id: draftId,
    product_id: values.product_id,
    packaging_profile_id: values.packaging_profile_id || pallet.packaging_profile_id || null,
    client_id: values.client_id || pallet.client_id || null,
    quantity: values.quantity,
    received_quantity: values.quantity,
    inventory_lot_id: lot.id,
    notes: meta.source_label ? `Returned from ${meta.source_label}` : null,
  });

  await Promise.all([
    db("pallets")
      .update({
        product_id: values.product_id,
        client_id: values.client_id || pallet.client_id || null,
        current_warehouse_id: values.warehouse_id,
        current_location_id: null,
        inventory_lot_id: lot.id,
        packaging_profile_id: values.packaging_profile_id || pallet.packaging_profile_id || null,
        quantity: values.quantity,
        available_quantity: 0,
        status: "receiving",
        is_stored: false,
        length: values.override_length ?? pallet.length ?? product.length,
        width: values.override_width ?? pallet.width ?? product.width,
        height: values.override_height ?? pallet.height ?? product.height,
        weight: values.override_weight ?? pallet.weight ?? product.weight,
      })
      .eq("id", palletId),
    existingBalance
      ? db("inventory_balances")
          .update({
            product_id: values.product_id,
            client_id: values.client_id || pallet.client_id || null,
            warehouse_id: values.warehouse_id,
            zone_id: null,
            location_id: null,
            inventory_lot_id: lot.id,
            status: "receiving",
            quantity: values.quantity,
            available_quantity: 0,
            expiry_date: lot.expiry_date,
          })
          .eq("id", existingBalance.id)
      : upsertRecord("inventory_balances", {
          pallet_id: palletId,
          product_id: values.product_id,
          client_id: values.client_id || pallet.client_id || null,
          warehouse_id: values.warehouse_id,
          inventory_lot_id: lot.id,
          status: "receiving",
          quantity: values.quantity,
          available_quantity: 0,
          expiry_date: lot.expiry_date,
        }),
  ]);

  const suggestions = await (supabase.rpc as any)("directed_putaway_candidates", { in_pallet_id: palletId });
  if (suggestions.error) console.error("[completeReturnedPalletDraft] directed_putaway_candidates failed:", suggestions.error);
  const topSuggestion = suggestions.data?.[0] ?? null;
  const putawayTask = await upsertRecord("putaway_tasks", {
    task_number: buildPalletCode("PTA"),
    pallet_id: palletId,
    warehouse_id: values.warehouse_id,
    suggested_location_id: topSuggestion?.location_id ?? null,
    status: "queued",
  });

  await (supabase.rpc as any)("log_audit_event", {
    in_event_type: "returned_receipt_completed",
    in_entity_table: "receipts",
    in_entity_id: draftId,
    in_pallet_id: palletId,
    in_warehouse_id: values.warehouse_id,
    in_metadata: { source_label: meta.source_label ?? null, quantity: values.quantity },
  });

  return { palletBarcode: pallet.pallet_barcode, putawayTaskNumber: putawayTask.task_number };
}

export async function completeReceiptFromDraft(
  draftId: string,
  values: z.infer<typeof receivingSchema>,
): Promise<{ palletBarcode: string; putawayTaskNumber: string }> {
  let { data: draft, error: draftError } = await db("receipts").select("id, status, notes, container_number, po_number, draft_group_id, draft_pallet_barcode, draft_sequence, draft_count").eq("id", draftId).single();
  if (draftError && isMissingReceiptDraftColumn(draftError)) {
    ({ data: draft, error: draftError } = await db("receipts").select("id, status, notes").eq("id", draftId).single());
  }
  if (draftError) throw draftError;
  const meta = parseReceiptNotes(draft?.notes);
  if (meta._returned) {
    return completeReturnedPalletDraft(draftId, values, meta);
  }
  if (draft?.status === "queued" && !meta._draft) {
    const { data: line, error: lineError } = await db("receipt_lines")
      .select("id, pallets(id, pallet_barcode), receipts(id)")
      .eq("receipt_id", draftId)
      .limit(1)
      .maybeSingle();
    if (lineError) throw lineError;
    const pallet = Array.isArray((line as any)?.pallets) ? (line as any).pallets[0] : (line as any)?.pallets;
    if (!pallet?.id) throw new Error("Seeded receiving draft is missing its pallet.");
    const { data: putawayTask, error: putawayError } = await db("putaway_tasks")
      .select("task_number")
      .eq("pallet_id", pallet.id)
      .in("status", ["draft", "queued", "assigned", "in_progress"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (putawayError) throw putawayError;
    const { error: receiptError } = await db("receipts").update({ status: "completed" }).eq("id", draftId);
    if (receiptError) throw receiptError;
    return { palletBarcode: pallet.pallet_barcode, putawayTaskNumber: putawayTask?.task_number ?? "existing putaway task" };
  }

  const result = await createReceiptFlow({
    ...values,
    container_number: values.container_number || draft?.container_number || meta.container_number || "",
    po_number: values.po_number || draft?.po_number || meta.po_number || "",
    pallet_barcode: values.pallet_barcode || draft?.draft_pallet_barcode || meta.draft_pallet_barcode || "",
    draft_group_id: values.draft_group_id || draft?.draft_group_id || meta.draft_group_id || undefined,
    draft_sequence: values.draft_sequence ?? draft?.draft_sequence ?? meta.draft_sequence,
    draft_count: values.draft_count ?? draft?.draft_count ?? meta.draft_count,
  });
  const { error: draftCancelError } = await db("receipts").update({ status: "cancelled" }).eq("id", draftId);
  if (draftCancelError) {
    console.error("[completeReceiptFromDraft] failed to cancel draft:", draftCancelError);
  }
  return { palletBarcode: result.pallet.pallet_barcode, putawayTaskNumber: result.putawayTask.task_number };
}

export async function deleteDraftReceipt(draftId: string): Promise<void> {
  const { data: draft } = await db("receipts")
    .select("receipt_number, reference_number, notes")
    .eq("id", draftId)
    .maybeSingle();
  const { error } = await db("receipts").delete().eq("id", draftId).eq("status", "draft");
  if (error) throw error;
  const meta = parseReceiptNotes((draft as any)?.notes);
  await writeSystemLog({
    log_type: "system_change",
    severity: "info",
    title: "Receiving draft cancelled",
    message: `Draft ${meta.draft_pallet_barcode ?? (draft as any)?.receipt_number ?? draftId} was cancelled.`,
    source: "receiving",
    table_name: "receipts",
    details: { draftId, receipt_number: (draft as any)?.receipt_number ?? null, reference_number: (draft as any)?.reference_number ?? null },
  }).catch((error) => console.error("[deleteDraftReceipt] writeSystemLog failed:", error));
}
