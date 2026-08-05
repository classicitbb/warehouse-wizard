import { QRCodeSVG } from "qrcode.react";
import { Printer } from "lucide-react";

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
  /** Custom trigger; defaults to an outline "A4 Label" button */
  trigger?: React.ReactNode;
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

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function ZoneLabelPage(props: ZoneLabelPageProps) {
  const { code, name, warehouseName, temperatureClass = "ambient", trigger } = props;
  const accentColor = TEMP_COLOURS[temperatureClass] ?? TEMP_COLOURS.ambient;
  const tempLabel = TEMP_LABELS[temperatureClass] ?? temperatureClass;

  const flags: string[] = [];
  if (props.isStaging) flags.push("Staging");
  if (props.isDispatch) flags.push("Dispatch");
  if (props.isQuarantine) flags.push("Quarantine");

  function handlePrint() {
    const qrEl = document.getElementById(`__zone-qr-${code}`);
    const qrSvg = qrEl?.innerHTML ?? "";

    const win = window.open("", "_blank", "width=794,height=1123");
    if (!win) return;

    win.document.write(`<!DOCTYPE html>
<html>
<head>
  <title>Zone Label — ${escapeHtml(name)}</title>
  <meta charset="utf-8" />
  <style>
    @page { size: A4 portrait; margin: 0; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      width: 210mm;
      min-height: 297mm;
      background: #fff;
      font-family: system-ui, -apple-system, sans-serif;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 24mm 20mm;
    }
    .accent-bar { width: 100%; height: 12px; background: ${accentColor}; border-radius: 4px; margin-bottom: 16mm; }
    .qr-wrap { display: flex; justify-content: center; margin-bottom: 12mm; }
    .qr-wrap svg { width: 200px; height: 200px; }
    .zone-name { font-size: 48pt; font-weight: 800; letter-spacing: -0.02em; text-align: center; line-height: 1.1; color: #000; }
    .zone-code { font-size: 28pt; font-family: 'Courier New', monospace; letter-spacing: 0.06em; text-align: center; color: #333; margin-top: 6mm; }
    .warehouse-name { font-size: 14pt; color: #666; text-align: center; margin-top: 4mm; }
    .badges { display: flex; gap: 8px; justify-content: center; flex-wrap: wrap; margin-top: 8mm; }
    .badge { font-size: 11pt; font-weight: 600; padding: 4px 14px; border-radius: 999px; border: 2px solid ${accentColor}; color: ${accentColor}; }
    .temp-badge { font-size: 11pt; font-weight: 600; padding: 4px 14px; border-radius: 999px; background: ${accentColor}; color: #fff; }
    .footer { margin-top: auto; padding-top: 12mm; font-size: 9pt; color: #aaa; text-align: center; }
  </style>
</head>
<body>
  <div class="accent-bar"></div>
  <div class="qr-wrap">${qrSvg}</div>
  <p class="zone-name">${escapeHtml(name)}</p>
  <p class="zone-code">${escapeHtml(code)}</p>
  ${warehouseName ? `<p class="warehouse-name">${escapeHtml(warehouseName)}</p>` : ""}
  <div class="badges">
    <span class="temp-badge">${escapeHtml(tempLabel)}</span>
    ${flags.map((f) => `<span class="badge">${escapeHtml(f)}</span>`).join("")}
  </div>
  <p class="footer">3PL Management · Printed ${new Date().toLocaleDateString()}</p>
  <script>window.onload=()=>{window.print();window.close();}<\/script>
</body>
</html>`);
    win.document.close();
  }

  return (
    <Dialog>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button size="sm" variant="outline">
            <Printer className="mr-1 h-3.5 w-3.5" />
            A4 Label
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>A4 Zone Label — {name}</DialogTitle>
        </DialogHeader>

        {/* Hidden QR render target for print capture */}
        <div id={`__zone-qr-${code}`} className="sr-only" aria-hidden>
          <QRCodeSVG value={code} size={200} bgColor="#ffffff" fgColor="#000000" level="H" />
        </div>

        {/* Preview */}
        <div className="flex flex-col items-center gap-3 rounded-lg border border-border bg-white p-6 text-black">
          <div className="w-full h-2 rounded" style={{ background: accentColor }} />
          <QRCodeSVG value={code} size={140} bgColor="#ffffff" fgColor="#000000" level="H" />
          <p className="text-lg font-extrabold text-center leading-tight">{name}</p>
          <p className="font-mono text-sm tracking-widest text-gray-600">{code}</p>
          {warehouseName && <p className="text-xs text-gray-500">{warehouseName}</p>}
          <div className="flex flex-wrap gap-1.5 justify-center">
            <span className="rounded-full px-3 py-0.5 text-xs font-semibold text-white" style={{ background: accentColor }}>
              {tempLabel}
            </span>
            {flags.map((f) => (
              <span key={f} className="rounded-full border px-3 py-0.5 text-xs font-semibold" style={{ borderColor: accentColor, color: accentColor }}>
                {f}
              </span>
            ))}
          </div>
        </div>

        <Button className="w-full" onClick={handlePrint}>
          <Printer className="mr-2 h-4 w-4" />
          Print A4 Label
        </Button>
      </DialogContent>
    </Dialog>
  );
}
