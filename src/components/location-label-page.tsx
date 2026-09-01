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
import { displayRackLocationCode } from "@/features/setup/setup-core";

interface LocationLabelPageProps {
  code: string;
  aisle?: string | null;
  bay?: string | null;
  level?: number | null;
  locationType?: string | null;
  temperatureClass?: string;
  warehouseCode?: string | null;
  zoneCode?: string | null;
  warehouseName?: string;
  zoneName?: string;
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

const TYPE_LABELS: Record<string, string> = {
  rack: "Rack",
  staging: "Staging",
  quarantine: "Quarantine",
  dispatch: "Dispatch",
  receiving: "Receiving",
  floor: "Floor",
  returns: "Returns",
};

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function MachineCodePreview({ code, size = 132 }: { code: string; size?: number }) {
  return <QRCodeSVG value={code} size={size} level="M" />;
}

export function LocationLabelPage(props: LocationLabelPageProps) {
  const {
    code,
    aisle,
    bay,
    level,
    locationType,
    temperatureClass = "ambient",
    warehouseCode,
    zoneCode,
    warehouseName,
    zoneName,
    trigger,
  } = props;

  const accentColor = TEMP_COLOURS[temperatureClass] ?? TEMP_COLOURS.ambient;
  const tempLabel = TEMP_LABELS[temperatureClass] ?? temperatureClass;
  const typeLabel = locationType ? (TYPE_LABELS[locationType] ?? locationType) : null;
  const warehousePrefix = String(warehouseCode ?? "").trim();
  const zonePrefix = String(zoneCode ?? "").trim();
  const fullCodePrefix = warehousePrefix && zonePrefix ? `${warehousePrefix}-${zonePrefix}-` : "";
  const rawCode = String(code ?? "").trim();
  const unprefixedCode = fullCodePrefix && rawCode.toUpperCase().startsWith(fullCodePrefix.toUpperCase())
    ? rawCode.slice(fullCodePrefix.length)
    : rawCode;
  const labelCode = displayRackLocationCode(unprefixedCode);
  const locationParts = [
    aisle ? `Aisle ${aisle}` : null,
    bay ? `Bay ${bay}` : null,
    level != null ? `Level ${level}` : null,
  ].filter(Boolean).join(" · ");

  function handlePrint() {
    const machineEl = document.getElementById(`__loc-machine-${code}`);
    const machineMarkup = machineEl?.innerHTML ?? "";

    const win = window.open("", "_blank", "width=640,height=360");
    if (!win) return;

    win.document.write(`<!DOCTYPE html>
<html>
<head>
  <title>Location Label — ${escapeHtml(labelCode)}</title>
  <meta charset="utf-8" />
  <style>
    @page { size: 114.3mm 50.8mm landscape; margin: 0; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      width: 114.3mm;
      height: 50.8mm;
      background: #fff;
      font-family: system-ui, -apple-system, sans-serif;
      display: grid;
      grid-template-columns: 1fr 31mm;
      gap: 3mm;
      padding: 4mm;
    }
    .meta { min-width: 0; display: flex; flex-direction: column; justify-content: center; gap: 2mm; border-left: 2mm solid ${accentColor}; padding-left: 3mm; }
    .location-code { font-size: 19pt; font-weight: 900; letter-spacing: 0.01em; color: #000; line-height: 1.04; word-break: break-word; }
    .badges { display: flex; align-items: center; gap: 2mm; flex-wrap: wrap; }
    .badge { font-size: 7pt; font-weight: 700; padding: 1px 6px; border-radius: 999px; white-space: nowrap; }
    .temp-badge { background: ${accentColor}; color: #fff; }
    .type-badge { border: 1.5px solid ${accentColor}; color: ${accentColor}; }
    .sub { font-size: 8pt; color: #333; line-height: 1.2; }
    .qr-wrap { display: flex; justify-content: center; align-items: center; }
    .qr-wrap svg { width: 30mm; height: 30mm; }
  </style>
</head>
<body>
  <div class="meta">
    <span class="location-code">${escapeHtml(labelCode)}</span>
    <div class="badges">
      <span class="badge temp-badge">${escapeHtml(tempLabel)}</span>
      ${typeLabel ? `<span class="badge type-badge">${escapeHtml(typeLabel)}</span>` : ""}
    </div>
    ${locationParts ? `<p class="sub">${escapeHtml(locationParts)}</p>` : ""}
    ${zoneName ? `<p class="sub">Zone: ${escapeHtml(zoneName)}${warehouseName ? ` · ${escapeHtml(warehouseName)}` : ""}</p>` : (warehouseName ? `<p class="sub">${escapeHtml(warehouseName)}</p>` : "")}
  </div>
  <div class="qr-wrap">${machineMarkup}</div>
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
            <Printer className="mr-1 h-3.5 w-3.5" />
            Label
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Location Label — {labelCode}</DialogTitle>
        </DialogHeader>

        {/* Hidden machine-code render target for print capture */}
        <div id={`__loc-machine-${code}`} className="sr-only" aria-hidden>
          <MachineCodePreview code={labelCode} />
        </div>

        {/* Preview */}
        <div
          className="grid rounded-lg border border-border bg-white p-3 text-black"
          style={{ fontFamily: "system-ui, sans-serif", aspectRatio: "2.25 / 1", gridTemplateColumns: "minmax(0, 1fr) 30%" }}
        >
          <div className="flex min-w-0 flex-col justify-center gap-2 border-l-8 pl-3" style={{ borderColor: accentColor }}>
            <span className="break-words text-xl font-extrabold leading-tight tracking-tight">{labelCode}</span>
            <div className="flex flex-wrap items-center gap-1">
              <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold text-white whitespace-nowrap" style={{ background: accentColor }}>
                {tempLabel}
              </span>
              {typeLabel ? (
                <span
                  className="rounded-full border px-2 py-0.5 text-[10px] font-semibold whitespace-nowrap"
                  style={{ borderColor: accentColor, color: accentColor }}
                >
                  {typeLabel}
                </span>
              ) : null}
            </div>
            {locationParts ? <p className="text-xs text-gray-600">{locationParts}</p> : null}
            {(zoneName || warehouseName) ? <p className="text-xs text-gray-600">
              {zoneName ? `Zone: ${zoneName}` : ""}
              {zoneName && warehouseName ? " · " : ""}
              {warehouseName ?? ""}
            </p> : null}
          </div>
          <div className="flex items-center justify-center">
            <MachineCodePreview code={labelCode} size={128} />
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
