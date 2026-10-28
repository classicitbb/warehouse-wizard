import { describe, expect, it } from "vitest";

import {
  PALLET_BLOCK_HEIGHT_MM,
  PALLET_DECK_HEIGHT_MM,
  PALLET_STRINGER_SIZE_MM,
  buildPalletStackGeometry,
  describeStackConformance,
  describeStackFit,
  gridFor,
  project,
  resolvePalletStackMetrics,
  type PalletStackSpec,
} from "@/lib/pallet-geometry";

// Exact-value companions to pallet-geometry.test.ts. Those tests pin the
// behaviour in words; these pin the numbers, so an arithmetic slip in the
// projection, box layout, guides or bracket cannot pass unnoticed.

const SCALE = 0.3;
const BASE_SPEC: PalletStackSpec = { packagesPerLayer: 12, layersPerPallet: 7, packageHeightMm: 225, layerColumns: 4 };

function attr(points: Array<[number, number]>) {
  return points.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
}

/** The three visible faces of a box, built independently of the module. */
function faces(x: number, y: number, z: number, dx: number, dy: number, dz: number) {
  const p = (a: number, b: number, c: number) => project(a, b, c, SCALE);
  return {
    right: attr([p(x + dx, y, z), p(x + dx, y + dy, z), p(x + dx, y + dy, z + dz), p(x + dx, y, z + dz)]),
    left: attr([p(x, y + dy, z), p(x + dx, y + dy, z), p(x + dx, y + dy, z + dz), p(x, y + dy, z + dz)]),
    top: attr([p(x, y, z + dz), p(x + dx, y, z + dz), p(x + dx, y + dy, z + dz), p(x, y + dy, z + dz)]),
  };
}

function boxPoints(spec: PalletStackSpec, kind: string) {
  const quads = buildPalletStackGeometry(spec).quads.filter((q) => q.kind === kind);
  const boxes: Array<Record<string, string>> = [];
  for (let i = 0; i < quads.length; i += 3) {
    boxes.push(Object.fromEntries(quads.slice(i, i + 3).map((q) => [q.face, q.points])));
  }
  return boxes;
}

function allPoints(points: string) {
  return points.split(" ").map((pair) => pair.split(",").map(Number) as [number, number]);
}

describe("projection", () => {
  it("maps each axis to its exact isometric direction", () => {
    const cos30 = Math.cos(Math.PI / 6);
    expect(project(100, 0, 0, 1)).toEqual([100 * cos30, 50]);
    expect(project(0, 100, 0, 1)).toEqual([-100 * cos30, 50]);
    expect(project(0, 0, 10, 2)).toEqual([0, -20]);
    expect(project(10, 20, 30, 0.5)).toEqual([(10 - 20) * cos30 * 0.5, (10 + 20) * 0.5 * 0.5 - 30 * 0.5]);
  });
});

describe("grid inputs", () => {
  it("floors fractional counts and treats junk as a single cell", () => {
    expect(gridFor(12.9, 4.7)).toEqual({ cols: 4, rows: 3 });
    expect(gridFor(Number.NaN)).toEqual({ cols: 1, rows: 1 });
    expect(gridFor(0, 3)).toEqual({ cols: 1, rows: 1 });
    expect(gridFor(10, Number.POSITIVE_INFINITY)).toEqual({ cols: 3, rows: 4 });
    expect(gridFor(10, 0)).toEqual({ cols: 3, rows: 4 });
  });
});

