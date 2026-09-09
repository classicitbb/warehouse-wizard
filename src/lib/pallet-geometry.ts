// pallet-geometry.ts — isometric pallet-stack geometry and build verdicts.
//
// Pure arithmetic: no React, no DOM, no Supabase. The renderer in
// `src/components/pallet-stack-preview.tsx` maps the output straight to
// `<polygon>` elements and does no maths of its own, so every edge case that
// matters here — the partial top layer, the brick swap, the depth sort, the
// large-stack collapse — is assertable as a number.
//
// Heights and lengths are integer millimetres throughout, matching
// `src/lib/measure.ts` and the mm columns on `product_packaging_profiles`.

import {
  DEFAULT_PALLET_BASE_HEIGHT_MM,
  resolveClearanceMarginMm,
} from "@/lib/measure";

export type LayerPattern = "block" | "brick" | "pinwheel" | "column" | "custom";

const COS30 = Math.cos(Math.PI / 6);
const SIN30 = 0.5;

/** The pallet itself. Slightly smaller than the slot it stands in. */
export const PALLET_FOOTPRINT_LENGTH_MM = 1200;
export const PALLET_FOOTPRINT_WIDTH_MM = 1000;
/** The slot envelope a pallet has to live inside. Warehouse-configurable. */
export const PALLET_SPACE_ALLOWANCE_LENGTH_MM = 1250;
export const PALLET_SPACE_ALLOWANCE_WIDTH_MM = 1250;

export const PALLET_BLOCK_HEIGHT_MM = 100;
export const PALLET_DECK_HEIGHT_MM = 45;
export const PALLET_STRINGER_SIZE_MM = 150;
export const BOX_GAP_MM = 8;

/**
 * Past this many cartons each layer collapses to one extruded slab with a
 * count badge. A 20x30 profile stays legible and stays fast on the same cheap
 * Android scanners as the rest of the floor UI.
 */
export const MAX_RENDERED_BOXES = 600;

/** Headroom below this reads as "tight" rather than "fits". */
export const TIGHT_HEADROOM_MM = 100;

const VIEWBOX_PADDING = 18;
const SCALE = 0.3;

export interface PalletStackSpec {
  packagesPerLayer: number | null | undefined;
  layersPerPallet: number | null | undefined;
  packageHeightMm: number | null | undefined;
  layerColumns?: number | null;
  layerPattern?: LayerPattern | null;
  /** Cartons actually on the pallet. Defaults to a full standard build. */
  actualPackages?: number | null;
  footprintLengthMm?: number | null;
  footprintWidthMm?: number | null;
  /** Slot envelope, drawn as a boundary when it differs from the footprint. */
  allowanceLengthMm?: number | null;
  allowanceWidthMm?: number | null;
  palletBaseHeightMm?: number | null;
  slipSheetHeightMm?: number | null;
  binClearanceMm?: number | null;
  clearanceMarginMm?: number | null;
}

export type QuadKind = "pallet-block" | "pallet-deck" | "full" | "part" | "ghost" | "slab";
export type QuadFace = "top" | "left" | "right";
export type StackFit = "fits" | "tight" | "blocked" | "unknown";
export type StackConformance = "standard" | "overpack" | "short" | "unknown";

export interface StackQuad {
  key: string;
  points: string;
  kind: QuadKind;
  face: QuadFace;
}

export interface StackGuide {
  key: string;
  kind: "bin-ceiling" | "usable-ceiling" | "space-allowance";
  points: string;
  exceeded: boolean;
}

export interface StackLabel {
  key: string;
  x: number;
  y: number;
  text: string;
  anchor: "start" | "middle" | "end";
  tone: "muted" | "primary" | "warning" | "destructive";
  size: number;
}

/** Straight rules: the layer-count dimension bracket and its ticks. */
export interface StackRule {
  key: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  tone: "muted" | "primary";
  width: number;
}

export interface PalletStackMetrics {
  packagesPerLayer: number;
  layersPerPallet: number;
  packagesPerPallet: number;
  actualPackages: number;
  fullLayers: number;
  topCount: number;
  cartonStackMm: number;
  stackHeightMm: number;
  usableHeightMm: number | null;
  headroomMm: number | null;
  marginMm: number;
  fit: StackFit;
  /** Largest layer count that would clear the usable ceiling. */
  maxLayersThatFit: number | null;
  conformance: StackConformance;
}

export interface PalletStackGeometry {
  /** Already depth-sorted: paint in array order. */
  quads: StackQuad[];
  guides: StackGuide[];
  labels: StackLabel[];
  rules: StackRule[];
  viewBox: string;
  collapsed: boolean;
  metrics: PalletStackMetrics;
}

