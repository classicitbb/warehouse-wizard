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
type BayLabelSize = "a4-6up" | "label-4x6" | "label-4x4" | "label-2x4";
type LocationLabelSize = "a4-16up" | "label-99x38" | "label-4x2";

// ─── Constants ────────────────────────────────────────────────────────────────

const TEAL = "#0f766e";

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

const BAY_LABEL_SIZES: Array<{ value: BayLabelSize; label: string; hint: string }> = [
  { value: "a4-6up",    label: "A4 Sheet — 6-up",  hint: "Avery 99×93 mm · 6 labels/sheet · Standard laser/inkjet printer" },
  { value: "label-4x6", label: "4 × 6 in Label",    hint: "101.6 × 152.4 mm · Zebra ZD420 / Rollo / Dymo 4XL label printer" },
  { value: "label-4x4", label: "4 × 4 in Label",    hint: "101.6 × 101.6 mm · Square racking / pallet label" },
  { value: "label-2x4", label: "2 × 4 in Label",    hint: "50.8 × 101.6 mm · Compact rack / shelf label" },
];

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
  return renderToStaticMarkup(<QRCodeSVG value={value} size={256} level="M" />);
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

// Corner L-shaped cut marks
const CUT_CSS = `
  .cut { position: absolute; width: 5mm; height: 5mm; }
  .cut-tl { top: 1mm; left: 1mm; border-top: 0.5px solid #999; border-left: 0.5px solid #999; }
  .cut-tr { top: 1mm; right: 1mm; border-top: 0.5px solid #999; border-right: 0.5px solid #999; }
  .cut-bl { bottom: 1mm; left: 1mm; border-bottom: 0.5px solid #999; border-left: 0.5px solid #999; }
  .cut-br { bottom: 1mm; right: 1mm; border-bottom: 0.5px solid #999; border-right: 0.5px solid #999; }`;

const CUT_HTML = `<div class="cut cut-tl"></div><div class="cut cut-tr"></div><div class="cut cut-bl"></div><div class="cut cut-br"></div>`;

// ─── Bay label renderer ───────────────────────────────────────────────────────
// Design: left teal bar · "BAY CODE" eyebrow · large code · Aisle/Bay line · rack/warehouse subtitle · QR

function bayLabelBodyHtml(item: LabelSheetItem) {
  const parts = locationLine(item);
  const qr = renderQrSvg(item.code);
  return `
    <div class="bay-wrap">
      <div class="bay-bar"></div>
      <div class="bay-body">
        <div class="bay-text">
          <div class="bay-eyebrow">Bay Code</div>
          <div class="bay-code">${escapeHtml(item.code)}</div>
          ${parts        ? `<div class="bay-title">${escapeHtml(parts)}</div>` : ""}
          ${item.subtitle ? `<div class="bay-sub">${escapeHtml(item.subtitle)}</div>` : ""}
        </div>
        <div class="bay-qr">${qr}</div>
      </div>
    </div>`;
}

function bayLabelCss(codeSize: string, qrSize: string, teal = TEAL) {
  return `
    .bay-wrap { width: 100%; height: 100%; display: flex; }
    .bay-bar  { width: 3mm; flex-shrink: 0; background: ${teal}; }
    .bay-body { flex: 1; display: flex; flex-direction: column; padding: 4mm; gap: 2.5mm; min-height: 0; }
    .bay-text { display: flex; flex-direction: column; gap: 1.5mm; }
    .bay-eyebrow { font-size: 8pt; font-weight: 800; text-transform: uppercase; color: ${teal}; letter-spacing: 0.08em; }
    .bay-code { font-size: ${codeSize}; font-weight: 900; line-height: 1.05; word-break: break-word; color: #000; }
    .bay-title { font-size: 11pt; font-weight: 700; color: #000; }
    .bay-sub  { font-size: 8.5pt; color: #555; text-transform: uppercase; letter-spacing: 0.04em; }
    .bay-qr   { flex: 1; display: flex; align-items: center; justify-content: center; min-height: 0; }
    .bay-qr svg { width: ${qrSize}; height: ${qrSize}; max-width: 100%; max-height: 100%; }`;
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
  const accent = accentFor(item);
  const temp   = TEMP_LABELS[String(item.temperatureClass ?? "ambient")] ?? "Ambient";
  const qr     = renderQrSvg(item.code);
  return `
    <div class="zone">
      <div class="zone-meta" style="border-color:${accent}">
        <div class="zone-eyebrow">Zone Aisle Code</div>
        <div class="zone-code">${escapeHtml(item.code)}</div>
        ${item.title    ? `<div class="zone-title">${escapeHtml(item.title)}</div>`    : ""}
        ${item.subtitle ? `<div class="zone-sub">${escapeHtml(item.subtitle)}</div>` : ""}
        <span class="zone-temp" style="background:${accent}">${escapeHtml(temp)}</span>
      </div>
      <div class="zone-qr">${qr}</div>
    </div>`;
}

