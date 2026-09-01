import { useState } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QRCodeSVG } from "qrcode.react";
import { Printer } from "lucide-react";

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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { displayRackLocationCode } from "@/features/setup/setup-core";

// ─── Types ────────────────────────────────────────────────────────────────────

export type LabelSheetItem = {
  code: string;
  title?: string | null;
  subtitle?: string | null;
  aisle?: string | null;
  bay?: string | null;
  level?: number | string | null;
  locationType?: string | null;
  temperatureClass?: string | null;
  warehouseName?: string | null;
  zoneName?: string | null;
};

type LabelSheetKind = "location" | "zone";
type LocationLabelSize = "a4-16up" | "label-99x38" | "label-4x2";

// ─── Constants ────────────────────────────────────────────────────────────────

const TEMP_COLOURS: Record<string, string> = {
  ambient: "#1a1a2e",
  cool: "#1565c0",
  frozen: "#4a148c",
};

const TEMP_LABELS: Record<string, string> = {
  ambient: "Ambient",
  cool: "Cool",
  frozen: "Frozen",
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

const BAY_LABEL_HINT = "152.4 × 101.6 mm landscape · Zebra ZD420 / Rollo / Dymo 4XL label printer";

const LOCATION_LABEL_SIZES: Array<{ value: LocationLabelSize; label: string; hint: string }> = [
  { value: "a4-16up",     label: "A4 Sheet — 16-up", hint: "Avery 99×38 mm · 16 labels/sheet · Standard laser/inkjet printer" },
  { value: "label-99x38", label: "99 × 38 mm Label",  hint: "99 × 38 mm single label · desktop label printer" },
  { value: "label-4x2",   label: "4 × 2 in Label",    hint: "101.6 × 50.8 mm · Standard label printer (landscape)" },
];

// ─── Shared helpers ───────────────────────────────────────────────────────────

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderQrSvg(value: string) {
  return renderToStaticMarkup(<QRCodeSVG value={value} size={512} level="H" />);
}

function rackLabelFromZoneCode(code: string) {
  const normalized = String(code ?? "").trim();
  const segments = normalized.split("-").filter(Boolean);
  const zoneCode = segments[segments.length - 1] || normalized;
  return `Rack ${zoneCode}`;
}

function locationPrintCode(item: LabelSheetItem) {
  return displayRackLocationCode(String(item.code ?? "").trim());
}

function accentFor(item: LabelSheetItem) {
  return TEMP_COLOURS[String(item.temperatureClass ?? "ambient")] ?? TEMP_COLOURS.ambient;
}

function locationLine(item: LabelSheetItem) {
  return [
    item.aisle ? `Aisle ${item.aisle}` : null,
    item.bay   ? `Bay ${item.bay}`     : null,
    item.level != null && item.level !== "" ? `Level ${item.level}` : null,
  ].filter(Boolean).join(" · ");
}

const BASE_CSS = `* { box-sizing: border-box; margin: 0; padding: 0; }
body { background: #fff; font-family: system-ui, -apple-system, sans-serif; color: #000; }`;

// ─── Code label renderer ──────────────────────────────────────────────────────

function bayLabelBodyHtml(item: LabelSheetItem) {
  const qr = renderQrSvg(item.code);
  const { prefix, number } = bayLabelParts(item.code);
  return `
    <div class="bay-label">
      <div class="bay-title">
        <span>${escapeHtml(prefix)}</span>
        ${number ? `<span>-</span><span class="bay-title-number">${escapeHtml(number)}</span>` : ""}
      </div>
      <div class="bay-qr">
        ${qr}
      </div>
    </div>`;
}

function bayLabelParts(code: string) {
  const [prefix, ...parts] = String(code ?? "").split("-");
  return { prefix, number: parts.join("-") };
}

function codeLabelBodyHtml(item: LabelSheetItem) {
  const qr = renderQrSvg(item.code);
  const label = rackLabelFromZoneCode(item.code);
  return `
    <div class="code-label">
      <div class="code-qr">${qr}</div>
      <div class="code-text">${escapeHtml(label)}</div>
    </div>`;
}

// ─── Location label renderer ──────────────────────────────────────────────────

function locationLabelHtml(item: LabelSheetItem) {
  const accent = accentFor(item);
  const temp   = TEMP_LABELS[String(item.temperatureClass ?? "ambient")] ?? "Ambient";
  const type   = item.locationType ? (TYPE_LABELS[item.locationType] ?? item.locationType) : null;
  const parts  = locationLine(item);
  const code   = locationPrintCode(item);
  const qr     = renderQrSvg(code);
  return `
    <div class="loc">
      <div class="loc-meta" style="border-color:${accent}">
        <div class="loc-code">${escapeHtml(code)}</div>
        <div class="loc-badges">
          <span class="badge tbadge" style="background:${accent}">${escapeHtml(temp)}</span>
          ${type ? `<span class="badge ybadge" style="border-color:${accent};color:${accent}">${escapeHtml(type)}</span>` : ""}
        </div>
        ${parts ? `<div class="loc-sub">${escapeHtml(parts)}</div>` : ""}
        ${item.zoneName || item.warehouseName
          ? `<div class="loc-sub">${item.zoneName ? `Zone: ${escapeHtml(item.zoneName)}` : ""}${item.zoneName && item.warehouseName ? " · " : ""}${escapeHtml(item.warehouseName ?? "")}</div>`
          : ""}
      </div>
      <div class="loc-qr">${qr}</div>
    </div>`;
}

const LOC_CSS = `
  .loc { width: 100%; height: 100%; display: grid; grid-template-columns: 1fr 28mm; gap: 3mm; align-items: center; }
  .loc-meta { min-width: 0; display: flex; flex-direction: column; gap: 1.5mm; border-left: 2mm solid; padding-left: 3mm; justify-content: center; }
  .loc-code { font-size: 16pt; font-weight: 900; line-height: 1.02; word-break: break-word; }
  .loc-badges { display: flex; gap: 1.5mm; flex-wrap: wrap; }
  .badge { font-size: 6.5pt; font-weight: 800; padding: 1px 5px; border-radius: 999px; }
  .tbadge { color: #fff; }
  .ybadge { border: 1px solid; }
  .loc-sub { font-size: 7.5pt; color: #222; line-height: 1.2; }
  .loc-qr svg { width: 27mm; height: 27mm; }`;

// ─── Zone label renderer ──────────────────────────────────────────────────────

function zoneLabelHtml(item: LabelSheetItem) {
  return codeLabelBodyHtml(item);
}

const CODE_LABEL_CSS = `
  .code-label { width: 100%; height: 100%; display: grid; grid-template-rows: 1fr auto; align-items: center; justify-items: center; gap: 0.08in; padding: 5px; overflow: hidden; text-align: center; }
  .code-qr { position: relative; width: 100%; min-height: 0; display: flex; align-items: center; justify-content: center; }
  .code-qr svg { width: min(3.86in, 100%); height: min(3.86in, 100%); }
  .code-text { width: 100%; font-family: 'Arial Black', system-ui, sans-serif; font-size: 34pt; font-weight: 900; line-height: 1; overflow-wrap: anywhere; }
  .qr-code-overlay { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); border: 2px solid #000; background: #fff; padding: 2px 7px; font-family: 'Arial Black', system-ui, sans-serif; font-size: 18pt; font-weight: 900; line-height: 1; letter-spacing: 0.02em; }`;

const BAY_LABEL_CSS = `
  .bay-label { width: 100%; height: 100%; display: grid; grid-template-columns: auto minmax(0, 1fr); align-items: center; justify-items: center; gap: 0.18in; padding: 0.12in; overflow: hidden; }
  .bay-title { display: flex; flex-direction: column; align-items: center; font-family: 'Arial Black', system-ui, sans-serif; font-size: 34pt; font-weight: 900; line-height: 1; letter-spacing: 0.04em; }
  .bay-title-number { letter-spacing: 0; }
  .bay-qr { position: relative; width: 100%; min-width: 0; height: 100%; display: flex; align-items: center; justify-content: center; }
  .bay-qr svg { width: min(3.5in, 100%); height: min(3.5in, 100%); transform: rotate(90deg); }
`;

// ─── Print window helper ──────────────────────────────────────────────────────

function openPrint(title: string, body: string, pageSize: string, css: string) {
  const win = window.open("", "_blank", "width=900,height=1100");
  if (!win) return;
  win.document.write(`<!DOCTYPE html><html><head>
    <title>${escapeHtml(title)}</title><meta charset="utf-8" />
    <style>
      @page { size: ${pageSize}; margin: 0; }
      ${BASE_CSS}
      ${css}
      @media print { .cell,.lpage { border-color: transparent !important; } }
    </style>
  </head><body>${body}<script>window.onload=()=>{window.print();window.close();}</script></body></html>`);
  win.document.close();
}

function buildSheets<T>(
  items: T[],
  perSheet: number,
  renderItem: (item: T | null) => string,
): string {
  const total   = Math.max(1, Math.ceil(items.length / perSheet));
  const slots   = total * perSheet;
  const filled  = Array.from({ length: slots }, (_, i) => items[i] ?? null) as Array<T | null>;
  return Array.from({ length: total }, (_, s) =>
    `<section class="sheet">${filled.slice(s * perSheet, (s + 1) * perSheet).map(renderItem).join("")}</section>`,
  ).join("");
}

// ─── Bay print ────────────────────────────────────────────────────────────────

function printBayLabels(items: LabelSheetItem[]) {
  const html = items.map((item) =>
    `<div class="lpage">${bayLabelBodyHtml(item)}</div>`,
  ).join("");
  openPrint(`Bay Labels — ${items.length} labels`, html, "6in 4in landscape", `
    .lpage { position: relative; width: 6in; height: 4in; overflow: hidden;
      border: 1px solid #000; display: flex; page-break-after: always; }
    .lpage:last-child { page-break-after: auto; }
    ${BAY_LABEL_CSS}`);
}

// ─── Location print ───────────────────────────────────────────────────────────

function printLocationLabels(items: LabelSheetItem[], size: LocationLabelSize) {
  if (size === "a4-16up") {
    const html = buildSheets(items, 16, (item) =>
      item
        ? `<div class="cell">${locationLabelHtml(item)}</div>`
        : `<div class="cell empty"></div>`,
    );
    openPrint(`Location Labels — ${items.length} labels`, html, "A4 portrait", `
      .sheet { width: 210mm; height: 297mm; display: grid;
        grid-template-columns: repeat(2, 105mm); grid-template-rows: repeat(8, 37.1mm);
        page-break-after: always; }
      .sheet:last-child { page-break-after: auto; }
      .cell { width: 105mm; height: 37.1mm; padding: 3mm; overflow: hidden;
        border: 0.25mm dashed #d1d5db; display: flex; }
      .cell.empty { opacity: 0.15; }
      ${LOC_CSS}`);
    return;
  }
  const dims: Record<string, { w: string; h: string; orient: string }> = {
    "label-99x38": { w: "99mm", h: "38mm", orient: "landscape" },
    "label-4x2":   { w: "4in",  h: "2in",  orient: "landscape" },
  };
  const d = dims[size] ?? dims["label-99x38"];
  const html = items.map((item) =>
    `<div class="lpage">${locationLabelHtml(item)}</div>`,
  ).join("");
  openPrint(`Location Labels — ${items.length} labels`, html, `${d.w} ${d.h} ${d.orient}`, `
    .lpage { width: ${d.w}; height: ${d.h}; padding: 3mm; overflow: hidden;
      display: flex; page-break-after: always; }
    .lpage:last-child { page-break-after: auto; }
    ${LOC_CSS}`);
}

// ─── Zone print ───────────────────────────────────────────────────────────────

function printZoneLabels(items: LabelSheetItem[]) {
  const html = items.map((item) =>
    `<div class="lpage">${zoneLabelHtml(item)}</div>`,
  ).join("");
  openPrint(`Zone Labels — ${items.length} labels`, html, "4in 6in portrait", `
    .lpage { position: relative; width: 4in; height: 6in; overflow: hidden;
      border: 1px solid #000; display: flex; page-break-after: always; }
    .lpage:last-child { page-break-after: auto; }
    ${CODE_LABEL_CSS}`);
}

// ─── Preview components ───────────────────────────────────────────────────────

function PageNav({ page, total, onChange }: { page: number; total: number; onChange: (p: number) => void }) {
  if (total <= 1) return null;
  return (
    <div className="flex items-center justify-center gap-2">
      <button className="rounded border px-2 py-0.5 text-xs disabled:opacity-40"
        disabled={page === 0} onClick={() => onChange(Math.max(0, page - 1))}>‹</button>
      <span className="text-xs text-muted-foreground">Sheet {page + 1} of {total}</span>
      <button className="rounded border px-2 py-0.5 text-xs disabled:opacity-40"
        disabled={page === total - 1} onClick={() => onChange(Math.min(total - 1, page + 1))}>›</button>
    </div>
  );
}

/** 6x4 landscape single-label preview for bay codes */
function BaySheetPreview({ items }: { items: LabelSheetItem[] }) {
  const item = items[0];
  if (!item) return null;
  const { prefix, number } = bayLabelParts(item.code);
  return (
    <div className="relative mx-auto grid aspect-[3/2] w-full max-w-[420px] grid-cols-[auto_minmax(0,1fr)] items-center justify-items-center gap-3 overflow-hidden border border-black bg-white p-3 text-black shadow-sm">
      <div className="flex flex-col items-center text-7xl font-black leading-none tracking-wide">
        <span>{prefix}</span>
        {number ? <>
          <span>-</span>
          <span className="tracking-normal">{number}</span>
        </> : null}
      </div>
      <div className="relative flex min-h-0 min-w-0 items-center justify-center">
        <QRCodeSVG value={item.code} size={255} level="H" className="rotate-90" />
      </div>
    </div>
  );
}

function ZoneSheetPreview({ items }: { items: LabelSheetItem[] }) {
  const item = items[0];
  if (!item) return null;
    return (
      <div className="mx-auto grid aspect-[2/3] w-full max-w-[280px] grid-rows-[1fr_auto] items-center justify-items-center gap-1 overflow-hidden border border-black bg-white p-[5px] text-center text-black shadow-sm">
        <div className="flex min-h-0 w-full items-center justify-center">
          <QRCodeSVG value={item.code} size={255} level="H" />
        </div>
        <div className="w-full break-words text-4xl font-black leading-none">{rackLabelFromZoneCode(item.code)}</div>
      </div>
    );
  }

/** Miniaturised A4 sheet preview for location labels */
function LocationSheetPreview({ items }: { items: LabelSheetItem[] }) {
  const [page, setPage] = useState(0);
  const perSheet = 16;
  const cols = 2;
  const rows = 8;
  const totalSheets = Math.max(1, Math.ceil(items.length / perSheet));
  const curPage = Math.min(page, totalSheets - 1);
  const cells = Array.from({ length: perSheet }, (_, i) => items[curPage * perSheet + i] ?? null);

  return (
    <div className="space-y-2">
      <div className="mx-auto overflow-hidden rounded border border-border bg-gray-100 shadow-sm"
        style={{ aspectRatio: "1/1.414", maxWidth: 340, fontFamily: "system-ui, sans-serif", padding: "2%" }}>
        <div className="grid h-full gap-[0.8%]"
          style={{ gridTemplateColumns: `repeat(${cols}, 1fr)`, gridTemplateRows: `repeat(${rows}, 1fr)` }}>
          {cells.map((item, i) => item ? (
            <div key={i} className="overflow-hidden rounded-sm border border-dashed border-gray-300 bg-white">
              <div className="flex h-full items-center gap-0.5 py-0.5 pr-0.5"
                style={{ borderLeft: `2px solid ${accentFor(item)}`, paddingLeft: 2 }}>
                <div className="flex flex-1 flex-col gap-0.5 min-w-0">
                  <span className="text-[7px] font-black leading-none break-words">{item.code}</span>
                  {locationLine(item) && <span className="text-[5px] text-gray-500 truncate">{locationLine(item)}</span>}
                </div>
                <QRCodeSVG value={item.code} size={16} level="L" />
              </div>
            </div>
          ) : (
            <div key={i} className="rounded-sm border border-dotted border-gray-200 bg-gray-50 opacity-25" />
          ))}
        </div>
      </div>
      <PageNav page={curPage} total={totalSheets} onChange={setPage} />
    </div>
  );
}

function LabelSheetPreview({ items, kind }: { items: LabelSheetItem[]; kind: LabelSheetKind }) {
  return kind === "zone" ? <ZoneSheetPreview items={items} /> : <LocationSheetPreview items={items} />;
}

// ─── Dialogs ──────────────────────────────────────────────────────────────────

export function LabelSheetPrintDialog({
  items,
  resourceLabel,
  kind = "location",
  trigger,
}: {
  items: LabelSheetItem[];
  resourceLabel: string;
  kind?: LabelSheetKind;
  trigger: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [locSize, setLocSize] = useState<LocationLabelSize>("a4-16up");

  const isSheet    = kind === "location" && locSize === "a4-16up";
  const perSheet   = 16;
  const totalSheets = isSheet ? Math.max(1, Math.ceil(items.length / perSheet)) : items.length;

  function handlePrint() {
    if (items.length === 0) return;
    if (kind === "zone") printZoneLabels(items);
    else printLocationLabels(items, locSize);
    setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Print {resourceLabel} Labels</DialogTitle>
          <DialogDescription>
            {items.length} label{items.length !== 1 ? "s" : ""}
            {isSheet
              ? ` · ${totalSheets} sheet${totalSheets !== 1 ? "s" : ""}`
              : ` · ${items.length} 4 x 6 label${items.length !== 1 ? "s" : ""}`}.
          </DialogDescription>
        </DialogHeader>

        {kind === "location" && (
          <div className="space-y-1">
            <div className="flex items-center gap-3">
              <Label className="shrink-0 text-sm">Label size</Label>
              <Select value={locSize} onValueChange={(v) => setLocSize(v as LocationLabelSize)}>
                <SelectTrigger className="flex-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {LOCATION_LABEL_SIZES.map((s) => (
                    <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <p className="pl-1 text-xs text-muted-foreground">
              {LOCATION_LABEL_SIZES.find((s) => s.value === locSize)?.hint}
            </p>
          </div>
        )}
        {kind === "zone" && (
          <p className="text-xs text-muted-foreground">4 x 6 in label · Zebra ZD420 / Rollo / Dymo 4XL label printer</p>
        )}

        {/* Sheet preview */}
        <LabelSheetPreview items={items} kind={kind} />

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={handlePrint} disabled={items.length === 0}>
            <Printer className="mr-2 h-4 w-4" />
            Print {items.length} label{items.length !== 1 ? "s" : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function BayLocationCodesPrintDialog({
  items,
  trigger,
  open: controlledOpen,
  onOpenChange,
}: {
  items: LabelSheetItem[];
  trigger?: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = controlledOpen ?? uncontrolledOpen;
  const setOpen = (nextOpen: boolean) => {
    if (controlledOpen === undefined) setUncontrolledOpen(nextOpen);
    onOpenChange?.(nextOpen);
  };

  function handlePrint() {
    if (items.length === 0) return;
    printBayLabels(items);
    setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger ? <DialogTrigger asChild>{trigger}</DialogTrigger> : null}
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Print Bay Location Codes</DialogTitle>
          <DialogDescription>
            {items.length} bay code{items.length !== 1 ? "s" : ""}
            {` · ${items.length} 6 x 4 landscape label${items.length !== 1 ? "s" : ""}`}.
          </DialogDescription>
        </DialogHeader>

        <p className="text-xs text-muted-foreground">{BAY_LABEL_HINT}</p>

        {/* Label preview */}
        <BaySheetPreview items={items} />

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={handlePrint} disabled={items.length === 0}>
            <Printer className="mr-2 h-4 w-4" />
            Print {items.length} label{items.length !== 1 ? "s" : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
