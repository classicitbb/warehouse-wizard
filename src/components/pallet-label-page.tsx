import { QRCodeSVG } from "qrcode.react";
import { renderToStaticMarkup } from "react-dom/server";
import { Printer } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export interface PalletLabelPageProps {
  barcode: string;
  productSku?: string;
  productName?: string;
  quantity?: number;
  lotNumber?: string | null;
  batchNumber?: string | null;
  expiryDate?: string | null;
  containerNumber?: string | null;
  poNumber?: string | null;
  clientName?: string | null;
  warehouseName?: string | null;
  locationCode?: string | null;
  receiptReference?: string | null;
  packaging?: string | null;
  draftSequence?: string | number | null;
  draftCount?: string | number | null;
  temperatureClass?: string;
  trigger?: React.ReactNode;
  onPrinted?: () => Promise<void> | void;
}

const TEMP_COLOURS: Record<string, string> = {
  ambient: "#1a1a2e",
  cool: "#1565c0",
  frozen: "#4a148c",
};

const TEMP_LABELS: Record<string, string> = {
  ambient: "Ambient",
  cool: "Cool (2–8 °C)",
  frozen: "Frozen (−20 °C)",
};

const EMPTY_VALUE = "________________";

function displayValue(value: unknown) {
  if (value == null || value === "") return EMPTY_VALUE;
  return String(value);
}

function hasValue(value: unknown) {
  return value != null && String(value).trim() !== "";
}

function formatLongDate(value: unknown) {
  if (!hasValue(value)) return EMPTY_VALUE;
  const raw = String(value).trim();
  const parsed = raw.length === 10 ? new Date(`${raw}T00:00:00`) : new Date(raw);
  if (Number.isNaN(parsed.getTime())) return displayValue(value);
  return new Intl.DateTimeFormat(undefined, { dateStyle: "long" }).format(parsed);
}

function formatPrintTimestamp(value: Date = new Date()) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(value);
}