describe("metrics, exactly", () => {
  it("reports every derived number for a standard build", () => {
    expect(resolvePalletStackMetrics({ ...BASE_SPEC, binClearanceMm: 2000 })).toEqual({
      packagesPerLayer: 12,
      layersPerPallet: 7,
      packagesPerPallet: 84,
      actualPackages: 84,
      fullLayers: 7,
      topCount: 0,
      cartonStackMm: 1575,
      stackHeightMm: 1720,
      usableHeightMm: 1924,
      headroomMm: 204,
      marginMm: 76,
      fit: "fits",
      maxLayersThatFit: 7,
      conformance: "standard",
    });
  });

  it("accepts numeric strings and floors fractional counts", () => {
    const metrics = resolvePalletStackMetrics({
      packagesPerLayer: "12.9" as unknown as number,
      layersPerPallet: "7" as unknown as number,
      packageHeightMm: "225" as unknown as number,
    });
    expect(metrics).toMatchObject({ packagesPerLayer: 12, layersPerPallet: 7, stackHeightMm: 1720 });
  });

  it("rejects infinite counts and heights", () => {
    const metrics = resolvePalletStackMetrics({
      packagesPerLayer: Number.POSITIVE_INFINITY,
      layersPerPallet: 7,
      packageHeightMm: Number.POSITIVE_INFINITY,
    });
    expect(metrics).toMatchObject({ packagesPerLayer: 0, packagesPerPallet: 0, stackHeightMm: 145, conformance: "unknown" });
  });

  it("honours a zero base, and falls back on a negative one", () => {
    expect(resolvePalletStackMetrics({ ...BASE_SPEC, palletBaseHeightMm: 0 }).stackHeightMm).toBe(1575);
    expect(resolvePalletStackMetrics({ ...BASE_SPEC, palletBaseHeightMm: -10 }).stackHeightMm).toBe(1720);
    expect(resolvePalletStackMetrics({ ...BASE_SPEC, palletBaseHeightMm: Number.NaN }).stackHeightMm).toBe(1720);
    expect(resolvePalletStackMetrics({ ...BASE_SPEC, slipSheetHeightMm: -5 }).stackHeightMm).toBe(1720);
  });

  it("rounds the carton stack and the stack height", () => {
    const metrics = resolvePalletStackMetrics({ ...BASE_SPEC, layersPerPallet: 3, packageHeightMm: 225.4 });
    expect(metrics.cartonStackMm).toBe(676);
    expect(metrics.stackHeightMm).toBe(821);
  });

  it("cleans up odd actual counts", () => {
    expect(resolvePalletStackMetrics({ ...BASE_SPEC, actualPackages: 10.7 })).toMatchObject({
      actualPackages: 10, fullLayers: 0, topCount: 10, conformance: "short",
    });
    expect(resolvePalletStackMetrics({ ...BASE_SPEC, actualPackages: -3 }).actualPackages).toBe(0);
    expect(resolvePalletStackMetrics({ ...BASE_SPEC, actualPackages: Number.NaN }).actualPackages).toBe(84);
    expect(resolvePalletStackMetrics({ ...BASE_SPEC, actualPackages: 0 }).actualPackages).toBe(0);
    expect(resolvePalletStackMetrics({ ...BASE_SPEC, actualPackages: 30 })).toMatchObject({ fullLayers: 2, topCount: 6 });
  });

  it("splits an overpack into full layers plus a top", () => {
    expect(resolvePalletStackMetrics({ ...BASE_SPEC, actualPackages: 87 })).toMatchObject({
      fullLayers: 7, topCount: 3, conformance: "overpack",
    });
  });

  it("puts the fit boundaries exactly at 0 and 100 mm of headroom", () => {
    const fitAt = (binClearanceMm: number) => resolvePalletStackMetrics({ ...BASE_SPEC, binClearanceMm });
    expect(fitAt(1896)).toMatchObject({ headroomMm: 100, fit: "fits" });
    expect(fitAt(1895)).toMatchObject({ headroomMm: 99, fit: "tight" });
    expect(fitAt(1796)).toMatchObject({ headroomMm: 0, fit: "tight" });
    expect(fitAt(1795)).toMatchObject({ headroomMm: -1, fit: "blocked", maxLayersThatFit: 6 });
  });

  it("includes the slip sheet when working out how many layers would fit", () => {
    // usable 1824; (1824 - 145) / (225 + 10) = 7.14
    expect(resolvePalletStackMetrics({ ...BASE_SPEC, slipSheetHeightMm: 10, binClearanceMm: 1900 }).maxLayersThatFit).toBe(7);
    // (1824 - 145) / (225 + 20) = 6.85
    expect(resolvePalletStackMetrics({ ...BASE_SPEC, slipSheetHeightMm: 20, binClearanceMm: 1900 }).maxLayersThatFit).toBe(6);
  });

  it("rounds the usable ceiling and never lets it go negative", () => {
    expect(resolvePalletStackMetrics({ ...BASE_SPEC, binClearanceMm: 1900.6 }).usableHeightMm).toBe(1825);
    expect(resolvePalletStackMetrics({ ...BASE_SPEC, binClearanceMm: 50 })).toMatchObject({
      usableHeightMm: 0, headroomMm: -1720, fit: "blocked", maxLayersThatFit: 0,
    });
  });

  it("leaves fit unchecked without a usable carton height or layer count", () => {
    expect(resolvePalletStackMetrics({ ...BASE_SPEC, packageHeightMm: 0, binClearanceMm: 2000 })).toMatchObject({
      fit: "unknown", maxLayersThatFit: null, usableHeightMm: 1924,
    });
    expect(resolvePalletStackMetrics({ ...BASE_SPEC, layersPerPallet: 0, binClearanceMm: 2000 })).toMatchObject({
      fit: "unknown", maxLayersThatFit: null,
    });
    expect(resolvePalletStackMetrics({ ...BASE_SPEC, binClearanceMm: 0 })).toMatchObject({
      usableHeightMm: null, headroomMm: null, fit: "unknown",
    });
  });
});

