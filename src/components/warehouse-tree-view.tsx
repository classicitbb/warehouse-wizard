import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { QRCodeSVG } from "qrcode.react";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useTenantPath } from "@/hooks/use-tenant-path";
import {
  AlertTriangle, Ban, Building2, Boxes, ChevronRight, ChevronsDownUp,
  Layers, LayoutGrid, Loader2, MapPin, MoreHorizontal,
  Pencil, Plus, Printer, PackageSearch, Search, Trash2,
} from "lucide-react";
import { toast } from "sonner";

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";

import { cn } from "@/lib/utils";
import {
  type CascadeDeleteResult,
  deleteLocationCascade, deleteWarehouseCascade, deleteZoneCascade,
  displayRackLocationCode,
  bayCodeFromLocationCode,
  type InventoryStructureNode,
  getStoredPalletCounts,
  resolveLocationCapacity,
  updateRecord, upsertRecord,
} from "@/lib/wms-core";
import { LocationLabelPage } from "@/components/location-label-page";
import { ZoneLabelPage } from "@/components/zone-label-page";
import { BayLocationCodesPrintDialog, type LabelSheetItem } from "@/components/label-sheet-print";
import { Textarea } from "@/components/ui/textarea";
import { LocationWizardDialog } from "@/features/shared/ui-shared";
import { ReorderForecastSettingsPanel } from "@/features/shared/reorder-forecast-settings";

// ─── Types ────────────────────────────────────────────────────────────────────

interface WarehouseRow {
  id: string; code: string; name: string;
  city?: string | null; country?: string | null;
  has_cool_zone?: boolean | null; active?: boolean | null;
}

interface ZoneRow {
  id: string; code: string; name: string; warehouse_id: string;
  temperature_class: string;
  is_staging?: boolean | null; is_dispatch?: boolean | null; is_quarantine?: boolean | null;
}

interface LocationRow {
  id: string; code: string;
  aisle?: string | null; bay?: string | null; level?: number | null; position?: string | null;
  level_style?: string | null;
  depth?: number | null; location_type?: string | null; temperature_class?: string | null;
  max_pallets?: number | null; status?: string | null;
  pick_sequence?: number | null; putaway_sequence?: number | null;
  mixed_sku_allowed?: boolean | null; mixed_lot_allowed?: boolean | null;
  max_height?: number | null; notes?: string | null;
  zone_id: string; warehouse_id: string;
}

interface LevelGroup { level: string; displayLevel: string; positions: LocationRow[] }
interface BayGroup { bay: string; levels: LevelGroup[] }
interface AisleGroup { aisle: string; bays: BayGroup[] }
interface FillStats { occupied: number; capacity: number; disabled: number; total: number }
type TreeSearchLocation = Pick<LocationRow, "id" | "code" | "aisle" | "bay" | "level" | "position" | "zone_id" | "warehouse_id">;

// ─── Context ──────────────────────────────────────────────────────────────────

type ActiveDialog =
  | { type: "add-warehouse" }
  | { type: "edit-warehouse"; warehouse: WarehouseRow }
  | { type: "add-zone"; warehouseId: string; warehouseName: string }
  | { type: "edit-zone"; zone: ZoneRow; warehouseName: string }
  | { type: "edit-location"; location: LocationRow }
  | { type: "wizard-zone"; warehouseId: string; zoneId: string; zoneCode: string }
  | { type: "edit-range"; zone: ZoneRow }
  | { type: "reorder-settings" }
  | { type: "delete"; label: string; deleteFn: () => Promise<CascadeDeleteResult> }
  | null;

interface TreeCtxValue {
  expandedNodes: Set<string>;
  toggleNode: (key: string) => void;
  activeTreeNodeKey: string | null;
  selectTreeNode: (key: string) => void;
  setDialog: (d: ActiveDialog) => void;
  warehouses: WarehouseRow[];
  zones: ZoneRow[];
  navigate: ReturnType<typeof useNavigate>;
  /** Deep-link to Inventory Search scoped to a rack / bay / level / location. */
  viewContents: (scope: {
    node: InventoryStructureNode;
    zoneCode?: string;
    locationPrefix?: string;
    warehouseId?: string | null;
  }) => void;
  fillStats: {
    byWarehouse: Map<string, FillStats>;
    byZone: Map<string, FillStats>;
    byLocation: Map<string, FillStats>;
  };
}

const TreeCtx = createContext<TreeCtxValue | null>(null);
const TREE_CONTEXT_HINT = "Right-click or press and hold for row actions.";

function TreeRowFlyout({
  nodeKey,
  children,
  menu,
}: {
  nodeKey: string;
  children: React.ReactNode;
  menu: (close: () => void) => React.ReactNode;
}) {
  const { selectTreeNode } = useTCtx();
  const [open, setOpen] = useState(false);
  const [anchorPosition, setAnchorPosition] = useState({ x: 0, y: 0 });
  const holdTimerRef = useRef<number | null>(null);
  const openFrameRef = useRef<number | null>(null);

  const clearHoldTimer = () => {
    if (holdTimerRef.current !== null) {
      window.clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
  };

  const clearOpenFrame = () => {
    if (openFrameRef.current !== null) {
      window.cancelAnimationFrame(openFrameRef.current);
      openFrameRef.current = null;
    }
  };

  const openForRow = (x: number, y: number) => {
    clearHoldTimer();
    clearOpenFrame();
    setOpen(false);
    setAnchorPosition({ x, y });
    selectTreeNode(nodeKey);
    openFrameRef.current = window.requestAnimationFrame(() => {
      openFrameRef.current = null;
      setOpen(true);
    });
  };

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) clearOpenFrame();
        setOpen(nextOpen);
      }}
    >
      <div
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
          openForRow(event.clientX, event.clientY);
        }}
        onPointerDown={(event) => {
          event.stopPropagation();
          if (event.pointerType === "mouse") return;
          clearHoldTimer();
          const { clientX, clientY } = event;
          holdTimerRef.current = window.setTimeout(() => openForRow(clientX, clientY), 550);
        }}
        onPointerUp={clearHoldTimer}
        onPointerCancel={clearHoldTimer}
        onPointerLeave={clearHoldTimer}
      >
        {children}
      </div>
      <PopoverAnchor asChild>
        <span
          aria-hidden="true"
          className="pointer-events-none fixed h-px w-px"
          style={{ left: anchorPosition.x, top: anchorPosition.y }}
        />
      </PopoverAnchor>
      <PopoverContent
        side="right"
        align="start"
        sideOffset={10}
        collisionPadding={8}
        className="w-48 p-1 data-[state=closed]:!animate-none data-[state=open]:!animate-none"
      >
        <div role="menu">{menu(() => setOpen(false))}</div>
      </PopoverContent>
    </Popover>
  );
}

function TreeRowFlyoutItem({
  children,
  disabled = false,
  destructive = false,
  onSelect,
}: {
  children: React.ReactNode;
  disabled?: boolean;
  destructive?: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      className={cn(
        "flex w-full items-center rounded-sm px-2 py-1.5 text-left text-sm outline-none transition-colors hover:bg-accent focus:bg-accent disabled:pointer-events-none disabled:opacity-50",
        destructive && "text-destructive hover:text-destructive",
      )}
      onClick={onSelect}
    >
      {children}
    </button>
  );
}

function useTCtx() {
  const c = useContext(TreeCtx);
  if (!c) throw new Error("TreeCtx missing");
  return c;
}

// ─── Data helpers ─────────────────────────────────────────────────────────────

async function fetchZoneLocations(zoneId: string): Promise<LocationRow[]> {
  const { data, error } = await supabase
    .from("locations")
    .select("id, code, aisle, bay, level, level_style, position, depth, location_type, temperature_class, max_pallets, status, pick_sequence, putaway_sequence, mixed_sku_allowed, mixed_lot_allowed, max_height, notes, zone_id, warehouse_id")
    .eq("zone_id", zoneId)
    .eq("is_hidden", false)
    .order("aisle").order("bay").order("level").order("position")
    .limit(201);
  if (error) throw error;
  return (data ?? []) as LocationRow[];
}

async function fetchLocationFillStats() {
  const { data, error } = await supabase
    .from("locations")
    .select("id, warehouse_id, zone_id, max_pallets, depth, status")
    .eq("is_hidden", false);
  if (error) throw error;

  const rows = (data ?? []) as Array<Pick<LocationRow, "id" | "warehouse_id" | "zone_id" | "max_pallets" | "depth" | "status">>;
  const storedCounts = await getStoredPalletCounts(rows.map((row) => row.id));
  const byWarehouse = new Map<string, FillStats>();
  const byZone = new Map<string, FillStats>();
  const byLocation = new Map<string, FillStats>();

  function add(target: Map<string, FillStats>, key: string | null | undefined, stats: FillStats) {
    if (!key) return;
    const current = target.get(key) ?? { occupied: 0, capacity: 0, disabled: 0, total: 0 };
    target.set(key, {
      occupied: current.occupied + stats.occupied,
      capacity: current.capacity + stats.capacity,
      disabled: current.disabled + stats.disabled,
      total: current.total + stats.total,
    });
  }

  for (const row of rows) {
    const stats = locationFillStats(row as LocationRow, storedCounts.get(row.id) ?? 0);
    byLocation.set(row.id, stats);
    add(byWarehouse, row.warehouse_id, stats);
    add(byZone, row.zone_id, stats);
  }

  return { byWarehouse, byZone, byLocation };
}

