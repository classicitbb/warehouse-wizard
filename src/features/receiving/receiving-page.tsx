import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type KeyboardEvent, type KeyboardEventHandler, type SetStateAction } from "react";
import { Link, NavLink, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm, type UseFormReturn } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { supabase } from "@/integrations/supabase/client";
import { Activity, AlertCircle, AlertTriangle, ArrowLeftRight, ArrowRight, BarChart3, Bot, Boxes, Building2, CalendarDays, CheckCircle2, ChevronDown, ClipboardCheck, ClipboardList, CloudOff, Download, Eye, EyeOff, FileDown, Forklift, GripVertical, Home, Info, KeyRound, LayoutDashboard, Lock, LockOpen, LogOut, Mail, Maximize2, MapPinned, Menu, Minimize2, Network, Package, PackageX, PanelLeftClose, PanelLeftOpen, Pencil, Plus, Printer, QrCode, RadioTower, RefreshCw, RotateCcw, Search, Settings, ShieldCheck, Star, Tags, Trash2, Truck, Upload, UserPlus, Users } from "lucide-react";
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
  suggestNextRackPosition,
  validateMoveDestination,
  type MoveValidationResult,
} from "@/lib/wms-core";
import { ProductSearch } from "@/components/product-search";
import { PalletLabelPage } from "@/components/pallet-label-page";
import { BarcodeScanButton, type ScanTelemetryEvent } from "@/components/barcode-scan-button";
import { HintButton } from "@/components/hint-button";
import { type ProductSearchHandle } from "@/components/product-search";

import { cn } from "@/lib/utils";
import { collectIso6346ContainerCandidates, extractIso6346ContainerNumber, normalizeContainerNumber, validateIso6346ContainerNumber } from "@/lib/container-number";
import { getProductPalletQtyHint, type PalletQtyHint } from "@/lib/ai-assist";
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
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";


import {
  ReceivingShipmentLineState,
  ReceivingShipmentFormState,
  ShipmentFieldLabel,
  defaultExpiryDate,
  distributeShipmentLine,
  draftToReceivingValues,
  newShipmentLine,
  parseDraftMeta,
  printDraftLabels,
  productRequiresExpiry,
  remainderForLine,
  shouldRestrictToDefaultWarehouse,
  resolveContainerScanValue,
  normalizeScannerText,
} from "@/features/shared/ui-shared";

function parseShipmentDate(value: string) {
  if (!value) return undefined;
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return undefined;
  return new Date(year, month - 1, day);
}

function formatShipmentDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function useTimedButtonProgress(active: boolean) {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (!active) {
      setProgress(0);
      return;
    }

    setProgress((current) => current || 8);
    const timer = window.setInterval(() => {
      setProgress((current) => {
        if (current < 60) return current + 8;
        if (current < 86) return current + 4;
        if (current < 94) return current + 1;
        return current;
      });
    }, 450);

    return () => window.clearInterval(timer);
  }, [active]);

  return active ? progress : 0;
}

function ButtonProgress({ value, label }: { value: number; label: string }) {
  const boundedValue = Math.min(100, Math.max(3, Math.round(value)));

  return (
    <div className="relative z-10 inline-flex min-w-0 items-center gap-2" aria-live="polite">
      <Progress
        value={boundedValue}
        className="h-1.5 w-14 shrink-0 bg-current/20 [&>div]:bg-current"
        aria-label={`${label} progress`}
      />
      <span className="truncate">{label}</span>
      <span className="font-mono text-[0.72rem] tabular-nums">{boundedValue}%</span>
    </div>
  );
}

type ShipmentEntryMode = "shipment" | "pallet";

function inferDraftEntryMode(draft: DraftReceipt): ShipmentEntryMode {
  const meta = parseDraftMeta(draft.notes);
  const receiptType = draft.receipt_type ?? meta.receipt_type;
  const containerNumber = String(draft.container_number ?? meta.container_number ?? "").trim();

  if (meta.entry_mode === "pallet" || meta._standalone_pallet === true) return "pallet";
  if (meta.entry_mode === "shipment") return "shipment";
  if (receiptType === "other" && !containerNumber) return "pallet";
  return "shipment";
}

