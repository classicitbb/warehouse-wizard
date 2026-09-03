import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QRCodeSVG } from "qrcode.react";
import { Link, NavLink, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm, type UseFormReturn } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { supabase } from "@/integrations/supabase/client";
import { Activity, AlertCircle, AlertTriangle, ArrowLeftRight, BarChart3, Bot, Boxes, Building2, CheckCircle2, ChevronDown, ClipboardCheck, ClipboardList, CloudOff, Download, Eye, EyeOff, FileDown, Forklift, GripVertical, HelpCircle, Home, Info, KeyRound, LayoutDashboard, Loader2, Lock, LockOpen, LogOut, Mail, Maximize2, MapPinned, Menu, Minimize2, Network, Package, PackageX, PanelLeftClose, PanelLeftOpen, Pencil, Plus, Printer, QrCode, RadioTower, RefreshCw, RotateCcw, Search, Settings, ShieldCheck, Star, Tags, Trash2, Truck, Upload, UserPlus, Users, X } from "lucide-react";
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
import { useInfiniteRows } from "@/hooks/use-infinite-rows";
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
  listRecordsPage,
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
  countRecords,
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
import { fetchAllRows } from "@/features/shared/core-types";
import {
  PRODUCT_QTY_COLUMN,
  PRODUCT_QUICK_LINKS,
  describeFilter,
  filterProductRows,
  isBelowMinimumStock,
  isFilterEmpty,
  nextSortState,
  sortProductRows,
  type ColumnFilter,
  type ColumnFilterMap,
  type SortState,
} from "@/features/resources/product-table-filters";
import { ProductSearch } from "@/components/product-search";
import { PalletLabelPage } from "@/components/pallet-label-page";
import { BarcodeScanButton } from "@/components/barcode-scan-button";
import { RecordCount } from "@/components/record-count";
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
  TableFrame,
  renderField,
  ResourceFormDialog,
  ResourceEditDialog,
  ImportButton,
  BarcodePrintDialog,
  LocationWizardDialog,
  defaultFieldValue,
  composeLocationCode,
  normalizeResourceValues,
  getResourceFieldOptions,
  shouldRestrictToDefaultWarehouse,
  normalizeScannerText,
} from "@/features/shared/ui-shared";

