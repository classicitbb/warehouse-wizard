// Users & Roles: user list, invites, role assignment and role history.
// Rendered as its own route and as the Settings "Users & Roles" tab.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Activity, AlertTriangle, CheckCircle2, CircleOff, Eye, EyeOff, Loader2, ShieldCheck, UserPlus, Users } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { useAuth } from "@/hooks/use-auth";
import { type AdminInviteUserInput, adminInviteUser, adminUpdateUserPin, adminUpdateUserPassword, adminSignOutAllSessions, removeUserRoleAssignment, listUserRoleEvents, fetchOptions, formatDate, listUserActivities, setProfileActive, updateProfileDetails, updateRecord, upsertRecord, assignUserRole, writeSystemLog, buildCorrelationId, type AdminOptionKey, type AdminOptionLoadError } from "@/lib/wms-core";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { TableFrame } from "@/features/shared/resource-forms";
import { WarehouseOption, ProfileRow, UserActivityRow } from "@/features/shared/ui-shared";
import { UserProfileRow } from "@/features/admin/user-profile-row";

const inviteUserSchema = z.object({
  email: z.string().email("Valid email required"),
  full_name: z.string().min(1, "Full name required"),
  password: z.string().min(8, "Min 8 characters"),
  role_code: z.string().optional().default(""),
  warehouse_id: z.string().optional().default(""),
});

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

const SECTION_LABELS: Partial<Record<AdminOptionKey, string>> = {
  profiles: "Users",
  userRoles: "Access",
  roles: "Access",
  permissionFeatures: "Role Matrix",
  rolePermissions: "Role Matrix",
  warehouses: "Warehouses",
};

const ROLE_EVENT_LABELS: Record<string, string> = {
  assigned: "Assigned",
  archived: "Archived",
  unarchived: "Restored",
  removed: "Removed",
  warehouse_changed: "Warehouse changed",
};

function RoleHistoryList({ profiles }: { profiles: any[] }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["user-role-events"],
    queryFn: () => listUserRoleEvents(100),
    staleTime: 60_000,
  });

  const nameFor = (id: string | null) => {
    if (!id) return "System";
    const profile = profiles.find((p) => p.id === id);
    return profile?.full_name ?? profile?.email ?? "Unknown user";
  };

  if (isLoading) {
    return (
      <p className="flex items-center gap-2 px-6 py-4 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading role history…
      </p>
    );
  }
  if (error) {
    return <p className="px-6 py-4 text-sm text-muted-foreground">Role history could not be loaded.</p>;
  }
  if (!data || data.length === 0) {
    return <p className="px-6 py-4 text-sm text-muted-foreground">No role changes recorded yet.</p>;
  }

  return (
    <div className="max-h-96 divide-y divide-border overflow-y-auto border-t border-border">
      {data.map((event) => (
        <div key={event.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm">
          <div className="min-w-0">
            <p className="truncate font-medium">
              {ROLE_EVENT_LABELS[event.action] ?? event.action} · {event.role_code ?? "role"}
            </p>
            <p className="truncate text-xs text-muted-foreground">
              {nameFor(event.user_id)} · changed by {nameFor(event.actor_id)}
            </p>
          </div>
          <span className="shrink-0 text-xs text-muted-foreground">
            {new Date(event.created_at).toLocaleString()}
          </span>
        </div>
      ))}
    </div>
  );
}

