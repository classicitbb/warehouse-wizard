import { useRef } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Printer, QrCode } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

interface BarcodePrintDialogProps {
  /** The value to encode in the QR code (e.g. pallet barcode, location code) */
  value: string;
  /** Primary human-readable label — shown large on the printed label */
  label?: string;
  /** Optional secondary line, e.g. item description or zone name */
  sublabel?: string;
  // Product / pallet enrichment (all optional — fill in as many as you have)
  productName?: string;
  sku?: string;
  quantity?: number;
  uom?: string;
  lotNumber?: string;
  batchNumber?: string;
  expiryDate?: string;
  temperatureClass?: string;
  clientName?: string;
  warehouseCode?: string;
  /** QR code size in px — defaults to 180 */
  size?: number;
  /** Custom trigger element; defaults to a ghost icon button */
  trigger?: React.ReactNode;
}

export function BarcodePrintDialog({
  value,
  label,
  sublabel,
  productName,
  sku,
  quantity,
  uom = "units",
  lotNumber,
  batchNumber,
  expiryDate,
  temperatureClass,
  clientName,
  warehouseCode,
  size = 180,
  trigger,
}: BarcodePrintDialogProps) {
  const qrRef = useRef<HTMLDivElement>(null);

  function handlePrint() {
    if (!qrRef.current) return;
    const printWindow = window.open("", "_blank", "width=480,height=600");
    if (!printWindow) return;

    const tempBadge = temperatureClass && temperatureClass !== "ambient"
      ? `<span class="temp-badge">${temperatureClass === "frozen" ? "❄ FROZEN" : "🧊 COOL CHAIN"}</span>`
      : "";

    const rows: string[] = [];
    if (quantity != null) rows.push(`<tr><td>Quantity</td><td><strong>${quantity.toLocaleString()} ${uom}</strong></td></tr>`);
    if (lotNumber) rows.push(`<tr><td>Lot</td><td>${lotNumber}</td></tr>`);
    if (batchNumber) rows.push(`<tr><td>Batch</td><td>${batchNumber}</td></tr>`);
    if (expiryDate) rows.push(`<tr><td>Expiry</td><td>${expiryDate}</td></tr>`);
    if (clientName) rows.push(`<tr><td>Client</td><td>${clientName}</td></tr>`);
    if (warehouseCode) rows.push(`<tr><td>Warehouse</td><td>${warehouseCode}</td></tr>`);

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Pallet Label — ${label ?? value}</title>
          <style>
            @page { margin: 10mm; size: A5; }
            * { box-sizing: border-box; margin: 0; padding: 0; }
            body {
              font-family: system-ui, -apple-system, sans-serif;
              background: #fff;
              color: #000;
              padding: 12px;
            }
            .label {
              border: 2px solid #000;
              border-radius: 6px;
              padding: 14px;
              display: flex;
              flex-direction: column;
              gap: 10px;
            }
            .header {
              display: flex;
              align-items: flex-start;
              justify-content: space-between;
              gap: 12px;
            }
            .product-block { flex: 1; min-width: 0; }
            .product-name {
              font-size: 20px;
              font-weight: 700;
              line-height: 1.2;
              word-break: break-word;
            }
            .sku {
              font-family: 'Courier New', monospace;
              font-size: 13px;
              color: #444;
              margin-top: 3px;
            }
            .temp-badge {
              display: inline-block;
              background: #dbeafe;
              color: #1d4ed8;
              border: 1px solid #93c5fd;
              border-radius: 4px;
              font-size: 11px;
              font-weight: 700;
              padding: 2px 7px;
              margin-top: 5px;
              letter-spacing: 0.05em;
            }
            .qr-block { flex-shrink: 0; }
            .divider { border: none; border-top: 1px 