describe("box layout, exactly", () => {
  const TWO_UP: PalletStackSpec = { packagesPerLayer: 2, layersPerPallet: 1, packageHeightMm: 200, layerColumns: 2 };

  it("places each carton in its cell, inset by half the gap, on top of the deck", () => {
    expect(boxPoints(TWO_UP, "full")).toEqual([
      faces(4, 4, 145, 592, 992, 196),
      faces(604, 4, 145, 592, 992, 196),
    ]);
  });

  it("draws nine stringer blocks and a full-footprint deck", () => {
    const blk = PALLET_STRINGER_SIZE_MM;
    const expectedBlocks = [0, 525, 1050].flatMap((bx) =>
      [0, 425, 850].map((by) => faces(bx, by, 0, blk, blk, PALLET_BLOCK_HEIGHT_MM)),
    );
    const blocks = boxPoints(TWO_UP, "pallet-block");
    expect(blocks).toHaveLength(9);
    expect(blocks).toEqual(expect.arrayContaining(expectedBlocks));
    expect(boxPoints(TWO_UP, "pallet-deck")).toEqual([faces(0, 0, PALLET_BLOCK_HEIGHT_MM, 1200, 1000, PALLET_DECK_HEIGHT_MM)]);
  });

  it("paints stringer blocks back to front", () => {
    const blocks = boxPoints(TWO_UP, "pallet-block");
    expect(blocks[0]).toEqual(faces(0, 0, 0, 150, 150, 100));
    expect(blocks[8]).toEqual(faces(1050, 850, 0, 150, 150, 100));
  });

  it("paints far cartons before near ones within a layer", () => {
    const quads = buildPalletStackGeometry({ ...TWO_UP, packagesPerLayer: 4 }).quads.filter((q) => q.kind === "full");
    const firstTop = allPoints(quads.find((q) => q.face === "top")!.points);
    const lastTop = allPoints(quads.filter((q) => q.face === "top").at(-1)!.points);
    // The far corner of the first painted box sits higher on screen.
    expect(firstTop[0][1]).toBeLessThan(lastTop[0][1]);
    expect(quads.map((q) => q.face).slice(0, 3)).toEqual(["right", "left", "top"]);
  });

  it("stacks each layer one carton plus slip sheet above the last", () => {
    const boxes = boxPoints({ ...TWO_UP, packagesPerLayer: 1, layerColumns: 1, layersPerPallet: 2, slipSheetHeightMm: 6 }, "full");
    expect(boxes).toEqual([
      faces(4, 4, 145, 1192, 992, 196),
      faces(4, 4, 351, 1192, 992, 196),
    ]);
  });

  it("uses the given footprint and base height", () => {
    const boxes = boxPoints({ ...TWO_UP, footprintLengthMm: 800, footprintWidthMm: 600, palletBaseHeightMm: 120 }, "full");
    expect(boxes).toEqual([faces(4, 4, 120, 392, 592, 196), faces(404, 4, 120, 392, 592, 196)]);
  });

  it("turns odd layers under the brick pattern", () => {
    const spec: PalletStackSpec = { packagesPerLayer: 6, layersPerPallet: 2, packageHeightMm: 200, layerColumns: 3, layerPattern: "brick" };
    const boxes = boxPoints(spec, "full");
    // Layer 0: 3 columns x 2 rows. Layer 1: 2 columns x 3 rows.
    expect(boxes[0]).toEqual(faces(4, 4, 145, 392, 492, 196));
    expect(boxes.slice(6)).toContainEqual(faces(4, 4, 345, 592, 1000 / 3 - 8, 196));
  });

  it("stops filling a ragged last row once the layer is placed", () => {
    const spec: PalletStackSpec = { packagesPerLayer: 5, layersPerPallet: 2, packageHeightMm: 200, layerColumns: 3 };
    expect(boxPoints(spec, "full")).toHaveLength(10);
  });

  it("marks the boxes of a partial top layer as part, after the full layers", () => {
    // One row per layer, so paint order within a layer is placement order.
    const spec: PalletStackSpec = { packagesPerLayer: 4, layersPerPallet: 3, packageHeightMm: 200, layerColumns: 4, actualPackages: 6 };
    const kinds = buildPalletStackGeometry(spec).quads.filter((q) => q.face === "top").map((q) => q.kind).slice(10);
    expect(kinds).toEqual(["full", "full", "full", "full", "part", "part", "ghost", "ghost", "ghost", "ghost", "ghost", "ghost"]);
  });
});

