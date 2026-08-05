import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
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
  displayRackLocationCode,
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
  BayOccupancyGrid,
  isBaySelectorCode,
  normalizeScannerText,
  playBarcodeBeep,
  flashInput,
  WarehouseBayBrowserDialog,
} from "@/features/shared/ui-shared";

export function LocationMovesPage() {
  const queryClient = useQueryClient();
  const [newPallet, setNewPallet] = useState("");
  const [newLocation, setNewLocation] = useState("");
  const [newReason, setNewReason] = useState("");
  const newPalletRef = useRef<HTMLInputElement | null>(null);
  const newLocationRef = useRef<HTMLInputElement | null>(null);
  const newReasonRef = useRef<HTMLInputElement | null>(null);
  const [scanState, setScanState] = useState<Record<string, { pallet: string; location: string; validation: MoveValidationResult | null; validating: boolean }>>({})
  const [newValidation, setNewValidation] = useState<MoveValidationResult | null>(null);
  const [newValidating, setNewValidating] = useState(false);;
  const [newBaySelectorOpen, setNewBaySelectorOpen] = useState(false);
  const [completedIds, setCompletedIds] = useState<Set<string>>(new Set());
  const [cancelledIds, setCancelledIds] = useState<Set<string>>(new Set());
  const [bayBrowserOpen, setBayBrowserOpen] = useState(false);
  const [bayBrowserWarehouseId, setBayBrowserWarehouseId] = useState<string | null>(null);

  const { data: warehousesForBrowse = [] } = useQuery<Array<{ id: string; code: string; name: string }>>({
    queryKey: ["warehouses", "moves-bay-browser"],
    queryFn: () => listRecords("warehouses", "id, code, name") as any,
    staleTime: 60_000,
  });

  function openBayBrowser(warehouseId: string) {
    setBayBrowserWarehouseId(warehouseId);
    setBayBrowserOpen(true);
  }

  const invalidateMoveData = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["move-tasks"] }),
      queryClient.invalidateQueries({ queryKey: ["inventory-search"] }),
      queryClient.invalidateQueries({ queryKey: ["dashboard-metrics"] }),
    ]);
  }, [queryClient]);

  const runNewValidation = useCallback(async (pallet: string, location: string) => {
    const p = pallet.trim();
    const l = location.trim();
    if (!p || !l || isBaySelectorCode(l)) { setNewValidation(null); return; }
    setNewValidating(true);
    try {
      const result = await validateMoveDestination(p, l);
      setNewValidation(result);
    } catch { setNewValidation(null); }
    finally { setNewValidating(false); }
  }, []);

  const runTaskValidation = useCallback(async (taskId: string, pallet: string, location: string) => {
    const p = pallet.trim();
    const l = location.trim();
    if (!p || !l || isBaySelectorCode(l)) {
      setScanState((s) => ({ ...s, [taskId]: { ...(s[taskId] ?? { pallet: p, location: l }), validation: null, validating: false } }));
      return;
    }
    setScanState((s) => ({ ...s, [taskId]: { ...(s[taskId] ?? { pallet: p, location: l }), validating: true } }));
    try {
      const result = await validateMoveDestination(p, l);
      setScanState((s) => ({ ...s, [taskId]: { ...(s[taskId] ?? { pallet: p, location: l }), validation: result, validating: false } }));
    } catch {
      setScanState((s) => ({ ...s, [taskId]: { ...(s[taskId] ?? { pallet: p, location: l }), validation: null, validating: false } }));
    }
  }, []);

  const { data: tasks = [], isLoading } = useQuery({
    queryKey: ["move-tasks"],
    queryFn: listMoveTasks,
  });

  const directMoveMutation = useMutation({
    mutationFn: ({ pallet, location, reason }: { pallet: string; location: string; reason?: string }) =>
      completeDirectMove(pallet, location, reason),
    onSuccess: async () => {
      toast.success("Move confirmed — pallet relocated");
      setNewPallet(""); setNewLocation(""); setNewReason(""); setNewValidation(null);
      await invalidateMoveData();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Move failed"),
  });

  const completeMutation = useMutation({
    mutationFn: ({ taskId, pallet, location }: { taskId: string; pallet: string; location: string }) =>
      completeMoveTask(taskId, pallet, location),
    onSuccess: async (_, vars) => {
      toast.success("Move confirmed — pallet relocated");
      setCompletedIds((prev) => new Set([...prev, vars.taskId]));
      await invalidateMoveData();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Move failed"),
  });

  const cancelMutation = useMutation({
    mutationFn: (taskId: string) => cancelMoveTask(taskId),
    onSuccess: async (_, taskId) => {
      toast.warning("Move task cancelled");
      setCancelledIds((prev) => new Set([...prev, taskId]));
      await invalidateMoveData();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Cancel failed"),
  });

  function completeNewMove(pallet = newPallet, location = newLocation) {
    const trimmedPallet = pallet.trim();
    const trimmedLocation = location.trim().toUpperCase();
    if (!trimmedPallet || !trimmedLocation || directMoveMutation.isPending) return;
    directMoveMutation.mutate({
      pallet: trimmedPallet,
      location: trimmedLocation,
      reason: newReason.trim() || undefined,
    });
  }

  function applyNewPalletScan(value: unknown) {
    const pallet = normalizeScannerText(value);
    setNewPallet(pallet);
    setNewValidation(null);
    playBarcodeBeep();
    flashInput(newPalletRef.current, "blue");
    setTimeout(() => newLocationRef.current?.focus(), 50);
  }

  function applyNewLocationScan(value: unknown) {
    if (!newPallet.trim()) {
      toast.error("Scan the pallet first.");
      flashInput(newPalletRef.current, "orange");
      newPalletRef.current?.focus();
      return;
    }
    const location = normalizeScannerText(value);
    setNewLocation(location);
    setNewBaySelectorOpen(isBaySelectorCode(location));
    playBarcodeBeep();
    flashInput(newLocationRef.current, isBaySelectorCode(location) ? "orange" : "blue");
    if (!isBaySelectorCode(location)) {
      void runNewValidation(newPallet, location);
    }
  }

  function selectNewMoveLocation(locationCode: string) {
    setNewLocation(locationCode);
    setNewBaySelectorOpen(false);
    playBarcodeBeep();
    flashInput(newLocationRef.current, "blue");
    void runNewValidation(newPallet, locationCode);
    setTimeout(() => newReasonRef.current?.focus(), 50);
  }

  const pending = (tasks as any[]).filter((t) => !completedIds.has(t.id) && !cancelledIds.has(t.id) && !["completed", "cancelled"].includes(t.status));
  const done    = (tasks as any[]).filter((t) =>  completedIds.has(t.id) || cancelledIds.has(t.id) || ["completed", "cancelled"].includes(t.status));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-2xl font-semibold">Location Moves</h2>
        <p className="text-sm text-muted-foreground">Relocate a pallet within the warehouse — inventory quantity is unchanged.</p>
      </div>

      {/* Create new move task */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">New Move Task</CardTitle>
          <CardDescription>Scan the pallet barcode and target location to complete a move.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex gap-2">
              <Input
                ref={newPalletRef}
                className="flex-1"
                placeholder="Pallet barcode"
                value={newPallet}
                onChange={(e) => setNewPallet(normalizeScannerText(e.target.value))}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    newLocationRef.current?.focus();
                  }
                }}
              />
              <BarcodeScanButton title="Scan pallet" onScan={applyNewPalletScan} />
            </div>
            <div className="flex gap-2">
              <Input
                ref={newLocationRef}
                className="flex-1"
                placeholder="Bay (e.g. A-01) or location (e.g. A-01-01)"
                value={newLocation}
                disabled={!newPallet.trim()}
                onChange={(e) => {
                  const val = normalizeScannerText(e.target.value);
                  setNewLocation(val);
                  setNewBaySelectorOpen(isBaySelectorCode(val));
                  setNewValidation(null);
                  if (val.trim() && newPallet.trim() && !isBaySelectorCode(val)) {
                    void runNewValidation(newPallet, val);
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    if (newValidation && !newValidation.valid) return; // block on hard error
                    completeNewMove();
                  }
                }}
              />
              <BarcodeScanButton
                title="Scan target location"
                onScan={applyNewLocationScan}
              />
              {warehousesForBrowse.length <= 1 ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="shrink-0 self-stretch"
                  disabled={!newPallet.trim() || warehousesForBrowse.length === 0}
                  onClick={() => openBayBrowser(warehousesForBrowse[0]?.id ?? "")}
                >
                  Browse bays
                </Button>
              ) : (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="shrink-0 self-stretch"
                      disabled={!newPallet.trim()}
                    >
                      Browse bays
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {warehousesForBrowse.map((wh) => (
                      <DropdownMenuItem key={wh.id} onClick={() => openBayBrowser(wh.id)}>
                        {wh.code} — {wh.name}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          </div>
          <WarehouseBayBrowserDialog
            open={bayBrowserOpen && Boolean(bayBrowserWarehouseId)}
            warehouseId={bayBrowserWarehouseId ?? ""}
            onClose={() => setBayBrowserOpen(false)}
            onSelectBay={(bayCode) => {
              setBayBrowserOpen(false);
              setNewLocation(bayCode);
              setNewBaySelectorOpen(true);
              flashInput(newLocationRef.current, "orange");
              setNewValidation(null);
            }}
          />
          {newBaySelectorOpen && newPallet.trim() && newLocation.trim().length >= 2 && isBaySelectorCode(newLocation) ? (
            <BayOccupancyGrid locationCode={newLocation} onSelect={selectNewMoveLocation} />
          ) : null}
          {/* Validation feedback */}
          {newValidating && (
            <div className="flex items-center gap-2 rounded-md border border-muted bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin shrink-0" />
              Checking location…
            </div>
          )}
          {!newValidating && newValidation && !newValidation.valid && (
            <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div className="flex flex-col gap-0.5">
                <span className="font-medium">Cannot move here</span>
                <span>{newValidation.reason}</span>
              </div>
            </div>
          )}
          {!newValidating && newValidation?.valid && newValidation.warnings.length > 0 && (
            <div className="flex items-start gap-2 rounded-md border border-amber-400/40 bg-amber-50 dark:bg-amber-950/20 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div className="flex flex-col gap-0.5">
                <span className="font-medium">Warning</span>
                {newValidation.warnings.map((w, i) => <span key={i}>{w}</span>)}
              </div>
            </div>
          )}
          {!newValidating && newValidation?.valid && newValidation.warnings.length === 0 && newLocation.trim() && !isBaySelectorCode(newLocation) && (
            <div className="flex items-center gap-2 rounded-md border border-green-400/40 bg-green-50 dark:bg-green-950/20 px-3 py-2 text-sm text-green-700 dark:text-green-400">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              Location OK — ready to move
            </div>
          )}
          <Input
            ref={newReasonRef}
            placeholder="Reason (optional — e.g. aisle blocked, consolidation)"
            value={newReason}
            onChange={(e) => setNewReason(e.target.value)}
          />
          <Button
            className="w-full"
            disabled={directMoveMutation.isPending || !newPallet || !newLocation || newValidating || (!!newValidation && !newValidation.valid)}
            onClick={() => completeNewMove()}
          >
            {directMoveMutation.isPending ? <Loader2 className="animate-spin mr-2 h-4 w-4" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
            {newValidation && !newValidation.valid ? "Location Invalid" : "Complete Move"}
          </Button>
        </CardContent>
      </Card>

      {/* Pending tasks */}
      {isLoading ? (
        <Card><CardContent className="p-6 text-sm text-muted-foreground">Loading…</CardContent></Card>
      ) : pending.length === 0 && done.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 p-8 text-center text-sm text-muted-foreground">
            <ArrowLeftRight className="h-8 w-8 text-muted-foreground/50" />
            <p className="font-medium">No move tasks yet</p>
            <p>Use the form above to queue a pallet relocation.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-4">
          {pending.map((task: any) => {
            const local = scanState[task.id] ?? { pallet: "", location: "", validation: null, validating: false };
            const fromLoc = displayRackLocationCode((task.from_location as any)?.code) || "—";
            const toLoc   = displayRackLocationCode((task.to_location   as any)?.code) || "—";
            const sku     = (task.pallets as any)?.products?.sku ?? "";
            const name    = (task.pallets as any)?.products?.name ?? "";
            const pBarcode = (task.pallets as any)?.pallet_barcode ?? "";

            return (
              <Card key={task.id} className="border-2">
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center justify-between text-base">
                    <span className="font-mono">{task.task_number}</span>
                    <Badge variant={task.status === "queued" ? "secondary" : "default"}>{task.status}</Badge>
                  </CardTitle>
                  <CardDescription>
                    <span className="font-medium text-foreground">{sku}{sku && name ? " · " : ""}{name}</span>
                    {sku || name ? " — " : ""}<span className="font-mono">{pBarcode}</span>
                    <br />
                    <span className="font-mono text-xs">{fromLoc}</span>
                    <ArrowLeftRight className="inline mx-1 h-3 w-3" />
                    <span className="font-mono text-xs font-semibold">{toLoc}</span>
                    {task.reason && <span className="ml-2 text-xs text-muted-foreground">· {task.reason}</span>}
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                  <div className="grid gap-3 lg:grid-cols-2">
                    <div className="flex gap-2">
                      <Input
                        className="min-h-12 flex-1 text-base"
                        placeholder={`Scan pallet (${pBarcode})`}
                        value={local.pallet}
                        onChange={(e) => {
                          const p = normalizeScannerText(e.target.value);
                          setScanState((s) => ({ ...s, [task.id]: { ...local, pallet: p, validation: null } }));
                          if (p.trim() && local.location.trim() && !isBaySelectorCode(local.location)) {
                            void runTaskValidation(task.id, p, local.location);
                          }
                        }}
                      />
                      <BarcodeScanButton
                        title="Scan pallet barcode"
                        onScan={(v) => {
                          const p = normalizeScannerText(v);
                          playBarcodeBeep();
                          setScanState((s) => ({ ...s, [task.id]: { ...local, pallet: p, validation: null } }));
                          if (local.location.trim() && !isBaySelectorCode(local.location)) {
                            void runTaskValidation(task.id, p, local.location);
                          }
                        }}
                      />
                    </div>
                    <div className="flex gap-2">
                      <Input
                        className="min-h-12 flex-1 text-base"
                        placeholder={`Any bay or location (suggested: ${toLoc})`}
                        value={local.location}
                        onChange={(e) => {
                          const l = normalizeScannerText(e.target.value);
                          setScanState((s) => ({ ...s, [task.id]: { ...local, location: l, validation: null } }));
                          if (l.trim() && local.pallet.trim() && !isBaySelectorCode(l)) {
                            void runTaskValidation(task.id, local.pallet, l);
                          }
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && local.validation?.valid !== false) {
                            completeMutation.mutate({ taskId: task.id, pallet: local.pallet, location: local.location });
                          }
                        }}
                      />
                      <BarcodeScanButton
                        title="Scan target location"
                        onScan={(v) => {
                          const l = normalizeScannerText(v);
                          playBarcodeBeep();
                          setScanState((s) => ({ ...s, [task.id]: { ...local, location: l, validation: null } }));
                          if (local.pallet.trim() && !isBaySelectorCode(l)) {
                            void runTaskValidation(task.id, local.pallet, l);
                          }
                        }}
                      />
                    </div>
                  </div>
                  {/* Validation feedback for task */}
                  {local.validating && (
                    <div className="flex items-center gap-2 rounded-md border border-muted bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin shrink-0" />
                      Checking location…
                    </div>
                  )}
                  {!local.validating && local.validation && !local.validation.valid && (
                    <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                      <div className="flex flex-col gap-0.5">
                        <span className="font-medium">Cannot move here</span>
                        <span>{local.validation.reason}</span>
                      </div>
                    </div>
                  )}
                  {!local.validating && local.validation?.valid && local.validation.warnings.length > 0 && (
                    <div className="flex items-start gap-2 rounded-md border border-amber-400/40 bg-amber-50 dark:bg-amber-950/20 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                      <div className="flex flex-col gap-0.5">
                        <span className="font-medium">Warning</span>
                        {local.validation.warnings.map((w: string, i: number) => <span key={i}>{w}</span>)}
                      </div>
                    </div>
                  )}
                  {!local.validating && local.validation?.valid && local.validation.warnings.length === 0 && local.location.trim() && !isBaySelectorCode(local.location) && (
                    <div className="flex items-center gap-2 rounded-md border border-green-400/40 bg-green-50 dark:bg-green-950/20 px-3 py-2 text-sm text-green-700 dark:text-green-400">
                      <CheckCircle2 className="h-4 w-4 shrink-0" />
                      Location OK — ready to move
                    </div>
                  )}
                  <Button
                    className="min-h-12 w-full text-base"
                    disabled={completeMutation.isPending || !local.pallet || !local.location || local.validating || (!!local.validation && !local.validation.valid)}
                    onClick={() => completeMutation.mutate({ taskId: task.id, pallet: local.pallet, location: local.location })}
                  >
                    {completeMutation.isPending ? <Loader2 className="animate-spin" /> : <ArrowLeftRight data-icon="inline-start" />}
                    {local.validation && !local.validation.valid ? "Location Invalid" : "Confirm Move"}
                  </Button>
                  {["queued", "in_progress"].includes(task.status) && (
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="outline" className="w-full text-destructive hover:text-destructive">
                          <PackageX className="mr-2 h-4 w-4" />
                          Cancel move
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Cancel move {task.task_number}?</AlertDialogTitle>
                          <AlertDialogDescription>
                            This clears the queued move from active work and dashboard counts. The pallet will stay in its current location.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Keep move</AlertDialogCancel>
                          <AlertDialogAction onClick={() => cancelMutation.mutate(task.id)}>
                            Cancel move
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  )}
                </CardContent>
              </Card>
            );
          })}

          {done.length > 0 && (
            <details className="group">
              <summary className="cursor-pointer text-sm text-muted-foreground select-none">
                {done.length} completed move{done.length !== 1 ? "s" : ""}
              </summary>
              <div className="mt-3 flex flex-col gap-2">
                {done.map((task: any) => {
                  const fromLoc = displayRackLocationCode((task.from_location as any)?.code) || "—";
                  const toLoc   = displayRackLocationCode((task.to_location   as any)?.code) || "—";
                  const pBarcode = (task.pallets as any)?.pallet_barcode ?? "";
                  const isCancelled = cancelledIds.has(task.id) || task.status === "cancelled";
                  return (
                    <Card key={task.id} className="opacity-60">
                      <CardContent className="flex items-center justify-between gap-4 py-3 px-4">
                        <div className="text-sm">
                          <span className="font-mono text-xs">{task.task_number}</span>
                          <span className="mx-2 text-muted-foreground">·</span>
                          <span className="font-mono text-xs">{pBarcode}</span>
                          <span className="mx-2 text-muted-foreground">·</span>
                          <span className="font-mono text-xs">{fromLoc}</span>
                          <ArrowLeftRight className="inline mx-1 h-3 w-3" />
                          <span className="font-mono text-xs">{toLoc}</span>
                        </div>
                        <Badge variant={isCancelled ? "destructive" : "default"}>{isCancelled ? "cancelled" : "completed"}</Badge>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
