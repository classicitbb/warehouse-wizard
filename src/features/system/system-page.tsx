import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QRCodeSVG } from "qrcode.react";
import { Link, NavLink, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm, type UseFormReturn } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { supabase } from "@/integrations/supabase/client";
import { Activity, AlertCircle, AlertTriangle, Archive, ArchiveRestore, ArrowLeftRight, BarChart3, Bot, Boxes, Building2, CheckCircle2, ChevronDown, ClipboardCheck, ClipboardList, CloudOff, Download, Eye, EyeOff, FileDown, Forklift, GripVertical, HelpCircle, Home, Info, KeyRound, LayoutDashboard, Loader2, Lock, LockOpen, LogOut, Mail, Maximize2, MapPinned, Menu, Minimize2, Network, Package, PackageX, PanelLeftClose, PanelLeftOpen, Pencil, Plus, Printer, QrCode, RadioTower, RefreshCw, RotateCcw, Search, Settings, ShieldCheck, Star, Tags, Trash2, Truck, Upload, UserPlus, Users } from "lucide-react";
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
  listArchivedSystemLogs,
  archiveSystemLog,
  archiveSystemLogsOlderThan,
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


import { TableFrame } from "@/features/shared/resource-forms";

// Same cell density as the Products table; System Log and Email Log follow the
// Products page layout like the other Setup pages.
const LOG_CELL = "px-4 py-1 text-xs leading-tight";

