import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { useInfiniteRows } from "@/hooks/use-infinite-rows";
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
  inventoryLifecycleLabel,
  formatNumber,
  getDashboardMetrics,
  getInventoryDetail,
  getPickExecution,
  describeInventoryStructureScope,
  HISTORIC_INVENTORY_STATUSES,
  loadInventorySearchState,
  saveInventorySearchState,
  clearInventorySearchState,
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";


import {
  TableFrame,
  normalizeScannerText,
  shouldRestrictToDefaultWarehouse,
} from "@/features/shared/ui-shared";

export function InventorySearchPage() {
  const navigate = useNavigate();
  const { toPath } = useTenantPath();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const { roles, profile } = useAuth();
  // Falls back to the last search saved in this browser tab (see
  // saveInventorySearchState below) so switching to another screen and back
  // doesn't lose it — only an explicit "Clear" resets it. A URL query string
  // (e.g. a deep link with ?q=...) still wins over the remembered search.
  // Structure scope (Settings → Warehouse Structure → "View Contents"). A scoped
  // deep link starts clean: the remembered search would otherwise silently
  // narrow the location's contents to whatever was typed last.
  const [structureZoneCode, setStructureZoneCode] = useState(searchParams.get("zone") ?? "");
  const [structureLocation, setStructureLocation] = useState(searchParams.get("loc") ?? "");
  const [structureNode, setStructureNode] = useState(searchParams.get("node") ?? "");
  const arrivedWithStructureScope = Boolean(structureZoneCode || structureLocation);
  const persistedInventorySearch = arrivedWithStructureScope
    ? { search: "", status: "all", warehouseId: "", ageBucket: "", expiryWindow: "", includeHistoric: false }
    : loadInventorySearchState();
  const [searchTerm, setSearchTerm] = useState(searchParams.get("q") ?? persistedInventorySearch.search);
  const [status, setStatus] = useState<string>(searchParams.get("status") ?? persistedInventorySearch.status);
  const [ageBucket, setAgeBucket] = useState(searchParams.get("age") ?? persistedInventorySearch.ageBucket);
  const [expiryWindow, setExpiryWindow] = useState(searchParams.get("expiry") ?? persistedInventorySearch.expiryWindow);
  // Browsing shows live stock only; this opens the list up to shipped, missing,
  // corrected and drawn-down pallets. Typing/scanning a term always searches
  // history regardless — see searchInventory.
  const [includeHistoric, setIncludeHistoric] = useState(
    searchParams.get("historic") === "1" || (!searchParams.has("historic") && persistedInventorySearch.includeHistoric),
  );
  const structureScopeLabel = describeInventoryStructureScope({
    zoneCode: structureZoneCode,
    locationPrefix: structureLocation,
    node: structureNode,
  });
  const lastDetailTapRef = useRef<{ id: string; time: number } | null>(null);
  const restrictedToDefaultWarehouse = shouldRestrictToDefaultWarehouse(roles);
  const { data: options } = useQuery({
    queryKey: ["options", "inventory", restrictedToDefaultWarehouse, profile?.default_warehouse_id],
    queryFn: () => fetchOptions(false, { restrictToWarehouse: restrictedToDefaultWarehouse, warehouseId: profile?.default_warehouse_id }),
  });
  const [warehouseId, setWarehouseId] = useState(
    searchParams.get("warehouse") ?? (restrictedToDefaultWarehouse ? profile?.default_warehouse_id ?? "" : persistedInventorySearch.warehouseId),
  );
  const hasInventoryFilters = Boolean(
    searchTerm || warehouseId || status !== "all" || ageBucket || expiryWindow || structureScopeLabel || includeHistoric,
  );

  useEffect(() => {
    saveInventorySearchState({ search: searchTerm, status, warehouseId, ageBucket, expiryWindow, includeHistoric });
  }, [ageBucket, expiryWindow, includeHistoric, searchTerm, status, warehouseId]);

  // Shared auto-load-on-scroll paging (50 rows per page).
  const paging = useInfiniteRows({
    resetKeys: [searchTerm, status, warehouseId, ageBucket, expiryWindow, includeHistoric, structureZoneCode, structureLocation],
  });
  const visibleRecordLimit = paging.limit;

  const { data = [], isLoading, isFetching } = useQuery({
    queryKey: [
      "inventory-search", searchTerm, status, warehouseId, ageBucket, expiryWindow, includeHistoric,
      structureZoneCode, structureLocation,
      searchTerm.trim() || structureScopeLabel ? "all" : visibleRecordLimit,
    ],
    queryFn: () => searchInventory({
      search: searchTerm,
      status,
      warehouseId: warehouseId || undefined,
      ageBucket: ageBucket as any,
      expiryWindow: expiryWindow as any,
      zoneCode: structureZoneCode || undefined,
      locationPrefix: structureLocation || undefined,
      includeHistoric,
      limit: searchTerm.trim() ? undefined : visibleRecordLimit + 1,
    }),
    // Keep the rows already on screen visible while the next page loads so
    // scrolling never jumps back to an empty table.
    placeholderData: (previous) => previous,
  });

  const hasMoreRecords = paging.sync({
    loadedCount: data.length,
    isFetching,
    enabled: !searchTerm.trim(),
  });
  const tableData = hasMoreRecords ? data.slice(0, visibleRecordLimit) : data;
  const loadMoreSentinelRef = paging.sentinelRef;



  useEffect(() => {
    const next = new URLSearchParams();
    if (searchTerm) next.set("q", searchTerm);
    if (status !== "all") next.set("status", status);
    if (warehouseId) next.set("warehouse", warehouseId);
    if (ageBucket) next.set("age", ageBucket);
    if (expiryWindow) next.set("expiry", expiryWindow);
    if (includeHistoric) next.set("historic", "1");
    if (structureZoneCode) next.set("zone", structureZoneCode);
    if (structureLocation) next.set("loc", structureLocation);
    if (structureNode && (structureZoneCode || structureLocation)) next.set("node", structureNode);
    setSearchParams(next, { replace: true });
  }, [ageBucket, expiryWindow, includeHistoric, searchTerm, setSearchParams, status, structureLocation, structureNode, structureZoneCode, warehouseId]);

  function clearInventoryFilters() {
    setSearchTerm("");
    setStatus("all");
    setWarehouseId("");
    setAgeBucket("");
    setExpiryWindow("");
    setIncludeHistoric(false);
    clearStructureScope();
    clearInventorySearchState();
  }

  // Historic statuses have no live rows to show, so turning history back off
  // would otherwise leave the operator staring at an empty table.
  function setHistoricEnabled(enabled: boolean) {
    setIncludeHistoric(enabled);
    if (!enabled && HISTORIC_INVENTORY_STATUSES.includes(status as any)) setStatus("all");
  }

  function clearStructureScope() {
    setStructureZoneCode("");
    setStructureLocation("");
    setStructureNode("");
  }

  function openInventoryDetail(balanceId: string) {
    navigate(toPath(`/inventory/${balanceId}`));
  }

  function prefetchInventoryDetail(balanceId: string) {
    void queryClient.prefetchQuery({
      queryKey: ["inventory-detail", balanceId],
      queryFn: () => getInventoryDetail(balanceId),
    });
  }

  function handleInventoryRowPointerUp(balanceId: string) {
    if (typeof window === "undefined" || !window.matchMedia("(pointer: coarse)").matches) return;
    const now = Date.now();
    if (lastDetailTapRef.current?.id === balanceId && now - lastDetailTapRef.current.time < 450) {
      openInventoryDetail(balanceId);
      lastDetailTapRef.current = null;
      return;
    }
    lastDetailTapRef.current = { id: balanceId, time: now };
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-6 overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex items-center gap-2">
          <h2 className="text-2xl font-semibold">Inventory Search</h2>
          <HintButton label="Inventory Search hints">
            Search by SKU, pallet, container, PO, lot, batch, expiry, owner, or location.
          </HintButton>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">History</span>
          <Switch id="inventory-include-historic" checked={includeHistoric} onCheckedChange={setHistoricEnabled} />
          <label htmlFor="inventory-include-historic" className="cursor-pointer text-xs text-muted-foreground">
            Show past &amp; missing pallets
          </label>
          <HintButton label="History hints">
            Shows shipped, in-transit, missing, emptied and corrected pallets alongside live stock. Searching by
            pallet number always finds those, even with this off — the toggle only affects browsing the list.
          </HintButton>
        </div>
      </div>
      <Card>
        <CardContent className="flex flex-col gap-2 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex min-w-0 flex-1 items-center gap-2 sm:min-w-[17rem]">
              <div className="relative min-w-0 flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input type="search" className="h-11 min-w-0 pl-10 pr-20" value={searchTerm} onChange={(event) => setSearchTerm(event.target.value.toUpperCase())} placeholder="Search SKU, pallet, container, PO, or location" />
                <Button
                  type="button"
                  className="absolute right-2 top-1/2 h-8 -translate-y-1/2 px-2 text-xs"
                  variant="ghost"
                  onClick={clearInventoryFilters}
                  disabled={!hasInventoryFilters}
                >
                  Clear
                </Button>
              </div>
              <BarcodeScanButton
                className="h-11 w-20 sm:w-24"
                title="Scan SKU, pallet, container, PO, or location barcode"
                onScan={(value) => setSearchTerm(normalizeScannerText(value))}
              />
            </div>
          </div>
          {structureScopeLabel ? (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Showing contents of</span>
              <Badge variant="secondary" className="gap-1 pr-1 font-mono text-xs">
                {structureScopeLabel}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-4 w-4"
                  aria-label="Clear structure filter"
                  onClick={clearStructureScope}
                >
                  <X className="h-3 w-3" />
                </Button>
              </Badge>
            </div>
          ) : null}
          {(options?.warehouses?.length ?? 0) > 1 && !restrictedToDefaultWarehouse ? (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Warehouse</span>
              <Button
                type="button"
                size="sm"
                className="h-7 px-2 text-xs"
                variant={warehouseId === "" ? "default" : "outline"}
                onClick={() => setWarehouseId("")}
              >
                All
              </Button>
              {(options?.warehouses ?? []).map((warehouse) => (
                <Button
                  key={warehouse.id}
                  type="button"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  variant={warehouseId === warehouse.id ? "default" : "outline"}
                  onClick={() => setWarehouseId(warehouse.id)}
                >
                  {warehouse.name}
                </Button>
              ))}
            </div>
          ) : null}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Status</span>
            <Button
              type="button"
              size="sm"
              className="h-7 px-2 text-xs"
              variant={status === "all" ? "default" : "outline"}
              onClick={() => setStatus("all")}
            >
              All
            </Button>
            {["available", "putaway", "receiving", "reserved", "hold", "quarantine", "damaged"].map((item) => (
              <Button
                key={item}
                type="button"
                size="sm"
                className="h-7 px-2 text-xs"
                variant={status === item ? "default" : "outline"}
                onClick={() => setStatus(item)}
              >
                {item}
              </Button>
            ))}
            {includeHistoric
              ? HISTORIC_INVENTORY_STATUSES.map((item) => (
                  <Button
                    key={item}
                    type="button"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    variant={status === item ? "default" : "outline"}
                    onClick={() => setStatus(item)}
                  >
                    {item.replace("_", " ")}
                  </Button>
                ))
              : null}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Age</span>
            <Button type="button" size="sm" className="h-7 px-2 text-xs" variant={ageBucket === "" ? "default" : "outline"} onClick={() => setAgeBucket("")}>
              All
            </Button>
            {[
              ["3m", "3+ months"],
              ["6m", "6+ months"],
              ["12m", "12+ months"],
            ].map(([value, label]) => (
              <Button key={value} type="button" size="sm" className="h-7 px-2 text-xs" variant={ageBucket === value ? "default" : "outline"} onClick={() => setAgeBucket(value)}>
                {label}
              </Button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Expiry</span>
            <Button type="button" size="sm" className="h-7 px-2 text-xs" variant={expiryWindow === "" ? "default" : "outline"} onClick={() => setExpiryWindow("")}>
              All
            </Button>
            {[
              ["60d", "Next 60 days"],
              ["30d", "Next 30 days"],
            ].map(([value, label]) => (
              <Button key={value} type="button" size="sm" className="h-7 px-2 text-xs" variant={expiryWindow === value ? "default" : "outline"} onClick={() => setExpiryWindow(value)}>
                {label}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>
      <Card className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <CardContent className="flex min-h-0 min-w-0 flex-1 p-0">
          <TableFrame className="h-full min-w-0 flex-1">
            <Table className="min-w-[80rem] [&_th]:whitespace-nowrap [&_td]:whitespace-nowrap">
              <TableHeader className="sticky top-0 z-20 bg-card shadow-sm">
                <TableRow>
                  <TableHead>SKU</TableHead>
                  <TableHead>Product</TableHead>
                  <TableHead>Pallet</TableHead>
                  <TableHead>Container</TableHead>
                  <TableHead>PO</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead>Warehouse</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Available</TableHead>
                  <TableHead>Expiry</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell className="h-24 text-center text-muted-foreground" colSpan={10}>Searching…</TableCell>
                  </TableRow>
                ) : tableData.length === 0 ? (
                  <TableRow>
                    <TableCell className="h-24 text-center text-muted-foreground" colSpan={10}>
                      {searchTerm.trim()
                        ? `No match for “${searchTerm.trim()}”, including past and missing pallets.`
                        : "No inventory matched."}
                    </TableCell>
                  </TableRow>
                ) : (
                  tableData.map((row) => {
                    const detailId = row.inventory_balance_id as string | null;
                    const historic = Boolean(row.is_historic);
                    return (
                    <TableRow
                      key={detailId ?? `pallet:${row.pallet_id}`}
                      className={cn(
                        "even:bg-muted/30 hover:bg-muted/50",
                        detailId ? "cursor-pointer" : "cursor-default",
                        historic && "text-muted-foreground",
                      )}
                      onMouseEnter={() => detailId && prefetchInventoryDetail(detailId)}
                      onFocus={() => detailId && prefetchInventoryDetail(detailId)}
                      onDoubleClick={() => detailId && openInventoryDetail(detailId)}
                      onPointerUp={() => detailId && handleInventoryRowPointerUp(detailId)}
                      title={detailId ? "Double-click or double-tap to open details" : "This pallet has no inventory record left — history only"}
                    >
                      <TableCell>{row.sku ?? "—"}</TableCell>
                      <TableCell>{row.product_name ?? "—"}</TableCell>
                      <TableCell>
                        <span className="flex items-center gap-1.5">
                          {row.pallet_code}
                          {historic ? (
                            <Badge variant="outline" className="border-dashed px-1 py-0 text-[10px] uppercase">
                              {row.is_orphan_pallet ? "no record" : "past"}
                            </Badge>
                          ) : null}
                        </span>
                      </TableCell>
                      <TableCell>{row.container_number ?? "—"}</TableCell>
                      <TableCell>{row.po_number ?? "—"}</TableCell>
                      <TableCell>{row.location_code ?? (historic ? "—" : "Receiving")}</TableCell>
                      <TableCell>{row.warehouse_code ?? "—"}</TableCell>
                      <TableCell>
                        <Badge variant={row.status === "missing" ? "destructive" : row.status === "available" && !historic ? "default" : "secondary"}>
                          {inventoryLifecycleLabel(row)}
                        </Badge>
                      </TableCell>
                      <TableCell>{formatNumber(row.available_quantity)}</TableCell>
                      <TableCell>{formatDate(row.expiry_date)}</TableCell>
                    </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
            <div ref={loadMoreSentinelRef} aria-hidden className="h-px w-full" />
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
    </div>
  );
}

function statusBadgeVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  if (status === "completed") return "default";
  if (status === "exception" || status === "cancelled") return "destructive";
  if (status === "in_progress" || status === "queued") return "secondary";
  return "outline";
}

