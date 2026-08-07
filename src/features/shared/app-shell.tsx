import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QRCodeSVG } from "qrcode.react";
import { Link, NavLink, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm, type UseFormReturn } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { supabase } from "@/integrations/supabase/client";
import { Activity, AlertCircle, AlertTriangle, ArrowLeftRight, BarChart3, Bell, Bot, Boxes, Building2, CheckCircle2, ChevronDown, ClipboardCheck, ClipboardList, CloudOff, Download, Eye, EyeOff, FileDown, Forklift, GripVertical, HelpCircle, Home, Info, KeyRound, LayoutDashboard, Loader2, Lock, LockOpen, LogOut, Mail, Maximize2, MapPinned, Menu, Minimize2, Network, Package, PackageX, PanelLeftClose, PanelLeftOpen, Pencil, Plus, Printer, QrCode, RadioTower, RefreshCw, RotateCcw, Search, Settings, ShieldCheck, Star, Tags, Trash2, Truck, Upload, UserPlus, Users } from "lucide-react";
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
import { useNetworkStatus } from "@/hooks/use-network-status";
import { useBackgroundSync } from "@/hooks/use-background-sync";
import { useNotificationPermission } from "@/hooks/use-notification-permission";
import { useReorderAlertNotifications } from "@/hooks/use-reorder-alert-notifications";
import { isActiveWorkInProgress } from "@/lib/active-work";
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
import { CopilotPanel } from "@/features/copilot/copilot-panel";
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
  FailedTasksReminder,
  AccessRequestsBanner,
  ReorderAlertNotificationPrompt,
  navIcons,
  appTitle,
  ChangeOwnPasswordDialog,
  shouldRestrictToDefaultWarehouse,
} from "@/features/shared/ui-shared";

const OFFLINE_SYSTEM_LOG_SOURCE = "rf.offline_disconnect";
const OFFLINE_ALERT_CHALLENGE = "ACK";
const OFFLINE_ALERT_SESSION_KEY = "warehouseWizard.offlineAlert.current";

type OfflineSupervisorAlert = {
  id: string;
  title: string;
  message: string | null;
  created_at: string;
  source: string | null;
  details?: Record<string, unknown> | null;
};

type ReorderAlertBellRow = {
  id: string;
  available_quantity: number | null;
  recommended_quantity: number | null;
  created_at: string;
  products?: { sku: string | null; name: string | null } | null;
  warehouses?: { code: string | null; name: string | null } | null;
};

function readOfflineAlertSession() {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage.getItem(OFFLINE_ALERT_SESSION_KEY);
  } catch {
    return null;
  }
}

function writeOfflineAlertSession(value: string) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(OFFLINE_ALERT_SESSION_KEY, value);
  } catch {
    // ignore storage failures
  }
}

function clearOfflineAlertSession() {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(OFFLINE_ALERT_SESSION_KEY);
  } catch {
    // ignore storage failures
  }
}

function OfflineSupervisorAlertToastCard({
  alert,
  onAcknowledge,
}: {
  alert: OfflineSupervisorAlert;
  onAcknowledge: () => Promise<void>;
}) {
  const [challenge, setChallenge] = useState("");
  const [pending, setPending] = useState(false);

  return (
    <div className="w-[min(28rem,calc(100vw-2rem))] rounded-lg border border-red-500 bg-red-950 px-4 py-3 text-red-50 shadow-2xl">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-300" />
        <div className="min-w-0 flex-1">
          <p className="font-semibold">{alert.title}</p>
          <p className="mt-1 text-sm text-red-100">{alert.message ?? "A warehouse-floor device lost connectivity and is frozen for live commits."}</p>
          <p className="mt-2 text-xs text-red-200">
            Type <span className="font-mono font-semibold">{OFFLINE_ALERT_CHALLENGE}</span> to acknowledge and dismiss this alert.
          </p>
          <div className="mt-3 flex gap-2">
            <Input
              value={challenge}
              onChange={(event) => setChallenge(event.target.value.toUpperCase())}
              className="h-9 border-red-400/60 bg-red-900 text-red-50 placeholder:text-red-300"
              placeholder={OFFLINE_ALERT_CHALLENGE}
            />
            <Button
              type="button"
              size="sm"
              className="shrink-0 bg-red-100 text-red-950 hover:bg-red-200"
              disabled={pending || challenge.trim() !== OFFLINE_ALERT_CHALLENGE}
              onClick={async () => {
                setPending(true);
                try {
                  await onAcknowledge();
                } finally {
                  setPending(false);
                }
              }}
            >
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Acknowledge"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ProfileMenu({ initials, displayName, onSignOut, onRefresh }: { initials: string; displayName: string; onSignOut: () => void; onRefresh: () => void }) {
  const [pwOpen, setPwOpen] = useState(false);
  return (
    <div className="contents">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="flex items-center gap-2 rounded-lg border border-border bg-card/80 px-2.5 py-1.5 text-sm transition-colors hover:bg-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Avatar className="h-6 w-6">
              <AvatarFallback className="bg-primary/10 text-xs font-semibold text-primary">{initials}</AvatarFallback>
            </Avatar>
            <span className="hidden truncate text-xs font-medium sm:block">{displayName}</span>
            <ChevronDown className="h-3 w-3 text-muted-foreground" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuItem onSelect={onRefresh}>
            <RefreshCw className="mr-2 h-3.5 w-3.5" />
            Refresh
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={(event) => { event.preventDefault(); setPwOpen(true); }}>
            <KeyRound className="mr-2 h-3.5 w-3.5" />
            Change password
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => onSignOut()}>
            <LogOut className="mr-2 h-3.5 w-3.5" />
            Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ChangeOwnPasswordDialog open={pwOpen} onOpenChange={setPwOpen} hideTrigger />
    </div>
  );
}