describe("collapsed stacks, exactly", () => {
  const BIG: PalletStackSpec = { packagesPerLayer: 30, layersPerPallet: 25, packageHeightMm: 100, actualPackages: 307 };

  it("badges full slabs, warns on the part slab, and leaves ghosts unbadged", () => {
    const { quads, labels } = buildPalletStackGeometry(BIG);
    const slabTops = quads.filter((q) => q.face === "top" && ["slab", "part", "ghost"].includes(q.kind));
    expect(slabTops.map((q) => q.kind)).toEqual([
      ...Array(10).fill("slab"), "part", ...Array(14).fill("ghost"),
    ]);
    const badges = labels.filter((l) => l.key.startsWith("badge-"));
    expect(badges.map((b) => [b.text, b.tone])).toEqual([
      ...Array(10).fill(["x30", "primary"]), ["x7", "warning"],
    ]);
    expect(badges.every((b) => b.anchor === "middle" && b.size === 12)).toBe(true);
  });

  it("centres each badge on its slab's top face", () => {
    const { quads, labels } = buildPalletStackGeometry(BIG);
    const badge = labels.find((l) => l.key.startsWith("badge-"))!;
    const index = Number(badge.key.replace("badge-", ""));
    const top = allPoints(quads.find((q) => q.key === `q${index}-top`)!.points);
    expect(badge.x).toBeCloseTo((top[0][0] + top[2][0]) / 2, 1);
    expect(badge.y).toBeCloseTo((top[0][1] + top[2][1]) / 2 + 4, 1);
    expect(quads.find((q) => q.key === `q${index}-top`)!.points).toBe(faces(0, 0, 145, 1200, 1000, 100).top);
  });

  it("draws a whole-layer slab per layer, one carton height apart", () => {
    const tops = buildPalletStackGeometry(BIG).quads.filter((q) => q.face === "top" && q.kind !== "pallet-block" && q.kind !== "pallet-deck");
    expect(tops[1].points).toBe(faces(0, 0, 245, 1200, 1000, 100).top);
  });

  it("does not badge an exact-layer pallet's first empty layer", () => {
    const { labels } = buildPalletStackGeometry({ ...BIG, actualPackages: 300 });
    expect(labels.filter((l) => l.key.startsWith("badge-"))).toHaveLength(10);
  });
});

