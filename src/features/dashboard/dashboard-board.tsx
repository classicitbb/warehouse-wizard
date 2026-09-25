// The Command Center grid: tiles on 12 columns with gravity, so every tile
// sits as high as it can and moving one never strands the rest. In edit mode
// tiles can be dragged and resized within their limits; a tile dropped on
// another is inserted there, and one dropped into a narrow gap shrinks to fit
// if its limits allow. Every tile is measured and grown to fit its content,
// so nothing is cropped.

import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import GridLayout, { type Layout } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import "./dashboard-board.css";
import { Eye, EyeOff, GripVertical, RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  BOARD_COLUMNS,
  BOARD_GAP,
  BOARD_ROW_HEIGHT,
  effectiveLimits,
  fitIntoGap,
  fitToContent,
  layoutToSave,
  rowsForHeight,
  type BoardItem,
} from "./board-layout";
import type { BoardData, BoardTileEntry, Tone } from "./board-tiles";

/** Below this width tiles stack in one column at their natural height. */
const STACK_BELOW_PX = 768;

// The grid's own layout helpers (typed here; @types/react-grid-layout omits them).
const gridUtils = (GridLayout as unknown as {
  utils: {
    compact: (layout: Layout[], compactType: "vertical", cols: number) => Layout[];
    moveElement: (
      layout: Layout[], item: Layout, x: number, y: number, isUserAction: boolean,
      preventCollision: boolean, compactType: "vertical", cols: number, allowOverlap: boolean,
    ) => Layout[];
  };
}).utils;

/**
 * Drag handling that adds the gap rule to the grid's own. On every step the
 * grid moves the tile at full width and pushes aside whatever it hits; this
 * undoes that push, applies `fitIntoGap`, and redoes the move at the fitted
 * size. The layout on screen is kept so the drop lands exactly where the
 * preview showed, rather than where the grid would recompute it.
 */
function useGapFitDrag(onDrop: (layout: Layout[]) => void) {
  const drag = useRef<{ shown: Layout[]; width: number } | null>(null);

  const onDragStart = useCallback((layout: Layout[], item: Layout) => {
    drag.current = { shown: layout.map((entry) => ({ ...entry })), width: item.w };
  }, []);

  const onDrag = useCallback((layout: Layout[], _old: Layout, item: Layout) => {
    const current = drag.current;
    if (!current) return;
    const before = new Map(current.shown.map((entry) => [entry.i, entry]));
    for (const entry of layout) {
      const shown = before.get(entry.i);
      if (!shown || entry === item) continue;
      entry.x = shown.x;
      entry.y = shown.y;
      entry.moved = false;
    }
    const from = before.get(item.i)!;
    const others = current.shown.filter((entry) => entry.i !== item.i);
    const target = { x: item.x, y: item.y, h: item.h };
    const fit = fitIntoGap(others, target, current.width, item.minW ?? 1) ?? {
      x: Math.min(target.x, BOARD_COLUMNS - current.width),
      w: current.width,
    };
    item.w = fit.w;
    item.y = from.y;
    // The grid skips a move to the cell a tile is already in; start it off-grid
    // so the fitted width still pushes whatever it now overlaps.
    item.x = from.x === fit.x && from.y === target.y ? -1 : from.x;
    item.moved = false;
    gridUtils.moveElement(layout, item, fit.x, target.y, true, false, "vertical", BOARD_COLUMNS, false);
    current.shown = gridUtils.compact(layout, "vertical", BOARD_COLUMNS);
  }, []);

  const onDragStop = useCallback(
    (layout: Layout[]) => {
      const shown = drag.current ? new Map(drag.current.shown.map((entry) => [entry.i, entry])) : null;
      drag.current = null;
      if (shown) {
        for (const entry of layout) {
          const final = shown.get(entry.i);
          if (final) Object.assign(entry, { x: final.x, y: final.y, w: final.w, h: final.h });
        }
      }
      onDrop(layout);
    },
    [onDrop],
  );

  return { onDragStart, onDrag, onDragStop };
}

const TONE_STRIPE: Record<Tone, string> = {
  critical: "border-l-destructive",
  warning: "border-l-warning",
  info: "border-l-info",
  success: "border-l-success",
};

function useElementWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

/**
 * The card around a tile. Its content is laid out at natural height and
 * measured; `onRowsNeeded` reports how many grid rows that takes.
 */
const TileFrame = memo(function TileFrame({
  id,
  label,
  tone,
  editMode,
  onHide,
  onRowsNeeded,
  children,
}: {
  id: string;
  label: string;
  tone?: Tone;
  editMode: boolean;
  onHide: (id: string) => void;
  onRowsNeeded?: (id: string, rows: number) => void;
  children: ReactNode;
}) {
  const contentRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = contentRef.current;
    if (!element || !onRowsNeeded) return;
    // +2 for the frame's top and bottom border.
    const report = () => onRowsNeeded(id, rowsForHeight(element.offsetHeight + 2));
    report();
    const observer = new ResizeObserver(report);
    observer.observe(element);
    return () => observer.disconnect();
  }, [id, onRowsNeeded]);

  return (
    <div
      className={cn(
        "relative h-full overflow-hidden rounded-lg border bg-card text-card-foreground shadow-sm",
        tone && cn("border-l-4", TONE_STRIPE[tone]),
        editMode && "cursor-grab border-dashed ring-1 ring-primary/30 active:cursor-grabbing",
      )}
    >
      {editMode ? (
        // Drops down over the top of the tile instead of adding a row above
        // it, so unlocking never changes a tile's height and locking again
        // never leaves a gap where the strip was.
        <div className="absolute inset-x-0 top-0 z-10 flex items-center justify-between gap-2 border-b border-dashed border-border bg-secondary px-3 py-1 shadow-sm">
          <span className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-foreground">
            <GripVertical className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{label}</span>
          </span>
          <button
            type="button"
            onClick={() => onHide(id)}
            // Keep the grid from starting a drag from the button.
            onMouseDown={(event) => event.stopPropagation()}
            onTouchStart={(event) => event.stopPropagation()}
            className="board-no-drag grid h-6 w-6 shrink-0 place-items-center rounded-md text-muted-foreground transition hover:bg-secondary hover:text-foreground"
            aria-label={`Hide ${label}`}
            title={`Hide ${label}`}
          >
            <EyeOff className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : null}
      <div ref={contentRef} className={cn("p-4", editMode && "pointer-events-none select-none opacity-40")}>
        {children}
      </div>
    </div>
  );
});

