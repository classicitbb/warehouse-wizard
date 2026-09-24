// Command Center tile catalog: which boards offer each tile, where it starts,
// and how big it may get. Every tile's content is bounded (top N rows plus a
// "+N more" link), so it has a real minimum size, and the board grows a tile
// to fit whatever it has to show — see board-layout.ts.

import type { ReactNode } from "react";

import type { ModuleKey } from "@/hooks/use-feature-flags";
import type { BoardMode, BoardTileSpec, TileLimits } from "./board-layout";
import {
  BrainTile,
  CapacityTile,
  DockLaneTile,
  IntelligenceTile,
  OfficeWidgetTile,
  OpenWorkTile,
  QueueTile,
  SetupChecklistTile,
  StockHealthTile,
  StockStatusTile,
  type BoardData,
  type Tone,
} from "./board-tile-content";

export type { BoardData, Tone } from "./board-tile-content";

export type BoardTileEntry = BoardTileSpec & {
  moduleKey?: ModuleKey;
  tone?: (data: BoardData) => Tone | undefined;
  render: (data: BoardData) => ReactNode;
};

// ── Catalog ──────────────────────────────────────────────────────────────────

const sized = (minW: number, maxW: number, minH: number, maxH: number): TileLimits => ({ minW, maxW, minH, maxH });

const queueTone = (label: string) => (data: BoardData) => data.snapshot.floorQueues.find((item) => item.label === label)?.tone;
const widgetTone = (label: string) => (data: BoardData) => data.snapshot.officeWidgets.find((item) => item.label === label)?.tone;

// Tiles offered on more than one board, keyed by id. Placement is per board.
const TILES = {
  capacity: { id: "capacity", label: "Storage capacity", moduleKey: "inventory", limits: sized(3, 6, 3, 6), render: (d) => <CapacityTile data={d} /> },
  "open-work": { id: "open-work", label: "Open work", limits: sized(2, 4, 4, 7), render: (d) => <OpenWorkTile data={d} /> },
  "stock-status": {
    id: "stock-status", label: "Hold & quarantine", moduleKey: "status", limits: sized(2, 4, 2, 4),
    tone: (d) => ((d.metrics?.quarantineStock ?? 0) > 0 ? "critical" : (d.metrics?.holdStock ?? 0) > 0 ? "warning" : undefined),
    render: (d) => <StockStatusTile data={d} />,
  },
  "stock-health": {
    id: "stock-health", label: "Expiry & aging", moduleKey: "inventory", limits: sized(2, 4, 4, 7),
    tone: (d) => ((d.metrics?.expiryWarning30 ?? 0) > 0 ? "critical" : (d.metrics?.expiryWarning60 ?? 0) > 0 ? "warning" : undefined),
    render: (d) => <StockHealthTile data={d} />,
  },
  inbound: { id: "inbound", label: "Inbound", moduleKey: "receiving", limits: sized(4, 6, 4, 10), tone: queueTone("Inbound"), render: (d) => <QueueTile data={d} label="Inbound" /> },
  putaway: { id: "putaway", label: "Put-Away", moduleKey: "putaway", limits: sized(4, 6, 4, 10), tone: queueTone("Put-Away"), render: (d) => <QueueTile data={d} label="Put-Away" /> },
  outbound: { id: "outbound", label: "Outbound", moduleKey: "pick-lists", limits: sized(4, 6, 4, 10), tone: queueTone("Outbound"), render: (d) => <QueueTile data={d} label="Outbound" /> },
  "moves-counts": { id: "moves-counts", label: "Moves & Counts", moduleKey: "location-moves", limits: sized(4, 6, 4, 10), tone: queueTone("Moves & Counts"), render: (d) => <QueueTile data={d} label="Moves & Counts" /> },
  "blocked-exceptions": { id: "blocked-exceptions", label: "Blocked exceptions", moduleKey: "status", limits: sized(4, 6, 4, 10), tone: queueTone("Blocked Exceptions"), render: (d) => <QueueTile data={d} label="Blocked Exceptions" /> },
  intelligence: { id: "intelligence", label: "Warehouse intelligence", limits: sized(3, 6, 4, 8), render: (d) => <IntelligenceTile data={d} /> },
  brain: { id: "brain", label: "Warehouse Brain", moduleKey: "copilot", limits: sized(3, 8, 4, 14), render: (d) => <BrainTile data={d} /> },
  "lane-ready": { id: "lane-ready", label: "Ready lane", moduleKey: "pick-lists", limits: sized(2, 4, 3, 12), render: (d) => <DockLaneTile data={d} status="ready" /> },
  "lane-called": { id: "lane-called", label: "Called lane", moduleKey: "pick-lists", limits: sized(2, 4, 3, 12), render: (d) => <DockLaneTile data={d} status="called" /> },
  "lane-loading": { id: "lane-loading", label: "Loading lane", moduleKey: "pick-lists", limits: sized(2, 4, 3, 12), render: (d) => <DockLaneTile data={d} status="loading" /> },
  "lane-blocked": {
    id: "lane-blocked", label: "Blocked lane", moduleKey: "pick-lists", limits: sized(2, 4, 3, 12),
    tone: (d) => (d.snapshot.dockLoads.some((load) => load.status === "blocked") ? "critical" : undefined),
    render: (d) => <DockLaneTile data={d} status="blocked" />,
  },
  "lane-loaded": { id: "lane-loaded", label: "Loaded lane", moduleKey: "pick-lists", limits: sized(2, 4, 3, 12), render: (d) => <DockLaneTile data={d} status="loaded" /> },
  "fill-level": { id: "fill-level", label: "Fill level", moduleKey: "inventory", limits: sized(2, 4, 2, 3), tone: widgetTone("Fill level"), render: (d) => <OfficeWidgetTile data={d} label="Fill level" title="Fill level" /> },
  "reorder-watch": { id: "reorder-watch", label: "Reorder watch", moduleKey: "inventory", limits: sized(2, 4, 2, 3), tone: widgetTone("Reorder forecast watch"), render: (d) => <OfficeWidgetTile data={d} label="Reorder forecast watch" title="Reorder watch" /> },
  "expiration-risk": { id: "expiration-risk", label: "Expiration risk", moduleKey: "inventory", limits: sized(2, 4, 2, 3), tone: widgetTone("Expiration risk"), render: (d) => <OfficeWidgetTile data={d} label="Expiration risk" title="Expiration risk" /> },
  dpmo: { id: "dpmo", label: "DPMO", moduleKey: "cycle-counts", limits: sized(2, 4, 2, 3), tone: widgetTone("DPMO"), render: (d) => <OfficeWidgetTile data={d} label="DPMO" title="Count accuracy (DPMO)" /> },
  "setup-checklist": { id: "setup-checklist", label: "Setup checklist", moduleKey: "settings", limits: sized(3, 6, 4, 8), render: (d) => <SetupChecklistTile data={d} /> },
} satisfies Record<string, Omit<BoardTileEntry, "placement">>;

