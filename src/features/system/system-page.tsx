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
} from "@/features/shared/ui-shared";

export function SystemLogPage() {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const sourceFilter = searchParams.get("source") ?? "";
  const [view, setView] = useState<"active" | "archived">("active");
  const [logType, setLogType] = useState("all");
  const [severity, setSeverity] = useState("all");
  const [showResolved, setShowResolved] = useState(false);
  const { data: logs = [], error: logsError, isLoading } = useQuery({
    queryKey: ["system-logs", logType, severity, sourceFilter, showResolved],
    queryFn: () => listSystemLogs({ log_type: logType === "all" ? undefined : logType, severity: severity === "all" ? undefined : severity, source: sourceFilter || undefined, resolved: showResolved ? undefined : false }),
    meta: { suppressGlobalError: true },
    enabled: view === "active",
  });

  const { data: archivedLogs = [], error: archivedLogsError, isLoading: archivedLoading } = useQuery({
    queryKey: ["system-logs-archive", logType, severity],
    queryFn: () => listArchivedSystemLogs({ log_type: logType === "all" ? undefined : logType, severity: severity === "all" ? undefined : severity }),
    meta: { suppressGlobalError: true },
    enabled: view === "archived",
  });
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
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-2xl font-semibold">System Log</h2>
          <p className="text-sm text-muted-foreground">Software errors, bugs, system changes, infrastructure events, and record count snapshots. Archived entries are permanently deleted after 120 days.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {view === "active" ? (
            <>
              <Button variant="outline" onClick={() => snapshotMutation.mutate()} disabled={snapshotMutation.isPending}>
                {snapshotMutation.isPending ? <Loader2 className="animate-spin" /> : <RotateCcw data-icon="inline-start" />}
                Snapshot counts
              </Button>
              <Button variant="outline" onClick={() => setArchiveDialogOpen(true)}>
                <Archive data-icon="inline-start" />
                Archive old logs
              </Button>
              <Button onClick={() => setAddOpen(true)}>
                <Plus data-icon="inline-start" />
                Add entry
              </Button>
            </>
          ) : null}
        </div>
      </div>
      <Tabs value={view} onValueChange={(v) => setView(v as "active" | "archived")}>
        <TabsList>
          <TabsTrigger value="active">Active</TabsTrigger>
          <TabsTrigger value="archived">
            <ArchiveRestore data-icon="inline-start" />
            Archived
          </TabsTrigger>
        </TabsList>
      </Tabs>
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
      <Card>
        <CardContent className="grid gap-3 p-4 sm:grid-cols-[1fr_1fr_auto]">
          <Select onValueChange={setLogType} value={logType}>

            <SelectTrigger><SelectValue placeholder="All types" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              {["error", "bug", "system_change", "infrastructure", "record_count", "info"].map((t) => (
                <SelectItem key={t} value={t}>{t.replace("_", " ")}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select onValueChange={setSeverity} value={severity}>
            <SelectTrigger><SelectValue placeholder="All severities" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All severities</SelectItem>
              {["debug", "info", "warning", "error", "critical"].map((s) => (
                <SelectItem key={s} value={s}>{s}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {view === "active" ? (
            <div className="flex items-center gap-2">
              <Checkbox checked={showResolved} onCheckedChange={(v) => setShowResolved(Boolean(v))} id="show-resolved" />
              <label htmlFor="show-resolved" className="cursor-pointer text-sm">Show resolved</label>
            </div>
          ) : <div />}
        </CardContent>
      </Card>
      {view === "active" ? (
      <Card>
        <CardContent className="p-0">
          <TableFrame>
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
                ) : logs.length === 0 ? (
                  <TableRow><TableCell colSpan={8} className="h-24 text-center text-muted-foreground">No log entries found.</TableCell></TableRow>
                ) : logs.map((log: any) => (
                  <TableRow key={log.id} className={cn("even:bg-muted/30", log.resolved ? "opacity-50" : "")}>
                    <TableCell><Badge variant="outline">{log.log_type.replace("_", " ")}</Badge></TableCell>
                    <TableCell><Badge variant={severityVariant(log.severity)}>{log.severity}</Badge></TableCell>
                    <TableCell>
                      <p className="font-medium leading-tight">{log.title}</p>
                      {log.message ? <p className="text-xs text-muted-foreground">{log.message}</p> : null}
                      {log.details ? (
                        <details className="mt-2 max-w-2xl rounded border bg-muted/40 p-2 text-xs">
                          <summary className="cursor-pointer select-none font-medium text-muted-foreground">
                            Developer detail
                          </summary>
                          <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-all font-mono text-[10px] leading-relaxed">
                            {formatDetails(log.details)}
                          </pre>
                        </details>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{log.source ?? "—"}</TableCell>
                    <TableCell className="font-mono text-sm">{log.table_name ?? "—"}</TableCell>
                    <TableCell className="text-right font-mono text-sm">{log.record_count != null ? formatNumber(log.record_count) : "—"}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{formatDate(log.created_at)}</TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-1">
                        {log.resolved ? (
                          <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
                        ) : (
                          <Button size="sm" variant="ghost" title="Resolve" onClick={() => resolveMutation.mutate(log.id)}>
                            <CheckCircle2 className="h-4 w-4" />
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="ghost"
                          title="Archive"
                          onClick={() => archiveMutation.mutate(log.id)}
                          disabled={archiveMutation.isPending}
                        >
                          <Archive className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableFrame>
        </CardContent>
      </Card>
      ) : (
      <Card>
        <CardContent className="p-0">
          <TableFrame>
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
                ) : archivedLogs.length === 0 ? (
                  <TableRow><TableCell colSpan={8} className="h-24 text-center text-muted-foreground">No archived log entries.</TableCell></TableRow>
                ) : archivedLogs.map((log: any) => (
                  <TableRow key={log.id} className="even:bg-muted/30 opacity-80">
                    <TableCell><Badge variant="outline">{log.log_type.replace("_", " ")}</Badge></TableCell>
                    <TableCell><Badge variant={severityVariant(log.severity)}>{log.severity}</Badge></TableCell>
                    <TableCell>
                      <p className="font-medium leading-tight">{log.title}</p>
                      {log.message ? <p className="text-xs text-muted-foreground">{log.message}</p> : null}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{log.source ?? "—"}</TableCell>
                    <TableCell className="font-mono text-sm">{log.table_name ?? "—"}</TableCell>
                    <TableCell className="text-right font-mono text-sm">{log.record_count != null ? formatNumber(log.record_count) : "—"}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{formatDate(log.created_at)}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{formatDate(log.archived_at)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
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
  const { data: rows = [], isLoading, refetch, isFetching } = useQuery({
    queryKey: ["email-send-log"],
    queryFn: async () => {
      const { data, error } = await supabase.from("email_send_log" as any).select("id,message_id,template_name,recipient_email,status,error_message,created_at").order("created_at", { ascending: false }).limit(500);
      if (error) throw error;
      return data ?? [];
    },
  });
  const filtered = (rows as any[]).filter((row) => {
    if (status !== "all" && row.status !== status) return false;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      if (!row.recipient_email.toLowerCase().includes(q) && !row.template_name.toLowerCase().includes(q) && !(row.message_id ?? "").toLowerCase().includes(q) && !(row.error_message ?? "").toLowerCase().includes(q)) return false;
    }
    return true;
  });
  const counts = (rows as any[]).reduce((acc: any, row: any) => { acc.total += 1; acc[row.status] = (acc[row.status] ?? 0) + 1; return acc; }, { total: 0 });
  const statusVariant = (s: string): "default" | "secondary" | "destructive" | "outline" =>
    s === "sent" ? "default" : s === "failed" || s === "dlq" || s === "bounced" ? "destructive" : s === "pending" || s === "rate_limited" ? "secondary" : "outline";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-2xl font-semibold">Email Log</h2>
          <p className="text-sm text-muted-foreground">Recent email send attempts with statuses and error messages for troubleshooting.</p>
        </div>
        <Button variant="outline" onClick={() => refetch()} disabled={isFetching}>
          {isFetching ? <Loader2 className="animate-spin" /> : <RotateCcw data-icon="inline-start" />}
          Refresh
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {[{ label: "Total", value: counts.total ?? 0 }, { label: "Sent", value: counts.sent ?? 0 }, { label: "Pending", value: counts.pending ?? 0 }, { label: "Failed", value: (counts.failed ?? 0) + (counts.dlq ?? 0) }, { label: "Suppressed", value: counts.suppressed ?? 0 }].map((item) => (
          <Card key={item.label}>
            <CardContent className="p-4">
              <p className="text-xs uppercase text-muted-foreground">{item.label}</p>
              <p className="text-2xl font-semibold">{formatNumber(item.value)}</p>
            </CardContent>
          </Card>
        ))}
      </div>
      <Card>
        <CardContent className="grid gap-3 p-4 sm:grid-cols-[1fr_1fr]">
          <Select onValueChange={setStatus} value={status}>
            <SelectTrigger><SelectValue placeholder="All statuses" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {["pending", "sent", "failed", "dlq", "rate_limited", "suppressed", "bounced", "complained"].map((s) => (
                <SelectItem key={s} value={s}>{s}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input type="search" className="pl-10" placeholder="Search recipient, template, message id, error…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-0">
          <TableFrame>
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
                ) : filtered.map((row: any) => (
                  <TableRow key={row.id} className="even:bg-muted/30 align-top">
                    <TableCell><Badge variant={statusVariant(row.status)}>{row.status}</Badge></TableCell>
                    <TableCell className="font-mono text-xs">{row.template_name}</TableCell>
                    <TableCell className="text-sm">{row.recipient_email}</TableCell>
                    <TableCell className="max-w-md text-xs text-destructive">
                      {row.error_message ? <span title={row.error_message} className="block break-words">{row.error_message}</span> : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{row.message_id ?? "—"}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{formatDate(row.created_at)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableFrame>
        </CardContent>
      </Card>
    </div>
  );
}
