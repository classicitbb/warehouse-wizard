import { describe, expect, it } from "vitest";

import {
  BOX_GAP_MM,
  MAX_RENDERED_BOXES,
  PALLET_FOOTPRINT_LENGTH_MM,
  PALLET_FOOTPRINT_WIDTH_MM,
  buildPalletStackGeometry,
  describeStackConformance,
  describeStackFit,
  gridFor,
  project,
  resolvePalletStackMetrics,
  type PalletStackSpec,
} from "@/lib/pallet-geometry";
import { resolveStandardHeightMm } from "@/lib/measure";

/** The running example throughout: twelve cases per layer, seven layers. */
const BASE_SPEC: PalletStackSpec = {
  packagesPerLayer: 12,
  layersPerPallet: 7,
  packageHeightMm: 225,
  layerColumns: 4,
};

function countKinds(spec: PalletStackSpec) {
  const { quads } = buildPalletStackGeometry(spec);
  const boxes = new Map<string, Set<string>>();
  for (const quad of quads) {
    if (!boxes.has(quad.kind)) boxes.set(quad.kind, new Set());
    // Three faces per box share a quad key prefix.
    boxes.get(quad.kind)!.add(quad.key.split("-")[0]);
  }
  return {
    full: boxes.get("full")?.size ?? 0,
    part: boxes.get("part")?.size ?? 0,
    ghost: boxes.get("ghost")?.size ?? 0,
    slab: boxes.get("slab")?.size ?? 0,
  };
}

describe("projection and grid", () => {
  it("projects the origin to the origin and keeps z strictly vertical", () => {
    expect(project(0, 0, 0, 1)).toEqual([0, 0]);
    const [x, y] = project(0, 0, 100, 1);
    expect(x).toBe(0);
    expect(y).toBe(-100);
  });

  it("mirrors x and y across the vertical axis", () => {
    const [ax] = project(100, 0, 0, 1);
    const [bx] = project(0, 100, 0, 1);
    expect(ax).toBeCloseTo(-bx, 10);
  });

  it("derives a near-square grid when no column preference is given", () => {
    expect(gridFor(12, null)).toEqual({ cols: 3, rows: 4 });
    expect(gridFor(16, null)).toEqual({ cols: 4, rows: 4 });
  });

  it("honours a column preference", () => {
    expect(gridFor(12, 4)).toEqual({ cols: 4, rows: 3 });
    expect(gridFor(12, 6)).toEqual({ cols: 6, rows: 2 });
  });

  it("clamps a column preference into a grid that can hold the layer", () => {
    // A slider must never produce a grid too small for the layer.
    expect(gridFor(12, 0)).toEqual({ cols: 3, rows: 4 });
    expect(gridFor(12, -5)).toEqual({ cols: 3, rows: 4 });
    expect(gridFor(12, 99)).toEqual({ cols: 12, rows: 1 });
  });

  it("rounds a partial grid up so every case has a cell", () => {
    expect(gridFor(7, 3)).toEqual({ cols: 3, rows: 3 });
  });
});

describe("box counts by kind", () => {
  it("draws every case as full on a complete standard pallet", () => {
    expect(countKinds({ ...BASE_SPEC, actualPackages: 84 })).toMatchObject({
      full: 84, part: 0, ghost: 0,
    });
  });

  it("defaults a missing actual quantity to a full standard build", () => {
    expect(countKinds(BASE_SPEC)).toMatchObject({ full: 84, part: 0, ghost: 0 });
  });

  it("ghosts the missing cases when whole layers are short", () => {
    // 60 of 84 is exactly five full layers, so nothing is a part layer.
    expect(countKinds({ ...BASE_SPEC, actualPackages: 60 })).toMatchObject({
      full: 60, part: 0, ghost: 24,
    });
  });

  it("splits a partial top layer into part and ghost", () => {
    // 63 = five full layers of 12, plus 3 of 12 on top, 21 missing.
    expect(countKinds({ ...BASE_SPEC, actualPackages: 63 })).toMatchObject({
      full: 60, part: 3, ghost: 21,
    });
  });

  it("draws an empty pallet as all ghost", () => {
    expect(countKinds({ ...BASE_SPEC, actualPackages: 0 })).toMatchObject({
      full: 0, part: 0, ghost: 84,
    });
  });
});