describe("guides, exactly", () => {
  it("draws the slot envelope centred on the pallet", () => {
    const [guide] = buildPalletStackGeometry(BASE_SPEC).guides;
    const p = (x: number, y: number) => project(x, y, 0, SCALE);
    expect(guide).toEqual({
      key: "space-allowance",
      kind: "space-allowance",
      points: attr([p(-25, -125), p(1225, -125), p(1225, 1125), p(-25, 1125)]),
      exceeded: false,
    });
  });

  it("flags an overhang on either axis", () => {
    const longer = buildPalletStackGeometry({ ...BASE_SPEC, footprintLengthMm: 1300 }).guides[0];
    const wider = buildPalletStackGeometry({ ...BASE_SPEC, footprintLengthMm: 1250, footprintWidthMm: 1300 }).guides[0];
    expect(longer.exceeded).toBe(true);
    expect(wider.exceeded).toBe(true);
  });

  it("still draws the envelope when only one axis differs", () => {
    // The slot defaults to 1250 x 1250.
    const lengthOnly = buildPalletStackGeometry({ ...BASE_SPEC, footprintLengthMm: 1200, footprintWidthMm: 1250 });
    const widthOnly = buildPalletStackGeometry({ ...BASE_SPEC, footprintLengthMm: 1250, footprintWidthMm: 1000 });
    expect(lengthOnly.guides.map((g) => g.key)).toEqual(["space-allowance"]);
    expect(widthOnly.guides.map((g) => g.key)).toEqual(["space-allowance"]);
  });

  it("draws both ceilings at their heights with a 70 mm overhang", () => {
    const { guides } = buildPalletStackGeometry({ ...BASE_SPEC, allowanceLengthMm: 1200, allowanceWidthMm: 1000, binClearanceMm: 1900 });
    const p = (x: number, y: number, z: number) => project(x, y, z, SCALE);
    const at = (z: number) => attr([p(-70, -70, z), p(1270, -70, z), p(1270, 1070, z), p(-70, 1070, z)]);
    expect(guides).toEqual([
      { key: "bin-ceiling", kind: "bin-ceiling", points: at(1900), exceeded: false },
      { key: "usable-ceiling", kind: "usable-ceiling", points: at(1824), exceeded: false },
    ]);
  });

  it("marks only the usable ceiling exceeded, and not when the stack meets it exactly", () => {
    const over = buildPalletStackGeometry({ ...BASE_SPEC, binClearanceMm: 1795 }).guides;
    expect(over.find((g) => g.kind === "bin-ceiling")!.exceeded).toBe(false);
    expect(over.find((g) => g.kind === "usable-ceiling")!.exceeded).toBe(true);
    const flush = buildPalletStackGeometry({ ...BASE_SPEC, binClearanceMm: 1796 }).guides;
    expect(flush.find((g) => g.kind === "usable-ceiling")!.exceeded).toBe(false);
  });
});

