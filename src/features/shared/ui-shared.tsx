import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Link, NavLink, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm, type UseFormReturn } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { supabase } from "@/integrations/supabase/client";
import { Activity, AlertCircle, AlertTriangle, ArrowLeftRight, BarChart3, Bell, Bot, Boxes, Building2, CheckCircle2, ChevronDown, ClipboardCheck, ClipboardList, CloudOff, Download, Eye, EyeOff, FileDown, Forklift, GripVertical, HelpCircle, Home, Info, KeyRound, LayoutDashboard, Loader2, Lock, LockOpen, LogOut, Mail, Maximize2, MapPinned, Menu, Minimize2, Network, Package, PackageX, PanelLeftClose, PanelLeftOpen, Pencil, Plus, Printer, QrCode, RadioTower, RefreshCw, RotateCcw, Search, Settings, ShieldCheck, Star, Tags, Trash2, Truck, Upload, UserPlus, Users } from "lucide-react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { toast } from "sonner";
import { z } from "zod";

import { useAuth } from "@/hooks/use-auth";
import { useTenantPath } from "@/hooks/use-tenant-path";
import { useFeatureFlags, MODULE_LABELS, STARTER_MODULES, type ModuleKey } from "@/hooks/use-feature-flags";
import { assertOnline, useNetworkStatus } from "@/hooks/use-network-status";
import {
  enqueueOfflineWork,
  flushOfflineQueue,
  installOfflineAutoReplay,
  isLikelyNetworkError,
  useOfflineQueue,
  useDeadLetterQueue,

  type FailedWorkItem,
} from "@/lib/offline-queue";
import { useBackgroundSync } from "@/hooks/use-background-sync";
import { useNotificationPermission } from "@/hooks/use-notification-permission";
import {
  NAVIGATION,
  ROLE_LABELS,
  ROLE_DESCRIPTIONS,
  type AdminInviteUserInput,
  type AppRoute,
  type FieldDefinition,
  type ResourceDefinition,
  type DraftReceipt,
  type BayOccupancyCell,
  adminInviteUser,
  adminDeleteUser,
  adminUpdateUserPin,
  adminUpdateUserPassword,
  buildBayOccupancyGrid,
  updateOwnPassword,
  changePalletStatus,
  confirmPutaway,
  createCycleCountFlow,
  createPickListFlow,
  getPickableStockSummary,
  createTransferFlow,
  cancelPickList,
  deleteClientVariable,
  deleteResourceCascade,
  dispatchTransfer,
  cycleCountSchema,
  resetWmsData,
  deleteAllProducts,
  removeUserRoleAssignment,
  downloadCsv,
  downloadCsvTemplate,
  fetchOptions,
  formatDate,
  formatNumber,
  getDashboardMetrics,
  getInventoryDetail,
  getPickExecution,
  getBinOccupancy,
  getBayOccupancy,
  getWarehouseBayOccupancy,
  type WarehouseBayGroup,
  logPutawayBaySelection,
  getPutawayTasks,
  getPutawayTaskHistory,
  getReportData,
  parseCsvForResource,
  commitImportRows,
  type ImportPreview,
  type ImportRowPreview,
  type ProductCategory,
  inferProductCategory,
  listClientVariables,
  listDraftReceipts,
  saveShipmentDrafts,
  updateDraftReceipt,
  completeReceiptFromDraft,
  deleteDraftReceipt,
  listSystemLogs,
  listUserActivities,
  listCycleCounts,
  listPickLists,
  listRecords,
  listStatusPallets,
  listTransfers,
  pickListSchema,
  receivingSchema,
  receiveTransfer,
  resolveSystemLog,
  searchInventory,
  setProfileActive,
  snapshotRecordCounts,
  updateProfileDetails,
  updateProfileDefaultWarehouse,
  statusChangeSchema,
  setResourceVisibility,
  setUserRoleVisibility,
  submitCycleCountLine,
  transferSchema,
  updateRecord,
  upsertClientVariable,
  upsertRecord,
  writeSystemLog,
  cancelTransfer,
  flagCountLineException,
  revertPutawayToDraft,
  listMoveTasks,
  completeDirectMove,
  completeMoveTask,
  cancelMoveTask,
  expandLocationRange,
  buildRackLocationCode,
  suggestNextRackPosition,
  validateMoveDestination,
  type MoveValidationResult,
} from "@/lib/wms-core";
import { ProductSearch } from "@/components/product-search";
import { buildPalletLabelBatchPrintHtml, PalletLabelPage, type PalletLabelPageProps } from "@/components/pallet-label-page";
import { BarcodeScanButton } from "@/components/barcode-scan-button";
import { type ProductSearchHandle } from "@/components/product-search";

import { cn } from "@/lib/utils";
import { extractIso6346ContainerNumber, normalizeContainerNumber, validateIso6346ContainerNumber } from "@/lib/container-number";
import { getOrCreateDeviceId } from "@/lib/device-identity";
import { invalidateWarehouseData } from "@/lib/query-invalidation";
import {
  filterDashboardTileDefinitions,
  hiddenDashboardTiles,
  loadDashboardDeviceLayout,
  loadDashboardTileVisibility,
  sanitizeDashboardLayout,
  saveDashboardDeviceLayout,
  saveDashboardTileVisibility,
  visibleDashboardTiles,
  type DashboardCardSize,
  type DashboardTileConfig,
  type DashboardTileDefinition,
  type DashboardVisibilityMap,
} from "@/lib/dashboard-preferences";
import {
  buildCsvReportRows,
  buildEnterpriseDashboard,
  type DashboardMode,
  type DockHandoffLoad,
  type EnterpriseDashboardSnapshot,
  type WarehouseBrainRecommendation,
} from "@/lib/enterprise-wms";
import { HelpSidebar } from "@/components/help-sidebar";
import { ZoneLabelPage } from "@/components/zone-label-page";
import { LocationLabelPage } from "@/components/location-label-page";
import { BayLocationCodesPrintDialog, LabelSheetPrintDialog, type LabelSheetItem } from "@/components/label-sheet-print";
import { WarehouseStructureTab } from "@/components/warehouse-tree-view";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
// removed unused dropdown-menu and drawer imports
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

let dashboardLayoutLockedToastAt = 0;

const baseFormSchema = z.record(z.any());
export const appTitle = "WW";

type DashboardMetricKey =
  | "totalPallets"
  | "warehousePallets"
  | "availablePallets"
  | "coolZoneOccupancy"
  | "openReceipts"
  | "openPutawayTasks"
  | "openPickLists"
  | "openMoveTasks"
  | "openTransfers"
  | "openCycleCounts"
  | "openDockLoads"
  | "openReplenishmentTasks"
  | "recentAuditEvents"
  | "holdStock"
  | "quarantineStock"
  | "expiryWarning60"
  | "expiryWarning30"
  | "stockAge3Months"
  | "stockAge6Months"
  | "stockAge12Months";

export type DashboardCardConfig = DashboardTileDefinition<ModuleKey> & {
  metricKey: DashboardMetricKey;
};

export const DEFAULT_DASHBOARD_CARDS: DashboardCardConfig[] = [
  { id: "totalPallets", label: "Total Pallets", metricKey: "totalPallets", size: "lg", moduleKey: "inventory" },
  { id: "warehousePallets", label: "This Warehouse", metricKey: "warehousePallets", size: "lg", moduleKey: "inventory" },
  { id: "openReceipts", label: "Open Receipts", metricKey: "openReceipts", size: "sm", moduleKey: "receiving" },
  { id: "openPutawayTasks", label: "Open Put-Away", metricKey: "openPutawayTasks", size: "sm", moduleKey: "putaway" },
  { id: "openPickLists", label: "Open Pick Lists", metricKey: "openPickLists", size: "sm", moduleKey: "pick-lists" },
  { id: "openMoveTasks", label: "Open Moves", metricKey: "openMoveTasks", size: "sm", moduleKey: "location-moves" },
  { id: "expiryWarning30", label: "Expiry 30 Days", metricKey: "expiryWarning30", size: "sm", moduleKey: "inventory" },
  { id: "expiryWarning60", label: "Expiry 60 Days", metricKey: "expiryWarning60", size: "sm", moduleKey: "inventory" },
  { id: "stockAge3Months", label: "Aging 3+ Mo", metricKey: "stockAge3Months", size: "sm", moduleKey: "inventory" },
  { id: "stockAge6Months", label: "Aging 6+ Mo", metricKey: "stockAge6Months", size: "sm", moduleKey: "inventory" },
  { id: "stockAge12Months", label: "Aging 12+ Mo", metricKey: "stockAge12Months", size: "sm", moduleKey: "inventory" },
];

export const DASHBOARD_FLOOR_LAYOUT_KEY = "wms.dashboard.floor.surface.layout.v1";
export const DASHBOARD_DOCK_LAYOUT_KEY = "wms.dashboard.dock.surface.layout.v1";
export const DASHBOARD_OFFICE_LAYOUT_KEY = "wms.dashboard.office.surface.layout.v1";
const DASHBOARD_DIAL_METRICS = new Set<DashboardMetricKey>(["totalPallets", "warehousePallets"]);
const DASHBOARD_METRIC_ROUTES: Record<DashboardMetricKey, AppRoute> = {
  totalPallets: "/inventory-search",
  warehousePallets: "/inventory-search",
  availablePallets: "/inventory-search",
  coolZoneOccupancy: "/locations",
  openReceipts: "/receiving",
  openPutawayTasks: "/putaway-tasks",
  openPickLists: "/pick-lists",
  openMoveTasks: "/location-moves",
  openTransfers: "/transfers",
  openCycleCounts: "/cycle-counts",
  openDockLoads: "/pick-lists",
  openReplenishmentTasks: "/inventory-search",
  recentAuditEvents: "/system-log",
  holdStock: "/status",
  quarantineStock: "/status",
  expiryWarning60: "/inventory-search",
  expiryWarning30: "/inventory-search",
  stockAge3Months: "/inventory-search",
  stockAge6Months: "/inventory-search",
  stockAge12Months: "/inventory-search",
};

function dashboardMetricLink(metricKey: DashboardMetricKey) {
  if (metricKey === "stockAge3Months") return "/inventory-search?age=3m";
  if (metricKey === "stockAge6Months") return "/inventory-search?age=6m";
  if (metricKey === "stockAge12Months") return "/inventory-search?age=12m";
  if (metricKey === "expiryWarning30") return "/inventory-search?expiry=30d";
  if (metricKey === "expiryWarning60") return "/inventory-search?expiry=60d";
  return DASHBOARD_METRIC_ROUTES[metricKey];
}
const DEFAULT_FLOOR_TILES: DashboardTileDefinition<ModuleKey>[] = [
  { id: "Inbound", label: "Inbound", size: "lg", moduleKey: "receiving" },
  { id: "Putaway", label: "Put-Away", size: "lg", moduleKey: "putaway" },
  { id: "Warehouse Intelligence", label: "Warehouse Intelligence", size: "lg" },
  { id: "Outbound", label: "Outbound", size: "lg", moduleKey: "pick-lists" },
  { id: "Moves & Counts", label: "Moves & Counts", size: "lg", moduleKey: "location-moves" },
  { id: "Blocked Exceptions", label: "Blocked Exceptions", size: "lg", moduleKey: "status" },
];

const DEFAULT_DOCK_TILES: DashboardTileDefinition<ModuleKey>[] = [
  { id: "ready", label: "Ready", size: "sm", moduleKey: "pick-lists" },
  { id: "called", label: "Called", size: "sm", moduleKey: "pick-lists" },
  { id: "loading", label: "Loading", size: "sm", moduleKey: "pick-lists" },
  { id: "blocked", label: "Blocked", size: "sm", moduleKey: "pick-lists" },
  { id: "loaded", label: "Loaded", size: "sm", moduleKey: "pick-lists" },
  { id: "warehouse-brain", label: "Warehouse Brain", size: "lg" },
];

const DEFAULT_OFFICE_TILES: DashboardTileDefinition<ModuleKey>[] = [
  { id: "Fill level", label: "Fill level", size: "lg", moduleKey: "locations" },
  { id: "Inventory turn watch", label: "Inventory turn watch", size: "lg", moduleKey: "inventory" },
  { id: "Expiration risk", label: "Expiration risk", size: "lg", moduleKey: "inventory" },
  { id: "DPMO", label: "DPMO", size: "lg", moduleKey: "cycle-counts" },
  { id: "setup-checklist", label: "Setup Checklist", size: "lg", moduleKey: "settings" },
  { id: "warehouse-brain", label: "Warehouse Brain", size: "lg" },
];

export const DEFAULT_FLOOR_LAYOUT: DashboardTileDefinition<ModuleKey>[] = [...DEFAULT_DASHBOARD_CARDS, ...DEFAULT_FLOOR_TILES];
export const DEFAULT_DOCK_LAYOUT: DashboardTileDefinition<ModuleKey>[] = [...DEFAULT_DASHBOARD_CARDS, ...DEFAULT_DOCK_TILES];
export const DEFAULT_OFFICE_LAYOUT: DashboardTileDefinition<ModuleKey>[] = [...DEFAULT_DASHBOARD_CARDS, ...DEFAULT_OFFICE_TILES];

export function tileConfigsFromDefinitions(definitions: DashboardTileDefinition<ModuleKey>[]): DashboardTileConfig[] {
  return definitions.map((tile) => ({ id: tile.id, size: tile.size }));
}

// ---------------------------------------------------------------------------
// Barcode scanner helpers
// ---------------------------------------------------------------------------

/** Play a short, pleasant confirmation beep via Web Audio API (works on iOS/Android too). */
export function playBarcodeBeep() {
  try {
    const ctx = new (window.AudioContext ?? (window as any).webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = "sine";
    osc.frequency.setValueAtTime(1480, ctx.currentTime);          // E6 — bright & pleasant
    osc.frequency.exponentialRampToValueAtTime(1760, ctx.currentTime + 0.06); // quick upward chirp
    gain.gain.setValueAtTime(0.9, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.18);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.18);
    osc.onended = () => ctx.close();
  } catch {
    // Audio not available — silent fallback
  }
}

/**
 * Flash an input element with a colour highlight for scanner feedback.
 * colour: "orange" = next-field cue, "blue" = confirmed-field cue.
 */
export function flashInput(el: HTMLElement | null, colour: "orange" | "blue") {
  if (!el) return;
  const cls = colour === "orange"
    ? ["ring-2", "ring-orange-400", "ring-offset-1"]
    : ["ring-2", "ring-blue-400", "ring-offset-1"];
  el.classList.add(...cls);
  setTimeout(() => el.classList.remove(...cls), 700);
}

export function loadFallbackTileLayout(key: string, defaults: DashboardTileConfig[]) {
  if (typeof window === "undefined") return defaults;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return defaults;
    return sanitizeDashboardLayout(JSON.parse(raw), defaults);
  } catch {
    return defaults;
  }
}

export function fallbackLayoutKey(key: string, profileId?: string | null, deviceId?: string | null) {
  return [key, profileId ?? "anonymous", deviceId ?? "device"].join(".");
}

export function loadFallbackVisibility(key: string): DashboardVisibilityMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) as DashboardVisibilityMap : {};
  } catch {
    return {};
  }
}

export function fallbackVisibilityKey(profileId: string | null | undefined, mode: DashboardMode) {
  return `wms.dashboard.visibility.v1.${profileId ?? "anonymous"}.${mode}`;
}

export function saveFallbackJson(key: string, value: unknown) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