describe("layer pattern", () => {
  function layerCellWidths(spec: PalletStackSpec): number[] {
    // The first box of each layer reveals that layer's cell width.
    const { quads } = buildPalletStackGeometry(spec);
    const tops = quads.filter((q) => q.face === "top" && q.kind !== "pallet-deck" && q.kind !== "pallet-block");
    return tops.map((q) => Number(q.points.split(" ")[0].split(",")[0]));
  }

  it("keeps every layer identical under the block pattern", () => {
    const spec = { ...BASE_SPEC, layerPattern: "block" as const, layersPerPallet: 2 };
    const widths = layerCellWidths(spec);
    const firstLayer = widths.slice(0, 12);
    const secondLayer = widths.slice(12, 24);
    expect(secondLayer).toEqual(firstLayer);
  });

  it("swaps rows and columns on odd layers under the brick pattern", () => {
    const spec = { ...BASE_SPEC, layerPattern: "brick" as const, layersPerPallet: 2 };
    const widths = layerCellWidths(spec);
    expect(widths.slice(12, 24)).not.toEqual(widths.slice(0, 12));
  });

  it("leaves the box count unchanged whichever pattern is used", () => {
    const block = countKinds({ ...BASE_SPEC, layerPattern: "block" });
    const brick = countKinds({ ...BASE_SPEC, layerPattern: "brick" });
    expect(brick).toEqual(block);
  });
});

describe("depth sort", () => {
  it("paints the whole pallet before any cargo", () => {
    // A single (x + y + z) key would sort the full-footprint deck after some of
    // the cartons standing on it, and the deck would paint over them.
    const { quads } = buildPalletStackGeometry(BASE_SPEC);
    const lastPallet = quads.reduce(
      (acc, q, i) => (q.kind === "pallet-deck" || q.kind === "pallet-block" ? i : acc), -1,
    );
    const firstCargo = quads.findIndex((q) => q.kind === "full" || q.kind === "part" || q.kind === "ghost");
    expect(lastPallet).toBeGreaterThanOrEqual(0);
    expect(firstCargo).toBeGreaterThan(lastPallet);
  });

  it("paints the deck after the stringer blocks it rests on", () => {
    const { quads } = buildPalletStackGeometry(BASE_SPEC);
    const lastBlock = quads.reduce((acc, q, i) => (q.kind === "pallet-block" ? i : acc), -1);
    const firstDeck = quads.findIndex((q) => q.kind === "pallet-deck");
    expect(firstDeck).toBeGreaterThan(lastBlock);
  });

  it("paints lower layers before higher ones", () => {
    // One case per layer, so each layer contributes exactly one box and the
    // paint order can be compared without also varying the grid cell.
    const { quads } = buildPalletStackGeometry({
      ...BASE_SPEC, packagesPerLayer: 1, layerColumns: 1, layersPerPallet: 3,
    });
    const cargoTops = quads
      .filter((q) => q.face === "top" && q.kind === "full")
      .map((q) => Number(q.points.split(" ")[0].split(",")[1]));
    expect(cargoTops).toHaveLength(3);
    // Screen y decreases as the stack rises, so each layer paints above the last.
    expect(cargoTops[1]).toBeLessThan(cargoTops[0]);
    expect(cargoTops[2]).toBeLessThan(cargoTops[1]);
  });
});