describe("bracket and viewBox, exactly", () => {
  function scaleOf(spec: PalletStackSpec) {
    return buildPalletStackGeometry(spec).rules[0].width / 1.1;
  }

  it("spans from the deck top to the top of the last layer, slip sheets included", () => {
    const spec = { ...BASE_SPEC, slipSheetHeightMm: 5 };
    const spine = buildPalletStackGeometry(spec).rules.find((r) => r.key === "bracket")!;
    expect(spine.y1).toBeCloseTo(project(1200, 0, 145 + 7 * 230, SCALE)[1], 6);
    expect(spine.y2).toBeCloseTo(project(1200, 0, 145, SCALE)[1], 6);
  });

  it("sizes the bracket at 1:1 for an ordinary stack", () => {
    // A small pallet in a matching slot paints under 300 units tall.
    const { rules, labels } = buildPalletStackGeometry({
      packagesPerLayer: 2, layersPerPallet: 1, packageHeightMm: 200,
      footprintLengthMm: 400, footprintWidthMm: 400, allowanceLengthMm: 400, allowanceWidthMm: 400,
    });
    const [spine, top, bottom] = rules;
    expect(spine.width).toBeCloseTo(1.1, 10);
    expect(top.x2 - top.x1).toBeCloseTo(14, 10);
    expect(top.x1).toBeCloseTo(spine.x1 - 7, 10);
    expect(bottom.x2).toBeCloseTo(spine.x1 + 7, 10);
    expect([top.y1, top.y2]).toEqual([spine.y1, spine.y1]);
    expect([bottom.y1, bottom.y2]).toEqual([spine.y2, spine.y2]);
    expect(rules.every((r) => r.tone === "primary")).toBe(true);
    const count = labels.find((l) => l.key === "layer-count")!;
    const caption = labels.find((l) => l.key === "layer-caption")!;
    const midY = (spine.y1 + spine.y2) / 2;
    expect(count).toMatchObject({ text: "1", anchor: "start", tone: "primary", size: 30 });
    expect(count.x).toBeCloseTo(spine.x1 + 12, 10);
    expect(count.y).toBeCloseTo(midY - 4, 10);
    expect(caption).toMatchObject({ anchor: "start", tone: "muted", size: 11 });
    expect(caption.x).toBeCloseTo(spine.x1 + 12, 10);
    expect(caption.y).toBeCloseTo(midY + 18, 10);
  });

  it("grows the bracket with tall stacks so it stays legible", () => {
    const tall: PalletStackSpec = { ...BASE_SPEC, layersPerPallet: 20, packageHeightMm: 300 };
    const scale = scaleOf(tall);
    expect(scale).toBeGreaterThan(1);
    const { rules, labels } = buildPalletStackGeometry(tall);
    const [spine, top] = rules;
    expect(top.x2 - top.x1).toBeCloseTo(14 * scale, 8);
    expect(labels.find((l) => l.key === "layer-count")!.size).toBeCloseTo(30 * scale, 8);
    expect(labels.find((l) => l.key === "layer-caption")!.size).toBeCloseTo(11 * scale, 8);
    expect(labels.find((l) => l.key === "layer-count")!.x).toBeCloseTo(spine.x1 + 12 * scale, 8);
    // The scale tracks the painted height at 300 units per step.
    const ys = buildPalletStackGeometry(tall).quads.flatMap((q) => allPoints(q.points).map(([, y]) => y));
    expect(scale).toBeCloseTo((Math.max(...ys) - Math.min(...ys)) / 300, 1);
  });

  it("sets the bracket 20 scaled units off the widest painted point", () => {
    const geometry = buildPalletStackGeometry(BASE_SPEC);
    const xs = [...geometry.quads, ...geometry.guides].flatMap((q) => allPoints(q.points).map(([x]) => x));
    expect(geometry.rules[0].x1).toBeCloseTo(Math.max(...xs) + 20 * scaleOf(BASE_SPEC), 1);
  });

  it("frames the painted scene plus the bracket label with 18 units of padding", () => {
    for (const spec of [BASE_SPEC, { ...BASE_SPEC, binClearanceMm: 2400 }, { ...BASE_SPEC, layersPerPallet: 20, packageHeightMm: 300 }]) {
      const geometry = buildPalletStackGeometry(spec);
      const points = [...geometry.quads, ...geometry.guides].flatMap((q) => allPoints(q.points));
      const scale = geometry.rules[0].width / 1.1;
      const minX = Math.min(...points.map(([x]) => x));
      const minY = Math.min(...points.map(([, y]) => y), geometry.rules[0].y1);
      const maxY = Math.max(...points.map(([, y]) => y));
      const maxX = geometry.rules[0].x1 + 74 * scale;
      const [vx, vy, vw, vh] = geometry.viewBox.split(" ").map(Number);
      expect(vx).toBeCloseTo(minX - 18, 0);
      expect(vy).toBeCloseTo(minY - 18, 0);
      expect(vw).toBeCloseTo(maxX - minX + 36, 0);
      expect(vh).toBeCloseTo(maxY - minY + 36, 0);
    }
  });

  it("keeps a viewBox that clears a ceiling drawn above the stack", () => {
    const geometry = buildPalletStackGeometry({ ...BASE_SPEC, binClearanceMm: 4000 });
    const ceilingY = Math.min(...allPoints(geometry.guides.find((g) => g.kind === "bin-ceiling")!.points).map(([, y]) => y));
    expect(Number(geometry.viewBox.split(" ")[1])).toBeCloseTo(ceilingY - 18, 0);
  });
});