export function DashboardBoard({
  tiles,
  layout,
  visibleIds,
  hiddenTiles,
  data,
  editMode,
  onLayoutChange,
  onHide,
  onRestore,
  onReset,
}: {
  tiles: BoardTileEntry[];
  layout: BoardItem[];
  visibleIds: Set<string>;
  hiddenTiles: BoardTileEntry[];
  data: BoardData;
  editMode: boolean;
  onLayoutChange: (layout: BoardItem[]) => void;
  onHide: (id: string) => void;
  onRestore: (id: string) => void;
  onReset: () => void;
}) {
  const [containerRef, width] = useElementWidth<HTMLDivElement>();
  const [neededRows, setNeededRows] = useState<Record<string, number>>({});
  const tileById = useMemo(() => new Map(tiles.map((tile) => [tile.id, tile])), [tiles]);

  const reportRows = useCallback((id: string, rows: number) => {
    setNeededRows((current) => (current[id] === rows ? current : { ...current, [id]: rows }));
  }, []);

  const savedVisible = useMemo(
    () => layout.filter((item) => visibleIds.has(item.i) && tileById.has(item.i)),
    [layout, tileById, visibleIds],
  );

  const gridLayout = useMemo<Layout[]>(
    () =>
      fitToContent(savedVisible, neededRows).map((item) => ({
        ...item,
        ...effectiveLimits(tileById.get(item.i)!, neededRows[item.i]),
      })),
    [neededRows, savedVisible, tileById],
  );

  const stacked = width > 0 && width < STACK_BELOW_PX;

  const gapFitDrag = useGapFitDrag(
    useCallback((next: Layout[]) => onLayoutChange(layoutToSave(next, savedVisible)), [onLayoutChange, savedVisible]),
  );

  const renderTile = (item: BoardItem, measure: boolean) => {
    const tile = tileById.get(item.i)!;
    return (
      <TileFrame
        id={tile.id}
        label={tile.label}
        tone={tile.tone?.(data)}
        editMode={editMode && !stacked}
        onHide={onHide}
        onRowsNeeded={measure ? reportRows : undefined}
      >
        {tile.render(data)}
      </TileFrame>
    );
  };

  return (
    // Block (not grid/flex) so the width can shrink when a scrollbar appears;
    // overflow-x-clip only absorbs sub-pixel rounding, tiles never reach past it.
    <div ref={containerRef} className="min-w-0 space-y-3 overflow-x-clip">
      {width === 0 ? null : stacked ? (
        <div className="grid gap-3">
          {editMode ? <p className="text-sm text-muted-foreground">Tiles can be arranged on a wider screen.</p> : null}
          {[...savedVisible]
            .sort((a, b) => a.y - b.y || a.x - b.x)
            .map((item) => (
              <div key={item.i}>{renderTile(item, false)}</div>
            ))}
        </div>
      ) : (
        <GridLayout
          className="command-center-board"
          width={width}
          cols={BOARD_COLUMNS}
          rowHeight={BOARD_ROW_HEIGHT}
          margin={[BOARD_GAP, BOARD_GAP]}
          containerPadding={[0, 0]}
          layout={gridLayout}
          compactType="vertical"
          preventCollision={false}
          isDraggable={editMode}
          isResizable={editMode}
          resizeHandles={["se", "e", "s"]}
          draggableCancel=".board-no-drag"
          onDragStart={gapFitDrag.onDragStart}
          onDrag={gapFitDrag.onDrag}
          onDragStop={gapFitDrag.onDragStop}
          onResizeStop={(next, _old, resized) => onLayoutChange(layoutToSave(next, savedVisible, resized.i))}
        >
          {savedVisible.map((item) => (
            <div key={item.i}>{renderTile(item, true)}</div>
          ))}
        </GridLayout>
      )}

      {editMode ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-border bg-secondary/25 px-3 py-2">
          <span className="text-xs font-medium text-muted-foreground">
            {hiddenTiles.length > 0 ? "Add a tile" : "Every tile is on the board"}
          </span>
          {hiddenTiles.map((tile) => (
            <Button key={tile.id} type="button" size="sm" variant="outline" className="h-8 gap-1.5" onClick={() => onRestore(tile.id)}>
              <Eye className="h-3.5 w-3.5" />
              {tile.label}
            </Button>
          ))}
          <Button type="button" size="sm" variant="ghost" className="ml-auto h-8 gap-1.5" onClick={onReset}>
            <RotateCcw className="h-3.5 w-3.5" />
            Reset layout
          </Button>
        </div>
      ) : null}
    </div>
  );
}
