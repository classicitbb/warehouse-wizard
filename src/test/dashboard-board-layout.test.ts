import { describe, expect, it } from "vitest";

import {
  BOARD_GAP,
  BOARD_ROW_HEIGHT,
  effectiveLimits,
  fitToContent,
  layoutToSave,
  placeAtBottom,
  rowsForHeight,
  sanitizeBoardLayout,
  type BoardTileSpec,
} from "@/features/dashboard/board-layout";
import { BOARD_TILES } from "@/features/dashboard/board-tiles";

const specs: BoardTileSpec[] = [
  { id: "queue", label: "Queue", limits: { minW: 4, maxW: 6, minH: 4, maxH: 10 }, placement: { x: 0, y: 0, w: 4, h: 6 } },
  { id: "counter", label: "Counter", limits: { minW: 2, maxW: 4, minH: 2, maxH: 3 }, placement: { x: 4, y: 0, w: 2, h: 2 } },
  { id: "optional", label: "Optional", limits: { minW: 3, maxW: 6, minH: 3, maxH: 6 } },
];

describe("sanitizeBoardLayout", () => {
  it("clamps saved sizes to each tile's limits and keeps tiles on the grid", () => {
    const layout = sanitizeBoardLayout(
      [
        { i: "queue", x: 11, y: 3, w: 1, h: 40 },
        { i: "counter", x: -4, y: -2, w: 9, h: 1 },
      ],
      specs,
    );
    expect(layout).toEqual([
      { i: "queue", x: 8, y: 3, w: 4, h: 10 },
      { i: "counter", x: 0, y: 0, w: 4, h: 2 },
    ]);
  });

  it("drops unknown, duplicate and old-format entries, then restores missing defaults", () => {
    const layout = sanitizeBoardLayout(
      [
        { id: "queue", size: "2x2" },
        { i: "gone", x: 0, y: 0, w: 2, h: 2 },
        { i: "counter", x: 6, y: 1, w: 2, h: 2 },
        { i: "counter", x: 0, y: 9, w: 2, h: 2 },
      ],
      specs,
    );
    expect(layout).toEqual([
      { i: "counter", x: 6, y: 1, w: 2, h: 2 },
      { i: "queue", x: 0, y: 0, w: 4, h: 6 },
    ]);
  });

  it("leaves tiles without a default placement off a fresh board", () => {
    expect(sanitizeBoardLayout(undefined, specs).map((item) => item.i)).toEqual(["queue", "counter"]);
  });
});

describe("fitting tiles to their content", () => {
  it("converts content height to whole grid rows, gaps included", () => {
    expect(rowsForHeight(BOARD_ROW_HEIGHT)).toBe(1);
    expect(rowsForHeight(2 * BOARD_ROW_HEIGHT + BOARD_GAP)).toBe(2);
    expect(rowsForHeight(2 * BOARD_ROW_HEIGHT + BOARD_GAP + 1)).toBe(3);
  });

  it("grows a tile whose content needs more rows, never shrinks one", () => {
    const layout = [{ i: "queue", x: 0, y: 0, w: 4, h: 6 }, { i: "counter", x: 4, y: 0, w: 2, h: 3 }];
    expect(fitToContent(layout, { queue: 9, counter: 2 })).toEqual([
      { i: "queue", x: 0, y: 0, w: 4, h: 9 },
      { i: "counter", x: 4, y: 0, w: 2, h: 3 },
    ]);
  });

  it("never lets a tile be resized below what its content needs", () => {
    expect(effectiveLimits(specs[1], 5)).toEqual({ minW: 2, maxW: 4, minH: 5, maxH: 5 });
    expect(effectiveLimits(specs[0], 2)).toEqual({ minW: 4, maxW: 6, minH: 4, maxH: 10 });
  });

  it("saves positions from the grid but only the resized tile's height", () => {
    const saved = [{ i: "queue", x: 0, y: 0, w: 4, h: 6 }, { i: "counter", x: 4, y: 0, w: 2, h: 2 }];
    // The grid grew "queue" to 9 rows for its content and pushed "counter" down.
    const grid = [{ i: "queue", x: 0, y: 0, w: 5, h: 9 }, { i: "counter", x: 4, y: 9, w: 3, h: 3 }];
    expect(layoutToSave(grid, saved, "counter")).toEqual([
      { i: "queue", x: 0, y: 0, w: 5, h: 6 },
      { i: "counter", x: 4, y: 9, w: 3, h: 3 },
    ]);
  });

  it("puts a restored tile below everything else", () => {
    const layout = [{ i: "queue", x: 0, y: 0, w: 4, h: 6 }, { i: "counter", x: 4, y: 7, w: 2, h: 2 }];
    expect(placeAtBottom(layout, specs[2])).toEqual({ i: "optional", x: 0, y: 9, w: 3, h: 3 });
  });
});

describe("default boards", () => {
  it.each(Object.entries(BOARD_TILES))("%s starts with no overlapping tiles, all within their limits", (_mode, tiles) => {
    const placed = sanitizeBoardLayout(undefined, tiles);
    expect(placed.length).toBeGreaterThan(0);
    for (const item of placed) {
      const { limits, placement } = tiles.find((tile) => tile.id === item.i)!;
      expect(item).toEqual({ i: item.i, ...placement });
      expect(item.w).toBeGreaterThanOrEqual(limits.minW);
      expect(item.w).toBeLessThanOrEqual(limits.maxW);
      expect(item.h).toBeGreaterThanOrEqual(limits.minH);
      expect(item.h).toBeLessThanOrEqual(limits.maxH);
      expect(item.x + item.w).toBeLessThanOrEqual(12);
    }
    for (const a of placed) {
      for (const b of placed) {
        if (a === b) continue;
        const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
        expect(overlap, `${a.i} overlaps ${b.i}`).toBe(false);
      }
    }
  });
});