function NotificationBell({
  alerts,
  offline,
  reorderAlerts,
  showReorder,
}: {
  alerts: OfflineSupervisorAlert[];
  offline: boolean;
  reorderAlerts: ReorderAlertBellRow[];
  showReorder: boolean;
}) {
  const connectivityCount = alerts.length + (offline ? 1 : 0);
  const reorderCount = showReorder ? reorderAlerts.length : 0;
  const notificationCount = connectivityCount + reorderCount;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          className="relative h-9 w-9"
          size="icon"
          variant="outline"
          aria-label={notificationCount ? `${notificationCount} notification${notificationCount === 1 ? "" : "s"}` : "Notifications"}
          title="Notifications"
        >
          <Bell className="h-4 w-4" />
          {notificationCount ? (
            <span
              className={cn(
                "absolute -right-1 -top-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[9px] font-semibold leading-none",
                connectivityCount
                  ? "bg-destructive text-destructive-foreground"
                  : "bg-amber-500 text-white",
              )}
            >
              {notificationCount > 9 ? "9+" : notificationCount}
            </span>
          ) : null}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[min(22rem,calc(100vw-1.5rem))] p-0">
        <div className="border-b border-border px-3 py-2">
          <p className="text-sm font-semibold">Notifications</p>
          <p className="text-xs text-muted-foreground">Connectivity and inventory alerts</p>
        </div>
        <div className="max-h-80 overflow-y-auto">
          <p className="bg-muted/50 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Connectivity</p>
          <div className="p-1">
            {connectivityCount === 0 ? (
              <p className="px-2 py-2 text-sm text-muted-foreground">No RF connectivity notifications.</p>
            ) : null}
            {offline ? (
              <div className="rounded-md bg-amber-500/10 px-3 py-2 text-sm">
                <p className="font-medium text-amber-900 dark:text-amber-100">This RF device is offline</p>
                <p className="mt-0.5 text-xs text-muted-foreground">Live warehouse commits are frozen until the backend connection is restored.</p>
              </div>
            ) : null}
            {alerts.map((alert) => (
              <div key={alert.id} className="rounded-md px-3 py-2 text-sm hover:bg-accent">
                <p className="font-medium">{alert.title}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{alert.message ?? "A warehouse-floor device lost connectivity and is frozen for live commits."}</p>
                <p className="mt-1 text-[11px] text-muted-foreground">{new Date(alert.created_at).toLocaleString()}</p>
              </div>
            ))}
          </div>
          {showReorder ? (
            <>
              <p className="border-t border-border bg-muted/50 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Reorder alerts</p>
              <div className="p-1">
                {reorderCount === 0 ? (
                  <p className="px-2 py-2 text-sm text-muted-foreground">No active reorder alerts.</p>
                ) : null}
                {reorderAlerts.map((alert) => (
                  <div key={alert.id} className="rounded-md px-3 py-2 text-sm hover:bg-accent">
                    <p className="font-medium">{alert.products?.sku ?? "Product"}{alert.products?.name ? ` — ${alert.products.name}` : ""}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {alert.warehouses?.code ?? alert.warehouses?.name ?? "Warehouse"} · {Number(alert.available_quantity ?? 0)} available · replenish {Number(alert.recommended_quantity ?? 0)}
                    </p>
                    <p className="mt-1 text-[11px] text-muted-foreground">{new Date(alert.created_at).toLocaleString()}</p>
                  </div>
                ))}
              </div>
            </>
          ) : null}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function OfflineFreezeBadge({ compact = false }: { compact?: boolean }) {
  const { online } = useNetworkStatus();
  if (online) return null;
  return (
    <div
      className={cn(
        "inline-flex h-9 items-center gap-1.5 rounded-md border border-amber-400/60 bg-amber-50 px-3 text-sm font-medium text-amber-900 dark:bg-amber-950/40 dark:text-amber-100",
        compact && "px-2 text-[11px]",
      )}
      title="This device is offline. Live warehouse commits are frozen until reconnect."
    >
      <CloudOff className="h-3.5 w-3.5" />
      <span className={cn(compact && "hidden sm:inline")}>Offline</span>
      {!compact ? <span className="text-xs opacity-80">commits frozen</span> : null}
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const { pathname } = useLocation();
  const { profile, roles, signOut, user, refreshProfile } = useAuth();
  const { toPath } = useTenantPath();
  const queryClient = useQueryClient();
  const { isEnabled } = useFeatureFlags();
  const networkStatus = useNetworkStatus();
  const { online } = networkStatus;
  // Older narrow test doubles and frozen consumers return only `online`.
  // Treat that shape as already confirmed while production waits for the
  // live-service retry in useNetworkStatus.
  const connectionConfirmed = networkStatus.confirmed ?? true;
  useBackgroundSync(queryClient);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [reconnectRefreshing, setReconnectRefreshing] = useState(false);
  const networkStatusSeenRef = useRef(false);
  const shownOfflineAlertIdsRef = useRef<Set<string>>(new Set());
  const flushingOfflineAlertRef = useRef(false);

  // The desktop/landscape rail has a persistent preference, while the mobile
  // drawer is deliberately transient. A layout change or route change must
  // never reopen a stale mobile drawer or inherit the icon-only rail state.
  useEffect(() => {
    const desktopLandscape = window.matchMedia("(min-width: 1024px) and (orientation: landscape)");
    const closeMobileDrawer = () => setMobileMenuOpen(false);
    desktopLandscape.addEventListener("change", closeMobileDrawer);
    return () => desktopLandscape.removeEventListener("change", closeMobileDrawer);
  }, []);

  useEffect(() => {
    setMobileMenuOpen(false);
  }, [pathname]);
  const items = NAVIGATION
    .filter(
      (item) =>
        item.roles.some((role) => roles.includes(role)) &&
        (!item.moduleKey || isEnabled(item.moduleKey as ModuleKey)),
    )
    // Settings and Help stay pinned below the module list.
    .sort((a, b) => {
      const pinnedOrder: Partial<Record<AppRoute, number>> = { "/settings": 1, "/help": 2 };
      return (pinnedOrder[a.to] ?? 0) - (pinnedOrder[b.to] ?? 0);
    });
  const canAccessPutaway = items.some((item) => item.to === "/putaway-tasks");
  const canAccessReceiving = items.some((item) => item.to === "/receiving");
  const canAccessPickLists = items.some((item) => item.to === "/pick-lists");
  const canSeeAllPutawayTasks = roles.some((role) => ["developer", "admin", "warehouse_manager", "warehouse_supervisor"].includes(role));
  const putawayUserId = canSeeAllPutawayTasks ? undefined : user?.id;
  const { data: putawayNavTasks = [] } = useQuery({
    queryKey: ["putaway-tasks", putawayUserId],
    queryFn: () => getPutawayTasks(putawayUserId),
    enabled: canAccessPutaway && (canSeeAllPutawayTasks || Boolean(user?.id)),
    staleTime: 30_000,
  });
  const putawayTaskCount = putawayNavTasks.length;
  const { data: navDashboardMetrics } = useQuery({
    queryKey: ["dashboard-metrics", profile?.default_warehouse_id, "nav-counts"],
    queryFn: () => getDashboardMetrics(profile?.default_warehouse_id),
    enabled: canAccessReceiving || canAccessPickLists,
    staleTime: 30_000,
  });
  const routeBadgeCounts = useMemo<Partial<Record<AppRoute, number>>>(() => ({
    "/receiving": navDashboardMetrics?.openReceipts ?? 0,
    "/putaway-tasks": putawayTaskCount,
    "/pick-lists": navDashboardMetrics?.openPickLists ?? 0,
  }), [navDashboardMetrics?.openPickLists, navDashboardMetrics?.openReceipts, putawayTaskCount]);
  const getNavBadgeCount = useCallback((route: AppRoute) => routeBadgeCounts[route] ?? 0, [routeBadgeCounts]);
  const getNavBadgeLabel = useCallback((route: AppRoute, count: number) => {
    if (route === "/receiving") return `${count} open Receiving tasks`;
    if (route === "/pick-lists") return `${count} open Pick Lists`;
    if (route === "/putaway-tasks") return `${count} open Put-Away tasks`;
    return `${count} open tasks`;
  }, []);
  const canSwitchWarehouses = roles.some((role) => ["admin", "warehouse_manager", "developer"].includes(role));
  const canSelectAllWarehouses = roles.some((role) => ["admin", "developer"].includes(role));
  const isDeveloperUser = roles.includes("developer") || profile?.user_code === "DEV01";
  const canAcknowledgeOfflineAlerts = roles.some((role) =>
    ["developer", "admin", "warehouse_manager", "warehouse_supervisor"].includes(role),
  ) && !isDeveloperUser;
  // Same eligible-recipient set as the reorder-alert emails (see
  // ReorderForecastSettingsPanel) — admins and warehouse managers/supervisors.
  const canReceiveReorderNotifications = roles.some((role) =>
    ["developer", "admin", "warehouse_manager", "warehouse_supervisor"].includes(role),
  );
  const { permission: notificationPermission } = useNotificationPermission();
  useReorderAlertNotifications(canReceiveReorderNotifications && notificationPermission === "granted");
  const { data: headerOptions } = useQuery({
    queryKey: ["header-warehouse-options", canSwitchWarehouses],
    queryFn: () => fetchOptions(false),
    enabled: canSwitchWarehouses,
  });
  const { data: offlineSupervisorAlerts = [] } = useQuery<OfflineSupervisorAlert[]>({
    queryKey: ["system-logs", "offline-disconnect-alerts"],
    queryFn: async () => {
      const rows = await listSystemLogs({ severity: "critical", resolved: false, limit: 20 });
      return (rows as OfflineSupervisorAlert[]).filter((row) => row.source === OFFLINE_SYSTEM_LOG_SOURCE);
    },
    enabled: canAcknowledgeOfflineAlerts && online,
    staleTime: 5_000,
    refetchInterval: 15_000,
    meta: { suppressGlobalError: true },
  });
  const { data: reorderAlertsForBell = [] } = useQuery<ReorderAlertBellRow[]>({
    queryKey: ["reorder-alerts", "notification-bell"],
    queryFn: async () => {
      const { data, error } = await (supabase.from as any)("reorder_alerts")
        .select("id, available_quantity, recommended_quantity, created_at, products(sku, name), warehouses(code, name)")
        .eq("status", "active")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as ReorderAlertBellRow[];
    },
    enabled: canReceiveReorderNotifications,
    refetchInterval: 30_000,
    meta: { suppressGlobalError: true },
  });
  const selectedWarehouseValue = profile?.default_warehouse_id ?? (canSelectAllWarehouses ? "__all__" : "");
  const headerWarehouses = useMemo(() => {
    const warehouses = headerOptions?.warehouses ?? [];
    if (roles.includes("admin")) return warehouses;

    const assignedWarehouseIds = new Set(
      (headerOptions?.userRoles ?? [])
        .filter((userRole: any) => userRole.user_id === profile?.id && userRole.warehouse_id)
        .map((userRole: any) => userRole.warehouse_id),
    );

    return assignedWarehouseIds.size > 0
      ? warehouses.filter((warehouse: any) => assignedWarehouseIds.has(warehouse.id))
      : warehouses;
  }, [headerOptions, profile?.id, roles]);
  const selectedWarehouseLabel = useMemo(() => {
    if (selectedWarehouseValue === "__all__") return "All warehouses";
    const warehouse = headerWarehouses.find((item: any) => item.id === selectedWarehouseValue);
    return warehouse?.code ? `${warehouse.code} - ${warehouse.name}` : warehouse?.name ?? "Select warehouse";
  }, [headerWarehouses, selectedWarehouseValue]);
  const warehouseSwitchMutation = useMutation({
    mutationFn: (warehouseId: string | null) => updateProfileDefaultWarehouse(profile?.id ?? "", warehouseId),
    onSuccess: async () => {
      await refreshProfile();
      await queryClient.invalidateQueries({ queryKey: ["dashboard-metrics"] });
      toast.success("Warehouse switched");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Warehouse switch failed"),
  });

  // Auto-select the only warehouse when there is exactly one and none is selected yet
  useEffect(() => {
    if (headerWarehouses.length === 1 && !profile?.default_warehouse_id && !warehouseSwitchMutation.isPending) {
      warehouseSwitchMutation.mutate((headerWarehouses[0] as any).id);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [headerWarehouses.length, profile?.default_warehouse_id]);

  const displayName = profile?.full_name?.trim() || user?.email || "Warehouse User";
  const initials = displayName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("") || "WU";

  useEffect(() => {
    if (isDeveloperUser) {
      clearOfflineAlertSession();
      return;
    }
    if (!connectionConfirmed) return;
    const isInitialNetworkStatus = !networkStatusSeenRef.current;
    networkStatusSeenRef.current = true;
    if (online) {
      if (isInitialNetworkStatus) return;
      if (isActiveWorkInProgress()) {
        void queryClient.invalidateQueries({ refetchType: "none" });
        return;
      }
      let cancelled = false;
      setReconnectRefreshing(true);
      void queryClient.invalidateQueries()
        .finally(() => {
          if (!cancelled) setReconnectRefreshing(false);
        });
      return () => {
        cancelled = true;
      };
    }
    setReconnectRefreshing(false);
    if (!readOfflineAlertSession() && user?.id) {
      const happenedAt = new Date().toISOString();
      writeOfflineAlertSession(happenedAt);
    }
    toast.message("Connection lost. This device is frozen for live commits until reconnect. Your current task position stays on this device.", {
      duration: 6000,
    });
  }, [connectionConfirmed, isDeveloperUser, online, pathname, profile?.default_warehouse_id, profile?.full_name, queryClient, user?.email, user?.id]);

  useEffect(() => {
    const happenedAt = readOfflineAlertSession();
    if (isDeveloperUser) {
      clearOfflineAlertSession();
      return;
    }
    if (!connectionConfirmed || !online || !happenedAt || !user?.id || flushingOfflineAlertRef.current) return;
    flushingOfflineAlertRef.current = true;
    void writeSystemLog({
      log_type: "infrastructure",
      severity: "critical",
      title: "RF device offline — commits frozen",
      message: `${profile?.full_name?.trim() || user.email || "Unknown operator"} lost connectivity on ${pathname} at ${new Date(happenedAt).toLocaleString()}. The connection has returned; review the interrupted RF work before continuing.`,
      source: OFFLINE_SYSTEM_LOG_SOURCE,
      details: {
        alert_kind: "offline_disconnect",
        happened_at: happenedAt,
        restored_at: new Date().toISOString(),
        route: pathname,
        device_id: getOrCreateDeviceId(),
        user_id: user.id,
        user_email: user.email ?? null,
        user_name: profile?.full_name ?? null,
        warehouse_id: profile?.default_warehouse_id ?? null,
      },
    })
      .then(() => clearOfflineAlertSession())
      .catch((error) => console.error("[offline-alert] deferred writeSystemLog failed:", error))
      .finally(() => {
        flushingOfflineAlertRef.current = false;
      });
  }, [connectionConfirmed, isDeveloperUser, online, pathname, profile?.default_warehouse_id, profile?.full_name, user?.email, user?.id]);

  useEffect(() => {
    for (const alert of offlineSupervisorAlerts) {
      if (shownOfflineAlertIdsRef.current.has(alert.id)) continue;
      shownOfflineAlertIdsRef.current.add(alert.id);
      toast.custom(
        () => (
          <OfflineSupervisorAlertToastCard
            alert={alert}
            onAcknowledge={async () => {
              await resolveSystemLog(alert.id);
              toast.dismiss(`offline-alert-${alert.id}`);
              await queryClient.invalidateQueries({ queryKey: ["system-logs", "offline-disconnect-alerts"] });
            }}
          />
        ),
        {
          id: `offline-alert-${alert.id}`,
          duration: Infinity,
        },
      );
    }
    const activeIds = new Set(offlineSupervisorAlerts.map((alert) => alert.id));
    shownOfflineAlertIdsRef.current.forEach((id) => {
      if (!activeIds.has(id)) {
        shownOfflineAlertIdsRef.current.delete(id);
        toast.dismiss(`offline-alert-${id}`);
      }
    });
  }, [offlineSupervisorAlerts, queryClient]);

  const prefetchRouteData = useCallback((route: AppRoute) => {
    const warehouseId = profile?.default_warehouse_id;
    if (route === "/dashboard") {
      void queryClient.prefetchQuery({
        queryKey: ["dashboard-metrics", warehouseId],
        queryFn: () => getDashboardMetrics(warehouseId),
      });
      return;
    }
    if (route === "/receiving") {
      void queryClient.prefetchQuery({
        queryKey: ["options", "receiving", shouldRestrictToDefaultWarehouse(roles), warehouseId],
        queryFn: () => fetchOptions(false, { restrictToWarehouse: shouldRestrictToDefaultWarehouse(roles), warehouseId }),
      });
      return;
    }
    if (route === "/putaway-tasks") {
      const canSeeAll = roles.some((r) => ["developer", "admin", "warehouse_manager", "warehouse_supervisor"].includes(r));
      const prefetchUserId = canSeeAll ? undefined : user?.id;
      void queryClient.prefetchQuery({
        queryKey: ["putaway-tasks", prefetchUserId],
        queryFn: () => getPutawayTasks(prefetchUserId),
      });
      return;
    }
    if (route === "/inventory-search") {
      void queryClient.prefetchQuery({
        queryKey: ["inventory-search", "", "all", ""],
        queryFn: () => searchInventory({ status: "all" }),
      });
      return;
    }
    if (route === "/pick-lists") {
      void queryClient.prefetchQuery({
        queryKey: ["pick-lists"],
        queryFn: () => listPickLists(),
      });
    }
  }, [profile?.default_warehouse_id, queryClient, roles, user?.id]);

  const renderNavigation = (compactTop = false, collapsed = sidebarCollapsed) => (
      <div
        className={cn(
          "flex h-full flex-col overflow-hidden bg-sidebar",
          collapsed ? "items-center bg-teal-500 px-1.5 py-3" : compactTop ? "px-2.5 py-0" : "px-2.5 py-3"
        )}
      >
      {/* Logo area */}
      {!compactTop ? (
        <div className={cn(
          "mb-4 flex items-center justify-between gap-2 px-2",
          collapsed && "justify-center px-0"
        )}>
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-black p-1">
              <img src="/logo.png" alt="Warehouse Wizard" className="h-full w-full object-contain" />
            </div>
            {!collapsed && (
              <span className="truncate text-sm font-semibold text-foreground">Warehouse Wizard</span>
            )}
          </div>
        </div>
      ) : null}

      <nav className={cn("flex-1 overflow-y-auto", compactTop && "pt-0")}>
        <div className="flex flex-col gap-0.0">
          {items.map((item) => {
            const Icon = navIcons[item.to] ?? LayoutDashboard;
            const isActive = pathname === item.to;
            const showSeparator = !collapsed && item.to === "/warehouses";
            const badgeCount = getNavBadgeCount(item.to);
            const link = (
              <NavLink
                key={item.to}
                className={({ isActive: navActive }) =>
                  cn(
                    "group relative flex min-h-[3.375rem] items-center gap-2 rounded-md px-2 text-sm font-medium transition-all duration-100 active:scale-[0.96] active:transition-transform",
                    collapsed && "h-11 min-h-11 w-11 justify-center p-0",
                    navActive || isActive
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                  )
                }
                to={toPath(item.to)}
                aria-label={item.label}
                onMouseEnter={() => prefetchRouteData(item.to)}
                onFocus={() => prefetchRouteData(item.to)}
                onClick={() => setMobileMenuOpen(false)}
              >
                <Icon
                  data-active-icon={isActive ? "true" : "false"}
                  className={cn("shrink-0", collapsed ? "h-5 w-5" : "h-4 w-4", isActive && "text-accent")}
                />
                {collapsed ? null : <span className="truncate">{item.label}</span>}
                {badgeCount > 0 ? (
                  <span
                    className={cn(
                      "ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1.5 text-[10px] font-semibold leading-none text-destructive-foreground",
                      collapsed && "absolute right-0 top-1 ml-0",
                    )}
                    aria-label={getNavBadgeLabel(item.to, badgeCount)}
                  >
                    {badgeCount > 99 ? "99+" : badgeCount}
                  </span>
                ) : null}
              </NavLink>
            );

            const node = collapsed ? (
              <Tooltip key={item.to}>
                <TooltipTrigger asChild>{link}</TooltipTrigger>
                <TooltipContent side="right">{item.label}</TooltipContent>
              </Tooltip>
            ) : link;

            if (showSeparator) {
              return (
                <div key={item.to} className="contents">
                  <div className="my-1 border-t border-sidebar-border" />
                  {node}
                </div>
              );
            }
            return node;
          })}
        </div>
      </nav>

      <div className={cn("mt-2 hidden border-t border-sidebar-border pt-2 lg:landscape:flex", collapsed ? "justify-center" : "justify-end")}>
        <Button
          className="h-8 w-8 shrink-0"
          size="icon"
          variant="ghost"
          onClick={() => setSidebarCollapsed((c) => !c)}
          aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
        >
          {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
        </Button>
      </div>
    </div>
  );

  return (
    <div className="h-screen overflow-hidden bg-background">
      <div
        className={cn(
          // Mobile + portrait-desktop: top header + content. Landscape-desktop: sidebar + content.
          "grid h-full w-full grid-cols-1 grid-rows-[auto_minmax(0,1fr)] overflow-hidden",
          "lg:landscape:grid-rows-1 lg:landscape:grid-cols-[minmax(11rem,max-content)_minmax(0,1fr)]",
          sidebarCollapsed && "lg:landscape:grid-cols-[64px_minmax(0,1fr)]",
        )}
      >
        {/* Mobile header */}
        <header className="col-span-full flex items-center justify-between border-b border-border bg-background/95 px-4 py-3 backdrop-blur lg:landscape:hidden">
          <Link
            to={toPath("/dashboard")}
            className="flex min-w-0 items-center gap-2 rounded-md outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            aria-label="Go to dashboard"
          >
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-black p-1">
              <img src="/logo.png" alt="Warehouse Wizard" className="h-full w-full object-contain" />
            </div>
            <span className="truncate text-sm font-semibold">{appTitle}</span>
            <span className="hidden text-[10px] font-medium text-muted-foreground sm:inline">v{__APP_VERSION__}</span>
            {reconnectRefreshing ? (
              <Loader2
                role="status"
                aria-label="Refreshing live warehouse state"
                className="h-3.5 w-3.5 shrink-0 animate-spin text-primary"
              />
            ) : null}
          </Link>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 rounded-md border border-border bg-card/80 px-1.5 py-1">
              <Avatar className="h-6 w-6">
                <AvatarFallback className="bg-primary/10 text-[10px] font-semibold text-primary">{initials}</AvatarFallback>
              </Avatar>
              <span className="hidden max-w-[120px] truncate text-xs font-medium sm:inline">{displayName}</span>
            </div>
            <OfflineFreezeBadge compact />
            <NotificationBell
              alerts={offlineSupervisorAlerts}
              offline={connectionConfirmed && !online}
              reorderAlerts={reorderAlertsForBell}
              showReorder={canReceiveReorderNotifications}
            />
            <HelpSidebar pathname={pathname} />
            <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
              <SheetTrigger asChild>
                <Button className="h-9 w-9" size="icon" variant="outline">
                  <Menu className="h-4 w-4" />
                </Button>
              </SheetTrigger>
              <SheetContent side="top" className="left-auto right-4 top-3 flex max-h-[calc(100svh-1.5rem)] w-[min(24rem,calc(100vw-1rem))] max-w-[calc(100vw-1rem)] origin-top-right flex-col overflow-hidden rounded-2xl border border-border bg-card/95 p-0 shadow-2xl backdrop-blur data-[state=closed]:duration-75 data-[state=open]:duration-100 data-[state=closed]:slide-out-to-top-1 data-[state=open]:slide-in-from-top-1 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0">
                <SheetHeader className="sr-only">
                  <SheetTitle>Navigation</SheetTitle>
                </SheetHeader>
                <div className="flex flex-col border-b border-border bg-card/80 px-4 py-3 gap-2">
                  <div className="flex items-center gap-3">
                    <Avatar className="h-9 w-9">
                      <AvatarFallback className="bg-primary/10 text-xs font-semibold text-primary">{initials}</AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{displayName}</p>
                      <p className="truncate text-[11px] text-muted-foreground">v{__APP_VERSION__}</p>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <ChangeOwnPasswordDialog onClose={() => setMobileMenuOpen(false)} />
                    {canSwitchWarehouses ? (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            className="h-8 w-8 shrink-0"
                            size="icon"
                            variant="outline"
                            aria-label={`Switch warehouse, current ${selectedWarehouseLabel}`}
                            title={`Switch warehouse, current ${selectedWarehouseLabel}`}
                          >
                            <Building2 className="h-3.5 w-3.5" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-56">
                          {canSelectAllWarehouses ? (
                            <DropdownMenuItem onSelect={() => warehouseSwitchMutation.mutate(null)}>
                              All warehouses
                            </DropdownMenuItem>
                          ) : null}
                          {headerWarehouses.map((warehouse: any) => (
                            <DropdownMenuItem key={warehouse.id} onSelect={() => warehouseSwitchMutation.mutate(warehouse.id)}>
                              {warehouse.code ? `${warehouse.code} - ${warehouse.name}` : warehouse.name}
                            </DropdownMenuItem>
                          ))}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    ) : null}
                    <Button className="h-8 w-8 shrink-0" size="icon" variant="outline" onClick={() => window.location.reload()} aria-label="Refresh" title="Refresh">
                      <RefreshCw className="h-3.5 w-3.5" />
                    </Button>
                    <CopilotPanel variant="mobile" />
                    <Button className="h-8 flex-1 text-xs justify-start" variant="outline" size="sm" onClick={() => { setMobileMenuOpen(false); void signOut(); }}>
                      <LogOut className="mr-2 h-3 w-3" />
                      Sign out
                    </Button>
                  </div>
                </div>
                <div className="flex-1 overflow-y-auto">{renderNavigation(true, false)}</div>
              </SheetContent>
            </Sheet>
          </div>
        </header>

        <aside className="hidden h-full overflow-hidden border-r border-border lg:landscape:block">{renderNavigation()}</aside>

        <main className="flex min-h-0 min-w-0 flex-col overflow-hidden">
          {/* Desktop top bar — landscape only */}
          <div className="hidden items-center justify-between gap-3 border-b border-border bg-background/95 px-5 py-2.5 backdrop-blur lg:landscape:flex">
            <div className="min-w-0">
              <p className="flex items-center gap-2 truncate text-xs text-muted-foreground">
                <span className="truncate">{items.find((item) => item.to === pathname)?.label ?? "Warehouse Wizard Enterprise WMS"}</span>
                {roles.includes("developer") ? (
                  <a
                    href="https://lovable.dev/projects/b1278655-12aa-44aa-a245-7d311e40dddf"
                    target="_blank"
                    rel="noreferrer"
                    title="Edit with Lovable"
                    className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium underline-offset-2 hover:underline hover:text-primary"
                  >
                    v{__APP_VERSION__}
                  </a>
                ) : (
                  <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium">v{__APP_VERSION__}</span>
                )}
                {reconnectRefreshing ? (
                  <Loader2
                    role="status"
                    aria-label="Refreshing live warehouse state"
                    className="h-3.5 w-3.5 shrink-0 animate-spin text-primary"
                  />
                ) : null}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {canSwitchWarehouses ? (
                <Select
                  value={profile?.default_warehouse_id ?? (canSelectAllWarehouses ? "__all__" : "")}
                  onValueChange={(value) => warehouseSwitchMutation.mutate(value === "__all__" ? null : value)}
                  disabled={warehouseSwitchMutation.isPending}
                >
                  <SelectTrigger className="h-9 w-[13rem]">
                    <SelectValue placeholder="Select warehouse" />
                  </SelectTrigger>
                  <SelectContent>
                    {canSelectAllWarehouses ? (
                      <SelectItem value="__all__">All warehouses</SelectItem>
                    ) : null}
                    {headerWarehouses.map((warehouse: any) => (
                      <SelectItem key={warehouse.id} value={warehouse.id}>
                        {warehouse.code ? `${warehouse.code} - ${warehouse.name}` : warehouse.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : null}
              <CopilotPanel />
              <HelpSidebar pathname={pathname} />
              <OfflineFreezeBadge />
              <NotificationBell
                alerts={offlineSupervisorAlerts}
                offline={connectionConfirmed && !online}
                reorderAlerts={reorderAlertsForBell}
                showReorder={canReceiveReorderNotifications}
              />
              <ProfileMenu initials={initials} displayName={displayName} onSignOut={() => void signOut()} onRefresh={() => window.location.reload()} />
            </div>
          </div>
          <div
            className={cn(
              "flex-1 min-h-0 min-w-0",
              pathname === "/help"
                ? "p-0 pb-14 lg:landscape:pb-0"
                : "px-4 pt-5 pb-[4.75rem] sm:px-5 lg:px-6 lg:landscape:pb-5",
              pathname === "/inventory-search" ? "overflow-hidden" : "overflow-y-auto",
            )}
          >
            {children}
          </div>
        </main>
      </div>
      <AccessRequestsBanner />
      <FailedTasksReminder />
      {canReceiveReorderNotifications ? <ReorderAlertNotificationPrompt /> : null}
      <MobileActionBar items={items} pathname={pathname} routeBadgeCounts={routeBadgeCounts} getNavBadgeLabel={getNavBadgeLabel} />
    </div>
  );
}

function MobileActionBar({
  items,
  pathname,
  routeBadgeCounts,
  getNavBadgeLabel,
}: {
  items: typeof NAVIGATION;
  pathname: string;
  routeBadgeCounts: Partial<Record<AppRoute, number>>;
  getNavBadgeLabel: (route: AppRoute, count: number) => string;
}) {
  const { toolbarModules, isEnabled } = useFeatureFlags();
  const { toPath } = useTenantPath();
  type ShortcutEntry =
    | { type: "copilot" }
    | { type: "navigation"; item: (typeof NAVIGATION)[number] };
  const favoriteItems = toolbarModules.flatMap((moduleKey): ShortcutEntry[] => {
    if (moduleKey === "copilot") return isEnabled(moduleKey) ? [{ type: "copilot" as const }] : [];
    const item = items.find((candidate) => candidate.moduleKey === moduleKey && candidate.to !== "/help");
    return item ? [{ type: "navigation" as const, item }] : [];
  });
  const shortcutItems: ShortcutEntry[] = favoriteItems.length > 0
    ? favoriteItems
    : items.filter((item) => item.to !== "/help" && item.to !== "/dashboard").map((item) => ({ type: "navigation" as const, item }));
  const barItems = shortcutItems.slice(0, 8);
  if (barItems.length === 0) return null;
  const getNavBadgeCount = (route: AppRoute) => routeBadgeCounts[route] ?? 0;
  const hostname = typeof window === "undefined" ? "" : window.location.hostname.toLowerCase();
  const isLocalSession =
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname.startsWith("192.168.") ||
    hostname.startsWith("10.") ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname);
  return (
    <nav
      className={cn(
        "fixed bottom-0 left-0 right-0 z-40 grid h-14 items-stretch border-t bg-background/95 px-0.5 backdrop-blur lg:landscape:hidden",
        isLocalSession ? "border-border" : "border-emerald-500",
      )}
      style={{ gridTemplateColumns: `repeat(${barItems.length}, minmax(0, 1fr))` }}
      onContextMenu={(event) => event.preventDefault()}
      aria-label="Primary mobile navigation"
    >
      {barItems.map((entry) => {
        if (entry.type === "copilot") {
          return <CopilotPanel key="copilot" variant="dock" />;
        }
        const { item } = entry;
        const Icon = navIcons[item.to] ?? LayoutDashboard;
        const isActive = pathname === item.to;
        const badgeCount = getNavBadgeCount(item.to);
        return (
          <NavLink
            key={item.to}
            to={toPath(item.to)}
            aria-label={item.label}
            className={cn(
              "flex min-w-0 flex-col items-center justify-center gap-0.5 rounded-md px-0.5 py-1 text-[10px] font-medium transition-colors",
              isActive ? "text-primary" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <span className="relative">
              <Icon className={cn("h-5 w-5", isActive && "text-accent")} data-active-icon={isActive ? "true" : "false"} />
              {badgeCount > 0 ? (
                <span
                  className="absolute -right-2 -top-2 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[9px] font-semibold leading-none text-destructive-foreground"
                  aria-label={getNavBadgeLabel(item.to, badgeCount)}
                >
                  {badgeCount > 99 ? "99+" : badgeCount}
                </span>
              ) : null}
            </span>
            <span className="w-full truncate text-center leading-none">{item.label}</span>
          </NavLink>
        );
      })}
    </nav>
  );
}