describe("verdict copy, exactly", () => {
  const metricsAt = (spec: Partial<PalletStackSpec>) => resolvePalletStackMetrics({ ...BASE_SPEC, ...spec });

  it("words each fit verdict", () => {
    expect(describeStackFit(metricsAt({ binClearanceMm: 2000 }))).toBe("Fits — 204 mm clear of 1924 mm usable (76 mm margin).");
    expect(describeStackFit(metricsAt({ binClearanceMm: 1850 }))).toBe(
      "Tight — 54 mm clear of 1774 mm usable (76 mm margin). Best-fit slotting will prefer it.",
    );
    expect(describeStackFit(metricsAt({ binClearanceMm: 1795 }))).toBe(
      "Blocked — 1720 mm pallet against 1719 mm usable (76 mm margin), over by 1 mm. Drop to 6 layers, or slot a taller bay.",
    );
  });

  it("formats passing verdicts in the viewer's unit but keeps blocked ones in mm", () => {
    const inches = (mm: number) => `${(mm / 25.4).toFixed(1)} in`;
    expect(describeStackFit(metricsAt({ binClearanceMm: 2000 }), inches)).toBe("Fits — 8.0 in clear of 75.7 in usable (3.0 in margin).");
    expect(describeStackFit(metricsAt({ binClearanceMm: 1850 }), inches)).toMatch(/^Tight — 2\.1 in clear of 69\.8 in usable/);
    expect(describeStackFit(metricsAt({ binClearanceMm: 1795 }), inches)).toContain("1720 mm pallet against 1719 mm usable");
  });

  it("singularises a one-layer remedy and admits when nothing fits", () => {
    expect(describeStackFit(metricsAt({ binClearanceMm: 600 }))).toBe(
      "Blocked — 1720 mm pallet against 524 mm usable (76 mm margin), over by 1196 mm. Drop to 1 layer, or slot a taller bay.",
    );
    expect(describeStackFit(metricsAt({ binClearanceMm: 300 }))).toBe(
      "Blocked — 1720 mm pallet against 224 mm usable (76 mm margin), over by 1496 mm. No layer count fits this bin.",
    );
  });

  it("does not check fit without a clearance", () => {
    expect(describeStackFit(metricsAt({}))).toBe("No bin clearance recorded — fit not checked.");
  });

  it("words each conformance verdict", () => {
    expect(describeStackConformance(metricsAt({}))).toBe("Standard — 84 of 84, full pallet.");
    expect(describeStackConformance(metricsAt({ actualPackages: 87 }))).toBe(
      "Overpack — 3 over standard. Height and bin rules no longer hold.",
    );
    expect(describeStackConformance(metricsAt({ actualPackages: 15 }))).toBe(
      "Short — 15 of 84: 1 full layer plus 3 of 12 on top. Short 69.",
    );
    expect(describeStackConformance(metricsAt({ actualPackages: 24 }))).toBe("Short — 24 of 84: 2 full layers. Short 60.");
    expect(describeStackConformance(metricsAt({ packagesPerLayer: 0 }))).toBe("No pack standard set.");
  });
});
