import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QRCodeSVG } from "qrcode.react";
import { Link, NavLink, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm, type UseFormReturn } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { supabase } from "@/integrations/supabase/client";
import { Activity, AlertCircle, AlertTriangle, ArrowLeftRight, BarChart3, Bot, Boxes, Building2, Camera, CheckCircle2, ChevronDown, ClipboardCheck, ClipboardList, CloudOff, Download, Eye, EyeOff, FileDown, Forklift, GripVertical, Home, Info, KeyRound, LayoutDashboard, Loader2, Lock, LockOpen, LogOut, Mail, Maximize2, MapPinned, Menu, Minimize2, Network, Package, PackageX, PanelLeftClose, PanelLeftOpen, Pencil, Plus, Printer, QrCode, RadioTower, RefreshCw, RotateCcw, Search, Settings, ShieldCheck, Star, Tags, Trash2, Truck, Upload, UserPlus, Users } from "lucide-react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
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
import { z } from "zod";

import { useAuth } from "@/hooks/use-auth";
import { useTenantPath } from "@/hooks/use-tenant-path";
import { useFeatureFlags, MODULE_LABELS, STARTER_MODULES, type ModuleKey } from "@/hooks/use-feature-flags";
import { OFFLINE_WORK_MESSAGE, assertOnline, useNetworkStatus } from "@/hooks/use-network-status";
import { isLikelyNetworkError } from "@/lib/offline-queue";
import { beginActiveWork } from "@/lib/active-work";
import {
  clearPutawayResumeSnapshot,
  loadPutawayResumeSnapshot,
  savePutawayResumeSnapshot,
  type PutawayResumeScanState,
} from "@/lib/floor-task-resume";
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
  revalidatePutawayTaskPosition,
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
import { HintButton } from "@/components/hint-button";
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


import {
  isBaySelectorCode,
  normalizeScannerText,
  playBarcodeBeep,
  flashInput,
  alertToast,
  statusBadgeVariant,
  BinCapacityBar,
} from "@/features/shared/ui-shared";