async function fetchTreeSearchLocations(): Promise<TreeSearchLocation[]> {
  const { data, error } = await supabase
    .from("locations")
    .select("id, code, aisle, bay, level, position, zone_id, warehouse_id")
    .eq("is_hidden", false);
  if (error) throw error;
  return (data ?? []) as TreeSearchLocation[];
}

function numComp(a: string, b: string) {
  const na = Number(a), nb = Number(b);
  return !isNaN(na) && !isNaN(nb) ? na - nb : a.localeCompare(b);
}

function displayLevel(level: string, levelStyle: string | null | undefined) {
  if (levelStyle !== "alpha") return level;
  const numericLevel = Number(level);
  return Number.isInteger(numericLevel) && numericLevel >= 1 && numericLevel <= 26
    ? String.fromCharCode(64 + numericLevel)
    : level;
}

function groupIntoTree(locs: LocationRow[]): AisleGroup[] {
  const m = new Map<string, Map<string, Map<string, LocationRow[]>>>();
  for (const l of locs) {
    const a = l.aisle ?? "—", b = l.bay ?? "—", lv = l.level != null ? String(l.level) : "—";
    if (!m.has(a)) m.set(a, new Map());
    const bm = m.get(a)!;
    if (!bm.has(b)) bm.set(b, new Map());
    const lm = bm.get(b)!;
    if (!lm.has(lv)) lm.set(lv, []);
    lm.get(lv)!.push(l);
  }
  return [...m.entries()].sort(([a], [b]) => numComp(a, b)).map(([aisle, bm]) => ({
    aisle,
    bays: [...bm.entries()].sort(([a], [b]) => numComp(a, b)).map(([bay, lm]) => ({
      bay,
      levels: [...lm.entries()].sort(([a], [b]) => numComp(a, b)).map(([level, positions]) => ({
        level,
        displayLevel: displayLevel(level, positions[0]?.level_style),
        positions: positions.sort((a, b) => numComp(String(a.position ?? ""), String(b.position ?? ""))),
      })),
    })),
  }));
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function prefixedCode(prefix: string | null | undefined, code: string) {
  const cleanPrefix = String(prefix ?? "").trim();
  const cleanCode = String(code ?? "").trim();
  if (!cleanPrefix || !cleanCode) return cleanCode;
  return cleanCode.toUpperCase().startsWith(`${cleanPrefix}-`.toUpperCase())
    ? cleanCode
    : `${cleanPrefix}-${cleanCode}`;
}

function normalizeTreeSearch(value: unknown) {
  return String(value ?? "").trim().toUpperCase().replace(/\s+/g, "");
}

function selectorEscape(value: string) {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") return CSS.escape(value);
  return value.replace(/["\\]/g, "\\$&");
}

function scrollToTreeNodeWhenReady(nodeKey: string) {
  let attempts = 0;
  const findAndFocus = () => {
    const el = document.querySelector<HTMLElement>(`[data-tree-key="${selectorEscape(nodeKey)}"]`);
    if (!el) return false;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.focus({ preventScroll: true });
    el.classList.add("ring-2", "ring-primary", "ring-offset-2");
    window.setTimeout(() => el.classList.remove("ring-2", "ring-primary", "ring-offset-2"), 1200);
    return true;
  };
  if (findAndFocus()) return;
  const handle = window.setInterval(() => {
    attempts += 1;
    if (findAndFocus() || attempts > 25) window.clearInterval(handle);
  }, 80);
}

function emptyFillStats(): FillStats {
  return { occupied: 0, capacity: 0, disabled: 0, total: 0 };
}

function locationFillStats(location: LocationRow, occupied = 0): FillStats {
  const capacity = resolveLocationCapacity(location.max_pallets, location.depth);
  return {
    occupied: Number.isFinite(occupied) ? Math.max(0, occupied) : 0,
    capacity: Number.isFinite(capacity) ? Math.max(0, capacity) : 0,
    disabled: location.status && location.status !== "active" ? 1 : 0,
    total: 1,
  };
}

function combineFillStats(locations: LocationRow[], byLocation: Map<string, FillStats>) {
  return locations.reduce((total, location) => {
    const stats = byLocation.get(location.id) ?? locationFillStats(location);
    return {
      occupied: total.occupied + stats.occupied,
      capacity: total.capacity + stats.capacity,
      disabled: total.disabled + stats.disabled,
      total: total.total + stats.total,
    };
  }, emptyFillStats());
}

function FillBar({ stats, disabled = false }: { stats?: FillStats; disabled?: boolean }) {
  const safeStats = stats ?? emptyFillStats();
  const percent = safeStats.capacity > 0
    ? Math.min(100, Math.round((safeStats.occupied / safeStats.capacity) * 100))
    : 0;
  const hasDisabled = disabled || safeStats.disabled > 0;
  return (
    <div className="flex w-28 shrink-0 items-center gap-1.5 sm:w-36" title={`${safeStats.occupied}/${safeStats.capacity} pallets`}>
      {hasDisabled && <Ban className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-label="Disabled" />}
      <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
        <div
          className={cn("h-full rounded-full", percent >= 100 ? "bg-destructive" : "bg-green-500")}
          style={{ width: `${percent}%` }}
        />
      </div>
      <span className="w-10 shrink-0 text-right font-mono text-[10px] text-muted-foreground">
        {safeStats.occupied}/{safeStats.capacity}
      </span>
    </div>
  );
}

// ─── Visual constants ─────────────────────────────────────────────────────────

const STATUS_CLS: Record<string, string> = {
  blocked: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  maintenance: "bg-blue-500/15 text-blue-700 dark:text-blue-400",
  disabled: "bg-muted text-muted-foreground",
};

const TEMP_CLS: Record<string, string> = {
  cool: "text-blue-600 border-blue-300 dark:text-blue-400",
  frozen: "text-violet-600 border-violet-300 dark:text-violet-400",
};

const TEMP_LABEL: Record<string, string> = { cool: "Cool", frozen: "Frozen" };

// ─── Node components ──────────────────────────────────────────────────────────

/** RACK-BAY-LEVEL prefix for a location code — the scope of one level row. */
function levelPrefixFromLocationCode(code: string | null | undefined): string {
  const display = displayRackLocationCode(code);
  return display ? display.replace(/-P\d+$/i, "") : "";
}

function PositionNode({ location, nodeKey }: { location: LocationRow; nodeKey: string }) {
  const { activeTreeNodeKey, fillStats, selectTreeNode, setDialog, viewContents } = useTCtx();
  const displayCode = displayRackLocationCode(location.code);
  const showContents = () => viewContents({ node: "location", locationPrefix: displayCode, warehouseId: location.warehouse_id });
  const locationDisabled = location.status != null && location.status !== "active";
  return (
    <TreeRowFlyout
      nodeKey={nodeKey}
      menu={(close) => (
        <>
          <TreeRowFlyoutItem onSelect={() => { setDialog({ type: "edit-location", location }); close(); }}>
            <Pencil className="mr-2 h-3.5 w-3.5" />Edit
          </TreeRowFlyoutItem>
          <TreeRowFlyoutItem onSelect={() => { showContents(); close(); }}>
            <PackageSearch className="mr-2 h-3.5 w-3.5" />View Contents
          </TreeRowFlyoutItem>
          <div className="-mx-1 my-1 h-px bg-border" />
          <TreeRowFlyoutItem
            destructive
            onSelect={() => {
              setDialog({
                type: "delete",
                label: `location "${location.code}"`,
                deleteFn: () => deleteLocationCascade(location.id),
              });
              close();
            }}
          >
            <Trash2 className="mr-2 h-3.5 w-3.5" />Delete
          </TreeRowFlyoutItem>
        </>
      )}
    >
        <div
          data-tree-key={nodeKey}
          tabIndex={-1}
          title={TREE_CONTEXT_HINT}
          className={cn(
            "group flex min-h-9 items-center gap-1 rounded-sm px-1 text-sm outline-none transition-shadow hover:bg-accent hover:text-accent-foreground",
            activeTreeNodeKey === nodeKey && "bg-amber-400 text-amber-950 hover:bg-amber-400 hover:text-amber-950",
          )}
          onClick={() => selectTreeNode(nodeKey)}
        >
      <span className="h-3.5 w-3.5 shrink-0" />
      <MapPin className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70" />
      <span className="flex-1 truncate font-mono text-xs">{displayCode}</span>
      <FillBar stats={fillStats.byLocation.get(location.id) ?? locationFillStats(location)} disabled={locationDisabled} />
      {location.status && location.status !== "active" && (
        <Badge variant="outline" className={cn("h-4 shrink-0 px-1 text-[10px]", STATUS_CLS[location.status])}>
          {location.status}
        </Badge>
      )}
      <div className="flex shrink-0 items-center gap-0.5 ">
        <LocationLabelPage
          code={location.code}
          aisle={location.aisle}
          bay={location.bay}
          level={location.level}
          locationType={location.location_type}
          temperatureClass={location.temperature_class ?? undefined}
          trigger={
            <Button variant="ghost" size="icon" className="h-7 w-7">
              <Printer className="h-3.5 w-3.5" />
            </Button>
          }
        />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              aria-label={`Location actions — ${displayCode}`}
            >
              <MoreHorizontal className="h-3.5 w-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-40">
            <DropdownMenuItem onSelect={() => setDialog({ type: "edit-location", location })}>
              <Pencil className="mr-2 h-3.5 w-3.5" />Edit
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={showContents}>
              <PackageSearch className="mr-2 h-3.5 w-3.5" />View Contents
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onSelect={() =>
                setDialog({
                  type: "delete",
                  label: `location "${location.code}"`,
                  deleteFn: () => deleteLocationCascade(location.id),
                })
              }
            >
              <Trash2 className="mr-2 h-3.5 w-3.5" />Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
        </div>
    </TreeRowFlyout>
  );
}

function LevelNode({ levelGroup, nodeKey, bayItems }: { levelGroup: LevelGroup; nodeKey: string; bayItems: LabelSheetItem[] }) {
  const { activeTreeNodeKey, expandedNodes, fillStats, selectTreeNode, toggleNode, viewContents } = useTCtx();
  const isOpen = expandedNodes.has(nodeKey);
  const [printOpen, setPrintOpen] = useState(false);
  const stats = combineFillStats(levelGroup.positions, fillStats.byLocation);
  const firstLevelLocation = levelGroup.positions[0];
  // Level scope = the RACK-BAY-LEVEL prefix every position on this level shares.
  const levelPrefix = levelPrefixFromLocationCode(firstLevelLocation?.code);
  return (
    <TreeRowFlyout
      nodeKey={nodeKey}
      menu={(close) => (
        <>
          <TreeRowFlyoutItem
            disabled={!levelPrefix}
            onSelect={() => {
              viewContents({ node: "level", locationPrefix: levelPrefix, warehouseId: firstLevelLocation?.warehouse_id });
              close();
            }}
          >
            <PackageSearch className="mr-2 h-3.5 w-3.5" />View Contents
          </TreeRowFlyoutItem>
          <TreeRowFlyoutItem disabled={bayItems.length === 0} onSelect={() => { setPrintOpen(true); close(); }}>
            <Printer className="mr-2 h-3.5 w-3.5" />Print parent bay label
          </TreeRowFlyoutItem>
        </>
      )}
    >
      <Collapsible open={isOpen} onOpenChange={() => toggleNode(nodeKey)}>
        <CollapsibleTrigger asChild>
            <div
              data-tree-key={nodeKey}
              tabIndex={-1}
              title={TREE_CONTEXT_HINT}
              className={cn(
                "group flex min-h-9 cursor-pointer items-center gap-1 rounded-sm px-1 text-sm outline-none transition-shadow hover:bg-accent hover:text-accent-foreground",
                activeTreeNodeKey === nodeKey && "bg-amber-400 text-amber-950 hover:bg-amber-400 hover:text-amber-950",
              )}
              onClick={() => selectTreeNode(nodeKey)}
            >
          <ChevronRight className={cn("h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform", isOpen && "rotate-90")} />
          <Layers className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="flex-1 text-xs">Level {levelGroup.displayLevel}</span>
          <FillBar stats={stats} />
          <span className="mr-1 text-xs text-muted-foreground">{levelGroup.positions.length}</span>
            </div>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="ml-4 border-l border-border pl-2">
            {levelGroup.positions.map((loc) => (
              <PositionNode key={loc.id} location={loc} nodeKey={`${nodeKey}:p${loc.id}`} />
            ))}
          </div>
        </CollapsibleContent>
      </Collapsible>
      <BayLocationCodesPrintDialog items={bayItems} open={printOpen} onOpenChange={setPrintOpen} />
    </TreeRowFlyout>
  );
}

function BayNode({
  bayGroup, nodeKey, zone, warehouseName, aisle,
}: {
  bayGroup: BayGroup;
  nodeKey: string;
  zone: ZoneRow;
  warehouseName: string;
  aisle: string;
}) {
  const { activeTreeNodeKey, expandedNodes, fillStats, selectTreeNode, toggleNode, viewContents } = useTCtx();
  const isOpen = expandedNodes.has(nodeKey);
  const [printOpen, setPrintOpen] = useState(false);
  const total = bayGroup.levels.reduce((s, l) => s + l.positions.length, 0);
  const stats = combineFillStats(bayGroup.levels.flatMap((level) => level.positions), fillStats.byLocation);
  const firstLocation = bayGroup.levels.flatMap((level) => level.positions)[0];
  const bayCode = bayCodeFromLocationCode(firstLocation?.code) ?? "";
  const bayItems = useMemo<LabelSheetItem[]>(
    () => bayCode ? [{
      code: bayCode,
      title: `Aisle ${aisle} · Bay ${bayGroup.bay}`,
      subtitle: `${zone.name} · ${warehouseName}`,
      aisle,
      bay: bayGroup.bay,
      temperatureClass: zone.temperature_class,
    }] : [],
    [aisle, bayCode, bayGroup.bay, warehouseName, zone.name, zone.temperature_class],
  );
  return (
    <TreeRowFlyout
      nodeKey={nodeKey}
      menu={(close) => (
        <>
          <TreeRowFlyoutItem
            disabled={!bayCode}
            onSelect={() => {
              viewContents({ node: "bay", locationPrefix: bayCode, warehouseId: zone.warehouse_id });
              close();
            }}
          >
            <PackageSearch className="mr-2 h-3.5 w-3.5" />View Contents
          </TreeRowFlyoutItem>
          <TreeRowFlyoutItem disabled={bayItems.length === 0} onSelect={() => { setPrintOpen(true); close(); }}>
            <Printer className="mr-2 h-3.5 w-3.5" />Print bay label
          </TreeRowFlyoutItem>
        </>
      )}
    >
      <Collapsible open={isOpen} onOpenChange={() => toggleNode(nodeKey)}>
        <CollapsibleTrigger asChild>
            <div
              data-tree-key={nodeKey}
              tabIndex={-1}
              title={TREE_CONTEXT_HINT}
              className={cn(
                "group flex min-h-9 cursor-pointer items-center gap-1 rounded-sm px-1 text-sm outline-none transition-shadow hover:bg-accent hover:text-accent-foreground",
                activeTreeNodeKey === nodeKey && "bg-amber-400 text-amber-950 hover:bg-amber-400 hover:text-amber-950",
              )}
              onClick={() => selectTreeNode(nodeKey)}
            >
          <ChevronRight className={cn("h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform", isOpen && "rotate-90")} />
          <LayoutGrid className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="flex-1 text-xs">Bay {bayGroup.bay}</span>
          <FillBar stats={stats} />
          <span className="mr-1 text-xs text-muted-foreground">{total}</span>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0"
            disabled={bayItems.length === 0}
            title="Print bay code"
            onClick={(event) => {
              event.stopPropagation();
              setPrintOpen(true);
            }}
          >
            <Printer className="h-3.5 w-3.5" />
          </Button>
            </div>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="ml-4 border-l border-border pl-2">
            {bayGroup.levels.map((lg) => (
              <LevelNode key={lg.level} levelGroup={lg} bayItems={bayItems} nodeKey={`${nodeKey}:l${lg.level}`} />
            ))}
          </div>
        </CollapsibleContent>
      </Collapsible>
      <BayLocationCodesPrintDialog items={bayItems} open={printOpen} onOpenChange={setPrintOpen} />
    </TreeRowFlyout>
  );
}

function ZoneNode({
  zone, warehouseName, warehouseCode, nodeKey,
}: {
  zone: ZoneRow;
  warehouseName: string;
  warehouseCode: string;
  nodeKey: string;
}) {
  const { activeTreeNodeKey, expandedNodes, fillStats, selectTreeNode, setDialog, toggleNode, viewContents } = useTCtx();
  const isOpen = expandedNodes.has(nodeKey);
  const zoneLabelCode = prefixedCode(warehouseCode, zone.code);
  const showZoneContents = () => viewContents({ node: "rack", zoneCode: zone.code, warehouseId: zone.warehouse_id });
  const [wizardOpen, setWizardOpen] = useState(false);
  const [printBaysOpen, setPrintBaysOpen] = useState(false);

  const { data: rawLocations = [], isLoading } = useQuery({
    queryKey: ["tree", "locations", zone.id],
    queryFn: () => fetchZoneLocations(zone.id),
    enabled: isOpen,
    staleTime: 60_000,
  });

  const isTruncated = rawLocations.length > 200;
  const aisleGroups = useMemo(
    () => groupIntoTree(isTruncated ? rawLocations.slice(0, 200) : rawLocations),
    [rawLocations, isTruncated],
  );
  const bayItems = useMemo<LabelSheetItem[]>(
    () => aisleGroups.flatMap((aisleGroup) => aisleGroup.bays.flatMap((bayGroup) => {
      const firstLocation = bayGroup.levels.flatMap((level) => level.positions)[0];
      const bayCode = bayCodeFromLocationCode(firstLocation?.code) ?? "";
      return bayCode ? [{
        code: bayCode,
        title: `Bay ${bayGroup.bay}`,
        subtitle: `${zone.name} · ${warehouseName}`,
        aisle: aisleGroup.aisle,
        bay: bayGroup.bay,
        temperatureClass: zone.temperature_class,
      }] : [];
    })),
    [aisleGroups, warehouseName, zone.name, zone.temperature_class],
  );

  return (
    <TreeRowFlyout
      nodeKey={nodeKey}
      menu={(close) => (
        <>
          <TreeRowFlyoutItem onSelect={() => { setDialog({ type: "edit-zone", zone, warehouseName }); close(); }}>
            <Pencil className="mr-2 h-3.5 w-3.5" />Edit Zone
          </TreeRowFlyoutItem>
          <TreeRowFlyoutItem onSelect={() => { showZoneContents(); close(); }}>
            <PackageSearch className="mr-2 h-3.5 w-3.5" />View Contents
          </TreeRowFlyoutItem>
          <TreeRowFlyoutItem onSelect={() => { setDialog({ type: "wizard-zone", warehouseId: zone.warehouse_id, zoneId: zone.id, zoneCode: zone.code }); close(); }}>
            <Plus className="mr-2 h-3.5 w-3.5" />Add Locations
          </TreeRowFlyoutItem>
          <TreeRowFlyoutItem onSelect={() => { setDialog({ type: "edit-range", zone }); close(); }}>
            <Pencil className="mr-2 h-3.5 w-3.5" />Edit Location Range
          </TreeRowFlyoutItem>
          <TreeRowFlyoutItem disabled={bayItems.length === 0} onSelect={() => { setPrintBaysOpen(true); close(); }}>
            <Printer className="mr-2 h-3.5 w-3.5" />Print all bay labels
          </TreeRowFlyoutItem>
          <div className="-mx-1 my-1 h-px bg-border" />
          <TreeRowFlyoutItem destructive onSelect={() => { setDialog({ type: "delete", label: `zone \"${zone.name}\" and all its locations`, deleteFn: () => deleteZoneCascade(zone.id) }); close(); }}>
            <Trash2 className="mr-2 h-3.5 w-3.5" />Delete Zone
          </TreeRowFlyoutItem>
        </>
      )}
    >
    <Collapsible open={isOpen} onOpenChange={() => toggleNode(nodeKey)}>
      <CollapsibleTrigger asChild>
        <div
          data-tree-key={nodeKey}
          tabIndex={-1}
          title={TREE_CONTEXT_HINT}
          className={cn(
            "group flex min-h-9 cursor-pointer items-center gap-1 rounded-sm px-1 text-sm outline-none transition-shadow hover:bg-accent hover:text-accent-foreground",
            activeTreeNodeKey === nodeKey && "bg-amber-400 text-amber-950 hover:bg-amber-400 hover:text-amber-950",
          )}
          onClick={() => selectTreeNode(nodeKey)}
        >
          <ChevronRight className={cn("h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform", isOpen && "rotate-90")} />
          <Boxes className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="flex-1 truncate font-medium">{zone.name}</span>
          <FillBar stats={fillStats.byZone.get(zone.id)} />
          <span className="shrink-0 text-xs text-muted-foreground">{zone.code}</span>
          {TEMP_CLS[zone.temperature_class] && (
            <Badge variant="outline" className={cn("h-4 shrink-0 px-1 text-[10px]", TEMP_CLS[zone.temperature_class])}>
              {TEMP_LABEL[zone.temperature_class]}
            </Badge>
          )}
          {zone.is_staging && <Badge variant="secondary" className="h-4 shrink-0 px-1 text-[10px]">Staging</Badge>}
          {zone.is_dispatch && <Badge variant="secondary" className="h-4 shrink-0 px-1 text-[10px]">Dispatch</Badge>}
          {zone.is_quarantine && <Badge variant="secondary" className="h-4 shrink-0 px-1 text-[10px]">Quarantine</Badge>}
          <div className="flex shrink-0 items-center gap-0.5 ">
            <ZoneLabelPage
              code={zoneLabelCode}
              name={zone.name}
              warehouseName={warehouseName}
              temperatureClass={zone.temperature_class}
              isStaging={zone.is_staging ?? false}
              isDispatch={zone.is_dispatch ?? false}
              isQuarantine={zone.is_quarantine ?? false}
              trigger={
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={(e) => e.stopPropagation()}>
                  <Printer className="h-3.5 w-3.5" />
                </Button>
              }
            />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  aria-label={`Zone actions — ${zone.code}`}
                  onClick={(e) => e.stopPropagation()}
                >
                  <MoreHorizontal className="h-3.5 w-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                <DropdownMenuItem onSelect={() => setDialog({ type: "edit-zone", zone, warehouseName })}>
                  <Pencil className="mr-2 h-3.5 w-3.5" />Edit Zone
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={showZoneContents}>
                  <PackageSearch className="mr-2 h-3.5 w-3.5" />View Contents
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() =>
                    setDialog({
                      type: "wizard-zone",
                      warehouseId: zone.warehouse_id,
                      zoneId: zone.id,
                      zoneCode: zone.code,
                    })
                  }
                >
                  <Plus className="mr-2 h-3.5 w-3.5" />Add Locations
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setDialog({ type: "edit-range", zone })}>
                  <Pencil className="mr-2 h-3.5 w-3.5" />Edit Location Range
                </DropdownMenuItem>
                <DropdownMenuItem disabled={bayItems.length === 0} onSelect={() => setPrintBaysOpen(true)}>
                  <Printer className="mr-2 h-3.5 w-3.5" />Print all bay labels
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onSelect={() =>
                    setDialog({
                      type: "delete",
                      label: `zone "${zone.name}" and all its locations`,
                      deleteFn: () => deleteZoneCascade(zone.id),
                    })
                  }
                >
                  <Trash2 className="mr-2 h-3.5 w-3.5" />Delete Zone
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="ml-4 border-l border-border pl-2">
          {isLoading ? (
            <>
              <Skeleton className="my-1 h-6 w-full" />
              <Skeleton className="my-1 h-6 w-3/4" />
              <Skeleton className="my-1 h-6 w-5/6" />
            </>
          ) : aisleGroups.length === 0 ? (
            <p className="px-1 py-2 text-xs italic text-muted-foreground">No locations</p>
          ) : (
            <>
              {isTruncated && (
                <p className="my-1 rounded-sm bg-amber-500/10 px-2 py-1 text-xs text-amber-700 dark:text-amber-400">
                  Showing 200 of {rawLocations.length}+ — use Bin Locations for bulk management.
                </p>
              )}
              {aisleGroups.flatMap((aisleGroup) => aisleGroup.bays.map((bayGroup) => (
                <BayNode
                  key={`${aisleGroup.aisle}:${bayGroup.bay}`}
                  bayGroup={bayGroup}
                  nodeKey={`${nodeKey}:a${aisleGroup.aisle}:b${bayGroup.bay}`}
                  zone={zone}
                  warehouseName={warehouseName}
                  aisle={aisleGroup.aisle}
                />
              )))}
            </>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
    <BayLocationCodesPrintDialog items={bayItems} open={printBaysOpen} onOpenChange={setPrintBaysOpen} />
    </TreeRowFlyout>
  );
}

function WarehouseLabelPage({
  warehouse,
  trigger,
}: {
  warehouse: WarehouseRow;
  trigger: React.ReactNode;
}) {
  const code = String(warehouse.code ?? "");
  const name = String(warehouse.name ?? code);

  function handlePrint() {
    if (!code) return;
    const qr = renderToStaticMarkup(<QRCodeSVG value={code} size={512} bgColor="#ffffff" fgColor="#000000" level="H" />);
    const win = window.open("", "_blank", "width=520,height=720");
    if (!win) return;
    win.document.write(`<!DOCTYPE html>
<html>
<head>
  <title>Warehouse Label - ${escapeHtml(name)}</title>
  <meta charset="utf-8" />
  <style>
    @page { size: 4in 6in portrait; margin: 0; }
    * { box-sizing: border-box; }
    body { margin: 0; background: #fff; color: #000; font-family: system-ui, -apple-system, sans-serif; }
    .label { width: 4in; height: 6in; border: 1px solid #000; display: grid; grid-template-rows: 1fr auto; align-items: center; justify-items: center; gap: 0.08in; padding: 5px; overflow: hidden; text-align: center; }
    .qr { width: 100%; min-height: 0; display: flex; align-items: center; justify-content: center; }
    .qr svg { width: min(3.86in, 100%); height: min(3.86in, 100%); }
    .code { width: 100%; font-family: 'Arial Black', system-ui, sans-serif; font-size: 34pt; font-weight: 900; line-height: 1; overflow-wrap: anywhere; }
  </style>
</head>
<body>
  <section class="label">
    <div class="qr">${qr}</div>
    <div class="code">${escapeHtml(code)}</div>
  </section>
  <script>window.onload=()=>{window.print();window.close();}<\/script>
</body>
</html>`);
    win.document.close();
  }

  return (
    <Dialog>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Warehouse Label - {code}</DialogTitle>
          <DialogDescription>4 x 6 in Zebra label preview.</DialogDescription>
        </DialogHeader>
        <div className="mx-auto grid aspect-[2/3] w-full max-w-[280px] grid-rows-[1fr_auto] items-center justify-items-center gap-1 border border-black bg-white p-[5px] text-center text-black">
          <div className="flex min-h-0 w-full items-center justify-center">
            <QRCodeSVG value={code} size={255} bgColor="#ffffff" fgColor="#000000" level="H" />
          </div>
          <p className="w-full break-words text-4xl font-black leading-none">{code}</p>
        </div>
        <DialogFooter>
          <Button onClick={handlePrint} className="w-full">
            <Printer className="mr-2 h-4 w-4" />
            Print Warehouse Label
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function WarehouseNode({ warehouse, nodeKey }: { warehouse: WarehouseRow; nodeKey: string }) {
  const { activeTreeNodeKey, expandedNodes, fillStats, selectTreeNode, toggleNode, setDialog, zones } = useTCtx();
  const isOpen = expandedNodes.has(nodeKey);
  const warehouseDisabled = warehouse.active === false;

  const warehouseZones = useMemo(
    () => zones.filter((z) => z.warehouse_id === warehouse.id),
    [zones, warehouse.id],
  );

  return (
    <TreeRowFlyout
      nodeKey={nodeKey}
      menu={(close) => (
        <>
          <TreeRowFlyoutItem onSelect={() => { setDialog({ type: "edit-warehouse", warehouse }); close(); }}>
            <Pencil className="mr-2 h-3.5 w-3.5" />Edit Warehouse
          </TreeRowFlyoutItem>
          <TreeRowFlyoutItem onSelect={() => { setDialog({ type: "add-warehouse" }); close(); }}>
            <Plus className="mr-2 h-3.5 w-3.5" />Add Warehouse
          </TreeRowFlyoutItem>
          <TreeRowFlyoutItem onSelect={() => { setDialog({ type: "add-zone", warehouseId: warehouse.id, warehouseName: warehouse.name }); close(); }}>
            <Plus className="mr-2 h-3.5 w-3.5" />Add Zone
          </TreeRowFlyoutItem>
          <TreeRowFlyoutItem onSelect={() => { setDialog({ type: "reorder-settings" }); close(); }}>
            <AlertTriangle className="mr-2 h-3.5 w-3.5" />Reorder Settings
          </TreeRowFlyoutItem>
          <div className="-mx-1 my-1 h-px bg-border" />
          <TreeRowFlyoutItem destructive onSelect={() => { setDialog({ type: "delete", label: `warehouse \"${warehouse.name}\" and all its zones and locations`, deleteFn: () => deleteWarehouseCascade(warehouse.id) }); close(); }}>
            <Trash2 className="mr-2 h-3.5 w-3.5" />Delete Warehouse
          </TreeRowFlyoutItem>
        </>
      )}
    >
    <Collapsible open={isOpen} onOpenChange={() => toggleNode(nodeKey)}>
      <CollapsibleTrigger asChild>
        <div
          data-tree-key={nodeKey}
          tabIndex={-1}
          title={TREE_CONTEXT_HINT}
          className={cn(
            "group flex min-h-10 cursor-pointer items-center gap-1.5 rounded-md px-1.5 text-sm font-medium outline-none transition-shadow hover:bg-accent hover:text-accent-foreground",
            activeTreeNodeKey === nodeKey && "bg-amber-400 text-amber-950 hover:bg-amber-400 hover:text-amber-950",
          )}
          onClick={() => selectTreeNode(nodeKey)}
        >
          <ChevronRight className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", isOpen && "rotate-90")} />
          <Building2 className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="flex-1 truncate">{warehouse.name}</span>
          <FillBar stats={fillStats.byWarehouse.get(warehouse.id)} disabled={warehouseDisabled} />
          <span className="font-mono text-xs text-muted-foreground">{warehouse.code}</span>
          {warehouse.active === false && (
            <Badge variant="secondary" className="h-4 px-1 text-[10px]">Inactive</Badge>
          )}
          <div className="flex shrink-0 items-center gap-0.5 ">
            <WarehouseLabelPage
              warehouse={warehouse}
              trigger={
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={(e) => e.stopPropagation()}>
                  <Printer className="h-4 w-4" />
                </Button>
              }
            />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  aria-label={`Warehouse actions — ${warehouse.code}`}
                  onClick={(e) => e.stopPropagation()}
                >
                  <MoreHorizontal className="h-3.5 w-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                <DropdownMenuItem onSelect={() => setDialog({ type: "edit-warehouse", warehouse })}>
                  <Pencil className="mr-2 h-3.5 w-3.5" />Edit Warehouse
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setDialog({ type: "add-warehouse" })}>
                  <Plus className="mr-2 h-3.5 w-3.5" />Add Warehouse
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() =>
                    setDialog({ type: "add-zone", warehouseId: warehouse.id, warehouseName: warehouse.name })
                  }
                >
                  <Plus className="mr-2 h-3.5 w-3.5" />Add Zone
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setDialog({ type: "reorder-settings" })}>
                  <AlertTriangle className="mr-2 h-3.5 w-3.5" />Reorder Settings
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onSelect={() =>
                    setDialog({
                      type: "delete",
                      label: `warehouse "${warehouse.name}" and all its zones and locations`,
                      deleteFn: () => deleteWarehouseCascade(warehouse.id),
                    })
                  }
                >
                  <Trash2 className="mr-2 h-3.5 w-3.5" />Delete Warehouse
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="ml-5 border-l border-border pl-2">
          {warehouseZones.length === 0 ? (
            <p className="px-1 py-2 text-xs italic text-muted-foreground">No zones</p>
          ) : (
            warehouseZones.map((zone) => (
              <ZoneNode
                key={zone.id}
                zone={zone}
                warehouseName={warehouse.name}
                warehouseCode={warehouse.code}
                nodeKey={`${nodeKey}:z${zone.id}`}
              />
            ))
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
    </TreeRowFlyout>
  );
}

// ─── Form dialogs ─────────────────────────────────────────────────────────────

const warehouseSchema = z.object({
  code: z.string().min(1, "Required"),
  name: z.string().min(1, "Required"),
  city: z.string().optional(),
  country: z.string().optional(),
  has_cool_zone: z.boolean().optional(),
  active: z.boolean().optional(),
});
type WarehouseFormValues = z.infer<typeof warehouseSchema>;

function AddEditWarehouseDialog({ warehouse, onClose }: { warehouse?: WarehouseRow; onClose: () => void }) {
  const queryClient = useQueryClient();
  const form = useForm<WarehouseFormValues>({
    resolver: zodResolver(warehouseSchema),
    defaultValues: {
      code: warehouse?.code ?? "",
      name: warehouse?.name ?? "",
      city: warehouse?.city ?? "",
      country: warehouse?.country ?? "",
      has_cool_zone: warehouse?.has_cool_zone ?? false,
      active: warehouse?.active !== false,
    },
  });
  const mutation = useMutation({
    mutationFn: (v: WarehouseFormValues) => upsertRecord("warehouses", { ...(warehouse ? { id: warehouse.id } : {}), ...v }),
    onSuccess: () => {
      toast.success(warehouse ? "Warehouse updated" : "Warehouse created");
      void queryClient.invalidateQueries({ queryKey: ["tree", "warehouses"] });
      void queryClient.invalidateQueries({ queryKey: ["warehouses"] });
      void queryClient.invalidateQueries({ queryKey: ["header-warehouse-options"] });
      onClose();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Save failed"),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{warehouse ? "Edit Warehouse" : "Add Warehouse"}</DialogTitle>
          <DialogDescription>
            {warehouse ? "Update warehouse details and availability." : "Create a warehouse record for zones and locations."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))} className="grid gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>Code *</Label>
              <Input {...form.register("code")} />
              {form.formState.errors.code && <p className="text-xs text-destructive">{form.formState.errors.code.message}</p>}
            </div>
            <div className="grid gap-1.5">
              <Label>Name *</Label>
              <Input {...form.register("name")} />
              {form.formState.errors.name && <p className="text-xs text-destructive">{form.formState.errors.name.message}</p>}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>City</Label>
              <Input {...form.register("city")} />
            </div>
            <div className="grid gap-1.5">
              <Label>Country</Label>
              <Input {...form.register("country")} />
            </div>
          </div>
          <div className="flex gap-6">
            <div className="flex items-center gap-2">
              <Switch id="wh-cool" checked={form.watch("has_cool_zone") ?? false} onCheckedChange={(v) => form.setValue("has_cool_zone", v)} />
              <Label htmlFor="wh-cool">Has cool zone</Label>
            </div>
            <div className="flex items-center gap-2">
              <Switch id="wh-active" checked={form.watch("active") ?? true} onCheckedChange={(v) => form.setValue("active", v)} />
              <Label htmlFor="wh-active">Active</Label>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
              {warehouse ? "Save" : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const locationSchema = z.object({
  code: z.string().min(1, "Required"),
  aisle: z.string().optional(),
  bay: z.string().optional(),
  level: z.coerce.number().nullable().optional(),
  position: z.coerce.number().nullable().optional(),
  depth: z.coerce.number().nullable().optional(),
  location_type: z.string().min(1, "Required"),
  temperature_class: z.string().min(1, "Required"),
  max_pallets: z.coerce.number().min(0),
  pick_sequence: z.coerce.number().nullable().optional(),
  putaway_sequence: z.coerce.number().nullable().optional(),
  mixed_sku_allowed: z.boolean(),
  mixed_lot_allowed: z.boolean(),
  max_height: z.coerce.number().nullable().optional(),
  status: z.string().min(1, "Required"),
  notes: z.string().optional(),
});
type LocationFormValues = z.infer<typeof locationSchema>;

function nullableNumber(value: number | string | null | undefined) {
  return value == null || value === "" ? null : Number(value);
}

function EditLocationDialog({ location, onClose }: { location: LocationRow; onClose: () => void }) {
  const queryClient = useQueryClient();
  const form = useForm<LocationFormValues>({
    resolver: zodResolver(locationSchema),
    defaultValues: {
      code: location.code,
      aisle: location.aisle ?? "",
      bay: location.bay ?? "",
      level: location.level ?? null,
      position: nullableNumber(location.position),
      depth: location.depth ?? null,
      location_type: location.location_type ?? "rack",
      temperature_class: location.temperature_class ?? "ambient",
      max_pallets: location.max_pallets ?? 1,
      pick_sequence: location.pick_sequence ?? null,
      putaway_sequence: location.putaway_sequence ?? null,
      mixed_sku_allowed: location.mixed_sku_allowed ?? false,
      mixed_lot_allowed: location.mixed_lot_allowed ?? false,
      max_height: location.max_height ?? null,
      status: location.status ?? "active",
      notes: location.notes ?? "",
    },
  });
  const mutation = useMutation({
    mutationFn: (values: LocationFormValues) => updateRecord("locations", location.id, {
      code: values.code,
      aisle: values.aisle || null,
      bay: values.bay || null,
      level: nullableNumber(values.level),
      position: nullableNumber(values.position),
      depth: nullableNumber(values.depth),
      location_type: values.location_type,
      temperature_class: values.temperature_class,
      max_pallets: Number(values.max_pallets),
      pick_sequence: nullableNumber(values.pick_sequence),
      putaway_sequence: nullableNumber(values.putaway_sequence),
      mixed_sku_allowed: values.mixed_sku_allowed,
      mixed_lot_allowed: values.mixed_lot_allowed,
      max_height: nullableNumber(values.max_height),
      status: values.status,
      notes: values.notes || null,
    }),
    onSuccess: () => {
      toast.success("Location updated");
      void queryClient.invalidateQueries({ queryKey: ["tree", "locations", location.zone_id] });
      void queryClient.invalidateQueries({ queryKey: ["locations"] });
      onClose();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Update failed"),
  });

  function submit(values: LocationFormValues) {
    if ((values.status === "disabled" || values.status === "maintenance") && !values.notes) {
      toast.error("Add a reason in Notes before marking this location unavailable.");
      return;
    }
    mutation.mutate(values);
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Edit Location</DialogTitle>
          <DialogDescription>{location.code}</DialogDescription>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(submit)} className="grid gap-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label>Code *</Label>
              <Input {...form.register("code")} />
              {form.formState.errors.code && <p className="text-xs text-destructive">{form.formState.errors.code.message}</p>}
            </div>
            <div className="grid gap-1.5">
              <Label>Status</Label>
              <Select value={form.watch("status")} onValueChange={(v) => form.setValue("status", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="blocked">Blocked</SelectItem>
                  <SelectItem value="maintenance">Maintenance</SelectItem>
                  <SelectItem value="disabled">Disabled</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="grid gap-1.5"><Label>Aisle</Label><Input {...form.register("aisle")} /></div>
            <div className="grid gap-1.5"><Label>Bay</Label><Input {...form.register("bay")} /></div>
            <div className="grid gap-1.5"><Label>Level</Label><Input type="number" {...form.register("level")} /></div>
            <div className="grid gap-1.5"><Label>Position</Label><Input type="number" {...form.register("position")} /></div>
            <div className="grid gap-1.5"><Label>Depth</Label><Input type="number" {...form.register("depth")} /></div>
            <div className="grid gap-1.5"><Label>Max pallets</Label><Input type="number" {...form.register("max_pallets")} /></div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label>Type</Label>
              <Select value={form.watch("location_type")} onValueChange={(v) => form.setValue("location_type", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="rack">Rack</SelectItem>
                  <SelectItem value="staging">Staging</SelectItem>
                  <SelectItem value="quarantine">Quarantine</SelectItem>
                  <SelectItem value="dispatch">Dispatch</SelectItem>
                  <SelectItem value="receiving">Receiving</SelectItem>
                  <SelectItem value="floor">Floor</SelectItem>
                  <SelectItem value="returns">Returns</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>Temperature</Label>
              <Select value={form.watch("temperature_class")} onValueChange={(v) => form.setValue("temperature_class", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ambient">Ambient</SelectItem>
                  <SelectItem value="cool">Cool</SelectItem>
                  <SelectItem value="frozen">Frozen</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="grid gap-1.5"><Label>Pick seq</Label><Input type="number" {...form.register("pick_sequence")} /></div>
            <div className="grid gap-1.5"><Label>Put-Away seq</Label><Input type="number" {...form.register("putaway_sequence")} /></div>
            <div className="grid gap-1.5"><Label>Max height (cm)</Label><Input type="number" {...form.register("max_height")} /></div>
          </div>
          <div className="flex flex-wrap gap-6">
            <div className="flex items-center gap-2">
              <Switch id="loc-mixed-sku" checked={form.watch("mixed_sku_allowed")} onCheckedChange={(v) => form.setValue("mixed_sku_allowed", v)} />
              <Label htmlFor="loc-mixed-sku">Mixed SKU</Label>
            </div>
            <div className="flex items-center gap-2">
              <Switch id="loc-mixed-lot" checked={form.watch("mixed_lot_allowed")} onCheckedChange={(v) => form.setValue("mixed_lot_allowed", v)} />
              <Label htmlFor="loc-mixed-lot">Mixed lot</Label>
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label>Notes</Label>
            <Textarea rows={3} {...form.register("notes")} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}Save changes
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const zoneSchema = z.object({
  code: z.string().min(1, "Required"),
  name: z.string().min(1, "Required"),
  temperature_class: z.string().min(1, "Required"),
  is_staging: z.boolean(),
  is_dispatch: z.boolean(),
  is_quarantine: z.boolean(),
});
type ZoneFormValues = z.infer<typeof zoneSchema>;

function AddEditZoneDialog({
  warehouseId, warehouseName, zone, onClose,
}: {
  warehouseId: string; warehouseName: string; zone?: ZoneRow; onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const form = useForm<ZoneFormValues>({
    resolver: zodResolver(zoneSchema),
    defaultValues: zone
      ? { code: zone.code, name: zone.name, temperature_class: zone.temperature_class, is_staging: zone.is_staging ?? false, is_dispatch: zone.is_dispatch ?? false, is_quarantine: zone.is_quarantine ?? false }
      : { code: "", name: "", temperature_class: "ambient", is_staging: false, is_dispatch: false, is_quarantine: false },
  });
  const mutation = useMutation({
    mutationFn: (v: ZoneFormValues) =>
      upsertRecord("zones", { ...(zone ? { id: zone.id } : {}), warehouse_id: warehouseId, ...v }),
    onSuccess: () => {
      toast.success(zone ? "Zone updated" : "Zone created");
      void queryClient.invalidateQueries({ queryKey: ["tree", "zones"] });
      void queryClient.invalidateQueries({ queryKey: ["zones"] });
      onClose();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Save failed"),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{zone ? "Edit Zone" : "Add Zone"}</DialogTitle>
          <DialogDescription>Warehouse: {warehouseName}</DialogDescription>
        </DialogHeader>
        <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))} className="grid gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>Code *</Label>
              <Input {...form.register("code")} />
              {form.formState.errors.code && <p className="text-xs text-destructive">{form.formState.errors.code.message}</p>}
            </div>
            <div className="grid gap-1.5">
              <Label>Name *</Label>
              <Input {...form.register("name")} />
              {form.formState.errors.name && <p className="text-xs text-destructive">{form.formState.errors.name.message}</p>}
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label>Temperature</Label>
            <Select value={form.watch("temperature_class")} onValueChange={(v) => form.setValue("temperature_class", v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ambient">Ambient</SelectItem>
                <SelectItem value="cool">Cool (2–8 °C)</SelectItem>
                <SelectItem value="frozen">Frozen (−20 °C)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-wrap gap-6">
            {(["is_staging", "is_dispatch", "is_quarantine"] as const).map((field) => (
              <div key={field} className="flex items-center gap-2">
                <Switch id={`z-${field}`} checked={form.watch(field)} onCheckedChange={(v) => form.setValue(field, v)} />
                <Label htmlFor={`z-${field}`}>
                  {field === "is_staging" ? "Staging" : field === "is_dispatch" ? "Dispatch" : "Quarantine"}
                </Label>
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
              {zone ? "Save" : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EditLocationRangeDialog({ zone, onClose }: { zone: ZoneRow; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { data: locations = [], isLoading } = useQuery({
    queryKey: ["zone-locations", zone.id],
    queryFn: () => fetchZoneLocations(zone.id),
  });

  const prefixes = useMemo(() => {
    const set = new Set<string>();
    for (const l of locations) if (l.aisle) set.add(l.aisle);
    return [...set].sort();
  }, [locations]);

  const [prefix, setPrefix] = useState<string>("__all__");
  const [updateType, setUpdateType] = useState(false);
  const [locationType, setLocationType] = useState<string>("rack");
  const [updateTemp, setUpdateTemp] = useState(false);
  const [temperatureClass, setTemperatureClass] = useState<string>(zone.temperature_class ?? "ambient");
  const [updateStatus, setUpdateStatus] = useState(false);
  const [statusValue, setStatusValue] = useState<string>("active");
  const [updateDepth, setUpdateDepth] = useState(false);
  const [depth, setDepth] = useState<number>(1);
  const [updateMixedSku, setUpdateMixedSku] = useState(false);
  const [mixedSku, setMixedSku] = useState(false);
  const [updateMixedLot, setUpdateMixedLot] = useState(false);
  const [mixedLot, setMixedLot] = useState(false);

  const targets = useMemo(() => {
    if (prefix === "__all__") return locations;
    return locations.filter((l) => (l.aisle ?? "") === prefix);
  }, [locations, prefix]);

  const mutation = useMutation({
    mutationFn: async () => {
      const patch: Record<string, unknown> = {};
      if (updateType) patch.location_type = locationType;
      if (updateTemp) patch.temperature_class = temperatureClass;
      if (updateStatus) patch.status = statusValue;
      if (updateDepth) { patch.depth = depth; patch.max_pallets = depth; }
      if (updateMixedSku) patch.mixed_sku_allowed = mixedSku;
      if (updateMixedLot) patch.mixed_lot_allowed = mixedLot;
      if (Object.keys(patch).length === 0) {
        throw new Error("Select at least one field to update");
      }
      let updated = 0;
      for (const l of targets) {
        await updateRecord("locations", l.id, patch);
        updated += 1;
      }
      return updated;
    },
    onSuccess: async (count) => {
      toast.success(`Updated ${count} location${count !== 1 ? "s" : ""}`);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["zone-locations", zone.id] }),
        queryClient.invalidateQueries({ queryKey: ["locations"] }),
        queryClient.invalidateQueries({ queryKey: ["tree"] }),
      ]);
      onClose();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Update failed"),
  });

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !mutation.isPending) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit Location Range — {zone.name}</DialogTitle>
          <DialogDescription>
            Bulk-update properties for every location in this zone (or a single rack prefix). Codes themselves are not changed.
          </DialogDescription>
        </DialogHeader>
        {isLoading ? (
          <div className="grid gap-2"><Skeleton className="h-9 w-full" /><Skeleton className="h-9 w-full" /></div>
        ) : (
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label>Rack prefix</Label>
              <Select value={prefix} onValueChange={setPrefix}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All prefixes ({locations.length})</SelectItem>
                  {prefixes.map((p) => (
                    <SelectItem key={p} value={p}>
                      {p} ({locations.filter((l) => l.aisle === p).length})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Will affect <strong>{targets.length}</strong> location{targets.length !== 1 ? "s" : ""}.
              </p>
            </div>

            <div className="grid gap-2 rounded-md border p-3">
              <div className="flex items-center gap-2">
                <Switch id="er-type" checked={updateType} onCheckedChange={setUpdateType} />
                <Label htmlFor="er-type">Change type</Label>
              </div>
              {updateType && (
                <Select value={locationType} onValueChange={setLocationType}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {["rack","staging","quarantine","dispatch","receiving","floor","returns"].map((v) => (
                      <SelectItem key={v} value={v}>{v}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            <div className="grid gap-2 rounded-md border p-3">
              <div className="flex items-center gap-2">
                <Switch id="er-temp" checked={updateTemp} onCheckedChange={setUpdateTemp} />
                <Label htmlFor="er-temp">Change temperature class</Label>
              </div>
              {updateTemp && (
                <Select value={temperatureClass} onValueChange={setTemperatureClass}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ambient">Ambient</SelectItem>
                    <SelectItem value="cool">Cool</SelectItem>
                    <SelectItem value="frozen">Frozen</SelectItem>
                  </SelectContent>
                </Select>
              )}
            </div>

            <div className="grid gap-2 rounded-md border p-3">
              <div className="flex items-center gap-2">
                <Switch id="er-status" checked={updateStatus} onCheckedChange={setUpdateStatus} />
                <Label htmlFor="er-status">Change status</Label>
              </div>
              {updateStatus && (
                <Select value={statusValue} onValueChange={setStatusValue}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {["active","blocked","maintenance","disabled"].map((v) => (
                      <SelectItem key={v} value={v}>{v}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            <div className="grid gap-2 rounded-md border p-3">
              <div className="flex items-center gap-2">
                <Switch id="er-depth" checked={updateDepth} onCheckedChange={setUpdateDepth} />
                <Label htmlFor="er-depth">Change depth / capacity (1–5)</Label>
              </div>
              {updateDepth && (
                <Input type="number" min={1} max={5} value={depth} onChange={(e) => setDepth(Number(e.target.value))} />
              )}
            </div>

            <div className="grid gap-2 rounded-md border p-3 sm:grid-cols-2">
              <div className="flex items-center gap-2">
                <Switch id="er-msku" checked={updateMixedSku} onCheckedChange={setUpdateMixedSku} />
                <Label htmlFor="er-msku">Set mixed SKU</Label>
                {updateMixedSku && (
                  <Switch aria-label="Mixed SKU value" checked={mixedSku} onCheckedChange={setMixedSku} />
                )}
              </div>
              <div className="flex items-center gap-2">
                <Switch id="er-mlot" checked={updateMixedLot} onCheckedChange={setUpdateMixedLot} />
                <Label htmlFor="er-mlot">Set mixed lot</Label>
                {updateMixedLot && (
                  <Switch aria-label="Mixed lot value" checked={mixedLot} onCheckedChange={setMixedLot} />
                )}
              </div>
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={mutation.isPending}>Cancel</Button>
          <Button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending || targets.length === 0}
            aria-busy={mutation.isPending}
          >
            {mutation.isPending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
            Apply to {targets.length}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ConfirmDeleteDialog({
  label, deleteFn, onClose,
}: {
  label: string;
  deleteFn: () => Promise<CascadeDeleteResult>;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [blockers, setBlockers] = useState<Array<{ table: string; count: number }> | null>(null);
  const mutation = useMutation({
    mutationFn: deleteFn,
    onSuccess: async (result) => {
      if (result.ok) {
        toast.success("Deleted");
        await queryClient.invalidateQueries({ queryKey: ["tree"] });
        await queryClient.invalidateQueries({ queryKey: ["warehouses"] });
        await queryClient.invalidateQueries({ queryKey: ["zones"] });
        await queryClient.invalidateQueries({ queryKey: ["locations"] });
        onClose();
      } else {
        setBlockers(result.blocked_by);
      }
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Delete failed"),
  });
  return (
    <Dialog open onOpenChange={(o) => { if (!o && !mutation.isPending) onClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Delete {label}?</DialogTitle>
          <DialogDescription>This action cannot be undone. All child records will be permanently deleted.</DialogDescription>
        </DialogHeader>
        {blockers && (
          <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
            <p className="mb-1 font-medium">Cannot delete — records still reference this:</p>
            <ul className="list-disc pl-4">
              {blockers.map((b) => (
                <li key={b.table}>{b.count} record{b.count !== 1 ? "s" : ""} in {b.table}</li>
              ))}
            </ul>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={mutation.isPending}>Cancel</Button>
          {!blockers && (
            <Button variant="destructive" onClick={() => mutation.mutate()} disabled={mutation.isPending}>
              {mutation.isPending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}Delete
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main export ──────────────────────────────────────────────────────────────

export function WarehouseStructureTab() {
  const navigate = useNavigate();
  const { toPath } = useTenantPath();
  const { profile, roles } = useAuth();

  const LS_KEY = "wms-tree-expanded";
  const activeWarehouseId = profile?.default_warehouse_id;

  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) return new Set(JSON.parse(raw) as string[]);
    } catch { /* ignore */ }
    return new Set<string>();
  });

  const [filter, setFilter] = useState("");
  const [dialog, setDialog] = useState<ActiveDialog>(null);
  const [activeTreeNodeKey, setActiveTreeNodeKey] = useState<string | null>(null);

  const toggleNode = useCallback((key: string) => {
    setExpandedNodes((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      try { localStorage.setItem(LS_KEY, JSON.stringify([...next])); } catch { /* ignore */ }
      return next;
    });
  }, []);

  const { data: warehouses = [], isLoading: wLoading } = useQuery({
    queryKey: ["tree", "warehouses"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("warehouses")
        .select("id, code, name, city, country, has_cool_zone, active")
        .order("code");
      if (error) throw error;
      return (data ?? []) as WarehouseRow[];
    },
  });

  const { data: zones = [], isLoading: zLoading } = useQuery({
    queryKey: ["tree", "zones"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("zones")
        .select("id, code, name, warehouse_id, temperature_class, is_staging, is_dispatch, is_quarantine")
        .eq("is_hidden", false)
        .order("code");
      if (error) throw error;
      return (data ?? []) as ZoneRow[];
    },
  });

  const { data: fillStats = { byWarehouse: new Map(), byZone: new Map(), byLocation: new Map() }, isLoading: fillLoading } = useQuery({
    queryKey: ["tree", "fill-stats"],
    queryFn: fetchLocationFillStats,
    staleTime: 30_000,
  });

  const { data: searchLocations = [] } = useQuery({
    queryKey: ["tree", "search-locations"],
    queryFn: fetchTreeSearchLocations,
    staleTime: 60_000,
  });

  // Settings opens on Warehouse Structure, so expose the top-level layout
  // immediately instead of making operators rediscover each warehouse.
  const hasAutoExpandedRef = useRef(false);
  useEffect(() => {
    if (hasAutoExpandedRef.current) return;
    if (warehouses.length === 0) return;
    setExpandedNodes((prev) => {
      const next = new Set(prev);
      for (const warehouse of warehouses) next.add(`w${warehouse.id}`);
      try { localStorage.setItem(LS_KEY, JSON.stringify([...next])); } catch { /* ignore */ }
      return next;
    });
    hasAutoExpandedRef.current = true;
  }, [warehouses]);

  const isLoading = wLoading || zLoading || fillLoading;

  const zonesById = useMemo(() => new Map(zones.map((zone) => [zone.id, zone])), [zones]);
  const warehousesById = useMemo(() => new Map(warehouses.map((warehouse) => [warehouse.id, warehouse])), [warehouses]);

  const filteredWarehouses = useMemo(() => {
    const normalized = normalizeTreeSearch(filter);
    if (!normalized) return warehouses;
    const warehouseIds = new Set<string>();

    for (const warehouse of warehouses) {
      if ([warehouse.code, warehouse.name, warehouse.city, warehouse.country].some((value) => normalizeTreeSearch(value).includes(normalized))) {
        warehouseIds.add(warehouse.id);
      }
    }

    for (const zone of zones) {
      if ([zone.code, zone.name].some((value) => normalizeTreeSearch(value).includes(normalized))) {
        warehouseIds.add(zone.warehouse_id);
      }
    }

    for (const location of searchLocations) {
      const warehouse = warehousesById.get(location.warehouse_id);
      const zone = zonesById.get(location.zone_id);
      const tokens = [
        location.code,
        displayRackLocationCode(location.code),
        bayCodeFromLocationCode(location.code),
        location.aisle,
        location.bay,
        location.level,
        location.position,
        warehouse?.code,
        warehouse?.name,
        zone?.code,
        zone?.name,
        warehouse && zone && location.aisle && location.bay ? `${warehouse.code}-${zone.code}-${location.aisle}-${location.bay}` : "",
        location.aisle && location.bay ? `${location.aisle}-${location.bay}` : "",
      ];
      if (tokens.some((value) => normalizeTreeSearch(value).includes(normalized))) {
        warehouseIds.add(location.warehouse_id);
      }
    }

    return warehouses.filter((warehouse) => warehouseIds.has(warehouse.id));
  }, [filter, searchLocations, warehouses, warehousesById, zones, zonesById]);

  function expandAndTargetLocation(location: TreeSearchLocation, target: "bay" | "location") {
    const warehouseKey = `w${location.warehouse_id}`;
    const zoneKey = `${warehouseKey}:z${location.zone_id}`;
    const aisleKey = `${zoneKey}:a${location.aisle ?? "—"}`;
    const bayKey = `${aisleKey}:b${location.bay ?? "—"}`;
    const levelKey = `${bayKey}:l${location.level != null ? String(location.level) : "—"}`;
    const locationKey = `${levelKey}:p${location.id}`;
    const keys = target === "bay"
      ? [warehouseKey, zoneKey, aisleKey]
      : [warehouseKey, zoneKey, aisleKey, bayKey, levelKey];
    setExpandedNodes((prev) => {
      const next = new Set(prev);
      for (const key of keys) next.add(key);
      try { localStorage.setItem(LS_KEY, JSON.stringify([...next])); } catch { /* ignore */ }
      return next;
    });
    scrollToTreeNodeWhenReady(target === "bay" ? bayKey : locationKey);
  }

  function commitSearch() {
    const normalized = normalizeTreeSearch(filter);
    if (!normalized) return;
    const exactLocation = searchLocations.find((location) =>
      [location.code, displayRackLocationCode(location.code)].some((value) => normalizeTreeSearch(value) === normalized),
    );
    if (exactLocation) {
      expandAndTargetLocation(exactLocation, "location");
      return;
    }

    const exactBay = searchLocations.find((location) => {
      const warehouse = warehousesById.get(location.warehouse_id);
      const zone = zonesById.get(location.zone_id);
      const tokens = [
        bayCodeFromLocationCode(location.code),
        location.aisle && location.bay ? `${location.aisle}-${location.bay}` : "",
        warehouse && zone && location.aisle && location.bay ? `${warehouse.code}-${zone.code}-${location.aisle}-${location.bay}` : "",
        warehouse && zone && location.aisle && location.bay ? `BAY:${warehouse.code}:${zone.code}:${location.aisle}:${location.bay}` : "",
      ];
      return tokens.some((value) => normalizeTreeSearch(value) === normalized);
    });
    if (exactBay) expandAndTargetLocation(exactBay, "bay");
  }
  const viewContents = useCallback<TreeCtxValue["viewContents"]>(
    ({ node, zoneCode, locationPrefix, warehouseId }) => {
      const params = new URLSearchParams();
      if (locationPrefix) params.set("loc", locationPrefix);
      else if (zoneCode) params.set("zone", zoneCode);
      params.set("node", node);
      if (warehouseId) params.set("warehouse", warehouseId);
      navigate(toPath(`/inventory-search?${params.toString()}`));
    },
    [navigate, toPath],
  );

  const ctx = useMemo<TreeCtxValue>(
    () => ({
      expandedNodes,
      toggleNode,
      activeTreeNodeKey,
      selectTreeNode: setActiveTreeNodeKey,
      setDialog,
      warehouses,
      zones,
      navigate,
      viewContents,
      fillStats,
    }),
    [activeTreeNodeKey, expandedNodes, toggleNode, warehouses, zones, navigate, viewContents, fillStats],
  );

  return (
    <TreeCtx.Provider value={ctx}>
      <div className="flex h-full min-h-0 flex-col gap-4">
        <div className="flex items-center gap-2">
          <div className="relative max-w-xs flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search warehouses…"
              className="h-8 pl-8 text-sm"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  commitSearch();
                }
              }}
            />
          </div>
          <Button
            variant="ghost" size="sm"
            className="h-8 gap-1.5 text-xs"
            onClick={() => setExpandedNodes(new Set())}
          >
            <ChevronsDownUp className="h-3.5 w-3.5" />Collapse all
          </Button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto pr-1">
          {isLoading ? (
            <div className="grid gap-1">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-3/4" />
            </div>
          ) : filteredWarehouses.length === 0 ? (
            <div className="rounded-md border border-dashed p-8 text-center">
              <Building2 className="mx-auto mb-2 h-8 w-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                {filter ? "No warehouses match your search." : "No warehouses configured yet."}
              </p>
            </div>
          ) : (
            <div className="grid gap-0.5">
              {filteredWarehouses.map((wh) => (
                <WarehouseNode key={wh.id} warehouse={wh} nodeKey={`w${wh.id}`} />
              ))}
            </div>
          )}
        </div>
      </div>

      {dialog?.type === "add-warehouse" && (
        <AddEditWarehouseDialog onClose={() => setDialog(null)} />
      )}
      {dialog?.type === "edit-warehouse" && (
        <AddEditWarehouseDialog warehouse={dialog.warehouse} onClose={() => setDialog(null)} />
      )}
      {dialog?.type === "add-zone" && (
        <AddEditZoneDialog warehouseId={dialog.warehouseId} warehouseName={dialog.warehouseName} onClose={() => setDialog(null)} />
      )}
      {dialog?.type === "edit-zone" && (
        <AddEditZoneDialog warehouseId={dialog.zone.warehouse_id} warehouseName={dialog.warehouseName} zone={dialog.zone} onClose={() => setDialog(null)} />
      )}
      {dialog?.type === "edit-location" && (
        <EditLocationDialog location={dialog.location} onClose={() => setDialog(null)} />
      )}
      {dialog?.type === "wizard-zone" && (
        <LocationWizardDialog
          open
          trigger={null}
          defaultWarehouseId={dialog.warehouseId}
          defaultZoneId={dialog.zoneId}
          onOpenChange={(o) => !o && setDialog(null)}
        />
      )}
      {dialog?.type === "edit-range" && (
        <EditLocationRangeDialog zone={dialog.zone} onClose={() => setDialog(null)} />
      )}
      {dialog?.type === "reorder-settings" && (
        <Dialog open onOpenChange={(open) => !open && setDialog(null)}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Reorder Settings</DialogTitle>
              <DialogDescription>Configure forecasting rules for products in this warehouse environment.</DialogDescription>
            </DialogHeader>
            <ReorderForecastSettingsPanel isAdmin={roles.some((role) => ["developer", "admin"].includes(role))} />
          </DialogContent>
        </Dialog>
      )}
      {dialog?.type === "delete" && (
        <ConfirmDeleteDialog label={dialog.label} deleteFn={dialog.deleteFn} onClose={() => setDialog(null)} />
      )}
    </TreeCtx.Provider>
  );
}