export function SystemLogPage() {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const sourceFilter = searchParams.get("source") ?? "";
  const [view, setView] = useState<"active" | "archived">("active");
  const [logType, setLogType] = useState("all");
  const [severity, setSeverity] = useState("all");
  const [showResolved, setShowResolved] = useState(false);
  // Shared auto-load-on-scroll paging: 50 entries per page, extended as the
  // operator scrolls, instead of one fixed 500-row read.
  const paging = useInfiniteRows({ resetKeys: [view, logType, severity, sourceFilter, showResolved] });
  const { data: logs = [], error: logsError, isLoading, isFetching } = useQuery({
    queryKey: ["system-logs", logType, severity, sourceFilter, showResolved, paging.limit],
    queryFn: () => listSystemLogs({ log_type: logType === "all" ? undefined : logType, severity: severity === "all" ? undefined : severity, source: sourceFilter || undefined, resolved: showResolved ? undefined : false, limit: paging.limit + 1 }),
    meta: { suppressGlobalError: true },
    enabled: view === "active",
    placeholderData: (previous) => previous,
  });

  const { data: archivedLogs = [], error: archivedLogsError, isLoading: archivedLoading, isFetching: archivedFetching } = useQuery({
    queryKey: ["system-logs-archive", logType, severity, paging.limit],
    queryFn: () => listArchivedSystemLogs({ log_type: logType === "all" ? undefined : logType, severity: severity === "all" ? undefined : severity, limit: paging.limit + 1 }),
    meta: { suppressGlobalError: true },
    enabled: view === "archived",
    placeholderData: (previous) => previous,
  });
  const activeRows = view === "archived" ? archivedLogs : logs;
  const hasMoreLogs = paging.sync({
    loadedCount: activeRows.length,
    isFetching: view === "archived" ? archivedFetching : isFetching,
  });
  const visibleLogs = (logs as any[]).slice(0, paging.limit);
  const visibleArchivedLogs = (archivedLogs as any[]).slice(0, paging.limit);
  // Client-side search over the loaded entries, like the Products search bar.
  const [logSearch, setLogSearch] = useState("");
  const matchesLogSearch = (log: any) => {
    const q = logSearch.trim().toLowerCase();
    if (!q) return true;
    return [log.title, log.message, log.source, log.table_name, log.log_type, log.severity]
      .some((value) => typeof value === "string" && value.toLowerCase().includes(q));
  };
  const shownLogs = visibleLogs.filter(matchesLogSearch);
  const shownArchivedLogs = visibleArchivedLogs.filter(matchesLogSearch);
  const logsFetching = view === "archived" ? archivedFetching : isFetching;
  const loadMoreLogsFooter = hasMoreLogs ? (
    <div className="pointer-events-none sticky bottom-3 left-0 flex w-full justify-center">
      <Button type="button" variant="secondary" className="pointer-events-auto shadow-md" onClick={paging.loadMore} disabled={logsFetching}>
        {logsFetching ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Loading more…
          </>
        ) : (
          "Load 50 more"
        )}
      </Button>
    </div>
  ) : null;
  const resolveMutation = useMutation({
    mutationFn: resolveSystemLog,
    onSuccess: () => { toast.success("Log entry resolved"); queryClient.invalidateQueries({ queryKey: ["system-logs"] }); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to resolve"),
  });
  const snapshotMutation = useMutation({
    mutationFn: snapshotRecordCounts,
    onSuccess: (rows) => { toast.success(`Record count snapshot saved for ${rows.length} tables`); queryClient.invalidateQueries({ queryKey: ["system-logs"] }); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Snapshot failed"),
  });
  const addMutation = useMutation({
    mutationFn: (values: { log_type: string; severity: string; title: string; message: string }) =>
      writeSystemLog({ log_type: values.log_type as Parameters<typeof writeSystemLog>[0]["log_type"], severity: values.severity as Parameters<typeof writeSystemLog>[0]["severity"], title: values.title, message: values.message, source: "manual" }),
    onSuccess: () => { toast.success("Log entry created"); queryClient.invalidateQueries({ queryKey: ["system-logs"] }); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Log failed"),
  });
  const archiveMutation = useMutation({
    mutationFn: archiveSystemLog,
    onSuccess: () => {
      toast.success("Log entry archived");
      queryClient.invalidateQueries({ queryKey: ["system-logs"] });
      queryClient.invalidateQueries({ queryKey: ["system-logs-archive"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to archive"),
  });
  const [archiveDialogOpen, setArchiveDialogOpen] = useState(false);
  const [archiveDays, setArchiveDays] = useState(90);
  const bulkArchiveMutation = useMutation({
    mutationFn: (days: number) => archiveSystemLogsOlderThan(days),
    onSuccess: (count) => {
      toast.success(count > 0 ? `Archived ${count} log entr${count === 1 ? "y" : "ies"}` : "No log entries were old enough to archive");
      queryClient.invalidateQueries({ queryKey: ["system-logs"] });
      queryClient.invalidateQueries({ queryKey: ["system-logs-archive"] });
      setArchiveDialogOpen(false);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Bulk archive failed"),
  });
  const [addOpen, setAddOpen] = useState(false);
  const form = useForm({ defaultValues: { title: "", message: "", log_type: "system_change", severity: "info" } });
  const severityVariant = (s: string): "default" | "secondary" | "destructive" | "outline" =>
    s === "critical" || s === "error" ? "destructive" : s === "warning" ? "secondary" : "default";
  const formatDetails = (details: unknown) => {
    try {
      return JSON.stringify(details, null, 2);
    } catch {
      return String(details);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="flex items-start justify-between gap-3 md:items-end">
        <div className="min-w-0">
          <h2 className="text-2xl font-semibold">System Log</h2>
          <p className="text-sm text-muted-foreground">Software errors, bugs, system changes, infrastructure events, and record count snapshots. Archived entries are permanently deleted after 120 days.</p>
        </div>
        {view === "active" ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon" variant="outline" className="shrink-0" aria-label="System Log actions">
                {snapshotMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Settings className="h-4 w-4" />}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem disabled={snapshotMutation.isPending} onSelect={() => snapshotMutation.mutate()}>
                <RotateCcw className="mr-2 h-4 w-4" />
                Snapshot counts
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setArchiveDialogOpen(true)}>
                <Archive className="mr-2 h-4 w-4" />
                Archive old logs
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setAddOpen(true)}>
                <Plus className="mr-2 h-4 w-4" />
                Add entry
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="h-9 bg-muted pl-9 pr-20"
          placeholder="Search system log…"
          value={logSearch}
          onChange={(e) => setLogSearch(e.target.value)}
          aria-label="Search system log"
        />
        <RecordCount
          className="absolute right-3 top-1/2 -translate-y-1/2"
          isLoading={view === "archived" ? archivedLoading : isLoading}
          isFiltering={Boolean(logSearch.trim())}
          visible={(view === "archived" ? shownArchivedLogs : shownLogs).length}
        />
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <Button size="sm" variant={view === "active" ? "default" : "outline"} className="h-7 px-2.5 text-xs" onClick={() => setView("active")}>
          Active
        </Button>
        <Button size="sm" variant={view === "archived" ? "default" : "outline"} className="h-7 px-2.5 text-xs" onClick={() => setView("archived")}>
          <ArchiveRestore className="mr-1 h-3.5 w-3.5" />
          Archived
        </Button>
        <Select onValueChange={setLogType} value={logType}>
          <SelectTrigger className="h-7 w-36 text-xs" aria-label="Log type"><SelectValue placeholder="All types" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            {["error", "bug", "system_change", "infrastructure", "record_count", "info"].map((t) => (
              <SelectItem key={t} value={t}>{t.replace("_", " ")}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select onValueChange={setSeverity} value={severity}>
          <SelectTrigger className="h-7 w-36 text-xs" aria-label="Severity"><SelectValue placeholder="All severities" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All severities</SelectItem>
            {["debug", "info", "warning", "error", "critical"].map((s) => (
              <SelectItem key={s} value={s}>{s}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {view === "active" ? (
          <Button size="sm" variant={showResolved ? "default" : "outline"} className="h-7 px-2.5 text-xs" onClick={() => setShowResolved((current) => !current)}>
            Show resolved
          </Button>
        ) : null}
        {logType !== "all" || severity !== "all" || showResolved ? (
          <Button size="sm" variant="ghost" className="h-7 px-2.5 text-xs text-muted-foreground" onClick={() => { setLogType("all"); setSeverity("all"); setShowResolved(false); }}>
            Clear all
          </Button>
        ) : null}
      </div>
      {sourceFilter ? (
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Filtered to source</span>
          <Badge variant="outline" className="font-mono">{sourceFilter}</Badge>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs"
            onClick={() => {
              const next = new URLSearchParams(searchParams);
              next.delete("source");
              setSearchParams(next, { replace: true });
            }}
          >
            Clear
          </Button>
        </div>
      ) : null}
      {view === "active" ? (
      <Card className="flex min-h-0 flex-1 flex-col">
        <CardContent className="flex min-h-0 flex-1 flex-col p-0">
          <TableFrame className="h-full">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-card">
                <TableRow>
                  <TableHead className="w-32">Type</TableHead>
                  <TableHead className="w-24">Severity</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead className="w-24">Table</TableHead>
                  <TableHead className="w-24 text-right">Count</TableHead>
                  <TableHead className="w-32">Date</TableHead>
                  <TableHead className="w-28" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow><TableCell colSpan={8} className="h-24 text-center text-muted-foreground">Loading logs…</TableCell></TableRow>
                ) : logsError ? (
                  <TableRow>
                    <TableCell colSpan={8} className="h-24 text-center">
                      <div className="mx-auto max-w-2xl space-y-2">
                        <p className="font-medium text-destructive">System logs could not be loaded.</p>
                        <p className="text-xs text-muted-foreground">
                          {logsError instanceof Error ? logsError.message : String(logsError)}
                        </p>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : shownLogs.length === 0 ? (
                  <TableRow><TableCell colSpan={8} className="h-24 text-center text-muted-foreground">No log entries found.</TableCell></TableRow>
                ) : shownLogs.map((log: any) => (
                  <TableRow key={log.id} className={cn("even:bg-muted/30", log.resolved ? "opacity-50" : "")}>
                    <TableCell className={LOG_CELL}><Badge variant="outline">{log.log_type.replace("_", " ")}</Badge></TableCell>
                    <TableCell className={LOG_CELL}><Badge variant={severityVariant(log.severity)}>{log.severity}</Badge></TableCell>
                    <TableCell className={LOG_CELL}>
                      <p className="max-w-2xl truncate font-medium" title={log.title}>{log.title}</p>
                      {log.message ? <p className="max-w-2xl truncate text-muted-foreground" title={log.message}>{log.message}</p> : null}
                      {log.details ? (
                        <details className="max-w-2xl text-xs">
                          <summary className="cursor-pointer select-none text-muted-foreground hover:text-foreground">
                            Developer detail
                          </summary>
                          <pre className="mt-1 max-h-72 overflow-auto whitespace-pre-wrap break-all rounded border bg-muted/40 p-2 font-mono text-[10px] leading-relaxed">
                            {formatDetails(log.details)}
                          </pre>
                        </details>
                      ) : null}
                    </TableCell>
                    <TableCell className={`${LOG_CELL} text-muted-foreground`}>{log.source ?? "—"}</TableCell>
                    <TableCell className={`${LOG_CELL} font-mono`}>{log.table_name ?? "—"}</TableCell>
                    <TableCell className={`${LOG_CELL} text-right font-mono`}>{log.record_count != null ? formatNumber(log.record_count) : "—"}</TableCell>
                    <TableCell className={`${LOG_CELL} whitespace-nowrap text-muted-foreground`}>{formatDate(log.created_at)}</TableCell>
                    <TableCell className={LOG_CELL}>
                      <div className="flex items-center justify-end gap-1">
                        {log.resolved ? (
                          <CheckCircle2 className="h-3.5 w-3.5 text-muted-foreground" />
                        ) : (
                          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" title="Resolve" onClick={() => resolveMutation.mutate(log.id)}>
                            <CheckCircle2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 w-7 p-0"
                          title="Archive"
                          onClick={() => archiveMutation.mutate(log.id)}
                          disabled={archiveMutation.isPending}
                        >
                          <Archive className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div ref={paging.sentinelRef} aria-hidden className="h-px w-full" />
            {loadMoreLogsFooter}
          </TableFrame>
        </CardContent>
      </Card>
      ) : (
      <Card className="flex min-h-0 flex-1 flex-col">
        <CardContent className="flex min-h-0 flex-1 flex-col p-0">
          <TableFrame className="h-full">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-card">
                <TableRow>
                  <TableHead className="w-32">Type</TableHead>
                  <TableHead className="w-24">Severity</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead className="w-24">Table</TableHead>
                  <TableHead className="w-24 text-right">Count</TableHead>
                  <TableHead className="w-32">Created</TableHead>
                  <TableHead className="w-32">Archived</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {archivedLoading ? (
                  <TableRow><TableCell colSpan={8} className="h-24 text-center text-muted-foreground">Loading archive…</TableCell></TableRow>
                ) : archivedLogsError ? (
                  <TableRow>
                    <TableCell colSpan={8} className="h-24 text-center">
                      <div className="mx-auto max-w-2xl space-y-2">
                        <p className="font-medium text-destructive">Archived logs could not be loaded.</p>
                        <p className="text-xs text-muted-foreground">
                          {archivedLogsError instanceof Error ? archivedLogsError.message : String(archivedLogsError)}
                        </p>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : shownArchivedLogs.length === 0 ? (
                  <TableRow><TableCell colSpan={8} className="h-24 text-center text-muted-foreground">No archived log entries.</TableCell></TableRow>
                ) : shownArchivedLogs.map((log: any) => (
                  <TableRow key={log.id} className="even:bg-muted/30 opacity-80">
                    <TableCell className={LOG_CELL}><Badge variant="outline">{log.log_type.replace("_", " ")}</Badge></TableCell>
                    <TableCell className={LOG_CELL}><Badge variant={severityVariant(log.severity)}>{log.severity}</Badge></TableCell>
                    <TableCell className={LOG_CELL}>
                      <p className="font-medium">{log.title}</p>
                      {log.message ? <p className="max-w-2xl truncate text-muted-foreground" title={log.message}>{log.message}</p> : null}
                    </TableCell>
                    <TableCell className={`${LOG_CELL} text-muted-foreground`}>{log.source ?? "—"}</TableCell>
                    <TableCell className={`${LOG_CELL} font-mono`}>{log.table_name ?? "—"}</TableCell>
                    <TableCell className={`${LOG_CELL} text-right font-mono`}>{log.record_count != null ? formatNumber(log.record_count) : "—"}</TableCell>
                    <TableCell className={`${LOG_CELL} whitespace-nowrap text-muted-foreground`}>{formatDate(log.created_at)}</TableCell>
                    <TableCell className={`${LOG_CELL} whitespace-nowrap text-muted-foreground`}>{formatDate(log.archived_at)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div ref={paging.sentinelRef} aria-hidden className="h-px w-full" />
            {loadMoreLogsFooter}
          </TableFrame>
        </CardContent>
      </Card>
      )}
      <Dialog open={archiveDialogOpen} onOpenChange={setArchiveDialogOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Archive old logs</DialogTitle>
            <DialogDescription>Move active log entries older than the cutoff into the archive. Archived entries are permanently deleted after 120 days.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <label htmlFor="archive-days" className="text-sm font-medium">Older than (days)</label>
            <Input
              id="archive-days"
              type="number"
              min={0}
              value={archiveDays}
              onChange={(e) => setArchiveDays(Math.max(0, Number(e.target.value) || 0))}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setArchiveDialogOpen(false)}>Cancel</Button>
            <Button onClick={() => bulkArchiveMutation.mutate(archiveDays)} disabled={bulkArchiveMutation.isPending}>
              {bulkArchiveMutation.isPending ? <Loader2 className="animate-spin" /> : <Archive data-icon="inline-start" />}
              Archive
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add log entry</DialogTitle>
            <DialogDescription>Manually record a system change, bug, or infrastructure event.</DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form className="grid gap-4" onSubmit={form.handleSubmit((values) => addMutation.mutate(values, { onSuccess: () => { form.reset(); setAddOpen(false); } }))}>
              <FormField control={form.control} name="log_type" render={({ field }) => (
                <FormItem>
                  <FormLabel>Type</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value ?? "system_change"}>
                    <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                    <SelectContent>
                      {["error", "bug", "system_change", "infrastructure", "info"].map((t) => (
                        <SelectItem key={t} value={t}>{t.replace("_", " ")}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="severity" render={({ field }) => (
                <FormItem>
                  <FormLabel>Severity</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value ?? "info"}>
                    <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                    <SelectContent>
                      {["debug", "info", "warning", "error", "critical"].map((s) => (
                        <SelectItem key={s} value={s}>{s}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="title" render={({ field }) => (
                <FormItem>
                  <FormLabel>Title</FormLabel>
                  <FormControl><Input {...field} placeholder="Brief summary of the event" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="message" render={({ field }) => (
                <FormItem>
                  <FormLabel>Details (optional)</FormLabel>
                  <FormControl><Textarea {...field} rows={3} placeholder="Full description, steps to reproduce, or change notes" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <Button type="submit" disabled={addMutation.isPending}>
                {addMutation.isPending ? <Loader2 className="animate-spin" /> : null}
                Save entry
              </Button>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function EmailLogPage() {
  const [status, setStatus] = useState("all");
  const [search, setSearch] = useState("");
  const isFiltering = Boolean(search.trim()) || status !== "all";
  const paging = useInfiniteRows({ resetKeys: [status, search.trim()] });
  // Filtering happens client-side, so a filtered view must read a wide window
  // rather than only the newest page — otherwise older matches are invisible.
  const queryLimit = isFiltering ? 500 : paging.limit + 1;
  const { data: rows = [], isLoading, refetch, isFetching } = useQuery({
    queryKey: ["email-send-log", queryLimit],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("email_send_log" as any)
        .select("id,message_id,template_name,recipient_email,status,error_message,created_at")
        .order("created_at", { ascending: false })
        .limit(queryLimit);
      if (error) throw error;
      return data ?? [];
    },
    placeholderData: (previous) => previous,
  });
  const hasMoreEmails = paging.sync({ loadedCount: (rows as any[]).length, isFetching, enabled: !isFiltering });
  // Only needed while browsing — a filtered view renders every match it holds,
  // so the rendered count is already the number to report.
  const { data: totalEmailCount } = useQuery({
    queryKey: ["email-send-log", "count"],
    queryFn: async () => {
      const { count, error } = await supabase
        .from("email_send_log" as any)
        .select("id", { count: "exact", head: true });
      if (error) throw error;
      return count ?? 0;
    },
    enabled: !isFiltering,
  });

  // "failed" also covers messages moved to the dead-letter queue.
  const matchesStatus = (rowStatus: string) => status === "all" || rowStatus === status || (status === "failed" && rowStatus === "dlq");
  const filtered = (rows as any[]).filter((row) => {
    if (!matchesStatus(row.status)) return false;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      if (!row.recipient_email.toLowerCase().includes(q) && !row.template_name.toLowerCase().includes(q) && !(row.message_id ?? "").toLowerCase().includes(q) && !(row.error_message ?? "").toLowerCase().includes(q)) return false;
    }
    return true;
  });
  const renderedEmails = filtered.slice(0, isFiltering ? filtered.length : paging.limit);
  const counts = (rows as any[]).reduce((acc: any, row: any) => { acc.total += 1; acc[row.status] = (acc[row.status] ?? 0) + 1; return acc; }, { total: 0 });
  const statusVariant = (s: string): "default" | "secondary" | "destructive" | "outline" =>
    s === "sent" ? "default" : s === "failed" || s === "dlq" || s === "bounced" ? "destructive" : s === "pending" || s === "rate_limited" ? "secondary" : "outline";

  const statusFilters: Array<{ value: string; label: string; count: number }> = [
    { value: "sent", label: "Sent", count: counts.sent ?? 0 },
    { value: "pending", label: "Pending", count: counts.pending ?? 0 },
    { value: "failed", label: "Failed", count: (counts.failed ?? 0) + (counts.dlq ?? 0) },
    { value: "rate_limited", label: "Rate limited", count: counts.rate_limited ?? 0 },
    { value: "suppressed", label: "Suppressed", count: counts.suppressed ?? 0 },
    { value: "bounced", label: "Bounced", count: counts.bounced ?? 0 },
    { value: "complained", label: "Complained", count: counts.complained ?? 0 },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="flex items-start justify-between gap-3 md:items-end">
        <div className="min-w-0">
          <h2 className="text-2xl font-semibold">Email Log</h2>
          <p className="text-sm text-muted-foreground">Recent email send attempts with statuses and error messages for troubleshooting.</p>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="icon" variant="outline" className="shrink-0" aria-label="Email Log actions">
              {isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Settings className="h-4 w-4" />}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuItem disabled={isFetching} onSelect={() => void refetch()}>
              <RotateCcw className="mr-2 h-4 w-4" />
              Refresh
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input className="h-9 bg-muted pl-9 pr-20" placeholder="Search email log…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search email log" />
        <RecordCount
          className="absolute right-3 top-1/2 -translate-y-1/2"
          isLoading={isLoading}
          isFiltering={isFiltering}
          visible={renderedEmails.length}
          total={totalEmailCount ?? null}
        />
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {statusFilters.map((f) => (
          <Button
            key={f.value}
            size="sm"
            variant={status === f.value ? "default" : "outline"}
            className="h-7 px-2.5 text-xs"
            onClick={() => setStatus((current) => (current === f.value ? "all" : f.value))}
          >
            {f.label} <span className="ml-1 tabular-nums opacity-70">{formatNumber(f.count)}</span>
          </Button>
        ))}
        {status !== "all" ? (
          <Button size="sm" variant="ghost" className="h-7 px-2.5 text-xs text-muted-foreground" onClick={() => setStatus("all")}>
            Clear all
          </Button>
        ) : null}
      </div>
      <Card className="flex min-h-0 flex-1 flex-col">
        <CardContent className="flex min-h-0 flex-1 flex-col p-0">
          <TableFrame className="h-full">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-card">
                <TableRow>
                  <TableHead className="w-32">Status</TableHead>
                  <TableHead className="w-48">Template</TableHead>
                  <TableHead>Recipient</TableHead>
                  <TableHead>Error</TableHead>
                  <TableHead className="w-40">Message ID</TableHead>
                  <TableHead className="w-40">Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow><TableCell colSpan={6} className="h-24 text-center text-muted-foreground">Loading email log…</TableCell></TableRow>
                ) : filtered.length === 0 ? (
                  <TableRow><TableCell colSpan={6} className="h-24 text-center text-muted-foreground">No email log entries found.</TableCell></TableRow>
                ) : renderedEmails.map((row: any) => (
                  <TableRow key={row.id} className="even:bg-muted/30">
                    <TableCell className={LOG_CELL}><Badge variant={statusVariant(row.status)}>{row.status}</Badge></TableCell>
                    <TableCell className={`${LOG_CELL} font-mono`}>{row.template_name}</TableCell>
                    <TableCell className={LOG_CELL}>{row.recipient_email}</TableCell>
                    <TableCell className={`${LOG_CELL} max-w-md text-destructive`}>
                      {row.error_message ? <span title={row.error_message} className="block truncate">{row.error_message}</span> : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className={`${LOG_CELL} font-mono text-muted-foreground`}>{row.message_id ?? "—"}</TableCell>
                    <TableCell className={`${LOG_CELL} whitespace-nowrap text-muted-foreground`}>{formatDate(row.created_at)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div ref={paging.sentinelRef} aria-hidden className="h-px w-full" />
            {hasMoreEmails ? (
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
