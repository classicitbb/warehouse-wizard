// Warehouse structure tree: shared context, row action flyout and fill bar.
import { createContext, useContext, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Ban } from "lucide-react";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { type CascadeDeleteResult, type InventoryStructureNode } from "@/lib/wms-core";
import { type FillStats, type LocationRow, type WarehouseRow, type ZoneRow, emptyFillStats } from "@/components/warehouse-tree/tree-data";

// ─── Context ──────────────────────────────────────────────────────────────────

export type ActiveDialog =
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

export interface TreeCtxValue {
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

export const TreeCtx = createContext<TreeCtxValue | null>(null);

export const TREE_CONTEXT_HINT = "Right-click or press and hold for row actions.";

export function TreeRowFlyout({
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

export function TreeRowFlyoutItem({
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

export function useTCtx() {
  const c = useContext(TreeCtx);
  if (!c) throw new Error("TreeCtx missing");
  return c;
}

export function FillBar({ stats, disabled = false }: { stats?: FillStats; disabled?: boolean }) {
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
