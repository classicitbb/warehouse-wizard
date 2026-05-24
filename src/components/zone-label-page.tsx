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
  /** Zone or location code encoded in the QR */
  code: string;
  /** Human-readable name (Zone name or "Aisle A · Bay 3") */
  name: string;
  /** Warehouse name shown as subtitle */
  warehouseName?: string;
  /** e.g. "ambient" | "cool" | "frozen" */
  temperatureClass?: string;
  /** Badge flags */
  isStaging?: boolean;
  isDispatch?: boolean;
  isQuarantine?: boolean;
  /** Custom trigger; defaults to a ghost "A4 Label" button */
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

function badgeFlags(props: ZoneLabelPageProps): string[] {
  const badges: string[] = [];
  if (props.isStaging) badges.push("Staging");
  if (props.isDispatch) badges.push("Dispatch");
  if (props.isQuarantine) badges.push("Quarantine");
  return badges;
}

export function ZoneLabelPage(props: ZoneLabelPageProps) {
  const { code, name, warehouseName, temperatureClass = "ambient", trigger } = props;
  const accentColor = TEMP_COLOURS[temperatureClass] ?? TEMP_COLOURS.ambient;
  const tempLabel = TEMP_LABELS[temperatureClass] ?? temperatureClass;
  const flags = badgeFlags(props);

  function handlePrint() {
    const win = window.open("", "_blank", "width=794,height=1123");
    if (!win) return;

    win.document.write(`<!DOCTYPE html>
<html>
<head>
  <title>Zone Label — ${name}</title>
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
    .accent-bar {
      width: 100%;
      height: 12px;
      background: ${accentColor};
      border-radius: 4px;
      margin-bottom: 16mm;
    }
    .qr-wrap {
      display: flex;
      justify-content: center;
      margin-bottom: 12mm;
    }
    .zone-name {
      font-size: 48pt;
      font-weight: 800;
      letter-spacing: -0.02em;
      text-align: center;
      line-height: 1.1;
      color: #000;
    }
    .zone-code {
      font-size: 28pt;
      font-family: 'Courier New', monospace;
      letter-spacing: 0.06em;
      text-align: center;
      color: #333;
      margin-top: 6mm;
    }
    .warehouse-name {
      font-size: 14pt;
      color: #666;
      text-align: center;
      margin-top: 4mm;
    }
    .badges {
      display: flex;
      gap: 8px;
      justify-content: center;
      flex-wrap: wrap;
      margin-top: 8mm;
    }
    .badge {
      font-size: 11pt;
      font-weight: 600;
      padding: 4px 14px;
      border-radius: 999px;
      border: 2px solid ${accentColor};
      color: ${accentColor};
    }
    .temp-badge {
      font-size: 11pt;
      font-weight: 600;
      padding: 4px 14px;
      border-radius: 999px;
      background: ${accentColor};
      color: #fff;
    }
    .footer {
      margin-top: auto;
      padding-top: 12mm;
      font-size: 9pt;
      color: #aaa;
      text-align: center;
    }
  </style>
</head>
<body>
  <div class="accent-bar"></div>
  <div class="qr-wrap">
    <svg xmlns="http://www.w3.org/2000/svg" width="320" height="320" viewBox="0 0 320 320">
      <!-- QR placeholder replaced by actual SVG below -->
      ${document.getElementById("__zone-qr-svg-" + code)?.innerHTML ?? ""}
    </svg>
  </div>
  <p class="zone-name">${name}</p>
  <p class="zone-code">${code}</p>
  ${warehouseName ? `<p class="warehouse-name">${warehouseName}</p>` : ""}
  <div class="badges">
    <span class="temp-badge">${tempLabel}</span>
    ${flags.map((f) => `<span class="badge">${f}</span>`).join("")}
  </div>
  <p class="footer">Warehouse Wizard · Printed ${new Date().toLocaleDateString()}</p>
  <script>window.onload=()=>{window.print();window.close();}</script>
</body>
</html>`);

    // Inject the actual rendered QR SVG
    const svgEl = document.getElementById(`__zone-qr-svg-${code}`);
    if (svgEl) {
      const svgHtml = svgEl.innerHTML;
      const doc = win.document;
      const placeholder = doc.querySelector("svg");
      if (placeholder) placeholder.outerHTML = svgHtml;
    }

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

        {/* Hidden render target so we can capture the SVG for the print window */}
        <div id={`__zone-qr-svg-${code}`} className="sr-only" aria-hidden>
          <QRCodeSVG value={code} size={320} bgColor="#ffffff" fgColor="#000000" level="H" />
        </div>

        {/* Preview */}
        <div className="flex flex-col items-center gap-3 rounded-lg border border-border bg-white p-6 text-black">
          <div
            className="w-full h-2 rounded"
            style={{ background: accentColor }}
          />
          <QRCodeSVG value={code} size={140} bgColor="#ffffff" fgColor="#000000" level="H" />
          <p className="text-lg font-extrabold text-center leading-tight">{name}</p>
          <p className="font-mono text-sm tracking-widest text-gray-600">{code}</p>
          {warehouseName && (
            <p className="text-xs text-gray-500">{warehouseName}</p>
          )}
          <div className="flex flex-wrap gap-1.5 justify-center">
            <span
              className="rounded-full px-3 py-0.5 text-xs font-semibold text-white"
              style={{ background: accentColor }}
            >
              {tempLabel}
            </span>
            {flags.map((f) => (
              <span
                key={f}
                className="rounded-full border px-3 py-0.5 text-xs font-semibold"
                style={{ borderColor: accentColor, color: accentColor }}
              >
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