function UsersRolesPageImpl() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { profile: viewerProfile, roles } = useAuth();

  const canOperateRoles = roles.some((r) => ["developer", "admin"].includes(r));
  const canOperateDeveloperRole = roles.includes("developer");
  const [includeHidden, setIncludeHidden] = useState(false);
  const optionsQuery = useQuery({ queryKey: ["options", includeHidden], queryFn: () => fetchOptions(includeHidden) });
  const options = optionsQuery.data;
  const { data: activities = [], error: activitiesError } = useQuery({ queryKey: ["user-activities"], queryFn: () => listUserActivities() });
  // Users / Access / Role Matrix all hang off the same query. A single failing
  // table used to blank every tab with nothing logged, so each table now fails
  // (and retries) on its own and is surfaced here.
  const optionsError = optionsQuery.error;
  const loadErrors = useMemo<AdminOptionLoadError[]>(() => {
    if (optionsError) {
      const raw = optionsError as { message?: string; code?: string; details?: string; hint?: string };
      return [
        {
          key: "profiles",
          table: "users & roles",
          message: optionsError instanceof Error ? optionsError.message : String(optionsError),
          code: raw?.code,
          details: raw?.details,
          hint: raw?.hint,
          correlationId: buildCorrelationId(),
        },
      ];
    }
    return options?.loadErrors ?? [];
  }, [optionsError, options]);
  const [retrying, setRetrying] = useState(false);

  const retryFailedSections = useCallback(async () => {
    if (loadErrors.length === 0) return;
    setRetrying(true);
    try {
      const failedKeys = Array.from(new Set(loadErrors.map((entry) => entry.key)));
      // Refetch only the tables that failed and merge them into the cached
      // option set so the healthy sections aren't re-downloaded.
      const partial = await fetchOptions(includeHidden, undefined, failedKeys);
      queryClient.setQueryData(["options", includeHidden], (previous: any) => {
        const base = previous ?? partial;
        const merged = { ...base } as any;
        for (const key of failedKeys) merged[key] = (partial as any)[key];
        merged.loadErrors = [
          ...((base.loadErrors ?? []) as AdminOptionLoadError[]).filter((entry) => !failedKeys.includes(entry.key)),
          ...partial.loadErrors,
        ];
        return merged;
      });
      if (optionsError) await optionsQuery.refetch();
      if (partial.loadErrors.length === 0) toast.success("Reloaded successfully");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Retry failed");
    } finally {
      setRetrying(false);
    }
  }, [loadErrors, includeHidden, queryClient, optionsError, optionsQuery]);

  const loggedCorrelationIds = useRef(new Set<string>());
  useEffect(() => {
    for (const entry of loadErrors) {
      if (loggedCorrelationIds.current.has(entry.correlationId)) continue;
      loggedCorrelationIds.current.add(entry.correlationId);
      toast.error(`${SECTION_LABELS[entry.key] ?? entry.table} failed to load: ${entry.message}`);
      void writeSystemLog({
        log_type: "error",
        severity: "error",
        title: "User management data failed to load",
        message: `[${entry.correlationId}] ${entry.table}: ${entry.message}`,
        source: "settings.users-roles",
        details: {
          correlation_id: entry.correlationId,
          table: entry.table,
          section: SECTION_LABELS[entry.key] ?? entry.key,
          includeHidden,
          error: entry.message,
          code: entry.code ?? null,
          details: entry.details ?? null,
          hint: entry.hint ?? null,
        },
      }).catch((logError) => console.error("system log write failed", logError));
    }
  }, [loadErrors, includeHidden]);
  useEffect(() => {
    if (!activitiesError) return;
    const message = activitiesError instanceof Error ? activitiesError.message : String(activitiesError);
    toast.error(`User activity failed to load: ${message}`);
    void writeSystemLog({
      log_type: "error",
      severity: "error",
      title: "User activity failed to load",
      message,
      source: "settings.users-roles",
      details: { error: message },
    }).catch((logError) => console.error("system log write failed", logError));

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
      queryClient.invalidateQueries({ queryKey: ["user-role-events"] }),
    ]);
  }, [queryClient]);

  const assignMutation = useMutation({
    mutationFn: async () => assignUserRole(selectedProfile, selectedRole),
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

  /**
   * The public/locked switch for a whole module. Role permissions say who may
   * use a feature; `is_released` says whether anyone but a developer sees it at
   * all, which is how the Packing tab stays locked until it is ready.
   */
  const updateFeatureRelease = async (featureId: string, released: boolean) => {
    if (!canOperateRoles) return;
    const key = `${featureId}:is_released`;
    setPermissionSaving(key);
    try {
      // An upsert here would be an INSERT ... ON CONFLICT with only two
      // columns, which the table's NOT NULL code/name reject; this row always
      // exists, so update it directly.
      await updateRecord("permission_features", featureId, { is_released: released });
      await invalidateOptions();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Release update failed");
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

      {loadErrors.length > 0 ? (
        <div className="flex flex-col gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="flex-1 space-y-1">
              <p className="font-medium">
                {loadErrors.map((entry) => SECTION_LABELS[entry.key] ?? entry.table).join(", ")} could not be loaded.
              </p>
              {loadErrors.map((entry) => (
                <p key={entry.correlationId} className="text-xs opacity-90">
                  <span className="font-mono">{entry.correlationId}</span> · {entry.table}
                  {entry.code ? ` · ${entry.code}` : ""} · {entry.message}
                  {entry.hint ? ` · hint: ${entry.hint}` : ""}
                </p>
              ))}
            </div>
            <Button size="sm" variant="outline" disabled={retrying} onClick={() => void retryFailedSections()}>
              {retrying ? "Retrying…" : "Retry"}
            </Button>
          </div>
          <div>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-xs"
              onClick={() => navigate("/system-log?source=settings.users-roles")}
            >
              View in System Logs
            </Button>
          </div>
        </div>
      ) : null}




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

            <Card className="xl:col-span-full">
              <CardHeader>
                <CardTitle className="text-base">Role history</CardTitle>
                <CardDescription>Who changed which role, and when.</CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                <RoleHistoryList profiles={profiles} />
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
                      <TableHead className="min-w-[110px] text-center">
                        <div className="font-semibold">Released</div>
                        <div className="mt-1 text-[11px] font-normal text-muted-foreground">Visible to non-developers</div>
                      </TableHead>
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
                        <TableCell className="text-center">
                          <Switch
                            checked={feature.is_released !== false}
                            disabled={!canOperateRoles || permissionSaving !== null}
                            aria-label={`${feature.name} released to non-developers`}
                            onCheckedChange={(checked) => updateFeatureRelease(feature.id, checked)}
                          />
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