// ── input hygiene ────────────────────────────────────────────────────────────

/** A count only counts when it is a real, positive integer. */
function positiveInt(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.floor(parsed);
}

function positiveNumber(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function nonNegative(value: unknown, fallback: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

// ── projection ───────────────────────────────────────────────────────────────

/** Isometric projection. `s` scales millimetres into user units. */
export function project(x: number, y: number, z: number, s: number): [number, number] {
  return [(x - y) * COS30 * s, (x + y) * SIN30 * s - z * s];
}

/**
 * The near-square grid a layer falls into. `columns` is a preference, not a
 * promise: it is clamped into [1, perLayer] so a slider can never produce a
 * grid that cannot hold the layer.
 */
export function gridFor(perLayer: number, columns?: number | null): { cols: number; rows: number } {
  const per = positiveInt(perLayer) ?? 1;
  const preferred = positiveInt(columns) ?? Math.max(1, Math.round(Math.sqrt(per)));
  const cols = Math.max(1, Math.min(preferred, per));
  return { cols, rows: Math.ceil(per / cols) };
}

/** The three faces of an axis-aligned box that are visible from this angle. */
function boxFaces(
  x: number, y: number, z: number,
  dx: number, dy: number, dz: number,
  s: number,
): Record<QuadFace, Array<[number, number]>> {
  const p = (a: number, b: number, c: number) => project(a, b, c, s);
  return {
    right: [p(x + dx, y, z), p(x + dx, y + dy, z), p(x + dx, y + dy, z + dz), p(x + dx, y, z + dz)],
    left: [p(x, y + dy, z), p(x + dx, y + dy, z), p(x + dx, y + dy, z + dz), p(x, y + dy, z + dz)],
    top: [p(x, y, z + dz), p(x + dx, y, z + dz), p(x + dx, y + dy, z + dz), p(x, y + dy, z + dz)],
  };
}

function pointsAttr(points: Array<[number, number]>): string {
  return points.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
}

// ── metrics ──────────────────────────────────────────────────────────────────

/**
 * Everything numeric about a build. Safe on garbage input: unusable numbers
 * yield a zeroed result with `fit: "unknown"` rather than NaN, because these
 * values reach a hard block and an operator-facing message.
 */
export function resolvePalletStackMetrics(spec: PalletStackSpec): PalletStackMetrics {
  const perLayer = positiveInt(spec.packagesPerLayer) ?? 0;
  const layers = positiveInt(spec.layersPerPallet) ?? 0;
  const packageHeight = positiveNumber(spec.packageHeightMm) ?? 0;
  const base = nonNegative(spec.palletBaseHeightMm, DEFAULT_PALLET_BASE_HEIGHT_MM);
  const slipSheet = nonNegative(spec.slipSheetHeightMm, 0);
  const marginMm = resolveClearanceMarginMm(spec.clearanceMarginMm);

  const packagesPerPallet = perLayer * layers;
  const rawActual = Number(spec.actualPackages);
  const actualPackages =
    spec.actualPackages === null || spec.actualPackages === undefined || !Number.isFinite(rawActual)
      ? packagesPerPallet
      : Math.max(0, Math.floor(rawActual));

  const cartonStackMm = layers * (packageHeight + slipSheet);
  const stackHeightMm = Math.round(base + cartonStackMm);

  const binClearance = positiveNumber(spec.binClearanceMm);
  const usableHeightMm = binClearance === null ? null : Math.max(0, Math.round(binClearance - marginMm));
  const headroomMm = usableHeightMm === null ? null : usableHeightMm - stackHeightMm;

  let fit: StackFit = "unknown";
  let maxLayersThatFit: number | null = null;
  if (usableHeightMm !== null && packageHeight > 0 && layers > 0) {
    fit = headroomMm! < 0 ? "blocked" : headroomMm! < TIGHT_HEADROOM_MM ? "tight" : "fits";
    maxLayersThatFit = Math.max(0, Math.floor((usableHeightMm - base) / (packageHeight + slipSheet)));
  }

  let conformance: StackConformance = "unknown";
  if (packagesPerPallet > 0) {
    conformance =
      actualPackages === packagesPerPallet ? "standard"
        : actualPackages > packagesPerPallet ? "overpack"
          : "short";
  }

  const fullLayers = perLayer > 0 ? Math.floor(actualPackages / perLayer) : 0;
  const topCount = perLayer > 0 ? actualPackages - fullLayers * perLayer : 0;

  return {
    packagesPerLayer: perLayer,
    layersPerPallet: layers,
    packagesPerPallet,
    actualPackages,
    fullLayers,
    topCount,
    cartonStackMm: Math.round(cartonStackMm),
    stackHeightMm,
    usableHeightMm,
    headroomMm,
    marginMm,
    fit,
    maxLayersThatFit,
    conformance,
  };
}

// ── geometry ─────────────────────────────────────────────────────────────────

interface StackItem {
  /** 0 = pallet, 1 = cargo. Kept separate from z: see the sort comment below. */
  group: 0 | 1;
  z: number;
  near: number;
  x: number;
  y: number;
  dx: number;
  dy: number;
  dz: number;
  kind: QuadKind;
  badge?: number;
}

/**
 * Builds the full painted scene for one pallet build.
 *
 * Returns `quads` already sorted, so the caller paints in array order. The key
 * is `(group, z, near)` rather than a single `x + y + z`: the deck slab spans
 * the whole footprint while the cartons standing on it do not, so one combined
 * key sorts the deck after some of its own cargo and paints over it.
 */
export function buildPalletStackGeometry(spec: PalletStackSpec): PalletStackGeometry {
  const metrics = resolvePalletStackMetrics(spec);
  const perLayer = metrics.packagesPerLayer;
  const layers = metrics.layersPerPallet;
  const packageHeight = positiveNumber(spec.packageHeightMm) ?? 0;

  const empty: PalletStackGeometry = {
    quads: [], guides: [], labels: [], rules: [], viewBox: "0 0 100 100", collapsed: false, metrics,
  };
  // No usable build: draw nothing rather than a pallet with NaN corners.
  if (perLayer <= 0 || layers <= 0 || packageHeight <= 0) return empty;

  const footL = positiveNumber(spec.footprintLengthMm) ?? PALLET_FOOTPRINT_LENGTH_MM;
  const footW = positiveNumber(spec.footprintWidthMm) ?? PALLET_FOOTPRINT_WIDTH_MM;
  const allowL = positiveNumber(spec.allowanceLengthMm) ?? PALLET_SPACE_ALLOWANCE_LENGTH_MM;
  const allowW = positiveNumber(spec.allowanceWidthMm) ?? PALLET_SPACE_ALLOWANCE_WIDTH_MM;
  const base = nonNegative(spec.palletBaseHeightMm, DEFAULT_PALLET_BASE_HEIGHT_MM);
  const slipSheet = nonNegative(spec.slipSheetHeightMm, 0);
  const pattern = spec.layerPattern ?? "block";
  const collapsed = metrics.packagesPerPallet > MAX_RENDERED_BOXES;

  const items: StackItem[] = [];

  // Pallet: a 3x3 grid of stringer blocks carrying a full-footprint deck.
  const blk = PALLET_STRINGER_SIZE_MM;
  const blockXs = [0, (footL - blk) / 2, footL - blk];
  const blockYs = [0, (footW - blk) / 2, footW - blk];
  for (const bx of blockXs) {
    for (const by of blockYs) {
      items.push({
        group: 0, z: 0, near: bx + by + blk,
        x: bx, y: by, dx: blk, dy: blk, dz: PALLET_BLOCK_HEIGHT_MM,
        kind: "pallet-block",
      });
    }
  }
  items.push({
    group: 0, z: PALLET_BLOCK_HEIGHT_MM, near: footL / 2 + footW / 2,
    x: 0, y: 0, dx: footL, dy: footW, dz: PALLET_DECK_HEIGHT_MM,
    kind: "pallet-deck",
  });

  const { fullLayers, topCount, actualPackages } = metrics;
  const layerPitch = packageHeight + slipSheet;
  const baseGrid = gridFor(perLayer, spec.layerColumns);

  for (let k = 0; k < layers; k += 1) {
    let { cols, rows } = baseGrid;
    // Brick: alternate layers turn 90 degrees to interlock the stack.
    if (pattern === "brick" && k % 2 === 1) {
      cols = baseGrid.rows;
      rows = baseGrid.cols;
    }
    const z = base + k * layerPitch;

    if (collapsed) {
      const kind: QuadKind = k < fullLayers ? "slab" : k === fullLayers && topCount > 0 ? "part" : "ghost";
      items.push({
        group: 1, z, near: footL / 2 + footW / 2,
        x: 0, y: 0, dx: footL, dy: footW, dz: packageHeight,
        kind,
        badge: k < fullLayers ? perLayer : k === fullLayers ? topCount : 0,
      });
      continue;
    }

    const cellW = footL / cols;
    const cellD = footW / rows;
    let placed = 0;
    for (let r = 0; r < rows && placed < perLayer; r += 1) {
      for (let c = 0; c < cols && placed < perLayer; c += 1) {
        const index = k * perLayer + placed;
        const kind: QuadKind =
          index < actualPackages ? (k < fullLayers ? "full" : "part") : "ghost";
        const x = c * cellW + BOX_GAP_MM / 2;
        const y = r * cellD + BOX_GAP_MM / 2;
        items.push({
          group: 1, z,
          near: x + (cellW - BOX_GAP_MM) / 2 + y + (cellD - BOX_GAP_MM) / 2,
          x, y,
          dx: cellW - BOX_GAP_MM,
          dy: cellD - BOX_GAP_MM,
          dz: packageHeight - BOX_GAP_MM / 2,
          kind,
        });
        placed += 1;
      }
    }
  }

  items.sort((a, b) => {
    if (a.group !== b.group) return a.group - b.group;
    if (a.z !== b.z) return a.z - b.z;
    return a.near - b.near;
  });

  const quads: StackQuad[] = [];
  const guides: StackGuide[] = [];
  const labels: StackLabel[] = [];
  const rules: StackRule[] = [];
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;

  const track = (points: Array<[number, number]>) => {
    for (const [x, y] of points) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  };

  items.forEach((item, index) => {
    const faces = boxFaces(item.x, item.y, item.z, item.dx, item.dy, item.dz, SCALE);
    // Far to near within one box: right, then left, then top.
    (["right", "left", "top"] as QuadFace[]).forEach((face) => {
      track(faces[face]);
      quads.push({ key: `q${index}-${face}`, points: pointsAttr(faces[face]), kind: item.kind, face });
    });
    if (item.badge && item.badge > 0) {
      const top = faces.top;
      labels.push({
        key: `badge-${index}`,
        x: (top[0][0] + top[2][0]) / 2,
        y: (top[0][1] + top[2][1]) / 2 + 4,
        text: `x${item.badge}`,
        anchor: "middle",
        tone: item.kind === "part" ? "warning" : "primary",
        size: 12,
      });
    }
  });

  const scale = Math.max(1, (maxY - minY) / 300);

  // Slot envelope on the floor plane. Only drawn when it differs from the
  // pallet, so the normal case is not cluttered by a boundary that adds nothing.
  if (Math.round(allowL) !== Math.round(footL) || Math.round(allowW) !== Math.round(footW)) {
    const offX = (allowL - footL) / 2;
    const offY = (allowW - footW) / 2;
    const quad: Array<[number, number]> = [
      project(-offX, -offY, 0, SCALE),
      project(footL + offX, -offY, 0, SCALE),
      project(footL + offX, footW + offY, 0, SCALE),
      project(-offX, footW + offY, 0, SCALE),
    ];
    track(quad);
    guides.push({
      key: "space-allowance",
      kind: "space-allowance",
      points: pointsAttr(quad),
      exceeded: footL > allowL || footW > allowW,
    });
  }

  // Bin ceiling and the usable ceiling below it. The gap between them is the
  // approach margin — the thing that decides a hard block, so it is drawn.
  const { usableHeightMm, stackHeightMm } = metrics;
  const binClearance = positiveNumber(spec.binClearanceMm);
  if (binClearance !== null && usableHeightMm !== null) {
    const pad = 70;
    const ceilings: Array<[number, StackGuide["kind"]]> = [
      [binClearance, "bin-ceiling"],
      [usableHeightMm, "usable-ceiling"],
    ];
    for (const [zc, kind] of ceilings) {
      const quad: Array<[number, number]> = [
        project(-pad, -pad, zc, SCALE),
        project(footL + pad, -pad, zc, SCALE),
        project(footL + pad, footW + pad, zc, SCALE),
        project(-pad, footW + pad, zc, SCALE),
      ];
      track(quad);
      guides.push({
        key: kind,
        kind,
        points: pointsAttr(quad),
        exceeded: kind === "usable-ceiling" && stackHeightMm > usableHeightMm,
      });
    }
  }

  // Layer-count dimension bracket off the right-hand corner of the stack:
  // a vertical rule spanning the cargo, capped with a tick at each end.
  const bracketX = maxX + 20 * scale;
  const topY = project(footL, 0, base + layers * layerPitch, SCALE)[1];
  const botY = project(footL, 0, base, SCALE)[1];
  const tick = 7 * scale;
  const ruleWidth = 1.1 * scale;
  rules.push(
    { key: "bracket", x1: bracketX, y1: topY, x2: bracketX, y2: botY, tone: "primary", width: ruleWidth },
    { key: "bracket-top", x1: bracketX - tick, y1: topY, x2: bracketX + tick, y2: topY, tone: "primary", width: ruleWidth },
    { key: "bracket-bottom", x1: bracketX - tick, y1: botY, x2: bracketX + tick, y2: botY, tone: "primary", width: ruleWidth },
  );
  const midY = (topY + botY) / 2;
  labels.push({
    key: "layer-count",
    x: bracketX + 12 * scale,
    y: midY - 4 * scale,
    text: String(layers),
    anchor: "start",
    tone: "primary",
    size: 30 * scale,
  });
  labels.push({
    key: "layer-caption",
    x: bracketX + 12 * scale,
    y: midY + 18 * scale,
    text: layers === 1 ? "LAYER" : "LAYERS",
    anchor: "start",
    tone: "muted",
    size: 11 * scale,
  });
  maxX = bracketX + 74 * scale;
  if (topY < minY) minY = topY;

  const viewBox = [
    (minX - VIEWBOX_PADDING).toFixed(1),
    (minY - VIEWBOX_PADDING).toFixed(1),
    (maxX - minX + VIEWBOX_PADDING * 2).toFixed(1),
    (maxY - minY + VIEWBOX_PADDING * 2).toFixed(1),
  ].join(" ");

  return { quads, guides, labels, rules, viewBox, collapsed, metrics };
}

// ── verdict copy ─────────────────────────────────────────────────────────────

/**
 * The fit verdict in words. A blocked verdict always carries the remedy, and
 * the remedy is a number — that is the difference between a rule and an
 * obstruction. Millimetres are quoted raw, deliberately: a quarter-inch
 * display cannot show a 6 mm difference, and an operator who cannot see why
 * they are blocked will work around it.
 */
export function describeStackFit(
  metrics: PalletStackMetrics,
  /**
   * Renders a length in the viewer's chosen unit. Applies to the passing
   * verdicts only — a blocked message always quotes raw millimetres, whatever
   * the preference, because a quarter-inch display cannot show a 6 mm
   * difference and an operator who cannot see why they are blocked will work
   * around it.
   */
  formatLengthMm?: (mm: number) => string,
): string {
  const { fit, stackHeightMm, usableHeightMm, headroomMm, marginMm, maxLayersThatFit } = metrics;
  if (fit === "unknown" || usableHeightMm === null || headroomMm === null) {
    return "No bin clearance recorded — fit not checked.";
  }
  if (fit === "blocked") {
    const remedy = maxLayersThatFit !== null && maxLayersThatFit > 0
      ? ` Drop to ${maxLayersThatFit} layer${maxLayersThatFit === 1 ? "" : "s"}, or slot a taller bay.`
      : " No layer count fits this bin.";
    return (
      `Blocked — ${stackHeightMm} mm pallet against ${usableHeightMm} mm usable ` +
      `(${marginMm} mm margin), over by ${Math.abs(headroomMm)} mm.${remedy}`
    );
  }
  const render = formatLengthMm ?? ((mm: number) => `${mm} mm`);
  const ceiling = `${render(usableHeightMm)} usable (${render(marginMm)} margin)`;
  if (fit === "tight") {
    return `Tight — ${render(headroomMm)} clear of ${ceiling}. Best-fit slotting will prefer it.`;
  }
  return `Fits — ${render(headroomMm)} clear of ${ceiling}.`;
}

/** The conformance verdict in words: is this pallet the standard build? */
export function describeStackConformance(metrics: PalletStackMetrics): string {
  const { conformance, actualPackages, packagesPerPallet, fullLayers, topCount, packagesPerLayer } = metrics;
  if (conformance === "unknown") return "No pack standard set.";
  if (conformance === "standard") {
    return `Standard — ${packagesPerPallet} of ${packagesPerPallet}, full pallet.`;
  }
  if (conformance === "overpack") {
    return `Overpack — ${actualPackages - packagesPerPallet} over standard. Height and bin rules no longer hold.`;
  }
  const top = topCount > 0 ? ` plus ${topCount} of ${packagesPerLayer} on top` : "";
  return `Short — ${actualPackages} of ${packagesPerPallet}: ${fullLayers} full layer${fullLayers === 1 ? "" : "s"}${top}. Short ${packagesPerPallet - actualPackages}.`;
}
