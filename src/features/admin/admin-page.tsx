import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QRCodeSVG } from "qrcode.react";
import { Link, NavLink, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm, type UseFormReturn } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { supabase } from "@/integrations/supabase/client";
import { Activity, AlertCircle, AlertTriangle, ArrowLeftRight, BarChart3, Bot, Boxes, Building2, CheckCircle2, ChevronDown, CircleOff, ClipboardCheck, ClipboardList, CloudOff, Download, Eye, EyeOff, FileDown, FileText, Forklift, GripVertical, HelpCircle, Home, Info, KeyRound, LayoutDashboard, Loader2, Lock, LockOpen, LogOut, Mail, Maximize2, MapPinned, Menu, Minimize2, Network, Package, PackageX, PanelLeftClose, PanelLeftOpen, Pencil, Play, Plus, Power, Printer, QrCode, RadioTower, RefreshCw, RotateCcw, Search, Settings, ShieldCheck, Star, Tags, Trash2, Truck, Upload, UserPlus, Users, Volume2 } from "lucide-react";
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
import { MAX_TOOLBAR_MODULES, useFeatureFlags, MODULE_LABELS, STARTER_MODULES, type ModuleKey } from "@/hooks/use-feature-flags";
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
  adminSignOutAllSessions,
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
  deleteAllProducts,
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
import { ReorderForecastSettingsPanel } from "@/features/shared/reorder-forecast-settings";
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
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { LicenseAgreementTab } from "@/features/admin/license-agreement";



const inviteUserSchema = z.object({
  email: z.string().email("Valid email required"),
  full_name: z.string().min(1, "Full name required"),
  password: z.string().min(8, "Min 8 characters"),
  role_code: z.string().optional().default(""),
  warehouse_id: z.string().optional().default(""),
});

import {
  TableFrame,
  WarehouseOption,
  ProfileRow,
  UserActivityRow,
  playBarcodeBeep,
  playConfirmTone,
  playAttentionTone,
  playNoGoTone,
} from "@/features/shared/ui-shared";