describe("large stacks collapse", () => {
  it("keeps individual boxes below the threshold", () => {
    const geometry = buildPalletStackGeometry({ ...BASE_SPEC, packagesPerLayer: 20, layersPerPallet: 20 });
    expect(20 * 20).toBeLessThan(MAX_RENDERED_BOXES);
    expect(geometry.collapsed).toBe(false);
  });

  it("collapses each layer to one badged slab above the threshold", () => {
    const layers = 25;
    const geometry = buildPalletStackGeometry({
      ...BASE_SPEC, packagesPerLayer: 30, layersPerPallet: layers,
    });
    expect(30 * layers).toBeGreaterThan(MAX_RENDERED_BOXES);
    expect(geometry.collapsed).toBe(true);
    // One slab per layer, three faces each, rather than 750 boxes.
    expect(countKinds({ ...BASE_SPEC, packagesPerLayer: 30, layersPerPallet: layers }).slab).toBe(layers);
    expect(geometry.labels.filter((l) => l.key.startsWith("badge-"))).toHaveLength(layers);
  });
});

describe("viewBox", () => {
  it("bounds every painted point", () => {
    const geometry = buildPalletStackGeometry({ ...BASE_SPEC, binClearanceMm: 2000 });
    const [vx, vy, vw, vh] = geometry.viewBox.split(" ").map(Number);
    for (const quad of [...geometry.quads, ...geometry.guides]) {
      for (const pair of quad.points.split(" ")) {
        const [x, y] = pair.split(",").map(Number);
        expect(x).toBeGreaterThanOrEqual(vx);
        expect(x).toBeLessThanOrEqual(vx + vw);
        expect(y).toBeGreaterThanOrEqual(vy);
        expect(y).toBeLessThanOrEqual(vy + vh);
      }
    }
  });

  it("never emits NaN into a points string", () => {
    const geometry = buildPalletStackGeometry({ ...BASE_SPEC, binClearanceMm: 2000 });
    for (const quad of [...geometry.quads, ...geometry.guides]) {
      expect(quad.points).not.toContain("NaN");
    }
    expect(geometry.viewBox).not.toContain("NaN");
  });
});

describe("unusable input draws nothing rather than NaN", () => {
  const bad: Array<[string, PalletStackSpec]> = [
    ["zero per layer", { ...BASE_SPEC, packagesPerLayer: 0 }],
    ["negative per layer", { ...BASE_SPEC, packagesPerLayer: -12 }],
    ["zero layers", { ...BASE_SPEC, layersPerPallet: 0 }],
    ["null carton height", { ...BASE_SPEC, packageHeightMm: null }],
    ["NaN carton height", { ...BASE_SPEC, packageHeightMm: Number.NaN }],
    ["all missing", { packagesPerLayer: null, layersPerPallet: null, packageHeightMm: null }],
  ];

  it.each(bad)("%s yields empty geometry", (_label, spec) => {
    const geometry = buildPalletStackGeometry(spec);
    expect(geometry.quads).toHaveLength(0);
    expect(geometry.viewBox).not.toContain("NaN");
  });
});

describe("height metrics", () => {
  it("sums the deck and every layer", () => {
    // 145 base + 7 x 225 = 1720
    expect(resolvePalletStackMetrics(BASE_SPEC).stackHeightMm).toBe(1720);
  });

  it("includes a slip sheet between layers", () => {
    // 145 + 7 x (225 + 5) = 1755
    expect(resolvePalletStackMetrics({ ...BASE_SPEC, slipSheetHeightMm: 5 }).stackHeightMm).toBe(1755);
  });

  it("agrees with the database generated column for the same numbers", () => {
    // The renderer and product_packaging_profiles.standard_height_mm must never
    // diverge, or the picture disagrees with the rule that blocks the operator.
    const profile = {
      packages_per_layer: 12,
      layers_per_pallet: 7,
      package_height_mm: 225,
      pallet_base_height_mm: 145,
      slip_sheet_height_mm: 0,
      units_per_package: 1,
    };
    expect(resolvePalletStackMetrics(BASE_SPEC).stackHeightMm).toBe(resolveStandardHeightMm(profile));
  });
});

