import { QRCodeSVG } from "qrcode.react";
import { renderToStaticMarkup } from "react-dom/server";
import { QrCode } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

interface ZoneLabelPageProps {
  /** The value encoded in the QR code (zone code) */
  code: string;
  /** Human-readable zone name */
  name: string;
  /** Warehouse name shown as subtitle */
  warehouseName?: string;
  /** "ambient" | "cool" | "frozen" */
  temperatureClass?: string;
  isStaging?: boolean;
  isDispatch?: boolean;
  isQuarantine?: boolean;
  /** Custom trigger; defaults to an outline "Print label" button */
  trigger?: React.ReactNode;
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function rackLabelFromZoneCode(code: string) {
  const normalized = String(code ?? "").trim();
  const segments = normalized.split("-").filter(Boolean);
  const zoneCode = segments[segments.length - 1] || normalized;
  return `Rack ${zoneCode}`;
}

export function ZoneLabelPage(props: ZoneLabelPageProps) {
  const { code, trigger } = props;
  const rackLabel = rackLabelFromZoneCode(code);

  function handlePrint() {
    const qrSvg = renderToStaticMarkup(<QRCodeSVG value={code} size={512} bgColor="#ffffff" fgColor="#000000" level="H" />);

    const win = window.open("", "_blank", "width=794,height=1123");
    if (!win) return;

    win.document.write(`<!DOCTYPE html>
<html>
<head>
  <title>Zone Label — ${escapeHtml(rackLabel)}</title>
  <meta charset="utf-8" />
  <style>
    @page { size: 4in 6in portrait; margin: 0; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      width: 4in;
      height: 6in;
      background: #fff;
      color: #000;
      font-family: system-ui, -apple-system, sans-serif;
    }
    .label {
      width: 4in;
      height: 6in;
      border: 1px solid #000;
      display: grid;
      grid-template-rows: 1fr auto;
      align-items: center;
      justify-items: center;
      gap: 0.08in;
      overflow: hidden;
      padding: 5px;
      text-align: center;
    }
    .qr-wrap { width: 100%; min-height: 0; display: flex; align-items: center; justify-content: center; }
    .qr-wrap svg { width: min(3.86in, 100%); height: min(3.86in, 100%); }
    .zone-code { width: 100%; font-family: 'Arial Black', system-ui, sans-serif; font-size: 34pt; font-weight: 900; line-height: 1; overflow-wrap: anywhere; }
  </style>
</head>
<body>
  <section class="label">
    <div class="qr-wrap">${qrSvg}</div>
    <p class="zone-code">${escapeHtml(rackLabel)}</p>
  </section>
  <script>window.onload=()=>{window.print();window.close();}</script>
</body>
</html>`);
    win.document.close();
  }

  return (
    <Dialog>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button size="sm" variant="outline">
            <QrCode className="mr-1 h-3.5 w-3.5" />
            Print label
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Zone Label — {rackLabel}</DialogTitle>
        </DialogHeader>

        {/* Preview */}
        <div className="mx-auto grid aspect-[2/3] w-full max-w-[280px] grid-rows-[1fr_auto] items-center justify-items-center gap-1 border border-black bg-white p-[5px] text-center text-black">
          <div className="flex min-h-0 w-full items-center justify-center">
            <QRCodeSVG value={code} size={255} bgColor="#ffffff" fgColor="#000000" level="H" />
          </div>
          <p className="w-full break-words text-4xl font-black leading-none">{rackLabel}</p>
        </div>

        <Button className="w-full" onClick={handlePrint}>
          <QrCode className="mr-2 h-4 w-4" />
          Print 4 x 6 Label
        </Button>
      </DialogContent>
    </Dialog>
  );
}