function AddUserDialog({
  roles,
  warehouses,
  onSuccess,
}: {
  roles: Array<{ id: string; code: string; name: string }>;
  warehouses: WarehouseOption[];
  onSuccess: () => void;
}) {
  const [open, setOpen] = useState(false);
  const form = useForm<z.infer<typeof inviteUserSchema>>({
    resolver: zodResolver(inviteUserSchema),
    defaultValues: { email: "", full_name: "", password: "", role_code: "", warehouse_id: "" },
  });

  const mutation = useMutation({
    mutationFn: (values: z.infer<typeof inviteUserSchema>) =>
      adminInviteUser({
        email: values.email,
        full_name: values.full_name,
        password: values.password,
        role_code: values.role_code || undefined,
        warehouse_id: values.warehouse_id || undefined,
      } as AdminInviteUserInput),
    onSuccess: () => {
      toast.success("User created and approved");
      form.reset();
      setOpen(false);
      onSuccess();
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Failed to create user"),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <UserPlus className="mr-2 h-4 w-4" />
          Add User
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add New User</DialogTitle>
          <DialogDescription>Create a new warehouse user. They will be pre-approved and can sign in immediately.</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form className="grid gap-4" onSubmit={form.handleSubmit((v) => mutation.mutate(v))}>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="full_name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Full Name</FormLabel>
                    <FormControl><Input {...field} placeholder="Jane Smith" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl><Input {...field} type="email" placeholder="jane@example.com" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Temporary Password</FormLabel>
                  <FormControl><Input {...field} type="password" placeholder="Min 8 characters" /></FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="role_code"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Role (optional)</FormLabel>
                    <Select onValueChange={(v) => field.onChange(v === "__none__" ? "" : v)} value={field.value ? field.value : "__none__"}>
                      <FormControl>
                        <SelectTrigger><SelectValue placeholder="Select role" /></SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="__none__">No role assigned</SelectItem>
                        {roles.map((role) => (
                          <SelectItem key={role.code} value={role.code}>{role.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="warehouse_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Warehouse (optional)</FormLabel>
                    <Select onValueChange={(v) => field.onChange(v === "__all__" ? "" : v)} value={field.value ? field.value : "__all__"}>
                      <FormControl>
                        <SelectTrigger><SelectValue placeholder="All warehouses" /></SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="__all__">All warehouses</SelectItem>
                        {warehouses.map((wh) => (
                          <SelectItem key={wh.id} value={wh.id}>{wh.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <Button type="submit" disabled={mutation.isPending} className="w-full">
              {mutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <UserPlus className="mr-2 h-4 w-4" />}
              Create User
            </Button>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

export function UsersRolesPage() {
  return UsersRolesPageImpl();
}

export function MobileActionBar() {
  // Stub: original implementation was lost during the core/ui split.
  // Kept as a no-op so the App shell's <mod.MobileActionBar /> render is valid.
  return null;
}

function UsersRolesPageImpl() {
  const queryClient = useQueryClient();
  const { profile: viewerProfile, roles } = useAuth();
  const canOperateRoles = roles.some((r) => ["developer", "admin"].includes(r));
  const canOperateDeveloperRole = roles.includes("developer");
  const [includeHidden, setIncludeHidden] = useState(false);
  const optionsQuery = useQuery({ queryKey: ["options", includeHidden], queryFn: () => fetchOptions(includeHidden) });
  const options = optionsQuery.data;
  const { data: activities = [], error: activitiesError } = useQuery({ queryKey: ["user-activities"], queryFn: () => listUserActivities() });
  // Users / Access / Role Matrix all hang off the same query. A silent
  // rejection used to blank every tab with nothing logged, so surface it.
  const optionsError = optionsQuery.error;
  const loadErrorMessage = optionsError
    ? optionsError instanceof Error
      ? optionsError.message
      : String(optionsError)
    : null;
  useEffect(() => {
    if (!optionsError) return;
    const message = optionsError instanceof Error ? optionsError.message : String(optionsError);
    toast.error(`Users & roles failed to load: ${message}`);
    void writeSystemLog({
      logType: "error",
      severity: "error",
      title: "User management data failed to load",
      message,
      source: "settings.users-roles",
      details: { includeHidden, error: message },
    });
  }, [optionsError, includeHidden]);
  useEffect(() => {
    if (!activitiesError) return;
    const message = activitiesError instanceof Error ? activitiesError.message : String(activitiesError);
    toast.error(`User activity failed to load: ${message}`);
    void writeSystemLog({
      logType: "error",
      severity: "error",
      title: "User activity failed to load",
      message,
      source: "settings.users-roles",
      details: { error: message },
    });
  }, [activitiesError]);

  const [selectedProfile, setSelectedProfile] = useState("");
  const [selectedRole, setSelectedRole] = useState("");
  const [activeTab, setActiveTab] = useState("users");
  const [permissionSaving, setPermissionSaving] = useState<string | null>(null);

  const invalidateOptions = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["options"] }),
      queryClient.invalidateQueries({ queryKey: ["user-activities"] }),
      // Approving/disabling an account changes the pending-access banner; without
      // this it stays up until its own 60s poll comes round.
      queryClient.invalidateQueries({ queryKey: ["pending-access-requests"] }),
    ]);
  }, [queryClient]);

  const assignMutation = useMutation({
    mutationFn: async () => upsertRecord("user_roles", { user_id: selectedProfile, role_id: selectedRole }),
    onSuccess: async () => {
      toast.success("Role assigned");
      setSelectedProfile("");
      setSelectedRole("");
      await invalidateOptions();
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Failed to assign role"),
  });

  const profileMutation = useMutation({
    mutationFn: async ({ profileId, active }: { profileId: string; active: boolean }) => setProfileActive(profileId, active),
    onSuccess: async (_, variables) => {
      toast.success(variables.active ? "Profile enabled" : "Profile disabled");
      await invalidateOptions();
    },
    onError: (error, variables) =>
      toast.error(
        error instanceof Error
          ? error.message
          : `Could not ${variables.active ? "enable" : "disable"} this profile`,
      ),
  });

  const profileEditMutation = useMutation({
    mutationFn: async ({
      values,
      newPassword,
      badgePin,
    }: {
      values: Parameters<typeof updateProfileDetails>[0];
      newPassword?: string;
      badgePin?: string;
    }) => {
      await updateProfileDetails(values);
      if (newPassword) {
        await adminUpdateUserPassword(values.profileId, newPassword);
      }
      if (badgePin) {
        await adminUpdateUserPin(values.profileId, badgePin);
      }
    },
    onSuccess: async () => {
      toast.success("User updated");
      await invalidateOptions();
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Update failed"),
  });

  const revokeSessionsMutation = useMutation({
    mutationFn: adminSignOutAllSessions,
    onSuccess: async () => {
      toast.success("All active sessions were signed out.");
      await invalidateOptions();
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Could not sign out sessions"),
  });

  const updatePermission = async (roleId: string, featureId: string, field: "can_view" | "can_edit", value: boolean) => {
    if (!canOperateRoles) return;
    const key = `${roleId}:${featureId}:${field}`;
    setPermissionSaving(key);
    const current = ((options?.rolePermissions ?? []) as any[]).find(
      (permission) => permission.role_id === roleId && permission.feature_id === featureId,
    ) ?? { can_view: false, can_edit: false };
    const nextView = field === "can_view" ? value : Boolean(current.can_view || value);
    const nextEdit = field === "can_edit" ? value : Boolean(current.can_edit && value);
    try {
      await upsertRecord("role_permissions", {
        role_id: roleId,
        feature_id: featureId,
        can_view: nextView,
        can_edit: nextEdit,
      });
      await invalidateOptions();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Permission update failed");
    } finally {
      setPermissionSaving(null);
    }
  };

  const profiles = (options?.profiles ?? []) as ProfileRow[];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">User Management</h2>
          <p className="text-sm text-muted-foreground">Manage warehouse users, roles, and access permissions.</p>
        </div>
        <AddUserDialog
          roles={(options?.roles ?? []) as Array<{ id: string; code: string; name: string }>}
          warehouses={(options?.warehouses ?? []) as WarehouseOption[]}
          onSuccess={invalidateOptions}
        />
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="flex h-auto w-full flex-wrap items-stretch justify-start gap-1 sm:w-fit">
          <TabsTrigger value="users" className="min-h-9 flex-1 gap-1.5 sm:flex-none">
            <Users className="h-3.5 w-3.5" />
            Users ({profiles.length})
          </TabsTrigger>
          <TabsTrigger value="roles" className="min-h-9 flex-1 gap-1.5 sm:flex-none">
            <ShieldCheck className="h-3.5 w-3.5" />
            Access
          </TabsTrigger>
          <TabsTrigger value="role-matrix" className="min-h-9 flex-1 gap-1.5 sm:flex-none">
            <ShieldCheck className="h-3.5 w-3.5" />
            Role Matrix
          </TabsTrigger>
          <TabsTrigger value="activity" className="min-h-9 flex-1 gap-1.5 sm:flex-none">
            <Activity className="h-3.5 w-3.5" />
            Activity
          </TabsTrigger>
        </TabsList>

        <TabsContent value="users" className="mt-4">
          <div className="flex items-center justify-between gap-3 pb-3">
            <p className="text-sm text-muted-foreground">{profiles.length} user{profiles.length !== 1 ? "s" : ""}</p>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIncludeHidden((c) => !c)}
              className="text-xs"
            >
              {includeHidden ? <EyeOff className="mr-1.5 h-3.5 w-3.5" /> : <Eye className="mr-1.5 h-3.5 w-3.5" />}
              {includeHidden ? "Hide inactive" : "Show inactive"}
            </Button>
          </div>
          <Card>
            <CardContent className="p-0">
              <TableFrame>
                <Table>
                  <TableHeader className="sticky top-0 z-10 bg-card">
                    <TableRow>
                      <TableHead>User</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>Roles</TableHead>
                      <TableHead className="w-20 text-center">Enabled</TableHead>
                      <TableHead className="w-20 text-center">Approved</TableHead>
                      <TableHead className="w-10" />
                      <TableHead className="w-10" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {profiles.map((profile) => (
                      <UserProfileRow
                        key={profile.id}
                        profile={profile}
                        warehouses={(options?.warehouses ?? []) as WarehouseOption[]}
                        userRoles={(options?.userRoles ?? []).filter((ur: any) => ur.user_id === profile.id)}
                        onSave={(values, credentials) => profileEditMutation.mutate({ values, ...credentials })}
                        onToggleActive={() =>
                          profileMutation.mutate({ profileId: profile.id, active: !(profile.active ?? true) })
                        }
                        onSignOutAllSessions={() => revokeSessionsMutation.mutate(profile.id)}
                        revokingSessions={revokeSessionsMutation.isPending}
                      />
                    ))}
                    {profiles.length === 0 && (
                      <TableRow>
                        <TableCell className="h-24 text-center text-muted-foreground" colSpan={7}>
                          No users found. Use "Add User" to create the first one.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </TableFrame>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="roles" className="mt-4">
          <div className="grid gap-6 xl:grid-cols-[1fr_1.5fr]">
            {canOperateRoles && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Assign Role</CardTitle>
                  <CardDescription>Add a role to an existing user account.</CardDescription>
                </CardHeader>
                <CardContent className="grid gap-3">
                  <Select value={selectedProfile} onValueChange={setSelectedProfile}>
                    <SelectTrigger><SelectValue placeholder="Select user" /></SelectTrigger>
                    <SelectContent>
                      {profiles.map((profile) => (
                        <SelectItem key={profile.id} value={profile.id}>
                          {profile.full_name ?? profile.email ?? profile.id}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select value={selectedRole} onValueChange={setSelectedRole}>
                    <SelectTrigger><SelectValue placeholder="Select role" /></SelectTrigger>
                    <SelectContent>
                      {(options?.roles ?? [])
                        .filter((role: any) => canOperateDeveloperRole || role.code !== "developer")
                        .map((role: any) => (
                          <SelectItem key={role.id} value={role.id}>{role.name}</SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                  <Button
                    disabled={!selectedProfile || !selectedRole || assignMutation.isPending}
                    onClick={() => assignMutation.mutate()}
                    className="w-full"
                  >
                    {assignMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    Assign role
                  </Button>
                </CardContent>
              </Card>
            )}

            <Card className={canOperateRoles ? "" : "xl:col-span-full"}>
              <CardHeader>
                <CardTitle className="text-base">Current Access</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-2">
                {(options?.userRoles ?? [])
                  .filter((userRole: any) => canOperateDeveloperRole || (userRole.roles as { code?: string } | null)?.code !== "developer")
                  .map((userRole: any) => {
                    const profile = profiles.find((p) => p.id === userRole.user_id);
                    const role = userRole.roles as { code?: string; name?: string } | null;
                    const isDeveloperRole = role?.code === "developer";
                    const canUnassignDeveloperRole = isDeveloperRole && userRole.assigned_by === viewerProfile?.id;
                    return (
                      <div key={userRole.id} className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5">
                        <div className="flex min-w-0 items-center gap-2.5">
                          <Avatar className="h-7 w-7 shrink-0">
                            <AvatarFallback className="bg-muted text-xs">
                              {(profile?.full_name ?? "?").slice(0, 2).toUpperCase()}
                            </AvatarFallback>
                          </Avatar>
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium">{profile?.full_name ?? userRole.user_id}</p>
                            <p className="truncate text-xs text-muted-foreground">{profile?.email ?? ""}</p>
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <Badge variant={userRole.is_hidden ? "secondary" : "default"} className="text-xs">
                            {role?.name ?? "Role"}
                          </Badge>
                          {canOperateRoles && isDeveloperRole ? (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 text-xs"
                              disabled={!canUnassignDeveloperRole}
                              title={canUnassignDeveloperRole ? "Unassign developer role" : "Only the developer who assigned this role can unassign it"}
                              onClick={async () => {
                                try {
                                  await removeUserRoleAssignment(userRole.id);
                                  toast.success("Role unassigned");
                                  await invalidateOptions();
                                } catch (error) {
                                  toast.error(error instanceof Error ? error.message : "Role unassign failed");
                                }
                              }}
                            >
                              Unassign
                            </Button>
                          ) : canOperateRoles ? (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 text-xs"
                              onClick={async () => {
                                try {
                                  await removeUserRoleAssignment(userRole.id);
                                  toast.success("Role unassigned");
                                  await invalidateOptions();
                                } catch (error) {
                                  toast.error(error instanceof Error ? error.message : "Role unassign failed");
                                }
                              }}
                            >
                              Unassign
                            </Button>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="role-matrix" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Role Matrix</CardTitle>
              <CardDescription>
                Configure view and edit abilities by role. Users may hold any combination of roles, including no role.
                Developer abilities are locked to protect the system administrator.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto rounded-b-lg border-t border-border">
                <Table className="min-w-[900px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="sticky left-0 z-10 min-w-[220px] bg-card">Feature</TableHead>
                      {((options?.roles ?? []) as any[])
                        .filter((role) => canOperateRoles || role.code !== "developer")
                        .map((role) => (
                          <TableHead key={role.id} colSpan={2} className="min-w-[150px] text-center">
                            <div className="font-semibold">{role.name}</div>
                            <div className="mt-1 grid grid-cols-2 text-[11px] font-normal text-muted-foreground">
                              <span>View</span><span>Edit</span>
                            </div>
                          </TableHead>
                        ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {((options?.permissionFeatures ?? []) as any[]).map((feature) => (
                      <TableRow key={feature.id}>
                        <TableCell className="sticky left-0 z-[1] bg-card">
                          <div className="font-medium">{feature.name}</div>
                          <div className="text-xs text-muted-foreground">{feature.description}</div>
                        </TableCell>
                        {((options?.roles ?? []) as any[])
                          .filter((role) => canOperateRoles || role.code !== "developer")
                          .flatMap((role) => {
                            const permission = ((options?.rolePermissions ?? []) as any[]).find(
                              (item) => item.role_id === role.id && item.feature_id === feature.id,
                            ) ?? { can_view: false, can_edit: false };
                            const locked = role.code === "developer" || !canOperateRoles;
                            return (["can_view", "can_edit"] as const).map((field) => {
                              const key = `${role.id}:${feature.id}:${field}`;
                              const checked = Boolean(permission[field]);
                              return (
                                <TableCell key={key} className="text-center">
                                  <Button
                                    type="button"
                                    size="icon"
                                    variant={checked ? "default" : "outline"}
                                    className="h-7 w-7 rounded-full"
                                    aria-label={`${feature.name} ${role.name} ${field === "can_view" ? "view" : "edit"} ${checked ? "enabled" : "disabled"}`}
                                    disabled={locked || permissionSaving !== null}
                                    onClick={() => updatePermission(role.id, feature.id, field, !checked)}
                                  >
                                    {checked ? <CheckCircle2 className="h-4 w-4" /> : <CircleOff className="h-4 w-4" />}
                                  </Button>
                                </TableCell>
                              );
                            });
                          })}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              {!canOperateRoles && (
                <p className="border-t border-border px-4 py-3 text-xs text-muted-foreground">
                  Only Admins and Developers can edit the role matrix.
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="activity" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Recent Activity</CardTitle>
              <CardDescription>Sign-ins, profile changes, and role assignments.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-2">
              {(activities as UserActivityRow[]).length === 0 && (
                <p className="py-4 text-center text-sm text-muted-foreground">No recent activity.</p>
              )}
              {(activities as UserActivityRow[]).map((activity) => (
                <div key={activity.id} className="flex items-start justify-between gap-4 rounded-lg border border-border px-3 py-2.5 text-sm">
                  <div className="min-w-0">
                    <p className="font-medium capitalize">{activity.event_type.replace(/_/g, " ")}</p>
                    <p className="text-xs text-muted-foreground">
                      {activity.profiles?.full_name ?? activity.actor_user_id ?? "System"} · {activity.entity_table}
                    </p>
                  </div>
                  <span className="shrink-0 text-xs text-muted-foreground">{formatDate(activity.created_at)}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function isWeakBadgePin(pin: string) {
  const easyPins = new Set([
    "0000", "1111", "2222", "3333", "4444", "5555", "6666", "7777", "8888", "9999",
    "1234", "12345", "123456", "1234567", "4321", "54321", "654321", "7654321",
    "2580", "0852", "1212", "1122", "6969", "1010", "2020", "1230", "7890",
  ]);
  if (!/^\d{4,7}$/.test(pin)) return true;
  if (/^(\d)\1+$/.test(pin)) return true;
  if (easyPins.has(pin)) return true;
  if ("0123456789".includes(pin) || "9876543210".includes(pin)) return true;
  return false;
}

function printUserBadge({
  badgeCode,
  fullName,
  phone,
  roles,
}: {
  badgeCode: string;
  fullName: string;
  phone: string;
  roles: string[];
}) {
  const qrSvg = renderToStaticMarkup(
    <QRCodeSVG value={badgeCode} size={210} bgColor="#ffffff" fgColor="#000000" level="M" />,
  );
  const roleText = roles.length > 0 ? roles.join(", ") : "No assigned role";
  const printWindow = window.open("", "_blank", "width=420,height=360");
  if (!printWindow) {
    toast.error("Popup blocked. Allow popups to print the badge.");
    return;
  }

  printWindow.document.write(`
    <!doctype html>
    <html>
      <head>
        <title>${escapeHtml(fullName || "User badge")}</title>
        <style>
          @page { size: 3in 2.5in; margin: 0; }
          * { box-sizing: border-box; }
          body {
            margin: 0;
            width: 3in;
            height: 2.5in;
            font-family: Arial, sans-serif;
            color: #102033;
            background: #ffffff;
          }
          .badge {
            width: 3in;
            height: 2.5in;
            display: grid;
            grid-template-columns: 1fr 0.95in;
            gap: 0.12in;
            padding: 0.18in;
            border: 1px solid #102033;
          }
          .brand {
            font-size: 8pt;
            font-weight: 700;
            letter-spacing: 0.04em;
            text-transform: uppercase;
            color: #0f766e;
          }
          .name {
            margin-top: 0.18in;
            font-size: 17pt;
            line-height: 1.05;
            font-weight: 800;
          }
          .meta {
            margin-top: 0.08in;
            font-size: 8.5pt;
            line-height: 1.25;
          }
          .qr {
            align-self: center;
            justify-self: center;
            width: 0.95in;
            height: 0.95in;
          }
          .code {
            grid-column: 1 / -1;
            align-self: end;
            font-family: "Courier New", monospace;
            font-size: 8pt;
            letter-spacing: 0.08em;
            color: #334155;
          }
          svg { width: 100%; height: 100%; display: block; }
        </style>
      </head>
      <body>
        <main class="badge">
          <section>
            <div class="brand">Warehouse Wizard</div>
            <div class="name">${escapeHtml(fullName || "Warehouse User")}</div>
            <div class="meta">
              <strong>Phone</strong><br>${escapeHtml(phone || "Not set")}<br><br>
              <strong>Role</strong><br>${escapeHtml(roleText)}
            </div>
          </section>
          <section class="qr">${qrSvg}</section>
          <div class="code">${escapeHtml(badgeCode)}</div>
        </main>
        <script>
          window.onload = function () {
            window.focus();
            window.print();
          };
        </script>
      </body>
    </html>
  `);
  printWindow.document.close();
}

function UserProfileRow({
  profile,
  warehouses,
  userRoles,
  onSave,
  onToggleActive,
  onSignOutAllSessions,
  revokingSessions,
}: {
  profile: ProfileRow;
  warehouses: WarehouseOption[];
  userRoles: any[];
  onSave: (
    values: Parameters<typeof updateProfileDetails>[0],
    credentials?: { newPassword?: string; badgePin?: string },
  ) => void;
  onToggleActive: () => void;
  onSignOutAllSessions: () => void;
  revokingSessions: boolean;
}) {
  const { profile: viewerProfile, roles: viewerRoles } = useAuth();
  const targetIsDeveloper = userRoles.some((ur: any) => (ur.roles as { code?: string } | null)?.code === "developer");
  const canChangePassword = viewerRoles.includes("developer") || !targetIsDeveloper;
  const isSelf = viewerProfile?.id === profile.id;
  const canRevokeSessions = viewerRoles.some((role) => ["developer", "admin"].includes(role));

  const [open, setOpen] = useState(false);
  const fallbackWarehouseId = !profile.default_warehouse_id && warehouses.length === 1 ? warehouses[0]?.id ?? "" : "";
  const [values, setValues] = useState({
    full_name: profile.full_name ?? "",
    phone: profile.phone ?? "",
    default_warehouse_id: profile.default_warehouse_id ?? fallbackWarehouseId,
    active: profile.active ?? true,
    approved: profile.approved ?? false,
    user_code: profile.user_code ?? "",
    badge_code: profile.badge_code ?? "",
  });
  const [newPassword, setNewPassword] = useState("");
  const [badgePin, setBadgePin] = useState("");

  useEffect(() => {
    if (!profile.default_warehouse_id && warehouses.length === 1 && !values.default_warehouse_id) {
      setValues((current) => ({ ...current, default_warehouse_id: warehouses[0]?.id ?? "" }));
    }
  }, [profile.default_warehouse_id, values.default_warehouse_id, warehouses]);

  const roleNames = userRoles
    .filter((ur) => !ur.is_hidden)
    .map((ur) => (ur.roles as { name?: string } | null)?.name ?? "")
    .filter(Boolean);
  const hasBadgeCode = values.badge_code.trim().length > 0;

  const handlePrintBadge = () => {
    if (!hasBadgeCode) return;
    printUserBadge({
      badgeCode: values.badge_code.trim(),
      fullName: values.full_name.trim(),
      phone: values.phone.trim(),
      roles: roleNames,
    });
  };

  const handleSave = () => {
    const trimmedPassword = newPassword.trim();
    const trimmedBadgePin = badgePin.trim();
    if (trimmedPassword && trimmedBadgePin) {
      toast.error("Set either a new password or a badge PIN, not both.");
      return;
    }
    if (trimmedPassword && trimmedPassword.length < 8) {
      toast.error("Password must be at least 8 characters.");
      return;
    }
    if (trimmedBadgePin && isWeakBadgePin(trimmedBadgePin)) {
      toast.error("Badge PIN must be 4-7 digits and not an easy sequence or repeated code.");
      return;
    }
    onSave(
      { profileId: profile.id, ...values, active: isSelf ? true : values.active },
      {
        newPassword: trimmedPassword || undefined,
        badgePin: trimmedBadgePin || undefined,
      },
    );
    setOpen(false);
  };

  return (
    <TableRow
      className={cn("h-10 cursor-pointer even:bg-muted/30", !profile.active && "opacity-60")}
      onDoubleClick={() => setOpen(true)}
    >
      <TableCell className="max-w-48 p-2">
        <p className="truncate text-sm font-medium">{profile.full_name ?? profile.email ?? profile.id}</p>
      </TableCell>
      <TableCell className="max-w-56 p-2 text-sm text-muted-foreground">
        <span className="block truncate">{profile.email ?? "—"}</span>
      </TableCell>
      <TableCell className="max-w-64 p-2">
        <div className="flex flex-wrap items-center gap-1">
          {roleNames.length > 0 ? roleNames.map((name) => (
            <Badge key={name} variant="outline" className="px-1.5 py-0 text-xs">{name}</Badge>
          )) : <span className="text-sm text-muted-foreground">No roles</span>}
        </div>
      </TableCell>
      <TableCell className="p-2 text-center">
        {profile.active ? (
          <CheckCircle2 className="mx-auto h-4 w-4 text-emerald-600" aria-label="Enabled" />
        ) : (
          <CircleOff className="mx-auto h-4 w-4 text-muted-foreground" aria-label="Disabled" />
        )}
      </TableCell>
      <TableCell className="p-2 text-center">
        {profile.approved ? (
          <CheckCircle2 className="mx-auto h-4 w-4 text-emerald-600" aria-label="Approved" />
        ) : (
          <CircleOff className="mx-auto h-4 w-4 text-muted-foreground" aria-label="Pending approval" />
        )}
      </TableCell>
      <TableCell className="p-1 text-center">
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7"
              aria-label={`Edit ${profile.full_name ?? profile.email ?? "user"}`}
              title="Edit user"
              onClick={(event) => event.stopPropagation()}
            >
              <Pencil className="h-3.5 w-3.5" />
            </Button>
          </DialogTrigger>
            <DialogContent className="max-h-[90vh] overflow-hidden sm:max-w-lg">
              <DialogHeader>
                <DialogTitle>Edit User</DialogTitle>
                <DialogDescription>Update operational access, codes, and approval status.</DialogDescription>
              </DialogHeader>
              <div className="max-h-[70vh] overflow-y-auto pr-4">
                <div className="grid gap-4">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="grid gap-1.5">
                      <label className="text-sm font-medium">Full name</label>
                      <Input value={values.full_name} onChange={(e) => setValues((v) => ({ ...v, full_name: e.target.value }))} />
                    </div>
                    <div className="grid gap-1.5">
                      <label className="text-sm font-medium">Phone</label>
                      <Input value={values.phone} onChange={(e) => setValues((v) => ({ ...v, phone: e.target.value }))} />
                    </div>
                    <div className="grid gap-1.5">
                      <label className="text-sm font-medium">User code</label>
                      <Input value={values.user_code} placeholder="e.g. OPR02" onChange={(e) => setValues((v) => ({ ...v, user_code: e.target.value }))} />
                    </div>
                    <div className="grid gap-1.5">
                      <label className="text-sm font-medium">Badge code</label>
                      <Input value={values.badge_code} placeholder="e.g. BADGE-OPR02" onChange={(e) => setValues((v) => ({ ...v, badge_code: e.target.value }))} />
                    </div>
                    {canChangePassword && (
                      <div className="grid gap-1.5 sm:col-span-2">
                        <label className="text-sm font-medium">Badge sign-in PIN</label>
                        <Input
                          value={badgePin}
                          inputMode="numeric"
                          maxLength={7}
                          placeholder="Leave blank to keep current PIN"
                          onChange={(e) => setBadgePin(e.target.value.replace(/\D/g, "").slice(0, 7))}
                        />
                        <p className="text-xs text-muted-foreground">Use 4-7 digits. Repeated or sequential codes are blocked.</p>
                      </div>
                    )}
                    <div className="grid gap-1.5 sm:col-span-2">
                      <label className="text-sm font-medium">Default warehouse</label>
                      <Select
                        value={values.default_warehouse_id || "none"}
                        onValueChange={(val) => setValues((v) => ({ ...v, default_warehouse_id: val === "none" ? "" : val }))}
                      >
                        <SelectTrigger><SelectValue placeholder="No default" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">No default warehouse</SelectItem>
                          {warehouses.map((wh) => <SelectItem key={wh.id} value={wh.id}>{wh.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <label className={cn(
                      "flex items-center gap-3 rounded-lg border border-border px-3 py-2.5 text-sm",
                      isSelf ? "cursor-not-allowed opacity-70" : "cursor-pointer hover:bg-accent",
                    )}>
                      <Checkbox
                        checked={values.active}
                        disabled={isSelf}
                        onCheckedChange={(c) => {
                          if (!isSelf) setValues((v) => ({ ...v, active: Boolean(c) }));
                        }}
                      />
                      <div>
                        <p className="font-medium">Active</p>
                        <p className="text-xs text-muted-foreground">{isSelf ? "You cannot disable your own account" : "Can sign in"}</p>
                      </div>
                    </label>
                    <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-border px-3 py-2.5 text-sm hover:bg-accent">
                      <Checkbox
                        checked={values.approved}
                        onCheckedChange={(c) => setValues((v) => ({ ...v, approved: Boolean(c) }))}
                      />
                      <div>
                        <p className="font-medium">Approved</p>
                        <p className="text-xs text-muted-foreground">Admin confirmed</p>
                      </div>
                    </label>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {canChangePassword ? (
                      <div className="grid gap-1.5">
                        <label className="text-sm font-medium">New password</label>
                        <Input
                          type="password"
                          value={newPassword}
                          placeholder="Leave blank to keep current"
                          onChange={(e) => setNewPassword(e.target.value)}
                        />
                      </div>
                    ) : (
                      <p className="self-center text-xs text-muted-foreground">Password changes for developer accounts are restricted.</p>
                    )}
                    <Button
                      type="button"
                      variant="outline"
                      className="self-end"
                      disabled={!hasBadgeCode}
                      title={hasBadgeCode ? "Print badge" : "Enter a badge code before printing"}
                      onClick={handlePrintBadge}
                    >
                      <Printer className="mr-2 h-4 w-4" />
                      Print badge
                    </Button>
                  </div>
                  {canRevokeSessions && (
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button type="button" variant="outline" className="border-destructive/50 text-destructive hover:bg-destructive/10">
                          <LogOut className="mr-2 h-4 w-4" />
                          Sign out of all sessions
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Sign out {profile.full_name ?? profile.email ?? "this user"} everywhere?</AlertDialogTitle>
                          <AlertDialogDescription>
                            This removes every active refresh session for this account. Existing access tokens expire shortly and the user must sign in again.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                            disabled={revokingSessions}
                            onClick={onSignOutAllSessions}
                          >
                            {revokingSessions ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                            Sign out all sessions
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  )}
                  <Button
                    className="w-full"
                    onClick={handleSave}
                  >
                    Save changes
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
      </TableCell>
      <TableCell className="p-1 text-center">
        <Button
          size="icon"
          variant="ghost"
          className={cn("h-7 w-7", profile.active && !isSelf && "text-destructive hover:text-destructive")}
          disabled={isSelf}
          aria-label={profile.active ? `Disable ${profile.full_name ?? profile.email ?? "user"}` : `Enable ${profile.full_name ?? profile.email ?? "user"}`}
          title={isSelf ? "You cannot disable your own account" : profile.active ? "Disable user" : "Enable user"}
          onClick={(event) => {
            event.stopPropagation();
            onToggleActive();
          }}
        >
          <Power className="h-3.5 w-3.5" />
        </Button>
      </TableCell>
    </TableRow>
  );
}

const MODULE_GROUPS: { label: string; keys: ModuleKey[] }[] = [
  {
    label: "Workspace",
    keys: ["dashboard", "copilot"],
  },
  {
    label: "Core Operations",
    keys: ["receiving", "putaway", "inventory", "pick-lists", "location-moves", "transfers"],
  },
  {
    label: "Master Data",
    keys: ["products", "warehouses", "zones", "locations", "users", "settings", "clients", "packaging"],
  },
  {
    label: "Advanced",
    keys: ["cycle-counts", "reports", "status", "system-log", "email-log"],
  },
];

function ModulesSettingsPanel({ isAdmin }: { isAdmin: boolean }) {
  const { flags, toolbarModules, isToolbarModule, setModule, setToolbarModule, resetToStarter } = useFeatureFlags();

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0">
          <div>
            <CardTitle>Module Visibility</CardTitle>
            <CardDescription>
              Hide modules that aren't needed for your operation. Star up to {MAX_TOOLBAR_MODULES} modules for personal shortcuts. Dashboard is always available, but its shortcut is optional. Copilot is available to every role that can access Settings when enabled.
              {!isAdmin && " Only administrators can change module visibility; your shortcut stars are personal."}
            </CardDescription>
          </div>
          {isAdmin && (
            <Button size="sm" variant="outline" onClick={resetToStarter}>
              Reset to Starter defaults
            </Button>
          )}
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          {MODULE_GROUPS.map((group) => (
            <div key={group.label}>
              <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{group.label}</p>
              <div className="flex flex-col gap-3">
                {group.keys.map((key) => {
                  const meta = MODULE_LABELS[key];
                  const enabled = flags[key] ?? STARTER_MODULES[key];
                  const pinned = isToolbarModule(key);
                  const hasToolbarDestination = key === "copilot" || NAVIGATION.some((item) => item.moduleKey === key);
                  const toolbarDisabled = !hasToolbarDestination || (!pinned && (!enabled || toolbarModules.length >= MAX_TOOLBAR_MODULES));
                  return (
                    <div key={key} className="flex items-center justify-between gap-4 rounded-lg border border-border px-4 py-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium">{meta.label}</p>
                        <p className="text-xs text-muted-foreground">{meta.description}</p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <Button
                          type="button"
                          size="icon"
                          variant={pinned ? "secondary" : "ghost"}
                          className="h-8 w-8"
                          disabled={toolbarDisabled}
                          onClick={() => setToolbarModule(key, !pinned)}
                          title={!hasToolbarDestination ? `${meta.label} does not have a dock shortcut` : pinned ? `Remove ${meta.label} from mobile toolbar` : `Add ${meta.label} to mobile toolbar`}
                          aria-label={!hasToolbarDestination ? `${meta.label} does not have a dock shortcut` : pinned ? `Remove ${meta.label} from mobile toolbar` : `Add ${meta.label} to mobile toolbar`}
                        >
                          <Star className={cn("h-4 w-4", pinned && "fill-current")} />
                        </Button>
                        <Switch
                          checked={enabled}
                          onCheckedChange={(v) => setModule(key, v)}
                          disabled={!isAdmin || key === "dashboard"}
                          aria-label={`Toggle ${meta.label}`}
                          title={key === "dashboard" ? "Dashboard is always enabled" : undefined}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function NetSuiteIntegrationCard() {
  const [status, setStatus] = useState<{
    configured: boolean;
    enabled: boolean;
    accountIdMasked: string | null;
    clientIdMasked: string | null;
    lastTestedAt: string | null;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [accountId, setAccountId] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [revealedWebhookSecret, setRevealedWebhookSecret] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("netsuite-connection", {
        body: { action: "status" },
      });
      if (error) throw error;
      setStatus(data as any);
      setEnabled(Boolean((data as any)?.enabled));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load NetSuite status");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const handleSave = async () => {
    if (!accountId.trim() || !clientId.trim()) {
      toast.error("Account ID and Client ID are required");
      return;
    }
    setSaving(true);
    setRevealedWebhookSecret(null);
    try {
      const { data, error } = await supabase.functions.invoke("netsuite-connection", {
        body: {
          action: "save",
          accountId: accountId.trim(),
          clientId: clientId.trim(),
          clientSecret: clientSecret.trim() || undefined,
          enabled,
        },
      });
      if (error) throw error;
      const result = data as { ok: boolean; webhookSecret?: string | null };
      if (result?.webhookSecret) setRevealedWebhookSecret(result.webhookSecret);
      toast.success("NetSuite connection saved");
      setClientSecret("");
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    try {
      const { data, error } = await supabase.functions.invoke("netsuite-connection", {
        body: { action: "test" },
      });
      if (error) throw error;
      const result = data as { ok: boolean; error?: string };
      if (result?.ok) toast.success("NetSuite credentials verified");
      else toast.error(result?.error ?? "Test failed");
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Test failed");
    } finally {
      setTesting(false);
    }
  };

  const savedSecretPlaceholder = status?.configured ? "•••• saved (leave blank to keep)" : "";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Network className="h-4 w-4" />NetSuite Integration</CardTitle>
        <CardDescription>
          OAuth2 client credentials for the NetSuite REST API. Secrets are stored server-side and never returned to the browser.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
        ) : (
          <>
            <div className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground grid gap-1">
              <div>Status: <span className="font-medium text-foreground">{status?.configured ? "Configured" : "Not configured"}</span> · {status?.enabled ? "Enabled" : "Disabled"}</div>
              {status?.accountIdMasked && <div>Account: <span className="font-mono">{status.accountIdMasked}</span></div>}
              {status?.clientIdMasked && <div>Client ID: <span className="font-mono">{status.clientIdMasked}</span></div>}
              {status?.lastTestedAt && <div>Last tested: {new Date(status.lastTestedAt).toLocaleString()}</div>}
            </div>

            <div className="grid gap-2">
              <Label htmlFor="ns-account">Account ID</Label>
              <Input id="ns-account" value={accountId} onChange={(e) => setAccountId(e.target.value)} placeholder="123456_SB1" autoComplete="off" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="ns-client-id">Client ID</Label>
              <Input id="ns-client-id" value={clientId} onChange={(e) => setClientId(e.target.value)} autoComplete="off" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="ns-client-secret">Client Secret</Label>
              <Input
                id="ns-client-secret"
                type="password"
                value={clientSecret}
                onChange={(e) => setClientSecret(e.target.value)}
                placeholder={savedSecretPlaceholder}
                autoComplete="new-password"
              />
              <p className="text-xs text-muted-foreground">Write-only. The stored value is never sent back to the browser.</p>
            </div>
            <div className="flex items-center justify-between rounded-md border p-3">
              <div>
                <Label htmlFor="ns-enabled" className="text-sm font-medium">Enabled</Label>
                <p className="text-xs text-muted-foreground">Turn on to allow sync jobs against NetSuite.</p>
              </div>
              <Switch id="ns-enabled" checked={enabled} onCheckedChange={setEnabled} />
            </div>

            {revealedWebhookSecret && (
              <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs">
                <div className="mb-1 font-medium text-amber-700 dark:text-amber-300">Webhook shared secret — copy now, it will not be shown again:</div>
                <code className="block break-all rounded bg-background/60 p-2 font-mono text-[11px]">{revealedWebhookSecret}</code>
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              <Button onClick={handleSave} disabled={saving}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Save connection
              </Button>
              <Button variant="outline" onClick={handleTest} disabled={testing || !status?.configured}>
                {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Test connection
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function NetSuiteWarehouseMappingCard() {
  const queryClient = useQueryClient();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);

  const warehousesQuery = useQuery({
    queryKey: ["settings", "netsuite-mapping", "warehouses"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("warehouses")
        .select("id, name, code")
        .order("name", { ascending: true });
      if (error) throw error;
      return (data ?? []) as Array<{ id: string; name: string; code: string | null }>;
    },
  });

  const linksQuery = useQuery({
    queryKey: ["settings", "netsuite-mapping", "links"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("external_record_links")
        .select("id, local_id, external_id")
        .eq("system", "netsuite")
        .eq("local_table", "warehouses")
        .eq("external_record_type", "location");
      if (error) throw error;
      return (data ?? []) as Array<{ id: string; local_id: string; external_id: string }>;
    },
  });

  const linkByWarehouse = useMemo(() => {
    const map = new Map<string, { id: string; external_id: string }>();
    for (const link of linksQuery.data ?? []) {
      map.set(link.local_id, { id: link.id, external_id: link.external_id });
    }
    return map;
  }, [linksQuery.data]);

  const handleSave = async (warehouseId: string) => {
    const existing = linkByWarehouse.get(warehouseId);
    const nextValue = (drafts[warehouseId] ?? existing?.external_id ?? "").trim();
    setSavingId(warehouseId);
    try {
      if (!nextValue) {
        if (existing) {
          const { error } = await supabase
            .from("external_record_links")
            .delete()
            .eq("id", existing.id);
          if (error) throw error;
          toast.success("Mapping cleared");
        }
      } else if (existing) {
        const { error } = await supabase
          .from("external_record_links")
          .update({ external_id: nextValue })
          .eq("id", existing.id);
        if (error) throw error;
        toast.success("Mapping updated");
      } else {
        const { error } = await supabase.from("external_record_links").insert({
          system: "netsuite",
          local_table: "warehouses",
          local_id: warehouseId,
          external_record_type: "location",
          external_id: nextValue,
        });
        if (error) throw error;
        toast.success("Mapping saved");
      }
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[warehouseId];
        return next;
      });
      await queryClient.invalidateQueries({ queryKey: ["settings", "netsuite-mapping", "links"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save mapping");
    } finally {
      setSavingId(null);
    }
  };

  const warehouses = warehousesQuery.data ?? [];
  const loading = warehousesQuery.isLoading || linksQuery.isLoading;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><MapPinned className="h-4 w-4" />NetSuite Location Mapping</CardTitle>
        <CardDescription>
          Map each Warehouse Wizard warehouse to its NetSuite Location internal ID so inventory adjustments post to the correct location.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
        ) : warehouses.length === 0 ? (
          <p className="text-sm text-muted-foreground">No warehouses defined yet.</p>
        ) : (
          <div className="grid gap-3">
            {warehouses.map((wh) => {
              const existing = linkByWarehouse.get(wh.id);
              const draftValue = drafts[wh.id];
              const value = draftValue ?? existing?.external_id ?? "";
              const dirty = draftValue !== undefined && draftValue.trim() !== (existing?.external_id ?? "");
              return (
                <div key={wh.id} className="grid gap-2 rounded-md border p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
                  <div className="min-w-0">
                    <Label className="text-xs text-muted-foreground">Warehouse</Label>
                    <div className="truncate text-sm font-medium">{wh.name}</div>
                    {wh.code ? <div className="truncate text-xs text-muted-foreground font-mono">{wh.code}</div> : null}
                  </div>
                  <div className="grid gap-1">
                    <Label htmlFor={`ns-loc-${wh.id}`} className="text-xs text-muted-foreground">NetSuite Location Internal ID</Label>
                    <Input
                      id={`ns-loc-${wh.id}`}
                      value={value}
                      placeholder="e.g. 123"
                      autoComplete="off"
                      onChange={(e) => setDrafts((prev) => ({ ...prev, [wh.id]: e.target.value }))}
                    />
                  </div>
                  <Button
                    size="sm"
                    onClick={() => handleSave(wh.id)}
                    disabled={savingId === wh.id || (!dirty && !(existing && value === ""))}
                  >
                    {savingId === wh.id ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    Save
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

type NetSuiteListedItem = {
  externalId: string;
  itemId: string;
  displayName: string;
  upcCode: string;
  active: boolean;
  alreadyImported: boolean;
};

function NetSuiteImportCard() {
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [offset, setOffset] = useState(0);
  const [items, setItems] = useState<NetSuiteListedItem[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [selected, setSelected] = useState<Record<string, NetSuiteListedItem>>({});
  const [notConfigured, setNotConfigured] = useState(false);
  const limit = 25;

  const fetchItems = useCallback(async (nextOffset: number, nextSearch: string) => {
    setLoading(true);
    try {
      const { data: statusData, error: statusError } = await supabase.functions.invoke("netsuite-connection", {
        body: { action: "status" },
      });
      if (statusError) throw statusError;
      const statusResult = statusData as { configured?: boolean } | null;
      if (!statusResult?.configured) {
        setNotConfigured(true);
        setItems([]);
        setHasMore(false);
        return;
      }

      const { data, error } = await supabase.functions.invoke("netsuite-connection", {
        body: { action: "list_items", search: nextSearch || undefined, limit, offset: nextOffset },
      });
      const result = data as { items?: NetSuiteListedItem[]; hasMore?: boolean; error?: string; notConfigured?: boolean };
      const errMsg = result?.error ?? (error instanceof Error ? error.message : "");
      if (result?.notConfigured || (errMsg && /(no netsuite connection|credentials incomplete)/i.test(errMsg))) {
        setNotConfigured(true);
        setItems([]);
        setHasMore(false);
        return;
      }
      setNotConfigured(false);
      if (error) throw error;
      if (result?.error) throw new Error(result.error);
      setItems(result?.items ?? []);
      setHasMore(Boolean(result?.hasMore));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load NetSuite items");
      setItems([]);
      setHasMore(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void fetchItems(0, ""); }, [fetchItems]);

  const runSearch = () => {
    const trimmed = searchInput.trim();
    setSearch(trimmed);
    setOffset(0);
    void fetchItems(0, trimmed);
  };

  const goToPage = (nextOffset: number) => {
    setOffset(nextOffset);
    void fetchItems(nextOffset, search);
  };

  const toggleSelected = (item: NetSuiteListedItem) => {
    setSelected((prev) => {
      const next = { ...prev };
      if (next[item.externalId]) delete next[item.externalId];
      else next[item.externalId] = item;
      return next;
    });
  };

  const selectedCount = Object.keys(selected).length;

  const handleImport = async () => {
    const toImport = Object.values(selected);
    if (toImport.length === 0) return;
    setImporting(true);
    try {
      const { data, error } = await supabase.functions.invoke("netsuite-connection", {
        body: {
          action: "import_items",
          items: toImport.map((i) => ({
            externalId: i.externalId,
            itemId: i.itemId,
            displayName: i.displayName,
            upcCode: i.upcCode,
            active: i.active,
          })),
        },
      });
      if (error) throw error;
      const result = data as { succeeded?: number; failed?: number; error?: string };
      if (result?.error) throw new Error(result.error);
      if ((result?.failed ?? 0) > 0) {
        toast.warning(`Imported ${result?.succeeded ?? 0}, ${result?.failed} failed — check System Log for details.`);
      } else {
        toast.success(`Imported ${result?.succeeded ?? 0} product${result?.succeeded === 1 ? "" : "s"} from NetSuite`);
      }
      setSelected({});
      await fetchItems(offset, search);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Import failed");
    } finally {
      setImporting(false);
    }
  };

  return (
    <Card className="xl:col-span-2">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Download className="h-4 w-4" />Import Products from NetSuite</CardTitle>
        <CardDescription>
          Search the NetSuite item catalog and choose which products to bring into Warehouse Wizard. Re-selecting an already-imported item updates it.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[200px] flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") runSearch(); }}
              placeholder="Search by item ID or name…"
              className="pl-8"
            />
          </div>
          <Button variant="outline" size="sm" onClick={runSearch} disabled={loading}>Search</Button>
          <Button size="sm" onClick={handleImport} disabled={selectedCount === 0 || importing}>
            {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Import selected ({selectedCount})
          </Button>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
        ) : notConfigured ? (
          <p className="text-sm text-muted-foreground">NetSuite is not connected yet. Save valid credentials in the connection card above to browse the item catalog.</p>
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground">No items found. Make sure the NetSuite connection above is configured and enabled.</p>
        ) : (
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10"></TableHead>
                  <TableHead>Item ID</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>UPC</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item) => (
                  <TableRow key={item.externalId}>
                    <TableCell>
                      <Checkbox
                        checked={Boolean(selected[item.externalId])}
                        onCheckedChange={() => toggleSelected(item)}
                        aria-label={`Select ${item.itemId}`}
                      />
                    </TableCell>
                    <TableCell className="font-mono text-xs">{item.itemId}</TableCell>
                    <TableCell className="max-w-[240px] truncate">{item.displayName || "—"}</TableCell>
                    <TableCell className="font-mono text-xs">{item.upcCode || "—"}</TableCell>
                    <TableCell>
                      {item.alreadyImported ? (
                        <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">Imported</span>
                      ) : (
                        <span className="text-xs text-muted-foreground">Not imported</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        <div className="flex items-center justify-between">
          <Button variant="outline" size="sm" disabled={offset === 0 || loading} onClick={() => goToPage(Math.max(0, offset - limit))}>
            Previous
          </Button>
          <Button variant="outline" size="sm" disabled={!hasMore || loading} onClick={() => goToPage(offset + limit)}>
            Next
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

const AUDIO_TEST_CUES: Array<{
  id: string;
  label: string;
  description: string;
  icon: typeof Volume2;
  play: () => void;
}> = [
  {
    id: "barcode-beep",
    label: "Scan beep",
    description: "Short confirmation chirp on every successful barcode scan.",
    icon: QrCode,
    play: playBarcodeBeep,
  },
  {
    id: "confirm-tone",
    label: "Confirm",
    description: "Task confirmed or completed — put-away, picking, moves, transfers, cycle counts.",
    icon: CheckCircle2,
    play: playConfirmTone,
  },
  {
    id: "attention-tone",
    label: "Attention",
    description: "Needs attention — short pick, cancellation, or rule violation. Flashes the screen and vibrates.",
    icon: AlertTriangle,
    play: playAttentionTone,
  },
  {
    id: "no-go-tone",
    label: "No-go",
    description: "Blocking failure that stops the task — scan mismatch, confirm failed. Loudest, rapid-fire.",
    icon: AlertCircle,
    play: playNoGoTone,
  },
];

export function SettingsPage() {
  const { roles } = useAuth();
  const { toPath } = useTenantPath();
  const { isEnabled } = useFeatureFlags();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const canViewUsersRoles = roles.some((r) => ["developer", "admin", "warehouse_manager", "warehouse_supervisor"].includes(r));
  const isDeveloperOrAdmin = roles.some((r) => ["developer", "admin"].includes(r));
  const queryClient = useQueryClient();
  const requestedTab = searchParams.get("tab");
  const availableSettingsTabs = [
    "warehouse-structure",
    ...(canViewUsersRoles ? ["users-roles"] : []),
    "modules",
    "environment",
    ...(isDeveloperOrAdmin ? ["integrations"] : []),
    ...(isEnabled("clients") ? ["client-vars"] : []),
    "about",
    "license",
  ];
  const defaultSettingsTab = requestedTab && availableSettingsTabs.includes(requestedTab)
    ? requestedTab
    : "warehouse-structure";
  const [activeSettingsTab, setActiveSettingsTab] = useState(defaultSettingsTab);
  const warehouseStructureActive = activeSettingsTab === "warehouse-structure";

  const resetMutation = useMutation({
    mutationFn: resetWmsData,
    onSuccess: async (result) => {
      const removed =
        (result as { deleted_users?: number; removed_users?: number } | null)?.removed_users ??
        (result as { deleted_users?: number; removed_users?: number } | null)?.deleted_users ??
        0;
      toast.success(`Reset complete. Removed ${removed} user account${removed === 1 ? "" : "s"}.`);
      await invalidateWarehouseData(queryClient);
      navigate(toPath("/setup-wizard"));
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Reset failed"),
  });
  const [resetOpen, setResetOpen] = useState(false);
  const [resetChallenge, setResetChallenge] = useState("");
  const resetReady = resetChallenge.trim() === "RESET ALL";

  const deleteProductsMutation = useMutation({
    mutationFn: deleteAllProducts,
    onSuccess: async (result) => {
      const deleted = (result as { deleted?: number } | null)?.deleted ?? 0;
      toast.success(`Deleted ${deleted} product${deleted === 1 ? "" : "s"}. Warehouse structure preserved.`);
      await invalidateWarehouseData(queryClient);
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Product delete failed"),
  });
  const [deleteProductsOpen, setDeleteProductsOpen] = useState(false);
  const isDeveloper = roles.includes("developer");

  return (
    <div className={cn("flex flex-col gap-6", warehouseStructureActive && "h-full min-h-0 overflow-hidden")}>
      <div className="flex items-center gap-2">
        <h2 className="text-2xl font-semibold">Settings</h2>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-foreground"
              aria-label="Settings overview"
            >
              <Info className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            Warehouse environment, client configuration, and system management.
          </TooltipContent>
        </Tooltip>
      </div>
      <Tabs
        value={activeSettingsTab}
        onValueChange={setActiveSettingsTab}
        className={cn(warehouseStructureActive && "flex min-h-0 flex-1 flex-col")}
      >
        <TabsList className="flex h-auto w-full flex-wrap items-stretch justify-start gap-1 sm:w-fit">
          <TabsTrigger value="warehouse-structure" className="min-h-9 flex-1 gap-1.5 sm:flex-none"><Network className="h-3.5 w-3.5" />Warehouse Structure</TabsTrigger>
          {canViewUsersRoles && (
            <TabsTrigger value="users-roles" className="min-h-9 flex-1 gap-1.5 sm:flex-none"><Users className="h-3.5 w-3.5" />Users & Roles</TabsTrigger>
          )}
          <TabsTrigger value="modules" className="min-h-9 flex-1 sm:flex-none">Modules</TabsTrigger>
          <TabsTrigger value="environment" className="min-h-9 flex-1 sm:flex-none">Environment</TabsTrigger>
          {isDeveloperOrAdmin && (
            <TabsTrigger value="integrations" className="min-h-9 flex-1 gap-1.5 sm:flex-none"><Network className="h-3.5 w-3.5" />Integrations</TabsTrigger>
          )}
          {isEnabled("clients") && (
            <TabsTrigger value="client-vars" className="min-h-9 flex-1 sm:flex-none">Client Variables</TabsTrigger>
          )}
          <TabsTrigger value="about" className="min-h-9 flex-1 gap-1.5 sm:flex-none"><Info className="h-3.5 w-3.5" />About</TabsTrigger>
          <TabsTrigger value="license" className="min-h-9 flex-1 gap-1.5 sm:flex-none"><FileText className="h-3.5 w-3.5" />License</TabsTrigger>
        </TabsList>

        <TabsContent value="modules" className="mt-4">
          <ModulesSettingsPanel isAdmin={isDeveloperOrAdmin} />
        </TabsContent>

        <TabsContent value="environment" className="mt-4 grid gap-6 xl:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Environment & Setup</CardTitle>
              <CardDescription>Use the setup wizard to build the warehouse structure. Forms start blank; nothing is seeded automatically.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 text-sm text-muted-foreground">
              <p>1. Keep users and role assignments in place.</p>
              <p>2. Launch the warehouse setup wizard to define warehouses, zones, and location rules.</p>
              <p>3. Demo operational data (clients, products, pallets, receipts) is opt-in for developers only on the final step.</p>
              <div className="flex flex-wrap gap-2 pt-2">
                <Button asChild>
                  <Link to={toPath("/setup-wizard")}>Open warehouse setup wizard</Link>
                </Button>
                <Button variant="outline" asChild>
                  <Link to={toPath("/system-log")}>View system log</Link>
                </Button>
                <Button variant="destructive" onClick={() => { setResetChallenge(""); setResetOpen(true); }} disabled={resetMutation.isPending || !isDeveloperOrAdmin}>
                  {resetMutation.isPending ? <Loader2 className="animate-spin" /> : <RotateCcw data-icon="inline-start" />}
                  Reset all
                </Button>
                {isDeveloper && (
                  <Button variant="outline" className="border-destructive text-destructive hover:bg-destructive/10" onClick={() => setDeleteProductsOpen(true)} disabled={deleteProductsMutation.isPending}>
                    {deleteProductsMutation.isPending ? <Loader2 className="animate-spin" /> : <PackageX data-icon="inline-start" />}
                    Delete products
                  </Button>
                )}
              </div>
              {!isDeveloperOrAdmin ? <p>Only admins and developers can run Reset All.</p> : null}
              {isDeveloper && <p className="text-xs text-muted-foreground">Delete products is dev-only — removes all products and inventory, preserves warehouse structure.</p>}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Volume2 className="h-4 w-4" />
                Audio & Alerts
              </CardTitle>
              <CardDescription>Every sound cue used across the app, in one place — play each one to test speaker volume and confirm alerts are audible on the warehouse floor.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-2 sm:grid-cols-2">
              {AUDIO_TEST_CUES.map((cue) => (
                <div key={cue.id} className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/40 px-3 py-2">
                  <div className="min-w-0">
                    <p className="flex items-center gap-1.5 text-sm font-medium text-foreground"><cue.icon className="h-3.5 w-3.5 shrink-0" />{cue.label}</p>
                    <p className="text-xs text-muted-foreground">{cue.description}</p>
                  </div>
                  <Button type="button" size="sm" variant="outline" onClick={cue.play}>
                    <Play data-icon="inline-start" />
                    Play
                  </Button>
                </div>
              ))}
            </CardContent>
          </Card>
          <Dialog open={resetOpen} onOpenChange={(o) => { if (!resetMutation.isPending) setResetOpen(o); }}>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle className="text-destructive">Reset all warehouse data</DialogTitle>
                <DialogDescription>This action is permanent and cannot be undone.</DialogDescription>
              </DialogHeader>
              <div className="grid gap-3 text-sm">
                <p className="font-medium">What will happen:</p>
                <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
                  <li>All warehouses, zones, locations, and products will be deleted.</li>
                  <li>All clients, pallets, inventory, orders, picks, transfers, and counts will be deleted.</li>
                  <li>All printed labels, templates, integrations, AI recommendations, and reports will be cleared.</li>
                  <li>All audit history and system logs will be cleared.</li>
                  <li><strong>All users except developer accounts</strong> will be removed and must be re-created by an Admin or Dev user.</li>
                </ul>
                <div className="grid gap-1.5 pt-2">
                  <label htmlFor="reset-challenge" className="text-sm font-medium">Type <span className="font-mono font-semibold">RESET ALL</span> to confirm</label>
                  <Input id="reset-challenge" value={resetChallenge} onChange={(e) => setResetChallenge(e.target.value)} autoComplete="off" autoFocus />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setResetOpen(false)} disabled={resetMutation.isPending}>Cancel</Button>
                <Button
                  variant="destructive"
                  disabled={!resetReady || resetMutation.isPending}
                  onClick={() => { resetMutation.mutate(undefined, { onSettled: () => setResetOpen(false) }); }}
                >
                  {resetMutation.isPending ? <Loader2 className="animate-spin" /> : null}
                  Reset everything
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          <Dialog open={deleteProductsOpen} onOpenChange={(o) => { if (!deleteProductsMutation.isPending) setDeleteProductsOpen(o); }}>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle className="text-destructive">Delete all products</DialogTitle>
                <DialogDescription>Developer-only. Warehouse structure is preserved.</DialogDescription>
              </DialogHeader>
              <div className="grid gap-3 text-sm">
                <p className="font-medium">What will be deleted:</p>
                <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
                  <li>All products and their external sync mappings.</li>
                  <li>All inventory balances, pallets, and lot/batch records linked to those products.</li>
                  <li>All receipts, putaway tasks, pick lists, transfers, and cycle counts that reference those products.</li>
                </ul>
                <p className="font-medium">What is preserved:</p>
                <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
                  <li>All warehouses, zones, and locations.</li>
                  <li>All users, roles, and client records.</li>
                  <li>System settings, label templates, and printer stations.</li>
                </ul>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setDeleteProductsOpen(false)} disabled={deleteProductsMutation.isPending}>Cancel</Button>
                <Button
                  variant="destructive"
                  disabled={deleteProductsMutation.isPending}
                  onClick={() => { deleteProductsMutation.mutate(undefined, { onSettled: () => setDeleteProductsOpen(false) }); }}
                >
                  {deleteProductsMutation.isPending ? <Loader2 className="animate-spin" /> : null}
                  Delete all products
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </TabsContent>

        {isEnabled("clients") && (
          <TabsContent value="client-vars" className="mt-4">
            <ClientVariablesPanel />
          </TabsContent>
        )}

        {canViewUsersRoles && (
          <TabsContent value="users-roles" className="mt-4">
            <UsersRolesPage />
          </TabsContent>
        )}

        <TabsContent value="warehouse-structure" className="mt-4 min-h-0 flex-1 data-[state=active]:flex">
          <div className="flex min-h-0 flex-1 flex-col">
            <WarehouseStructureTab />
          </div>
        </TabsContent>

        {isDeveloperOrAdmin && (
          <TabsContent value="integrations" className="mt-4 grid gap-6 xl:grid-cols-2">
            <NetSuiteIntegrationCard />
            <NetSuiteWarehouseMappingCard />
            <NetSuiteImportCard />
          </TabsContent>
        )}

        <TabsContent value="about" className="mt-4 grid gap-6 xl:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Info className="h-4 w-4" />
                Warehouse Wizard Enterprise WMS
              </CardTitle>
              <CardDescription>Version history and feature register.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 text-sm">
              <div className="flex items-center justify-between rounded-lg border border-border bg-muted/40 px-3 py-2">
                <span className="font-medium">Current version</span>
                <span className="font-mono text-xs font-semibold text-primary">v{__APP_VERSION__}</span>
              </div>
              {[
                {
                  version: "1.27",
                  date: "August 2026",
                  changes: [
                    "Notifications: RF connectivity notices and reorder alerts now share one header bell, with grouped sections and a single combined count",
                    "Receiving: the container scanner is AI-assisted — when on-device text recognition cannot read the container face, a photo is analysed by AI and the ISO 6346 number is offered for confirmation",
                    "Container scanning: every AI or OCR read is still check-digit validated and must be confirmed before it is inserted into the container number field",
                    "Help Center: Receiving and notification topics updated for AI-assisted container capture and the unified alert bell",
                  ],
                },
                {
                  version: "1.26",
                  date: "July 2026",
                  changes: [
                    "Warehouse Structure: the page frame now stays fixed while only the warehouse tree scrolls, keeping Settings, tabs, search, and Collapse all in view",
                    "Warehouse Structure: Reorder Settings now opens from each warehouse action menu, keeping forecasting configuration beside the warehouse hierarchy",
                    "Reorder Forecasting: existing demand look-back, safety lead time, alert threshold, and notification controls are preserved in the new popup",
                  ],
                },
                {
                  version: "1.25",
                  date: "July 2026",
                  changes: [
                    "Cycle Counts: supervisor review now separates over-threshold variances from count exceptions, with required notes before approving, rejecting, accepting, or returning a line to blind entry",
                    "Cycle Counts: count numbers now use the CCT sequence format, cancelled counts can be archived, and count lists distinguish review, approved, cancelled, and archived work",
                    "Inventory freezes: cycle-count close, cancel, and review paths now preserve freeze relationships and release held stock consistently after count decisions",
                    "Dashboard resilience: older databases without dashboard preference tables now load with safe defaults instead of breaking the Command Center",
                    "Users & Roles: Developer role assignments now remember the original grantor, and only that developer can remove the Developer role later",
                    "Account safety: users can no longer disable their own account; the edit control and database trigger both enforce the guardrail",
                  ],
                },
                {
                  version: "1.24",
                  date: "July 2026",
                  changes: [
                    "Floor connectivity safety: live put-away, pick, receiving, and cycle-count commits now freeze immediately when a device goes offline instead of replaying stale work later",
                    "Task resume: put-away, pick execution, receiving entry, and cycle-count text entry now keep the operator's local position on the device through reconnects",
                    "Put-Away: reconnect now refreshes live task, pallet, and location state and can force a safe reselect or task reset when the warehouse record has changed",
                    "System Log: critical RF disconnect entries now raise a dismissible red supervisor toast that requires typing ACK before acknowledgement",
                    "Offline queue safety: legacy buffered commit items are moved to dead-letter review instead of being auto-posted back into live warehouse state",
                  ],
                },
                {
                  version: "1.23",
                  date: "June 2026",
                  changes: [
                    "Location Labels: printed and previewed location labels now show only the local rack-bay-level code, while warehouse, zone, aisle, bay, level, type, and temperature remain available as label context",
                    "Bin Locations: single-position rack labels omit the unnecessary P1 suffix; P1/P2 remains available only when a bay-level has multiple side-by-side positions",
                    "Settings: creation workflows were QA checked in external Chrome with direct typed input rather than clipboard-based browser filling",
                  ],
                },
                {
                  version: "1.22",
                  date: "June 2026",
                  changes: [
                    "Receiving: New Shipment now follows a scanner-first vertical entry flow from container, to PO, to product, quantities, expiry, and optional lot details",
                    "Receiving: container camera scanning can read printed container text, validate ISO 6346 check digits, show a green confirmed candidate, and insert it into the form",
                    "Receiving: product scans select the SKU, then focus a highlighted right-arrow commit button before moving to Total received",
                    "Receiving: quantity fields preserve manual typing, support Enter-to-advance, and can suggest learned quantity-per-pallet values after prior receipts",
                    "Receiving: expiry selection now uses a larger app calendar picker for clearer mobile date entry",
                    "Build: switched Vite from the SWC React plugin to @vitejs/plugin-react after the scanner update",
                  ],
                },
                {
                  version: "1.21",
                  date: "June 2026",
                  changes: [
                    "Pick Execution: whole-pallet picks are enforced so operators confirm the assigned pallet quantity instead of entering partial quantities",
                    "Pick Execution: rack instructions now use short four-part location codes with the warehouse context removed from the scanned/displayed location string",
                    "Pick Lists: scanner-first create mode lets operators add product lines by scanning products repeatedly before editing quantities, client, order, and release details",
                    "Pick Execution: the confirm button flashes yellow after the pallet scan and locks the scan fields until the operator confirms or the backend returns an error",
                    "Help Center: added operator what-to-do guidance and a documented gap list for dead ends that still need live exception resolution",
                  ],
                },
                {
                  version: "1.2.0",
                  date: "June 2026",
                  changes: [
                    "Location Moves: Browse bays button next to the location scanner opens the bay selector (with warehouse picker when more than one facility is active)",
                    "Location Moves: pallet and location codes are trimmed/normalised before lookup so valid pallets are no longer reported as missing",
                    "Warehouse Structure tool: dedicated tab and Help topic for the live tree view of warehouses, zones, aisles, bays, and locations",
                    "Help Center: per-module topics refreshed to cover browse-bay flows, label sheets, badge sign-in, access controls, and the Warehouse Structure tool",
                    "Promoted from 1.1.8 beta: shortened bay codes open the bay selector in Put-Away and Pick; Bin Locations column order; Avery 99x38 location label sheets; Avery 99x93 bay/zone aisle sheets; trusted-device badge PIN limited to mobile/tablet; public Request Access removed in favour of admin-managed accounts",
                  ],
                },
                {
                  version: "1.1.7",
                  date: "May 2026",
                  changes: [
                    "Labels: every printed code is now a QR (pallet, location, zone, warehouse) for faster, more reliable scans",
                    "Inventory Search: horizontal scrolling restored so all columns are reachable on narrow screens",
                    "Products: total on-hand quantity shown beside each product name (read-only)",
                    "Navigation: desktop sidebar only mounts in landscape; portrait and tablets use the top slide-in nav. Help is always the last item",
                    "Sidebar: squishy press feedback on nav buttons and tighter responsive width before the scrollbar kicks in",
                    "Bin Locations: Edit Location now saves Notes and Max height correctly (field-name mismatch fixed)",
                    "Bin Locations & Zones: bulk label sheets — filter the table, then Print labels sheet (paper size, grid, start cell)",
                    "Access requests: admins, supervisors, and managers see a full-screen prompt when pending users are awaiting approval, with a one-click jump to Users & Roles",
                  ],
                },
                {
                  version: "1.1.6",
                  date: "May 2026",
                  changes: [
                    "Pick Lists: product selector now only shows items with available quantity assigned to a location — zero-qty and unlocated stock are hidden",
                    "Inventory Search: removed the secondary location/zone scan filter bar (warehouse filter remains)",
                    "Dashboard: put-away count now matches what managers see on the Put-Away page; all roles see tasks correctly",
                    "Seeded task data (putaway, move tasks, cycle counts) cleaned up via migration",
                    "Password: all users can change their own password from the nav header; admin cannot change developer passwords",
                    "Developer and Warehouse Supervisor roles added; password RPCs extended to allow developer role",
                  ],
                },
                {
                  version: "1.1.3",
                  date: "May 2026",
                  changes: [
                    "Command Center: all Floor, Dock, and Office tiles are draggable and resizable",
                    "Command Center: summary metrics and workflow tiles now share one dynamic layout surface per view",
                    "Command Center: tile size and position preferences are remembered per signed-in user when available",
                    "Navigation: Users shortcut removed from the sidebar while admin user management remains in Settings",
                    "Dashboard: pallet dials, workflow queues, Warehouse Intelligence, Dock lanes, Office widgets, and Warehouse Brain use the same tile controls",
                  ],
                },
                {
                  version: "1.1.2",
                  date: "May 2026",
                  changes: [
                    "Inventory Search: fixed header and filter shell with row-only result scrolling",
                    "Inventory Search: warehouse scope matching now includes live warehouse, zone, aisle, and location codes",
                    "Bin Locations: generated and migrated codes now preserve warehouse, zone, and location hierarchy",
                    "Location Labels: full hierarchy codes with QR output for complex location codes",
                    "Put-Away: clearer location confirmation fields and aligned desktop task confirmation",
                    "Tables: editable and detail rows now require double-click or double-tap before opening",
                  ],
                },
                {
                  version: "1.1.1",
                  date: "May 2026",
                  changes: [
                    "Fix: Draft receipts now save correctly (notes column, not metadata)",
                    "Fix: Receive & Create Pallet works without expanding Show More — client field always visible",
                    "Fix: Pick list creation initialises all required fields correctly",
                    "Fix: Move to Picking correctly resolves pallet barcodes",
                    "Admin: Pick lists can now be cleared, archived, or deleted",
                    "Settings: Users & Roles management accessible from Settings (admin tab)",
                    "Help: Articles filtered by your role and enabled modules",
                  ],
                },
                {
                  version: "1.1.0",
                  date: "May 2026",
                  changes: [
                    "Inline row editing — double-click or click the pencil icon on any resource table row",
                    "Compact table rows with alternating shading on all data tables",
                    "Sticky table headers — column headers remain visible while scrolling",
                    "Full horizontal overflow scrolling on wide tables",
                    "Bin Locations table: operational columns (Code, Aisle, Bay, Type, Status) promoted to front; Warehouse/Zone moved to overflow",
                    "Mobile menu: nav item click now dismisses the menu automatically",
                    "Mobile menu: sign-out button moved to its own row, no longer clashes with the close control",
                    "Back button on Inventory Detail and Pick Execution pages",
                    "Settings — new About tab with version history and feature register",
                  ],
                },
                {
                  version: "1.0.0",
                  date: "May 2026",
                  changes: [
                    "Full warehouse master data — Warehouses, Zones, Bin Locations (bulk wizard), Clients, Products, Packaging Profiles",
                    "Receiving workflow — manual, purchase order, and transfer receipt types with lot/expiry capture",
                    "Directed putaway with temperature and capacity validation",
                    "Inventory search and pallet-level detail with full movement history",
                    "Pick lists with FIFO/FEFO rotation allocation and shortage capture",
                    "Inter-warehouse transfers with driver sign-off",
                    "Cycle counts — location, zone, SKU, and spot scope with variance thresholds",
                    "Pallet status controls — hold, quarantine, damaged, missing",
                    "Multi-mode dashboard — Floor, Dock, and Office views with drag-reorder metric cards",
                    "Reports with inventory, occupancy, and cycle count variance exports",
                    "Role-based access — Admin, Warehouse Manager, Inventory Clerk, Warehouse Operator, Dispatch Driver",
                    "Barcode label printing with QR code preview",
                    "Complete audit trail on all operational events",
                    "Setup wizard for warehouse, zone, and location bulk creation",
                    "Help centre with contextual sidebar and searchable articles",
                    "PWA — installable on mobile and desktop with offline indicator",
                  ],
                },
              ].map((release) => (
                <div key={release.version} className="rounded-lg border border-border p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="font-mono text-xs font-semibold bg-primary/10 text-primary rounded px-1.5 py-0.5">v{release.version}</span>
                    <span className="text-xs text-muted-foreground">{release.date}</span>
                  </div>
                  <ul className="grid gap-1">
                    {release.changes.map((c) => (
                      <li key={c} className="text-xs text-muted-foreground flex gap-2">
                        <span className="mt-0.5 shrink-0 text-primary">•</span>
                        {c}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Feature Register</CardTitle>
              <CardDescription>All active feature areas in this deployment.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-2 text-sm">
              {[
                ["Warehouses", "Multi-facility master data with cool zone flags"],
                ["Zones", "Temperature-classed storage and workflow zones per warehouse"],
                ["Bin Locations", "Rack, staging, dispatch, quarantine, and floor slots with capacity rules"],
                ["Clients", "3PL customer master with stock-sharing and expiry policies"],
                ["Products", "SKU master with rotation method, temperature class, and lot tracking"],
                ["Packaging Profiles", "Unit, carton, pallet pack forms with dimensions and barcodes"],
                ["Receiving", "Manual, PO, and transfer inbound with lot/expiry capture and putaway queuing"],
                ["Put-Away", "Directed put-away with temperature, capacity, and height validation"],
                ["Inventory Search", "Live pallet lookup by SKU, barcode, lot, location, or pallet code"],
                ["Pick Lists", "Rotation-aware pick wave creation with shortage capture"],
                ["Transfers", "Inter-warehouse moves with pallet identity preservation and driver sign-off"],
                ["Cycle Counts", "Periodic counts by location, zone, SKU, or spot with variance reporting"],
                ["Status Controls", "Pallet hold, quarantine, damaged, missing with reason audit"],
                ["Dashboard", "Floor, Dock, and Office modes with draggable metric cards"],
                ["Reports", "Inventory, occupancy, and cycle count exports"],
                ["Users & Roles", "Admin/Dev user creation, role scope, and trusted-device badge login"],
                ["System Log", "Full audit trail viewer with severity filtering and resolve workflow"],
                ["Help Centre", "Contextual help sidebar and searchable article wiki"],
              ].map(([feature, desc]) => (
                <div key={feature} className="flex items-start gap-2 rounded border border-border px-3 py-1.5">
                  <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-green-500" />
                  <div>
                    <p className="font-medium leading-snug">{feature}</p>
                    <p className="text-[11px] text-muted-foreground">{desc}</p>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="license" className="mt-4">
          <LicenseAgreementTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ClientVariablesPanel() {
  const queryClient = useQueryClient();
  const { data: options } = useQuery({ queryKey: ["options"], queryFn: () => fetchOptions() });
  const { data: variables = [], isLoading } = useQuery({
    queryKey: ["client-variables"],
    queryFn: () => listClientVariables(),
  });
  const [open, setOpen] = useState(false);
  const [editVar, setEditVar] = useState<any | null>(null);
  const form = useForm({
    defaultValues: { client_id: "", key: "", value: "", variable_type: "text", description: "" },
  });

  const saveMutation = useMutation({
    mutationFn: (values: any) => upsertClientVariable({ ...(editVar ? { id: editVar.id } : {}), ...values }),
    onSuccess: () => {
      toast.success("Variable saved");
      queryClient.invalidateQueries({ queryKey: ["client-variables"] });
      form.reset({ client_id: "", key: "", value: "", variable_type: "text", description: "" });
      setEditVar(null);
      setOpen(false);
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Save failed"),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteClientVariable,
    onSuccess: () => {
      toast.success("Variable removed");
      queryClient.invalidateQueries({ queryKey: ["client-variables"] });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Delete failed"),
  });

  function openAdd() {
    setEditVar(null);
    form.reset({ client_id: "", key: "", value: "", variable_type: "text", description: "" });
    setOpen(true);
  }

  function openEdit(v: any) {
    setEditVar(v);
    form.reset({ client_id: v.client_id, key: v.key, value: v.value, variable_type: v.variable_type, description: v.description ?? "" });
    setOpen(true);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="font-medium">Client Variables</p>
          <p className="text-sm text-muted-foreground">Per-client configuration values such as rates, thresholds, and operational flags.</p>
        </div>
        <Button onClick={openAdd}>
          <Plus data-icon="inline-start" />
          Add variable
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <TableFrame>
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-card">
                <TableRow>
                  <TableHead>Client</TableHead>
                  <TableHead>Key</TableHead>
                  <TableHead>Value</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="w-24" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow><TableCell className="h-24 text-center text-muted-foreground" colSpan={6}>Loading…</TableCell></TableRow>
                ) : variables.length === 0 ? (
                  <TableRow><TableCell className="h-24 text-center text-muted-foreground" colSpan={6}>No client variables configured. Add one to get started.</TableCell></TableRow>
                ) : (
                  variables.map((v: any) => (
                    <TableRow key={v.id} className="even:bg-muted/30">
                      <TableCell className="font-medium">{v.clients?.code ?? "—"}</TableCell>
                      <TableCell className="font-mono text-sm">{v.key}</TableCell>
                      <TableCell className="max-w-xs truncate">{v.value}</TableCell>
                      <TableCell><Badge variant="secondary">{v.variable_type}</Badge></TableCell>
                      <TableCell className="text-muted-foreground">{v.description ?? "—"}</TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button size="sm" variant="ghost" onClick={() => openEdit(v)}>Edit</Button>
                          <Button size="sm" variant="ghost" onClick={() => deleteMutation.mutate(v.id)}>Remove</Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </TableFrame>
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editVar ? "Edit variable" : "Add client variable"}</DialogTitle>
            <DialogDescription>Configure a key/value setting for a specific client.</DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form className="grid gap-4" onSubmit={form.handleSubmit((v) => saveMutation.mutate(v))}>
              <FormField control={form.control} name="client_id" render={({ field }) => (
                <FormItem>
                  <FormLabel>Client</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value ?? ""}>
                    <FormControl><SelectTrigger><SelectValue placeholder="Select client" /></SelectTrigger></FormControl>
                    <SelectContent>
                      {(options?.clients ?? []).map((c: any) => (
                        <SelectItem key={c.id} value={c.id}>{c.code} · {c.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="key" render={({ field }) => (
                <FormItem>
                  <FormLabel>Key</FormLabel>
                  <FormControl><Input {...field} placeholder="e.g. handling_rate_per_pallet" className="font-mono" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="value" render={({ field }) => (
                <FormItem>
                  <FormLabel>Value</FormLabel>
                  <FormControl><Input {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="variable_type" render={({ field }) => (
                <FormItem>
                  <FormLabel>Type</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value ?? "text"}>
                    <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                    <SelectContent>
                      {["text", "number", "boolean", "date", "json"].map((t) => (
                        <SelectItem key={t} value={t}>{t}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="description" render={({ field }) => (
                <FormItem>
                  <FormLabel>Description (optional)</FormLabel>
                  <FormControl><Input {...field} placeholder="What this variable controls" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <Button type="submit" disabled={saveMutation.isPending}>
                {saveMutation.isPending ? <Loader2 className="animate-spin" /> : null}
                Save variable
              </Button>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