type TileId = keyof typeof TILES;

function place(id: TileId, x?: number, y?: number, w?: number, h?: number): BoardTileEntry {
  const tile = TILES[id] as Omit<BoardTileEntry, "placement">;
  return x === undefined ? { ...tile } : { ...tile, placement: { x, y: y!, w: w!, h: h! } };
}

/**
 * Each board's tiles. Tiles given a position start on the board; the rest
 * start hidden and can be added back in edit mode.
 */
export const BOARD_TILES: Record<BoardMode, BoardTileEntry[]> = {
  floor: [
    place("inbound", 0, 0, 4, 6),
    place("putaway", 4, 0, 4, 6),
    place("outbound", 8, 0, 4, 6),
    place("moves-counts", 0, 6, 4, 5),
    place("blocked-exceptions", 4, 6, 4, 5),
    place("capacity", 8, 6, 4, 4),
    place("intelligence", 8, 10, 4, 6),
    place("open-work"),
    place("stock-status"),
    place("stock-health"),
  ],
  dock: [
    place("lane-ready", 0, 0, 2, 6),
    place("lane-called", 2, 0, 2, 6),
    place("lane-loading", 4, 0, 2, 6),
    place("lane-blocked", 6, 0, 2, 6),
    place("lane-loaded", 8, 0, 2, 6),
    place("open-work", 10, 0, 2, 5),
    place("outbound", 0, 6, 4, 6),
    place("brain", 4, 6, 8, 6),
    place("capacity"),
    place("stock-status"),
  ],
  office: [
    place("capacity", 0, 0, 4, 4),
    place("reorder-watch", 4, 0, 3, 2),
    place("expiration-risk", 7, 0, 3, 2),
    place("dpmo", 10, 0, 2, 2),
    place("stock-health", 4, 2, 3, 5),
    place("stock-status", 7, 2, 2, 3),
    place("open-work", 9, 2, 3, 5),
    place("setup-checklist", 0, 4, 4, 7),
    place("brain", 4, 7, 8, 6),
    place("fill-level"),
    place("intelligence"),
  ],
};