const ZONE_CSS = `
  .zone { width: 100%; height: 100%; display: grid; grid-template-rows: 1fr 40mm; gap: 3mm; }
  .zone-meta { display: flex; flex-direction: column; gap: 2mm; border-left: 3mm solid; padding-left: 4mm; justify-content: center; }
  .zone-eyebrow { font-size: 8.5pt; font-weight: 900; text-transform: uppercase; color: #334155; letter-spacing: .05em; }
  .zone-code  { font-size: 24pt; font-weight: 900; line-height: 1.05; word-break: break-word; }
  .zone-title { font-size: 12pt; font-weight: 800; }
  .zone-sub   { font-size: 9.5pt; color: #334155; }
  .zone-temp  { width: fit-content; border-radius: 999px; padding: 2px 10px; color: #fff; font-size: 7.5pt; font-weight: 800; }
  .zone-qr    { display: flex; justify-content: center; }
  .zone-qr svg { width: 38mm; height: 38mm; }`;

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
  </head><body>${body}<script>window.onload=()=>{window.print();window.close();}<\/script></body></html>`);
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

function printBayLabels(items: LabelSheetItem[], size: BayLabelSize) {
  if (size === "a4-6up") {
    const html = buildSheets(items, 6, (item) =>
      item
        ? `<div class="cell">${CUT_HTML}${bayLabelBodyHtml(item)}</div>`
        : `<div class="cell empty"></div>`,
    );
    openPrint(`Bay Labels — ${items.length} labels`, html, "A4 portrait", `
      .sheet { width: 210mm; height: 297mm; padding: 8mm 6mm; display: grid;
        grid-template-columns: repeat(2, 99mm); grid-template-rows: repeat(3, 91mm);
        gap: 2mm; page-break-after: always; }
      .sheet:last-child { page-break-after: auto; }
      .cell { position: relative; width: 99mm; height: 91mm; overflow: hidden;
        border: 0.6px dashed #bbb; }
      .cell.empty { opacity: 0.15; }
      ${CUT_CSS}
      ${bayLabelCss("20pt", "36mm")}`);
    return;
  }
  const dims: Record<string, { w: string; h: string; code: string; qr: string }> = {
    "label-4x6": { w: "4in",   h: "6in",   code: "28pt", qr: "52mm" },
    "label-4x4": { w: "4in",   h: "4in",   code: "24pt", qr: "44mm" },
    "label-2x4": { w: "2in",   h: "4in",   code: "16pt", qr: "30mm" },
  };
  const d = dims[size] ?? dims["label-4x6"];
  const html = items.map((item) =>
    `<div class="lpage">${CUT_HTML}${bayLabelBodyHtml(item)}</div>`,
  ).join("");
  openPrint(`Bay Labels — ${items.length} labels`, html, `${d.w} ${d.h} portrait`, `
    .lpage { position: relative; width: ${d.w}; height: ${d.h}; overflow: hidden;
      border: 0.6px dashed #ccc; display: flex; page-break-after: always; }
    .lpage:last-child { page-break-after: auto; }
    ${CUT_CSS}
    ${bayLabelCss(d.code, d.qr)}`);
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
  const html = buildSheets(items, 6, (item) =>
    item
      ? `<div class="cell">${zoneLabelHtml(item)}</div>`
      : `<div class="cell empty"></div>`,
  );
  openPrint(`Zone Labels — ${items.length} labels`, html, "A4 portrait", `
    .sheet { width: 210mm; height: 297mm; padding: 9mm 6mm; display: grid;
      grid-template-columns: repeat(2, 99mm); grid-template-rows: repeat(3, 93mm);
      page-break-after: always; }
    .sheet:last-child { page-break-after: auto; }
    .cell { width: 99mm; height: 93mm; padding: 6mm; overflow: hidden;
      border: 0.25mm dashed #d1d5db; display: flex; }
    .cell.empty { opacity: 0.15; }
    ${ZONE_CSS}`);
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

/** Miniaturised A4 sheet or single-label preview for bay codes */
function BaySheetPreview({ items, size }: { items: LabelSheetItem[]; size: BayLabelSize }) {
  const [page, setPage] = useState(0);

  if (size !== "a4-6up") {
    const item = items[0];
    if (!item) return null;
    const parts = locationLine(item);
    const isCompact = size === "label-2x4";
    return (
      <div
        className="relative mx-auto overflow-hidden rounded border border-dashed border-gray-400 bg-white text-black shadow-xs"
        style={{
          width: isCompact ? 160 : 220,
          aspectRatio: size === "label-4x4" ? "1/1" : isCompact ? "1/2" : "2/3",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        {/* Corner cut marks */}
        {(["tl", "tr", "bl", "br"] as const).map((p) => (
          <div key={p} className={`absolute h-3 w-3 border-gray-500 ${
            p === "tl" ? "top-0.5 left-0.5 border-t border-l" :
            p === "tr" ? "top-0.5 right-0.5 border-t border-r" :
            p === "bl" ? "bottom-0.5 left-0.5 border-b border-l" :
                         "bottom-0.5 right-0.5 border-b border-r"}`} />
        ))}
        {/* Teal left bar */}
        <div className="absolute top-0 left-0 h-full" style={{ width: 5, background: TEAL }} />
        <div className="flex h-full flex-col pl-4 pr-2 py-2 gap-1.5">
          <div className="flex flex-col gap-0.5">
            <span className="text-[9px] font-extrabold uppercase tracking-widest" style={{ color: TEAL }}>Bay Code</span>
            <span className="font-black leading-tight break-words" style={{ fontSize: isCompact ? 13 : 16 }}>{item.code}</span>
            {parts && <span className="font-semibold" style={{ fontSize: isCompact ? 9 : 10 }}>{parts}</span>}
            {item.subtitle && <span className="text-gray-500 uppercase tracking-wide" style={{ fontSize: 8 }}>{item.subtitle}</span>}
          </div>
          <div className="flex flex-1 items-center justify-center">
            <QRCodeSVG value={item.code} size={isCompact ? 70 : 100} level="M" />
          </div>
        </div>
      </div>
    );
  }

  // A4 sheet: 2-col × 3-row grid
  const perSheet = 6;
  const totalSheets = Math.max(1, Math.ceil(items.length / perSheet));
  const curPage = Math.min(page, totalSheets - 1);
  const cells = Array.from({ length: perSheet }, (_, i) => items[curPage * perSheet + i] ?? null);

  return (
    <div className="space-y-2">
      <div className="mx-auto overflow-hidden rounded border border-border bg-gray-100 shadow-xs"
        style={{ aspectRatio: "1/1.414", maxWidth: 340, fontFamily: "system-ui, sans-serif", padding: "2%" }}>
        <div className="grid h-full gap-[1.5%]"
          style={{ gridTemplateColumns: "1fr 1fr", gridTemplateRows: "1fr 1fr 1fr" }}>
          {cells.map((item, i) => item ? (
            <div key={i} className="relative overflow-hidden rounded-sm border border-dashed border-gray-400 bg-white">
              {/* Teal bar */}
              <div className="absolute top-0 left-0 h-full" style={{ width: 4, background: TEAL }} />
              <div className="flex h-full flex-col pl-3 pr-1 py-1 gap-0.5">
                <span className="text-[5.5px] font-extrabold uppercase tracking-widest" style={{ color: TEAL }}>Bay Code</span>
                <span className="text-[9px] font-black leading-tight break-words">{item.code}</span>
                {locationLine(item) && <span className="text-[6px] font-semibold">{locationLine(item)}</span>}
                {item.subtitle && <span className="text-[5px] text-gray-500 uppercase truncate">{item.subtitle}</span>}
                <div className="flex flex-1 items-center justify-center pt-0.5">
                  <QRCodeSVG value={item.code} size={28} level="L" />
                </div>
              </div>
            </div>
          ) : (
            <div key={i} className="rounded-sm border border-dotted border-gray-300 bg-gray-50 opacity-25" />
          ))}
        </div>
      </div>
      <PageNav page={curPage} total={totalSheets} onChange={setPage} />
    </div>
  );
}

/** Miniaturised A4 sheet preview for location/zone labels */
function LabelSheetPreview({ items, kind }: { items: LabelSheetItem[]; kind: LabelSheetKind }) {
  const [page, setPage] = useState(0);
  const perSheet = kind === "zone" ? 6 : 16;
  const cols = 2;
  const rows = kind === "zone" ? 3 : 8;
  const totalSheets = Math.max(1, Math.ceil(items.length / perSheet));
  const curPage = Math.min(page, totalSheets - 1);
  const cells = Array.from({ length: perSheet }, (_, i) => items[curPage * perSheet + i] ?? null);

  return (
    <div className="space-y-2">
      <div className="mx-auto overflow-hidden rounded border border-border bg-gray-100 shadow-xs"
        style={{ aspectRatio: "1/1.414", maxWidth: 340, fontFamily: "system-ui, sans-serif", padding: "2%" }}>
        <div className="grid h-full gap-[0.8%]"
          style={{ gridTemplateColumns: `repeat(${cols}, 1fr)`, gridTemplateRows: `repeat(${rows}, 1fr)` }}>
          {cells.map((item, i) => item ? (
            <div key={i} className="overflow-hidden rounded-sm border border-dashed border-gray-300 bg-white">
              {kind === "zone" ? (
                <div className="flex h-full flex-col p-1 gap-0.5">
                  <div className="h-0.5 w-full rounded-full" style={{ background: accentFor(item) }} />
                  <span className="text-[5px] font-extrabold uppercase tracking-wide" style={{ color: accentFor(item) }}>Zone</span>
                  <span className="text-[8px] font-black leading-tight break-words flex-1">{item.code}</span>
                  {item.title && <span className="text-[5.5px] font-semibold truncate">{item.title}</span>}
                  <div className="flex justify-center">
                    <QRCodeSVG value={item.code} size={22} level="L" />
                  </div>
                </div>
              ) : (
                <div className="flex h-full items-center gap-0.5 py-0.5 pr-0.5"
                  style={{ borderLeft: `2px solid ${accentFor(item)}`, paddingLeft: 2 }}>
                  <div className="flex flex-1 flex-col gap-0.5 min-w-0">
                    <span className="text-[7px] font-black leading-none break-words">{item.code}</span>
                    {locationLine(item) && <span className="text-[5px] text-gray-500 truncate">{locationLine(item)}</span>}
                  </div>
                  <QRCodeSVG value={item.code} size={16} level="L" />
                </div>
              )}
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

  const isSheet    = kind === "zone" || locSize === "a4-16up";
  const perSheet   = kind === "zone" ? 6 : 16;
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
              : " · 1 per page"}.
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
          <p className="text-xs text-muted-foreground">Avery 99×93 mm · 6 labels per A4 sheet</p>
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
}: {
  items: LabelSheetItem[];
  trigger: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [baySize, setBaySize] = useState<BayLabelSize>("label-4x6");

  const isSheet     = baySize === "a4-6up";
  const totalSheets = isSheet ? Math.max(1, Math.ceil(items.length / 6)) : items.length;

  function handlePrint() {
    if (items.length === 0) return;
    printBayLabels(items, baySize);
    setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Print Bay Location Codes</DialogTitle>
          <DialogDescription>
            {items.length} bay code{items.length !== 1 ? "s" : ""}
            {isSheet
              ? ` · ${totalSheets} A4 sheet${totalSheets !== 1 ? "s" : ""}`
              : ` · ${items.length} label${items.length !== 1 ? "s" : ""}`}.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <Label className="shrink-0 text-sm">Label size</Label>
            <Select value={baySize} onValueChange={(v) => setBaySize(v as BayLabelSize)}>
              <SelectTrigger className="flex-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                {BAY_LABEL_SIZES.map((s) => (
                  <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <p className="pl-1 text-xs text-muted-foreground">
            {BAY_LABEL_SIZES.find((s) => s.value === baySize)?.hint}
          </p>
        </div>

        {/* Label preview */}
        <BaySheetPreview items={items} size={baySize} />

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
