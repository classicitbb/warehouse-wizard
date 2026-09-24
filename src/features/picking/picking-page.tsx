import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QRCodeSVG } from "qrcode.react";
import { Link, NavLink, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm, type UseFormReturn } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { supabase } from "@/integrations/supabase/client";
import { Activity, AlertCircle, AlertTriangle, ArrowLeftRight, BarChart3, Bot, Boxes, Building2, CheckCircle2, ChevronDown, ClipboardCheck, ClipboardList, CloudOff, Download, Eye, EyeOff, FileDown, Forklift, GripVertical, HelpCircle, Home, Info, KeyRound, LayoutDashboard, Loader2, Lock, LockOpen, LogOut, Mail, Maximize2, MapPinned, Menu, Minimize2, Network, Package, PackageX, PanelLeftClose, PanelLeftOpen, Pencil, Plus, Printer, QrCode, RadioTower, RefreshCw, RotateCcw, Search, Settings, ShieldCheck, Star, Tags, Trash2, Truck, Upload, UserPlus, Users } from "lucide-react";
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
  displayRackLocationCode,
  suggestNextRackPosition,
  validateMoveDestination,
  type MoveValidationResult,
} from "@/lib/wms-core";
import {
  casesForQuantity,
  formatPackStandardLine,
  resolveDefaultProfileForProduct,
  summarizePackStandard,
} from "@/lib/pack-standard-payload";
import { ProductSearch } from "@/components/product-search";
import { PalletLabelPage } from "@/components/pallet-label-page";
import { BarcodeScanButton } from "@/components/barcode-scan-button";
import { RecordCount } from "@/components/record-count";
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
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";


import {
  SelectField,
  TextField,
  normalizeScannerText,
  playBarcodeBeep,
  statusBadgeVariant,
  alertToast,
} from "@/features/shared/ui-shared";
import { dispatchNotificationForEntity } from "@/hooks/use-web-push";

