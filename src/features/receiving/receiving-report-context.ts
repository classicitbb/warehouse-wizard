/**
 * receiving-report-context.ts
 *
 * What Receiving tells the life buoy about itself.
 *
 * A report that says only "/receiving" is nearly useless: the answer always
 * turns on which SKU was selected, what was typed into Total received, Qty per
 * pallet and Pallets, and which container or draft the session was against.
 * This turns the live entry state into the detail lines that travel with the
 * ticket.
 *
 * Read-only over the form state. Nothing here writes anything.
 */

import { makeReportContext, type ReportContextDetail, type ScreenReportContext } from "@/features/copilot/report-context";

export type ReceivingReportLine = {
  /** 1-based, matching the "SKU line n" heading the operator sees. */
  index: number;
  sku?: string | null;
  productName?: string | null;
  total: number | string;
  perPallet: number | string;
  palletCount: number | string;
  remainder: number;
  overAllocated: number;
  remainderAction?: string;
  expiryDate?: string;
  lotNumber?: string;
  batchNumber?: string;
  /** Where the qty per pallet came from, and what was learned for the SKU. */
  perPalletSource: "learned" | "entered" | "unknown";
  learnedQty?: { suggestedQty: number; sampleCount: number } | null;
  /** Validation messages showing on the line right now. */
  issues?: string[];
};

export type ReceivingReportContextInput = {
  /** True while the New Shipment / New Pallet / Edit Draft Pallet dialog is open. */
  entryOpen: boolean;
  entryMode: "shipment" | "pallet";
  editingDraftBarcode?: string | null;
  route?: string;
  warehouseLabel?: string | null;
  clientLabel?: string | null;
  receiptType?: string | null;
  containerNumber?: string | null;
  poNumber?: string | null;
  referenceNumber?: string | null;
  draftCount: number;
  lastReceived?: { barcode: string; taskNumber: string; qty: number } | null;
  lines: ReceivingReportLine[];
};

const RECEIPT_TYPE_LABELS: Record<string, string> = {
  po: "Purchase order",
  transfer: "Transfer",
  other: "Other",
};

const REMAINDER_ACTION_LABELS: Record<string, string> = {
  waive: "waive the remainder",
  manual: "manage outside WMS",
  special: "create a special pallet",
};

export function receivingScreenName(input: {
  entryOpen: boolean;
  entryMode: "shipment" | "pallet";
  editingDraftBarcode?: string | null;
}): string {
  if (!input.entryOpen) return "Receiving";
  if (input.editingDraftBarcode) return "Edit Draft Pallet";
  return input.entryMode === "pallet" ? "New Pallet" : "New Shipment";
}

/** One line per SKU: product, what was typed, and where the split stands. */
function describeLine(line: ReceivingReportLine): string {
  const product = [line.sku, line.productName].filter(Boolean).join(" · ") || "no SKU selected";
  const parts = [
    `total received ${line.total}`,
    `${line.perPallet} per pallet`,
    `${line.palletCount} pallet${Number(line.palletCount) === 1 ? "" : "s"}`,
  ];
  if (line.remainder > 0) {
    parts.push(
      `${line.remainder} left over${
        line.remainderAction ? ` (${REMAINDER_ACTION_LABELS[line.remainderAction] ?? line.remainderAction})` : " with no choice made"
      }`,
    );
  }
  if (line.overAllocated > 0) parts.push(`${line.overAllocated} more allocated than received`);
  if (line.expiryDate) parts.push(`expiry ${line.expiryDate}`);
  if (line.lotNumber) parts.push(`lot ${line.lotNumber}`);
  if (line.batchNumber) parts.push(`batch ${line.batchNumber}`);
  return `${product} — ${parts.join(", ")}`;
}

/** Where the qty per pallet came from, which is the first question on a split bug. */
function describePerPalletSource(line: ReceivingReportLine): string {
  const learned = line.learnedQty
    ? `learned ${line.learnedQty.suggestedQty} from ${line.learnedQty.sampleCount} prior pallet${
        line.learnedQty.sampleCount === 1 ? "" : "s"
      }`
    : "nothing learned for this SKU yet";
  if (line.perPalletSource === "learned") return `applied the learned qty (${learned})`;
  if (line.perPalletSource === "entered") return `typed by the operator (${learned})`;
  return `not set — still the default (${learned})`;
}

export function buildReceivingReportContext(input: ReceivingReportContextInput): ScreenReportContext {
  const details: ReportContextDetail[] = [];
  const push = (label: string, value: string | number | null | undefined) => {
    if (value === null || value === undefined || String(value).trim() === "") return;
    details.push({ label, value: String(value) });
  };

  if (input.entryOpen) {
    push(
      "Entry mode",
      input.editingDraftBarcode
        ? `Editing draft pallet ${input.editingDraftBarcode}`
        : input.entryMode === "pallet"
          ? "Standalone pallet"
          : "Shipment by container",
    );
    push("Warehouse", input.warehouseLabel);
    push("Client", input.clientLabel);
    push("Receipt type", input.receiptType ? RECEIPT_TYPE_LABELS[input.receiptType] ?? input.receiptType : null);
    if (input.entryMode !== "pallet") {
      push("Container", input.containerNumber);
      push("PO", input.poNumber);
    }
    push("Reference", input.referenceNumber);

    for (const line of input.lines) {
      push(`SKU line ${line.index}`, describeLine(line));
      push(`SKU line ${line.index} qty per pallet`, describePerPalletSource(line));
      const issues = (line.issues ?? []).filter(Boolean);
      if (issues.length > 0) push(`SKU line ${line.index} showing`, issues.join(" "));
    }
  } else {
    push("Warehouse", input.warehouseLabel);
  }

  push("Draft pallets waiting", input.draftCount);
  if (input.lastReceived) {
    push(
      "Last received in this session",
      `${input.lastReceived.barcode} · qty ${input.lastReceived.qty} · put-away ${input.lastReceived.taskNumber}`,
    );
  }

  return makeReportContext({
    screen: receivingScreenName(input),
    route: input.route,
    details,
  });
}