describe("fit verdict", () => {
  // Stack is 1720 mm; the ratified margin is 76 mm.
  it("fits with room to spare", () => {
    const m = resolvePalletStackMetrics({ ...BASE_SPEC, binClearanceMm: 2000 });
    expect(m.usableHeightMm).toBe(1924);
    expect(m.headroomMm).toBe(204);
    expect(m.fit).toBe("fits");
  });

  it("reads as tight inside 100 mm of headroom", () => {
    const m = resolvePalletStackMetrics({ ...BASE_SPEC, binClearanceMm: 1850 });
    expect(m.usableHeightMm).toBe(1774);
    expect(m.headroomMm).toBe(54);
    expect(m.fit).toBe("tight");
  });

  it("blocks when the stack exceeds the margined ceiling, and names the remedy", () => {
    const m = resolvePalletStackMetrics({ ...BASE_SPEC, binClearanceMm: 1700 });
    expect(m.fit).toBe("blocked");
    expect(m.headroomMm).toBeLessThan(0);
    // (1624 - 145) / 225 = 6.57 -> six layers clear it.
    expect(m.maxLayersThatFit).toBe(6);
    expect(describeStackFit(m)).toContain("Drop to 6 layers");
  });

  it("quotes raw millimetres on both sides plus the margin when blocked", () => {
    const text = describeStackFit(resolvePalletStackMetrics({ ...BASE_SPEC, binClearanceMm: 1700 }));
    expect(text).toContain("1720 mm");
    expect(text).toContain("1624 mm");
    expect(text).toContain("76 mm margin");
  });

  it("honours a warehouse margin override", () => {
    const m = resolvePalletStackMetrics({ ...BASE_SPEC, binClearanceMm: 2000, clearanceMarginMm: 150 });
    expect(m.usableHeightMm).toBe(1850);
    expect(m.marginMm).toBe(150);
  });

  it("never blocks on a missing bin clearance", () => {
    // An unrecorded ceiling is not evidence of a problem — the same rule
    // exceedsClearance() applies.
    const m = resolvePalletStackMetrics({ ...BASE_SPEC, binClearanceMm: null });
    expect(m.fit).toBe("unknown");
    expect(m.headroomMm).toBeNull();
    expect(describeStackFit(m)).toContain("not checked");
  });
});

describe("conformance verdict", () => {
  it("calls a full pallet standard", () => {
    const m = resolvePalletStackMetrics({ ...BASE_SPEC, actualPackages: 84 });
    expect(m.conformance).toBe("standard");
    expect(describeStackConformance(m)).toContain("84 of 84");
  });

  it("calls an over-filled pallet an overpack", () => {
    const m = resolvePalletStackMetrics({ ...BASE_SPEC, actualPackages: 96 });
    expect(m.conformance).toBe("overpack");
    expect(describeStackConformance(m)).toContain("12 over standard");
  });

  it("describes a short pallet in layers plus remainder", () => {
    const m = resolvePalletStackMetrics({ ...BASE_SPEC, actualPackages: 63 });
    expect(m.conformance).toBe("short");
    expect(m.fullLayers).toBe(5);
    expect(m.topCount).toBe(3);
    const text = describeStackConformance(m);
    expect(text).toContain("5 full layers");
    expect(text).toContain("3 of 12 on top");
    expect(text).toContain("Short 21");
  });

  it("omits the remainder clause on an exact layer boundary", () => {
    const text = describeStackConformance(resolvePalletStackMetrics({ ...BASE_SPEC, actualPackages: 60 }));
    expect(text).toContain("5 full layers");
    expect(text).not.toContain("on top");
  });
});

