import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
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
  FailedTasksReminder,
  AccessRequestsBanner,
  navIcons,
  appTitle,
  ChangeOwnPasswordDialog,
  shouldRestrictToDefaultWarehouse,
} from "@/features/shared/ui-shared";

function ProfileMenu({ initials, displayName, onSignOut }: { initials: string; displayName: string; onSignOut: () => void }) {
  const [pwOpen, setPwOpen] = useState(false);
  return (
    <div className="contents">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="flex items-center gap-2 rounded-lg border border-border bg-card/80 px-2.5 py-1.5 text-sm transition-colors hover:bg-accent focus:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Avatar className="h-6 w-6">
              <AvatarFallback className="bg-primary/10 text-xs font-semibold text-primary">{initials}</AvatarFallback>
            </Avatar>
            <span className="hidden truncate text-xs font-medium sm:block">{displayName}</span>
            <ChevronDown className="h-3 w-3 text-muted-foreground" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
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

function OfflineQueueBadge({ compact = false }: { compact?: boolean }) {
  const { count, syncing } = useOfflineQueue();
  if (count === 0 && !syncing) return null;
  const label = syncing ? "Syncing…" : `${count} queued`;
  const handleClick = async () => {
    if (syncing) return;
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      toast.error("Still offline — reconnect to a network, then tap again.");
      return;
    }
    const result = await flushOfflineQueue();
    if (result.remaining === 0 && result.succeeded > 0) {
      toast.success(`Synced ${result.succeeded} buffered action${result.succeeded === 1 ? "" : "s"}.`);
    } else if (result.remaining > 0) {
      toast.warning(`${result.remaining} item${result.remaining === 1 ? "" : "s"} still pending — will retry on next reconnect.`);
    }
  };
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      onClick={handleClick}
      disabled={syncing}
      className={cn(
        "h-9 gap-1.5 border-amber-400/60 bg-amber-50 text-amber-900 hover:bg-amber-100 dark:bg-amber-950/40 dark:text-amber-100 dark:hover:bg-amber-900/50",
        compact && "px-2 text-[11px]",
      )}
      title="Buffered work waiting for reconnect"
    >
      {syncing ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <CloudOff className="h-3.5 w-3.5" />}
      <span className={cn(compact && "hidden sm:inline")}>{label}</span>
      {!compact && count > 0 && !syncing ? <span className="text-xs opacity-70">tap to sync</span> : null}
    </Button>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const { pathname } = useLocation();
  const { profile, roles, signOut, user, refreshProfile } = useAuth();
  const queryClient = useQueryClient();
  const { isEnabled } = useFeatureFlags();
  const { online } = useNetworkStatus();
  useEffect(() => {
    installOfflineAutoReplay();
  }, []);
  useBackgroundSync(queryClient);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const networkStatusSeenRef = useRef(false);
  const items = NAVIGATION
    .filter(
      (item) =>
        item.roles.some((role) => roles.includes(role)) &&
        (!item.moduleKey || isEnabled(item.moduleKey as ModuleKey)),
    )
    // Help is always pinned as the last sidebar entry, regardless of module order.
    .sort((a, b) => (a.to === "/help" ? 1 : 0) - (b.to === "/help" ? 1 : 0));
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
  const { data: headerOptions } = useQuery({
    queryKey: ["header-warehouse-options", canSwitchWarehouses],
    queryFn: () => fetchOptions(false),
    enabled: canSwitchWarehouses,
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
    if (!networkStatusSeenRef.current) {
      networkStatusSeenRef.current = true;
      return;
    }
    if (online) {
      toast.success("Connection restored. Refreshing live data.");
      void flushOfflineQueue({ silent: true }).finally(() => {
        void queryClient.invalidateQueries();
      });
      return;
    }
    toast.message("Connection lost. Keep finishing scan work already open; it will sync when signal returns.", {
      duration: 6000,
    });
  }, [online, queryClient]);

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

  const renderNavigation = (compactTop = false) => (
      <div
        className={cn(
          "flex h-full flex-col overflow-hidden bg-sidebar",
          sidebarCollapsed ? "items-center px-1.5 py-3 bg-teal-500" : compactTop ? "px-2.5 pb-3 pt-1" : "px-2.5 py-3"
        )}
      >
      {/* Logo area */}
      <div className={cn(
        "mb-4 flex items-center justify-between gap-2 px-2",
        sidebarCollapsed && "justify-center px-0"
      )}>
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-black p-1">
            <img src="/logo.png" alt="Warehouse Wizard" className="h-full w-full object-contain" />
          </div>
          {!sidebarCollapsed && (
            <span className="truncate text-sm font-semibold text-foreground">Warehouse Wizard</span>
          )}
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto">
        <div className="flex flex-col gap-0.5">
          {items.map((item) => {
            const Icon = navIcons[item.to] ?? LayoutDashboard;
            const isActive = pathname === item.to;
            const showSeparator = !sidebarCollapsed && item.to === "/warehouses";
            const badgeCount = getNavBadgeCount(item.to);
            const link = (
              <NavLink
                key={item.to}
                className={cn(
                  "group relative flex min-h-[3.375rem] items-center gap-2 rounded-md px-2 text-sm font-medium transition-all duration-100 active:scale-[0.96] active:transition-transform",
                  sidebarCollapsed && "h-11 min-h-11 w-11 justify-center p-0",
                  isActive
                    ? "bg-primary text-primary-foreground shadow-xs"
                    : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                )}
                to={item.to}
                aria-label={item.label}
                onMouseEnter={() => prefetchRouteData(item.to)}
                onFocus={() => prefetchRouteData(item.to)}
                onClick={() => setMobileMenuOpen(false)}
              >
                <Icon
                  data-active-icon={isActive ? "true" : "false"}
                  className={cn("shrink-0", sidebarCollapsed ? "h-5 w-5" : "h-4 w-4", isActive && "text-accent")}
                />
                {sidebarCollapsed ? null : <span className="truncate">{item.label}</span>}
                {badgeCount > 0 ? (
                  <span
                    className={cn(
                      "ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1.5 text-[10px] font-semibold leading-none text-destructive-foreground",
                      sidebarCollapsed && "absolute right-0 top-1 ml-0",
                    )}
                    aria-label={getNavBadgeLabel(item.to, badgeCount)}
                  >
                    {badgeCount > 99 ? "99+" : badgeCount}
                  </span>
                ) : null}
              </NavLink>
            );

            const node = sidebarCollapsed ? (
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

      {/* Sidebar footer — desktop only */}
      <div className={cn("mt-2 hidden lg:landscape:flex", sidebarCollapsed ? "justify-center" : "justify-start")}>
        <Button
          className={cn(
            "h-8 gap-1.5 shrink-0",
            sidebarCollapsed ? "w-8 justify-center px-0" : "px-2.5",
          )}
          size={sidebarCollapsed ? "icon" : "sm"}
          variant="ghost"
          onClick={() => window.location.reload()}
          aria-label="Hard refresh"
          title="Hard refresh"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          {!sidebarCollapsed && <span className="text-xs">Refresh</span>}
        </Button>
      </div>
      <div className={cn("mt-2 hidden border-t border-sidebar-border pt-2 lg:landscape:flex", sidebarCollapsed ? "justify-center" : "justify-end")}>
        <Button
          className="h-8 w-8 shrink-0"
          size="icon"
          variant="ghost"
          onClick={() => setSidebarCollapsed((c) => !c)}
          aria-label={sidebarCollapsed ? "Expand navigation" : "Collapse navigation"}
        >
          {sidebarCollapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
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
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-black p-1">
              <img src="/logo.png" alt="Warehouse Wizard" className="h-full w-full object-contain" />
            </div>
            <span className="text-sm font-semibold">{appTitle}</span>
            <span className="hidden text-[10px] font-medium text-muted-foreground sm:inline">v{__APP_VERSION__}</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 rounded-md border border-border bg-card/80 px-1.5 py-1">
              <Avatar className="h-6 w-6">
                <AvatarFallback className="bg-primary/10 text-[10px] font-semibold text-primary">{initials}</AvatarFallback>
              </Avatar>
              <span className="hidden max-w-[120px] truncate text-xs font-medium sm:inline">{displayName}</span>
            </div>
            <OfflineQueueBadge compact />
            <HelpSidebar pathname={pathname} />
            <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
              <SheetTrigger asChild>
                <Button className="h-9 w-9" size="icon" variant="outline">
                  <Menu className="h-4 w-4" />
                </Button>
              </SheetTrigger>
              <SheetContent side="top" className="flex max-h-svh w-screen max-w-full flex-col p-0">
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
                    <Button className="h-8 flex-1 text-xs justify-start" variant="outline" size="sm" onClick={() => { setMobileMenuOpen(false); void signOut(); }}>
                      <LogOut className="mr-2 h-3 w-3" />
                      Sign out
                    </Button>
                  </div>
                </div>
                <div className="flex-1 overflow-y-auto">{renderNavigation(true)}</div>
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
                <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium">v{__APP_VERSION__}</span>
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
              <HelpSidebar pathname={pathname} />
              <OfflineQueueBadge />
              <ProfileMenu initials={initials} displayName={displayName} onSignOut={() => void signOut()} />
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
  // Show up to 5 primary nav items (skip Help — it lives in the header).
  const barItems = items.filter((item) => item.to !== "/help").slice(0, 5);
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
        "fixed bottom-0 left-0 right-0 z-40 flex h-14 items-center justify-around border-t bg-background/95 px-1 backdrop-blur lg:landscape:hidden",
        isLocalSession ? "border-border" : "border-emerald-500",
      )}
      aria-label="Primary mobile navigation"
    >
      {barItems.map((item) => {
        const Icon = navIcons[item.to] ?? LayoutDashboard;
        const isActive = pathname === item.to;
        const badgeCount = getNavBadgeCount(item.to);
        return (
          <NavLink
            key={item.to}
            to={item.to}
            aria-label={item.label}
            className={cn(
              "flex flex-1 flex-col items-center justify-center gap-0.5 rounded-md py-1 text-[10px] font-medium transition-colors",
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
            <span className="max-w-[64px] truncate">{item.label}</span>
          </NavLink>
        );
      })}
    </nav>
  );
}