function SortableDashboardTile({
  tile,
  editMode,
  onResize,
  onHide,
  children,
  className,
}: {
  tile: DashboardTileConfig;
  editMode: boolean;
  onResize: (id: string) => void;
  onHide: (id: string) => void;
  children: ReactNode;
  className?: string;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: tile.id, disabled: !editMode });
  const handleLockedPointerDownCapture = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (editMode) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest("a,button,input,textarea,select,[role='button']")) return;
    const now = Date.now();
    if (now - dashboardLayoutLockedToastAt < 1200) return;
    dashboardLayoutLockedToastAt = now;
    toast.info("Unlock dashboard layout to reorder, resize, or hide tiles.");
  }, [editMode]);
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
    touchAction: editMode ? "none" : undefined,
  };

  return (
    <div ref={setNodeRef} style={style} className={cn(tile.size === "lg" ? "sm:col-span-2" : undefined, className)} onPointerDownCapture={handleLockedPointerDownCapture}>
      <div
        className={cn("group relative h-full", editMode && "cursor-grab active:cursor-grabbing")}
        {...(editMode ? { ...attributes, ...listeners } : {})}
      >
        {children}
        {editMode ? (
          <div className="absolute right-3 top-3 z-10 flex items-center gap-1 rounded-md bg-background/80 p-0.5 shadow-sm backdrop-blur">
            <button
              type="button"
              onClick={() => onHide(tile.id)}
              className="grid h-6 w-6 place-items-center rounded-sm text-muted-foreground transition hover:bg-secondary hover:text-foreground"
              aria-label="Hide tile"
            >
              <EyeOff className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => onResize(tile.id)}
              className="grid h-6 w-6 place-items-center rounded-sm text-muted-foreground transition hover:bg-secondary hover:text-foreground"
              aria-label="Resize tile"
            >
              {tile.size === "sm" ? <Maximize2 className="h-3.5 w-3.5" /> : <Minimize2 className="h-3.5 w-3.5" />}
            </button>
            <button
              type="button"
              className="grid h-6 w-6 cursor-grab place-items-center rounded-sm text-muted-foreground transition hover:bg-secondary hover:text-foreground active:cursor-grabbing"
              aria-label="Drag tile"
              {...attributes}
              {...listeners}
            >
              <GripVertical className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function SortableMetricCard({
  card,
  value,
  isLoading,
  editMode,
  onResize,
  onHide,
}: {
  card: DashboardCardConfig;
  value: number;
  isLoading: boolean;
  editMode: boolean;
  onResize: (id: string) => void;
  onHide: (id: string) => void;
}) {
  return (
    <SortableDashboardTile tile={card} editMode={editMode} onResize={onResize} onHide={onHide}>
      <Card className="relative h-full">
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2 pr-20">
          <CardTitle className="text-sm font-medium text-muted-foreground">{card.label}</CardTitle>
        </CardHeader>
        <CardContent>
          <Link to={dashboardMetricLink(card.metricKey)} className="block rounded-sm transition hover:text-primary focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2">
            <div className="text-3xl font-bold">
              {isLoading ? <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /> : formatNumber(value)}
            </div>
          </Link>
        </CardContent>
      </Card>
    </SortableDashboardTile>
  );
}

export function SortableSummaryCard({
  card,
  metrics,
  isLoading,
  warehouseCaption,
  editMode,
  onResize,
  onHide,
}: {
  card: DashboardCardConfig;
  metrics: Awaited<ReturnType<typeof getDashboardMetrics>> | undefined;
  isLoading: boolean;
  warehouseCaption: string;
  editMode: boolean;
  onResize: (id: string) => void;
  onHide: (id: string) => void;
}) {
  if (DASHBOARD_DIAL_METRICS.has(card.metricKey)) {
    const capacity = card.metricKey === "totalPallets" ? metrics?.totalPalletCapacity ?? 0 : metrics?.warehousePalletCapacity ?? 0;
    const caption = card.metricKey === "totalPallets" ? `${formatNumber(metrics?.totalPalletCapacity ?? 0)} location capacity` : warehouseCaption;
    return (
      <SortableDashboardTile tile={card} editMode={editMode} onResize={onResize} onHide={onHide}>
        <PalletDialCard
          label={card.label}
          value={metrics?.[card.metricKey] ?? 0}
          capacity={capacity}
          caption={caption}
          isLoading={isLoading}
          route={dashboardMetricLink(card.metricKey)}
        />
      </SortableDashboardTile>
    );
  }

  return <SortableMetricCard card={card} value={metrics?.[card.metricKey] ?? 0} isLoading={isLoading} editMode={editMode} onResize={onResize} onHide={onHide} />;
}

function PalletDialCard({
  label,
  value,
  capacity,
  caption,
  isLoading,
  route,
}: {
  label: string;
  value: number;
  capacity: number;
  caption: string;
  isLoading: boolean;
  route: string;
}) {
  const percentage = capacity > 0 ? Math.min(100, Math.round((value / capacity) * 100)) : 0;

  return (
    <Card className="h-full min-h-0">
      <CardContent className="flex h-full items-center gap-4 p-4 pr-20">
        <Link
          to={route}
          className="grid h-24 w-24 shrink-0 place-items-center rounded-full transition focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
          aria-label={`${label} ${percentage}%`}
          title={`Open source: ${label}`}
        >
        <div
          className="grid h-24 w-24 shrink-0 place-items-center rounded-full"
          style={{
            background: `conic-gradient(hsl(var(--primary)) ${percentage}%, hsl(var(--accent) / 0.35) ${percentage}% 100%)`,
          }}
        >
          <div className="grid h-16 w-16 place-items-center rounded-full bg-card text-sm font-semibold">
            {isLoading ? <Loader2 className="h-5 w-5 animate-themed-loader" /> : `${percentage}%`}
          </div>
        </div>
        </Link>
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase text-muted-foreground">{label}</p>
          <Link to={route} className="block rounded-sm transition hover:text-primary focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2">
            <p className="text-3xl font-bold tracking-tight">{isLoading ? "..." : formatNumber(value)}</p>
          </Link>
          <p className="truncate text-xs text-muted-foreground">{caption}</p>
        </div>
      </CardContent>
    </Card>
  );
}

export type ProfileRow = {
  id: string;
  email?: string | null;
  full_name?: string | null;
  phone?: string | null;
  default_warehouse_id?: string | null;
  active?: boolean | null;
  approved?: boolean | null;
  user_code?: string | null;
  badge_code?: string | null;
};

export type WarehouseOption = {
  id: string;
  name: string;
};

export type UserActivityRow = {
  id: string;
  event_type: string;
  entity_table: string;
  actor_user_id?: string | null;
  created_at: string;
  profiles?: { full_name?: string | null; email?: string | null } | null;
};

export const navIcons: Record<AppRoute, typeof LayoutDashboard> = {
  "/": Home,
  "/dashboard": LayoutDashboard,
  "/warehouses": Building2,
  "/zones": Boxes,
  "/locations": MapPinned,
  "/clients": Users,
  "/products": Package,
  "/packaging-profiles": Tags,
  "/receiving": Download,
  "/putaway-tasks": Forklift,
  "/inventory-search": Search,
  "/inventory/:balanceId": Search,
  "/pick-lists": ClipboardList,
  "/pick-lists/:pickListId": ClipboardList,
  "/transfers": Truck,
  "/location-moves": ArrowLeftRight,
  "/cycle-counts": ClipboardCheck,
  "/status": ShieldCheck,
  "/reports": BarChart3,
  "/users": Users,
  "/settings": Settings,
  "/system-log": Activity,
  "/email-log": Mail,
  "/help": HelpCircle,
  "/setup-wizard": Settings,
};

export function TableFrame({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("h-[calc(100svh-14rem)] min-h-48 w-full min-w-0 overflow-auto overscroll-contain [-webkit-overflow-scrolling:touch] [touch-action:pan-x_pan-y] [&_table]:min-w-max", className)}>
      {children}
    </div>
  );
}

export function renderField(
  field: FieldDefinition,
  form: ReturnType<typeof useForm<Record<string, unknown>>>,
  options: Array<{ label: string; value: string }> = field.options ?? [],
) {
  const uppercaseInput = shouldUppercaseField(field.name);
  return (
    <FormField
      key={field.name}
      control={form.control}
      name={field.name}
      render={({ field: controllerField }) => (
        <FormItem>
          <FormLabel>
            {field.label}
            {field.required ? <span className="ml-1 text-destructive" aria-hidden="true">*</span> : null}
          </FormLabel>
          <FormControl>
            {field.type === "textarea" ? (
              <Textarea {...controllerField} value={(controllerField.value as string | undefined) ?? ""} />
            ) : field.type === "select" ? (
              <Select
                onValueChange={controllerField.onChange}
                value={(controllerField.value as string | undefined) ?? undefined}
              >
                <SelectTrigger>
                  <SelectValue placeholder={`Select ${field.label.toLowerCase()}`} />
                </SelectTrigger>
                <SelectContent>
                  {options.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : field.type === "boolean" ? (
              <div className="flex items-center gap-3 rounded-md border border-border px-3 py-2">
                <Checkbox checked={Boolean(controllerField.value)} onCheckedChange={controllerField.onChange} />
                <span className="text-sm text-muted-foreground">Enabled</span>
              </div>
            ) : (
              <Input
                type={field.type === "number" ? "number" : field.type === "date" ? "date" : "text"}
                {...controllerField}
                value={(controllerField.value as string | number | undefined) ?? ""}
                onChange={(event) => {
                  const value = event.target.value;
                  controllerField.onChange(uppercaseInput ? normalizeScannerText(value) : value);
                }}
              />
            )}
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

function hasMissingRequiredValue(value: unknown) {
  return value == null || (typeof value === "string" && value.trim() === "");
}

function validateRequiredResourceFields(
  resource: ResourceDefinition,
  values: Record<string, unknown>,
  form: ReturnType<typeof useForm<Record<string, unknown>>>,
) {
  const missingFields = resource.fields.filter((field) => field.required && hasMissingRequiredValue(values[field.name]));
  for (const field of resource.fields) {
    if (missingFields.includes(field)) {
      form.setError(field.name, { type: "required", message: `${field.label} is required` });
    } else if (form.getFieldState(field.name).error?.type === "required") {
      form.clearErrors(field.name);
    }
  }
  return missingFields.length === 0;
}

function missingRequiredFieldLabels(resource: ResourceDefinition, values: Record<string, unknown>) {
  return resource.fields
    .filter((field) => field.required && hasMissingRequiredValue(values[field.name]))
    .map((field) => field.label);
}

function RackLocationCodeBuilder({
  form,
  options,
}: {
  form: ReturnType<typeof useForm<Record<string, unknown>>>;
  options: Awaited<ReturnType<typeof fetchOptions>> | undefined;
}) {
  const [rack, setRack] = useState("A");
  const [aisle, setAisle] = useState(1);
  const [bay, setBay] = useState(1);
  const [level, setLevel] = useState(1);
  const [position, setPosition] = useState(1);
  const [depth, setDepth] = useState(1);

  const localCode = buildRackLocationCode({ rack, aisle, bay, level, position });
  const prefixKey = `${rack.toUpperCase()}-${String(bay).padStart(2, "0")}-L${String(level).padStart(2, "0")}`;

  const { data: existingAtPrefix = [] } = useQuery({
    queryKey: ["locations-prefix", prefixKey],
    queryFn: async () => {
      const { data } = await supabase.from("locations").select("code").ilike("code", `${prefixKey}%`);
      return (data ?? []).map((r: any) => String(r.code));
    },
    enabled: Boolean(rack && aisle && bay && level),
    staleTime: 10_000,
  });

  const isDuplicate = existingAtPrefix.some((c) => c.toUpperCase().includes(localCode.toUpperCase()));
  const nextSuggestion = suggestNextRackPosition(existingAtPrefix, rack, aisle, bay, level);

  useEffect(() => {
    form.setValue("code", localCode, { shouldValidate: true });
    form.setValue("aisle", `${rack.toUpperCase()}-${aisle}`);
    form.setValue("bay", String(bay).padStart(2, "0"));
    form.setValue("level", level);
    form.setValue("position", position);
    form.setValue("depth", depth);
    form.setValue("location_type", "rack");
    if (isDuplicate) {
      form.setError("code", { type: "manual", message: "This location already exists" });
    } else {
      form.clearErrors("code");
    }
  }, [rack, aisle, bay, level, position, depth, localCode, isDuplicate, form]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <FormItem>
          <FormLabel>Rack</FormLabel>
          <FormControl>
            <Input
              maxLength={1}
              value={rack}
              placeholder="A"
              onChange={(e) => setRack(e.target.value.toUpperCase().replace(/[^A-Z]/g, "") || "A")}
            />
          </FormControl>
          <p className="text-[11px] text-muted-foreground">A–Z, back to front</p>
        </FormItem>
        <FormItem>
          <FormLabel>Aisle</FormLabel>
          <FormControl>
            <Input
              type="number"
              min={1}
              value={aisle}
              onChange={(e) => setAisle(Math.max(1, parseInt(e.target.value, 10) || 1))}
            />
          </FormControl>
          <p className="text-[11px] text-muted-foreground">Floor in front of rack</p>
        </FormItem>
        <FormItem>
          <FormLabel>Bay</FormLabel>
          <FormControl>
            <Input
              type="number"
              min={1}
              max={99}
              value={bay}
              onChange={(e) => setBay(Math.max(1, Math.min(99, parseInt(e.target.value, 10) || 1)))}
            />
          </FormControl>
          <p className="text-[11px] text-muted-foreground">01–13, left to right</p>
        </FormItem>
        <FormItem>
          <FormLabel>Level</FormLabel>
          <FormControl>
            <Input
              type="number"
              min={1}
              max={7}
              value={level}
              onChange={(e) => setLevel(Math.max(1, Math.min(7, parseInt(e.target.value, 10) || 1)))}
            />
          </FormControl>
          <p className="text-[11px] text-muted-foreground">1 = floor, 2+ above</p>
        </FormItem>
        <FormItem>
          <FormLabel>
            Position
            {nextSuggestion > position && (
              <button
                type="button"
                className="ml-2 text-[10px] text-primary underline-offset-2 hover:underline"
                onClick={() => setPosition(nextSuggestion)}
              >
                next: P{String(nextSuggestion).padStart(2, "0")}
              </button>
            )}
          </FormLabel>
          <FormControl>
            <Input
              type="number"
              min={1}
              max={9}
              value={position}
              onChange={(e) => setPosition(Math.max(1, Math.min(9, parseInt(e.target.value, 10) || 1)))}
            />
          </FormControl>
          <p className="text-[11px] text-muted-foreground">Left to right within bay</p>
        </FormItem>
        <FormItem>
          <FormLabel>Depth</FormLabel>
          <FormControl>
            <Input
              type="number"
              min={1}
              max={5}
              value={depth}
              onChange={(e) => setDepth(Math.max(1, Math.min(5, parseInt(e.target.value, 10) || 1)))}
            />
          </FormControl>
          <p className="text-[11px] text-muted-foreground">Pallets deep, 1–5</p>
        </FormItem>
      </div>
      <div
        className={cn(
          "flex items-center gap-2 rounded-md border px-3 py-2 font-mono text-sm",
          isDuplicate
            ? "border-destructive bg-destructive/10 text-destructive"
            : "border-border bg-muted/50 text-foreground",
        )}
      >
        <span className="shrink-0 text-xs text-muted-foreground">Code:</span>
        <span className="flex-1 truncate">{localCode}</span>
        {isDuplicate && <span className="shrink-0 text-xs font-medium text-destructive">already exists</span>}
      </div>
    </div>
  );
}

export function ResourceFormDialog({
  resource,
  trigger,
}: {
  resource: ResourceDefinition;
  trigger?: React.ReactNode;
}) {
  const queryClient = useQueryClient();
  const { roles, profile } = useAuth();
  const [open, setOpen] = useState(false);
  const restrictedToDefaultWarehouse = shouldRestrictToDefaultWarehouse(roles);
  const { data: options } = useQuery({
    queryKey: ["options", resource.table, restrictedToDefaultWarehouse, profile?.default_warehouse_id],
    queryFn: () => fetchOptions(false, { restrictToWarehouse: restrictedToDefaultWarehouse, warehouseId: profile?.default_warehouse_id }),
  });
  const isZones = resource.table === "zones";
  const isLocations = resource.table === "locations";
  // Fields controlled by the location code builder — hidden from the generic loop
  const builderControlledFields = new Set(["code", "aisle", "bay", "level", "position", "depth", "location_type"]);

  const form = useForm<Record<string, unknown>>({
    resolver: zodResolver(baseFormSchema),
    defaultValues: resource.fields.reduce<Record<string, unknown>>((accumulator, field) => {
      accumulator[field.name] = defaultFieldValue(field);
      return accumulator;
    }, {}),
  });

  // Auto-select warehouse when only one exists
  useEffect(() => {
    if (options?.warehouses?.length === 1) {
      const onlyId = (options.warehouses[0] as any).id as string;
      const current = form.getValues("warehouse_id");
      if (!current) form.setValue("warehouse_id", onlyId, { shouldDirty: false });
    }
  }, [options?.warehouses, form]);

  // Zone duplicate guard
  const watchedWarehouseId = form.watch("warehouse_id");
  const watchedCode = form.watch("code");
  const watchedName = form.watch("name");
  useEffect(() => {
    if (!isZones) return;
    const existing = (options?.zones ?? []).filter((z: any) => z.warehouse_id === watchedWarehouseId);
    const rawCode = String(watchedCode ?? "").trim().toUpperCase();
    const rawName = String(watchedName ?? "").trim().toLowerCase();
    const codeExists = rawCode.length > 0 && existing.some((z: any) => String(z.code).toUpperCase() === rawCode);
    const nameExists = rawName.length > 0 && existing.some((z: any) => String(z.name).toLowerCase() === rawName);
    if (codeExists) {
      form.setError("code", { type: "manual", message: "Zone code already exists in this warehouse" });
    } else {
      form.clearErrors("code");
    }
    if (nameExists) {
      form.setError("name", { type: "manual", message: "Zone name already exists in this warehouse" });
    } else {
      form.clearErrors("name");
    }
  }, [isZones, watchedWarehouseId, watchedCode, watchedName, options?.zones, form]);

  const createMutation = useMutation({
    mutationFn: async (values: Record<string, unknown>) => upsertRecord(resource.table, normalizeResourceValues(resource, values, options)),
    onSuccess: () => {
      toast.success(`${resource.singular} saved`);
      queryClient.invalidateQueries({ queryKey: [resource.table] });
      form.reset();
      setOpen(false);
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Save failed");
    },
  });

  function handleCreateSubmit(values: Record<string, unknown>) {
    if (!validateRequiredResourceFields(resource, values, form)) {
      toast.error(`Complete the required fields: ${missingRequiredFieldLabels(resource, values).join(", ")}.`);
      return;
    }
    createMutation.mutate(values);
  }

  const createValues = form.watch();
  const createMissingFields = missingRequiredFieldLabels(resource, createValues);
  const canCreate = createMissingFields.length === 0
    && !(isZones && (!!form.formState.errors.code || !!form.formState.errors.name))
    && !(isLocations && !!form.formState.errors.code);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? <Button>
          <Plus data-icon="inline-start" />
          Add {resource.singular}
        </Button>}
      </DialogTrigger>
      <DialogContent className="flex max-h-[90vh] flex-col overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="shrink-0 border-b px-6 py-4">
          <DialogTitle>Create {resource.singular}</DialogTitle>
          <DialogDescription>{resource.description}</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form className="flex min-h-0 flex-1 flex-col" onSubmit={form.handleSubmit(handleCreateSubmit)}>
            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
              <div className="flex flex-col gap-4 pr-4">
              {resource.fields.map((field) => {
                if (isLocations && builderControlledFields.has(field.name)) return null;
                return renderField(field, form, getResourceFieldOptions(field, options));
              })}
              {isLocations && <RackLocationCodeBuilder form={form} options={options} />}
              </div>
            </div>
            <DialogFooter className="shrink-0 border-t bg-card px-6 py-3 sm:justify-between">
              <p className="text-xs text-muted-foreground" aria-live="polite">
                {createMissingFields.length > 0 ? `Required: ${createMissingFields.join(", ")}` : "All required fields are complete."}
              </p>
              <Button type="submit" disabled={createMutation.isPending || !canCreate}>
                {createMutation.isPending ? <Loader2 className="animate-spin" /> : null}
                Save {resource.singular}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

export function ResourceEditDialog({
  resource,
  editRecord,
  onClose,
}: {
  resource: ResourceDefinition;
  editRecord: Record<string, unknown>;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const { roles, profile } = useAuth();
  const restrictedToDefaultWarehouse = shouldRestrictToDefaultWarehouse(roles);
  const { data: options } = useQuery({
    queryKey: ["options", resource.table, restrictedToDefaultWarehouse, profile?.default_warehouse_id],
    queryFn: () => fetchOptions(false, { restrictToWarehouse: restrictedToDefaultWarehouse, warehouseId: profile?.default_warehouse_id }),
  });
  const form = useForm<Record<string, unknown>>({
    resolver: zodResolver(baseFormSchema),
    defaultValues: resource.fields.reduce<Record<string, unknown>>((acc, field) => {
      acc[field.name] = editRecord[field.name] ?? defaultFieldValue(field);
      return acc;
    }, {}),
  });

  // For locations: watch status to show disable-reason notice
  const isLocations = resource.table === "locations";
  const watchedStatus = isLocations ? (form.watch("status") as string | undefined) : undefined;
  const isBeingDisabled = watchedStatus === "disabled" || watchedStatus === "maintenance";
  const wasAlreadyDisabled = isLocations && (editRecord.status === "disabled" || editRecord.status === "maintenance");
  const originalLocationCode = isLocations ? String(editRecord.code ?? "") : "";

  const updateMutation = useMutation({
    mutationFn: async (values: Record<string, unknown>) => {
      const id = String(editRecord.id ?? "");
      if (!id) throw new Error(`Missing ${resource.singular} id.`);
      return updateRecord(resource.table, id, normalizeResourceValues(resource, values, options, { preserveLocationCode: isLocations }));
    },
    onSuccess: (_updated, values) => {
      toast.success(`${resource.singular} updated`);
      if (isLocations && normalizeScannerText(values.code) !== normalizeScannerText(originalLocationCode)) {
        toast.message("Location code changed", {
          description: "Reprint the location label unless this code change was intentional.",
          duration: 8000,
        });
      }
      queryClient.invalidateQueries({ queryKey: [resource.table] });
      onClose();
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Update failed");
    },
  });

  function handleSubmit(values: Record<string, unknown>) {
    if (!validateRequiredResourceFields(resource, values, form)) {
      toast.error(`Complete the required fields: ${missingRequiredFieldLabels(resource, values).join(", ")}.`);
      return;
    }
    // Locations: require a reason in Notes when disabling or marking maintenance
    if (isLocations && isBeingDisabled && !values.notes) {
      toast.error("Add a reason in the Notes field before marking this location unavailable.");
      return;
    }
    updateMutation.mutate(values);
  }

  const editValues = form.watch();
  const editMissingFields = missingRequiredFieldLabels(resource, editValues);

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="flex max-h-[90vh] flex-col overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="shrink-0 border-b px-6 py-4">
          <DialogTitle className="flex items-center gap-2">
            <Pencil className="h-4 w-4" />
            Edit {resource.singular}
          </DialogTitle>
          <DialogDescription>{resource.description}</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form className="flex min-h-0 flex-1 flex-col" onSubmit={form.handleSubmit(handleSubmit)}>
            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
              <div className="flex flex-col gap-4 pr-4">
              {resource.fields.map((field) => (
                <div key={field.name}>
                  {renderField(field, form, getResourceFieldOptions(field, options))}
                  {/* Disable-with-reason notice for locations status field */}
                  {isLocations && field.name === "status" && isBeingDisabled && !wasAlreadyDisabled && (
                    <p className="mt-1.5 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-400">
                      This location will be marked as unavailable. Enter the reason in the Notes field below so operators know the cause and when it can return to service.
                    </p>
                  )}
                  {isLocations && field.name === "status" && watchedStatus === "active" && wasAlreadyDisabled && (
                    <p className="mt-1.5 rounded-md border border-green-300 bg-green-50 px-3 py-2 text-xs text-green-700 dark:border-green-700 dark:bg-green-950/40 dark:text-green-400">
                      Re-enabling this location will make it available for putaway and picking. Update the Notes field to record the clearance if needed.
                    </p>
                  )}
                </div>
              ))}
              </div>
            </div>
            <DialogFooter className="shrink-0 border-t bg-card px-6 py-3 sm:justify-between">
              <p className="text-xs text-muted-foreground" aria-live="polite">
                {editMissingFields.length > 0 ? `Required: ${editMissingFields.join(", ")}` : "All required fields are complete."}
              </p>
              <Button type="submit" disabled={updateMutation.isPending || editMissingFields.length > 0}>
                {updateMutation.isPending ? <Loader2 className="animate-spin" /> : null}
                Save changes
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

const locationWizardSchema = z
  .object({
    warehouse_id: z.string().uuid({ message: "Select a warehouse" }),
    zone_id: z.string().uuid({ message: "Select a zone" }),
    prefix: z.string().trim().min(1, "Prefix required").max(8, "Max 8 chars"),
    start_bay: z.coerce.number().int().min(1),
    end_bay: z.coerce.number().int().min(1),
    levels: z.coerce.number().int().min(1).max(6),
    positions_per_level: z.coerce.number().int().min(1).max(3),
    depth: z.coerce.number().int().min(1).max(5),
    level_letters: z.boolean(),
    location_type: z.enum(["rack", "staging", "quarantine", "dispatch", "receiving", "floor", "returns"]),
    temperature_class: z.enum(["ambient", "cool", "frozen"]),
    mixed_sku_allowed: z.boolean(),
    mixed_lot_allowed: z.boolean(),
    level_style: z.enum(["numeric", "letters"]).default("numeric"),
  })
  .refine((v) => v.end_bay >= v.start_bay, { path: ["end_bay"], message: "End bay must be ≥ start bay" });

export type LocationWizardValues = z.infer<typeof locationWizardSchema>;

export function ChangeOwnPasswordDialog({
  onClose,
  open: openProp,
  onOpenChange,
  hideTrigger = false,
}: {
  onClose?: () => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  hideTrigger?: boolean;
}) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = openProp !== undefined;
  const open = isControlled ? openProp : internalOpen;
  const setOpen = (value: boolean) => {
    if (!isControlled) setInternalOpen(value);
    onOpenChange?.(value);
  };
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");

  const mutation = useMutation({
    mutationFn: () => updateOwnPassword(password),
    onSuccess: () => {
      toast.success("Password updated");
      setPassword("");
      setConfirm("");
      setOpen(false);
      onClose?.();
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Password update failed"),
  });

  const handleSubmit = () => {
    if (password.length < 8) {
      toast.error("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      toast.error("Passwords do not match.");
      return;
    }
    mutation.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {!hideTrigger && (
        <DialogTrigger asChild>
          <Button variant="ghost" size="sm" className="h-7 w-7 shrink-0 p-0" aria-label="Change password">
            <KeyRound className="h-3 w-3" />
          </Button>
        </DialogTrigger>
      )}
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Change password</DialogTitle>
          <DialogDescription>Enter a new password for your account. Minimum 8 characters.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 py-2">
          <div className="grid gap-1.5">
            <label className="text-sm font-medium">New password</label>
            <Input
              type="password"
              value={password}
              placeholder="At least 8 characters"
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <label className="text-sm font-medium">Confirm password</label>
            <Input
              type="password"
              value={confirm}
              placeholder="Repeat new password"
              onChange={(e) => setConfirm(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={mutation.isPending}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={mutation.isPending}>
            {mutation.isPending ? <Loader2 className="animate-spin" /> : null}
            Update password
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ProfileMenu({ initials, displayName, onSignOut }: { initials: string; displayName: string; onSignOut: () => void }) {
  const [pwOpen, setPwOpen] = useState(false);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="flex items-center gap-2 rounded-lg border border-border bg-card/80 px-2.5 py-1.5 text-sm transition-colors hover:bg-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Avatar className="h-6 w-6">
              <AvatarFallback className="bg-primary/10 text-xs font-semibold text-primary">{initials}</AvatarFallback>
            </Avatar>
            <span className="hidden truncate text-xs font-medium sm:block">{displayName}</span>
            <ChevronDown className="h-3 w-3 text-muted-foreground" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuItem onSelect={(event) => { event.preventDefault(); setPwOpen(true); }}>
            <KeyRound className="mr-2 h-3.5 w-3.5" />
            Change password
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => onSignOut()}>
            <LogOut className="mr-2 h-3.5 w-3.5" />
            Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ChangeOwnPasswordDialog open={pwOpen} onOpenChange={setPwOpen} hideTrigger />
    </>
  );
}

function OfflineQueueBadge({ compact = false }: { compact?: boolean }) {
  const { count, syncing } = useOfflineQueue();
  if (count === 0 && !syncing) return null;
  const label = syncing ? "Syncing…" : `${count} queued`;
  const handleClick = async () => {
    if (syncing) return;
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      toast.error("Still offline — reconnect to a network, then tap again.");
      return;
    }
    const result = await flushOfflineQueue();
    if (result.remaining === 0 && result.succeeded > 0) {
      toast.success(`Synced ${result.succeeded} buffered action${result.succeeded === 1 ? "" : "s"}.`);
    } else if (result.remaining > 0) {
      toast.warning(`${result.remaining} item${result.remaining === 1 ? "" : "s"} still pending — will retry on next reconnect.`);
    }
  };
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      onClick={handleClick}
      disabled={syncing}
      className={cn(
        "h-9 gap-1.5 border-amber-400/60 bg-amber-50 text-amber-900 hover:bg-amber-100 dark:bg-amber-950/40 dark:text-amber-100 dark:hover:bg-amber-900/50",
        compact && "px-2 text-[11px]",
      )}
      title="Buffered work waiting for reconnect"
    >
      {syncing ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <CloudOff className="h-3.5 w-3.5" />}
      <span className={cn(compact && "hidden sm:inline")}>{label}</span>
      {!compact && count > 0 && !syncing ? <span className="text-xs opacity-70">tap to sync</span> : null}
    </Button>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const { pathname } = useLocation();
  const { profile, roles, signOut, user, refreshProfile } = useAuth();
  const queryClient = useQueryClient();
  const { isEnabled } = useFeatureFlags();
  const { online } = useNetworkStatus();
  useEffect(() => {
    installOfflineAutoReplay();
  }, []);
  useBackgroundSync(queryClient);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const networkStatusSeenRef = useRef(false);
  const items = NAVIGATION
    .filter(
      (item) =>
        item.roles.some((role) => roles.includes(role)) &&
        (!item.moduleKey || isEnabled(item.moduleKey as ModuleKey)),
    )
    // Settings and Help stay pinned below the module list.
    .sort((a, b) => {
      const pinnedOrder: Partial<Record<AppRoute, number>> = { "/settings": 1, "/help": 2 };
      return (pinnedOrder[a.to] ?? 0) - (pinnedOrder[b.to] ?? 0);
    });
  const canSwitchWarehouses = roles.some((role) => ["admin", "warehouse_manager", "developer"].includes(role));
  const canSelectAllWarehouses = roles.some((role) => ["admin", "developer"].includes(role));
  const { data: headerOptions } = useQuery({
    queryKey: ["header-warehouse-options", canSwitchWarehouses],
    queryFn: () => fetchOptions(false),
    enabled: canSwitchWarehouses,
  });
  const headerWarehouses = useMemo(() => {
    const warehouses = headerOptions?.warehouses ?? [];
    if (roles.includes("admin")) return warehouses;

    const assignedWarehouseIds = new Set(
      (headerOptions?.userRoles ?? [])
        .filter((userRole: any) => userRole.user_id === profile?.id && userRole.warehouse_id)
        .map((userRole: any) => userRole.warehouse_id),
    );

    return assignedWarehouseIds.size > 0
      ? warehouses.filter((warehouse: any) => assignedWarehouseIds.has(warehouse.id))
      : warehouses;
  }, [headerOptions, profile?.id, roles]);
  const warehouseSwitchMutation = useMutation({
    mutationFn: (warehouseId: string | null) => updateProfileDefaultWarehouse(profile?.id ?? "", warehouseId),
    onSuccess: async () => {
      await refreshProfile();
      await queryClient.invalidateQueries({ queryKey: ["dashboard-metrics"] });
      toast.success("Warehouse switched");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Warehouse switch failed"),
  });

  // Auto-select the only warehouse when there is exactly one and none is selected yet
  useEffect(() => {
    if (headerWarehouses.length === 1 && !profile?.default_warehouse_id && !warehouseSwitchMutation.isPending) {
      warehouseSwitchMutation.mutate((headerWarehouses[0] as any).id);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [headerWarehouses.length, profile?.default_warehouse_id]);

  const displayName = profile?.full_name?.trim() || user?.email || "Warehouse User";
  const initials = displayName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("") || "WU";

  useEffect(() => {
    if (!networkStatusSeenRef.current) {
      networkStatusSeenRef.current = true;
      return;
    }
    if (online) {
      toast.success("Connection restored. Refreshing live data.");
      void flushOfflineQueue({ silent: true }).finally(() => {
        void queryClient.invalidateQueries();
      });
      return;
    }
    toast.message("Connection lost. Keep finishing scan work already open; it will sync when signal returns.", {
      duration: 6000,
    });
  }, [online, queryClient]);

  const prefetchRouteData = useCallback((route: AppRoute) => {
    const warehouseId = profile?.default_warehouse_id;
    if (route === "/dashboard") {
      void queryClient.prefetchQuery({
        queryKey: ["dashboard-metrics", warehouseId],
        queryFn: () => getDashboardMetrics(warehouseId),
      });
      return;
    }
    if (route === "/receiving") {
      void queryClient.prefetchQuery({
        queryKey: ["options", "receiving", shouldRestrictToDefaultWarehouse(roles), warehouseId],
        queryFn: () => fetchOptions(false, { restrictToWarehouse: shouldRestrictToDefaultWarehouse(roles), warehouseId }),
      });
      return;
    }
    if (route === "/putaway-tasks") {
      const canSeeAll = roles.some((r) => ["developer", "admin", "warehouse_manager", "warehouse_supervisor"].includes(r));
      const prefetchUserId = canSeeAll ? undefined : user?.id;
      void queryClient.prefetchQuery({
        queryKey: ["putaway-tasks", prefetchUserId],
        queryFn: () => getPutawayTasks(prefetchUserId),
      });
      return;
    }
    if (route === "/inventory-search") {
      void queryClient.prefetchQuery({
        queryKey: ["inventory-search", "", "all", ""],
        queryFn: () => searchInventory({ status: "all" }),
      });
      return;
    }
    if (route === "/pick-lists") {
      void queryClient.prefetchQuery({
        queryKey: ["pick-lists"],
        queryFn: () => listPickLists(),
      });
    }
  }, [profile?.default_warehouse_id, queryClient, roles, user?.id]);

  const navigation = (
    <div
      className={cn(
        "flex h-full flex-col overflow-hidden bg-sidebar",
        sidebarCollapsed ? "items-center px-1.5 py-3 bg-teal-500" : "px-3 py-3"
      )}
    >
      {/* Logo area */}
      {(
        <div className={cn(
          "mb-4 flex items-center gap-3 px-2",
          sidebarCollapsed && "justify-center px-0"
        )}>
          <img src="/logo.png" alt="Warehouse Wizard" className="h-8 w-8 shrink-0 rounded-lg object-fill" />
          {!sidebarCollapsed && (
            <span className="truncate text-sm font-semibold text-foreground">Warehouse Wizard</span>
          )}
        </div>
      )}

      <nav className={cn("flex-1 overflow-y-auto")}>
        <div className="flex flex-col gap-0.5">
          {items.map((item) => {
            const Icon = navIcons[item.to] ?? LayoutDashboard;
            const isActive = pathname === item.to;
            const showSeparator = !sidebarCollapsed && item.to === "/warehouses";
            const link = (
              <NavLink
                key={item.to}
                className={({ isActive: navActive }) =>
                  cn(
                    "group flex min-h-[3.375rem] items-center gap-2.5 rounded-md px-2.5 text-sm font-medium transition-all duration-100 active:scale-[0.96] active:transition-transform",
                    sidebarCollapsed && "h-[3.375rem] w-11 justify-center p-0",
                    navActive || isActive
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                  )
                }
                to={item.to}
                aria-label={item.label}
                onMouseEnter={() => prefetchRouteData(item.to)}
                onFocus={() => prefetchRouteData(item.to)}
                onClick={() => setMobileMenuOpen(false)}
              >
                <Icon className={cn("shrink-0", sidebarCollapsed ? "h-5 w-5" : "h-4 w-4")} />
                {sidebarCollapsed ? null : <span className="truncate">{item.label}</span>}
              </NavLink>
            );

            const node = sidebarCollapsed ? (
              <Tooltip key={item.to}>
                <TooltipTrigger asChild>{link}</TooltipTrigger>
                <TooltipContent side="right">{item.label}</TooltipContent>
              </Tooltip>
            ) : link;

            if (showSeparator) {
              return (
                <Fragment key={item.to}>
                  <div className="my-1 border-t border-sidebar-border" />
                  {node}
                </Fragment>
              );
            }
            return node;
          })}
        </div>
      </nav>

      {/* Collapse/expand toggle at bottom — landscape desktop only */}
      <div className={cn("mt-2 hidden border-t border-sidebar-border pt-2 lg:landscape:flex", sidebarCollapsed ? "justify-center" : "justify-end")}>
        <Button
          className="h-8 w-8 shrink-0"
          size="icon"
          variant="ghost"
          onClick={() => setSidebarCollapsed((c) => !c)}
          aria-label={sidebarCollapsed ? "Expand navigation" : "Collapse navigation"}
        >
          {sidebarCollapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
        </Button>
      </div>
    </div>
  );

  return (
    <div className="h-screen overflow-hidden bg-background">
      <div
        className={cn(
          // Mobile + portrait-desktop: top header + content. Landscape-desktop: sidebar + content.
          "grid h-full w-full grid-cols-1 grid-rows-[auto_minmax(0,1fr)] overflow-hidden",
          "lg:landscape:grid-rows-1 lg:landscape:grid-cols-[minmax(11rem,max-content)_minmax(0,1fr)]",
          sidebarCollapsed && "lg:landscape:grid-cols-[64px_minmax(0,1fr)]",
        )}
      >
        {/* Mobile header */}
        <header className="col-span-full flex items-center justify-between border-b border-border bg-background/95 px-4 py-3 backdrop-blur lg:landscape:hidden">
          <div className="flex items-center gap-2">
            <img src="/logo.png" alt="Warehouse Wizard" className="h-7 w-7 shrink-0 rounded-md object-fill" />
            <span className="text-sm font-semibold">{appTitle}</span>
            <span className="hidden text-[10px] font-medium text-muted-foreground sm:inline">v{__APP_VERSION__}</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 rounded-md border border-border bg-card/80 px-1.5 py-1">
              <Avatar className="h-6 w-6">
                <AvatarFallback className="bg-primary/10 text-[10px] font-semibold text-primary">{initials}</AvatarFallback>
              </Avatar>
              <span className="hidden max-w-[120px] truncate text-xs font-medium sm:inline">{displayName}</span>
            </div>
            <OfflineQueueBadge compact />
            <HelpSidebar pathname={pathname} />
            <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
              <SheetTrigger asChild>
                <Button className="h-9 w-9" size="icon" variant="outline">
                  <Menu className="h-4 w-4" />
                </Button>
              </SheetTrigger>
              <SheetContent side="top" className="left-auto right-4 top-3 flex max-h-[calc(100svh-1.5rem)] w-[min(24rem,calc(100vw-1rem))] max-w-[calc(100vw-1rem)] origin-top-right flex-col overflow-hidden rounded-2xl border border-border bg-card/95 p-0 shadow-2xl backdrop-blur data-[state=closed]:duration-75 data-[state=open]:duration-100 data-[state=closed]:slide-out-to-top-1 data-[state=open]:slide-in-from-top-1 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0">
                <SheetHeader className="sr-only">
                  <SheetTitle>Navigation</SheetTitle>
                </SheetHeader>
                <div className="flex flex-col border-b border-border bg-card/80 px-4 py-3 gap-2">
                  <div className="flex items-center gap-3">
                    <Avatar className="h-9 w-9">
                      <AvatarFallback className="bg-primary/10 text-xs font-semibold text-primary">{initials}</AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{displayName}</p>
                      <p className="truncate text-[11px] text-muted-foreground">v{__APP_VERSION__}</p>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <ChangeOwnPasswordDialog onClose={() => setMobileMenuOpen(false)} />
                    <Button className="h-8 flex-1 text-xs justify-start" variant="outline" size="sm" onClick={() => { setMobileMenuOpen(false); void signOut(); }}>
                      <LogOut className="mr-2 h-3 w-3" />
                      Sign out
                    </Button>
                  </div>
                </div>
                <div className="flex-1 overflow-y-auto">{navigation}</div>
              </SheetContent>
            </Sheet>
          </div>
        </header>

        <aside className="hidden h-full overflow-hidden border-r border-border lg:landscape:block">{navigation}</aside>

        <main className="flex min-h-0 min-w-0 flex-col overflow-hidden">
          {/* Desktop top bar — landscape only */}
          <div className="hidden items-center justify-between gap-3 border-b border-border bg-background/95 px-5 py-2.5 backdrop-blur lg:landscape:flex">
            <div className="min-w-0">
              <p className="flex items-center gap-2 truncate text-xs text-muted-foreground">
                <span className="truncate">{items.find((item) => item.to === pathname)?.label ?? "Warehouse Wizard Enterprise WMS"}</span>
                <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium">v{__APP_VERSION__}</span>
              </p>
            </div>
            <div className="flex items-center gap-2">
              {canSwitchWarehouses ? (
                <Select
                  value={profile?.default_warehouse_id ?? (canSelectAllWarehouses ? "__all__" : "")}
                  onValueChange={(value) => warehouseSwitchMutation.mutate(value === "__all__" ? null : value)}
                  disabled={warehouseSwitchMutation.isPending}
                >
                  <SelectTrigger className="h-9 w-[13rem]">
                    <SelectValue placeholder="Select warehouse" />
                  </SelectTrigger>
                  <SelectContent>
                    {canSelectAllWarehouses ? (
                      <SelectItem value="__all__">All warehouses</SelectItem>
                    ) : null}
                    {headerWarehouses.map((warehouse: any) => (
                      <SelectItem key={warehouse.id} value={warehouse.id}>
                        {warehouse.code ? `${warehouse.code} - ${warehouse.name}` : warehouse.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : null}
              <HelpSidebar pathname={pathname} />
              <OfflineQueueBadge />
              <ProfileMenu initials={initials} displayName={displayName} onSignOut={() => void signOut()} />
            </div>
          </div>
          <div
            className={cn(
              "flex-1 min-h-0 min-w-0 px-4 pt-5 pb-[4.75rem] sm:px-5 lg:px-6 lg:landscape:pb-5",
              pathname === "/inventory-search" ? "overflow-hidden" : "overflow-y-auto",
            )}
          >
            {children}
          </div>
        </main>
      </div>
      <AccessRequestsBanner />
      <FailedTasksReminder />
    </div>
  );
}

export function FailedTasksReminder() {
  const { items, dismiss, dismissAll } = useDeadLetterQueue();
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    setActiveIndex(0);
  }, [items.length]);

  if (items.length === 0) return null;

  const item = items[Math.min(activeIndex, items.length - 1)];
  if (!item) return null;

  function describeItem(it: FailedWorkItem) {
    if (it.kind === "putaway") {
      const p = it.payload as { pallet: string; location: string; taskNumber?: string };
      return `Putaway${p.taskNumber ? ` #${p.taskNumber}` : ""} — pallet ${p.pallet} → ${p.location}`;
    }
    if (it.kind === "pick") {
      const p = it.payload as { palletBarcode: string; locationCode: string };
      return `Pick — pallet ${p.palletBarcode} at ${p.locationCode}`;
    }
    return it.kind;
  }

  const timestamp = new Date(item.failedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  return (
    <Dialog open>
      <DialogContent
        className="sm:max-w-md"
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <AlertCircle className="h-5 w-5 shrink-0" />
            {items.length === 1 ? "Offline task needs attention" : `${items.length} offline tasks need attention`}
          </DialogTitle>
          <DialogDescription>
            {items.length > 1
              ? `One or more actions saved while offline could not be submitted when you reconnected. Review each one and confirm whether the work is done.`
              : `An action saved while offline could not be submitted when you reconnected. Confirm whether the work is done.`}
          </DialogDescription>
        </DialogHeader>

        {items.length > 1 && (
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Item {activeIndex + 1} of {items.length}</span>
            <div className="flex gap-1">
              <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" disabled={activeIndex === 0} onClick={() => setActiveIndex((i) => i - 1)}>←</Button>
              <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" disabled={activeIndex >= items.length - 1} onClick={() => setActiveIndex((i) => i + 1)}>→</Button>
            </div>
          </div>
        )}

        <div className="rounded-md border border-border bg-muted/40 p-3 text-sm space-y-1.5">
          <p className="font-medium">{describeItem(item)}</p>
          <p className="text-xs text-muted-foreground">Failed at {timestamp} · {item.attempts} attempt{item.attempts === 1 ? "" : "s"}</p>
          <p className="text-xs text-destructive/80 break-words">{item.error}</p>
        </div>

        <DialogFooter className="flex-col gap-2 sm:flex-row">
          {items.length > 1 && (
            <Button
              variant="ghost"
              className="text-muted-foreground sm:mr-auto"
              onClick={() => void dismissAll()}
            >
              Mark all resolved
            </Button>
          )}
          <Button variant="outline" onClick={() => void dismiss(item.id)}>
            Mark resolved
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function AccessRequestsBanner() {
  const { roles } = useAuth();
  const navigate = useNavigate();
  const { toPath } = useTenantPath();
  const canSee = roles.some((r) => ["admin", "warehouse_manager", "warehouse_supervisor", "developer"].includes(r));
  const [dismissed, setDismissed] = useState<string[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      return JSON.parse(window.sessionStorage.getItem("dismissed-pending-requests") ?? "[]");
    } catch {
      return [];
    }
  });

  const { data: pending = [] } = useQuery({
    queryKey: ["pending-access-requests"],
    enabled: canSee,
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, email, created_at")
        .eq("approved", false)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as Array<{ id: string; full_name: string | null; email: string | null; created_at: string | null }>;
    },
  });

  const undismissed = useMemo(
    () => pending.filter((p) => !dismissed.includes(p.id)),
    [pending, dismissed],
  );
  const open = canSee && undismissed.length > 0;

  function dismissAll() {
    const next = Array.from(new Set([...dismissed, ...undismissed.map((p) => p.id)]));
    setDismissed(next);
    try {
      window.sessionStorage.setItem("dismissed-pending-requests", JSON.stringify(next));
    } catch {
      /* noop */
    }
  }

  function goToUsers() {
    dismissAll();
    navigate(toPath("/settings"));
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) dismissAll(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <UserPlus className="h-5 w-5" />
            {undismissed.length} access request{undismissed.length === 1 ? "" : "s"} awaiting approval
          </DialogTitle>
          <DialogDescription>
            New users have requested access to the warehouse. Review and approve them in Users &amp; Roles.
          </DialogDescription>
        </DialogHeader>
        <ul className="max-h-60 divide-y divide-border overflow-y-auto rounded border border-border">
          {undismissed.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
              <div className="min-w-0">
                <div className="truncate font-medium">{p.full_name?.trim() || p.email || "Unnamed user"}</div>
                {p.email && p.full_name ? (
                  <div className="truncate text-xs text-muted-foreground">{p.email}</div>
                ) : null}
              </div>
              <div className="shrink-0 text-xs text-muted-foreground">
                {p.created_at ? new Date(p.created_at).toLocaleDateString() : ""}
              </div>
            </li>
          ))}
        </ul>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={dismissAll}>Remind me later</Button>
          <Button onClick={goToUsers}>
            <Users className="mr-2 h-4 w-4" />
            Go to Users
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const NOTIFICATION_PROMPT_DISMISSED_SESSION_KEY = "warehouseWizard.notificationPrompt.dismissed";

/**
 * Soft, dismissible ask for browser notification permission — this is the
 * first of the two prompts. Clicking "Enable notifications" triggers the
 * real native browser permission popup (the second, unskippable prompt).
 * Browsers only allow that native popup to fire from a genuine user
 * gesture, so we can't skip straight to it; the banner is what gives the
 * click its context. Dismissing only suppresses it for the current session
 * (sessionStorage) — if the user still hasn't decided, it reappears next
 * session rather than nagging on every page within one.
 */
export function ReorderAlertNotificationPrompt() {
  const { supported, permission, requestPermission } = useNotificationPermission();
  const [dismissed, setDismissed] = useState(() => {
    if (typeof window === "undefined") return false;
    try {
      return window.sessionStorage.getItem(NOTIFICATION_PROMPT_DISMISSED_SESSION_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [requesting, setRequesting] = useState(false);

  function dismiss() {
    setDismissed(true);
    try {
      window.sessionStorage.setItem(NOTIFICATION_PROMPT_DISMISSED_SESSION_KEY, "1");
    } catch {
      // ignore storage failures — worst case the banner reappears
    }
  }

  async function handleEnable() {
    setRequesting(true);
    try {
      const result = await requestPermission();
      if (result === "granted") {
        toast.success("Notifications enabled — you'll get an alert when a product enters the reorder state.");
      } else if (result === "denied") {
        toast.message("Notifications blocked. You can turn them back on from your browser's site settings.");
      }
    } finally {
      setRequesting(false);
      dismiss();
    }
  }

  if (!supported || permission !== "default" || dismissed) return null;

  return (
    <div className="fixed bottom-20 right-4 z-40 w-[min(22rem,calc(100vw-2rem))] lg:landscape:bottom-4">
      <Card className="border-primary/40 shadow-lg">
        <CardContent className="flex items-start gap-3 p-3.5">
          <Bell className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">Get notified about reorder alerts</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Turn on browser notifications to hear about low-stock products as soon as they enter the reorder state.
            </p>
            <div className="mt-2.5 flex gap-2">
              <Button size="sm" disabled={requesting} onClick={() => void handleEnable()}>
                {requesting ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
                Enable notifications
              </Button>
              <Button size="sm" variant="ghost" onClick={dismiss}>Not now</Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export function ResourcePage({
  resource,
}: {
  resource: ResourceDefinition;
}) {
  const navigate = useNavigate();
  const { toPath } = useTenantPath();
  const { roles: viewerRoles } = useAuth();
  const canHardDelete = viewerRoles.some((r) => ["admin", "developer"].includes(r));
  const cascadeSupported = ["warehouses", "zones", "locations", "products", "clients"].includes(resource.table);
  const [includeHidden, setIncludeHidden] = useState(false);
  const [editRecord, setEditRecord] = useState<Record<string, unknown> | null>(null);
  const [filterQuery, setFilterQuery] = useState("");
  const lastTapRef = useRef<{ id: string; time: number } | null>(null);
  const [deleteRecord, setDeleteRecord] = useState<Record<string, unknown> | null>(null);
  const [deleteChallenge, setDeleteChallenge] = useState("");
  const [deleteBlockers, setDeleteBlockers] = useState<Array<{ table: string; count: number }> | null>(null);
  const cascadeMutation = useMutation({
    mutationFn: async (id: string) => deleteResourceCascade(resource.table, id),
    onSuccess: (result) => {
      if (result.ok) {
        toast.success(`${resource.singular} permanently deleted`);
        setDeleteRecord(null);
        setDeleteBlockers(null);
        setDeleteChallenge("");
        queryClient.invalidateQueries({ queryKey: [resource.table] });
        void invalidateWarehouseData(queryClient);
      } else {
        setDeleteBlockers(result.blocked_by);
        toast.error("Cannot delete — child records still reference this item.");
      }
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Delete failed"),
  });
  const useGearActions = ["warehouses", "zones", "locations", "products"].includes(resource.table);
  const hasWarehouseStructureShortcut = ["warehouses", "zones", "locations"].includes(resource.table);
  const { data = [], isLoading } = useQuery({
    queryKey: [resource.table, includeHidden],
    queryFn: () => listRecords(resource.table, resource.select ?? "*", resource.orderBy, {
      includeHidden,
      archiveField: resource.archiveField,
    }),
  });
  const { data: locationRowsForLabels = [] } = useQuery({
    queryKey: ["locations", "label-source"],
    enabled: resource.table === "zones",
    queryFn: () => listRecords("locations", "*", { column: "code" }),
  });
  const queryClient = useQueryClient();
  const hasTrailingLabelColumn = ["warehouses", "zones"].includes(resource.table);
  const extraColumnCount = (resource.supportsHide ? 1 : 0) + (hasTrailingLabelColumn ? 1 : 0) + 1 + (resource.table === "products" ? 1 : 0);
  const isProducts = resource.table === "products";
  const { data: productQtyRows = [] } = useQuery({
    queryKey: ["product-qty-totals"],
    enabled: isProducts,
    queryFn: async () => {
      const { data, error } = await (supabase.from as any)("inventory_balances")
        .select("product_id, available_quantity, quantity")
        .eq("status", "available")
        .gt("available_quantity", 0)
        .not("location_id", "is", null)
        .limit(10000);
      if (error) throw error;
      return data as Array<{ product_id: string; available_quantity: number | null; quantity: number | null }>;
    },
  });
  const productQtyMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of productQtyRows) {
      const qty = Number(r.available_quantity ?? r.quantity ?? 0);
      if (!r.product_id) continue;
      m.set(r.product_id, (m.get(r.product_id) ?? 0) + qty);
    }
    return m;
  }, [productQtyRows]);

  const hasProductRef = resource.fields.some((f) => f.name === "product_id");
  const { data: productOptions = [] } = useQuery({
    queryKey: ["products", "options-for-table"],
    queryFn: () => listRecords("products", "id, sku, name"),
    enabled: hasProductRef,
  });
  const productMap = useMemo(() => {
    const map = new Map<string, { sku: string; name: string }>();
    (productOptions as Array<{ id: string; sku: string; name: string }>).forEach((p) => {
      map.set(p.id, { sku: p.sku, name: p.name });
    });
    return map;
  }, [productOptions]);

  const hasClientRef = resource.fields.some((f) => f.name === "client_id" || f.name === "client_owner_id");
  const { data: clientOptions = [] } = useQuery({
    queryKey: ["clients", "options-for-table"],
    queryFn: () => listRecords("clients", "id, name"),
    enabled: hasClientRef,
  });
  const clientMap = useMemo(() => {
    const map = new Map<string, string>();
    (clientOptions as Array<{ id: string; name: string }>).forEach((c) => map.set(c.id, c.name));
    return map;
  }, [clientOptions]);

  const hasWarehouseRef = resource.fields.some((f) => f.name === "warehouse_id");
  const { data: warehouseOptions = [] } = useQuery({
    queryKey: ["warehouses", "options-for-table"],
    queryFn: () => listRecords("warehouses", "id, code, name"),
    enabled: hasWarehouseRef,
  });
  const warehouseMap = useMemo(() => {
    const map = new Map<string, string>();
    (warehouseOptions as Array<{ id: string; code: string; name: string }>).forEach((w) =>
      map.set(w.id, w.name ?? w.code),
    );
    return map;
  }, [warehouseOptions]);
  const warehouseInfoMap = useMemo(() => {
    const map = new Map<string, { code: string; name: string }>();
    (warehouseOptions as Array<{ id: string; code: string; name: string }>).forEach((w) =>
      map.set(w.id, { code: w.code, name: w.name }),
    );
    return map;
  }, [warehouseOptions]);

  const hasZoneRef = resource.fields.some((f) => f.name === "zone_id");
  const { data: zoneOptions = [] } = useQuery({
    queryKey: ["zones", "options-for-table"],
    queryFn: () => listRecords("zones", "id, code, name"),
    enabled: hasZoneRef,
  });
  const zoneMap = useMemo(() => {
    const map = new Map<string, string>();
    (zoneOptions as Array<{ id: string; code: string; name: string }>).forEach((z) =>
      map.set(z.id, z.name ?? z.code),
    );
    return map;
  }, [zoneOptions]);
  const zoneInfoMap = useMemo(() => {
    const map = new Map<string, { code: string; name: string }>();
    (zoneOptions as Array<{ id: string; code: string; name: string }>).forEach((z) =>
      map.set(z.id, { code: z.code, name: z.name }),
    );
    return map;
  }, [zoneOptions]);

  const filteredData = useMemo(() => {
    const q = filterQuery.trim().toLowerCase();
    if (!q) return data;
    return data.filter((row) =>
      resource.fields.some((field) => {
        const val = (row as Record<string, unknown>)[field.name];
        if (val == null) return false;
        return String(val).toLowerCase().includes(q);
      })
    );
  }, [data, filterQuery, resource.fields]);
  const tableFields = useMemo(() => {
    if (resource.table !== "locations") return resource.fields;
    const fieldMap = new Map(resource.fields.map((field) => [field.name, field]));
    const orderedNames = [
      "code",
      "warehouse_id",
      "zone_id",
      "aisle",
      "bay",
      "level",
      "depth",
      "location_type",
      "temperature_class",
      "max_pallets",
      "pick_sequence",
      "putaway_sequence",
      "mixed_sku_allowed",
      "mixed_lot_allowed",
      "max_height",
      "status",
      "notes",
    ];
    return [
      ...orderedNames.map((name) => fieldMap.get(name)).filter(Boolean),
      ...resource.fields.filter((field) => !orderedNames.includes(field.name)),
    ] as typeof resource.fields;
  }, [resource.fields, resource.table]);
  const bayLabelItems = useMemo(() => {
    if (resource.table !== "locations") return [] as LabelSheetItem[];
    const byCode = new Map<string, LabelSheetItem>();
    for (const row of filteredData as Array<Record<string, unknown>>) {
      const warehouse = warehouseInfoMap.get(String(row.warehouse_id ?? ""));
      const zone = zoneInfoMap.get(String(row.zone_id ?? ""));
      const aisle = normalizeScannerText(row.aisle);
      const bay = normalizeScannerText(row.bay);
      if (!warehouse?.code || !zone?.code || !aisle || !bay) continue;
      const code = `${normalizeScannerText(warehouse.code)}-${normalizeScannerText(zone.code)}-${aisle}-${bay}`;
      if (!byCode.has(code)) {
        byCode.set(code, {
          code,
          title: `Aisle ${aisle} · Bay ${bay}`,
          subtitle: `${zone.name ?? zone.code} · ${warehouse.name ?? warehouse.code}`,
        });
      }
    }
    return Array.from(byCode.values()).sort((a, b) => a.code.localeCompare(b.code));
  }, [filteredData, resource.table, warehouseInfoMap, zoneInfoMap]);
  const zoneAisleLabelItems = useMemo(() => {
    if (resource.table !== "zones") return [] as LabelSheetItem[];
    const visibleZoneIds = new Set((filteredData as Array<Record<string, unknown>>).map((row) => String(row.id ?? "")));
    const zoneById = new Map((filteredData as Array<Record<string, unknown>>).map((row) => [String(row.id ?? ""), row]));
    const byCode = new Map<string, LabelSheetItem>();
    for (const row of locationRowsForLabels as Array<Record<string, unknown>>) {
      const zoneId = String(row.zone_id ?? "");
      if (!visibleZoneIds.has(zoneId)) continue;
      const zone = zoneById.get(zoneId);
      const warehouse = warehouseInfoMap.get(String(row.warehouse_id ?? zone?.warehouse_id ?? ""));
      const zoneCode = normalizeScannerText(zone?.code);
      const zoneName = String(zone?.name ?? zoneCode);
      const aisle = normalizeScannerText(row.aisle);
      if (!warehouse?.code || !zoneCode || !aisle) continue;
      const code = `${normalizeScannerText(warehouse.code)}-${zoneCode}-${aisle}`;
      if (!byCode.has(code)) {
        byCode.set(code, {
          code,
          title: zoneName,
          subtitle: `${warehouse.name ?? warehouse.code} · Aisle ${aisle}`,
          aisle,
          temperatureClass: String(zone?.temperature_class ?? "ambient"),
        });
      }
    }
    return Array.from(byCode.values()).sort((a, b) => a.code.localeCompare(b.code));
  }, [filteredData, locationRowsForLabels, resource.table, warehouseInfoMap]);

  function handleRowPointerUp(row: unknown) {
    if (typeof window === "undefined" || !window.matchMedia("(pointer: coarse)").matches) return;
    const id = String((row as { id?: string }).id ?? JSON.stringify(row));
    const now = Date.now();
    if (lastTapRef.current?.id === id && now - lastTapRef.current.time < 450) {
      setEditRecord(row as Record<string, unknown>);
      lastTapRef.current = null;
      return;
    }
    lastTapRef.current = { id, time: now };
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h2 className="text-2xl font-semibold">{resource.title}</h2>
          <p className="text-sm text-muted-foreground">{resource.description} Double-click any row to edit. Double-tap on touch screens.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {useGearActions ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="icon" variant="outline" aria-label={`${resource.title} actions`}>
                  <Settings className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                {resource.exportable ? (
                  <DropdownMenuItem onClick={() => downloadCsv(`${resource.table}.csv`, data as Array<Record<string, unknown>>)}>
                    <Download className="mr-2 h-4 w-4" />
                    Export CSV
                  </DropdownMenuItem>
                ) : null}
                {resource.supportsHide ? (
                  <DropdownMenuItem onClick={() => setIncludeHidden((current) => !current)}>
                    {includeHidden ? <EyeOff className="mr-2 h-4 w-4" /> : <Eye className="mr-2 h-4 w-4" />}
                    {includeHidden ? "Hide archived" : "Show archived"}
                  </DropdownMenuItem>
                ) : null}
                {resource.importable ? (
                  <>
                    <DropdownMenuSeparator />
                    <ImportButton resource={resource} asMenuItems />
                  </>
                ) : null}
                {resource.table === "locations" ? (
                  <LocationWizardDialog
                    trigger={
                      <DropdownMenuItem onSelect={(event) => event.preventDefault()}>
                        <MapPinned className="mr-2 h-4 w-4" />
                        Location wizard
                      </DropdownMenuItem>
                    }
                  />
                ) : null}
                {["locations", "zones"].includes(resource.table) ? (
                  <LabelSheetPrintDialog
                    resourceLabel={resource.singular}
                    kind={resource.table === "zones" ? "zone" : "location"}
                    items={resource.table === "zones"
                      ? zoneAisleLabelItems
                      : (filteredData as Array<Record<string, unknown>>).map((row): LabelSheetItem => {
                        const warehouse = warehouseInfoMap.get(String((row as any).warehouse_id ?? ""));
                        const zone = zoneInfoMap.get(String((row as any).zone_id ?? ""));
                        return {
                          code: String((row as any).code ?? (row as any).id ?? ""),
                          title: (row as any).name ? String((row as any).name) : null,
                          aisle: String((row as any).aisle ?? ""),
                          bay: String((row as any).bay ?? ""),
                          level: (row as any).level as number | string | null,
                          locationType: String((row as any).location_type ?? ""),
                          temperatureClass: String((row as any).temperature_class ?? "ambient"),
                          warehouseName: warehouse?.name ?? warehouse?.code ?? null,
                          zoneName: zone?.name ?? zone?.code ?? null,
                        };
                      })}
                    trigger={
                      <DropdownMenuItem onSelect={(event) => event.preventDefault()}>
                        <Printer className="mr-2 h-4 w-4" />
                        {resource.table === "locations" ? "Print location labels sheet" : "Print zone labels sheet"}
                      </DropdownMenuItem>
                    }
                  />
                ) : null}
                {resource.table === "locations" ? (
                  <BayLocationCodesPrintDialog
                    items={bayLabelItems}
                    trigger={
                      <DropdownMenuItem onSelect={(event) => event.preventDefault()}>
                        <QrCode className="mr-2 h-4 w-4" />
                        Print bay location codes
                      </DropdownMenuItem>
                    }
                  />
                ) : null}
                {hasWarehouseStructureShortcut ? (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => navigate(toPath("/settings?tab=warehouse-structure"))}>
                      <Network className="mr-2 h-4 w-4" />
                      Warehouse Structure
                    </DropdownMenuItem>
                  </>
                ) : null}
                <ResourceFormDialog
                  resource={resource}
                  trigger={
                    <DropdownMenuItem onSelect={(event) => event.preventDefault()}>
                      <Plus className="mr-2 h-4 w-4" />
                      Add {resource.singular}
                    </DropdownMenuItem>
                  }
                />
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <>
              {resource.exportable ? (
                <Button variant="outline" onClick={() => downloadCsv(`${resource.table}.csv`, data as Array<Record<string, unknown>>)}>
                  <Download data-icon="inline-start" />
                  Export CSV
                </Button>
              ) : null}
              {resource.supportsHide ? (
                <Button variant="outline" onClick={() => setIncludeHidden((current) => !current)}>
                  {includeHidden ? <EyeOff data-icon="inline-start" /> : <Eye data-icon="inline-start" />}
                  {includeHidden ? "Hide archived" : "Show archived"}
                </Button>
              ) : null}
              {resource.importable ? <ImportButton resource={resource} /> : null}
              {resource.table === "locations" ? <LocationWizardDialog /> : null}
              <ResourceFormDialog resource={resource} />
            </>
          )}
        </div>
      </div>

      {/* Search bar — client-side filter across all text fields */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground pointer-events-none" />
        <Input
          className="h-9 pl-9 pr-20 bg-muted"
          placeholder={`Search ${resource.title.toLowerCase()}…`}
          value={filterQuery}
          onChange={(e) => setFilterQuery(e.target.value)}
        />
        {filterQuery ? (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground select-none">
            {filteredData.length} / {data.length}
          </span>
        ) : (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground select-none">
            {isLoading ? "" : `${data.length} rows`}
          </span>
        )}
      </div>

      <Card>
        <CardContent className="p-0">
          <TableFrame>
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-card">
                <TableRow>
                  {tableFields.map((field) => (
                    <Fragment key={field.name}>
                      {resource.table === "locations" && field.name === "max_pallets" ? (
                        <TableHead className="w-28">Label</TableHead>
                      ) : null}
                      <TableHead>{field.label}</TableHead>
                      {isProducts && field.name === "name" ? (
                        <TableHead className="w-20 text-right">Qty</TableHead>
                      ) : null}
                    </Fragment>
                  ))}
                  {hasTrailingLabelColumn ? <TableHead className="w-28">Label</TableHead> : null}
                  {resource.supportsHide ? <TableHead className="w-32">Visibility</TableHead> : null}
                  <TableHead className="w-16" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell className="h-24 text-center text-muted-foreground" colSpan={tableFields.length + extraColumnCount + (resource.table === "locations" ? 1 : 0)}>
                      Loading {resource.title.toLowerCase()}...
                    </TableCell>
                  </TableRow>
                ) : filteredData.length === 0 ? (
                  <TableRow>
                    <TableCell className="h-24 text-center text-muted-foreground" colSpan={tableFields.length + extraColumnCount + (resource.table === "locations" ? 1 : 0)}>
                      {filterQuery ? `No ${resource.title.toLowerCase()} matched "${filterQuery}".` : `No ${resource.title.toLowerCase()} found.`}
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredData.map((row) => (
                    <TableRow
                      key={(row as { id?: string }).id ?? JSON.stringify(row)}
                      className="even:bg-muted/30 cursor-pointer"
                      onDoubleClick={() => setEditRecord(row as Record<string, unknown>)}
                      onPointerUp={() => handleRowPointerUp(row)}
                    >
                      {tableFields.map((field) => {
                        const rawValue = (row as Record<string, unknown>)[field.name];
                        let displayValue: React.ReactNode;
                        if (rawValue == null || rawValue === "") {
                          displayValue = <span className="text-muted-foreground">—</span>;
                        } else if (field.type === "boolean") {
                          displayValue = <Badge variant={rawValue ? "default" : "secondary"}>{rawValue ? "Yes" : "No"}</Badge>;
                        } else if (field.type === "date") {
                          displayValue = formatDate(String(rawValue));
                        } else if (field.name === "status" && resource.table === "locations") {
                          const sv = String(rawValue);
                          const variant =
                            sv === "active" ? "default"
                            : sv === "maintenance" ? "outline"
                            : "destructive";
                          const label =
                            sv === "active" ? "Active"
                            : sv === "maintenance" ? "Maintenance"
                            : sv === "blocked" ? "Blocked"
                            : sv === "disabled" ? "Disabled"
                            : sv;
                          displayValue = <Badge variant={variant} className={sv === "maintenance" ? "border-amber-400 text-amber-600" : undefined}>{label}</Badge>;
                        } else if (field.type === "select" && field.options) {
                          displayValue = field.options.find((o) => o.value === String(rawValue))?.label ?? String(rawValue);
                        } else if (field.name === "product_id") {
                          const p = productMap.get(String(rawValue));
                          displayValue = p ? `${p.sku} - ${p.name}` : String(rawValue);
                        } else if (field.name === "client_id" || field.name === "client_owner_id") {
                          displayValue = clientMap.get(String(rawValue)) ?? String(rawValue);
                        } else if (field.name === "warehouse_id") {
                          displayValue = warehouseMap.get(String(rawValue)) ?? String(rawValue);
                        } else if (field.name === "zone_id") {
                          displayValue = zoneMap.get(String(rawValue)) ?? String(rawValue);
                        } else if (field.type === "textarea") {
                          const text = String(rawValue);
                          displayValue = text.length > 60 ? <span title={text}>{text.slice(0, 60)}…</span> : text;
                        } else {
                          displayValue = String(rawValue);
                        }
                        const cell = <TableCell key={field.name}>{displayValue}</TableCell>;
                        if (resource.table === "locations" && field.name === "max_pallets") {
                          return (
                            <Fragment key={field.name}>
                              <TableCell className="w-28">
                                <LocationLabelPage
                                  code={String((row as Record<string, unknown>).code ?? "")}
                                  aisle={(row as Record<string, unknown>).aisle as string | null}
                                  bay={(row as Record<string, unknown>).bay as string | null}
                                  level={(row as Record<string, unknown>).level as number | null}
                                  locationType={(row as Record<string, unknown>).location_type as string | null}
                                  temperatureClass={String((row as Record<string, unknown>).temperature_class ?? "ambient")}
                                  warehouseCode={warehouseInfoMap.get(String((row as Record<string, unknown>).warehouse_id))?.code}
                                  zoneCode={zoneInfoMap.get(String((row as Record<string, unknown>).zone_id))?.code}
                                  warehouseName={warehouseInfoMap.get(String((row as Record<string, unknown>).warehouse_id))?.name}
                                  zoneName={zoneInfoMap.get(String((row as Record<string, unknown>).zone_id))?.name}
                                />
                              </TableCell>
                              {cell}
                            </Fragment>
                          );
                        }
                        if (isProducts && field.name === "name") {
                          const qty = productQtyMap.get(String((row as Record<string, unknown>).id ?? "")) ?? 0;
                          return (
                            <Fragment key={field.name}>
                              {cell}
                              <TableCell className="w-20 whitespace-nowrap text-right font-mono text-xs font-semibold">
                                {formatNumber(qty)}
                              </TableCell>
                            </Fragment>
                          );
                        }
                        return cell;
                      })}
                      {hasTrailingLabelColumn ? (
                        <TableCell>
                          <div className="flex items-center gap-1">
                            {resource.table === "warehouses" ? (
                                <BarcodePrintDialog
                                  labelType="warehouse"
                                  code={String((row as Record<string, unknown>).code ?? "")}
                                  title={String((row as Record<string, unknown>).name ?? (row as Record<string, unknown>).code ?? resource.singular)}
                                />
                              ) : resource.table === "zones" ? (
                                  <ZoneLabelPage
                                    code={String((row as Record<string, unknown>).code ?? "")}
                                    name={String((row as Record<string, unknown>).name ?? (row as Record<string, unknown>).code ?? "")}
                                    temperatureClass={String((row as Record<string, unknown>).temperature_class ?? "ambient")}
                                    isStaging={Boolean((row as Record<string, unknown>).is_staging)}
                                    isDispatch={Boolean((row as Record<string, unknown>).is_dispatch)}
                                    isQuarantine={Boolean((row as Record<string, unknown>).is_quarantine)}
                                    trigger={
                                      <Button size="sm" variant="outline">
                                        <QrCode className="mr-2 h-4 w-4" />
                                        Print label
                                      </Button>
                                    }
                                  />
                              ) : null}
                          </div>
                        </TableCell>
                      ) : null}
                      {resource.supportsHide ? (
                        <TableCell>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={async (e) => {
                              e.stopPropagation();
                              try {
                                const record = row as Record<string, unknown> & { id?: string };
                                const id = record.id;
                                if (!id || !resource.archiveField) return;
                                assertOnline();
                                const hidden = resource.archiveField === "active" ? record.active !== false : record.is_hidden === true;
                                await setResourceVisibility(resource.table, id, resource.archiveField, !hidden, !hidden ? "Hidden from UI" : undefined);
                                toast.success(hidden ? `${resource.singular} restored` : `${resource.singular} hidden`);
                                queryClient.invalidateQueries({ queryKey: [resource.table] });
                              } catch (error) {
                                toast.error(error instanceof Error ? error.message : "Visibility update failed");
                              }
                            }}
                          >
                            {((resource.archiveField === "active" ? (row as Record<string, unknown>).active !== false : (row as Record<string, unknown>).is_hidden === true))
                              ? "Restore"
                              : "Hide"}
                          </Button>
                        </TableCell>
                      ) : null}
                      <TableCell>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 w-7 p-0"
                          onClick={(e) => { e.stopPropagation(); setEditRecord(row as Record<string, unknown>); }}
                          title={`Edit ${resource.singular}`}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        {cascadeSupported && canHardDelete ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="ml-1 h-7 w-7 p-0 text-destructive hover:text-destructive"
                            onClick={(e) => { e.stopPropagation(); setDeleteBlockers(null); setDeleteChallenge(""); setDeleteRecord(row as Record<string, unknown>); }}
                            title={`Delete ${resource.singular} permanently`}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </TableFrame>
        </CardContent>
      </Card>

      {editRecord ? (
        <ResourceEditDialog resource={resource} editRecord={editRecord} onClose={() => setEditRecord(null)} />
      ) : null}
      <Dialog
        open={!!deleteRecord}
        onOpenChange={(o) => { if (!o && !cascadeMutation.isPending) { setDeleteRecord(null); setDeleteBlockers(null); setDeleteChallenge(""); } }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-destructive">Delete {resource.singular} permanently</DialogTitle>
            <DialogDescription>
              {(() => {
                const r = (deleteRecord as Record<string, unknown> | null) ?? {};
                const label = String((r as { name?: string }).name ?? (r as { code?: string }).code ?? (r as { sku?: string }).sku ?? "this record");
                return <>This will permanently remove <span className="font-medium">{label}</span>. This action cannot be undone.</>;
              })()}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 text-sm">
            <p className="text-muted-foreground">
              Permanent delete is only allowed when no other records reference this {resource.singular.toLowerCase()}.
              If child records exist they must be removed or reassigned first.
            </p>
            {deleteBlockers && deleteBlockers.length > 0 ? (
              <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3">
                <p className="font-medium text-destructive">Cannot delete — still referenced by:</p>
                <ul className="mt-1 list-disc pl-5 text-destructive/90">
                  {deleteBlockers.map((b) => (
                    <li key={b.table}>{b.count} × {b.table.replace(/_/g, " ")}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            <div className="grid gap-1.5 pt-1">
              <label htmlFor="delete-challenge" className="text-sm font-medium">
                Type <span className="font-mono font-semibold">DELETE</span> to confirm
              </label>
              <Input
                id="delete-challenge"
                value={deleteChallenge}
                onChange={(e) => setDeleteChallenge(e.target.value)}
                autoComplete="off"
                autoFocus
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setDeleteRecord(null); setDeleteBlockers(null); setDeleteChallenge(""); }} disabled={cascadeMutation.isPending}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={cascadeMutation.isPending || deleteChallenge.trim() !== "DELETE" || !deleteRecord}
              onClick={() => {
                const id = (deleteRecord as { id?: string } | null)?.id;
                if (id) cascadeMutation.mutate(id);
              }}
            >
              {cascadeMutation.isPending ? <Loader2 className="animate-spin" /> : <Trash2 data-icon="inline-start" />}
              Delete permanently
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Inferred-field override state for product imports ────────────────────────
type ProductOverrides = {
  temperature_requirement: string;
  rotation_method: string;
  expiry_tracked: boolean;
  lot_tracked: boolean;
  batch_tracked: boolean;
};

function applyOverridesToPreview(preview: ImportPreview, overrides: ProductOverrides): ImportPreview {
  if (preview.resourceTable !== "products") return preview;
  const rows = preview.rows.map((r) => {
    if (!r.normalized || !r.inferred) return r;
    const updated = {
      ...r.normalized,
      temperature_requirement: overrides.temperature_requirement,
      rotation_method: overrides.rotation_method,
      expiry_tracked: overrides.expiry_tracked,
      lot_tracked: overrides.lot_tracked,
      batch_tracked: overrides.batch_tracked,
    };
    return { ...r, normalized: updated };
  });
  return { ...preview, rows };
}

export function ImportButton({ resource, asMenuItems = false }: { resource: ResourceDefinition; asMenuItems?: boolean }) {
  const queryClient = useQueryClient();
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [parsing, setParsing] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [overrides, setOverrides] = useState<ProductOverrides | null>(null);

  function handleImport() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".csv";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      setParsing(true);
      try {
        const p = await parseCsvForResource(resource, file);
        setPreview(p);
        // Seed overrides from the first inferred row so the panel has sensible defaults
        if (resource.table === "products") {
          const firstInferred = p.rows.find((r) => r.inferred);
          if (firstInferred?.inferred) {
            const inf = firstInferred.inferred;
            setOverrides({
              temperature_requirement: inf.temperature_requirement,
              rotation_method: inf.rotation_method,
              expiry_tracked: inf.expiry_tracked,
              lot_tracked: inf.lot_tracked,
              batch_tracked: inf.batch_tracked,
            });
          } else {
            setOverrides({ temperature_requirement: "ambient", rotation_method: "fifo", expiry_tracked: false, lot_tracked: false, batch_tracked: false });
          }
        }
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Could not parse CSV");
      } finally {
        setParsing(false);
      }
    };
    input.click();
  }

  async function handleConfirm() {
    if (!preview) return;
    const finalPreview = (resource.table === "products" && overrides)
      ? applyOverridesToPreview(preview, overrides)
      : preview;
    setCommitting(true);
    try {
      const result = await commitImportRows(resource, finalPreview);
      if (result.failed > 0) {
        downloadCsv(`${resource.table}-errors.csv`, result.errors);
        toast.error(`Imported ${result.inserted}, failed ${result.failed} — error report downloaded`);
      } else {
        toast.success(`Imported ${result.inserted} ${resource.title.toLowerCase()}`);
      }
      setPreview(null);
      setOverrides(null);
      await queryClient.invalidateQueries({ queryKey: ["records", resource.table] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Import failed");
    } finally {
      setCommitting(false);
    }
  }

  if (asMenuItems) {
    return (
      <>
        <DropdownMenuItem onClick={() => downloadCsvTemplate(resource)}>
          <FileDown className="mr-2 h-4 w-4" />
          Template
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={(event) => { event.preventDefault(); handleImport(); }} disabled={parsing}>
          <Upload className="mr-2 h-4 w-4" />
          {parsing ? "Parsing…" : "Import CSV"}
        </DropdownMenuItem>
        <ImportPreviewDialog
          resource={resource}
          preview={preview}
          overrides={overrides}
          onOverridesChange={setOverrides}
          onCancel={() => { setPreview(null); setOverrides(null); }}
          onConfirm={handleConfirm}
          committing={committing}
        />
      </>
    );
  }

  return (
    <>
      <Button variant="outline" onClick={() => downloadCsvTemplate(resource)}>
        <FileDown data-icon="inline-start" />
        Template
      </Button>
      <Button
        variant="outline"
        onClick={handleImport}
        disabled={parsing}
      >
        <Upload data-icon="inline-start" />
        {parsing ? "Parsing…" : "Import CSV"}
      </Button>
      <ImportPreviewDialog
        resource={resource}
        preview={preview}
        overrides={overrides}
        onOverridesChange={setOverrides}
        onCancel={() => { setPreview(null); setOverrides(null); }}
        onConfirm={handleConfirm}
        committing={committing}
      />
    </>
  );
}

const TEMP_OPTIONS = [
  { label: "Ambient", value: "ambient" },
  { label: "Cool", value: "cool" },
  { label: "Frozen", value: "frozen" },
];
const ROTATION_OPTIONS = [
  { label: "FEFO — First Expired First Out", value: "fefo" },
  { label: "FIFO — First In First Out", value: "fifo" },
];

function ImportPreviewDialog({
  resource,
  preview,
  overrides,
  onOverridesChange,
  onCancel,
  onConfirm,
  committing,
}: {
  resource: ResourceDefinition;
  preview: ImportPreview | null;
  overrides: ProductOverrides | null;
  onOverridesChange: (o: ProductOverrides) => void;
  onCancel: () => void;
  onConfirm: () => void;
  committing: boolean;
}) {
  const open = preview !== null;
  const summary = preview?.summary ?? { total: 0, valid: 0, invalid: 0 };
  const isProducts = resource.table === "products";

  // Determine which inferred categories appear in this file
  const inferredCategories = useMemo(() => {
    if (!preview || !isProducts) return [];
    const seen = new Map<string, number>();
    for (const r of preview.rows) {
      if (r.inferred) seen.set(r.inferred.label, (seen.get(r.inferred.label) ?? 0) + 1);
    }
    return Array.from(seen.entries()).map(([label, count]) => ({ label, count }));
  }, [preview, isProducts]);

  const hasInferred = inferredCategories.length > 0;

  // Show all non-select fields for products, all fields for others
  const previewCols = isProducts
    ? ["sku", "barcode", "name", "description", "temperature_requirement", "rotation_method", "expiry_tracked", "lot_tracked", "batch_tracked", "active"]
    : resource.fields.map((f) => f.name);

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !committing) onCancel(); }}>
      <DialogContent className="flex flex-col w-[95vw] max-w-[95vw] h-[90vh] max-h-[90vh] p-0 gap-0">
        {/* ── Header ── */}
        <div className="flex-none px-6 pt-6 pb-3 border-b">
          <DialogHeader>
            <DialogTitle>Review {resource.title} import</DialogTitle>
            <DialogDescription>
              Rows are validated before anything is written. IDs and timestamps are ignored — new records get fresh IDs.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-wrap gap-2 mt-3 text-sm">
            <Badge variant="secondary">Total {summary.total}</Badge>
            <Badge className="bg-emerald-600 text-white hover:bg-emerald-600">Valid {summary.valid}</Badge>
            {summary.invalid > 0 && <Badge variant="destructive">Errors {summary.invalid}</Badge>}
            {hasInferred && <Badge className="bg-amber-500 text-white hover:bg-amber-500">Auto-categorised {inferredCategories.reduce((s, c) => s + c.count, 0)}</Badge>}
          </div>
        </div>

        {/* ── Scrollable body ── */}
        <div className="flex-1 overflow-hidden flex flex-col min-h-0 px-6 py-3 gap-3">
          {/* Auto-categorisation override panel */}
          {isProducts && hasInferred && overrides && (
            <div className="flex-none rounded-md border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30 p-3 space-y-3">
              <div className="flex items-start gap-2">
                <Info className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                <div className="text-sm text-amber-800 dark:text-amber-300">
                  <span className="font-medium">Fields were inferred from product names.</span>{" "}
                  Detected: {inferredCategories.map((c) => `${c.label} (${c.count})`).join(", ")}.
                  Adjust below to apply different defaults to all auto-categorised rows before importing.
                </div>
              </div>
              <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Temperature</label>
                  <select
                    className="w-full rounded border bg-background px-2 py-1 text-sm"
                    value={overrides.temperature_requirement}
                    onChange={(e) => onOverridesChange({ ...overrides, temperature_requirement: e.target.value })}
                  >
                    {TEMP_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Rotation</label>
                  <select
                    className="w-full rounded border bg-background px-2 py-1 text-sm"
                    value={overrides.rotation_method}
                    onChange={(e) => onOverridesChange({ ...overrides, rotation_method: e.target.value })}
                  >
                    {ROTATION_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
                <div className="flex items-center gap-4 col-span-2 pt-1">
                  {(["expiry_tracked", "lot_tracked", "batch_tracked"] as const).map((f) => (
                    <label key={f} className="flex items-center gap-1.5 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={overrides[f]}
                        onChange={(e) => onOverridesChange({ ...overrides, [f]: e.target.checked })}
                        className="h-3.5 w-3.5 accent-amber-600"
                      />
                      <span className="text-xs">{f.replace(/_/g, " ")}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Table: scroll both axes */}
          <div className="flex-1 min-h-0 overflow-auto rounded border">
            <Table className="min-w-max text-xs">
              <TableHeader className="sticky top-0 z-10 bg-background">
                <TableRow>
                  <TableHead className="w-10 sticky left-0 bg-background z-20">#</TableHead>
                  <TableHead className="w-20 sticky left-10 bg-background z-20">Status</TableHead>
                  {previewCols.map((c) => (
                    <TableHead key={c} className="whitespace-nowrap px-3">{c}</TableHead>
                  ))}
                  <TableHead className="min-w-[200px]">Notes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {preview?.rows.map((r) => {
                  const effectiveNormalized = (isProducts && overrides && r.inferred && r.normalized)
                    ? { ...r.normalized, ...overrides }
                    : r.normalized;
                  return (
                    <TableRow key={r.rowNumber} className={r.inferred ? "bg-amber-50/40 dark:bg-amber-950/20" : undefined}>
                      <TableCell className="font-mono sticky left-0 bg-inherit">{r.rowNumber}</TableCell>
                      <TableCell className="sticky left-10 bg-inherit">
                        {effectiveNormalized
                          ? <Badge className="bg-emerald-600 text-white hover:bg-emerald-600 text-[10px] px-1.5">{r.inferred ? "Auto" : "OK"}</Badge>
                          : <Badge variant="destructive" className="text-[10px] px-1.5">Error</Badge>}
                      </TableCell>
                      {previewCols.map((c) => {
                        const val = String((effectiveNormalized?.[c] ?? r.raw[c]) ?? "");
                        const wasInferred = r.inferred && effectiveNormalized && c in (r.inferred as object) && !(c in r.raw || r.raw[c]);
                        return (
                          <TableCell key={c} className={`whitespace-nowrap px-3 ${wasInferred ? "text-amber-700 dark:text-amber-400 font-medium" : ""}`}>
                            {val === "true" ? "✓" : val === "false" ? "–" : val}
                          </TableCell>
                        );
                      })}
                      <TableCell className="text-muted-foreground min-w-[200px]">
                        {r.errors.length > 0
                          ? <span className="text-destructive">{r.errors.join("; ")}</span>
                          : r.warnings.filter((w) => !w.startsWith("Auto-categorised")).join("; ")}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </div>

        {/* ── Footer ── */}
        <div className="flex-none px-6 py-4 border-t flex justify-end gap-2">
          <Button variant="outline" onClick={onCancel} disabled={committing}>Cancel</Button>
          <Button onClick={onConfirm} disabled={committing || summary.valid === 0}>
            {committing ? <Loader2 className="animate-spin" /> : <Upload data-icon="inline-start" />}
            Import {summary.valid} row{summary.valid === 1 ? "" : "s"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export interface LocationWizardDialogProps {
  trigger?: React.ReactNode | null;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  defaultWarehouseId?: string;
  defaultZoneId?: string;
}

export function LocationWizardDialog({
  trigger,
  open: openProp,
  onOpenChange,
  defaultWarehouseId,
  defaultZoneId,
}: LocationWizardDialogProps = {}) {
  const queryClient = useQueryClient();
  const { profile } = useAuth();
  const { data: options } = useQuery({ queryKey: ["options", "location-wizard"], queryFn: () => fetchOptions() });
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = openProp !== undefined;
  const open = isControlled ? !!openProp : internalOpen;
  const setOpen = (next: boolean) => {
    if (!isControlled) setInternalOpen(next);
    onOpenChange?.(next);
  };

  const resolvedDefaultWarehouseId = useMemo(() => {
    const warehouses = options?.warehouses ?? [];
    if (defaultWarehouseId && warehouses.some((warehouse: any) => warehouse.id === defaultWarehouseId)) {
      return defaultWarehouseId;
    }
    const profileWarehouseId = profile?.default_warehouse_id;
    if (profileWarehouseId && warehouses.some((warehouse: any) => warehouse.id === profileWarehouseId)) {
      return profileWarehouseId;
    }
    return warehouses.length === 1 ? String((warehouses[0] as any).id ?? "") : "";
  }, [defaultWarehouseId, options?.warehouses, profile?.default_warehouse_id]);

  const resolvedDefaultZoneId = useMemo(() => {
    if (!resolvedDefaultWarehouseId) return "";
    const zones = (options?.zones ?? []).filter((zone: any) => zone.warehouse_id === resolvedDefaultWarehouseId);
    if (defaultZoneId && zones.some((zone: any) => zone.id === defaultZoneId)) {
      return defaultZoneId;
    }
    return zones.length > 0 ? String((zones[0] as any).id ?? "") : "";
  }, [defaultZoneId, options?.zones, resolvedDefaultWarehouseId]);

  const buildDefaults = useCallback(
    (): LocationWizardValues => ({
      warehouse_id: resolvedDefaultWarehouseId,
      zone_id: resolvedDefaultZoneId,
      prefix: "A",
      start_bay: 1,
      end_bay: 10,
      levels: 3,
      positions_per_level: 1,
      depth: 1,
      level_letters: false,
      location_type: "rack",
      temperature_class: "ambient",
      mixed_sku_allowed: false,
      mixed_lot_allowed: false,
      level_style: "numeric",
    }),
    [resolvedDefaultWarehouseId, resolvedDefaultZoneId],
  );

  const form = useForm<LocationWizardValues>({
    resolver: zodResolver(locationWizardSchema),
    defaultValues: buildDefaults(),
  });

  const selectedWarehouseId = form.watch("warehouse_id");
  const prevWarehouseRef = useRef(selectedWarehouseId);

  // Reset form to prefilled defaults whenever the dialog opens.
  useEffect(() => {
    if (open) {
      const next = buildDefaults();
      form.reset(next);
      prevWarehouseRef.current = next.warehouse_id;
    }
  }, [open, buildDefaults, form]);

  // Clear zone only when the user actually changes the warehouse (not on prefill).
  useEffect(() => {
    if (prevWarehouseRef.current !== selectedWarehouseId) {
      if (prevWarehouseRef.current !== "") {
        form.setValue("zone_id", "");
      }
      prevWarehouseRef.current = selectedWarehouseId;
    }
  }, [selectedWarehouseId, form]);

  const filteredZones = (options?.zones ?? []).filter(
    (zone: any) => zone.warehouse_id === selectedWarehouseId,
  );

  useEffect(() => {
    if (!open || !selectedWarehouseId || form.getValues("zone_id") || filteredZones.length === 0) return;
    const fallbackZoneId = resolvedDefaultZoneId || String((filteredZones[0] as any).id ?? "");
    if (fallbackZoneId) {
      form.setValue("zone_id", fallbackZoneId, { shouldValidate: true });
    }
  }, [filteredZones, form, open, resolvedDefaultZoneId, selectedWarehouseId]);

  const locationCount =
    Math.max((form.watch("end_bay") ?? 1) - (form.watch("start_bay") ?? 1) + 1, 0) *
    Math.max(form.watch("levels") ?? 1, 1) *
    Math.max(form.watch("positions_per_level") ?? 1, 1);

  // Representative code (level 2) reflecting the current style + position settings.
  const samplePositions = Math.max(form.watch("positions_per_level") ?? 1, 1);
  const samplePrefix = (form.watch("prefix") || "A").toUpperCase();
  const sampleBay = String(Math.max(form.watch("start_bay") ?? 1, 1)).padStart(2, "0");
  const sampleLevelSeg = form.watch("level_style") === "letters" ? "B" : "L02";
  const samplePreview =
    samplePositions > 1
      ? `${samplePrefix}-${sampleBay}-${sampleLevelSeg}-P1`
      : `${samplePrefix}-${sampleBay}-${sampleLevelSeg}`;

  const mutation = useMutation({
    mutationFn: async (values: LocationWizardValues) => {
      const levelStyle: "numeric" | "alpha" = values.level_style === "letters" ? "alpha" : "numeric";
      let hasLevelStyleColumn = true;

      // Guard: a zone (and therefore each bay within it) must use a single level
      // style. Different zones in the same warehouse may differ. The DB trigger is
      // authoritative; this pre-check gives a clean message before any rows are written.
      const { data: existing, error: existingError } = await (supabase.from as any)("locations")
        .select("level_style, aisle, bay")
        .eq("zone_id", values.zone_id);
      if (existingError) {
        const missingLevelStyleColumn =
          (existingError as { code?: string; message?: string }).code === "42703" &&
          String((existingError as { message?: string }).message ?? "").includes("level_style");
        if (!missingLevelStyleColumn) throw existingError;
        hasLevelStyleColumn = false;
      } else {
        const styleOf = (row: any): "numeric" | "alpha" => (row?.level_style === "alpha" ? "alpha" : "numeric");
        const zoneConflict = (existing ?? []).some((row: any) => styleOf(row) !== levelStyle);
        if (zoneConflict) {
          const existingLabel = levelStyle === "alpha" ? "numbered (L01, L02\u2026)" : "lettered (A, B, C\u2026)";
          throw new Error(
            `This zone already uses ${existingLabel} levels. A zone and its bays must use one level style. ` +
              `Turn the level-letters switch the other way, or pick a different zone.`,
          );
        }
      }

      const expanded = expandLocationRange({
        prefix: values.prefix,
        startBay: values.start_bay,
        endBay: values.end_bay,
        positionsPerLevel: values.positions_per_level,
        levels: values.levels,
        depth: values.depth,
        levelStyle: values.level_style,
      });
      const rows = expanded.map((row) => ({
        warehouse_id: values.warehouse_id,
        zone_id: values.zone_id,
        code: row.localCode,
        aisle: row.aisle,
        bay: row.bay,
        level: row.level,
        position: row.position,
        depth: row.depth,
        max_pallets: row.maxPallets,
        location_type: values.location_type,
        temperature_class: values.temperature_class,
        mixed_sku_allowed: values.mixed_sku_allowed,
        mixed_lot_allowed: values.mixed_lot_allowed,
        status: "active",
        ...(hasLevelStyleColumn ? { level_style: row.levelStyle } : {}),
      }));

      // Skip rows whose code already exists (unique constraint on locations.code).
      const candidateCodes = Array.from(new Set(rows.flatMap((row) => (
        row.position === 1 && !String(row.code).match(/-P\d+$/i)
          ? [row.code, `${row.code}-P1`]
          : [row.code]
      ))));
      const { data: existingRows } = await supabase
        .from("locations")
        .select("code")
        .in("code", candidateCodes);
      const existingCodes = new Set((existingRows ?? []).map((r: any) => String(r.code).toUpperCase()));
      const toInsert = rows.filter((row) => {
        const code = String(row.code).toUpperCase();
        const legacyP1 = row.position === 1 && !code.match(/-P\d+$/i) ? `${code}-P1` : "";
        return !existingCodes.has(code) && (!legacyP1 || !existingCodes.has(legacyP1));
      });

      let created = 0;
      if (toInsert.length > 0) {
        const { error, count } = await (supabase.from("locations") as any)
          .insert(toInsert, { count: "exact" });
        if (error) throw error;
        created = count ?? toInsert.length;
      }
      return { created, skipped: existingCodes.size, total: rows.length };
    },
    onSuccess: async ({ created, skipped, total }) => {
      if (created > 0 && skipped === 0) {
        toast.success(`Created ${created} location${created !== 1 ? "s" : ""}`);
      } else if (created > 0 && skipped > 0) {
        toast.success(
          `Created ${created} location${created !== 1 ? "s" : ""} (skipped ${skipped} duplicate${skipped !== 1 ? "s" : ""} of ${total})`,
        );
      } else {
        toast.message(`No new locations created — all ${total} codes already exist`);
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["locations"] }),
        queryClient.invalidateQueries({ queryKey: ["tree"] }),
        queryClient.invalidateQueries({ queryKey: ["zone-locations"] }),
      ]);
      setOpen(false);
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Location wizard failed"),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger === null ? null : (
        <DialogTrigger asChild>
          {trigger ?? (
            <Button variant="outline">
              <MapPinned data-icon="inline-start" />
              Location wizard
            </Button>
          )}
        </DialogTrigger>
      )}
      <DialogContent className="max-h-[90vh] overflow-hidden sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Create locations by range</DialogTitle>
          <DialogDescription>Each bay-level splits into 1–3 side-by-side positions. Total = bays × levels × positions. Depth = pallet capacity per slot.</DialogDescription>
        </DialogHeader>
        <div className="max-h-[72vh] overflow-y-auto pr-4">
          <Form {...form}>
            <form className="grid gap-4 sm:grid-cols-2" onSubmit={form.handleSubmit((values) => mutation.mutate(values))}>
              <SelectField
                form={form}
                name="warehouse_id"
                label="Warehouse"
                hint="All locations are scoped to one warehouse."
                options={(options?.warehouses ?? []).map((warehouse: any) => ({ label: warehouse.name, value: warehouse.id }))}
              />
              <SelectField
                form={form}
                name="zone_id"
                label="Zone"
                hint={selectedWarehouseId ? "Zones for the selected warehouse." : "Select a warehouse first."}
                options={filteredZones.map((zone: any) => ({ label: `${zone.code} – ${zone.name}`, value: zone.id }))}
              />
              <TextField form={form} name="prefix" label="Rack prefix" hint="Letter or short code, e.g. A or BR." />
              <TextField form={form} name="start_bay" label="Start bay" type="number" hint="First bay number in the range (≥ 1)." />
              <TextField form={form} name="end_bay" label="End bay" type="number" hint="Must be ≥ start bay." />
              <TextField form={form} name="levels" label="Levels" type="number" hint="Vertical levels per bay (1–6)." />
              <TextField form={form} name="positions_per_level" label="Positions per level" type="number" hint="Side-by-side slots in each bay-level (1–3)." />
              <TextField form={form} name="depth" label="Depth (capacity)" type="number" hint="Pallets deep per slot = capacity (1–5)." />
              <div className="flex items-center justify-between rounded-lg border border-border px-4 py-3 sm:col-span-2">
                <div className="grid gap-0.5 pr-3">
                  <span id="lw-level-style-label" className="text-sm font-medium">Substitute level numbers for letters (A, B, C, D...)</span>
                  <span className="text-xs text-muted-foreground">Writes the level as a letter instead of L01/L02 in the code (e.g. A-01-B). One style per zone and bay; different zones in a warehouse can differ.</span>
                </div>
                <FormField control={form.control} name="level_style" render={({ field }) => (
                  <Switch
                    aria-labelledby="lw-level-style-label"
                    checked={field.value === "letters"}
                    onCheckedChange={(checked) => field.onChange(checked ? "letters" : "numeric")}
                  />
                )} />
              </div>
              <SelectField form={form} name="location_type" label="Type" hint="Used by directed putaway rules." options={[
                { label: "Rack", value: "rack" },
                { label: "Staging", value: "staging" },
                { label: "Quarantine", value: "quarantine" },
                { label: "Dispatch", value: "dispatch" },
                { label: "Receiving", value: "receiving" },
                { label: "Floor", value: "floor" },
                { label: "Returns", value: "returns" },
              ]} />
              <SelectField form={form} name="temperature_class" label="Temperature" hint="Must match the zone’s temperature class." options={[
                { label: "Ambient", value: "ambient" },
                { label: "Cool", value: "cool" },
                { label: "Frozen", value: "frozen" },
              ]} />
              <div className="flex items-center justify-between rounded-lg border border-border px-4 py-3 sm:col-span-2">
                <div className="grid gap-0.5 pr-3">
                  <span id="lw-mixed-sku-label" className="text-sm font-medium">Mixed SKU allowed</span>
                  <span className="text-xs text-muted-foreground">Permit different products in the same location.</span>
                </div>
                <FormField control={form.control} name="mixed_sku_allowed" render={({ field }) => (
                  <Switch aria-labelledby="lw-mixed-sku-label" checked={field.value} onCheckedChange={field.onChange} />
                )} />
              </div>
              <div className="flex items-center justify-between rounded-lg border border-border px-4 py-3 sm:col-span-2">
                <div className="grid gap-0.5 pr-3">
                  <span id="lw-mixed-lot-label" className="text-sm font-medium">Mixed lot allowed</span>
                  <span className="text-xs text-muted-foreground">Permit different lot numbers in the same location.</span>
                </div>
                <FormField control={form.control} name="mixed_lot_allowed" render={({ field }) => (
                  <Switch aria-labelledby="lw-mixed-lot-label" checked={field.value} onCheckedChange={field.onChange} />
                )} />
              </div>
              {locationCount > 0 ? (
                <p className="text-xs text-muted-foreground sm:col-span-2">
                  This will generate <strong>{locationCount}</strong> location{locationCount !== 1 ? "s" : ""}.
                </p>
              ) : null}
              <Button className="sm:col-span-2" disabled={mutation.isPending || !selectedWarehouseId || !form.watch("zone_id")} type="submit" aria-busy={mutation.isPending}>
                {mutation.isPending ? <Loader2 className="animate-spin" /> : null}
                Create location range
              </Button>
            </form>
          </Form>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function BarcodePrintDialog({ labelType, code, title }: { labelType: "warehouse" | "zone" | "location"; code: string; title: string }) {
  const printRef = useRef<HTMLDivElement>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const zpl = [
    "^XA",
    "^CI28",
    "^PW609",
    "^LL406",
    "^FO28,24^GB553,358,3^FS",
    `^FO40,44^A0N,34,34^FD${title.replace(/[\^~]/g, " ").slice(0, 34)}^FS`,
    `^FO40,92^A0N,24,24^FD${labelType.toUpperCase()}^FS`,
    `^FO64,130^BQN,2,7^FDLA,${code.replace(/[\^~]/g, " ").slice(0, 64)}^FS`,
    `^FO288,176^A0N,30,30^FD${code.replace(/[\^~]/g, " ").slice(0, 28)}^FS`,
    "^FO288,220^A0N,18,18^FD3PL Management^FS",
    "^XZ",
  ].join("\n");

  function handlePrint() {
    if (!printRef.current) return;
    const printWindow = window.open("", "_blank", "width=420,height=480");
    if (!printWindow) return;
    printWindow.document.write(`<!DOCTYPE html><html><head><title>Label — ${escapeHtml(title)}</title><style>
      @page { margin: 12mm; }
      body { font-family: system-ui, sans-serif; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; background: #fff; }
      .label { text-align: center; border: 1px solid #ccc; padding: 16px; border-radius: 8px; display: inline-block; }
      .label-type { font-size: 11px; text-transform: uppercase; color: #888; margin-top: 8px; letter-spacing: 0.08em; }
      .label-code { font-size: 18px; font-weight: 700; margin-top: 4px; letter-spacing: 0.04em; }
      .label-sub { font-size: 11px; color: #666; margin-top: 2px; }
    </style></head><body><div class="label">${printRef.current.innerHTML}
      <p class="label-type">${escapeHtml(labelType)}</p>
      <p class="label-code">${escapeHtml(title)}</p>
      <p class="label-sub">${escapeHtml(code)}</p>
    </div><script>window.onload=()=>{window.print();window.close();}<\/script></body></html>`);
    printWindow.document.close();
  }

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost">
          <QrCode data-icon="inline-start" />
          Print
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>Scan label with human-readable code.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div ref={printRef} className="mx-auto rounded-md border border-border bg-white p-4">
            <QRCodeSVG value={code} size={160} bgColor="#ffffff" fgColor="#000000" level="M" />
          </div>
          <div className="rounded-md border border-border p-3 text-center">
            <p className="text-xs uppercase text-muted-foreground">{labelType}</p>
            <p className="break-all text-xl font-semibold">{code}</p>
          </div>
          <Button className="w-full" onClick={handlePrint}>
            <Printer data-icon="inline-start" />
            Print label
          </Button>
          <button
            type="button"
            className="text-xs text-muted-foreground underline-offset-2 hover:underline text-left"
            onClick={() => setShowAdvanced((v) => !v)}
          >
            {showAdvanced ? "Hide" : "Show"} advanced (ZPL payload)
          </button>
          {showAdvanced && (
            <div className="rounded-lg border border-border bg-background p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="text-sm font-medium text-muted-foreground">ZPL payload</p>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={async () => {
                    await navigator.clipboard?.writeText(zpl);
                    toast.success("ZPL copied");
                  }}
                >
                  Copy
                </Button>
              </div>
              <pre className="max-h-36 overflow-auto whitespace-pre-wrap font-mono text-xs text-muted-foreground">{zpl}</pre>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function defaultFieldValue(field: FieldDefinition) {
  if (field.type === "boolean") return field.name === "active" || field.name === "lot_tracked";
  if (field.name === "variance_value_floor") return 500;
  if (field.name === "supervisor_approval_cap") return 1000;
  if (field.name === "freeze_default_hours") return 4;
  if (["minimum_stock_level", "maximum_stock_level", "pick_down_to_level", "supplier_lead_time_days"].includes(field.name)) return 0;
  if (field.type === "number") return "";
  if (field.name === "temperature_class" || field.name === "temperature_requirement") return "ambient";
  if (field.name === "rotation_method") return "fifo";
  if (field.name === "status") return "active";
  return "";
}

export function composeLocationCode(
  options: Awaited<ReturnType<typeof fetchOptions>> | undefined,
  warehouseId: unknown,
  zoneId: unknown,
  localCode: unknown,
) {
  const rawCode = String(localCode ?? "").trim();
  void options;
  void warehouseId;
  void zoneId;
  return rawCode;
}

export function normalizeResourceValues(
  resource: ResourceDefinition,
  values: Record<string, unknown>,
  options?: Awaited<ReturnType<typeof fetchOptions>>,
  behavior?: { preserveLocationCode?: boolean },
) {
  const payload = resource.fields.reduce<Record<string, unknown>>((current, field) => {
    const value = values[field.name];
    if (value === "") {
      current[field.name] = field.required ? value : null;
      return current;
    }
    current[field.name] = field.type === "number" && value != null ? Number(value) : value;
    return current;
  }, {});
  if (resource.table === "locations" && !behavior?.preserveLocationCode) {
    payload.code = composeLocationCode(options, payload.warehouse_id, payload.zone_id, payload.code);
  }
  return payload;
}

export function getResourceFieldOptions(field: FieldDefinition, options?: Awaited<ReturnType<typeof fetchOptions>>) {
  if (field.options) return field.options;
  if (field.name === "warehouse_id") return (options?.warehouses ?? []).map((warehouse: any) => ({ label: `${warehouse.code} - ${warehouse.name}`, value: warehouse.id }));
  if (field.name === "zone_id") return (options?.zones ?? []).map((zone: any) => ({ label: `${zone.code} - ${zone.name}`, value: zone.id }));
  if (field.name === "client_owner_id") return (options?.clients ?? []).map((client: any) => ({ label: client.name, value: client.id }));
  if (field.name === "product_id") return (options?.products ?? []).map((product: any) => ({ label: `${product.sku} - ${product.name}`, value: product.id }));
  return [];
}

export function shouldRestrictToDefaultWarehouse(roles: string[]) {
  return roles.some((role) => ["inventory_clerk", "warehouse_operator", "dispatch_driver"].includes(role)) &&
    !roles.some((role) => ["admin", "warehouse_manager"].includes(role));
}

export function DashboardPage() {
  const { profile } = useAuth();
  const { flags, isEnabled } = useFeatureFlags();
  const [mode, setMode] = useState<DashboardMode>("floor");
  const [editMode, setEditMode] = useState(false);
  const deviceId = useMemo(() => (typeof window === "undefined" ? "server-render-device" : getOrCreateDeviceId()), []);
  const floorDefinitions = useMemo(() => filterDashboardTileDefinitions(DEFAULT_FLOOR_LAYOUT, isEnabled), [isEnabled]);
  const dockDefinitions = useMemo(() => filterDashboardTileDefinitions(DEFAULT_DOCK_LAYOUT, isEnabled), [isEnabled]);
  const officeDefinitions = useMemo(() => filterDashboardTileDefinitions(DEFAULT_OFFICE_LAYOUT, isEnabled), [isEnabled]);
  const floorDefaults = useMemo(() => tileConfigsFromDefinitions(floorDefinitions), [floorDefinitions]);
  const dockDefaults = useMemo(() => tileConfigsFromDefinitions(dockDefinitions), [dockDefinitions]);
  const officeDefaults = useMemo(() => tileConfigsFromDefinitions(officeDefinitions), [officeDefinitions]);
  const floorLayoutKey = fallbackLayoutKey(DASHBOARD_FLOOR_LAYOUT_KEY, profile?.id, deviceId);
  const dockLayoutKey = fallbackLayoutKey(DASHBOARD_DOCK_LAYOUT_KEY, profile?.id, deviceId);
  const officeLayoutKey = fallbackLayoutKey(DASHBOARD_OFFICE_LAYOUT_KEY, profile?.id, deviceId);
  const [floorTiles, setFloorTiles] = useState<DashboardTileConfig[]>(() => loadFallbackTileLayout(floorLayoutKey, floorDefaults));
  const [dockTiles, setDockTiles] = useState<DashboardTileConfig[]>(() => loadFallbackTileLayout(dockLayoutKey, dockDefaults));
  const [officeTiles, setOfficeTiles] = useState<DashboardTileConfig[]>(() => loadFallbackTileLayout(officeLayoutKey, officeDefaults));
  const [floorVisibility, setFloorVisibility] = useState<DashboardVisibilityMap>({});
  const [dockVisibility, setDockVisibility] = useState<DashboardVisibilityMap>({});
  const [officeVisibility, setOfficeVisibility] = useState<DashboardVisibilityMap>({});
  const dashboardRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [fitToScreen, setFitToScreen] = useState(false);

  useEffect(() => {
    const onChange = () => setIsFullscreen(document.fullscreenElement === dashboardRef.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const toggleFullscreen = useCallback(async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else if (dashboardRef.current) {
        await dashboardRef.current.requestFullscreen();
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Fullscreen unavailable");
    }
  }, []);

  const { data: metrics, isLoading } = useQuery({
    queryKey: ["dashboard-metrics", profile?.default_warehouse_id, flags],
    queryFn: () => getDashboardMetrics(profile?.default_warehouse_id, flags),
    refetchInterval: 15_000,
  });
  const { data: reports } = useQuery({ queryKey: ["reports", "enterprise-dashboard"], queryFn: getReportData });
  const snapshot = useMemo(() => buildEnterpriseDashboard(metrics, reports), [metrics, reports]);
  const summaryCardsById = useMemo(() => {
    const returnedMetricKeys = metrics?.dashboardMetricKeys ? new Set(metrics.dashboardMetricKeys) : null;
    const cards = (filterDashboardTileDefinitions(DEFAULT_DASHBOARD_CARDS, isEnabled) as DashboardCardConfig[])
      .filter((card) => !returnedMetricKeys || returnedMetricKeys.has(card.metricKey));
    return new Map(cards.map((card) => [card.id, card]));
  }, [isEnabled, metrics?.dashboardMetricKeys]);
  const floorDefinitionById = useMemo(() => new Map(floorDefinitions.map((tile) => [tile.id, tile])), [floorDefinitions]);
  const dockDefinitionById = useMemo(() => new Map(dockDefinitions.map((tile) => [tile.id, tile])), [dockDefinitions]);
  const officeDefinitionById = useMemo(() => new Map(officeDefinitions.map((tile) => [tile.id, tile])), [officeDefinitions]);

  useEffect(() => {
    let cancelled = false;

    async function loadMode(
      modeKey: DashboardMode,
      storageKey: string,
      defaults: DashboardTileConfig[],
      setTiles: Dispatch<SetStateAction<DashboardTileConfig[]>>,
      setVisibility: Dispatch<SetStateAction<DashboardVisibilityMap>>,
    ) {
      const fallbackLayout = loadFallbackTileLayout(storageKey, defaults);
      const fallbackVisibility = loadFallbackVisibility(fallbackVisibilityKey(profile?.id, modeKey));
      if (!profile?.id) {
        setTiles(sanitizeDashboardLayout(fallbackLayout, defaults));
        setVisibility(fallbackVisibility);
        return;
      }

      try {
        const [remoteLayout, remoteVisibility] = await Promise.all([
          loadDashboardDeviceLayout(profile.id, deviceId, modeKey),
          loadDashboardTileVisibility(profile.id, modeKey),
        ]);
        if (cancelled) return;
        setTiles(sanitizeDashboardLayout(remoteLayout ?? fallbackLayout, defaults));
        setVisibility({ ...fallbackVisibility, ...remoteVisibility });
      } catch (error) {
        if (cancelled) return;
        setTiles(sanitizeDashboardLayout(fallbackLayout, defaults));
        setVisibility(fallbackVisibility);
        console.error("[DashboardPage] dashboard preferences unavailable:", error);
      }
    }

    loadMode("floor", floorLayoutKey, floorDefaults, setFloorTiles, setFloorVisibility);
    loadMode("dock", dockLayoutKey, dockDefaults, setDockTiles, setDockVisibility);
    loadMode("office", officeLayoutKey, officeDefaults, setOfficeTiles, setOfficeVisibility);

    return () => {
      cancelled = true;
    };
  }, [deviceId, dockDefaults, dockLayoutKey, floorDefaults, floorLayoutKey, officeDefaults, officeLayoutKey, profile?.id]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const persistLayout = useCallback((modeKey: DashboardMode, key: string, tiles: DashboardTileConfig[]) => {
    saveFallbackJson(key, tiles);
    if (profile?.id) {
      saveDashboardDeviceLayout(profile.id, deviceId, modeKey, tiles).catch((error) => {
        console.error("[DashboardPage] save layout failed:", error);
        toast.error("Dashboard layout could not be saved");
      });
    }
  }, [deviceId, profile?.id]);

  const handleTileDragEnd = useCallback((event: DragEndEvent, modeKey: DashboardMode, key: string, setTiles: Dispatch<SetStateAction<DashboardTileConfig[]>>) => {
    if (!editMode) return;
    const { active, over } = event;
    if (over && active.id !== over.id) {
      setTiles((prev) => {
        const oldIdx = prev.findIndex((tile) => tile.id === active.id);
        const newIdx = prev.findIndex((tile) => tile.id === over.id);
        if (oldIdx < 0 || newIdx < 0) return prev;
        const next = arrayMove(prev, oldIdx, newIdx);
        persistLayout(modeKey, key, next);
        return next;
      });
    }
  }, [editMode, persistLayout]);

  const handleTileResize = useCallback((id: string, modeKey: DashboardMode, key: string, setTiles: Dispatch<SetStateAction<DashboardTileConfig[]>>) => {
    setTiles((prev) => {
      const next = prev.map((tile) => tile.id === id ? { ...tile, size: (tile.size === "sm" ? "lg" : "sm") as DashboardCardSize } : tile);
      persistLayout(modeKey, key, next);
      return next;
    });
  }, [persistLayout]);

  const handleTileVisibility = useCallback((
    id: string,
    modeKey: DashboardMode,
    visible: boolean,
    setVisibility: Dispatch<SetStateAction<DashboardVisibilityMap>>,
  ) => {
    setVisibility((prev) => {
      const next = { ...prev, [id]: visible };
      saveFallbackJson(fallbackVisibilityKey(profile?.id, modeKey), next);
      return next;
    });
    if (profile?.id) {
      saveDashboardTileVisibility(profile.id, modeKey, id, visible).catch((error) => {
        console.error("[DashboardPage] save visibility failed:", error);
        toast.error("Dashboard tile visibility could not be saved");
      });
    }
  }, [profile?.id]);

  const floorVisibleTiles = useMemo(() => visibleDashboardTiles(floorTiles, floorVisibility, editMode), [editMode, floorTiles, floorVisibility]);
  const dockVisibleTiles = useMemo(() => visibleDashboardTiles(dockTiles, dockVisibility, editMode), [dockTiles, dockVisibility, editMode]);
  const officeVisibleTiles = useMemo(() => visibleDashboardTiles(officeTiles, officeVisibility, editMode), [editMode, officeTiles, officeVisibility]);
  const floorHiddenTiles = useMemo(() => hiddenDashboardTiles(floorTiles, floorVisibility), [floorTiles, floorVisibility]);
  const dockHiddenTiles = useMemo(() => hiddenDashboardTiles(dockTiles, dockVisibility), [dockTiles, dockVisibility]);
  const officeHiddenTiles = useMemo(() => hiddenDashboardTiles(officeTiles, officeVisibility), [officeTiles, officeVisibility]);

  const renderSummaryTile = useCallback((tile: DashboardTileConfig, onResize: (id: string) => void, onHide: (id: string) => void) => {
    const card = summaryCardsById.get(tile.id);
    if (!card) return null;
    return (
      <SortableSummaryCard
        key={tile.id}
        card={{ ...card, size: tile.size }}
        metrics={metrics}
        isLoading={isLoading}
        warehouseCaption={profile?.default_warehouse_id ? `${formatNumber(metrics?.warehousePalletCapacity ?? 0)} location capacity` : "No warehouse selected"}
        editMode={editMode}
        onResize={onResize}
        onHide={onHide}
      />
    );
  }, [editMode, isLoading, metrics, profile?.default_warehouse_id, summaryCardsById]);

  return (
    <div
      ref={dashboardRef}
      className={cn(
        "cc-grid-bg flex min-h-0 flex-col gap-6 overflow-y-auto overflow-x-hidden lg:h-full lg:gap-3",
        (isFullscreen || fitToScreen) && "h-screen overflow-auto bg-background p-4",
      )}
    >
      <div className="flex shrink-0 flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Command Center</h2>
          <p className="text-sm text-muted-foreground">Live warehouse metrics. Unlock edit mode to reorder, resize, or hide tiles.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Tabs value={mode} onValueChange={(value) => setMode(value as DashboardMode)}>
            <TabsList className="grid h-auto w-full grid-cols-3 sm:w-fit">
              <TabsTrigger value="floor" className="gap-1.5"><Forklift className="h-3.5 w-3.5" /> Floor</TabsTrigger>
              <TabsTrigger value="dock" className="gap-1.5"><Truck className="h-3.5 w-3.5" /> Dock</TabsTrigger>
              <TabsTrigger value="office" className="gap-1.5"><BarChart3 className="h-3.5 w-3.5" /> Office</TabsTrigger>
            </TabsList>
          </Tabs>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon"
                variant={editMode ? "secondary" : "outline"}
                onClick={() => setEditMode((value) => !value)}
                aria-label={editMode ? "Lock dashboard layout" : "Unlock dashboard layout"}
                aria-pressed={editMode}
              >
                {editMode ? <LockOpen className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{editMode ? "Lock dashboard layout" : "Unlock dashboard layout"}</TooltipContent>
          </Tooltip>
          <Button size="sm" variant="outline" onClick={() => setFitToScreen((v) => !v)} aria-pressed={fitToScreen}>
            {fitToScreen ? "Reset fit" : "Fit to screen"}
          </Button>
          <Button size="sm" variant="outline" onClick={toggleFullscreen} aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}>
            {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {mode === "floor" ? (
          <WarehouseFloorMode
            snapshot={snapshot}
            sensors={sensors}
            tiles={floorVisibleTiles}
            hiddenTiles={floorHiddenTiles}
            definitionsById={floorDefinitionById}
            editMode={editMode}
            renderSummaryTile={renderSummaryTile}
            onDragEnd={(event) => handleTileDragEnd(event, "floor", floorLayoutKey, setFloorTiles)}
            onResize={(id) => handleTileResize(id, "floor", floorLayoutKey, setFloorTiles)}
            onHide={(id) => handleTileVisibility(id, "floor", false, setFloorVisibility)}
            onRestore={(id) => handleTileVisibility(id, "floor", true, setFloorVisibility)}
          />
        ) : null}
        {mode === "dock" ? (
          <DockHandoffBoard
            loads={snapshot.dockLoads}
            recommendations={snapshot.recommendations}
            sensors={sensors}
            tiles={dockVisibleTiles}
            hiddenTiles={dockHiddenTiles}
            definitionsById={dockDefinitionById}
            editMode={editMode}
            renderSummaryTile={renderSummaryTile}
            onDragEnd={(event) => handleTileDragEnd(event, "dock", dockLayoutKey, setDockTiles)}
            onResize={(id) => handleTileResize(id, "dock", dockLayoutKey, setDockTiles)}
            onHide={(id) => handleTileVisibility(id, "dock", false, setDockVisibility)}
            onRestore={(id) => handleTileVisibility(id, "dock", true, setDockVisibility)}
          />
        ) : null}
        {mode === "office" ? (
          <OfficeMonitoringMode
            snapshot={snapshot}
            sensors={sensors}
            tiles={officeVisibleTiles}
            hiddenTiles={officeHiddenTiles}
            definitionsById={officeDefinitionById}
            editMode={editMode}
            renderSummaryTile={renderSummaryTile}
            onDragEnd={(event) => handleTileDragEnd(event, "office", officeLayoutKey, setOfficeTiles)}
            onResize={(id) => handleTileResize(id, "office", officeLayoutKey, setOfficeTiles)}
            onHide={(id) => handleTileVisibility(id, "office", false, setOfficeVisibility)}
            onRestore={(id) => handleTileVisibility(id, "office", true, setOfficeVisibility)}
          />
        ) : null}
      </div>
    </div>
  );
}

export function WarehouseFloorMode({
  snapshot,
  sensors,
  tiles,
  hiddenTiles,
  definitionsById,
  editMode,
  renderSummaryTile,
  onDragEnd,
  onResize,
  onHide,
  onRestore,
}: {
  snapshot: EnterpriseDashboardSnapshot;
  sensors: ReturnType<typeof useSensors>;
  tiles: DashboardTileConfig[];
  hiddenTiles: DashboardTileConfig[];
  definitionsById: Map<string, DashboardTileDefinition<ModuleKey>>;
  editMode: boolean;
  renderSummaryTile: (tile: DashboardTileConfig, onResize: (id: string) => void, onHide: (id: string) => void) => ReactNode;
  onDragEnd: (event: DragEndEvent) => void;
  onResize: (id: string) => void;
  onHide: (id: string) => void;
  onRestore: (id: string) => void;
}) {
  const { toPath } = useTenantPath();
  const queuesByLabel = new Map(snapshot.floorQueues.map((queue) => [queue.label, queue]));

  return (
    <div className="grid gap-3">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={tiles.map((tile) => tile.id)} strategy={rectSortingStrategy}>
          <div className="grid min-h-0 gap-3 grid-cols-[repeat(auto-fill,minmax(min(100%,15rem),1fr))]">
            {tiles.map((tile) => {
              const summaryTile = renderSummaryTile(tile, onResize, onHide);
              if (summaryTile) return summaryTile;

              if (tile.id === "Warehouse Intelligence") {
                return (
                  <SortableDashboardTile key={tile.id} tile={tile} editMode={editMode} onResize={onResize} onHide={onHide}>
                    <WarehouseIntelligenceCard snapshot={snapshot} />
                  </SortableDashboardTile>
                );
              }

              const queue = queuesByLabel.get(tile.id);
              if (!queue) return null;

              return (
                <SortableDashboardTile key={tile.id} tile={tile} editMode={editMode} onResize={onResize} onHide={onHide}>
                  <Card className={cn("flex h-full min-w-0 flex-col border-l-4", toneBorder(queue.tone))}>
                    <CardHeader className="p-4 pb-2 pr-20">
                      <CardTitle className="flex items-center justify-between gap-4">
                        <span>{queue.label}</span>
                        <Link to={queue.route} className="shrink-0 rounded-sm text-3xl transition hover:text-primary focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2">
                          {formatNumber(queue.count)}
                        </Link>
                      </CardTitle>
                      <CardDescription>{queue.action}</CardDescription>
                    </CardHeader>
                    <CardContent className="flex flex-1 flex-col gap-2 p-4 pt-0">
                      {queue.tasks.length > 0 ? (
                        <ul className="mb-2 grid gap-1">
                          {queue.tasks.map((task) => (
                            <li key={task.id}>
                              <Link
                                to={task.route}
                                className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2 rounded-md border border-border bg-secondary/30 px-3 py-1.5 text-sm transition-colors hover:bg-secondary/60"
                              >
                                <span className="min-w-0 break-all font-medium leading-tight">{task.label}</span>
                                <Badge variant="outline" className="shrink-0 self-start whitespace-nowrap capitalize text-xs">{task.sublabel}</Badge>
                              </Link>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                      <Button className="mt-auto h-10 w-full" asChild>
                        <Link to={queue.route}>Open workflow</Link>
                      </Button>
                    </CardContent>
                  </Card>
                </SortableDashboardTile>
              );
            })}
          </div>
        </SortableContext>
      </DndContext>
      <HiddenDashboardTilesPanel editMode={editMode} tiles={hiddenTiles} definitionsById={definitionsById} onRestore={onRestore} />
    </div>
  );
}

export function normalizeScannerText(value: unknown) {
  return String(value ?? "").trim().toUpperCase();
}

export function resolveContainerScanValue(value: unknown) {
  const result = extractIso6346ContainerNumber(value);
  if (result.valid) return { value: result.normalized, valid: true, message: result.message, candidate: result.candidate };
  return {
    value: result.candidate ?? normalizeContainerNumber(value),
    valid: false,
    candidate: result.candidate,
    message: result.message,
  };
}

export function isBaySelectorCode(value: string) {
  const normalized = normalizeScannerText(value);
  if (normalized.startsWith("BAY:")) return true;
  const parts = normalized.split("-").filter(Boolean);
  if (parts.length === 2 && /^\d+$/.test(parts[1])) return true;
  return parts.length >= 4 && !parts.some((part) => /^L\d+$/i.test(part));
}

function shouldUppercaseField(name: string) {
  const lower = name.toLowerCase();
  return (
    lower === "code" ||
    lower === "sku" ||
    lower.includes("barcode") ||
    lower.includes("container") ||
    lower.includes("po_number") ||
    lower.includes("order_number") ||
    lower.includes("reference_number") ||
    lower.includes("location")
  );
}

function WarehouseIntelligenceCard({ snapshot }: { snapshot: EnterpriseDashboardSnapshot }) {
  return (
    <Card className="h-full min-w-0">
      <CardHeader className="pb-2 pr-20">
        <CardTitle className="flex items-center gap-2 text-base"><RadioTower className="h-4 w-4" /> Warehouse Intelligence</CardTitle>
        <CardDescription className="text-xs">Live shift signals — DPMO, 5S, Kanban, exceptions.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-2">
        {snapshot.leanMetrics.map((metric) => (
          <Link key={metric.label} to={metric.route} className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 rounded-md border border-border px-3 py-2 transition hover:bg-secondary/40 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2">
            <div className="min-w-0">
              <p className="break-words text-xs font-medium leading-4">{metric.label}</p>
              <p className="mt-0.5 break-words text-xs leading-4 text-muted-foreground">Target: {metric.target}</p>
            </div>
            <div className="flex min-w-0 max-w-[8.5rem] flex-col items-end gap-1 text-right">
              <span className="break-words text-lg font-semibold leading-none tabular-nums">{metric.value}</span>
              <Badge className="max-w-full whitespace-normal break-words px-1.5 py-0 text-[10px] leading-4" variant={metric.status === "off_target" ? "destructive" : metric.status === "watch" ? "secondary" : "default"}>
                {metric.status.replace("_", " ")}
              </Badge>
            </div>
          </Link>
        ))}
      </CardContent>
    </Card>
  );
}

export function DockHandoffBoard({
  loads,
  recommendations,
  sensors,
  tiles,
  hiddenTiles,
  definitionsById,
  editMode,
  renderSummaryTile,
  onDragEnd,
  onResize,
  onHide,
  onRestore,
}: {
  loads: DockHandoffLoad[];
  recommendations: WarehouseBrainRecommendation[];
  sensors: ReturnType<typeof useSensors>;
  tiles: DashboardTileConfig[];
  hiddenTiles: DashboardTileConfig[];
  definitionsById: Map<string, DashboardTileDefinition<ModuleKey>>;
  editMode: boolean;
  renderSummaryTile: (tile: DashboardTileConfig, onResize: (id: string) => void, onHide: (id: string) => void) => ReactNode;
  onDragEnd: (event: DragEndEvent) => void;
  onResize: (id: string) => void;
  onHide: (id: string) => void;
  onRestore: (id: string) => void;
}) {
  const { toPath } = useTenantPath();
  return (
    <div className="grid gap-3">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={tiles.map((tile) => tile.id)} strategy={rectSortingStrategy}>
          <div className="grid min-w-0 gap-4 grid-cols-[repeat(auto-fill,minmax(min(100%,13rem),1fr))]">
            {tiles.map((tile) => {
              const summaryTile = renderSummaryTile(tile, onResize, onHide);
              if (summaryTile) return summaryTile;

              if (tile.id === "warehouse-brain") {
                return (
                  <SortableDashboardTile key={tile.id} tile={tile} editMode={editMode} onResize={onResize} onHide={onHide}>
                    <WarehouseBrainPanel recommendations={recommendations} />
                  </SortableDashboardTile>
                );
              }

              const status = tile.id as DockHandoffLoad["status"];
              const laneLoads = loads.filter((load) => load.status === status);

              return (
                <SortableDashboardTile key={tile.id} tile={tile} editMode={editMode} onResize={onResize} onHide={onHide}>
                  <Card className={cn("h-full min-h-72 min-w-0", status === "blocked" ? "border-destructive/50" : "")}>
                    <CardHeader className="pr-20">
                      <CardTitle className="flex items-center justify-between gap-2 capitalize">
                        <span>{status}</span>
                        <Link to={toPath("/pick-lists")} className="rounded-sm text-2xl transition hover:text-primary focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2">
                          {formatNumber(laneLoads.length)}
                        </Link>
                      </CardTitle>
                      <CardDescription>Dock handoff lane</CardDescription>
                    </CardHeader>
                    <CardContent className="grid gap-3">
                      {laneLoads.map((load) => (
                        <div key={load.id} className="rounded-lg border border-border bg-secondary/30 p-3">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-semibold">{load.route}</span>
                            <Badge>{load.door}</Badge>
                          </div>
                          <p className="mt-1 truncate text-sm">{load.customer}</p>
                          <p className="text-xs text-muted-foreground">{load.driver} · {load.pallets} pallet{load.pallets === 1 ? "" : "s"} · {load.temperatureClass}</p>
                          {load.blocker ? <p className="mt-2 text-xs text-destructive">{load.blocker}</p> : null}
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                </SortableDashboardTile>
              );
            })}
          </div>
        </SortableContext>
      </DndContext>
      <HiddenDashboardTilesPanel editMode={editMode} tiles={hiddenTiles} definitionsById={definitionsById} onRestore={onRestore} />
    </div>
  );
}

export function OfficeMonitoringMode({
  snapshot,
  sensors,
  tiles,
  hiddenTiles,
  definitionsById,
  editMode,
  renderSummaryTile,
  onDragEnd,
  onResize,
  onHide,
  onRestore,
}: {
  snapshot: EnterpriseDashboardSnapshot;
  sensors: ReturnType<typeof useSensors>;
  tiles: DashboardTileConfig[];
  hiddenTiles: DashboardTileConfig[];
  definitionsById: Map<string, DashboardTileDefinition<ModuleKey>>;
  editMode: boolean;
  renderSummaryTile: (tile: DashboardTileConfig, onResize: (id: string) => void, onHide: (id: string) => void) => ReactNode;
  onDragEnd: (event: DragEndEvent) => void;
  onResize: (id: string) => void;
  onHide: (id: string) => void;
  onRestore: (id: string) => void;
}) {
  const widgetsByLabel = new Map(snapshot.officeWidgets.map((widget) => [widget.label, widget]));

  return (
    <div className="grid gap-3">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={tiles.map((tile) => tile.id)} strategy={rectSortingStrategy}>
          <div className="grid min-w-0 gap-4 grid-cols-[repeat(auto-fill,minmax(min(100%,15rem),1fr))]">
            {tiles.map((tile) => {
              const summaryTile = renderSummaryTile(tile, onResize, onHide);
              if (summaryTile) return summaryTile;

              if (tile.id === "setup-checklist") {
                return (
                  <SortableDashboardTile key={tile.id} tile={tile} editMode={editMode} onResize={onResize} onHide={onHide}>
                    <Card className="h-full">
                      <CardHeader className="pr-20">
                        <CardTitle className="flex items-center gap-2"><ClipboardCheck /> Setup Checklist</CardTitle>
                        <CardDescription>Go-live prompts for admin and management setup activities.</CardDescription>
                      </CardHeader>
                      <CardContent className="grid gap-3">
                        {snapshot.setupChecklist.map((item) => (
                          <div key={item.label} className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2">
                            <div>
                              <p className="text-sm font-medium">{item.label}</p>
                              <p className="text-xs text-muted-foreground">{item.owner}</p>
                            </div>
                            <Badge variant={item.complete ? "default" : "secondary"}>{item.complete ? "Ready" : "Open"}</Badge>
                          </div>
                        ))}
                      </CardContent>
                    </Card>
                  </SortableDashboardTile>
                );
              }

              if (tile.id === "warehouse-brain") {
                return (
                  <SortableDashboardTile key={tile.id} tile={tile} editMode={editMode} onResize={onResize} onHide={onHide}>
                    <WarehouseBrainPanel recommendations={snapshot.recommendations} />
                  </SortableDashboardTile>
                );
              }

              const widget = widgetsByLabel.get(tile.id);
              if (!widget) return null;

              return (
                <SortableDashboardTile key={tile.id} tile={tile} editMode={editMode} onResize={onResize} onHide={onHide}>
                  <Card className={cn("h-full min-w-0 border-l-4", toneBorder(widget.tone))}>
                    <CardHeader className="pr-20">
                      <CardDescription>{widget.label}</CardDescription>
                      <CardTitle className="text-4xl">
                        <Link to={widget.route} className="rounded-sm transition hover:text-primary focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2">
                          {widget.value}
                        </Link>
                      </CardTitle>
                      <CardDescription>{widget.detail}</CardDescription>
                    </CardHeader>
                  </Card>
                </SortableDashboardTile>
              );
            })}
          </div>
        </SortableContext>
      </DndContext>
      <HiddenDashboardTilesPanel editMode={editMode} tiles={hiddenTiles} definitionsById={definitionsById} onRestore={onRestore} />
    </div>
  );
}

export function HiddenDashboardTilesPanel({
  editMode,
  tiles,
  definitionsById,
  onRestore,
}: {
  editMode: boolean;
  tiles: DashboardTileConfig[];
  definitionsById: Map<string, DashboardTileDefinition<ModuleKey>>;
  onRestore: (id: string) => void;
}) {
  if (!editMode || tiles.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-border bg-secondary/25 px-3 py-2">
      <span className="text-xs font-medium text-muted-foreground">Hidden tiles</span>
      {tiles.map((tile) => {
        const label = definitionsById.get(tile.id)?.label ?? tile.id;
        return (
          <Button key={tile.id} type="button" size="sm" variant="outline" className="h-8 gap-1.5" onClick={() => onRestore(tile.id)}>
            <Eye className="h-3.5 w-3.5" />
            {label}
          </Button>
        );
      })}
    </div>
  );
}

export function WarehouseBrainPanel({ recommendations }: { recommendations: WarehouseBrainRecommendation[] }) {
  return (
    <Card className="h-full">
      <CardHeader className="pr-20">
        <CardTitle className="flex items-center gap-2"><Bot /> Warehouse Brain</CardTitle>
        <CardDescription>Explainable recommendations using live WMS context and role-aware next actions.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        {recommendations.map((recommendation) => (
          <Link key={recommendation.id} to={recommendation.route} className={cn("block rounded-lg border border-border p-3 transition hover:bg-secondary/50 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2", recommendation.severity === "critical" ? "bg-destructive/10" : recommendation.severity === "warning" ? "bg-warning/10" : "bg-secondary/30")}>
            <div className="flex items-center justify-between gap-3">
              <p className="font-medium">{recommendation.title}</p>
              <Badge variant={recommendation.severity === "critical" ? "destructive" : "secondary"}>{recommendation.severity}</Badge>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">{recommendation.reason}</p>
            <p className="mt-2 text-sm">{recommendation.nextAction}</p>
          </Link>
        ))}
      </CardContent>
    </Card>
  );
}

export function toneBorder(tone: "success" | "warning" | "critical" | "info") {
  if (tone === "critical") return "border-l-destructive";
  if (tone === "warning") return "border-l-warning";
  if (tone === "info") return "border-l-info";
  return "border-l-success";
}

export type ReceivingShipmentLineState = {
  id: string;
  product_id: string;
  total_quantity: number | string;
  quantity_per_pallet: number | string;
  pallet_count: number | string;
  expiry_date: string;
  lot_number: string;
  batch_number: string;
  packaging_profile_id: string;
  remainder_action: "waive" | "manual" | "special" | "";
};

export type ReceivingShipmentFormState = {
  receipt_type: "po" | "transfer" | "other";
  warehouse_id: string;
  client_id: string;
  container_number: string;
  po_number: string;
  reference_number: string;
  lines: ReceivingShipmentLineState[];
};

export function newShipmentLine(productId = ""): ReceivingShipmentLineState {
  return {
    id: typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `line-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    product_id: productId,
    total_quantity: 1,
    quantity_per_pallet: 1,
    pallet_count: 1,
    expiry_date: "",
    lot_number: "",
    batch_number: "",
    packaging_profile_id: "",
    remainder_action: "",
  };
}

export function distributeShipmentLine(line: ReceivingShipmentLineState, changed: "total" | "perPallet" | "count"): ReceivingShipmentLineState {
  const total = Math.max(0, Number(line.total_quantity) || 0);
  let perPallet = Math.max(1, Number(line.quantity_per_pallet) || 1);
  let palletCount = Math.max(1, Math.floor(Number(line.pallet_count) || 1));

  if (changed !== "count") {
    palletCount = Math.max(1, Math.floor(total / perPallet) || 1);
  }

  const remainder = total - (perPallet * palletCount);
  return {
    ...line,
    total_quantity: total,
    quantity_per_pallet: perPallet,
    pallet_count: palletCount,
    remainder_action: remainder > 0 ? line.remainder_action : "",
  };
}

export function parseDraftMeta(notes: string | null | undefined): Record<string, any> {
  if (!notes) return {};
  try {
    const parsed = JSON.parse(notes);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function remainderForLine(line: ReceivingShipmentLineState) {
  return Math.max(0, Number(line.total_quantity || 0) - (Number(line.quantity_per_pallet || 0) * Number(line.pallet_count || 0)));
}

export function ShipmentFieldLabel({ children }: { children: ReactNode }) {
  return <label className="text-sm font-medium leading-none text-foreground">{children}</label>;
}

export function useIsMobileEntry() {
  const [isMobileEntry, setIsMobileEntry] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const media = window.matchMedia("(pointer: coarse), (max-width: 767px)");
    const update = () => setIsMobileEntry(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return isMobileEntry;
}

export function productRequiresExpiry(product?: { expiry_tracked?: boolean } | null) {
  return Boolean(product?.expiry_tracked);
}

export function defaultExpiryDate() {
  const date = new Date();
  date.setDate(date.getDate() + 30);
  return date.toISOString().slice(0, 10);
}

function normalizeDraftReceiptType(value: unknown): z.infer<typeof receivingSchema>["receipt_type"] {
  return value === "po" || value === "transfer" || value === "other" ? value : "other";
}

export function draftToReceivingValues(draft: DraftReceipt): z.infer<typeof receivingSchema> {
  const meta = parseDraftMeta(draft.notes);
  return {
    receipt_type: normalizeDraftReceiptType(draft.receipt_type ?? meta.receipt_type),
    reference_number: draft.reference_number ?? draft.po_number ?? "",
    container_number: draft.container_number ?? meta.container_number ?? "",
    po_number: draft.po_number ?? meta.po_number ?? "",
    warehouse_id: draft.warehouse_id,
    client_id: draft.client_id ?? "",
    product_id: (meta.product_id as string) ?? draft.product_id ?? "",
    packaging_profile_id: (meta.packaging_profile_id as string) ?? "",
    quantity: Number(meta.quantity ?? draft.quantity ?? 1),
    lot_number: (meta.lot_number as string) ?? "",
    batch_number: (meta.batch_number as string) ?? "",
    manufacture_date: (meta.manufacture_date as string) ?? "",
    expiry_date: (meta.expiry_date as string) ?? draft.expiry_date ?? "",
    loading_date: (meta.loading_date as string) ?? "",
    rotation_date: (meta.rotation_date as string) ?? "",
    override_length: (meta.override_length as number) ?? undefined,
    override_width: (meta.override_width as number) ?? undefined,
    override_height: (meta.override_height as number) ?? undefined,
    override_weight: (meta.override_weight as number) ?? undefined,
    reuse_pallet_barcode: (meta.reuse_pallet_barcode as string) ?? "",
    pallet_barcode: draft.draft_pallet_barcode ?? meta.draft_pallet_barcode ?? "",
    draft_group_id: draft.draft_group_id ?? meta.draft_group_id ?? undefined,
    draft_sequence: draft.draft_sequence ?? meta.draft_sequence ?? undefined,
    draft_count: draft.draft_count ?? meta.draft_count ?? undefined,
  };
}

export function printDraftLabels(
  drafts: DraftReceipt[],
  products: Array<{ id: string; sku: string; name: string; temperature_requirement?: string | null }>,
  clients: Array<{ id: string; name: string }>,
  warehouses: Array<{ id: string; name: string; code?: string | null }>,
  packagingProfiles: Array<{ id: string; name?: string | null; unit_name?: string | null; unit_of_measure?: string | null }>,
  onPrinted?: () => Promise<void> | void,
) {
  if (drafts.length === 0) {
    toast.error("Select at least one draft label to print.");
    return false;
  }
  const labels: PalletLabelPageProps[] = drafts.map((draft) => {
    const meta = parseDraftMeta(draft.notes);
    const product = products.find((p) => p.id === (draft.product_id ?? meta.product_id));
    const client = clients.find((item) => item.id === draft.client_id);
    const warehouse = warehouses.find((item) => item.id === draft.warehouse_id);
    const packaging = packagingProfiles.find((item) => item.id === meta.packaging_profile_id);
    const barcode = draft.draft_pallet_barcode ?? meta.draft_pallet_barcode ?? draft.receipt_number;

    return {
      barcode,
      productSku: product?.sku,
      productName: product?.name,
      quantity: Number(draft.quantity ?? meta.quantity ?? 1),
      lotNumber: draft.lot_number ?? meta.lot_number,
      batchNumber: draft.batch_number ?? meta.batch_number,
      expiryDate: draft.expiry_date ?? meta.expiry_date,
      containerNumber: draft.container_number ?? meta.container_number,
      poNumber: draft.po_number ?? meta.po_number,
      clientName: client?.name,
      warehouseName: warehouse ? `${warehouse.code ? `${warehouse.code} - ` : ""}${warehouse.name}` : undefined,
      receiptReference: draft.reference_number ?? draft.receipt_number,
      packaging: packaging?.name ?? packaging?.unit_name ?? packaging?.unit_of_measure,
      draftSequence: draft.draft_sequence,
      draftCount: draft.draft_count,
      temperatureClass: product?.temperature_requirement ?? undefined,
    };
  });
  const win = window.open("", "_blank", "width=900,height=1100");
  if (!win) {
    toast.error("Print window was blocked. Allow popups, then try again.");
    return false;
  }
  win.document.write(buildPalletLabelBatchPrintHtml(labels));
  win.document.close();
  void Promise.resolve(onPrinted?.());
  return true;
}

export function ReceivingPage() {
  const navigate = useNavigate();
  const { toPath } = useTenantPath();
  const queryClient = useQueryClient();
  const online = useNetworkStatus();
  const { roles, profile } = useAuth();
  const restrictedToDefaultWarehouse = shouldRestrictToDefaultWarehouse(roles);
  const { data: options } = useQuery({
    queryKey: ["options", "receiving", restrictedToDefaultWarehouse, profile?.default_warehouse_id],
    queryFn: () => fetchOptions(false, { restrictToWarehouse: restrictedToDefaultWarehouse, warehouseId: profile?.default_warehouse_id }),
  });

  const defaultWarehouseId = profile?.default_warehouse_id ?? "";
  const warehouses = options?.warehouses ?? [];
  const clients = options?.clients ?? [];
  const productOptions = (options?.products ?? []).map((p: any) => ({
    id: p.id,
    sku: p.sku,
    name: p.name,
    barcode: p.barcode,
    expiry_tracked: Boolean(p.expiry_tracked),
    temperature_requirement: p.temperature_requirement,
  }));
  const packagingProfiles = options?.packagingProfiles ?? [];
  const isMobileEntry = useIsMobileEntry();
  const productRefs = useRef<Record<string, ProductSearchHandle | null>>({});
  const totalRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const perPalletRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const palletCountRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const expiryRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const [shipmentOpen, setShipmentOpen] = useState(false);
  const [showShipmentMore, setShowShipmentMore] = useState(false);
  const [draftSearch, setDraftSearch] = useState("");
  const [printOpen, setPrintOpen] = useState(false);
  const [printContainer, setPrintContainer] = useState("");
  const [printContainerWarning, setPrintContainerWarning] = useState<string | null>(null);
  const [shipmentContainerTouched, setShipmentContainerTouched] = useState(false);
  const [shipmentContainerScanWarning, setShipmentContainerScanWarning] = useState<string | null>(null);
  const shipmentContainerInputRef = useRef<HTMLInputElement>(null);
  const shipmentPoInputRef = useRef<HTMLInputElement>(null);
  const [selectedDraftIds, setSelectedDraftIds] = useState<Set<string>>(new Set());
  const [editingDraft, setEditingDraft] = useState<DraftReceipt | null>(null);
  const [lastResult, setLastResult] = useState<{ barcode: string; taskNumber: string; qty: number } | null>(null);
  const [printAfterSaveIds, setPrintAfterSaveIds] = useState<string[]>([]);
  const [shipmentForm, setShipmentForm] = useState<ReceivingShipmentFormState>({
    receipt_type: "po",
    warehouse_id: defaultWarehouseId,
    client_id: clients.length === 1 ? clients[0].id : "",
    container_number: "",
    po_number: "",
    reference_number: "",
    lines: [newShipmentLine()],
  });

  useEffect(() => {
    setShipmentForm((current) => {
      if (current.warehouse_id) return current;
      const fill = defaultWarehouseId || (warehouses.length === 1 ? warehouses[0].id : "");
      return fill ? { ...current, warehouse_id: fill } : current;
    });
  }, [defaultWarehouseId, warehouses]);

  useEffect(() => {
    setShipmentForm((current) => clients.length === 1 && !current.client_id ? { ...current, client_id: clients[0].id } : current);
  }, [clients]);

  const currentWarehouseId = shipmentForm.warehouse_id || defaultWarehouseId || (warehouses.length === 1 ? warehouses[0].id : "");
  const { data: drafts = [], refetch: refetchDrafts } = useQuery({
    queryKey: ["draft-receipts", currentWarehouseId],
    queryFn: () => listDraftReceipts(currentWarehouseId),
    enabled: Boolean(currentWarehouseId),
  });

  const draftSearchTerm = draftSearch.trim().toLowerCase();
  const visibleDrafts = useMemo(() => {
    if (!draftSearchTerm) return drafts;
    return drafts.filter((draft) => {
      const meta = parseDraftMeta(draft.notes);
      const product = productOptions.find((p) => p.id === (draft.product_id ?? meta.product_id));
      return [
        draft.receipt_number,
        draft.reference_number,
        draft.container_number,
        draft.po_number,
        draft.draft_pallet_barcode,
        draft.source_label,
        draft.quantity,
        product?.sku,
        product?.name,
        product?.barcode,
      ].some((value) => String(value ?? "").toLowerCase().includes(draftSearchTerm));
    });
  }, [draftSearchTerm, drafts, productOptions]);

  const printDrafts = useMemo(() => {
    const term = printContainer.trim().toLowerCase();
    return term ? drafts.filter((draft) => String(draft.container_number ?? "").toLowerCase().includes(term)) : drafts;
  }, [drafts, printContainer]);

  const selectedPrintDrafts = printDrafts.filter((draft) => selectedDraftIds.has(draft.id));
  const shipmentContainerValidation = useMemo(
    () => validateIso6346ContainerNumber(shipmentForm.container_number),
    [shipmentForm.container_number],
  );
  const shipmentContainerHasValue = shipmentForm.container_number.trim().length > 0;
  const shipmentContainerInvalid = shipmentContainerHasValue && !shipmentContainerValidation.valid;
  const shipmentContainerValid = shipmentContainerHasValue && shipmentContainerValidation.valid;
  const shipmentContainerMessage = shipmentContainerScanWarning ?? (shipmentContainerHasValue
    ? shipmentContainerValidation.message
    : "Enter a valid ISO 6346 container number. Example: MSKU1234565.");
  useEffect(() => {
    if (!printOpen || selectedDraftIds.size > 0) return;
    setSelectedDraftIds(new Set(printDrafts.map((draft) => draft.id)));
  }, [printDrafts, printOpen, selectedDraftIds.size]);

  useEffect(() => {
    if (!printOpen || printAfterSaveIds.length === 0) return;
    const availableIds = new Set(drafts.map((draft) => draft.id));
    const readyIds = printAfterSaveIds.filter((id) => availableIds.has(id));
    if (readyIds.length > 0) {
      setSelectedDraftIds(new Set(readyIds));
      setPrintAfterSaveIds([]);
    }
  }, [drafts, printAfterSaveIds, printOpen]);
  const incompleteLine = shipmentForm.lines.find((line) => {
    const remainder = remainderForLine(line);
    return !line.product_id ||
      Number(line.total_quantity) <= 0 ||
      Number(line.quantity_per_pallet) <= 0 ||
      Number(line.pallet_count) <= 0 ||
      (remainder > 0 && !line.remainder_action);
  });
  const saveBlockedReason = !shipmentForm.container_number.trim()
    ? "Enter a container number before saving."
    : !shipmentContainerValidation.valid
      ? shipmentContainerValidation.message
    : !shipmentForm.warehouse_id
      ? "Select a warehouse before saving."
      : incompleteLine
        ? remainderForLine(incompleteLine) > 0 && !incompleteLine.remainder_action
          ? "Choose how to handle the leftover quantity before saving."
          : "Enter a SKU and valid quantities before saving."
        : "";
  const canSaveShipment = !saveBlockedReason;

  const saveShipmentMutation = useMutation({
    mutationFn: async (mode: "receive" | "new") => {
      const lines = shipmentForm.lines.map((line) => ({
        product_id: line.product_id,
        client_id: shipmentForm.client_id || undefined,
        packaging_profile_id: line.packaging_profile_id || undefined,
        total_quantity: Number(line.total_quantity),
        quantity_per_pallet: Number(line.quantity_per_pallet),
        pallet_count: Number(line.pallet_count),
        expiry_date: line.expiry_date || (productRequiresExpiry(productOptions.find((item) => item.id === line.product_id)) ? defaultExpiryDate() : undefined),
        lot_number: line.lot_number || undefined,
        batch_number: line.batch_number || undefined,
        remainder_quantity: remainderForLine(line),
        remainder_action: line.remainder_action || undefined,
        create_special_pallet: line.remainder_action === "special",
      }));
      const missingExpiry = shipmentForm.lines.find((line) => {
        const product = productOptions.find((item) => item.id === line.product_id);
        const computedExpiry = line.expiry_date || (productRequiresExpiry(product) ? defaultExpiryDate() : "");
        return productRequiresExpiry(product) && !computedExpiry;
      });
      if (missingExpiry) {
        const product = productOptions.find((item) => item.id === missingExpiry.product_id);
        throw new Error(`${product?.sku ?? "Selected product"} requires an expiry date.`);
      }
      if (editingDraft) {
        const line = shipmentForm.lines[0];
        await updateDraftReceipt(editingDraft.id, {
          receipt_type: shipmentForm.receipt_type,
          reference_number: shipmentForm.reference_number || shipmentForm.po_number,
          container_number: shipmentForm.container_number,
          po_number: shipmentForm.po_number,
          warehouse_id: shipmentForm.warehouse_id,
          client_id: shipmentForm.client_id,
          product_id: line.product_id,
          packaging_profile_id: line.packaging_profile_id,
          quantity: Number(line.total_quantity),
          lot_number: line.lot_number,
          batch_number: line.batch_number,
          expiry_date: line.expiry_date,
          pallet_barcode: editingDraft.draft_pallet_barcode ?? undefined,
          draft_group_id: editingDraft.draft_group_id ?? undefined,
          draft_sequence: editingDraft.draft_sequence ?? undefined,
          draft_count: editingDraft.draft_count ?? undefined,
        });
        return { mode, count: 1, edited: true, draftIds: [editingDraft.id], containerNumber: shipmentForm.container_number };
      }
      const result = await saveShipmentDrafts({
        receipt_type: shipmentForm.receipt_type,
        warehouse_id: shipmentForm.warehouse_id,
        client_id: shipmentForm.client_id || undefined,
        container_number: shipmentForm.container_number,
        po_number: shipmentForm.po_number,
        reference_number: shipmentForm.reference_number,
        lines,
      });
      return { mode, count: result.count, edited: false, draftIds: result.draftIds, containerNumber: shipmentForm.container_number };
    },
    onSuccess: async (result) => {
      toast.success(result.edited ? "Draft updated" : `${result.count} pallet draft${result.count === 1 ? "" : "s"} saved`);
      await queryClient.invalidateQueries({ queryKey: ["draft-receipts"] });
      await queryClient.invalidateQueries({ queryKey: ["dashboard-metrics"] });
      setEditingDraft(null);
      if (result.mode === "receive" && !result.edited) {
        setShipmentOpen(false);
        setPrintContainer(result.containerNumber);
        setSelectedDraftIds(new Set(result.draftIds));
        setPrintAfterSaveIds(result.draftIds);
        setPrintOpen(true);
      } else if (result.mode === "new" && !result.edited) {
        setShipmentContainerTouched(false);
        setShipmentContainerScanWarning(null);
        setShipmentForm((current) => ({
          ...current,
          container_number: "",
          po_number: "",
          reference_number: "",
          lines: [newShipmentLine()],
        }));
      } else {
        setShipmentOpen(false);
      }
    },
    onError: (error: any) => toast.error(error?.message ?? error?.details ?? "Shipment draft save failed"),
  });

  const receiveMutation = useMutation({
    mutationFn: (draft: DraftReceipt) => completeReceiptFromDraft(draft.id, draftToReceivingValues(draft)),
    onSuccess: async (result, draft) => {
      toast.success(`Pallet ${result.palletBarcode} ready — putaway task ${result.putawayTaskNumber} queued.`);
      setLastResult({ barcode: result.palletBarcode, taskNumber: result.putawayTaskNumber, qty: Number(draft.quantity ?? 0) });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["dashboard-metrics"] }),
        queryClient.invalidateQueries({ queryKey: ["putaway-tasks"] }),
        queryClient.invalidateQueries({ queryKey: ["inventory-search"] }),
        queryClient.invalidateQueries({ queryKey: ["draft-receipts"] }),
      ]);
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Receiving failed"),
  });

  const batchReceiveMutation = useMutation({
    mutationFn: async (draftsToReceive: DraftReceipt[]) => {
      const results = [];
      for (const draft of draftsToReceive) {
        results.push(await completeReceiptFromDraft(draft.id, draftToReceivingValues(draft)));
      }
      return results;
    },
    onSuccess: async (results) => {
      const count = results.length;
      toast.success(`${count} pallet label${count === 1 ? "" : "s"} printed and sent to Put-Away.`);
      setLastResult({
        barcode: count === 1 ? results[0]?.palletBarcode ?? "Pallet" : `${count} pallets`,
        taskNumber: count === 1 ? results[0]?.putawayTaskNumber ?? "queued" : "queued",
        qty: count,
      });
      setPrintOpen(false);
      setSelectedDraftIds(new Set());
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["dashboard-metrics"] }),
        queryClient.invalidateQueries({ queryKey: ["putaway-tasks"] }),
        queryClient.invalidateQueries({ queryKey: ["inventory-search"] }),
        queryClient.invalidateQueries({ queryKey: ["draft-receipts"] }),
      ]);
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Receiving failed"),
  });

  function printAndReceiveDrafts(draftsToReceive: DraftReceipt[]) {
    printDraftLabels(draftsToReceive, productOptions, clients, warehouses, packagingProfiles, () => {
      batchReceiveMutation.mutate(draftsToReceive);
    });
  }

  const deleteDraftMutation = useMutation({
    mutationFn: deleteDraftReceipt,
    onSuccess: async () => {
      toast.success("Draft cancelled");
      await queryClient.invalidateQueries({ queryKey: ["draft-receipts"] });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Draft cancel failed"),
  });

  function openNewShipment() {
    setEditingDraft(null);
    setShipmentContainerTouched(false);
    setShipmentContainerScanWarning(null);
    setShipmentForm({
      receipt_type: "po",
      warehouse_id: currentWarehouseId,
      client_id: clients.length === 1 ? clients[0].id : "",
      container_number: "",
      po_number: "",
      reference_number: "",
      lines: [newShipmentLine()],
    });
    setShipmentOpen(true);
  }

  function openEditDraft(draft: DraftReceipt) {
    const values = draftToReceivingValues(draft);
    setEditingDraft(draft);
    setShipmentContainerTouched(Boolean(values.container_number));
    setShipmentContainerScanWarning(null);
    setShipmentForm({
      receipt_type: values.receipt_type,
      warehouse_id: values.warehouse_id,
      client_id: values.client_id ?? "",
      container_number: values.container_number ?? "",
      po_number: values.po_number ?? "",
      reference_number: values.reference_number ?? "",
      lines: [{
        ...newShipmentLine(values.product_id),
        total_quantity: Number(values.quantity),
        quantity_per_pallet: Number(values.quantity),
        pallet_count: 1,
        expiry_date: values.expiry_date ?? "",
        lot_number: values.lot_number ?? "",
        batch_number: values.batch_number ?? "",
        packaging_profile_id: values.packaging_profile_id ?? "",
      }],
    });
    setShipmentOpen(true);
  }

  function updateLine(id: string, patch: Partial<ReceivingShipmentLineState>, changed?: "total" | "perPallet" | "count") {
    setShipmentForm((current) => ({
      ...current,
      lines: current.lines.map((line) => {
        if (line.id !== id) return line;
        const next = { ...line, ...patch };
        return changed ? distributeShipmentLine(next, changed) : next;
      }),
    }));
  }

  function focusShipmentField(lineId: string, field: "total" | "perPallet" | "count" | "expiry") {
    const target =
      field === "total" ? totalRefs.current[lineId] :
      field === "perPallet" ? perPalletRefs.current[lineId] :
      field === "count" ? palletCountRefs.current[lineId] :
      expiryRefs.current[lineId];
    setTimeout(() => target?.focus(), 40);
  }

  function openDatePicker(input: HTMLInputElement | null) {
    if (!input) return;
    input.focus();
    try {
      input.showPicker?.();
    } catch {
      // Some browsers only allow showPicker from direct user gestures.
    }
  }

  function moveToNextShipmentField(lineId: string, field: "product" | "total" | "perPallet" | "count") {
    if (field === "product") { focusShipmentField(lineId, "total"); return; }
    if (field === "total") { focusShipmentField(lineId, "perPallet"); return; }
    if (field === "perPallet") { focusShipmentField(lineId, "count"); return; }
    setTimeout(() => openDatePicker(expiryRefs.current[lineId]), 40);
  }

  const canAddSkuLine = shipmentForm.lines.every((line) => Boolean(line.product_id) && Number(line.total_quantity) > 0);

  function saveShipment(mode: "receive" | "new") {
    if (!canSaveShipment) {
      toast.error(saveBlockedReason);
      return;
    }
    saveShipmentMutation.mutate(mode);
  }

  function setShipmentContainer(value: unknown) {
    setShipmentContainerTouched(true);
    setShipmentContainerScanWarning(null);
    setShipmentForm((cur) => ({ ...cur, container_number: normalizeContainerNumber(value) }));
  }

  function applyShipmentContainerScan(value: unknown) {
    const result = resolveContainerScanValue(value);
    setShipmentContainerTouched(true);
    setShipmentContainerScanWarning(result.valid ? null : result.message);
    setShipmentForm((cur) => ({ ...cur, container_number: result.value }));
    if (!result.valid) toast.warning(result.message);
  }

  function applyDraftSearchScan(value: unknown) {
    const result = resolveContainerScanValue(value);
    if (result.valid) {
      setDraftSearch(result.value);
      return;
    }
    if (result.candidate) {
      toast.warning(result.message);
      setDraftSearch(result.value);
      return;
    }
    setDraftSearch(normalizeScannerText(value));
  }

  function applyPrintContainerScan(value: unknown) {
    const result = resolveContainerScanValue(value);
    setPrintContainer(result.value);
    setPrintContainerWarning(result.valid ? null : result.message);
    if (!result.valid) toast.warning(result.message);
  }

  return (
    <div className="flex min-h-full flex-col gap-6">
      {!online && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
          Connection is unstable. Finish scan work already in progress, then move to better signal and use Sync/Refresh before starting new receiving batches.
        </div>
      )}
      {lastResult && (
        <div className="flex flex-col gap-2 rounded-lg border border-green-200 bg-green-50 p-4 dark:border-green-900 dark:bg-green-950/30 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-semibold text-green-800 dark:text-green-300">Pallet {lastResult.barcode} received · {lastResult.qty} units</p>
            <p className="text-xs text-green-700 dark:text-green-400">Put-Away task {lastResult.taskNumber} queued</p>
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => navigate(toPath("/putaway-tasks"))}>Go to Put-Away</Button>
            <Button size="sm" variant="ghost" onClick={() => setLastResult(null)}>x</Button>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-2xl font-semibold">Receiving</h2>
          <p className="text-sm text-muted-foreground">Create shipment drafts by container, print labels, then receive selected pallets.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => { refetchDrafts(); void flushOfflineQueue(); }}>
            <RefreshCw data-icon="inline-start" />
            Sync / Refresh
          </Button>
          <Button variant="outline" onClick={() => {
            setPrintContainer(draftSearch);
            setSelectedDraftIds(new Set(visibleDrafts.map((draft) => draft.id)));
            setPrintOpen(true);
          }}>
            <Printer data-icon="inline-start" />
            Print drafts
          </Button>
          <Button onClick={openNewShipment}>
            <Plus data-icon="inline-start" />
            New shipment
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="grid gap-3 p-4">
          <div className="flex min-w-0 gap-2">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="search"
                className="pl-9"
                value={draftSearch}
                onChange={(event) => setDraftSearch(event.target.value)}
                placeholder="Search container, PO, pallet, SKU, product, receipt"
              />
            </div>
            <BarcodeScanButton title="Scan container, PO, or pallet" enableTextRecognition onScan={applyDraftSearchScan} />
          </div>
        </CardContent>
      </Card>

      <Card className="min-h-0">
        <CardHeader>
          <CardTitle className="text-base">Draft Pallets {drafts.length > 0 && <Badge variant="secondary">{drafts.length}</Badge>}</CardTitle>
          <CardDescription>Use Print for labels, Edit for quantity/date corrections, and Receive when the physical pallet is confirmed.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          {visibleDrafts.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
              {drafts.length === 0 ? "No draft pallets yet." : `No drafts matched "${draftSearch}".`}
            </p>
          ) : visibleDrafts.map((draft) => {
            const meta = parseDraftMeta(draft.notes);
            const product = productOptions.find((p) => p.id === (draft.product_id ?? meta.product_id));
            const client = clients.find((item) => item.id === draft.client_id);
            const warehouse = warehouses.find((item) => item.id === draft.warehouse_id);
            const packaging = packagingProfiles.find((item: any) => item.id === meta.packaging_profile_id);
            const barcode = draft.draft_pallet_barcode ?? meta.draft_pallet_barcode ?? draft.receipt_number;
            return (
              <div key={draft.id} className="grid gap-3 rounded-lg border border-border px-4 py-3 lg:grid-cols-[1fr_auto] lg:items-center">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate text-sm font-medium">{product ? `${product.sku} · ${product.name}` : "Unknown product"}</p>
                    <Badge variant="outline" className="font-mono">{barcode}</Badge>
                    {draft.draft_sequence && draft.draft_count ? <Badge variant="secondary">{draft.draft_sequence}/{draft.draft_count}</Badge> : null}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Container {draft.container_number ?? "—"} · PO {draft.po_number ?? draft.reference_number ?? "—"} · Qty {draft.quantity ?? "?"} · Exp {draft.expiry_date ? formatDate(draft.expiry_date) : "—"}
                  </p>
                  {draft.source_label && <p className="text-xs font-medium text-amber-700 dark:text-amber-300">Returned from {draft.source_label}</p>}
                </div>
                <div className="flex flex-wrap gap-2 lg:justify-end">
                  <PalletLabelPage
                    barcode={barcode}
                    quantity={Number(draft.quantity ?? meta.quantity ?? 1)}
                    productSku={product?.sku}
                    productName={product?.name}
                    lotNumber={draft.lot_number ?? meta.lot_number}
                    batchNumber={draft.batch_number ?? meta.batch_number}
                    expiryDate={draft.expiry_date ?? meta.expiry_date}
                    containerNumber={draft.container_number ?? meta.container_number}
                    poNumber={draft.po_number ?? meta.po_number}
                    clientName={client?.name}
                    warehouseName={warehouse ? `${warehouse.code ? `${warehouse.code} - ` : ""}${warehouse.name}` : undefined}
                    receiptReference={draft.reference_number ?? draft.receipt_number}
                    packaging={packaging?.name ?? packaging?.unit_name ?? packaging?.unit_of_measure}
                    draftSequence={draft.draft_sequence}
                    draftCount={draft.draft_count}
                    temperatureClass={product?.temperature_requirement}
                    onPrinted={async () => { await receiveMutation.mutateAsync(draft); }}
                    trigger={<Button size="sm" variant="outline" disabled={receiveMutation.isPending}><Printer data-icon="inline-start" />Print & Receive</Button>}
                  />
                  <Button size="sm" variant="outline" onClick={() => openEditDraft(draft)}><Pencil data-icon="inline-start" />Edit</Button>
                  {draft.status === "draft" && (
                    <Button size="sm" variant="ghost" onClick={() => deleteDraftMutation.mutate(draft.id)} disabled={deleteDraftMutation.isPending}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Dialog open={shipmentOpen} onOpenChange={(open) => { setShipmentOpen(open); if (!open) setEditingDraft(null); }}>
        <DialogContent className="h-[calc(100dvh-0.75rem)] max-h-[calc(100dvh-0.75rem)] w-[calc(100vw-0.75rem)] overflow-hidden bg-card p-0 text-card-foreground sm:h-auto sm:max-h-[92vh] sm:max-w-[min(72rem,96vw)]">
          <DialogHeader className="border-b border-border px-3 py-2 sm:px-4 sm:py-3">
            <DialogTitle>{editingDraft ? "Edit Draft Pallet" : "New Shipment"}</DialogTitle>
            <DialogDescription className="text-xs sm:text-sm">Container and PO come first, then one or more SKU lines with expiry and pallet distribution.</DialogDescription>
          </DialogHeader>
          <div className="max-h-[calc(100dvh-8.75rem)] overflow-y-auto px-3 py-3 sm:max-h-[calc(92vh-150px)] sm:px-4 sm:py-4">
            <div className="grid gap-3 sm:gap-4">
              <div className="grid grid-cols-2 items-start gap-2 sm:gap-3 md:grid-cols-3">
                <div className="grid gap-1.5">
                  <ShipmentFieldLabel>Container number</ShipmentFieldLabel>
                  <div className="flex gap-2">
                    <Input
                      ref={shipmentContainerInputRef}
                      className={cn(
                        "h-9 sm:h-10",
                        shipmentContainerTouched && shipmentContainerInvalid && "border-destructive focus-visible:ring-destructive",
                        shipmentContainerValid && "border-green-500 focus-visible:ring-green-500",
                      )}
                      autoFocus
                      value={shipmentForm.container_number}
                      onBlur={() => setShipmentContainerTouched(true)}
                      onChange={(e) => setShipmentContainer(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); shipmentPoInputRef.current?.focus(); } }}
                      aria-invalid={shipmentContainerInvalid}
                      aria-describedby="container-number-help"
                    />
                    <BarcodeScanButton className="h-9 self-start sm:h-10" title="Scan container number" enableTextRecognition inputRef={shipmentContainerInputRef} onScan={applyShipmentContainerScan} />
                  </div>
                  <p
                    id="container-number-help"
                    className={cn(
                      "text-xs",
                      shipmentContainerTouched && shipmentContainerInvalid ? "text-destructive" : shipmentContainerValid ? "text-green-500" : "text-muted-foreground",
                    )}
                  >
                    {shipmentContainerMessage}
                  </p>
                </div>
                <div className="grid gap-1.5">
                  <ShipmentFieldLabel>PO number</ShipmentFieldLabel>
                  <Input ref={shipmentPoInputRef} className="h-9 sm:h-10" value={shipmentForm.po_number} onChange={(e) => setShipmentForm((cur) => ({ ...cur, po_number: e.target.value.toUpperCase(), reference_number: e.target.value.toUpperCase() }))} />
                </div>
                <div className="col-span-2 grid gap-1.5 md:col-span-1">
                  <ShipmentFieldLabel>Warehouse</ShipmentFieldLabel>
                  <Select value={shipmentForm.warehouse_id || undefined} onValueChange={(value) => setShipmentForm((cur) => ({ ...cur, warehouse_id: value }))}>
                    <SelectTrigger className="h-9 sm:h-10"><SelectValue placeholder="Select warehouse" /></SelectTrigger>
                    <SelectContent>
                      {warehouses.length === 0 ? <SelectItem value="__loading_warehouses" disabled>Loading warehouses...</SelectItem> : null}
                      {warehouses.filter((w: any) => Boolean(w.id)).map((w: any) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <button type="button" className="w-fit text-sm font-medium text-primary underline-offset-2 hover:underline" onClick={() => setShowShipmentMore((v) => !v)}>
                {showShipmentMore ? "Hide" : "Show"} shipment options
              </button>
              {showShipmentMore && (
                <div className="grid gap-3 rounded-lg border border-border bg-secondary/20 p-3 md:grid-cols-3">
                  <div className="grid gap-1.5">
                    <ShipmentFieldLabel>Receipt type</ShipmentFieldLabel>
                    <Select value={shipmentForm.receipt_type} onValueChange={(value) => setShipmentForm((cur) => ({ ...cur, receipt_type: value as ReceivingShipmentFormState["receipt_type"] }))}>
                      <SelectTrigger className="h-9 sm:h-10"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="po">Purchase Order</SelectItem>
                        <SelectItem value="transfer">Transfer</SelectItem>
                        <SelectItem value="other">Manual / Other</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-1.5">
                    <ShipmentFieldLabel>Client</ShipmentFieldLabel>
                    <Select value={shipmentForm.client_id || undefined} onValueChange={(value) => setShipmentForm((cur) => ({ ...cur, client_id: value }))}>
                      <SelectTrigger className="h-9 sm:h-10"><SelectValue placeholder="Select client" /></SelectTrigger>
                      <SelectContent>
                        {clients.length === 0 ? <SelectItem value="__no_clients" disabled>No clients available</SelectItem> : null}
                        {clients.filter((client: any) => Boolean(client.id)).map((client: any) => <SelectItem key={client.id} value={client.id}>{client.code} · {client.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-1.5">
                    <ShipmentFieldLabel>Reference</ShipmentFieldLabel>
                    <Input className="h-9 sm:h-10" value={shipmentForm.reference_number} onChange={(e) => setShipmentForm((cur) => ({ ...cur, reference_number: normalizeScannerText(e.target.value) }))} />
                  </div>
                </div>
              )}

              <div className="grid gap-3">
                {shipmentForm.lines.map((line, index) => {
                  const remainder = remainderForLine(line);
                  const selectedProduct = productOptions.find((product) => product.id === line.product_id);
                  const expiryRequired = productRequiresExpiry(selectedProduct);
                  const allocatedQuantity = Math.max(0, Number(line.quantity_per_pallet || 0) * Number(line.pallet_count || 0));
                  return (
                    <div key={line.id} className="grid gap-2 rounded-lg border border-border p-2 sm:gap-3 sm:p-3">
                      <div className="flex items-center justify-between gap-3">
                        <p className="font-medium">SKU line {index + 1}</p>
                        {!editingDraft && shipmentForm.lines.length > 1 && (
                          <Button size="sm" variant="ghost" onClick={() => setShipmentForm((cur) => ({ ...cur, lines: cur.lines.filter((item) => item.id !== line.id) }))}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                      <div className="grid grid-cols-3 gap-2 lg:grid-cols-[2fr_repeat(3,1fr)] lg:gap-3">
                        <div className="col-span-3 grid gap-1.5 lg:col-span-1">
                          <ShipmentFieldLabel>Product</ShipmentFieldLabel>
                          <ProductSearch
                            ref={(node) => { productRefs.current[line.id] = node; }}
                            value={line.product_id}
                            options={productOptions}
                            placeholder="Select SKU"
                            onChange={(value) => {
                              const product = productOptions.find((item) => item.id === value);
                              updateLine(line.id, {
                                product_id: value,
                                expiry_date: productRequiresExpiry(product) && !line.expiry_date ? defaultExpiryDate() : line.expiry_date,
                              });
                            }}
                            onSelectComplete={() => moveToNextShipmentField(line.id, "product")}
                          />
                        </div>
                        <div className="grid gap-1.5">
                          <ShipmentFieldLabel>Total received</ShipmentFieldLabel>
                          <Input
                            ref={(node) => { totalRefs.current[line.id] = node; }}
                            className="h-9 sm:h-10"
                            type="number"
                            inputMode="numeric"
                            pattern="[0-9]*"
                            min={0}
                            value={line.total_quantity}
                            onFocus={(e) => e.currentTarget.select()}
                            onKeyDown={(e) => { if (e.key === "Enter") moveToNextShipmentField(line.id, "total"); }}
                            onChange={(e) => updateLine(line.id, { total_quantity: e.currentTarget.valueAsNumber || Number(e.currentTarget.value) || 0 }, "total")}
                          />
                        </div>
                        <div className="grid gap-1.5">
                          <ShipmentFieldLabel>Qty per pallet</ShipmentFieldLabel>
                          <Input
                            ref={(node) => { perPalletRefs.current[line.id] = node; }}
                            className="h-9 sm:h-10"
                            type="number"
                            inputMode="numeric"
                            pattern="[0-9]*"
                            min={1}
                            value={line.quantity_per_pallet}
                            onFocus={(e) => e.currentTarget.select()}
                            onKeyDown={(e) => { if (e.key === "Enter") moveToNextShipmentField(line.id, "perPallet"); }}
                            onChange={(e) => updateLine(line.id, { quantity_per_pallet: e.currentTarget.valueAsNumber || Number(e.currentTarget.value) || 1 }, "perPallet")}
                          />
                        </div>
                        <div className="grid gap-1.5">
                          <ShipmentFieldLabel>Pallets</ShipmentFieldLabel>
                          <Input
                            ref={(node) => { palletCountRefs.current[line.id] = node; }}
                            className="h-9 sm:h-10"
                            type="number"
                            inputMode="numeric"
                            pattern="[0-9]*"
                            min={1}
                            value={line.pallet_count}
                            onFocus={(e) => e.currentTarget.select()}
                            onKeyDown={(e) => { if (e.key === "Enter") moveToNextShipmentField(line.id, "count"); }}
                            onChange={(e) => updateLine(line.id, { pallet_count: e.currentTarget.valueAsNumber || Number(e.currentTarget.value) || 1 }, "count")}
                          />
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-2 md:grid-cols-4 md:gap-3">
                        <div className="grid gap-1.5">
                          <ShipmentFieldLabel>Expiry{expiryRequired ? " *" : ""}</ShipmentFieldLabel>
                          <Input
                            ref={(node) => { expiryRefs.current[line.id] = node; }}
                            className={cn("h-9 sm:h-10", expiryRequired && !line.expiry_date && "border-amber-500")}
                            type="date"
                            required={expiryRequired}
                            aria-invalid={expiryRequired && !line.expiry_date}
                            value={line.expiry_date}
                            onClick={(e) => openDatePicker(e.currentTarget)}
                            onFocus={(e) => isMobileEntry && openDatePicker(e.currentTarget)}
                            onChange={(e) => updateLine(line.id, { expiry_date: e.target.value })}
                          />
                        </div>
                        <div className="grid gap-1.5">
                          <ShipmentFieldLabel>Lot</ShipmentFieldLabel>
                          <Input className="h-9 sm:h-10" value={line.lot_number} onChange={(e) => updateLine(line.id, { lot_number: normalizeScannerText(e.target.value) })} />
                        </div>
                        <div className="grid gap-1.5">
                          <ShipmentFieldLabel>Batch</ShipmentFieldLabel>
                          <Input className="h-9 sm:h-10" value={line.batch_number} onChange={(e) => updateLine(line.id, { batch_number: normalizeScannerText(e.target.value) })} />
                        </div>
                        <div className="col-span-2 grid gap-1.5 md:col-span-1">
                          <ShipmentFieldLabel>Packaging</ShipmentFieldLabel>
                          <Select value={line.packaging_profile_id || undefined} onValueChange={(value) => updateLine(line.id, { packaging_profile_id: value })}>
                            <SelectTrigger className="h-9 sm:h-10"><SelectValue placeholder="Optional" /></SelectTrigger>
                            <SelectContent>
                              {packagingProfiles.length === 0 ? <SelectItem value="__no_packaging" disabled>No packaging profiles</SelectItem> : null}
                              {packagingProfiles.filter((profile: any) => Boolean(profile.id)).map((profile: any) => <SelectItem key={profile.id} value={profile.id}>{profile.profile_name}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                      {remainder > 0 && (
                        <div className="grid gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
                          <p className="font-medium">{remainder} unit{remainder === 1 ? "" : "s"} will be left after creating {line.pallet_count} pallet{Number(line.pallet_count) === 1 ? "" : "s"} of {line.quantity_per_pallet}.</p>
                          <p className="text-xs">Allocated in WMS: {allocatedQuantity}. Total received: {line.total_quantity}.</p>
                          <div className="grid gap-2 sm:grid-cols-3">
                            {[
                              ["waive", "Waive remainder"],
                              ["manual", "Manage outside WMS"],
                              ["special", "Create special pallet"],
                            ].map(([value, label]) => (
                              <label key={value} className="flex items-center gap-2 rounded-md border border-amber-300 bg-background px-3 py-2">
                                <input type="radio" name={`remainder-${line.id}`} checked={line.remainder_action === value} onChange={() => updateLine(line.id, { remainder_action: value as ReceivingShipmentLineState["remainder_action"] })} />
                                {label}
                              </label>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
                {!editingDraft && (
                  <Button
                    className="h-9 sm:h-10"
                    type="button"
                    variant="outline"
                    disabled={!canAddSkuLine}
                    title={canAddSkuLine ? "Add SKU line" : "Enter a SKU and quantity before adding another line"}
                    onClick={() => setShipmentForm((cur) => ({ ...cur, lines: [...cur.lines, newShipmentLine()] }))}
                  >
                    <Plus data-icon="inline-start" />
                    Add SKU line
                  </Button>
                )}
              </div>
            </div>
          </div>
          <DialogFooter className="flex-row flex-wrap justify-end gap-2 border-t border-border px-3 py-2 sm:px-4 sm:py-3">
            {saveBlockedReason && (
              <p className="mr-auto w-full text-xs font-medium text-amber-500 sm:w-auto sm:self-center">{saveBlockedReason}</p>
            )}
            <Button variant="outline" onClick={() => setShipmentOpen(false)}>Cancel</Button>
            {!editingDraft && (
              <Button variant="outline" disabled={saveShipmentMutation.isPending || !canSaveShipment} onClick={() => saveShipment("new")}>
                {saveShipmentMutation.isPending ? <Loader2 className="animate-spin" /> : null}
                Save & New
              </Button>
            )}
            <Button disabled={saveShipmentMutation.isPending || !canSaveShipment} onClick={() => saveShipment("receive")}>
              {saveShipmentMutation.isPending ? <Loader2 className="animate-spin" /> : null}
              {editingDraft ? "Save Draft" : "Save & Receive"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={printOpen} onOpenChange={setPrintOpen}>
        <DialogContent className="max-h-[90vh] overflow-hidden sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Print Draft Labels</DialogTitle>
            <DialogDescription>Filter by container, select draft pallets, then print the selected labels together.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <div className="flex gap-2">
                <Input
                  value={printContainer}
                  onChange={(e) => {
                    const next = normalizeContainerNumber(e.target.value);
                    setPrintContainer(next);
                    if (next.length >= 11) {
                      const validation = validateIso6346ContainerNumber(next);
                      setPrintContainerWarning(validation.valid ? null : validation.message);
                    } else {
                      setPrintContainerWarning(null);
                    }
                  }}
                  className={cn(printContainerWarning && "border-destructive focus-visible:ring-destructive")}
                  placeholder="Filter by container number"
                  aria-invalid={Boolean(printContainerWarning)}
                />
                <BarcodeScanButton title="Scan container number" enableTextRecognition onScan={applyPrintContainerScan} />
              </div>
              <p className={cn("text-xs", printContainerWarning ? "text-destructive" : "text-muted-foreground")}>
                {printContainerWarning ?? "Enter or scan an ISO 6346 container number to narrow this label batch."}
              </p>
            </div>
            <div className="max-h-[50vh] overflow-y-auto pr-3">
              <div className="grid gap-2">
                {printDrafts.map((draft) => {
                  const meta = parseDraftMeta(draft.notes);
                  const product = productOptions.find((p) => p.id === (draft.product_id ?? meta.product_id));
                  const checked = selectedDraftIds.has(draft.id);
                  return (
                    <label key={draft.id} className="flex cursor-pointer items-center gap-3 rounded-md border border-border px-3 py-2">
                      <Checkbox checked={checked} onCheckedChange={(value) => {
                        setSelectedDraftIds((current) => {
                          const next = new Set(current);
                          if (value) next.add(draft.id); else next.delete(draft.id);
                          return next;
                        });
                      }} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{draft.draft_pallet_barcode ?? draft.receipt_number} · {product?.sku ?? "Unknown SKU"}</span>
                        <span className="block text-xs text-muted-foreground">Container {draft.container_number ?? "—"} · Qty {draft.quantity ?? "?"}</span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSelectedDraftIds(new Set(printDrafts.map((draft) => draft.id)))}>Select all shown</Button>
            <Button disabled={batchReceiveMutation.isPending || selectedPrintDrafts.length === 0} onClick={() => printAndReceiveDrafts(selectedPrintDrafts)}>
              {batchReceiveMutation.isPending ? <Loader2 className="animate-spin" /> : <Printer data-icon="inline-start" />}
              Print selected & send to Put-Away
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function TextField({
  form,
  name,
  label,
  type = "text",
  hint,
}: {
  form: UseFormReturn<any>;
  name: string;
  label: string;
  type?: string;
  hint?: string;
}) {
  return (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{label}</FormLabel>
          <FormControl>
            <Input {...field} type={type} value={(field.value as string | number | readonly string[] | undefined) ?? ""} />
          </FormControl>
          {hint ? <FormDescription>{hint}</FormDescription> : null}
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

export function SelectField({
  form,
  name,
  label,
  options,
  hint,
}: {
  form: UseFormReturn<any>;
  name: string;
  label: string;
  options: Array<{ label: string; value: string }>;
  hint?: string;
}) {
  return (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{label}</FormLabel>
          <Select onValueChange={field.onChange} value={(field.value as string | undefined) ?? undefined}>
            <FormControl>
              <SelectTrigger>
                <SelectValue placeholder={`Select ${label.toLowerCase()}`} />
              </SelectTrigger>
            </FormControl>
            <SelectContent>
              {options.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {hint ? <FormDescription>{hint}</FormDescription> : null}
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

export function BinCapacityBar({ locationCode }: { locationCode: string; taskId?: string }) {
  const { data } = useQuery({
    queryKey: ["bin-occupancy", locationCode],
    queryFn: () => getBinOccupancy(locationCode),
    enabled: locationCode.length >= 2,
    staleTime: 0,
  });

  if (!data || !locationCode) return null;

  const { maxPallets, occupiedPallets, status } = data;
  const pct = maxPallets > 0 ? Math.min(100, Math.round((occupiedPallets / maxPallets) * 100)) : 0;
  const isFull = maxPallets > 0 && occupiedPallets >= maxPallets;
  const isNearFull = pct >= 80 && !isFull;
  const isBlocked = status !== "active";

  if (isBlocked) {
    return (
      <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
        Location unavailable (status: {status})
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>Bin capacity</span>
        <span className={cn(isFull ? "text-red-600 font-semibold" : isNearFull ? "text-amber-600" : "text-green-700")}>
          {occupiedPallets} / {maxPallets} pallets
        </span>
      </div>
      <Progress
        value={pct}
        className={cn(
          "h-2",
          isFull ? "[&>div]:bg-red-500" : isNearFull ? "[&>div]:bg-amber-500" : "[&>div]:bg-green-500",
        )}
      />
      {isFull && (
        <p className="text-xs font-medium text-red-600 dark:text-red-400">
          Location FULL — scan a different location
        </p>
      )}
    </div>
  );
}

export function WarehouseBayBrowserDialog({
  open,
  warehouseId,
  onSelectBay,
  onClose,
}: {
  open: boolean;
  warehouseId: string;
  onSelectBay: (bayCode: string) => void;
  onClose: () => void;
}) {
  const { data: bays = [], isLoading, error } = useQuery<WarehouseBayGroup[]>({
    queryKey: ["warehouse-bay-occupancy", warehouseId],
    queryFn: () => getWarehouseBayOccupancy(warehouseId),
    staleTime: 30_000,
    enabled: open && Boolean(warehouseId),
  });

  // Collapsible zone state – all expanded by default
  const [collapsedZones, setCollapsedZones] = useState<Set<string>>(new Set());
  const toggleZone = (zk: string) =>
    setCollapsedZones((prev) => {
      const next = new Set(prev);
      next.has(zk) ? next.delete(zk) : next.add(zk);
      return next;
    });

  // Group by zone (ordered by zone name), then by aisle within each zone
  const zoneGroups = useMemo(() => {
    const zoneMap = new Map<string, { zoneName: string; aisles: Map<string, WarehouseBayGroup[]> }>();
    for (const bay of bays) {
      const zk = bay.zoneCode || "__no_zone__";
      if (!zoneMap.has(zk)) zoneMap.set(zk, { zoneName: bay.zoneName || "", aisles: new Map() });
      const zone = zoneMap.get(zk)!;
      const ak = bay.aisle ?? "";
      if (!zone.aisles.has(ak)) zone.aisles.set(ak, []);
      zone.aisles.get(ak)!.push(bay);
    }
    return Array.from(zoneMap.entries())
      .sort(([, a], [, b]) => a.zoneName.localeCompare(b.zoneName))
      .map(([zk, { zoneName, aisles }]) => ({
        zoneKey: zk,
        zoneName,
        aisles: Array.from(aisles.entries())
          .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
          .map(([aisleCode, grpBays]) => ({ aisleCode, bays: grpBays })),
      }));
  }, [bays]);

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Select a bay</DialogTitle>
          <DialogDescription>Tap a bay to load its locations into the scan field.</DialogDescription>
        </DialogHeader>
        {isLoading && (
          <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Loading rack locations…
          </div>
        )}
        {error && (
          <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
            Could not load rack locations.
          </div>
        )}
        {!isLoading && !error && bays.length === 0 && (
          <p className="py-4 text-center text-sm text-muted-foreground">No rack locations configured for this warehouse.</p>
        )}
        <div className="divide-y divide-border/40">
          {zoneGroups.map((zone) => {
            const collapsed = collapsedZones.has(zone.zoneKey);
            return (
              <div key={zone.zoneKey} className="py-3 first:pt-1">
                {/* Zone header – tap to collapse / expand */}
                <button
                  type="button"
                  onClick={() => toggleZone(zone.zoneKey)}
                  className="flex w-full items-center justify-between gap-2 pb-1 text-left"
                >
                  <span className="text-xs font-semibold uppercase tracking-widest text-foreground/80">
                    {zone.zoneName || "Unassigned"}
                  </span>
                  <ChevronDown
                    className={cn(
                      "h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform duration-200",
                      collapsed && "-rotate-90",
                    )}
                  />
                </button>

                {/* Aisles within zone */}
                {!collapsed && (
                  <div className="mt-1.5 space-y-3">
                    {zone.aisles.map((aisleGroup) => (
                      <div key={aisleGroup.aisleCode}>
                        {/* Aisle separator line with code on the left */}
                        <div className="mb-2 flex items-center gap-2">
                          <span className="font-mono text-[10px] font-semibold text-muted-foreground whitespace-nowrap">
                            {aisleGroup.aisleCode}
                          </span>
                          <div className="h-px flex-1 bg-border/50" />
                        </div>
                        {/* Bay cards – single horizontal flex row, wraps on overflow */}
                        <div className="flex flex-wrap gap-1.5">
                          {aisleGroup.bays.map((bay) => {
                            const pct = bay.totalCapacity > 0 ? bay.totalOccupied / bay.totalCapacity : 0;
                            const isFull = bay.totalCapacity > 0 && bay.totalOccupied >= bay.totalCapacity;
                            const isNearFull = pct >= 0.7;
                            return (
                              <button
                                key={bay.bayCode}
                                type="button"
                                disabled={isFull}
                                onClick={() => { onSelectBay(bay.bayCode); onClose(); }}
                                className={cn(
                                  "flex flex-col gap-1 rounded-md border p-2.5 text-left text-xs transition focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
                                  isFull
                                    ? "cursor-not-allowed border-muted bg-muted/40 opacity-60"
                                    : "border-border bg-card hover:bg-secondary/60",
                                )}
                              >
                                <span className="font-mono font-semibold text-foreground leading-none">
                                  {bay.aisle}-{bay.bay}
                                </span>
                                <span className="text-muted-foreground leading-none">
                                  {bay.totalOccupied}/{bay.totalCapacity}
                                </span>
                                <div className="mt-0.5 h-1 w-full overflow-hidden rounded-full bg-muted">
                                  <div
                                    className={cn(
                                      "h-full rounded-full transition-all",
                                      isFull ? "bg-red-500" : isNearFull ? "bg-amber-500" : "bg-green-500",
                                    )}
                                    style={{ width: `${Math.min(100, Math.round(pct * 100))}%` }}
                                  />
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function BayOccupancyGrid({
  locationCode,
  selectedLocationCode,
  onSelect,
}: {
  locationCode: string;
  selectedLocationCode?: string;
  onSelect: (locationCode: string) => void;
}) {
  const isBayScan = isBaySelectorCode(locationCode);
  const selectedLocation = selectedLocationCode?.trim().toUpperCase() ?? "";
  const { data, error, isLoading } = useQuery({
    queryKey: ["bay-occupancy", locationCode],
    queryFn: () => getBayOccupancy(locationCode),
    enabled: locationCode.length >= 2,
    staleTime: 0,
  });

  if (isLoading && !data) {
    return (
      <div className="rounded-md border border-border bg-secondary/20 px-3 py-2 text-xs text-muted-foreground">
        Loading bay locations…
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
        Bay locations could not load. Scan again or refresh the page.
      </div>
    );
  }

  if (!data || data.cells.length === 0) {
    return isBayScan ? (
      <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
        No active rack locations found for this bay barcode.
      </div>
    ) : null;
  }

  return (
    <div className="grid gap-2 rounded-md border border-border bg-secondary/20 p-3">
      <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
        <span>Bay {data.aisle ?? "?"}-{data.bay ?? "?"}</span>
        <span>{data.cells.filter((cell) => cell.status === "active" && !cell.isFull).length} open</span>
      </div>
      <div className="grid gap-2">
        {buildBayOccupancyGrid(data.cells).map((row) => (
          <div
            key={`level-${row[0]?.level ?? "unknown"}`}
            className="grid gap-2"
            style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}
          >
            {row.map((slot) => {
              const cell = slot.cell;
              if (!cell) {
                return (
                  <div
                    key={`empty-${slot.level}-${slot.position}`}
                    aria-hidden="true"
                    className="min-h-16 rounded-md border border-dashed border-border/60 bg-background/40"
                  />
                );
              }

              const available = cell.status === "active" && !cell.isFull;
              const selected = selectedLocation.length > 0 && cell.locationCode.toUpperCase() === selectedLocation;
              return (
                <button
                  key={cell.locationId}
                  type="button"
                  disabled={!available}
                  onClick={() => onSelect(cell.locationCode)}
                  className={cn(
                    "min-h-16 rounded-md border px-2 py-2 text-left text-xs transition focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
                    selected
                      ? "animate-pulse border-cyan-400 bg-cyan-50 text-cyan-950 ring-2 ring-cyan-400 dark:bg-cyan-950/50 dark:text-cyan-50"
                      : available
                      ? "border-green-500 bg-green-50 text-green-950 hover:bg-green-100 dark:bg-green-950/40 dark:text-green-100"
                      : "cursor-not-allowed border-muted bg-muted text-muted-foreground opacity-70",
                  )}
                >
                  <span className="block font-mono font-semibold">{cell.locationCode}</span>
                  <span className="mt-1 block">{cell.occupiedPallets}/{cell.maxPallets} pallets</span>
                  <span className="block">{selected && available ? "Selected" : available ? "Available" : cell.status !== "active" ? cell.status : "Full"}</span>
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

export function incrementOccupancy(occupiedPallets: number, maxPallets: number) {
  return maxPallets > 0 ? Math.min(maxPallets, occupiedPallets + 1) : occupiedPallets + 1;
}

export function markPutawayOccupancyCached(queryClient: ReturnType<typeof useQueryClient>, locationCode: string) {
  const confirmedLocation = locationCode.trim().toUpperCase();
  if (!confirmedLocation) return;

  queryClient.setQueriesData(
    { queryKey: ["bin-occupancy"] },
    (current: Awaited<ReturnType<typeof getBinOccupancy>> | null | undefined) => {
      if (!current || current.locationCode.toUpperCase() !== confirmedLocation) return current;
      const occupiedPallets = incrementOccupancy(current.occupiedPallets, current.maxPallets);
      return {
        ...current,
        occupiedPallets,
      };
    },
  );

  queryClient.setQueriesData(
    { queryKey: ["bay-occupancy"] },
    (current: Awaited<ReturnType<typeof getBayOccupancy>> | null | undefined) => {
      if (!current) return current;
      let changed = false;
      const cells = current.cells.map((cell: BayOccupancyCell) => {
        if (cell.locationCode.toUpperCase() !== confirmedLocation) return cell;
        changed = true;
        const occupiedPallets = incrementOccupancy(cell.occupiedPallets, cell.maxPallets);
        return {
          ...cell,
          occupiedPallets,
          isFull: cell.maxPallets > 0 && occupiedPallets >= cell.maxPallets,
        };
      });
      return changed ? { ...current, cells } : current;
    },
  );
}

export function statusBadgeVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  if (status === "completed") return "default";
  if (status === "exception" || status === "cancelled") return "destructive";
  if (status === "in_progress" || status === "queued") return "secondary";
  return "outline";
}

// Alias kept for compatibility — Dock mode currently reuses the handoff board.
export { DockHandoffBoard as WarehouseDockMode };

function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c] as string));
}