describe("space allowance boundary", () => {
  it("draws the slot envelope when the pallet is smaller than the slot", () => {
    const geometry = buildPalletStackGeometry({
      ...BASE_SPEC, allowanceLengthMm: 1250, allowanceWidthMm: 1250,
    });
    const guide = geometry.guides.find((g) => g.kind === "space-allowance");
    expect(guide).toBeDefined();
    expect(guide!.exceeded).toBe(false);
  });

  it("flags overhang when the footprint exceeds the slot", () => {
    const geometry = buildPalletStackGeometry({
      ...BASE_SPEC,
      footprintLengthMm: 1400,
      footprintWidthMm: 1100,
      allowanceLengthMm: 1250,
      allowanceWidthMm: 1250,
    });
    expect(geometry.guides.find((g) => g.kind === "space-allowance")!.exceeded).toBe(true);
  });

  it("omits the boundary when the pallet exactly fills the slot", () => {
    const geometry = buildPalletStackGeometry({
      ...BASE_SPEC,
      allowanceLengthMm: PALLET_FOOTPRINT_LENGTH_MM,
      allowanceWidthMm: PALLET_FOOTPRINT_WIDTH_MM,
    });
    expect(geometry.guides.find((g) => g.kind === "space-allowance")).toBeUndefined();
  });
});

describe("ceiling guides", () => {
  it("draws both ceilings and marks the usable one exceeded when blocked", () => {
    const geometry = buildPalletStackGeometry({ ...BASE_SPEC, binClearanceMm: 1700 });
    expect(geometry.guides.find((g) => g.kind === "bin-ceiling")).toBeDefined();
    expect(geometry.guides.find((g) => g.kind === "usable-ceiling")!.exceeded).toBe(true);
  });

  it("leaves the usable ceiling unexceeded when the stack fits", () => {
    const geometry = buildPalletStackGeometry({ ...BASE_SPEC, binClearanceMm: 2000 });
    expect(geometry.guides.find((g) => g.kind === "usable-ceiling")!.exceeded).toBe(false);
  });

  it("draws no ceilings when no clearance is known", () => {
    const geometry = buildPalletStackGeometry(BASE_SPEC);
    expect(geometry.guides.some((g) => g.kind.endsWith("ceiling"))).toBe(false);
  });
});

describe("layer-count bracket", () => {
  it("draws a vertical rule capped with a tick at each end", () => {
    const { rules } = buildPalletStackGeometry(BASE_SPEC);
    const spine = rules.find((r) => r.key === "bracket")!;
    expect(spine.x1).toBe(spine.x2);
    expect(rules.find((r) => r.key === "bracket-top")).toBeDefined();
    expect(rules.find((r) => r.key === "bracket-bottom")).toBeDefined();
  });

  it("spans exactly the cargo, not the pallet deck", () => {
    const { rules } = buildPalletStackGeometry(BASE_SPEC);
    const spine = rules.find((r) => r.key === "bracket")!;
    const top = rules.find((r) => r.key === "bracket-top")!;
    const bottom = rules.find((r) => r.key === "bracket-bottom")!;
    // Screen y decreases upward, so the top tick is the smaller value.
    expect(top.y1).toBeLessThan(bottom.y1);
    expect(Math.min(spine.y1, spine.y2)).toBeCloseTo(top.y1, 5);
    expect(Math.max(spine.y1, spine.y2)).toBeCloseTo(bottom.y1, 5);
  });

  it("labels the count and singularises one layer", () => {
    const many = buildPalletStackGeometry(BASE_SPEC).labels;
    expect(many.find((l) => l.key === "layer-count")?.text).toBe("7");
    expect(many.find((l) => l.key === "layer-caption")?.text).toBe("LAYERS");
    const one = buildPalletStackGeometry({ ...BASE_SPEC, layersPerPallet: 1 }).labels;
    expect(one.find((l) => l.key === "layer-caption")?.text).toBe("LAYER");
  });

  it("emits no rules for an unusable build", () => {
    expect(buildPalletStackGeometry({ ...BASE_SPEC, layersPerPallet: 0 }).rules).toHaveLength(0);
  });
});

describe("box sizing", () => {
  it("leaves a gap between neighbouring cases", () => {
    const geometry = buildPalletStackGeometry({ ...BASE_SPEC, layersPerPallet: 1 });
    expect(geometry.quads.length).toBeGreaterThan(0);
    expect(BOX_GAP_MM).toBeGreaterThan(0);
  });
});
