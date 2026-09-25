// Command Center grid layout: where each tile sits and how big it may get.
//
// Tiles sit on a 12-column grid with gravity: every tile floats up until it
// meets the tile above it, so moving, hiding or shrinking one never leaves a
// hole. A tile dropped onto another is inserted there and pushes it down; a
// tile dropped into a gap narrower than itself shrinks to fit when its limits
// allow (see `fitIntoGap`). Each tile carries hard size limits, and the board
// additionally grows any tile whose content needs more rows than it has (see
// `fitToContent`), so a tile never crops what it shows.

export const BOARD_COLUMNS = 12;
export const BOARD_ROW_HEIGHT = 40;
export const BOARD_GAP = 12;

export type BoardMode = "floor" | "dock" | "office";

/** One tile's position and size, in grid cells. */
export type BoardItem = { i: string; x: number; y: number; w: number; h: number };

export type TileLimits = { minW: number; maxW: number; minH: number; maxH: number };

export type BoardTileSpec = {
  id: string;
  label: string;
  limits: TileLimits;
  /** Where the tile starts on a fresh board. Absent = available but hidden. */
  placement?: Omit<BoardItem, "i">;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** Grid rows needed to show `pixels` of content without clipping. */
export function rowsForHeight(pixels: number) {
  return Math.max(1, Math.ceil((pixels + BOARD_GAP) / (BOARD_ROW_HEIGHT + BOARD_GAP)));
}

/**
 * Turns whatever was saved (possibly an older format, possibly edited by hand)
 * into a valid layout for these specs: unknown tiles dropped, sizes clamped to
 * each tile's limits, positions kept on the grid, and any tile with a default
 * placement that the saved layout lacks added back where it would start.
 */
export function sanitizeBoardLayout(saved: unknown, specs: BoardTileSpec[]): BoardItem[] {
  const specById = new Map(specs.map((spec) => [spec.id, spec]));
  const seen = new Set<string>();
  const items: BoardItem[] = [];

  for (const raw of Array.isArray(saved) ? saved : []) {
    if (!raw || typeof raw !== "object") continue;
    const { i, x, y, w, h } = raw as Partial<BoardItem>;
    const spec = typeof i === "string" ? specById.get(i) : undefined;
    if (!spec || seen.has(spec.id)) continue;
    if (![x, y, w, h].every(isFiniteNumber)) continue;
    seen.add(spec.id);
    const width = clamp(Math.round(w!), spec.limits.minW, Math.min(spec.limits.maxW, BOARD_COLUMNS));
    items.push({
      i: spec.id,
      w: width,
      h: clamp(Math.round(h!), spec.limits.minH, spec.limits.maxH),
      x: clamp(Math.round(x!), 0, BOARD_COLUMNS - width),
      y: Math.max(0, Math.round(y!)),
    });
  }

  for (const spec of specs) {
    if (seen.has(spec.id) || !spec.placement) continue;
    items.push({ i: spec.id, ...spec.placement });
  }
  return items;
}

/** The default layout for a board: every tile that has a starting placement. */
export function defaultBoardLayout(specs: BoardTileSpec[]): BoardItem[] {
  return sanitizeBoardLayout([], specs);
}

/** Place a restored tile below everything else, at its smallest size. */
export function placeAtBottom(layout: BoardItem[], spec: BoardTileSpec): BoardItem {
  const bottom = layout.reduce((max, item) => Math.max(max, item.y + item.h), 0);
  const w = spec.placement?.w ?? spec.limits.minW;
  const h = spec.placement?.h ?? spec.limits.minH;
  return { i: spec.id, x: 0, y: bottom, w, h };
}

/**
 * The layout the grid actually renders: each tile at least as tall as its
 * content needs. `neededRows` comes from measuring each tile's content. The
 * saved layout is left alone, so a tile shrinks back to the size the person
 * chose once its content gets shorter again.
 */
export function fitToContent(layout: BoardItem[], neededRows: Record<string, number>): BoardItem[] {
  return layout.map((item) => {
    const needed = neededRows[item.i] ?? 0;
    return needed > item.h ? { ...item, h: needed } : item;
  });
}

/**
 * Size limits handed to the grid. Content can outgrow a spec's limits (a
 * narrow tile wraps its text), so the content height always wins: a tile may
 * never be resized smaller than what it shows.
 */
export function effectiveLimits(spec: BoardTileSpec, neededRows: number | undefined): TileLimits {
  const needed = neededRows ?? 0;
  return {
    ...spec.limits,
    minH: Math.max(spec.limits.minH, needed),
    maxH: Math.max(spec.limits.maxH, needed),
  };
}

/**
 * Where a dragged tile goes when it overlaps other tiles. If the column under
 * its centre is free, the tile is being put into the gap beside them: it slides
 * sideways to fit, or narrows to the gap's width if the gap is too tight and
 * `minW` allows. Otherwise (it is on top of a tile, or the gap is narrower
 * than `minW`) it returns null and the tile is inserted, pushing others down.
 */
export function fitIntoGap(
  others: BoardItem[],
  target: { x: number; y: number; h: number },
  width: number,
  minW: number,
  cols = BOARD_COLUMNS,
): { x: number; w: number } | null {
  const x = clamp(target.x, 0, cols - width);
  const occupied = new Array<boolean>(cols).fill(false);
  for (const other of others) {
    if (other.y >= target.y + target.h || other.y + other.h <= target.y) continue;
    for (let col = other.x; col < Math.min(cols, other.x + other.w); col++) occupied[col] = true;
  }
  if (!occupied.slice(x, x + width).includes(true)) return { x, w: width };

  const centre = x + Math.floor(width / 2);
  if (occupied[centre]) return null;
  let start = centre;
  let end = centre + 1;
  while (start > 0 && !occupied[start - 1]) start--;
  while (end < cols && !occupied[end]) end++;
  const gap = end - start;
  if (gap >= width) return { x: clamp(x, start, end - width), w: width };
  return gap >= minW ? { x: start, w: gap } : null;
}

/**
 * What to save after someone drags or resizes. Positions come from the grid
 * (neighbours it pushed out of the way included), but a tile's height is only
 * taken from the grid for the tile the person actually resized. Others keep
 * their saved height, so heights grown to fit content are never baked in.
 */
export function layoutToSave(gridLayout: BoardItem[], saved: BoardItem[], resizedId?: string): BoardItem[] {
  const savedById = new Map(saved.map((item) => [item.i, item]));
  return gridLayout.map(({ i, x, y, w, h }) => ({
    i,
    x,
    y,
    w,
    h: i === resizedId ? h : savedById.get(i)?.h ?? h,
  }));
}

export function boardStorageKey(mode: BoardMode, profileId?: string | null, deviceId?: string | null) {
  return ["wms.dashboard.grid.v2", mode, profileId ?? "anonymous", deviceId ?? "device"].join(".");
}
