import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QRCodeSVG } from "qrcode.react";
import { Link, NavLink, useLocation, useNavigate, useSearchParams } from "@/lib/router-compat";
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
  SelectField,
  TextField,
  statusBadgeVariant,
} from "@/features/shared/ui-shared";

export function CycleCountsPage() {
  const queryClient = useQueryClient();
  const { data: options } = useQuery({ queryKey: ["options"], queryFn: () => fetchOptions() });
  const { data: counts = [] } = useQuery({ queryKey: ["cycle-counts"], queryFn: listCycleCounts });
  // Per-line "can't count" exception state
  const [exState, setExState] = useState<Record<string, { open: boolean; reason: string }>>({});

  const form = useForm<z.input<typeof cycleCountSchema>, any, z.output<typeof cycleCountSchema>>({
    resolver: zodResolver(cycleCountSchema),
    defaultValues: { scope: "spot", variance_threshold_percent: 5 },
  });

  const createMutation = useMutation({
    mutationFn: async (values: z.infer<typeof cycleCountSchema>) => createCycleCountFlow(values),
    onSuccess: async () => {
      toast.success("Count sheet generated");
      await queryClient.invalidateQueries({ queryKey: ["cycle-counts"] });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Count creation failed"),
  });

  const submitMutation = useMutation({
    mutationFn: async ({ lineId, quantity }: { lineId: string; quantity: number }) =>
      submitCycleCountLine(lineId, quantity),
    onSuccess: async (_data, variables) => {
      // Re-fetch to show variance badge immediately
      await queryClient.invalidateQueries({ queryKey: ["cycle-counts"] });
      toast.success(`Count submitted for line`);
      void variables;
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Submit failed"),
  });

  const exceptionMutation = useMutation({
    mutationFn: async ({ lineId, reason }: { lineId: string; reason: string }) =>
      flagCountLineException(lineId, reason),
    onSuccess: async (_data, variables) => {
      setExState((s) => ({ ...s, [variables.lineId]: { open: false, reason: "" } }));
      toast.warning("Count line flagged as exception — supervisor review required");
      await queryClient.invalidateQueries({ queryKey: ["cycle-counts"] });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Flag failed"),
  });

  const active = (counts as any[]).filter((c) => !["completed", "cancelled"].includes(c.status));
  const done = (counts as any[]).filter((c) => ["completed", "cancelled"].includes(c.status));

  return (
    <div className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
      <Card className="min-w-0">
        <CardHeader>
          <CardTitle>Create Count</CardTitle>
          <CardDescription>Generate location, zone, SKU, or spot counts with approval thresholds.</CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form className="grid gap-4" onSubmit={form.handleSubmit((values) => createMutation.mutate(values))}>
              <SelectField form={form} name="warehouse_id" label="Warehouse" options={(options?.warehouses ?? []).map((warehouse) => ({ label: warehouse.name, value: warehouse.id }))} />
              <SelectField form={form} name="scope" label="Scope" options={[
                { label: "Location", value: "location" },
                { label: "Zone", value: "zone" },
                { label: "SKU", value: "sku" },
                { label: "Spot", value: "spot" },
              ]} />
              <SelectField form={form} name="zone_id" label="Zone" options={(options?.zones ?? []).map((zone) => ({ label: zone.name, value: zone.id }))} />
              <SelectField form={form} name="location_id" label="Location" options={(options?.locations ?? []).map((location) => ({ label: location.code, value: location.id }))} />
              <SelectField form={form} name="product_id" label="Product" options={(options?.products ?? []).map((product) => ({ label: product.sku, value: product.id }))} />
              <TextField form={form} name="variance_threshold_percent" label="Variance threshold %" type="number" />
              <Button className="w-full sm:w-auto" type="submit" disabled={createMutation.isPending}>
                {createMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Generate count
              </Button>
            </form>
          </Form>
        </CardContent>
      </Card>

      <div className="grid min-w-0 content-start gap-4">
        {active.length === 0 && done.length === 0 && (
          <div className="rounded-lg border border-dashed border-border p-8 text-center">
            <ClipboardCheck className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
            <p className="font-medium">No active counts</p>
            <p className="mt-1 text-sm text-muted-foreground">Generate a count sheet from the form to start a cycle count.</p>
          </div>
        )}
        {active.map((count: any) => {
          const lines: any[] = count.cycle_count_lines ?? [];
          const threshold = count.variance_threshold_percent ?? 5;
          const exceptionLines = lines.filter((l) => l.status === "exception").length;
          return (
            <Card key={count.id} className={exceptionLines > 0 ? "border-amber-500/60" : ""}>
              <CardHeader>
                <CardTitle className="flex flex-wrap items-center justify-between gap-3">
                  <span className="min-w-0 font-mono text-base break-all">{count.count_number}</span>
                  <div className="flex items-center gap-2">
                    {exceptionLines > 0 && (
                      <Badge variant="outline" className="border-amber-500 text-amber-700 dark:text-amber-400">
                        <AlertTriangle className="mr-1 h-3 w-3" />
                        {exceptionLines} flagged
                      </Badge>
                    )}
                    <Badge variant={statusBadgeVariant(count.status)}>{count.status}</Badge>
                  </div>
                </CardTitle>
                <CardDescription>
                  Scope: {count.scope} · Threshold: ±{threshold}% · {lines.filter((l) => l.status === "completed").length}/{lines.length} lines done
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3">
                {lines.map((line: any) => {
                  const product = line.products as any;
                  const loc = line.locations as any;
                  const counted = line.counted_quantity ?? line.expected_quantity;
                  const variance = line.variance_quantity ?? 0;
                  const varPct = line.variance_percent ?? 0;
                  const overThreshold = Math.abs(varPct) > threshold && line.status === "completed";
                  const es = exState[line.id] ?? { open: false, reason: "" };
                  const isException = line.status === "exception";

                  return (
                    <div
                      key={line.id}
                      className={`rounded-md border px-3 py-2 grid gap-2 text-sm ${isException ? "border-amber-500/50 bg-amber-50 dark:bg-amber-950/20" : overThreshold ? "border-destructive/40 bg-destructive/5" : "border-border"}`}
                    >
                      {/* Product + location header */}
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          {product?.name && <p className="font-medium truncate">{product.name}</p>}
                          {product?.sku && <p className="font-mono text-xs text-muted-foreground">{product.sku}</p>}
                          {loc?.code && <p className="text-xs text-muted-foreground">Location: {loc.code}</p>}
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          {overThreshold && (
                            <Badge variant="destructive" className="text-xs">
                              {variance > 0 ? "+" : ""}{variance} ({varPct.toFixed(1)}%)
                            </Badge>
                          )}
                          <Badge variant={statusBadgeVariant(line.status)} className="text-xs">{line.status}</Badge>
                        </div>
                      </div>

                      {/* Count input */}
                      {!isException && (
                        <div className="flex items-center gap-2">
                          <span className="text-muted-foreground shrink-0">Expected {formatNumber(line.expected_quantity)}</span>
                          <Input
                            className="w-28"
                            defaultValue={counted}
                            type="number"
                            onBlur={(e) => {
                              const val = Number(e.target.value);
                              if (!isNaN(val)) submitMutation.mutate({ lineId: line.id, quantity: val });
                            }}
                          />
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-amber-600 hover:text-amber-700 hover:bg-amber-50"
                            title="Flag as unable to count"
                            onClick={() => setExState((s) => ({ ...s, [line.id]: { open: true, reason: "" } }))}
                          >
                            <AlertTriangle className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      )}
                      {isException && (
                        <p className="text-xs text-amber-700 dark:text-amber-400">
                          <AlertTriangle className="inline mr-1 h-3 w-3" />
                          {(line as any).notes ?? "Flagged — supervisor review required"}
                        </p>
                      )}

                      {/* Exception panel */}
                      {es.open && (
                        <div className="rounded border border-amber-400/40 bg-amber-50 dark:bg-amber-950/30 p-2 grid gap-2">
                          <p className="text-xs font-medium text-amber-800 dark:text-amber-300">Why can't this line be counted?</p>
                          <Input
                            placeholder="e.g. Location blocked, pallet damaged, goods in use"
                            value={es.reason}
                            onChange={(e) => setExState((s) => ({ ...s, [line.id]: { ...es, reason: e.target.value } }))}
                          />
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              className="border-amber-500 text-amber-700"
                              disabled={!es.reason.trim() || exceptionMutation.isPending}
                              onClick={() => exceptionMutation.mutate({ lineId: line.id, reason: es.reason })}
                            >
                              Flag exception
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setExState((s) => ({ ...s, [line.id]: { open: false, reason: "" } }))}
                            >
                              Cancel
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
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
              {done.map((c: any) => (
                <div key={c.id} className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm opacity-60">
                  <span className="font-mono text-xs">{c.count_number}</span>
                  <Badge variant={statusBadgeVariant(c.status)} className="text-xs">{c.status}</Badge>
                </div>
              ))}
            </div>
          </details>
        )}
      </div>
    </div>
  );
}

// ── Location Moves Page ────────────────────────────────────────────────────────