export function ResourcePage({
  resource,
}: {
  resource: ResourceDefinition;
}) {
  const navigate = useNavigate();
  const { toPath } = useTenantPath();
  const { roles: viewerRoles, profile } = useAuth();
  const canHardDelete = viewerRoles.some((r) => ["admin", "developer"].includes(r));
  const cascadeSupported = ["warehouses", "zones", "locations", "products", "clients"].includes(resource.table);
  const [includeHidden, setIncludeHidden] = useState(false);
  const [editRecord, setEditRecord] = useState<Record<string, unknown> | null>(null);
  const [filterQuery, setFilterQuery] = useState("");
  const [columnFilters, setColumnFilters] = useState<ColumnFilterMap>({});
  const [belowMinimumOnly, setBelowMinimumOnly] = useState(false);
  const [sortState, setSortState] = useState<SortState>(null);
  const hasColumnFilters = Object.keys(columnFilters).length > 0 || belowMinimumOnly;

  
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
  const usesIncrementalTable = ["products", "zones", "locations", "warehouses", "clients"].includes(resource.table);
  const activeFilter = filterQuery.trim();
  // A search OR any column filter/quick link reads the whole permitted set, so a
  // match is never hidden past the current page.
  const fullReadActive = Boolean(activeFilter) || hasColumnFilters;
  const paging = useInfiniteRows({ resetKeys: [resource.table, includeHidden, activeFilter, hasColumnFilters] });
  const visibleRecordLimit = paging.limit;
  const { data = [], isLoading, isFetching } = useQuery({
    queryKey: [resource.table, includeHidden, usesIncrementalTable && !fullReadActive ? visibleRecordLimit : "all"],
    queryFn: () => {
      const options = { includeHidden, archiveField: resource.archiveField };
      // An explicit search intentionally reads the full permitted resource set,
      // so a matching product, zone, or location is never hidden past page 50.
      if (usesIncrementalTable && !fullReadActive) {
        return listRecordsPage(resource.table, resource.select ?? "*", resource.orderBy, { ...options, limit: visibleRecordLimit + 1 });
      }
      return listRecords(resource.table, resource.select ?? "*", resource.orderBy, options);
    },
    // Keep the rows already on screen while the next page loads.
    placeholderData: (previous) => previous,
  });
  const hasMoreRecords = paging.sync({
    loadedCount: data.length,
    isFetching,
    enabled: usesIncrementalTable && !fullReadActive,
  });
  const tableData = hasMoreRecords ? data.slice(0, visibleRecordLimit) : data;
  const { data: totalRecordCount } = useQuery({
    queryKey: [resource.table, includeHidden, "count"],
    queryFn: () => countRecords(resource.table, { includeHidden, archiveField: resource.archiveField }),
    enabled: usesIncrementalTable,
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
  const isLocations = resource.table === "locations";
  const { data: reorderAlerts = [] } = useQuery({
    queryKey: ["reorder-alerts"],
    enabled: isProducts,
    queryFn: async () => {
      const { data, error } = await (supabase.from as any)("reorder_alerts")
        .select("id, available_quantity, reorder_point, recommended_quantity, created_at, products(sku, name), warehouses(code, name)")
        .eq("status", "active")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as Array<any>;
    },
    refetchInterval: 30_000,
  });
  // Dismissing this onscreen banner only hides it for the current tab session —
  // the alert stays visible in the header notification bell (ReorderAlertsNotificationBell)
  // until it actually resolves.
  const [dismissedReorderAlertIds, setDismissedReorderAlertIds] = useState<string[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      return JSON.parse(window.sessionStorage.getItem("warehouseWizard.reorderAlerts.dismissedOnscreen") ?? "[]");
    } catch {
      return [];
    }
  });
  const visibleReorderAlerts = useMemo(
    () => reorderAlerts.filter((alert) => !dismissedReorderAlertIds.includes(alert.id)),
    [reorderAlerts, dismissedReorderAlertIds],
  );
  function dismissReorderAlert(id: string) {
    setDismissedReorderAlertIds((prev) => {
      const next = Array.from(new Set([...prev, id]));
      try {
        window.sessionStorage.setItem("warehouseWizard.reorderAlerts.dismissedOnscreen", JSON.stringify(next));
      } catch {
        // ignore storage failures — worst case the banner reappears
      }
      return next;
    });
  }
  function dismissAllReorderAlerts() {
    const next = Array.from(new Set([...dismissedReorderAlertIds, ...reorderAlerts.map((alert) => alert.id)]));
    setDismissedReorderAlertIds(next);
    try {
      window.sessionStorage.setItem("warehouseWizard.reorderAlerts.dismissedOnscreen", JSON.stringify(next));
    } catch {
      // ignore storage failures — worst case the banner reappears
    }
  }
  const { data: productQtyRows = [] } = useQuery({
    queryKey: ["product-qty-totals"],
    enabled: isProducts,
    queryFn: async () => {
      // Aggregated server-side: reading every inventory_balances row here used
      // to blow past the database statement timeout on large warehouses.
      // Paged with .range() because the API caps a single response at 1000 rows,
      // which silently truncated totals once the catalogue passed 1000 products.
      return fetchAllRows<{ product_id: string; total_quantity: number | null }>((from, to) =>
        (supabase as any).rpc("product_quantity_totals").range(from, to),
      );
    },
  });

  const productQtyMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of productQtyRows) {
      if (!r.product_id) continue;
      m.set(r.product_id, Number(r.total_quantity ?? 0));
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
    queryFn: () => listRecords("zones", "id, code, name, warehouse_id"),
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

  const locationWizardDefaultWarehouseId = useMemo(() => {
    if (resource.table !== "locations") return undefined;
    const rowWarehouseId = (data as Array<Record<string, unknown>>).find((row) => row.warehouse_id)?.warehouse_id;
    if (rowWarehouseId) return String(rowWarehouseId);
    const profileWarehouseId = profile?.default_warehouse_id;
    if (profileWarehouseId && warehouseInfoMap.has(profileWarehouseId)) return profileWarehouseId;
    if (warehouseOptions.length === 1) return String((warehouseOptions[0] as { id?: string }).id ?? "") || undefined;
    return undefined;
  }, [data, profile?.default_warehouse_id, resource.table, warehouseInfoMap, warehouseOptions]);

  const locationWizardDefaultZoneId = useMemo(() => {
    if (!locationWizardDefaultWarehouseId) return undefined;
    const rowZoneId = (data as Array<Record<string, unknown>>).find(
      (row) => row.warehouse_id === locationWizardDefaultWarehouseId && row.zone_id,
    )?.zone_id;
    if (rowZoneId) return String(rowZoneId);
    const zone = (zoneOptions as Array<{ id: string; warehouse_id?: string | null }>).find(
      (item) => item.warehouse_id === locationWizardDefaultWarehouseId,
    );
    return zone?.id;
  }, [data, locationWizardDefaultWarehouseId, zoneOptions]);

  const filteredData = useMemo(() => {
    const q = filterQuery.trim().toLowerCase();
    if (!q) return tableData;
    return tableData.filter((row: Record<string, unknown>) =>
      resource.fields.some((field) => {
        const val = (row as Record<string, unknown>)[field.name];
        if (val == null) return false;
        return String(val).toLowerCase().includes(q);
      })
    );
  }, [filterQuery, resource.fields, tableData]);
  const tableFields = useMemo(() => {
    if (resource.table === "products") {
      return resource.fields.filter((field) =>
        !["barcode", "description", "client_owner_id", "product_family"].includes(field.name),
      );
    }
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
    <div className="flex h-full min-h-0 flex-col gap-4">
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
                    defaultWarehouseId={locationWizardDefaultWarehouseId}
                    defaultZoneId={locationWizardDefaultZoneId}
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
              {resource.table === "locations" ? (
                <LocationWizardDialog
                  defaultWarehouseId={locationWizardDefaultWarehouseId}
                  defaultZoneId={locationWizardDefaultZoneId}
                />
              ) : null}
              <ResourceFormDialog resource={resource} />
            </>
          )}
        </div>
      </div>

      {isProducts && visibleReorderAlerts.length > 0 ? (
        <Card className="border-2 border-amber-500 bg-amber-100 shadow-sm dark:border-amber-500 dark:bg-amber-950/50">
          <CardHeader className="flex-row items-start justify-between gap-2 pb-2 space-y-0">
            <div>
              <CardTitle className="flex items-center gap-2 text-base text-amber-900 dark:text-amber-100"><AlertTriangle className="h-5 w-5 shrink-0 text-amber-700 dark:text-amber-400" />Reorder alerts ({visibleReorderAlerts.length})</CardTitle>
              <CardDescription className="text-amber-800/90 dark:text-amber-200/80">Each alert is sent once when a product enters the reorder state and resets after stock recovers. Dismissing hides it here only — it stays in the notification bell.</CardDescription>
            </div>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 shrink-0 px-2 text-xs text-amber-900 hover:bg-amber-500/20 dark:text-amber-100"
              onClick={dismissAllReorderAlerts}
            >
              Dismiss all
            </Button>
          </CardHeader>
          <CardContent className="grid gap-2">
            {visibleReorderAlerts.slice(0, 5).map((alert) => (
              <div key={alert.id} className="flex items-center justify-between gap-2 rounded-md border border-amber-500/40 bg-background px-3 py-2 text-sm">
                <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
                  <span className="font-medium">{alert.products?.sku ?? "Product"} — {alert.products?.name ?? "Unknown product"}</span>
                  <span className="text-muted-foreground">{alert.warehouses?.code ?? alert.warehouses?.name ?? "Warehouse"} · {Number(alert.available_quantity ?? 0)} available · replenish {Number(alert.recommended_quantity ?? 0)}</span>
                </div>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-6 w-6 shrink-0 text-muted-foreground hover:text-foreground"
                  aria-label="Dismiss this reorder alert"
                  title="Dismiss"
                  onClick={() => dismissReorderAlert(alert.id)}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {/* Search bar — client-side filter across all text fields */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground pointer-events-none" />
        <Input
          className="h-9 pl-9 pr-20 bg-muted"
          placeholder={`Search ${resource.title.toLowerCase()}…`}
          value={filterQuery}
          onChange={(e) => setFilterQuery(e.target.value)}
        />
        <RecordCount
          className="absolute right-3 top-1/2 -translate-y-1/2"
          isLoading={isLoading}
          isFiltering={Boolean(filterQuery)}
          visible={filteredData.length}
          total={usesIncrementalTable ? totalRecordCount ?? tableData.length : null}
        />
      </div>

      <Card className="flex min-h-0 flex-1 flex-col">
        <CardContent className="flex min-h-0 flex-1 flex-col p-0">
          <TableFrame className="h-full">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-card">
                <TableRow>
                  {tableFields.map((field) => (
                    <Fragment key={field.name}>
                      {resource.table === "locations" && field.name === "max_pallets" ? (
                        <TableHead className={cn("w-20", isLocations && "h-7 px-2 py-1 text-xs")}>Label</TableHead>
                      ) : null}
                      <TableHead className={cn(isLocations && "h-7 px-2 py-1 text-xs")}>{field.label}</TableHead>
                      {isProducts && field.name === "name" ? (
                        <TableHead className="w-20 text-right">Qty</TableHead>
                      ) : null}
                    </Fragment>
                  ))}
                  {hasTrailingLabelColumn ? <TableHead className="w-28">Label</TableHead> : null}
                  {resource.supportsHide ? <TableHead className={cn("w-32", isLocations && "h-7 px-2 py-1 text-xs")}>Visibility</TableHead> : null}
                  <TableHead className={cn("w-16", isLocations && "h-7 px-2 py-1")} />
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
                  filteredData.map((row: Record<string, unknown>) => (
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
                        const denseCellClass = isProducts
                          ? "px-4 py-1 text-xs leading-tight"
                          : isLocations
                          ? "px-2 py-1 text-xs leading-tight"
                          : undefined;
                        const cell = <TableCell key={field.name} className={denseCellClass}>{displayValue}</TableCell>;
                        if (resource.table === "locations" && field.name === "max_pallets") {
                          return (
                            <Fragment key={field.name}>
                              <TableCell className="w-20 px-2 py-1">
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
                                  trigger={
                                    <Button
                                      size="icon"
                                      variant="outline"
                                      className="h-6 w-6"
                                      aria-label="Print location label"
                                      title="Print location label"
                                    >
                                      <Printer className="h-3.5 w-3.5" />
                                    </Button>
                                  }
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
                        <TableCell className={cn(isProducts && "px-4 py-1", isLocations && "px-2 py-1")}>
                          {(() => {
                            const record = row as Record<string, unknown>;
                            const isArchived = resource.archiveField === "active"
                              ? record.active === false
                              : record.is_hidden === true;
                            const visibleActionLabel = isProducts ? "Archive" : "Hide";
                            return (
                          <Button
                            size="sm"
                            variant="ghost"
                            className={cn(isProducts && "h-6 px-2 text-xs", isLocations && "h-6 px-2 text-xs")}
                            onClick={async (e) => {
                              e.stopPropagation();
                              try {
                                const record = row as Record<string, unknown> & { id?: string };
                                const id = record.id;
                                if (!id || !resource.archiveField) return;
                                assertOnline();
                                const isCurrentlyArchived = resource.archiveField === "active" ? record.active === false : record.is_hidden === true;
                                await setResourceVisibility(resource.table, id, resource.archiveField, !isCurrentlyArchived, !isCurrentlyArchived ? "Hidden from UI" : undefined);
                                toast.success(isCurrentlyArchived ? `${resource.singular} restored` : `${resource.singular} archived`);
                                queryClient.invalidateQueries({ queryKey: [resource.table] });
                              } catch (error) {
                                toast.error(error instanceof Error ? error.message : "Visibility update failed");
                              }
                            }}
                          >
                            {isArchived ? "Restore" : visibleActionLabel}
                          </Button>
                            );
                          })()}
                        </TableCell>
                      ) : null}
                      <TableCell className={cn(isProducts && "px-4 py-1", isLocations && "px-2 py-1")}>
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            className={cn("h-7 w-7 p-0", (isProducts || isLocations) && "h-6 w-6")}
                            onClick={(e) => { e.stopPropagation(); setEditRecord(row as Record<string, unknown>); }}
                            title={`Edit ${resource.singular}`}
                          >
                            <Pencil className={cn("h-3.5 w-3.5", (isProducts || isLocations) && "h-3 w-3")} />
                          </Button>
                          {cascadeSupported && canHardDelete ? (
                            <Button
                              size="sm"
                              variant="ghost"
                              className={cn("h-7 w-7 p-0 text-destructive hover:text-destructive", (isProducts || isLocations) && "h-6 w-6")}
                              onClick={(e) => { e.stopPropagation(); setDeleteBlockers(null); setDeleteChallenge(""); setDeleteRecord(row as Record<string, unknown>); }}
                              title={`Delete ${resource.singular} permanently`}
                            >
                              <Trash2 className={cn("h-3.5 w-3.5", (isProducts || isLocations) && "h-3 w-3")} />
                            </Button>
                          ) : null}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
            <div ref={paging.sentinelRef} aria-hidden className="h-px w-full" />
            {hasMoreRecords ? (
              <div className="pointer-events-none sticky bottom-3 left-0 flex w-full justify-center">
                <Button type="button" variant="secondary" className="pointer-events-auto shadow-md" onClick={paging.loadMore} disabled={isFetching}>
                  {isFetching ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Loading more…
                    </>
                  ) : (
                    "Load 50 more"
                  )}
                </Button>
              </div>
            ) : null}
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