function WarehouseBayBrowserDialog({
  open,
  warehouseId,
  zoneFilter,
  onSelectBay,
  onScanInstead,
  onClose,
}: {
  open: boolean;
  warehouseId: string;
  zoneFilter?: string;
  onSelectBay: (bayCode: string) => void;
  onScanInstead: () => void;
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

  const normalizedZoneFilter = normalizeScannerText(zoneFilter);

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

  const visibleZoneGroups = useMemo(() => {
    if (!normalizedZoneFilter) return zoneGroups;
    const matches = zoneGroups.filter((zone) => {
      const zoneKey = normalizeScannerText(zone.zoneKey);
      const zoneName = normalizeScannerText(zone.zoneName);
      return zoneKey === normalizedZoneFilter ||
        zoneKey.startsWith(normalizedZoneFilter) ||
        zoneName.includes(normalizedZoneFilter);
    });
    return matches.length > 0 ? matches : zoneGroups;
  }, [normalizedZoneFilter, zoneGroups]);

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-start justify-between gap-3 pr-6">
            <div>
              <DialogTitle>Select a bay</DialogTitle>
              <DialogDescription>Tap a bay to load its locations into the scan field.</DialogDescription>
            </div>
            <Button type="button" variant="outline" size="sm" className="shrink-0" onClick={onScanInstead}>
              <Camera className="mr-2 h-4 w-4" />
              Scan
            </Button>
          </div>
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
          {visibleZoneGroups.map((zone) => {
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
                                  "flex min-h-[4.25rem] min-w-[3.75rem] flex-col gap-1 rounded-md border p-3 text-left text-sm transition focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
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

function BayOccupancyGrid({
  locationCode,
  selectedLocationCode,
  onSelect,
  onContentReady,
}: {
  locationCode: string;
  selectedLocationCode?: string;
  onSelect: (locationCode: string) => void;
  onContentReady?: () => void;
}) {
  const isBayScan = isBaySelectorCode(locationCode);
  const selectedLocation = selectedLocationCode?.trim().toUpperCase() ?? "";
  const onContentReadyRef = useRef(onContentReady);
  onContentReadyRef.current = onContentReady;
  const { data, error, isLoading } = useQuery({
    queryKey: ["bay-occupancy", locationCode],
    queryFn: () => getBayOccupancy(locationCode),
    enabled: locationCode.length >= 2,
    staleTime: 0,
  });

  useEffect(() => {
    if (isLoading || (!data && !error)) return;
    const timer = setTimeout(() => onContentReadyRef.current?.(), 0);
    return () => clearTimeout(timer);
  }, [data, error, isLoading, locationCode]);

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

function incrementOccupancy(occupiedPallets: number, maxPallets: number) {
  return maxPallets > 0 ? Math.min(maxPallets, occupiedPallets + 1) : occupiedPallets + 1;
}

function markPutawayOccupancyCached(queryClient: ReturnType<typeof useQueryClient>, locationCode: string) {
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

const PUTAWAY_SCANNER_FIRST_KEY = "warehouseWizard.putaway.scannerFirst";

function loadPutawayScannerFirstPreference() {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(PUTAWAY_SCANNER_FIRST_KEY) === "true";
}

export function PutawayTasksPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { toPath } = useTenantPath();
  const { user, roles, profile } = useAuth();
  const { online } = useNetworkStatus();
  // Managers and above see all open tasks; operators/clerks only see their own + unassigned
  const canSeeAllTasks = roles.some((r) => ["developer", "admin", "warehouse_manager", "warehouse_supervisor"].includes(r));
  const putawayUserId = canSeeAllTasks ? undefined : user?.id;
  const activeWarehouseId = profile?.default_warehouse_id ?? null;
  const { data = [], isLoading } = useQuery({
    queryKey: ["putaway-tasks", putawayUserId, activeWarehouseId],
    queryFn: () => getPutawayTasks(putawayUserId, activeWarehouseId),
  });
  const { data: putawayHistory = [] } = useQuery({
    queryKey: ["putaway-task-history", putawayUserId],
    queryFn: () => getPutawayTaskHistory(putawayUserId),
  });
  const [scanState, setScanState] = useState<Record<string, PutawayResumeScanState>>({});
  const [bayScanState, setBayScanState] = useState<Record<string, string>>({});
  const [violations, setViolations] = useState<Record<string, string>>({});
  const [bayBrowserOpen, setBayBrowserOpen] = useState<Record<string, boolean>>({});
  const [taskSearch, setTaskSearch] = useState("");
  const [scanDialogOpen, setScanDialogOpen] = useState(false);
  const [scanQuery, setScanQuery] = useState("");
  const [scanError, setScanError] = useState("");
  const [scannerFirstPreferred, setScannerFirstPreferred] = useState(loadPutawayScannerFirstPreference);
  const [scannerPreferencePromptOpen, setScannerPreferencePromptOpen] = useState(false);
  const [scannerPreferenceDismissed, setScannerPreferenceDismissed] = useState(false);
  const [scannerPreferencePending, setScannerPreferencePending] = useState(false);
  const [scannerAutoOpenSignal, setScannerAutoOpenSignal] = useState(0);
  const [locationScannerAutoOpenSignal, setLocationScannerAutoOpenSignal] = useState(0);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [flowCancelled, setFlowCancelled] = useState(false);
  const [openTasksExpanded, setOpenTasksExpanded] = useState(false);
  const [resumeHydrated, setResumeHydrated] = useState(false);
  const [pendingReconnectValidation, setPendingReconnectValidation] = useState(false);
  const [resumeNotice, setResumeNotice] = useState<{ mode: "reselect" | "reset-task"; summary: string } | null>(null);
  const scanInputRef = useRef<HTMLInputElement | null>(null);
  const palletRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const locationRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const locationSelectorRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const confirmRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const actionRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const previousOnlineRef = useRef(online);
  const [completedIds, setCompletedIds] = useState<Set<string>>(new Set());
  const [revertedIds, setRevertedIds] = useState<Set<string>>(new Set());
  const [returnTask, setReturnTask] = useState<any | null>(null);
  const [batchReturnOpen, setBatchReturnOpen] = useState(false);
  const [selectedBatchReturnTaskIds, setSelectedBatchReturnTaskIds] = useState<Set<string>>(new Set());
  const [batchReturnErrors, setBatchReturnErrors] = useState<Record<string, string>>({});
  const correctionTaskId = searchParams.get("correctionTask");

  const clearSelectedTaskState = useCallback((taskId?: string | null) => {
    if (!taskId) return;
    setScanState((current) => {
      if (!(taskId in current)) return current;
      const next = { ...current };
      delete next[taskId];
      return next;
    });
    setViolations((current) => {
      if (!(taskId in current)) return current;
      const next = { ...current };
      delete next[taskId];
      return next;
    });
    setBayScanState((current) => {
      if (!(taskId in current)) return current;
      const next = { ...current };
      delete next[taskId];
      return next;
    });
  }, []);

  const resetPutawaySelection = useCallback((taskId?: string | null) => {
    clearSelectedTaskState(taskId);
    setSelectedTaskId(null);
    setTaskSearch("");
    setScanQuery("");
    setScanError("");
    setFlowCancelled(false);
    setOpenTasksExpanded(false);
  }, [clearSelectedTaskState]);

  useEffect(() => {
    if (resumeHydrated) return;
    const snapshot = loadPutawayResumeSnapshot({
      userId: user?.id ?? null,
      warehouseId: activeWarehouseId,
    });
    if (snapshot) {
      setSelectedTaskId(snapshot.selectedTaskId);
      setTaskSearch(snapshot.taskSearch);
      setScanQuery(snapshot.scanQuery);
      setScanState(snapshot.scanState ?? {});
      setBayScanState(snapshot.bayScanState ?? {});
      setOpenTasksExpanded(snapshot.openTasksExpanded ?? false);
      setFlowCancelled(false);
      if (snapshot.selectedTaskId && online) {
        setPendingReconnectValidation(true);
      }
    }
    setResumeHydrated(true);
  }, [activeWarehouseId, online, resumeHydrated, user?.id]);

  useEffect(() => {
    if (!resumeHydrated) return;
    const hasPosition =
      Boolean(selectedTaskId) ||
      Object.keys(scanState).length > 0 ||
      Object.keys(bayScanState).length > 0 ||
      taskSearch.trim().length > 0 ||
      scanQuery.trim().length > 0;
    if (!hasPosition) {
      clearPutawayResumeSnapshot();
      return;
    }
    savePutawayResumeSnapshot({
      userId: user?.id ?? null,
      warehouseId: activeWarehouseId,
      selectedTaskId,
      taskSearch,
      scanQuery,
      scanState,
      bayScanState,
      openTasksExpanded,
      updatedAt: Date.now(),
    });
  }, [
    activeWarehouseId,
    bayScanState,
    openTasksExpanded,
    resumeHydrated,
    scanQuery,
    scanState,
    selectedTaskId,
    taskSearch,
    user?.id,
  ]);

  useEffect(() => {
    const wasOnline = previousOnlineRef.current;
    previousOnlineRef.current = online;
    if (!resumeHydrated || !selectedTaskId) return;
    if (!wasOnline && online) {
      setPendingReconnectValidation(true);
    }
  }, [online, resumeHydrated, selectedTaskId]);

  const revertMutation = useMutation({
    mutationFn: ({ taskId }: { taskId: string; openReceiving?: boolean }) => revertPutawayToDraft(taskId),
    onSuccess: async (_, vars) => {
      alertToast.success("Task saved as draft");
      setReturnTask(null);
      setRevertedIds((prev) => new Set([...prev, vars.taskId]));
      setResumeNotice(null);
      resetPutawaySelection(vars.taskId);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["putaway-tasks"] }),
        queryClient.invalidateQueries({ queryKey: ["putaway-task-history"] }),
        queryClient.invalidateQueries({ queryKey: ["draft-receipts"] }),
      ]);
      if (vars.openReceiving) navigate(toPath("/receiving"));
    },
    onError: (e) => alertToast.noGo(e instanceof Error ? e.message : "Revert failed"),
  });

  const batchReturnMutation = useMutation({
    mutationFn: async ({ taskIds, openReceiving }: { taskIds: string[]; openReceiving: boolean }) => {
      const results = await Promise.allSettled(
        taskIds.map(async (taskId) => {
          await revertPutawayToDraft(taskId);
          return taskId;
        }),
      );
      return { results, taskIds, openReceiving };
    },
    onSuccess: async ({ results, taskIds, openReceiving }) => {
      const returnedTaskIds = results
        .filter((result): result is PromiseFulfilledResult<string> => result.status === "fulfilled")
        .map((result) => result.value);
      const errors = Object.fromEntries(
        results.flatMap((result, index) => result.status === "rejected"
          ? [[taskIds[index], result.reason instanceof Error ? result.reason.message : "Return failed"]]
          : []),
      );

      setRevertedIds((previous) => new Set([...previous, ...returnedTaskIds]));
      setSelectedBatchReturnTaskIds((previous) => new Set([...previous].filter((taskId) => !returnedTaskIds.includes(taskId))));
      setBatchReturnErrors(errors);
      setResumeNotice(null);
      if (returnedTaskIds.includes(selectedTaskId ?? "")) resetPutawaySelection(selectedTaskId);

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["putaway-tasks"] }),
        queryClient.invalidateQueries({ queryKey: ["putaway-task-history"] }),
        queryClient.invalidateQueries({ queryKey: ["draft-receipts"] }),
      ]);

      const failedCount = results.length - returnedTaskIds.length;
      if (failedCount > 0) {
        alertToast.noGo(`${returnedTaskIds.length} task${returnedTaskIds.length === 1 ? "" : "s"} returned; ${failedCount} failed. Review the selected tasks and try again.`);
        return;
      }

      alertToast.success(`${returnedTaskIds.length} task${returnedTaskIds.length === 1 ? "" : "s"} saved as Receiving drafts`);
      setBatchReturnOpen(false);
      setBatchReturnErrors({});
      if (openReceiving) navigate(toPath("/receiving"));
    },
    onError: (error) => alertToast.noGo(error instanceof Error ? error.message : "Could not return the selected tasks"),
  });

  const mutation = useMutation({
    mutationFn: async ({ taskId, pallet, location, override, reason }: { taskId: string; pallet: string; location: string; override?: boolean; reason?: string }) => {
      assertOnline();
      try {
        await confirmPutaway(taskId, pallet, location, { override, overrideReason: reason });
      } catch (err) {
        if (isLikelyNetworkError(err)) {
          throw new Error(OFFLINE_WORK_MESSAGE);
        }
        throw err;
      }
    },
    onSuccess: async (_, vars) => {
      playBarcodeBeep();
      setResumeNotice(null);
      alertToast.success(vars.override ? "Put-Away locked in with override" : "Put-Away locked in", {
        description: `Pallet ${vars.pallet} stored at ${vars.location}.`,
        duration: 7000,
        className: "task-success-toast-rim border-emerald-400 bg-emerald-50 text-emerald-950 dark:border-emerald-500 dark:bg-emerald-950 dark:text-emerald-50",
      });
      markPutawayOccupancyCached(queryClient, vars.location);
      setCompletedIds((prev) => new Set([...prev, vars.taskId]));
      resetPutawaySelection(vars.taskId);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["putaway-tasks"] }),
        queryClient.invalidateQueries({ queryKey: ["putaway-task-history"] }),
        queryClient.invalidateQueries({ queryKey: ["inventory-search"] }),
        queryClient.invalidateQueries({ queryKey: ["dashboard-metrics"] }),
        queryClient.invalidateQueries({ queryKey: ["bin-occupancy"] }),
        queryClient.invalidateQueries({ queryKey: ["bay-occupancy"] }),
      ]);
    },
    onError: (error, vars) => {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.startsWith("RULE_VIOLATION:")) {
        const reason = msg.replace(/^RULE_VIOLATION:\s*/, "");
        setViolations((current) => ({ ...current, [vars.taskId]: reason }));
        alertToast.attention(`Location rule violation: ${reason}. Tick "Override" to put away anyway.`);
      } else {
        alertToast.noGo(msg || "Put-Away failed");
      }
    },
  });

  const openPutawayStatuses = new Set(["queued", "assigned", "in_progress", "exception"]);
  const pendingTasks = data.filter((task: any) => openPutawayStatuses.has(task.status) && !completedIds.has(task.id) && !revertedIds.has(task.id));
  const selectedTask = selectedTaskId ? pendingTasks.find((task: any) => task.id === selectedTaskId) ?? null : null;

  useEffect(() => {
    if (!correctionTaskId || isLoading) return;
    const task = pendingTasks.find((candidate) => candidate.id === correctionTaskId);
    if (!task) return;
    setSelectedTaskId(task.id);
    setTaskSearch(getConfirmPalletCode(task, ""));
    setScanQuery("");
    setScanState((current) => ({
      ...current,
      [task.id]: { ...(current[task.id] ?? { pallet: "", location: "", override: false, reason: "" }), pallet: "" },
    }));
    setFlowCancelled(false);
    setOpenTasksExpanded(false);
    setSearchParams({}, { replace: true });
    setTimeout(() => palletRefs.current[task.id]?.focus(), 120);
  }, [correctionTaskId, isLoading, pendingTasks, setSearchParams]);
  const selectedBatchReturnTasks = pendingTasks.filter((task: any) => selectedBatchReturnTaskIds.has(task.id));

  useEffect(() => {
    if (!pendingReconnectValidation || !resumeHydrated || !online || !selectedTaskId) return;
    const localState = scanState[selectedTaskId];
    let cancelled = false;

    const validate = async () => {
      try {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ["putaway-tasks"] }),
          queryClient.invalidateQueries({ queryKey: ["putaway-task-history"] }),
          queryClient.invalidateQueries({ queryKey: ["inventory-search"] }),
          queryClient.invalidateQueries({ queryKey: ["dashboard-metrics"] }),
        ]);
        const result = await revalidatePutawayTaskPosition({
          taskId: selectedTaskId,
          scannedPalletBarcode: localState?.pallet,
          scannedLocationCode: localState?.location,
        });
        if (cancelled) return;
        if (result.status === "reset-task") {
          setResumeNotice({ mode: "reset-task", summary: result.summary });
          resetPutawaySelection(selectedTaskId);
          alertToast.attention(result.summary, { duration: 8000 });
          return;
        }
        if (result.status === "reselect") {
          setResumeNotice({ mode: "reselect", summary: result.summary });
          setScanState((current) => ({
            ...current,
            [selectedTaskId]: {
              ...(current[selectedTaskId] ?? { pallet: "", location: "", override: false, reason: "" }),
              location: "",
            },
          }));
          setBayScanState((current) => {
            if (!(selectedTaskId in current)) return current;
            const next = { ...current };
            delete next[selectedTaskId];
            return next;
          });
          alertToast.attention(result.summary, { duration: 8000 });
          setTimeout(() => locationRefs.current[selectedTaskId]?.focus(), 80);
          return;
        }
        setResumeNotice(null);
      } finally {
        if (!cancelled) {
          setPendingReconnectValidation(false);
        }
      }
    };

    void validate();
    return () => {
      cancelled = true;
    };
  }, [
    online,
    pendingReconnectValidation,
    queryClient,
    resetPutawaySelection,
    resumeHydrated,
    scanState,
    selectedTaskId,
  ]);

  // Mark active work while an operator has a pallet+task locked in. Background
  // refresh and SW reloads will defer until this is released so the in-flight
  // confirm screen never blanks out.
  useEffect(() => {
    if (!selectedTaskId) return;
    const release = beginActiveWork();
    return () => release();
  }, [selectedTaskId]);
  const visibleTasks = selectedTask ? [selectedTask] : openTasksExpanded ? pendingTasks : [];
  const activeTasks = visibleTasks.filter((t: any) => openPutawayStatuses.has(t.status));

  function getTaskPalletCodes(task: any) {
    const pallet = task.pallets as any;
    return [pallet?.pallet_barcode, pallet?.pallet_code].map((value) => normalizeScannerText(value)).filter(Boolean);
  }

  function getConfirmPalletCode(task: any, fallback: string) {
    const pallet = task.pallets as any;
    return normalizeScannerText(pallet?.pallet_barcode || pallet?.pallet_code || fallback);
  }

  function closeBayBrowser(taskId: string) {
    setBayBrowserOpen((current) => ({ ...current, [taskId]: false }));
    setTimeout(() => {
      flashInput(locationRefs.current[taskId], "orange");
      locationRefs.current[taskId]?.focus();
    }, 50);
  }

  function scrollLocationSelectorIntoView(taskId: string) {
    setTimeout(() => {
      locationSelectorRefs.current[taskId]?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 100);
  }

  function clearTaskViolation(taskId: string) {
    setViolations((current) => {
      if (!(taskId in current)) return current;
      const next = { ...current };
      delete next[taskId];
      return next;
    });
  }

  function openLocationScannerForTask(taskId: string) {
    setBayBrowserOpen((current) => ({ ...current, [taskId]: false }));
    setLocationScannerAutoOpenSignal((current) => current + 1);
    setTimeout(() => {
      flashInput(locationRefs.current[taskId], "orange");
      locationRefs.current[taskId]?.focus();
    }, 50);
  }

  function commitPalletScan(rawValue: string) {
    const value = normalizeScannerText(rawValue);
    if (!value) {
      setScanError("Scan or enter a pallet number.");
      return;
    }

    const match = pendingTasks.find((task: any) => getTaskPalletCodes(task).includes(value));
    if (!match) {
      setSelectedTaskId(null);
      setTaskSearch(value);
      setScanError(`No open Put-Away task found for pallet ${value}.`);
      return;
    }

    const palletCode = getConfirmPalletCode(match, value);
    setSelectedTaskId(match.id);
    setResumeNotice(null);
    setTaskSearch(value);
    setScanQuery(value);
    setScanError("");
    setFlowCancelled(false);
    setOpenTasksExpanded(false);
    setScanState((current) => ({
      ...current,
      [match.id]: {
        ...(current[match.id] ?? { pallet: "", location: "", override: false, reason: "" }),
        pallet: palletCode,
      },
    }));
    setBayScanState((current) => {
      const next = { ...current };
      delete next[match.id];
      return next;
    });
    playBarcodeBeep();
    setScanDialogOpen(false);
    openLocationScannerForTask(match.id);
  }

  function applyLocationScan(task: any, scannedValue: string) {
    const value = normalizeScannerText(scannedValue);
    if (!value) return;
    const localState = scanState[task.id] ?? { pallet: task.pallets?.pallet_barcode ?? "", location: "", override: false, reason: "" };
    if (isBaySelectorCode(value)) {
      setBayScanState((current) => ({ ...current, [task.id]: value }));
      setScanState((current) => ({ ...current, [task.id]: { ...localState, location: "", override: false, reason: "" } }));
      clearTaskViolation(task.id);
      void logPutawayBaySelection({ taskId: task.id, scannedCode: value });
      playBarcodeBeep();
      flashInput(locationRefs.current[task.id], "orange");
      scrollLocationSelectorIntoView(task.id);
      return;
    }
    setBayScanState((current) => {
      const next = { ...current };
      delete next[task.id];
      return next;
    });
    setScanState((current) => ({ ...current, [task.id]: { ...localState, location: value, override: false, reason: "" } }));
    clearTaskViolation(task.id);
    playBarcodeBeep();
    flashInput(locationRefs.current[task.id], "blue");
    setTimeout(() => confirmRefs.current[task.id]?.focus(), 50);
  }

  useEffect(() => {
    if (isLoading) return;
    const coarsePointer = typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;
    if (pendingTasks.length === 0) {
      setScanDialogOpen(false);
      setSelectedTaskId(null);
      setFlowCancelled(false);
      setResumeNotice(null);
      return;
    }
    if (coarsePointer && !selectedTask && !flowCancelled) {
      setScanDialogOpen(true);
    }
  }, [flowCancelled, isLoading, pendingTasks.length, selectedTask]);

  useEffect(() => {
    if (!resumeHydrated || isLoading || !online || !selectedTaskId) return;
    if (!selectedTask) {
      setPendingReconnectValidation(true);
    }
  }, [isLoading, online, resumeHydrated, selectedTask, selectedTaskId]);

  useEffect(() => {
    if (!scanDialogOpen) return;
    const timer = setTimeout(() => scanInputRef.current?.focus(), 120);
    return () => clearTimeout(timer);
  }, [scanDialogOpen]);

  // Auto-focus first pallet field only when the manual task list is expanded on desktop.
  const isMobile = typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;
  useEffect(() => {
    if (!scanDialogOpen || !isMobile || !scannerFirstPreferred) return;
    const timer = setTimeout(() => setScannerAutoOpenSignal((current) => current + 1), 180);
    return () => clearTimeout(timer);
  }, [isMobile, scanDialogOpen, scannerFirstPreferred]);

  useEffect(() => {
    if (isMobile || isLoading || selectedTask || scanDialogOpen || activeTasks.length === 0) return;
    const firstId = activeTasks[0].id;
    const timer = setTimeout(() => palletRefs.current[firstId]?.focus(), 120);
    return () => clearTimeout(timer);
  }, [isLoading, activeTasks.length, isMobile, scanDialogOpen, selectedTask]); // eslint-disable-line react-hooks/exhaustive-deps

  const handlePutawayScannerOpenChange = useCallback((open: boolean) => {
    if (!isMobile || scannerFirstPreferred || scannerPreferenceDismissed) return;
    if (open) {
      setScannerPreferencePending(true);
      return;
    }
    if (scannerPreferencePending) {
      setScannerPreferencePromptOpen(true);
      setScannerPreferencePending(false);
    }
  }, [isMobile, scannerFirstPreferred, scannerPreferenceDismissed, scannerPreferencePending]);

  const rememberPutawayScannerFirst = useCallback(() => {
    setScannerFirstPreferred(true);
    setScannerPreferencePromptOpen(false);
    setScannerPreferenceDismissed(true);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(PUTAWAY_SCANNER_FIRST_KEY, "true");
    }
    alertToast.success("Put-Away will open the scanner first on this device.");
  }, []);

  const scanPromptWaiting = scanDialogOpen && scanQuery.trim().length === 0;

  return (
    <div className="flex h-full min-h-0 flex-col gap-6 overflow-hidden">
      <Dialog
        open={scanDialogOpen}
        onOpenChange={(open) => {
          setScanDialogOpen(open);
          if (open) {
            setFlowCancelled(false);
            setScanError("");
            setScannerPreferencePromptOpen(false);
            setScannerPreferencePending(false);
            return;
          }
          setScannerPreferencePromptOpen(false);
          setScannerPreferencePending(false);
          if (!selectedTaskId) setFlowCancelled(true);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <div className="flex items-center gap-2">
              <DialogTitle>Scan pallet for Put-Away</DialogTitle>
              <DialogDescription className="sr-only">
                Scan or type the pallet number, then confirm to open its pending Put-Away task.
              </DialogDescription>
              <HintButton label="Pallet scan help" buttonClassName="h-7 w-7" contentClassName="max-w-xs">
                Scan or type the pallet number, then press Enter to open its Put-Away task.
              </HintButton>
            </div>
          </DialogHeader>
          <div className="grid gap-3">
            <div
              className={cn("rounded-lg", scanPromptWaiting && "scan-prompt-halo")}
              data-testid="putaway-scan-prompt"
              data-waiting-for-input={scanPromptWaiting ? "true" : "false"}
            >
            <div className="relative z-[1] flex gap-2">
              <div className="relative min-w-0 flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  ref={scanInputRef}
                  className={cn("min-h-12 pl-9 font-mono text-base", scanPromptWaiting && "scan-prompt-input")}
                  value={scanQuery}
                  onChange={(event) => {
                    setScanQuery(event.target.value.toUpperCase());
                    setScanError("");
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      commitPalletScan(event.currentTarget.value);
                    }
                  }}
                  placeholder="Scan or enter pallet number"
                  aria-label="Pallet number"
                />
              </div>
              <BarcodeScanButton
                title="Scan pallet barcode"
                className={cn("h-12 w-24", scanPromptWaiting && "scan-prompt-camera")}
                autoOpenSignal={scannerAutoOpenSignal}
                onOpenChange={handlePutawayScannerOpenChange}
                onScan={(value) => commitPalletScan(value)}
              />
            </div>
            </div>
            {scannerPreferencePromptOpen ? (
              <div className="rounded-md border border-primary/30 bg-primary/10 p-3 text-sm">
                <p className="font-medium text-foreground">Open scanner first next time?</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  This device can open the camera scanner automatically whenever Put-Away asks for a pallet.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button type="button" size="sm" onClick={rememberPutawayScannerFirst}>
                    Remember
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setScannerPreferencePromptOpen(false);
                      setScannerPreferenceDismissed(true);
                    }}
                  >
                    Not now
                  </Button>
                </div>
              </div>
            ) : null}
            {scanError ? (
              <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
                {scanError}
              </div>
            ) : null}
            {pendingTasks.length > 0 ? (
              <p className="text-sm font-medium text-muted-foreground">
                {pendingTasks.length} open Put-Away task{pendingTasks.length === 1 ? "" : "s"} waiting.
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setScanDialogOpen(false);
                setFlowCancelled(true);
              }}
            >
              Cancel
            </Button>
            <Button type="button" className="min-w-36" onClick={() => commitPalletScan(scanQuery)}>
              Find pallet
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <div className="shrink-0">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 items-center gap-2">
            <h2 className="text-2xl font-semibold">Put-Away Tasks</h2>
            <HintButton label="Put-Away guidance" buttonClassName="text-muted-foreground">
              Scan pallet barcode, then location barcode, and confirm.
            </HintButton>
          </div>
          {pendingTasks.length > 0 ? (
            <div className="flex w-full flex-wrap items-center justify-start gap-2 sm:w-auto sm:justify-end">
              {!selectedTask ? (
                <details
                  className="group w-full max-w-full rounded-lg border border-border bg-background/60 px-3 py-2 sm:w-auto"
                  open={openTasksExpanded}
                  onToggle={(event) => setOpenTasksExpanded(event.currentTarget.open)}
                >
                  <summary className="cursor-pointer list-none text-sm text-muted-foreground hover:text-foreground">
                    <span className="group-open:hidden">Show {pendingTasks.length} open Put-Away task{pendingTasks.length === 1 ? "" : "s"}</span>
                    <span className="hidden group-open:inline">Hide open Put-Away tasks</span>
                  </summary>
                </details>
              ) : null}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setSelectedBatchReturnTaskIds(new Set(pendingTasks.map((task: any) => task.id)));
                  setBatchReturnErrors({});
                  setBatchReturnOpen(true);
                }}
              >
                <RotateCcw data-icon="inline-start" />
                Return tasks to Receiving
              </Button>
              <Badge variant="secondary" className="text-sm">{pendingTasks.length} pending</Badge>
            </div>
          ) : null}
        </div>
      </div>
      {!online ? (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
          <p className="font-medium">This device is offline. Live Put-Away confirmations are frozen.</p>
          <p className="mt-1 text-xs sm:text-sm">Your current task position stays on this device. When the signal returns, the app will refresh live bin state before it lets you confirm.</p>
        </div>
      ) : null}
      {resumeNotice ? (
        <div
          className={cn(
            "rounded-lg border px-4 py-3 text-sm",
            resumeNotice.mode === "reset-task"
              ? "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200"
              : "border-cyan-300 bg-cyan-50 text-cyan-950 dark:border-cyan-700 dark:bg-cyan-950/40 dark:text-cyan-100",
          )}
        >
          <p className="font-medium">{resumeNotice.mode === "reset-task" ? "Task changed while you were offline" : "Target changed while you were offline"}</p>
          <p className="mt-1">{resumeNotice.summary}</p>
        </div>
      ) : null}
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pr-1">
        {isLoading ? (
          <Card><CardContent className="p-6 text-sm text-muted-foreground">Loading putaway tasks…</CardContent></Card>
        ) : visibleTasks.length === 0 ? (
          <Card className="flex flex-1">
            <CardContent className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center text-sm text-muted-foreground">
              <CheckCircle2 className="h-8 w-8 text-green-500" />
              <p className="font-medium">{pendingTasks.length === 0 ? "All putaway tasks complete" : "Scan a pallet to begin Put-Away"}</p>
              {pendingTasks.length > 0 ? (
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-16 min-w-56 rounded-lg px-8 text-lg font-semibold"
                  onClick={() => {
                    setScanDialogOpen(true);
                    setFlowCancelled(false);
                  }}
                >
                  <Search className="mr-2 h-4 w-4" />
                  Scan pallet
                </Button>
              ) : null}
            </CardContent>
          </Card>
        ) : (
          visibleTasks.map((task: any) => {
            const localState = scanState[task.id] ?? { pallet: "", location: "", override: false, reason: "" };
            const bayScan = bayScanState[task.id] ?? "";
            const binOccupancy = localState.location.length >= 2;
            const bayOccupancy = Boolean(bayScan || binOccupancy);
            const violation = violations[task.id];
            const taskPallet = task.pallets as any;
            const palletBarcode = taskPallet?.pallet_barcode ?? taskPallet?.pallet_code ?? "";
            const overrideActive = Boolean(violation && localState.override);
            const hasActivePutawayChanges = Boolean(
              localState.pallet || localState.location || bayScan || localState.override || localState.reason.trim(),
            );

            return (
              <Card key={task.id} className="border-2">
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center justify-between gap-4 text-base">
                    <span className="font-mono">{palletBarcode || "No pallet assigned"}</span>
                    <Badge>{task.status}</Badge>
                  </CardTitle>
                  <CardDescription>
                    <span className="font-medium text-foreground">
                      {(task.pallets as any)?.products?.sku ?? ""} · {(task.pallets as any)?.products?.name ?? ""}
                    </span>
                    {" — "}
                    {(task.pallets as any)?.quantity ?? "?"} units
                    <br />
                    Task: <span className="font-mono">{task.task_number}</span>
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                  <div className="grid items-start gap-3 lg:grid-cols-2">
                    {/* Pallet barcode field */}
                    <div className="grid gap-1.5">
                      <p className="text-xs text-muted-foreground">
                        Confirm pallet <span className="font-mono font-medium text-foreground">{palletBarcode || "assigned to task"}</span>
                      </p>
                      <div className="flex gap-2">
                        <Input
                          ref={(el) => { palletRefs.current[task.id] = el; }}
                          className="min-h-12 min-w-0 flex-1 text-base transition-shadow duration-300"
                          placeholder="Scan pallet barcode"
                          value={localState.pallet}
                          onChange={(event) => {
                            const val = normalizeScannerText(event.target.value);
                            setScanState((current) => ({
                              ...current,
                              [task.id]: { ...localState, pallet: val },
                            }));
                            if (val.endsWith("\n") || val.endsWith("\r")) {
                              const trimmed = normalizeScannerText(val);
                              setScanState((current) => ({
                                ...current,
                                [task.id]: { ...localState, pallet: trimmed },
                              }));
                              playBarcodeBeep();
                              flashInput(palletRefs.current[task.id], "blue");
                              setTimeout(() => {
                                flashInput(locationRefs.current[task.id], "orange");
                                locationRefs.current[task.id]?.focus();
                              }, 50);
                            }
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              playBarcodeBeep();
                              flashInput(palletRefs.current[task.id], "blue");
                              setTimeout(() => {
                                flashInput(locationRefs.current[task.id], "orange");
                                locationRefs.current[task.id]?.focus();
                              }, 50);
                            }
                          }}
                        />
                        <BarcodeScanButton
                          title="Scan pallet barcode"
                          onScan={(v) => {
                            setScanState((cur) => ({ ...cur, [task.id]: { ...localState, pallet: normalizeScannerText(v) } }));
                            playBarcodeBeep();
                            flashInput(palletRefs.current[task.id], "blue");
                            openLocationScannerForTask(task.id);
                          }}
                        />
                      </div>
                    </div>
                    <div className="grid gap-1.5">
                      <p className="text-xs text-muted-foreground">Confirm location</p>
                      <div className="flex gap-2">
                        <Input
                          ref={(el) => { locationRefs.current[task.id] = el; }}
                          className="min-h-12 min-w-0 flex-1 text-base transition-shadow duration-300"
                          placeholder="Scan location barcode"
                          value={localState.location}
                          onChange={(event) => {
                            const val = normalizeScannerText(event.target.value.replace(/[\r\n]/g, ""));
                            if (/^BAY:[^:]+:[^:]+:[^:]+:[^:]+$/i.test(val.trim())) {
                              applyLocationScan(task, val);
                              return;
                            }
                            if (!val.toUpperCase().startsWith("BAY:")) {
                              setBayScanState((current) => {
                                const next = { ...current };
                                delete next[task.id];
                                return next;
                              });
                            }
                            clearTaskViolation(task.id);
                            setScanState((current) => ({
                              ...current,
                              [task.id]: { ...localState, location: val, override: false, reason: "" },
                            }));
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              applyLocationScan(task, e.currentTarget.value);
                            }
                          }}
                        />
                        <BarcodeScanButton
                          title="Scan location barcode"
                          autoOpenSignal={selectedTaskId === task.id ? locationScannerAutoOpenSignal : 0}
                          onScan={(v) => applyLocationScan(task, normalizeScannerText(v))}
                          footerAction={{
                            label: "Select Location Manually",
                            icon: <MapPinned className="mr-2 h-4 w-4" />,
                            onClick: () => setBayBrowserOpen((s) => ({ ...s, [task.id]: true })),
                          }}
                        />
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="shrink-0 self-stretch"
                          onClick={() => setBayBrowserOpen((s) => ({ ...s, [task.id]: true }))}
                        >
                          Browse bays
                        </Button>
                      </div>
                    </div>
                  </div>
                  <WarehouseBayBrowserDialog
                    open={Boolean(bayBrowserOpen[task.id])}
                    warehouseId={task.warehouse_id as string}
                    zoneFilter={localState.location}
                    onClose={() => closeBayBrowser(task.id)}
                    onScanInstead={() => openLocationScannerForTask(task.id)}
                    onSelectBay={(bayCode) => {
                      setBayScanState((s) => ({ ...s, [task.id]: bayCode }));
                      setScanState((s) => ({ ...s, [task.id]: { ...(s[task.id] ?? { pallet: "", location: "", override: false, reason: "" }), location: "", override: false, reason: "" } }));
                      clearTaskViolation(task.id);
                      void logPutawayBaySelection({ taskId: task.id, scannedCode: bayCode });
                      setBayBrowserOpen((s) => ({ ...s, [task.id]: false }));
                      flashInput(locationRefs.current[task.id], "orange");
                      scrollLocationSelectorIntoView(task.id);
                    }}
                  />
                  {bayOccupancy && (
                    <div
                      ref={(el) => { locationSelectorRefs.current[task.id] = el; }}
                      className="grid gap-3"
                      data-testid={`putaway-location-selector-${task.id}`}
                    >
                      {binOccupancy && <BinCapacityBar locationCode={localState.location} taskId={task.id} />}
                      {bayScan && (
                        <div className="rounded-md border border-border bg-secondary/20 px-3 py-2 text-xs text-muted-foreground">
                          Bay scan <span className="font-mono font-semibold text-foreground">{bayScan}</span> loaded. Select a bin below.
                        </div>
                      )}
                      <BayOccupancyGrid
                        locationCode={bayScan || localState.location}
                        selectedLocationCode={localState.location}
                        onContentReady={() => scrollLocationSelectorIntoView(task.id)}
                        onSelect={(location) => {
                          setScanState((current) => ({ ...current, [task.id]: { ...localState, location, override: false, reason: "" } }));
                          clearTaskViolation(task.id);
                          setBayScanState((current) => {
                            const next = { ...current };
                            delete next[task.id];
                            return next;
                          });
                          if (bayScan) void logPutawayBaySelection({ taskId: task.id, scannedCode: bayScan, selectedLocationCode: location });
                          flashInput(locationRefs.current[task.id], "blue");
                          setTimeout(() => {
                            actionRefs.current[task.id]?.scrollIntoView({ behavior: "smooth", block: "center" });
                            confirmRefs.current[task.id]?.focus();
                          }, 50);
                        }}
                      />
                    </div>
                  )}
                  {violation && (
                    <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-900 dark:border-red-700 dark:bg-red-950/40 dark:text-red-200">
                      Rule violation: {violation}
                    </div>
                  )}
                  {violation && (
                    <label className="flex items-center gap-2 text-xs text-muted-foreground">
                      <input
                        type="checkbox"
                        className="h-4 w-4"
                        checked={localState.override}
                        onChange={(e) =>
                          setScanState((current) => ({
                            ...current,
                            [task.id]: { ...localState, override: e.target.checked },
                          }))
                        }
                      />
                      Override location rules (warn only — logs reason)
                    </label>
                  )}
                  {overrideActive && (
                    <Input
                      className="min-h-10 text-sm"
                      placeholder="Reason for override (e.g. lane blocked, urgent ship)"
                      value={localState.reason}
                      onChange={(e) =>
                        setScanState((current) => ({
                          ...current,
                          [task.id]: { ...localState, reason: e.target.value },
                        }))
                      }
                    />
                  )}
                  <div
                    ref={(el) => { actionRefs.current[task.id] = el; }}
                    className="grid gap-3"
                  >
                    <div className="flex items-stretch gap-3">
                      <Button
                        ref={(el) => { confirmRefs.current[task.id] = el; }}
                        className="min-h-12 min-w-0 flex-1 text-base"
                        disabled={mutation.isPending || !localState.pallet || !localState.location}
                        onClick={() =>
                          mutation.mutate({
                            taskId: task.id,
                            pallet: localState.pallet,
                            location: localState.location,
                            override: overrideActive,
                            reason: overrideActive ? localState.reason : "",
                          })
                        }
                      >
                        {mutation.isPending ? <Loader2 className="animate-spin" /> : <CheckCircle2 data-icon="inline-start" />}
                        {overrideActive ? "Override & Confirm Put-Away" : "Confirm Put-Away"}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        className="min-h-12 shrink-0 border-amber-400 bg-amber-400 px-5 text-base text-amber-950 hover:bg-amber-500 hover:text-amber-950 dark:border-amber-500 dark:bg-amber-500 dark:text-amber-950 dark:hover:bg-amber-400"
                        disabled={!hasActivePutawayChanges}
                        onClick={() => {
                          resetPutawaySelection(task.id);
                          setFlowCancelled(true);
                        }}
                      >
                        Cancel
                      </Button>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="w-full text-muted-foreground"
                      disabled={revertMutation.isPending}
                      onClick={() => setReturnTask(task)}
                    >
                      {revertMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <RotateCcw className="h-3.5 w-3.5 mr-1" />}
                      Save as Draft / Return to Receiving
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })
        )}
        {putawayHistory.length > 0 ? (
          <details className="group rounded-lg border border-border bg-background/60 px-3 py-2">
            <summary className="cursor-pointer list-none text-sm text-muted-foreground hover:text-foreground">
              <span className="group-open:hidden">Show {putawayHistory.length} completed / returned</span>
              <span className="hidden group-open:inline">Hide completed / returned</span>
            </summary>
            <div className="mt-3 grid gap-2">
              {putawayHistory.map((task: any) => {
                const pallet = task.pallets as any;
                const product = pallet?.products as any;
                const palletCode = pallet?.pallet_barcode ?? pallet?.pallet_code ?? "No pallet";
                return (
                  <details key={task.id} className="rounded-md border border-border px-3 py-2 text-sm opacity-85">
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
                      <div className="min-w-0">
                        <span className="block truncate font-mono text-xs">{task.task_number}</span>
                        <span className="text-xs text-muted-foreground">
                          {palletCode}
                        </span>
                      </div>
                      <Badge variant={statusBadgeVariant(task.status)} className="shrink-0 text-xs">{task.status}</Badge>
                    </summary>
                    <div className="mt-3 grid gap-2 rounded-md bg-muted/40 px-3 py-2 text-xs sm:grid-cols-2">
                      <div>
                        <p className="font-medium">{product?.name ?? "Product"}</p>
                        <p className="font-mono text-muted-foreground">{product?.sku ?? "No SKU"}</p>
                      </div>
                      <div className="sm:text-right">
                        <p className="font-mono">Pallet {palletCode}</p>
                      </div>
                    </div>
                  </details>
                );
              })}
            </div>
          </details>
        ) : null}
      </div>
      <AlertDialog open={Boolean(returnTask)} onOpenChange={(open) => { if (!open) setReturnTask(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Return this task to Receiving?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes {returnTask?.task_number ?? "this task"} from Put-Away Tasks and creates a Saved Draft in Receiving. To find it later, open Receiving and use the Draft Pallets list.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep task here</AlertDialogCancel>
            <AlertDialogAction
              className="bg-secondary text-secondary-foreground hover:bg-secondary/80"
              disabled={revertMutation.isPending || !returnTask}
              onClick={() => returnTask && revertMutation.mutate({ taskId: returnTask.id })}
            >
              Save draft
            </AlertDialogAction>
            <AlertDialogAction
              disabled={revertMutation.isPending || !returnTask}
              onClick={() => returnTask && revertMutation.mutate({ taskId: returnTask.id, openReceiving: true })}
            >
              Save draft & open Receiving
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <Dialog open={batchReturnOpen} onOpenChange={(open) => {
        setBatchReturnOpen(open);
        if (!open) setBatchReturnErrors({});
      }}>
        <DialogContent className="max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Return Put-Away Tasks to Receiving</DialogTitle>
            <DialogDescription>Select open tasks to save as Receiving drafts after a print or label error.</DialogDescription>
          </DialogHeader>
          <div className="flex min-h-0 flex-col gap-3">
            {Object.keys(batchReturnErrors).length > 0 ? (
              <p className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive" role="status">
                Some tasks could not be returned. They remain selected so you can try again.
              </p>
            ) : null}
            <div className="min-h-0 flex-1 overflow-y-auto pr-3">
              <div className="grid gap-2">
                {pendingTasks.map((task: any) => {
                  const pallet = task.pallets;
                  const product = pallet?.products;
                  const palletCode = pallet?.pallet_barcode ?? pallet?.pallet_code ?? "No pallet assigned";
                  const checked = selectedBatchReturnTaskIds.has(task.id);
                  const error = batchReturnErrors[task.id];
                  return (
                    <label key={task.id} className={cn("flex cursor-pointer items-center gap-3 rounded-md border border-border bg-muted/50 px-3 py-2 shadow-sm transition-colors hover:bg-muted/70 focus-within:ring-1 focus-within:ring-ring", error && "border-destructive/60")}>
                      <Checkbox
                        checked={checked}
                        onCheckedChange={(value) => {
                          setSelectedBatchReturnTaskIds((current) => {
                            const next = new Set(current);
                            if (value) next.add(task.id); else next.delete(task.id);
                            return next;
                          });
                          setBatchReturnErrors((current) => {
                            if (!(task.id in current)) return current;
                            const next = { ...current };
                            delete next[task.id];
                            return next;
                          });
                        }}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-foreground">{palletCode} · {product?.sku ?? "Unknown SKU"}</span>
                        <span className="block text-xs text-foreground/70">Task {task.task_number} · {product?.name ?? "Product"} · Qty {pallet?.quantity ?? "?"}</span>
                        {error ? <span className="block text-xs text-destructive">{error}</span> : null}
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
          </div>
          <DialogFooter className="gap-2 sm:flex-col sm:items-stretch sm:space-x-0">
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" disabled={batchReturnMutation.isPending} onClick={() => setSelectedBatchReturnTaskIds(new Set(pendingTasks.map((task: any) => task.id)))}>Select all shown</Button>
              <Button variant="outline" disabled={batchReturnMutation.isPending || selectedBatchReturnTaskIds.size === 0} onClick={() => setSelectedBatchReturnTaskIds(new Set())}>Deselect all</Button>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
              <Button
                variant="outline"
                disabled={!online || batchReturnMutation.isPending || selectedBatchReturnTasks.length === 0}
                onClick={() => batchReturnMutation.mutate({ taskIds: selectedBatchReturnTasks.map((task: any) => task.id), openReceiving: false })}
              >
                {batchReturnMutation.isPending ? <Loader2 className="animate-spin" data-icon="inline-start" /> : <RotateCcw data-icon="inline-start" />}
                Return selected as drafts
              </Button>
              <Button
                disabled={!online || batchReturnMutation.isPending || selectedBatchReturnTasks.length === 0}
                onClick={() => batchReturnMutation.mutate({ taskIds: selectedBatchReturnTasks.map((task: any) => task.id), openReceiving: true })}
              >
                {batchReturnMutation.isPending ? <Loader2 className="animate-spin" data-icon="inline-start" /> : <RotateCcw data-icon="inline-start" />}
                Return selected & open Receiving
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