export function PickListsPage() {
  const navigate = useNavigate();
  const { toPath } = useTenantPath();
  const queryClient = useQueryClient();
  const { profile } = useAuth();
  const [pickSearch, setPickSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [showOptions, setShowOptions] = useState(false);
  const [pendingProductScan, setPendingProductScan] = useState<string | null>(null);
  const clientTriggerRef = useRef<HTMLButtonElement | null>(null);
  const pickProductRefs = useRef<Record<number, ProductSearchHandle | null>>({});
  const { data: options } = useQuery({ queryKey: ["options"], queryFn: () => fetchOptions() });
  const activeWarehouseId = profile?.default_warehouse_id ?? null;
  const { data: pickLists = [] } = useQuery({
    queryKey: ["pick-lists", activeWarehouseId],
    queryFn: () => listPickLists(activeWarehouseId),
  });
  const cancelMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string }) => cancelPickList(id, reason),
    onSuccess: async () => {
      alertToast.success("Pick list cancelled");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["pick-lists"] }),
        queryClient.invalidateQueries({ queryKey: ["dashboard-metrics"] }),
        // Cancelling releases the reservation, so free-to-pick stock changes.
        queryClient.invalidateQueries({ queryKey: ["pickable-stock-summary"] }),
        queryClient.invalidateQueries({ queryKey: ["inventory-search"] }),
      ]);
    },
    onError: (error: unknown) => alertToast.noGo(error instanceof Error ? error.message : "Failed to cancel pick list"),
  });
  const form = useForm<z.infer<typeof pickListSchema>>({
    resolver: zodResolver(pickListSchema),
    defaultValues: {
      warehouse_id: profile?.default_warehouse_id || undefined,
      client_id: undefined,
      order_number: "",
      requested_ship_date: new Date().toISOString().slice(0, 10),
      notes: "",
      lines: [{ product_id: "", quantity: 1 }],
    },
  });

  useEffect(() => {
    const warehouseId = form.getValues("warehouse_id");
    const defaultWarehouseId = profile?.default_warehouse_id || (options?.warehouses?.length === 1 ? options.warehouses[0].id : "");
    if (!warehouseId && defaultWarehouseId) {
      form.setValue("warehouse_id", defaultWarehouseId);
    }
  }, [form, options?.warehouses, profile?.default_warehouse_id]);

  useEffect(() => {
    if (!form.getValues("requested_ship_date")) {
      form.setValue("requested_ship_date", new Date().toISOString().slice(0, 10));
    }
  }, [form]);

  useEffect(() => {
    if (!createOpen) return;
    const timer = setTimeout(() => clientTriggerRef.current?.focus(), 80);
    return () => clearTimeout(timer);
  }, [createOpen]);

  const mutation = useMutation({
    mutationFn: async (values: z.infer<typeof pickListSchema>) => createPickListFlow(values),
    onSuccess: async (pickList) => {
      // Ring every subscribed device. Fire-and-forget on purpose: the list is
      // already released, and a notification must never make that look like a
      // failure. Anything lost here the sweeper picks up within a minute.
      // Fired from the page rather than createPickListFlow so the core stays a
      // pure data function, matching how reorder alert emails are sent.
      void dispatchNotificationForEntity("pick_lists", (pickList as { id: string }).id);
      alertToast.success("Pick list released");
      form.reset({
        warehouse_id: profile?.default_warehouse_id || undefined,
        client_id: undefined,
        order_number: "",
        requested_ship_date: new Date().toISOString().slice(0, 10),
        notes: "",
        lines: [{ product_id: "", quantity: 1 }],
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["pick-lists"] }),
        queryClient.invalidateQueries({ queryKey: ["dashboard-metrics"] }),
        // Releasing a list reserves stock — the "available to pick" summary the
        // create form reads from is stale the moment this succeeds.
        queryClient.invalidateQueries({ queryKey: ["pickable-stock-summary"] }),
      ]);
      setShowOptions(false);
      setCreateOpen(false);
    },
    onError: (error) => alertToast.noGo(error instanceof Error ? error.message : "Pick list failed"),
  });

  const selectedWarehouseId = form.watch("warehouse_id");
  const { data: pickableStock } = useQuery({
    queryKey: ["pickable-stock-summary", selectedWarehouseId],
    queryFn: () => getPickableStockSummary(selectedWarehouseId || undefined),
    staleTime: 30_000,
  });

  const lines = form.watch("lines");
  const pickSearchTerm = pickSearch.trim().toLowerCase();
  const matchesPickSearch = (pickList: any) => {
    if (!pickSearchTerm) return true;
    const taskValues = (pickList.pick_tasks ?? []).flatMap((task: any) => [
      task.status,
      task.short_reason,
      task.quantity,
      task.pallets?.pallet_barcode,
      task.pallets?.pallet_code,
      task.pallets?.products?.sku,
      task.pallets?.products?.name,
    ]);
    return [
      pickList.pick_list_number,
      pickList.status,
      pickList.notes,
      pickList.order_number,
      ...taskValues,
    ].some((value) => String(value ?? "").toLowerCase().includes(pickSearchTerm));
  };
  const allActive = (pickLists as any[]).filter((pl) => !["completed", "cancelled"].includes(pl.status));
  const active = allActive.filter(matchesPickSearch);
  const done = (pickLists as any[]).filter((pl) => ["completed", "cancelled"].includes(pl.status)).filter(matchesPickSearch);
  // Every product stays searchable — nothing is filtered out. Products with
  // pickable stock in the selected warehouse are listed first, and the rest
  // show "No pickable pallets" so an operator can see the SKU exists.
  const productOptions = (options?.products ?? [])
    .map((product: any) => {
      const summary = pickableStock?.get(product.id);
      return {
        id: product.id,
        sku: product.sku,
        name: product.name,
        barcode: product.barcode,
        meta: {
          totalQty: summary?.totalAvailable ?? 0,
          palletCount: summary?.palletCount ?? 0,
          palletCode: summary?.topPallet?.pallet_code,
          palletQty: summary?.topPallet?.available_quantity,
          locationCode: summary?.topPallet?.location_code,
        },
        hasPickableStock: Boolean(summary),
      };
    })
    .sort((a: any, b: any) =>
      a.hasPickableStock === b.hasPickableStock ? 0 : a.hasPickableStock ? -1 : 1,
    );

  function findProductForPickScan(value: string) {
    const normalized = normalizeScannerText(value);
    return (options?.products ?? []).find((product: any) =>
      [product.barcode, product.sku, product.name]
        .filter(Boolean)
        .some((candidate) => normalizeScannerText(candidate) === normalized),
    );
  }

  function defaultWholePalletQuantity(productId: string) {
    const qty = Number(pickableStock?.get(productId)?.topPallet?.available_quantity ?? 1);
    return Number.isFinite(qty) && qty > 0 ? qty : 1;
  }

  function addProductScanToDraft(value: string, options?: { resetDraft?: boolean }) {
    const product = findProductForPickScan(value);
    if (!product) {
      setPickSearch(normalizeScannerText(value));
      alertToast.noGo("No product found for scanned barcode.");
      return;
    }

    const scanQty = defaultWholePalletQuantity(product.id);
    const currentLines = options?.resetDraft ? [] : [...(form.getValues("lines") ?? [])];
    const existingIndex = currentLines.findIndex((line) => line.product_id === product.id);
    let nextLines: typeof currentLines;
    if (existingIndex >= 0) {
      nextLines = currentLines.map((line, index) =>
        index === existingIndex
          ? { ...line, quantity: Number(line.quantity ?? 0) + scanQty }
          : line,
      );
    } else {
      const blankIndex = currentLines.findIndex((line) => !line.product_id);
      const nextLine = { product_id: product.id, quantity: scanQty };
      if (blankIndex >= 0) {
        nextLines = currentLines.map((line, index) => index === blankIndex ? nextLine : line);
      } else {
        nextLines = [...currentLines, nextLine];
      }
    }

    if (options?.resetDraft) {
      form.reset({
        warehouse_id: (form.getValues("warehouse_id") as string | undefined) || profile?.default_warehouse_id || undefined,
        client_id: undefined,
        order_number: "",
        requested_ship_date: new Date().toISOString().slice(0, 10),
        notes: "",
        lines: nextLines.length > 0 ? nextLines : [{ product_id: product.id, quantity: scanQty }],
      });
    } else {
      form.setValue("lines", nextLines.length > 0 ? nextLines : [{ product_id: product.id, quantity: scanQty }], {
        shouldDirty: true,
        shouldValidate: true,
      });
    }
    setCreateOpen(true);
    alertToast.success(`Added ${product.sku ?? product.name} to pick draft`);
  }

  function hasUnreleasedPickDraft() {
    return Boolean(
      (form.getValues("lines") ?? []).some((line) => line.product_id) ||
      form.getValues("order_number") ||
      form.getValues("notes") ||
      form.getValues("client_id"),
    );
  }

  function handlePickHeaderScan(value: string) {
    const normalized = normalizeScannerText(value);
    const product = findProductForPickScan(normalized);
    if (product && createOpen) {
      addProductScanToDraft(normalized);
      return;
    }
    if (product && hasUnreleasedPickDraft()) {
      setPendingProductScan(normalized);
      return;
    }
    if (product) {
      addProductScanToDraft(normalized);
      return;
    }
    setPickSearch(normalized);
  }

  function prefetchPickExecution(pickListId: string) {
    void queryClient.prefetchQuery({
      queryKey: ["pick-execution", pickListId],
      queryFn: () => getPickExecution(pickListId),
    });
  }

  return (
    <div className="contents">
    <div className="grid gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-2xl font-semibold">Pick Lists</h2>
            <HintButton label="Pick Lists hints">
              Release outbound work and execute scan-confirmed picks.
            </HintButton>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-2 sm:flex sm:flex-wrap">
          <Button className="min-w-0 px-2 text-xs sm:px-4 sm:text-sm" onClick={() => setCreateOpen(true)}>
            <Plus data-icon="inline-start" />
            <span className="truncate">New pick list</span>
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
              className="pl-9 pr-24"
              value={pickSearch}
              onChange={(event) => setPickSearch(event.target.value)}
              placeholder="Search pick lists or barcodes"
            />
            {/* Counts both lanes on the tab — a term that only hits a completed
                list still reports a match, so the collapsed section gets opened
                instead of reading as "nothing found". */}
            <RecordCount
              className="absolute right-3 top-1/2 -translate-y-1/2"
              isFiltering={Boolean(pickSearchTerm)}
              visible={active.length + done.length}
            />
          </div>
          <BarcodeScanButton title="Scan pick list, pallet, or product barcode" onScan={handlePickHeaderScan} />
        </div>
        </CardContent>
      </Card>

      <div className="flex items-center gap-2 px-1">
        <h3 className="text-base font-semibold">Active Lists</h3>
        <Badge variant="secondary">{allActive.length}</Badge>
      </div>
      <div className="grid gap-4">
        {active.length === 0 && (
          <div className="rounded-lg border border-dashed border-border p-8 text-center">
            <ClipboardList className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
            <p className="font-medium">No active pick lists</p>
            <p className="mt-1 text-sm text-muted-foreground">Create a new pick list, or go to Receiving to check inbound stock.</p>
            <Button className="mt-4" variant="outline" asChild>
              <Link to={toPath("/receiving")}>Go to Receiving</Link>
            </Button>
          </div>
        )}
        {active.map((pickList: any) => {
          const tasks: any[] = pickList.pick_tasks ?? [];
          const exceptionCount = tasks.filter((t) => t.status === "exception").length;
          const completedCount = tasks.filter((t) => t.status === "completed").length;
          return (
            <Card key={pickList.id} className={exceptionCount > 0 ? "border-destructive/60" : ""}>
              <CardHeader>
                <CardTitle className="flex flex-wrap items-center justify-between gap-3">
                  <span className="font-mono text-base">{pickList.pick_list_number}</span>
                  <div className="flex items-center gap-2">
                    {exceptionCount > 0 && (
                      <Badge variant="destructive">
                        <AlertTriangle className="mr-1 h-3 w-3" />
                        {exceptionCount} short
                      </Badge>
                    )}
                    <Badge variant={statusBadgeVariant(pickList.status)}>{pickList.status}</Badge>
                  </div>
                </CardTitle>
                <CardDescription>
                  {pickList.notes || "Released outbound work"} · {completedCount}/{tasks.length} tasks done
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-0 px-0 pb-0 sm:gap-3 sm:px-6 sm:pb-6">
                {tasks.map((task: any) => {
                  const product = task.pallets?.products as any;
                  const packSummary = summarizePackStandard(
                    resolveDefaultProfileForProduct(product?.product_packaging_profiles, product?.id),
                  );
                  const packLine = formatPackStandardLine(packSummary);
                  const packCases = casesForQuantity(
                    task.requested_quantity ?? task.quantity,
                    packSummary,
                  );
                  return (
                    <div
                      key={task.id}
                      className={`grid gap-2 border-y px-6 py-3 text-sm sm:flex sm:flex-wrap sm:items-center sm:gap-3 sm:rounded-md sm:border sm:px-3 sm:py-2 ${task.status === "exception" ? "border-destructive/50 bg-destructive/5" : "border-border"}`}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="font-medium leading-5 sm:truncate">{product?.name ?? "—"}</p>
                        {product?.sku && <p className="font-mono text-xs text-muted-foreground">{product.sku}</p>}
                        {task.pallets?.pallet_barcode && (
                          <p className="font-mono text-xs text-muted-foreground">Pallet: {task.pallets.pallet_barcode}</p>
                        )}
                        {packLine && (
                          <p className="font-mono text-xs text-muted-foreground">
                            Pack: {packLine}
                            {packCases !== null
                              ? ` · pick ${Number.isInteger(packCases) ? packCases : `≈${Math.round(packCases)}`} ${packCases === 1 ? "case" : "cases"}`
                              : ""}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center justify-between gap-2 sm:shrink-0 sm:justify-start">
                        <span className="text-sm font-semibold">Qty {formatNumber(task.requested_quantity ?? task.quantity ?? 0)}</span>
                        <Badge variant={statusBadgeVariant(task.status)} className="text-xs">{task.status}</Badge>
                      </div>
                      {task.short_reason && (
                        <p className="w-full text-xs text-destructive">Short: {task.short_reason}</p>
                      )}
                    </div>
                  );
                })}
                <div className="flex flex-wrap gap-2 px-6 py-3 sm:px-0 sm:py-0 sm:pt-1">
                  <Button asChild variant="outline" size="sm">
                    <Link
                      to={toPath(`/pick-lists/${pickList.id}`)}
                      onMouseEnter={() => prefetchPickExecution(pickList.id)}
                      onFocus={() => prefetchPickExecution(pickList.id)}
                    >
                      Execute picks
                    </Link>
                  </Button>
                  {exceptionCount > 0 && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => alertToast.attention("Short pick detected — check inventory levels or reassign stock from another location.", {
                        action: { label: "Inventory", onClick: () => navigate(toPath("/inventory-search")) },
                        duration: 8000,
                      })}
                    >
                      <AlertTriangle className="mr-1 h-3 w-3" />
                      Resolve shortage
                    </Button>
                  )}
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="outline" size="sm" className="text-destructive hover:text-destructive">
                        Cancel pick
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Cancel pick list {pickList.pick_list_number}?</AlertDialogTitle>
                        <AlertDialogDescription>
                          This closes the pick list and cancels any open pick tasks. Completed picks remain recorded. This action cannot be undone.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Keep pick list</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() => cancelMutation.mutate({ id: pickList.id })}
                        >
                          Cancel pick
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </CardContent>
            </Card>
          );
        })}
        {done.length > 0 && (
          <details className="group">
            <summary className="cursor-pointer list-none rounded-md px-3 py-2 text-sm text-muted-foreground hover:text-foreground">
              <span className="group-open:hidden">▶ Show {done.length} completed / cancelled</span>
              <span className="hidden group-open:inline">▼ Hide completed / cancelled</span>
            </summary>
            <div className="mt-2 grid gap-2">
              {done.map((pl: any) => {
                const tasks: any[] = pl.pick_tasks ?? [];
                const completedCount = tasks.filter((task) => task.status === "completed").length;
                return (
                  <details key={pl.id} className="group rounded-md border border-border px-3 py-2 text-sm opacity-80">
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
                      <div className="min-w-0">
                        <span className="block truncate font-mono text-xs">{pl.pick_list_number}</span>
                        <span className="text-xs text-muted-foreground">
                          {completedCount}/{tasks.length} tasks completed{pl.order_number ? ` · ${pl.order_number}` : ""}
                        </span>
                      </div>
                      <Badge variant={statusBadgeVariant(pl.status)} className="shrink-0 text-xs">{pl.status}</Badge>
                    </summary>
                    <div className="mt-3 grid gap-2">
                      {tasks.length === 0 ? (
                        <p className="rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground">No task detail recorded.</p>
                      ) : (
                        tasks.map((task: any) => {
                          const product = task.pallets?.products as any;
                          const palletCode = task.pallets?.pallet_barcode ?? task.pallets?.pallet_code ?? "—";
                          return (
                            <div key={task.id} className="grid gap-1 rounded-md bg-muted/40 px-3 py-2 text-xs sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                              <div className="min-w-0">
                                <p className="truncate font-medium">{product?.name ?? "—"}</p>
                                <p className="font-mono text-muted-foreground">
                                  {product?.sku ?? "No SKU"} · Pallet {palletCode} · {displayRackLocationCode(task.locations?.code) || "No location"}
                                </p>
                                {task.short_reason ? <p className="text-destructive">Short: {task.short_reason}</p> : null}
                              </div>
                              <div className="flex items-center gap-2 sm:justify-end">
                                <span className="font-semibold">Qty {formatNumber(task.confirmed_quantity ?? task.quantity ?? task.requested_quantity ?? 0)}</span>
                                <Badge variant={statusBadgeVariant(task.status)} className="text-xs">{task.status}</Badge>
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </details>
                );
              })}
            </div>
          </details>
        )}
      </div>
    </div>
    <Dialog open={createOpen} onOpenChange={setCreateOpen}>
      <DialogContent
        className="h-[calc(100dvh-0.75rem)] max-h-[calc(100dvh-0.75rem)] w-[calc(100vw-0.75rem)] max-w-[calc(100vw-0.75rem)] overflow-hidden bg-card p-0 text-card-foreground sm:h-auto sm:max-h-[92vh] sm:max-w-3xl"
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <Form {...form}>
          <form className="flex min-h-0 flex-col" onSubmit={form.handleSubmit((values) => mutation.mutate(values))}>
            <DialogHeader className="border-b border-border px-3 py-2 sm:px-4 sm:py-3">
              <DialogTitle>New Pick List</DialogTitle>
              <DialogDescription className="text-xs sm:text-sm">
                Order details come first, then one or more SKU lines. Lots and pallets are allocated FEFO/FIFO on release.
              </DialogDescription>
            </DialogHeader>
            <div className="min-w-0 max-h-[calc(100dvh-8.75rem)] overflow-y-auto px-3 py-3 sm:max-h-[calc(92vh-150px)] sm:px-4 sm:py-4">
              <div className="grid min-w-0 gap-3 sm:gap-4">
                <div className="grid items-start gap-2 sm:grid-cols-2 sm:gap-3">
                  <SelectField form={form} name="warehouse_id" label="Warehouse" options={(options?.warehouses ?? []).map((warehouse) => ({ label: warehouse.name, value: warehouse.id }))} />
                  <FormField
                    control={form.control}
                    name="client_id"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Client</FormLabel>
                        <Select
                          onValueChange={(value) => field.onChange(value === "__none__" ? undefined : value)}
                          value={(field.value as string | undefined) ?? "__none__"}
                        >
                          <FormControl>
                            <SelectTrigger ref={clientTriggerRef}>
                              <SelectValue placeholder="Select client" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="__none__">No client</SelectItem>
                            {(options?.clients ?? []).map((client) => (
                              <SelectItem key={client.id} value={client.id}>
                                {client.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="order_number"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Order number</FormLabel>
                        <FormControl>
                          <div className="flex gap-2">
                            <Input {...field} value={field.value ?? ""} onChange={(event) => field.onChange(normalizeScannerText(event.target.value))} />
                            <BarcodeScanButton title="Scan order number" onScan={(value) => field.onChange(normalizeScannerText(value))} />
                          </div>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <TextField form={form} name="requested_ship_date" label="Requested ship date" type="date" />
                </div>
                <button type="button" className="w-fit text-sm font-medium text-primary underline-offset-2 hover:underline" onClick={() => setShowOptions((v) => !v)}>
                  {showOptions ? "Hide" : "Show"} options
                </button>
                {showOptions && (
                  <div className="grid gap-3 rounded-lg border border-border bg-secondary/20 p-3">
                    <FormField
                      control={form.control}
                      name="notes"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Notes / special handling</FormLabel>
                          <FormControl>
                            <Textarea rows={2} {...field} value={field.value ?? ""} />
                          </FormControl>
                        </FormItem>
                      )}
                    />
                  </div>
                )}

                <div className="grid gap-3">
                  {lines.map((_, index) => {
                    const productId = lines[index]?.product_id as string | undefined;
                    const qty = Number(lines[index]?.quantity ?? 0);
                    const summary = productId ? pickableStock?.get(productId) : undefined;
                    const over = Boolean(summary) && qty > (summary?.totalAvailable ?? 0);
                    return (
                      <div key={index} className="grid min-w-0 gap-2 rounded-lg border border-border p-2 sm:gap-3 sm:p-3">
                        <div className="flex items-center justify-between gap-3">
                          <p className="font-medium">SKU line {index + 1}</p>
                          <div className="flex items-center gap-1">
                            <Button
                              type="button"
                              size="icon"
                              variant="ghost"
                              className="h-7 w-7"
                              title="Reset SKU line"
                              aria-label="Reset SKU line"
                              onClick={() => form.setValue(`lines.${index}`, { product_id: "", quantity: 1 }, { shouldDirty: true })}
                            >
                              <RotateCcw className="h-4 w-4" />
                            </Button>
                            {lines.length > 1 && (
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                title="Remove SKU line"
                                aria-label="Remove SKU line"
                                onClick={() => form.setValue("lines", lines.filter((_, currentIndex) => currentIndex !== index))}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            )}
                          </div>
                        </div>
                        <div className="grid min-w-0 gap-2 sm:grid-cols-[minmax(0,2fr)_minmax(9rem,1fr)] sm:gap-3">
                          <FormField
                            control={form.control}
                            name={`lines.${index}.product_id`}
                            render={({ field, fieldState }) => (
                              <FormItem className="min-w-0">
                                <FormLabel>Product</FormLabel>
                                <FormControl>
                                  <div className="flex min-w-0 gap-2">
                                    <BarcodeScanButton
                                      title="Scan product barcode"
                                      onScan={(value) => {
                                        const matched = pickProductRefs.current[index]?.scanBarcode(value);
                                        if (matched) playBarcodeBeep();
                                      }}
                                    />
                                    <div className="min-w-0 flex-1">
                                      <ProductSearch
                                        ref={(node) => {
                                          pickProductRefs.current[index] = node;
                                        }}
                                        value={(field.value as string) ?? ""}
                                        onChange={field.onChange}
                                        options={productOptions}
                                        placeholder="Select SKU"
                                        error={Boolean(fieldState.error)}
                                      />
                                    </div>
                                  </div>
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          <FormField
                            control={form.control}
                            name={`lines.${index}.quantity`}
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Qty</FormLabel>
                                <FormControl>
                                  <div className="flex items-center gap-2">
                                    <Button
                                      type="button"
                                      variant="outline"
                                      size="icon"
                                      className="h-10 w-10 shrink-0"
                                      aria-label="Decrease quantity"
                                      onClick={() => field.onChange(Math.max(1, Number(field.value) - 1))}
                                    >
                                      −
                                    </Button>
                                    <Input
                                      {...field}
                                      type="number"
                                      className="min-w-0 text-center text-lg font-semibold"
                                      value={(field.value as number) ?? 1}
                                      onChange={(event) => field.onChange(event.target.valueAsNumber)}
                                    />
                                    <Button
                                      type="button"
                                      variant="outline"
                                      size="icon"
                                      className="h-10 w-10 shrink-0"
                                      aria-label="Increase quantity"
                                      onClick={() => field.onChange(Number(field.value) + 1)}
                                    >
                                      +
                                    </Button>
                                  </div>
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                        </div>
                        {productId && (
                          <div className="flex flex-wrap items-center gap-2 text-xs">
                            <Badge variant={!summary || over ? "destructive" : "secondary"}>
                              {summary ? `${formatNumber(summary.totalAvailable)} available to pick` : "No pickable stock"}
                            </Badge>
                            {summary && (
                              <span className="text-muted-foreground">
                                across {summary.palletCount} pallet{summary.palletCount === 1 ? "" : "s"}
                              </span>
                            )}
                            {over && (
                              <span className="font-medium text-destructive">Reduce qty to {formatNumber(summary?.totalAvailable ?? 0)} or less.</span>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                  <Button
                    className="h-9 sm:h-10"
                    type="button"
                    variant="outline"
                    onClick={() => form.setValue("lines", [...lines, { product_id: "", quantity: 1 }])}
                  >
                    <Plus data-icon="inline-start" />
                    Add SKU line
                  </Button>
                </div>
              </div>
            </div>
            <DialogFooter className="flex-row flex-wrap justify-end gap-2 border-t border-border px-3 py-2 sm:px-4 sm:py-3">
              <Button type="button" variant="outline" onClick={() => {
                  form.reset({
                    warehouse_id: profile?.default_warehouse_id || undefined,
                    client_id: undefined,
                    order_number: "",
                    requested_ship_date: new Date().toISOString().slice(0, 10),
                    notes: "",
                    lines: [{ product_id: "", quantity: 1 }],
                  });
                  setShowOptions(false);
                  setCreateOpen(false);
                }}>Cancel</Button>
              <Button
                type="submit"
                disabled={
                  mutation.isPending ||
                  lines.some((line) => {
                    const summary = line.product_id ? pickableStock?.get(line.product_id) : undefined;
                    if (!summary) return false;
                    return Number(line.quantity ?? 0) > summary.totalAvailable;
                  })
                }
              >
                {mutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Release pick list
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
    <AlertDialog open={Boolean(pendingProductScan)} onOpenChange={(open) => { if (!open) setPendingProductScan(null); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Add scanned product to pick draft?</AlertDialogTitle>
          <AlertDialogDescription>
            There is an unreleased pick draft on this screen. Add the scanned product to that draft, or start a new draft with only this scan.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              if (pendingProductScan) addProductScanToDraft(pendingProductScan);
              setPendingProductScan(null);
            }}
          >
            Add to draft
          </AlertDialogAction>
          <AlertDialogAction
            onClick={() => {
              if (pendingProductScan) addProductScanToDraft(pendingProductScan, { resetDraft: true });
              setPendingProductScan(null);
            }}
          >
            Create new
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </div>
  );
}