function escapeHtml(value: unknown) {
  return displayValue(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function FieldBlock({
  label,
  value,
  highlight,
  valueClassName = "",
}: {
  label: string;
  value: unknown;
  highlight?: boolean;
  valueClassName?: string;
}) {
  return (
    <div className={highlight ? "rounded-md border border-amber-500 bg-amber-50 px-3 py-2" : "rounded-md border border-slate-300 bg-white/80 px-3 py-2"}>
      <p className={highlight ? "text-[10px] font-bold uppercase tracking-wide text-amber-700" : "text-[10px] font-bold uppercase tracking-wide text-slate-500"}>{label}</p>
      <p className={`mt-1 min-h-5 break-words text-sm font-semibold text-slate-950 ${valueClassName}`}>{displayValue(value)}</p>
    </div>
  );
}

function BarcodePreview({ code, size = 220 }: { code: string; size?: number }) {
  if (!code) return null;
  return (
    <div className="flex flex-col items-center gap-2">
      <QRCodeSVG value={code} size={size} bgColor="#ffffff" fgColor="#000000" level="H" />
    </div>
  );
}

function getPalletLabelModel(props: PalletLabelPageProps) {
  const {
    barcode,
    productSku,
    productName,
    quantity,
    lotNumber,
    batchNumber,
    expiryDate,
    containerNumber,
    poNumber,
    clientName,
    receiptReference,
    packaging,
    draftSequence,
    draftCount,
    temperatureClass = "ambient",
  } = props;

  const accentColor = TEMP_COLOURS[temperatureClass] ?? TEMP_COLOURS.ambient;
  const tempLabel = TEMP_LABELS[temperatureClass] ?? temperatureClass;
  const safeBarcode = displayValue(barcode);
  const displayExpiry = formatLongDate(expiryDate);
  const draftPosition = hasValue(draftSequence) && hasValue(draftCount) ? `${draftSequence}/${draftCount}` : draftSequence;
  const detailBits = [
    containerNumber ? `Container ${containerNumber}` : null,
    poNumber ? `PO ${poNumber}` : null,
    clientName ? `Client ${clientName}` : null,
    lotNumber ? `Lot ${lotNumber}` : null,
    batchNumber ? `Batch ${batchNumber}` : null,
    packaging ? `Packaging ${packaging}` : null,
    draftPosition ? `Draft ${draftPosition}` : null,
  ].filter(Boolean) as string[];
  const qrMarkup = renderToStaticMarkup(<QRCodeSVG value={safeBarcode} size={220} bgColor="#ffffff" fgColor="#000000" level="H" />);

  return { accentColor, tempLabel, safeBarcode, displayExpiry, detailBits, qrMarkup };
}

function renderPalletLabelSheet(props: PalletLabelPageProps, printTimestamp: string) {
  const { productSku, productName, quantity, receiptReference } = props;
  const { accentColor, tempLabel, safeBarcode, displayExpiry, detailBits, qrMarkup } = getPalletLabelModel(props);

  return `<div class="page-fit" style="--accent: ${accentColor}">
    <div class="sheet">
      <div class="accent-bar"></div>
      <div class="header">
        <div>
          <div class="title">Pallet Label</div>
          <div class="pallet-code">${escapeHtml(safeBarcode)}</div>
        </div>
        <span class="temp-badge">${escapeHtml(tempLabel)}</span>
      </div>
      ${detailBits.length > 0 ? `<div class="detail-line">${detailBits.map((part) => `<span>${escapeHtml(part)}</span>`).join(" <strong>·</strong> ")}</div>` : ""}
      <div class="field-grid">
        <div class="field"><div class="field-label">SKU</div><div class="field-value">${escapeHtml(productSku)}</div></div>
        <div class="field"><div class="field-label">Product</div><div class="field-value">${escapeHtml(productName)}</div></div>
        <div class="field"><div class="field-label">Quantity</div><div class="field-value">${escapeHtml(quantity)}</div></div>
        <div class="field expiry"><div class="field-label">Expiry</div><div class="field-value expiry">${escapeHtml(displayExpiry)}</div></div>
      </div>
      <div class="barcode-section">
        <div class="barcode-label">Scan QR code</div>
        <div class="barcode-wrap">${qrMarkup}</div>
        ${hasValue(receiptReference) ? `<div class="receipt-text">Receipt ${escapeHtml(receiptReference)}</div>` : ""}
      </div>
      <div class="footer">
        <span class="footer-text">Warehouse Wizard</span>
        <span class="footer-text">${escapeHtml(printTimestamp)}</span>
        <span class="footer-text">v${escapeHtml(__APP_VERSION__)}</span>
      </div>
    </div>
  </div>`;
}

export function buildPalletLabelBatchPrintHtml(labels: PalletLabelPageProps[], printTimestamp = formatPrintTimestamp()) {
  const firstBarcode = labels[0]?.barcode;
  const title = labels.length === 1 && firstBarcode ? `Pallet Label — ${escapeHtml(firstBarcode)}` : "Pallet Labels";

  return `<!DOCTYPE html>
<html>
<head>
  <title>${title}</title>
  <meta charset="utf-8" />
  <style>
    @page { size: auto; margin: 0; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body { width: 100%; min-height: 100%; background: #fff; overflow: visible; }
    body { font-family: system-ui, -apple-system, sans-serif; color: #000; }
    .page-fit {
      width: 100vw;
      height: 100vh;
      display: flex;
      justify-content: center;
      align-items: flex-start;
      background: #fff;
      break-after: page;
      page-break-after: always;
    }
    .page-fit:last-child { break-after: auto; page-break-after: auto; }
    .sheet {
      width: min(101.6mm, 100vw, calc(100vh * 2 / 3));
      height: min(152.4mm, 100vh, calc(100vw * 3 / 2));
      padding: min(5.5mm, 1.4cqw);
      display: flex;
      flex-direction: column;
      gap: min(4mm, 1.15cqh);
      background: #ffffff;
      border: min(1.25mm, 0.35cqw) solid var(--accent);
      container-type: size;
      overflow: hidden;
    }
    .accent-bar { width: 100%; height: min(3mm, 2cqh); background: var(--accent); border-radius: 999px; }
    .header { display: flex; align-items: flex-start; justify-content: space-between; gap: min(6mm, 4cqw); }
    .title { font-size: min(14pt, 3.5cqw); font-weight: 900; text-transform: uppercase; color: var(--accent); }
    .pallet-code { font-size: min(29pt, 7.2cqw, 5.4cqh); font-weight: 900; letter-spacing: 0.01em; line-height: 1.05; word-break: break-word; }
    .temp-badge { font-size: min(9.5pt, 2.4cqw); font-weight: 800; padding: min(2mm, 0.9cqh) min(4mm, 2.2cqw); border-radius: 999px; background: var(--accent); color: #fff; white-space: nowrap; }
    .detail-line { font-size: min(8.5pt, 2.15cqw); color: #475569; line-height: 1.35; overflow-wrap: anywhere; }
    .detail-line strong { color: #0f172a; }
    .field-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: min(2.5mm, 1.4cqh); }
    .field { border: 1px solid #94a3b8; border-radius: min(1.8mm, 0.6cqw); background: rgba(255,255,255,0.9); padding: min(2.8mm, 1.7cqw); min-height: min(17mm, 11cqh); overflow: hidden; }
    .field.expiry { border-color: #f59e0b; background: #fffbeb; }
    .field-label { color: #475569; text-transform: uppercase; font-size: min(7.5pt, 1.9cqw); font-weight: 900; letter-spacing: 0.06em; }
    .field.expiry .field-label { color: #92400e; }
    .field-value { margin-top: min(1.5mm, 0.9cqh); font-size: min(12.5pt, 3.2cqw); line-height: 1.2; font-weight: 750; overflow-wrap: anywhere; }
    .field-value.expiry { font-size: min(14pt, 3.5cqw); font-weight: 900; letter-spacing: 0.01em; }
    .barcode-section { margin-top: auto; border: min(1mm, 0.28cqw) solid var(--accent); background: #fff; border-radius: min(2mm, 0.7cqw); padding: min(4mm, 1.9cqh) min(3.5mm, 2.1cqw) min(3mm, 1.6cqh); display: flex; flex-direction: column; align-items: center; gap: min(1.5mm, 0.8cqh); overflow: hidden; }
    .barcode-label { color: #475569; text-transform: uppercase; font-size: min(7.5pt, 1.9cqw); font-weight: 900; letter-spacing: 0.06em; text-align: center; }
    .barcode-wrap { display: flex; flex-direction: column; justify-content: center; align-items: center; gap: min(1mm, 0.6cqh); }
    .barcode-wrap svg { width: min(45mm, 52cqw, 31cqh); height: min(45mm, 52cqw, 31cqh); }
    .barcode-text { font-family: 'Courier New', monospace; font-size: min(12.5pt, 3.1cqw); font-weight: 800; letter-spacing: 0.03em; }
    .receipt-text { font-size: min(7.5pt, 1.9cqw); color: #475569; font-weight: 700; text-align: center; overflow-wrap: anywhere; }
    .footer { display: flex; justify-content: space-between; align-items: center; gap: min(2mm, 1.2cqw); border-top: 0.5px solid #94a3b8; padding-top: min(2mm, 1.1cqh); flex-wrap: wrap; }
    .footer-text { font-size: min(7.5pt, 1.85cqw); color: #475569; font-weight: 700; }
    @media print {
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    }
  </style>
</head>
<body>
  ${labels.map((label) => renderPalletLabelSheet(label, printTimestamp)).join("")}
  <script>window.onload=()=>{window.print();window.close();}<\/script>
</body>
</html>`;
}

export function buildPalletLabelPrintHtml(props: PalletLabelPageProps, printTimestamp = formatPrintTimestamp()) {
  return buildPalletLabelBatchPrintHtml([props], printTimestamp);
}

export function PalletLabelPage(props: PalletLabelPageProps) {
  const {
    barcode,
    productSku,
    productName,
    quantity,
    receiptReference,
    trigger,
    onPrinted,
  } = props;
  const { accentColor, tempLabel, safeBarcode, displayExpiry, detailBits } = getPalletLabelModel(props);

  function handlePrint() {
    const win = window.open("", "_blank", "width=900,height=1100");
    if (!win) return;

    win.document.write(buildPalletLabelPrintHtml(props));
    win.document.close();
    void Promise.resolve(onPrinted?.());
  }

  return (
    <Dialog>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button size="sm" variant="outline">
            <Printer className="mr-1 h-3.5 w-3.5" />
            Print label
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[92vh] overflow-hidden sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Pallet Label — {barcode}</DialogTitle>
          <DialogDescription>Review the label layout before printing to the Zebra ZD421.</DialogDescription>
        </DialogHeader>

        {/* Preview */}
        <div className="max-h-[68vh] overflow-auto rounded-lg bg-muted/30 p-3">
          <div
            className="mx-auto flex aspect-[2/3] w-full max-w-[380px] flex-col gap-3 rounded-lg border-[4px] bg-white p-4 text-black shadow-xs"
            style={{ borderColor: accentColor, fontFamily: "system-ui, sans-serif" }}
          >
            <div className="h-1.5 w-full rounded-full" style={{ background: accentColor }} />

            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[10px] font-extrabold uppercase tracking-[0.18em]" style={{ color: accentColor }}>
                  Pallet Label
                </p>
                <p className="break-words text-[1.85rem] font-black leading-tight tracking-tight">{safeBarcode}</p>
              </div>
              <span
                className="shrink-0 rounded-full px-3 py-1 text-[10px] font-bold text-white"
                style={{ background: accentColor }}
              >
                {displayValue(tempLabel)}
              </span>
            </div>

            {detailBits.length > 0 && (
              <p className="text-[11px] leading-4 text-slate-600">
                {detailBits.join(" · ")}
              </p>
            )}

            <div className="grid grid-cols-2 gap-2">
              <FieldBlock label="SKU" value={productSku} />
              <FieldBlock label="Product" value={productName} />
              <FieldBlock label="Quantity" value={quantity} />
              <FieldBlock label="Expiry" value={displayExpiry} highlight valueClassName="text-[15px] font-black tracking-wide" />
            </div>

            <div className="mt-auto rounded-md border-2 bg-white p-3" style={{ borderColor: accentColor }}>
              <p className="text-center text-[10px] font-bold uppercase tracking-wide text-slate-500">Scan QR code</p>
              <div className="flex justify-center py-2">
                <BarcodePreview code={barcode} size={150} />
              </div>
              {hasValue(receiptReference) ? <p className="text-center text-[10px] font-semibold text-slate-500">Receipt {receiptReference}</p> : null}
            </div>

            <div className="grid grid-cols-3 gap-2 border-t border-slate-300 pt-2 text-[9px] font-semibold text-slate-500">
              <span className="truncate">Warehouse Wizard</span>
              <span className="truncate text-center">{formatPrintTimestamp()}</span>
              <span className="truncate text-right">v{__APP_VERSION__}</span>
            </div>
          </div>
        </div>

        <Button className="w-full" onClick={handlePrint}>
          <Printer className="mr-2 h-4 w-4" />
          Print Label
        </Button>
      </DialogContent>
    </Dialog>
  );
}