function ShipmentExpiryPicker({
  value,
  required,
  invalid,
  open,
  triggerRef,
  onKeyDown,
  onOpenChange,
  onChange,
}: {
  value: string;
  required: boolean;
  invalid: boolean;
  open: boolean;
  triggerRef: (node: HTMLButtonElement | null) => void;
  onKeyDown?: KeyboardEventHandler<HTMLButtonElement>;
  onOpenChange: (open: boolean) => void;
  onChange: (value: string) => void;
}) {
  const selected = parseShipmentDate(value);
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button
          ref={triggerRef}
          type="button"
          variant="outline"
          onKeyDown={onKeyDown}
          className={cn(
            "h-9 w-full justify-start px-3 text-left font-normal focus-visible:border-ring focus-visible:ring-0 focus-visible:shadow-[inset_0_0_0_1px_hsl(var(--ring)),inset_0_0_0_9999px_hsl(var(--ring)/0.04)] sm:h-10",
            !value && "text-muted-foreground",
            required && invalid && "border-amber-500 focus-visible:border-amber-500 focus-visible:shadow-[inset_0_0_0_1px_rgb(245_158_11),inset_0_0_0_9999px_rgb(245_158_11/0.08)]",
          )}
          aria-label="Expiry"
          aria-invalid={invalid}
        >
          <CalendarDays className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" />
          {value || "dd/mm/yyyy"}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(28rem,calc(100vw-2rem))] p-2 sm:w-auto sm:p-3">
        <Calendar
          mode="single"
          selected={selected}
          onSelect={(date) => {
            if (!date) return;
            onChange(formatShipmentDate(date));
            onOpenChange(false);
          }}
          initialFocus
          classNames={{
            caption_label: "text-base font-semibold sm:text-sm",
            head_cell: "w-11 rounded-md text-sm font-medium text-muted-foreground sm:w-9 sm:text-[0.8rem]",
            cell: "h-11 w-11 p-0 text-center text-base sm:h-9 sm:w-9 sm:text-sm",
            day: "inline-flex h-11 w-11 items-center justify-center rounded-md p-0 text-base font-medium hover:bg-accent hover:text-accent-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring aria-selected:opacity-100 sm:h-9 sm:w-9 sm:text-sm",
            day_selected: "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground focus:bg-primary focus:text-primary-foreground",
            day_today: "bg-accent text-accent-foreground ring-1 ring-primary/50",
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

export function ReceivingPage() {
  const navigate = useNavigate();
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
  const productRefs = useRef<Record<string, ProductSearchHandle | null>>({});
  const productCommitRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const totalRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const perPalletRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const palletCountRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const expiryRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const perPalletManualProductRefs = useRef<Record<string, string>>({});
  const containerAutoAdvanceRef = useRef("");
  const [palletQtyHints, setPalletQtyHints] = useState<Record<string, PalletQtyHint | null>>({});
  const [pendingProductCommit, setPendingProductCommit] = useState<Record<string, boolean>>({});
  const [openExpiryLineId, setOpenExpiryLineId] = useState<string | null>(null);
  const [openShipmentDetails, setOpenShipmentDetails] = useState<Record<string, boolean>>({});
  const [shipmentEntryMode, setShipmentEntryMode] = useState<ShipmentEntryMode>("shipment");
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
  const [savingShipmentMode, setSavingShipmentMode] = useState<"receive" | "new" | null>(null);
  const [batchReceiveProgress, setBatchReceiveProgress] = useState({ completed: 0, total: 0 });
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
  const activeWarehouse = warehouses.find((item: any) => item.id === (shipmentForm.warehouse_id || currentWarehouseId));
  const activeClient = clients.find((item: any) => item.id === shipmentForm.client_id);
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
    if (!shipmentOpen) return;
    const timer = window.setTimeout(() => {
      if (shipmentEntryMode === "pallet") {
        focusFirstProductSearch();
        return;
      }
      shipmentContainerInputRef.current?.focus();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [shipmentOpen, shipmentEntryMode]);

  useEffect(() => {
    if (!shipmentOpen || !shipmentContainerValidation.valid) return;
    if (document.activeElement !== shipmentContainerInputRef.current) return;
    if (containerAutoAdvanceRef.current === shipmentContainerValidation.normalized) return;
    containerAutoAdvanceRef.current = shipmentContainerValidation.normalized;
    const timer = window.setTimeout(() => shipmentPoInputRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [shipmentContainerValidation.normalized, shipmentContainerValidation.valid, shipmentOpen]);

  const prevPrintOpenRef = useRef(false);
  const prevPrintContainerRef = useRef(printContainer);

  useEffect(() => {
    const openedNow = printOpen && !prevPrintOpenRef.current;
    const filterChanged = printContainer !== prevPrintContainerRef.current;
    prevPrintOpenRef.current = printOpen;
    prevPrintContainerRef.current = printContainer;
    if (!printOpen || !(openedNow || filterChanged)) return;
    setSelectedDraftIds(new Set(printDrafts.map((draft) => draft.id)));
  }, [printDrafts, printOpen, printContainer]);

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
    const selectedProduct = productOptions.find((product) => product.id === line.product_id);
    const remainder = remainderForLine(line);
    return !line.product_id ||
      Number(line.total_quantity) <= 0 ||
      Number(line.quantity_per_pallet) <= 0 ||
      Number(line.pallet_count) <= 0 ||
      (productRequiresExpiry(selectedProduct) && !line.expiry_date) ||
      (remainder > 0 && !line.remainder_action);
  });
  const saveBlockedReason = shipmentEntryMode === "pallet"
    ? !shipmentForm.warehouse_id
      ? "Select a warehouse before receiving the pallet."
      : incompleteLine
        ? remainderForLine(incompleteLine) > 0 && !incompleteLine.remainder_action
          ? "Choose how to handle the leftover quantity before receiving the pallet."
          : "Enter a SKU and valid quantities before receiving the pallet."
        : ""
    : !shipmentForm.container_number.trim()
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
    onSettled: () => setSavingShipmentMode(null),
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
      setBatchReceiveProgress({ completed: 0, total: draftsToReceive.length });
      for (const draft of draftsToReceive) {
        results.push(await completeReceiptFromDraft(draft.id, draftToReceivingValues(draft)));
        setBatchReceiveProgress({ completed: results.length, total: draftsToReceive.length });
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
    onSettled: () => setBatchReceiveProgress({ completed: 0, total: 0 }),
  });

  const saveNewProgress = useTimedButtonProgress(saveShipmentMutation.isPending && savingShipmentMode === "new");
  const saveReceiveProgress = useTimedButtonProgress(saveShipmentMutation.isPending && savingShipmentMode === "receive");
  const printReceiveProgress = batchReceiveMutation.isPending
    ? (batchReceiveProgress.completed / Math.max(batchReceiveProgress.total, 1)) * 100
    : 0;

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
    setShipmentEntryMode("shipment");
    setShowShipmentMore(false);
    setEditingDraft(null);
    setShipmentContainerTouched(false);
    setShipmentContainerScanWarning(null);
    perPalletManualProductRefs.current = {};
    containerAutoAdvanceRef.current = "";
    setPalletQtyHints({});
    setPendingProductCommit({});
    setOpenExpiryLineId(null);
    setOpenShipmentDetails({});
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

  function openNewPallet() {
    setShipmentEntryMode("pallet");
    setShowShipmentMore(false);
    setEditingDraft(null);
    setShipmentContainerTouched(false);
    setShipmentContainerScanWarning(null);
    perPalletManualProductRefs.current = {};
    containerAutoAdvanceRef.current = "";
    setPalletQtyHints({});
    setPendingProductCommit({});
    setOpenExpiryLineId(null);
    setOpenShipmentDetails({});
    setShipmentForm({
      receipt_type: "other",
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
    const draftEntryMode = inferDraftEntryMode(draft);
    setShipmentEntryMode(draftEntryMode);
    setShowShipmentMore(false);
    setEditingDraft(draft);
    setShipmentContainerTouched(draftEntryMode === "shipment" && Boolean(values.container_number));
    setShipmentContainerScanWarning(null);
    perPalletManualProductRefs.current = {};
    containerAutoAdvanceRef.current = "";
    setPalletQtyHints({});
    setPendingProductCommit({});
    setOpenExpiryLineId(null);
    setOpenShipmentDetails({});
    setShipmentForm({
      receipt_type: values.receipt_type,
      warehouse_id: values.warehouse_id,
      client_id: values.client_id ?? "",
      container_number: draftEntryMode === "pallet" ? "" : values.container_number ?? "",
      po_number: draftEntryMode === "pallet" ? "" : values.po_number ?? "",
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

  function resetShipmentLine(lineId: string) {
    setShipmentForm((current) => ({
      ...current,
      lines: current.lines.map((line) => (line.id === lineId ? { ...newShipmentLine(), id: line.id } : line)),
    }));
    setPendingProductCommit((current) => ({ ...current, [lineId]: false }));
    setPalletQtyHints((current) => ({ ...current, [lineId]: null }));
    setOpenExpiryLineId((current) => (current === lineId ? null : current));
    setOpenShipmentDetails((current) => ({ ...current, [lineId]: false }));
    delete perPalletManualProductRefs.current[lineId];
  }

  function focusFirstProductSearch() {
    const firstLine = shipmentForm.lines[0];
    if (!firstLine) return;
    productRefs.current[firstLine.id]?.open();
  }

  async function selectShipmentProduct(line: ReceivingShipmentLineState, value: string) {
    const product = productOptions.find((item) => item.id === value);
    updateLine(line.id, {
      product_id: value,
      expiry_date: productRequiresExpiry(product) && !line.expiry_date ? defaultExpiryDate() : line.expiry_date,
    });
    setPendingProductCommit((current) => ({ ...current, [line.id]: Boolean(value) }));
    if (value) setTimeout(() => productCommitRefs.current[line.id]?.focus(), 40);
    setPalletQtyHints((current) => ({ ...current, [line.id]: null }));

    const warehouseId = shipmentForm.warehouse_id || currentWarehouseId;
    if (!value || !warehouseId) return;

    const hint = await getProductPalletQtyHint(value, warehouseId);
    setPalletQtyHints((current) => ({ ...current, [line.id]: hint }));
    if (!hint || perPalletManualProductRefs.current[line.id] === value) return;

    setShipmentForm((current) => ({
      ...current,
      lines: current.lines.map((currentLine) => {
        if (currentLine.id !== line.id || currentLine.product_id !== value) return currentLine;
        return distributeShipmentLine({ ...currentLine, quantity_per_pallet: hint.suggestedQty }, "perPallet");
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

  function handleShipmentFieldKeyDown(
    lineId: string,
    field: "product" | "total" | "perPallet" | "count" | "expiry",
    event: KeyboardEvent<HTMLElement>,
  ) {
    if (field === "expiry") {
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      if (field === "product") { focusShipmentField(lineId, "total"); return; }
      if (field === "total") { focusShipmentField(lineId, "perPallet"); return; }
      if (field === "perPallet") { focusShipmentField(lineId, "count"); return; }
      if (field === "count") { focusShipmentField(lineId, "expiry"); }
      return;
    }
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      event.preventDefault();
      if (field === "product") { focusShipmentField(lineId, "total"); return; }
      if (field === "total") { focusShipmentField(lineId, "perPallet"); return; }
      if (field === "perPallet") { focusShipmentField(lineId, "count"); return; }
      if (field === "count") { focusShipmentField(lineId, "expiry"); }
      return;
    }
    if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      event.preventDefault();
      if (field === "total") { productRefs.current[lineId]?.open(); return; }
      if (field === "perPallet") { focusShipmentField(lineId, "total"); return; }
      if (field === "count") { focusShipmentField(lineId, "perPallet"); return; }
      if (field === "expiry") { focusShipmentField(lineId, "count"); }
    }
  }

  function openExpiryPicker(lineId: string) {
    setOpenExpiryLineId(lineId);
    setTimeout(() => expiryRefs.current[lineId]?.focus(), 40);
  }

  function moveToNextShipmentField(lineId: string, field: "product" | "total" | "perPallet" | "count") {
    if (field === "product") {
      setPendingProductCommit((current) => ({ ...current, [lineId]: false }));
      focusShipmentField(lineId, "total");
      return;
    }
    if (field === "total") { focusShipmentField(lineId, "perPallet"); return; }
    if (field === "perPallet") { focusShipmentField(lineId, "count"); return; }
    openExpiryPicker(lineId);
  }

  function commitShipmentQuantity(lineId: string, field: "total" | "perPallet" | "count") {
    updateLine(lineId, {}, field);
    moveToNextShipmentField(lineId, field);
  }

  const canAddSkuLine = shipmentForm.lines.every((line) => Boolean(line.product_id) && Number(line.total_quantity) > 0);

  function saveShipment(mode: "receive" | "new") {
    if (!canSaveShipment) {
      toast.error(saveBlockedReason);
      return;
    }
    setSavingShipmentMode(mode);
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
    if (result.valid) setTimeout(() => shipmentPoInputRef.current?.focus(), 0);
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

  function logContainerScannerTelemetry(event: ScanTelemetryEvent) {
    void writeSystemLog({
      log_type: "info",
      severity: event.event === "scan-success" ? "info" : "warning",
      title: event.event === "scan-success"
        ? `Container scanner verified ${event.value ?? "ISO 6346 code"}`
        : "Container scanner could not verify an ISO 6346 code",
      message: event.event === "scan-success" ? "Verify true" : "Verify failed. Keeping scanner open.",
      source: "receiving.container_scanner",
      details: {
        ...event,
        deviceId: getOrCreateDeviceId(),
        route: "/receiving",
        imageStored: false,
      },
    }).catch((error) => console.error("[receiving.container_scanner] writeSystemLog failed:", error));
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
            <Button size="sm" onClick={() => navigate("/putaway-tasks")}>Go to Put-Away</Button>
            <Button size="sm" variant="ghost" onClick={() => setLastResult(null)}>x</Button>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-2xl font-semibold">Receiving</h2>
            <HintButton label="Receiving hints">
              Create shipment drafts by container, print labels, then receive selected pallets.
            </HintButton>
          </div>
          <p className="hidden text-sm text-muted-foreground sm:block">Create shipment drafts by container, print labels, then receive selected pallets.</p>
        </div>
        <div className="grid grid-cols-3 gap-2 sm:flex sm:flex-wrap">
          <Button className="min-w-0 px-2 text-xs sm:px-4 sm:text-sm" variant="outline" onClick={() => { refetchDrafts(); void flushOfflineQueue(); }}>
            <RefreshCw data-icon="inline-start" />
            <span className="truncate">Sync / Refresh</span>
          </Button>
          <Button className="min-w-0 px-2 text-xs sm:px-4 sm:text-sm" variant="outline" onClick={() => {
            setPrintContainer(draftSearch);
            setSelectedDraftIds(new Set(visibleDrafts.map((draft) => draft.id)));
            setPrintOpen(true);
          }}>
            <Printer data-icon="inline-start" />
            <span className="truncate">Print drafts</span>
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button className="min-w-0 px-2 text-xs sm:px-4 sm:text-sm">
                <Plus data-icon="inline-start" />
                <span className="truncate">New</span>
                <ChevronDown className="ml-1 h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuItem className="min-h-10 px-3 py-2.5" onSelect={() => openNewShipment()}>New shipment</DropdownMenuItem>
              <DropdownMenuItem className="min-h-10 px-3 py-2.5" onSelect={() => openNewPallet()}>New pallet</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
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
          <CardTitle className="flex items-center gap-2 text-base">
            <span>Draft Pallets</span>
            {drafts.length > 0 && <Badge variant="secondary">{drafts.length}</Badge>}
            <HintButton label="Draft Pallets hints">
              Use Print for labels, Edit for quantity/date corrections, and Receive when the physical pallet is confirmed.
            </HintButton>
          </CardTitle>
          <CardDescription className="hidden sm:block">Use Print for labels, Edit for quantity/date corrections, and Receive when the physical pallet is confirmed.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-0 px-0 pb-0 sm:gap-3 sm:px-6 sm:pb-6">
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
            const containerNumber = draft.container_number ?? meta.container_number;
            const poNumber = draft.po_number ?? draft.reference_number ?? meta.po_number ?? meta.reference_number;
            return (
              <div key={draft.id} className="grid gap-3 border-y border-border px-6 py-3 sm:rounded-lg sm:border sm:px-4 lg:grid-cols-[1fr_auto] lg:items-center">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="min-w-0 text-sm font-medium leading-5 sm:truncate">{product ? `${product.sku} · ${product.name}` : "Unknown product"}</p>
                    <Badge variant="outline" className="font-mono">{barcode}</Badge>
                    {draft.draft_sequence && draft.draft_count ? <Badge variant="secondary">{draft.draft_sequence}/{draft.draft_count}</Badge> : null}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Container {containerNumber ?? "—"} · PO {poNumber ?? "—"} · Qty {draft.quantity ?? "?"} · Exp {draft.expiry_date ? formatDate(draft.expiry_date) : "—"}
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
        <DialogContent
          className="h-[calc(100dvh-0.75rem)] max-h-[calc(100dvh-0.75rem)] w-[calc(100vw-0.75rem)] max-w-[calc(100vw-0.75rem)] overflow-hidden bg-card p-0 text-card-foreground sm:h-auto sm:max-h-[92vh] sm:max-w-[min(56rem,96vw)]"
          onOpenAutoFocus={(event) => event.preventDefault()}
        >
          <DialogHeader className="border-b border-border px-3 py-2 sm:px-4 sm:py-3">
            <DialogTitle>{editingDraft ? "Edit Draft Pallet" : shipmentEntryMode === "pallet" ? "New Pallet" : "New Shipment"}</DialogTitle>
            <DialogDescription className="text-xs sm:text-sm">
              {shipmentEntryMode === "pallet"
                ? "Standalone pallet receiving keeps warehouse and client fixed to the active context, then uses the SKU lines for quantities and expiry."
                : "Container and PO come first, then one or more SKU lines with expiry and pallet distribution."}
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="min-w-0 max-h-[calc(100dvh-8.75rem)] px-3 py-3 sm:max-h-[calc(92vh-150px)] sm:px-4 sm:py-4">
            <div className="grid min-w-0 gap-3 sm:gap-4">
              {shipmentEntryMode === "pallet" ? (
                <div className="grid gap-3 rounded-lg border border-dashed border-border bg-secondary/10 p-3">
                  <div className="grid gap-1">
                    <p className="text-sm font-medium text-foreground">Standalone pallet mode</p>
                    <p className="text-xs text-muted-foreground">
                      Warehouse and client follow the active context. Container and PO are not used for this receipt.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="secondary">Warehouse {activeWarehouse?.name ?? (currentWarehouseId || "—")}</Badge>
                    <Badge variant="secondary">Client {activeClient?.name ?? "No client"}</Badge>
                  </div>
                  <div className="grid gap-1.5">
                    <ShipmentFieldLabel>Reference</ShipmentFieldLabel>
                    <Input
                      className="h-9 sm:h-10"
                      value={shipmentForm.reference_number}
                      aria-label="Reference"
                      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); focusFirstProductSearch(); } }}
                      onChange={(e) => setShipmentForm((cur) => ({ ...cur, reference_number: normalizeScannerText(e.target.value) }))}
                    />
                  </div>
                </div>
              ) : (
                <>
                  <div className="grid items-start gap-2 sm:gap-3">
                    <div className="grid gap-1.5">
                      <ShipmentFieldLabel>Warehouse</ShipmentFieldLabel>
                      <Select value={shipmentForm.warehouse_id || undefined} onValueChange={(value) => setShipmentForm((cur) => ({ ...cur, warehouse_id: value }))}>
                        <SelectTrigger className="h-9 sm:h-10"><SelectValue placeholder="Select warehouse" /></SelectTrigger>
                        <SelectContent>
                          {warehouses.length === 0 ? <SelectItem value="__loading_warehouses" disabled>Loading warehouses...</SelectItem> : null}
                          {warehouses.filter((w: any) => Boolean(w.id)).map((w: any) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="grid gap-1.5">
                      <ShipmentFieldLabel>Container number</ShipmentFieldLabel>
                      <div className="grid min-w-0 gap-2 sm:flex sm:flex-nowrap">
                        <BarcodeScanButton
                          className="h-9 w-full min-w-0 justify-center self-start sm:h-10 sm:w-auto sm:flex-none"
                          title="Scan container number"
                          buttonLabel="Scan container number"
                          enableTextRecognition
                          requireConfirm
                          scanMode="containerNumber"
                          inputRef={shipmentContainerInputRef}
                          statusText="Point your camera at the printed container number. It will turn green when a valid ISO 6346 code is recognized."
                          getScanCandidates={collectIso6346ContainerCandidates}
                          onScanTelemetry={logContainerScannerTelemetry}
                          validateScan={(raw) => {
                            const result = resolveContainerScanValue(raw);
                            return { valid: result.valid, value: result.value, message: result.valid ? "Verify true" : result.message };
                          }}
                          onScan={applyShipmentContainerScan}
                        />
                        <Input
                          ref={shipmentContainerInputRef}
                          className={cn(
                            "h-9 min-w-0 sm:h-10 sm:flex-1",
                            shipmentContainerTouched && shipmentContainerInvalid && "border-destructive focus-visible:border-destructive focus-visible:shadow-[inset_0_0_0_1px_hsl(var(--destructive)),inset_0_0_0_9999px_hsl(var(--destructive)/0.08)]",
                            shipmentContainerValid && "border-green-500 focus-visible:border-green-500 focus-visible:shadow-[inset_0_0_0_1px_rgb(34_197_94),inset_0_0_0_9999px_rgb(34_197_94/0.08)]",
                          )}
                          value={shipmentForm.container_number}
                          aria-label="Container number"
                          onBlur={() => setShipmentContainerTouched(true)}
                          onChange={(e) => setShipmentContainer(e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); shipmentPoInputRef.current?.focus(); } }}
                          aria-invalid={shipmentContainerInvalid}
                          aria-describedby="container-number-help"
                        />
                      </div>
                      <p
                        id="container-number-help"
                        className={cn(
                          "text-xs leading-4 break-words",
                          shipmentContainerTouched && shipmentContainerInvalid ? "text-destructive" : shipmentContainerValid ? "text-green-500" : "text-muted-foreground",
                        )}
                      >
                        {shipmentContainerMessage}
                      </p>
                    </div>
                    <div className="grid gap-1.5">
                      <ShipmentFieldLabel>PO number</ShipmentFieldLabel>
                      <Input
                        ref={shipmentPoInputRef}
                        className="h-9 sm:h-10"
                        value={shipmentForm.po_number}
                        aria-label="PO number"
                        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); focusFirstProductSearch(); } }}
                        onChange={(e) => setShipmentForm((cur) => ({ ...cur, po_number: e.target.value.toUpperCase(), reference_number: e.target.value.toUpperCase() }))}
                      />
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
                </>
              )}

              <div className="grid gap-3">
                {shipmentForm.lines.map((line, index) => {
                  const remainder = remainderForLine(line);
                  const selectedProduct = productOptions.find((product) => product.id === line.product_id);
                  const expiryRequired = productRequiresExpiry(selectedProduct);
                  const allocatedQuantity = Math.max(0, Number(line.quantity_per_pallet || 0) * Number(line.pallet_count || 0));
                  const productCommitPending = Boolean(pendingProductCommit[line.id] && line.product_id);
                  return (
                    <div key={line.id} className="grid min-w-0 gap-2 rounded-lg border border-border p-2 sm:gap-3 sm:p-3">
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
                            onClick={() => resetShipmentLine(line.id)}
                          >
                            <RotateCcw className="h-4 w-4" />
                          </Button>
                          {!editingDraft && shipmentForm.lines.length > 1 && (
                            <Button size="sm" variant="ghost" onClick={() => setShipmentForm((cur) => ({ ...cur, lines: cur.lines.filter((item) => item.id !== line.id) }))}>
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      </div>
                      <div className="grid min-w-0 gap-2 lg:gap-3">
                        <div className="grid min-w-0 gap-1.5">
                          <ShipmentFieldLabel>Product</ShipmentFieldLabel>
                          <div className="flex min-w-0 max-w-full flex-wrap gap-2 sm:flex-nowrap">
                            <BarcodeScanButton
                              className="h-9 shrink-0 self-start sm:h-10"
                              title="Scan product"
                              onScan={(value) => {
                                const matched = productRefs.current[line.id]?.scanBarcode(value);
                                if (!matched) toast.warning("No product matched that scan. Search results are open.");
                              }}
                            />
                            <div className="order-3 min-w-0 max-w-full flex-1 basis-full sm:order-none sm:basis-0">
                              <ProductSearch
                                ref={(node) => { productRefs.current[line.id] = node; }}
                                value={line.product_id}
                                options={productOptions}
                                placeholder="Select SKU"
                                onSelectComplete={() => productCommitRefs.current[line.id]?.focus()}
                                onChange={(value) => { void selectShipmentProduct(line, value); }}
                              />
                            </div>
                            <Button
                              ref={(node) => { productCommitRefs.current[line.id] = node; }}
                              type="button"
                              variant={productCommitPending ? "default" : "outline"}
                              size="icon"
                              className={cn(
                                "h-9 w-9 shrink-0 sm:h-10 sm:w-10",
                                productCommitPending && "ring-2 ring-primary ring-offset-2 ring-offset-background",
                              )}
                              title="Commit product and move to Total received"
                              aria-label="Commit product and move to Total received"
                              data-pending-commit={productCommitPending ? "true" : "false"}
                              disabled={!line.product_id}
                              onClick={() => moveToNextShipmentField(line.id, "product")}
                            >
                              <ArrowRight className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                        <div className="grid min-w-0 gap-2 sm:grid-cols-3 md:gap-3">
                          <div className="grid min-w-0 gap-1.5">
                            <ShipmentFieldLabel>Total received</ShipmentFieldLabel>
                            <Input
                              ref={(node) => { totalRefs.current[line.id] = node; }}
                              className="h-9 sm:h-10"
                              type="number"
                              inputMode="numeric"
                              pattern="[0-9]*"
                              min={0}
                              value={line.total_quantity}
                              aria-label="Total received"
                              onFocus={(e) => e.currentTarget.select()}
                              onKeyDown={(e) => handleShipmentFieldKeyDown(line.id, "total", e)}
                              onChange={(e) => updateLine(line.id, { total_quantity: e.currentTarget.value })}
                            />
                          </div>
                          <div className="grid min-w-0 gap-1.5">
                            <ShipmentFieldLabel>Qty per pallet</ShipmentFieldLabel>
                            <Input
                              ref={(node) => { perPalletRefs.current[line.id] = node; }}
                              className="h-9 sm:h-10"
                              type="number"
                              inputMode="numeric"
                              pattern="[0-9]*"
                              min={1}
                              value={line.quantity_per_pallet}
                              aria-label="Qty per pallet"
                              onFocus={(e) => e.currentTarget.select()}
                              onKeyDown={(e) => handleShipmentFieldKeyDown(line.id, "perPallet", e)}
                              onChange={(e) => {
                                if (line.product_id) perPalletManualProductRefs.current[line.id] = line.product_id;
                                const nextValue = e.currentTarget.value;
                                updateLine(
                                  line.id,
                                  { quantity_per_pallet: nextValue },
                                  nextValue === "" ? undefined : "perPallet",
                                );
                              }}
                            />
                            {palletQtyHints[line.id] ? (
                              <p className="text-xs text-muted-foreground">
                                Suggested from {palletQtyHints[line.id]?.sampleCount} prior pallet{palletQtyHints[line.id]?.sampleCount === 1 ? "" : "s"}.
                              </p>
                            ) : null}
                          </div>
                          <div className="grid min-w-0 gap-1.5">
                            <ShipmentFieldLabel>Pallets</ShipmentFieldLabel>
                            <Input
                              ref={(node) => { palletCountRefs.current[line.id] = node; }}
                              className="h-9 sm:h-10"
                              type="number"
                              inputMode="numeric"
                              pattern="[0-9]*"
                              min={1}
                              value={line.pallet_count}
                              aria-label="Pallets"
                              onFocus={(e) => e.currentTarget.select()}
                              onKeyDown={(e) => handleShipmentFieldKeyDown(line.id, "count", e)}
                              onChange={(e) => updateLine(line.id, { pallet_count: e.currentTarget.value })}
                            />
                          </div>
                        </div>
                      </div>
                      <div className="grid gap-2">
                        <div className="grid gap-1.5">
                          <ShipmentFieldLabel>Expiry{expiryRequired ? " *" : ""}</ShipmentFieldLabel>
                          <ShipmentExpiryPicker
                            triggerRef={(node) => { expiryRefs.current[line.id] = node; }}
                            required={expiryRequired}
                            invalid={expiryRequired && !line.expiry_date}
                            value={line.expiry_date}
                            open={openExpiryLineId === line.id}
                            onOpenChange={(open) => setOpenExpiryLineId(open ? line.id : null)}
                            onKeyDown={(e) => handleShipmentFieldKeyDown(line.id, "expiry", e)}
                            onChange={(value) => {
                              updateLine(line.id, { expiry_date: value });
                              setOpenExpiryLineId(null);
                            }}
                          />
                        </div>
                        <Collapsible open={Boolean(openShipmentDetails[line.id])} onOpenChange={(open) => setOpenShipmentDetails((current) => ({ ...current, [line.id]: open }))}>
                          <CollapsibleTrigger asChild>
                            <Button type="button" variant="ghost" tabIndex={-1} className="h-8 w-fit px-0 text-xs font-medium text-muted-foreground hover:bg-transparent hover:text-foreground">
                              <ChevronDown className="mr-1 h-3.5 w-3.5" />
                              Lot, batch, and packaging
                            </Button>
                          </CollapsibleTrigger>
                          <CollapsibleContent className="grid gap-2 pt-1 md:grid-cols-3 md:gap-3">
                            <div className="grid gap-1.5">
                              <ShipmentFieldLabel>Lot</ShipmentFieldLabel>
                              <Input
                                tabIndex={-1}
                                aria-label="Lot"
                                className="h-9 sm:h-10"
                                value={line.lot_number}
                                onChange={(e) => updateLine(line.id, { lot_number: normalizeScannerText(e.target.value) })}
                              />
                            </div>
                            <div className="grid gap-1.5">
                              <ShipmentFieldLabel>Batch</ShipmentFieldLabel>
                              <Input
                                tabIndex={-1}
                                aria-label="Batch"
                                className="h-9 sm:h-10"
                                value={line.batch_number}
                                onChange={(e) => updateLine(line.id, { batch_number: normalizeScannerText(e.target.value) })}
                              />
                            </div>
                            <div className="grid gap-1.5">
                              <ShipmentFieldLabel>Packaging</ShipmentFieldLabel>
                              <Select value={line.packaging_profile_id || undefined} onValueChange={(value) => updateLine(line.id, { packaging_profile_id: value })}>
                                <SelectTrigger
                                  tabIndex={-1}
                                  aria-label="Packaging"
                                  className="h-9 sm:h-10"
                                >
                                  <SelectValue placeholder="Optional" />
                                </SelectTrigger>
                                <SelectContent>
                                  {packagingProfiles.length === 0 ? <SelectItem value="__no_packaging" disabled>No packaging profiles</SelectItem> : null}
                                  {packagingProfiles.filter((profile: any) => Boolean(profile.id)).map((profile: any) => <SelectItem key={profile.id} value={profile.id}>{profile.profile_name}</SelectItem>)}
                                </SelectContent>
                              </Select>
                            </div>
                          </CollapsibleContent>
                        </Collapsible>
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
                              <label key={value} className="flex items-center gap-2 rounded-md border border-red-600 bg-red-500 px-3 py-2 text-black shadow-xs">
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
          </ScrollArea>
          <DialogFooter className="flex-row flex-wrap justify-end gap-2 border-t border-border px-3 py-2 sm:px-4 sm:py-3">
            {saveBlockedReason && (
              <p className="mr-auto w-full text-xs font-medium text-amber-500 sm:w-auto sm:self-center">{saveBlockedReason}</p>
            )}
            <Button variant="outline" onClick={() => setShipmentOpen(false)}>Cancel</Button>
            {!editingDraft && (
              <Button className="relative overflow-hidden" variant="outline" disabled={saveShipmentMutation.isPending || !canSaveShipment} onClick={() => saveShipment("new")}>
                {saveShipmentMutation.isPending && savingShipmentMode === "new" ? (
                  <ButtonProgress value={saveNewProgress} label={shipmentEntryMode === "pallet" ? "Receiving" : "Saving"} />
                ) : (
                  shipmentEntryMode === "pallet" ? "Receive & New" : "Save & New"
                )}
              </Button>
            )}
            <Button className="relative overflow-hidden" disabled={saveShipmentMutation.isPending || !canSaveShipment} onClick={() => saveShipment("receive")}>
              {saveShipmentMutation.isPending && savingShipmentMode === "receive" ? (
                <ButtonProgress value={saveReceiveProgress} label={editingDraft ? "Saving" : shipmentEntryMode === "pallet" ? "Receiving" : "Saving"} />
              ) : (
                editingDraft ? "Save Draft" : shipmentEntryMode === "pallet" ? "Receive pallet" : "Save & Receive"
              )}
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
                  className={cn(printContainerWarning && "border-destructive focus-visible:border-destructive focus-visible:shadow-[inset_0_0_0_1px_hsl(var(--destructive)),inset_0_0_0_9999px_hsl(var(--destructive)/0.08)]")}
                  placeholder="Filter by container number"
                  aria-invalid={Boolean(printContainerWarning)}
                />
                <BarcodeScanButton title="Scan container number" enableTextRecognition onScan={applyPrintContainerScan} />
              </div>
              <p className={cn("text-xs", printContainerWarning ? "text-destructive" : "text-muted-foreground")}>
                {printContainerWarning ?? "Enter or scan an ISO 6346 container number to narrow this label batch."}
              </p>
            </div>
            <ScrollArea className="max-h-[50vh] pr-3">
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
            </ScrollArea>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSelectedDraftIds(new Set(printDrafts.map((draft) => draft.id)))}>Select all shown</Button>
            <Button variant="outline" disabled={selectedDraftIds.size === 0} onClick={() => setSelectedDraftIds(new Set())}>Deselect all</Button>
            <Button className="relative overflow-hidden" disabled={batchReceiveMutation.isPending || selectedPrintDrafts.length === 0} onClick={() => printAndReceiveDrafts(selectedPrintDrafts)}>
              {batchReceiveMutation.isPending ? (
                <ButtonProgress
                  value={printReceiveProgress}
                  label={`Sending ${batchReceiveProgress.completed}/${Math.max(batchReceiveProgress.total, selectedPrintDrafts.length)}`}
                />
              ) : (
                <>
                  <Printer data-icon="inline-start" />
                  Print selected & send to Put-Away
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
