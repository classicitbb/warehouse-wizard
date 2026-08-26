import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QRCodeSVG } from "qrcode.react";
import { Link, NavLink, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm, type UseFormReturn } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { supabase } from "@/integrations/supabase/client";
import { Activity, AlertCircle, AlertTriangle, ArrowLeftRight, BarChart3, Bot, Boxes, Building2, CheckCircle2, ChevronDown, ClipboardCheck, ClipboardList, CloudOff, Download, Eye, EyeOff, FileDown, Forklift, GripVertical, Home, Info, KeyRound, LayoutDashboard, Loader2, Lock, LockOpen, LogOut, Mail, Maximize2, MapPinned, Menu, Minimize2, Network, Package, PackageX, PanelLeftClose, PanelLeftOpen, Pencil, Plus, Printer, QrCode, RadioTower, RefreshCw, RotateCcw, Search, Settings, ShieldCheck, Star, Tags, Trash2, Truck, Upload, UserPlus, Users } from "lucide-react";
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

import { HintButton } from "@/components/hint-button";
import { useAuth } from "@/hooks/use-auth";
import { useTenantPath } from "@/hooks/use-tenant-path";
import { canAccessCopilot, useFeatureFlags, MODULE_LABELS, STARTER_MODULES, type ModuleKey } from "@/hooks/use-feature-flags";
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
import { PalletLabelPage } from "@/components/pallet-label-page";
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
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";


import {
  WarehouseFloorMode,
  WarehouseDockMode,
  OfficeMonitoringMode,
  DockHandoffBoard,
  SortableSummaryCard,
  HiddenDashboardTilesPanel,
  tileConfigsFromDefinitions,
  loadFallbackTileLayout,
  loadFallbackVisibility,
  saveFallbackJson,
  fallbackLayoutKey,
  fallbackVisibilityKey,
  shouldRestrictToDefaultWarehouse,
  DEFAULT_FLOOR_LAYOUT,
  DEFAULT_DOCK_LAYOUT,
  DEFAULT_OFFICE_LAYOUT,
  DASHBOARD_FLOOR_LAYOUT_KEY,
  DASHBOARD_DOCK_LAYOUT_KEY,
  DASHBOARD_OFFICE_LAYOUT_KEY,
  DEFAULT_DASHBOARD_CARDS,
  DashboardCardConfig,
} from "@/features/shared/ui-shared";

export function DashboardPage() {
  const { profile, roles } = useAuth();
  const { toPath } = useTenantPath();
  const { flags, isEnabled } = useFeatureFlags();
  const [mode, setMode] = useState<DashboardMode>("floor");
  const [editMode, setEditMode] = useState(false);
  const deviceId = useMemo(() => (typeof window === "undefined" ? "server-render-device" : getOrCreateDeviceId()), []);
  const hasCopilotAccess = canAccessCopilot(roles);
  const isDashboardModuleEnabled = useCallback(
    (key: ModuleKey) => isEnabled(key) && (key !== "copilot" || hasCopilotAccess),
    [hasCopilotAccess, isEnabled],
  );
  const floorDefinitions = useMemo(() => filterDashboardTileDefinitions(DEFAULT_FLOOR_LAYOUT, isDashboardModuleEnabled), [isDashboardModuleEnabled]);
  const dockDefinitions = useMemo(() => filterDashboardTileDefinitions(DEFAULT_DOCK_LAYOUT, isDashboardModuleEnabled), [isDashboardModuleEnabled]);
  const officeDefinitions = useMemo(() => filterDashboardTileDefinitions(DEFAULT_OFFICE_LAYOUT, isDashboardModuleEnabled), [isDashboardModuleEnabled]);
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
  const [simulatedFullscreen, setSimulatedFullscreen] = useState(false);
  const [fitToScreen, setFitToScreen] = useState(false);

  useEffect(() => {
    const onChange = () => setIsFullscreen(document.fullscreenElement === dashboardRef.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const toggleFullscreen = useCallback(async () => {
    // Mobile/tablet browsers (notably iOS Safari) lack the Fullscreen API —
    // fall back to a fixed-position immersive view so the button works everywhere.
    const fullscreenSupported =
      typeof document !== "undefined" && document.fullscreenEnabled && dashboardRef.current?.requestFullscreen;
    if (!fullscreenSupported) {
      setSimulatedFullscreen((value) => !value);
      return;
    }
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else if (dashboardRef.current) {
        await dashboardRef.current.requestFullscreen();
      }
    } catch {
      setSimulatedFullscreen((value) => !value);
    }
  }, []);

  const immersiveMode = isFullscreen || simulatedFullscreen;

  const { data: metrics, isLoading } = useQuery({
    queryKey: ["dashboard-metrics", profile?.default_warehouse_id, flags],
    queryFn: () => getDashboardMetrics(profile?.default_warehouse_id, flags),
    refetchInterval: 15_000,
  });
  const { data: reorderAlerts = [] } = useQuery({
    queryKey: ["reorder-alerts", "command-center"],
    queryFn: async () => {
      const { data, error } = await (supabase.from as any)("reorder_alerts")
        .select("id")
        .eq("status", "active");
      if (error) throw error;
      return data ?? [];
    },
    refetchInterval: 30_000,
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
        (immersiveMode || fitToScreen) && "h-screen overflow-auto bg-background p-4",
        simulatedFullscreen && "fixed inset-0 z-50",
      )}
    >
      <div className="flex shrink-0 flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-2xl font-bold tracking-tight">Command Center</h2>
          <HintButton label="Command Center guidance" buttonClassName="text-muted-foreground">
            Live warehouse metrics. Unlock edit mode to reorder, resize, or hide tiles.
          </HintButton>
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
          <div className="hidden items-center gap-2 sm:flex">
            <Button size="sm" variant="outline" onClick={() => setFitToScreen((v) => !v)} aria-pressed={fitToScreen}>
              {fitToScreen ? "Reset fit" : "Fit to screen"}
            </Button>
            <Button size="sm" variant="outline" onClick={toggleFullscreen} aria-label={immersiveMode ? "Exit fullscreen" : "Enter fullscreen"} aria-pressed={immersiveMode}>
              {immersiveMode ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      </div>

      {reorderAlerts.length > 0 ? (
        <Card className="shrink-0 border-2 border-amber-500 bg-amber-100 shadow-sm dark:border-amber-500 dark:bg-amber-950/50">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 py-3">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 shrink-0 text-amber-700 dark:text-amber-400" />
              <span className="font-semibold text-amber-900 dark:text-amber-100">{reorderAlerts.length} active reorder alert{reorderAlerts.length === 1 ? "" : "s"}</span>
              <span className="text-sm text-amber-800/90 dark:text-amber-200/80">Forecasts use completed outbound picks and supplier lead time.</span>
            </div>
            <Button asChild size="sm" variant="default" className="bg-amber-600 text-white hover:bg-amber-700 dark:bg-amber-600 dark:hover:bg-amber-700">
              <Link to={toPath("/products")}>View products</Link>
            </Button>
          </CardContent>
        </Card>
      ) : null}

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
