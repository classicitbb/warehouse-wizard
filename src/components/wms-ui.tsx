import { useCallback, useMemo, useState } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm, type UseFormReturn } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AlertTriangle, ArrowLeft, BarChart3, Bot, Boxes, Building2, Camera, ClipboardCheck, ClipboardList, Download, Eye, EyeOff, FileDown, Forklift, HelpCircle, Home, LayoutDashboard, Loader2, LogOut, MapPinned, Menu, Package, PackageX, PanelLeftClose, PanelLeftOpen, Plus, Printer, QrCode, RadioTower, RotateCcw, Search, Settings, ShieldCheck, Tags, ThumbsDown, Truck, Upload, Users } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";

import { useAuth } from "@/hooks/use-auth";
import {
  NAVIGATION,
  ROLE_LABELS,
  type AdminInviteUserInput,
  type AppRoute,
  type FieldDefinition,
  type ResourceDefinition,
  adminInviteUser,
  changePalletStatus,
  confirmPutaway,
  sendBackToReceiving,
  flagPutawayException,
  cancelTransfer,
  flagCountLineException,
  createCycleCountFlow,
  createPickListFlow,
  createReceiptFlow,
  createTransferFlow,
  dispatchTransfer,
  cycleCountSchema,
  resetWmsData,
  downloadCsv,
  downloadCsvTemplate,
  fetchOptions,
  formatDate,
  formatNumber,
  getDashboardMetrics,
  getWarehouseForLocationBarcode,
  getPutawayTasks,
  getReportData,
  importCsvToResource,
  listUserActivities,
  listCycleCounts,
  listPickLists,
  listRecords,
  listStatusPallets,
  listTransfers,
  pickListSchema,
  receivingSchema,
  receiveTransfer,
  searchInventory,
  setProfileActive,
  updateProfileDetails,
  statusChangeSchema,
  setResourceVisibility,
  setUserRoleVisibility,
  submitCycleCountLine,
  transferSchema,
  upsertRecord,
} from "@/lib/wms-core";

import { cn } from "@/lib/utils";
import {
  buildCsvReportRows,
  buildEnterpriseDashboard,
  generateZplLabel,
  type DashboardMode,
  type DockHandoffLoad,
  type EnterpriseDashboardSnapshot,
  type WarehouseBrainRecommendation,
} from "@/lib/enterprise-wms";
import { HelpSidebar } from "@/components/help-sidebar";
import { ZoneLabelPage } from "@/components/zone-label-page";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerTrigger } from "@/components/ui/drawer";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

const baseFormSchema = z.record(z.any());
const appTitle = "Warehouse Wizard Enterprise WMS";

type ProfileRow = {
  id: string;
  email?: string | null;
  full_name?: string | null;
  phone?: string | null;
  default_warehouse_id?: string | null;
  active?: boolean | null;
  approved?: boolean | null;
  user_code?: string | null;
  badge_code?: string | null;
};

type WarehouseOption = {
  id: string;
  name: string;
};

type UserActivityRow = {
  id: string;
  event_type: string;
  entity_table: string;
  actor_user_id?: string | null;
  created_at: string;
  profiles?: { full_name?: string | null; email?: string | null } | null;
};

const navIcons: Record<AppRoute, typeof LayoutDashboard> = {
  "/": Home,
  "/dashboard": LayoutDashboard,
  "/warehouses": Building2,
  "/zones": Boxes,
  "/locations": MapPinned,
  "/products": Package,
  "/packaging-profiles": Tags,
  "/receiving": Download,
  "/putaway-tasks": Forklift,
  "/inventory-search": Search,
  "/inventory/:balanceId": Search,
  "/pick-lists": ClipboardList,
  "/pick-lists/:pickListId": ClipboardList,
  "/transfers": Truck,
  "/cycle-counts": ClipboardCheck,
  "/status": ShieldCheck,
  "/reports": BarChart3,
  "/users": Users,
  "/settings": Settings,
  "/help": HelpCircle,
  "/setup-wizard": Settings,
};

function TableFrame({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <ScrollArea className={cn("h-[min(65vh,36rem)] w-full", className)}>
      <div className="min-w-0">{children}</div>
    </ScrollArea>
  );
}

function renderField(
  field: FieldDefinition,
  form: ReturnType<typeof useForm<Record<string, unknown>>>,
  options: Array<{ label: string; value: string }> = field.options ?? [],
) {
  return (
    <FormField
      key={field.name}
      control={form.control}
      name={field.name}
      render={({ field: controllerField }) => (
        <FormItem>
          <FormLabel>{field.label}</FormLabel>
          <FormControl>
            {field.type === "textarea" ? (
              <Textarea {...controllerField} value={(controllerField.value as string | undefined) ?? ""} />
            ) : field.type === "select" ? (
              <Select
                onValueChange={controllerField.onChange}
                value={(controllerField.value as string | undefined) ?? undefined}
              >
                <SelectTrigger>
                  <SelectValue placeholder={`Select ${field.label.toLowerCase()}`} />
                </SelectTrigger>
                <SelectContent>
                  {options.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : field.type === "boolean" ? (
              <div className="flex items-center gap-3 rounded-md border border-border px-3 py-2">
                <Checkbox checked={Boolean(controllerField.value)} onCheckedChange={controllerField.onChange} />
                <span className="text-sm text-muted-foreground">Enabled</span>
              </div>
            ) : (
              <Input
                type={field.type === "number" ? "number" : field.type === "date" ? "date" : "text"}
                {...controllerField}
                value={(controllerField.value as string | number | undefined) ?? ""}
              />
            )}
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

function ResourceFormDialog({
  resource,
}: {
  resource: ResourceDefinition;
}) {
  const queryClient = useQueryClient();
  const { roles, profile } = useAuth();
  const [open, setOpen] = useState(false);
  const restrictedToDefaultWarehouse = shouldRestrictToDefaultWarehouse(roles);
  const { data: options } = useQuery({
    queryKey: ["options", resource.table, restrictedToDefaultWarehouse, profile?.default_warehouse_id],
    queryFn: () => fetchOptions(false, { restrictToWarehouse: restrictedToDefaultWarehouse, warehouseId: profile?.default_warehouse_id }),
  });
  const form = useForm<Record<string, unknown>>({
    resolver: zodResolver(baseFormSchema),
    defaultValues: resource.fields.reduce<Record<string, unknown>>((accumulator, field) => {
      accumulator[field.name] = defaultFieldValue(field);
      return accumulator;
    }, {}),
  });

  const createMutation = useMutation({
    mutationFn: async (values: Record<string, unknown>) => upsertRecord(resource.table, normalizeResourceValues(resource, values)),
    onSuccess: () => {
      toast.success(`${resource.singular} saved`);
      queryClient.invalidateQueries({ queryKey: [resource.table] });
      form.reset();
      setOpen(false);
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Save failed");
    },
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus data-icon="inline-start" />
          Add {resource.singular}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-hidden sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Create {resource.singular}</DialogTitle>
          <DialogDescription>{resource.description}</DialogDescription>
        </DialogHeader>
        <ScrollArea className="max-h-[72vh] pr-4">
          <Form {...form}>
            <form
              className="flex flex-col gap-4"
              onSubmit={form.handleSubmit(async (values) => createMutation.mutate(values))}
            >
              {resource.fields.map((field) => renderField(field, form, getResourceFieldOptions(field, options)))}
              <Button type="submit" disabled={createMutation.isPending}>
                {createMutation.isPending ? <Loader2 className="animate-spin" /> : null}
                Save {resource.singular}
              </Button>
            </form>
          </Form>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const { pathname } = useLocation();
  const { profile, roles, signOut, user } = useAuth();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const items = NAVIGATION.filter((item) => item.roles.some((role) => roles.includes(role)));
  const displayName = profile?.full_name?.trim() || user?.email || "Warehouse User";
  const primaryRole = roles[0] ? ROLE_LABELS[roles[0]] : "User";
  const initials = displayName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("") || "WU";

  const navigation = (
    <div className={cn(
      "flex h-full flex-col overflow-hidden bg-sidebar",
      sidebarCollapsed ? "items-center px-2 py-3" : "px-3 py-3"
    )}>
      {/* Logo area */}
      <div className={cn(
        "mb-4 flex items-center gap-3 px-2",
        sidebarCollapsed && "justify-center px-0"
      )}>
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <Warehouse className="h-4 w-4" />
        </div>
        {!sidebarCollapsed && (
          <span className="truncate text-sm font-semibold text-foreground">Warehouse Wizard</span>
        )}
        <Button
          className="ml-auto hidden h-7 w-7 shrink-0 lg:inline-flex"
          size="icon"
          variant="ghost"
          onClick={() => setSidebarCollapsed((c) => !c)}
          aria-label={sidebarCollapsed ? "Expand navigation" : "Collapse navigation"}
        >
          {sidebarCollapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
        </Button>
      </div>

      <nav className="flex-1 overflow-y-auto">
        <div className="flex flex-col gap-0.5">
          {items.map((item) => {
            const Icon = navIcons[item.to] ?? LayoutDashboard;
            const isActive = pathname === item.to;
            const link = (
              <NavLink
                key={item.to}
                className={({ isActive: navActive }) =>
                  cn(
                    "group flex min-h-9 items-center gap-2.5 rounded-md px-2.5 text-sm font-medium transition-all duration-100",
                    sidebarCollapsed && "h-9 w-9 justify-center p-0",
                    navActive || isActive
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                  )
                }
                to={item.to}
                aria-label={item.label}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {sidebarCollapsed ? null : <span className="truncate">{item.label}</span>}
              </NavLink>
            );

            return sidebarCollapsed ? (
              <Tooltip key={item.to}>
                <TooltipTrigger asChild>{link}</TooltipTrigger>
                <TooltipContent side="right">{item.label}</TooltipContent>
              </Tooltip>
            ) : link;
          })}
        </div>
      </nav>

      {/* User profile at bottom */}
      {!sidebarCollapsed && (
        <div className="mt-3 rounded-lg border border-border bg-card/50 p-2.5">
          <div className="flex items-center gap-2.5">
            <Avatar className="h-8 w-8 shrink-0">
              <AvatarFallback className="bg-primary/15 text-xs font-semibold text-primary">{initials}</AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium leading-tight">{displayName}</p>
              <p className="truncate text-xs text-muted-foreground">{primaryRole}</p>
            </div>
            <Button
              className="h-7 w-7 shrink-0 text-muted-foreground"
              size="icon"
              variant="ghost"
              onClick={() => void signOut()}
              title="Sign out"
            >
              <LogOut className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div className="h-screen overflow-hidden bg-background">
      <div
        className={cn(
          "grid h-full w-full grid-cols-1 grid-rows-[auto_minmax(0,1fr)] overflow-hidden lg:grid-rows-1",
          "lg:grid-cols-[240px_minmax(0,1fr)]",
          sidebarCollapsed && "lg:grid-cols-[56px_minmax(0,1fr)]",
        )}
      >
        {/* Mobile header */}
        <header className="col-span-full flex items-center justify-between border-b border-border bg-background/95 px-4 py-3 backdrop-blur lg:hidden">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <Warehouse className="h-4 w-4" />
            </div>
            <span className="text-sm font-semibold">{appTitle}</span>
          </div>
          <div className="flex items-center gap-2">
            <HelpSidebar pathname={pathname} />
            <Sheet>
              <SheetTrigger asChild>
                <Button className="h-9 w-9" size="icon" variant="outline">
                  <Menu className="h-4 w-4" />
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="w-[240px] p-0">
                <SheetHeader className="sr-only">
                  <SheetTitle>Navigation</SheetTitle>
                </SheetHeader>
                {navigation}
              </SheetContent>
            </Sheet>
          </div>
        </header>

        <aside className="hidden h-full overflow-hidden border-r border-border lg:block">{navigation}</aside>

        <main className="flex min-h-0 min-w-0 flex-col overflow-hidden">
          {/* Desktop top bar */}
          <div className="hidden items-center justify-between gap-3 border-b border-border bg-background/95 px-5 py-2.5 backdrop-blur lg:flex">
            <div className="min-w-0">
              <p className="truncate text-xs text-muted-foreground">
                {items.find((item) => item.to === pathname)?.label ?? "Warehouse Wizard Enterprise WMS"}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <HelpSidebar pathname={pathname} />
              <div className="flex items-center gap-2 rounded-lg border border-border bg-card/80 px-2.5 py-1.5 text-sm">
                <Avatar className="h-6 w-6">
                  <AvatarFallback className="bg-primary/10 text-xs font-semibold text-primary">{initials}</AvatarFallback>
                </Avatar>
                <span className="hidden truncate text-xs font-medium sm:block">{displayName}</span>
                <Button className="h-7 shrink-0 text-xs" variant="ghost" size="sm" onClick={() => void signOut()}>
                  <LogOut className="mr-1 h-3 w-3" />
                  Sign out
                </Button>
              </div>
            </div>
          </div>
          <div className="flex-1 min-h-0 min-w-0 overflow-y-auto px-4 py-5 sm:px-5 lg:px-6">{children}</div>
        </main>
      </div>
    </div>
  );
}

export function ResourcePage({
  resource,
}: {
  resource: ResourceDefinition;
}) {
  const [includeHidden, setIncludeHidden] = useState(false);
  const { data = [], isLoading } = useQuery({
    queryKey: [resource.table, includeHidden],
    queryFn: () => listRecords(resource.table, resource.select ?? "*", resource.orderBy, {
      includeHidden,
      archiveField: resource.archiveField,
    }),
  });
  const queryClient = useQueryClient();
  const extraColumnCount = (resource.supportsHide ? 1 : 0) + (["warehouses", "zones"].includes(resource.table) ? 1 : 0);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h2 className="text-2xl font-semibold">{resource.title}</h2>
          <p className="text-sm text-muted-foreground">{resource.description}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {resource.exportable ? (
            <Button variant="outline" onClick={() => downloadCsv(`${resource.table}.csv`, data as Array<Record<string, unknown>>)}>
              <Download data-icon="inline-start" />
              Export CSV
            </Button>
          ) : null}
          {resource.supportsHide ? (
            <Button variant="outline" onClick={() => setIncludeHidden((current) => !current)}>
              {includeHidden ? <EyeOff data-icon="inline-start" /> : <Eye data-icon="inline-start" />}
              {includeHidden ? "Hide archived" : "Show archived"}
            </Button>
          ) : null}
          {resource.importable ? <ImportButton resource={resource} /> : null}
          {resource.table === "locations" ? <LocationWizardDialog /> : null}
          <ResourceFormDialog resource={resource} />
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <TableFrame>
            <Table>
              <TableHeader>
                <TableRow>
                  {resource.fields.map((field) => (
                    <TableHead key={field.name}>{field.label}</TableHead>
                  ))}
                  {["warehouses", "zones"].includes(resource.table) ? <TableHead className="w-28">Barcode</TableHead> : null}
                  {resource.supportsHide ? <TableHead className="w-32">Visibility</TableHead> : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell className="h-24 text-center text-muted-foreground" colSpan={resource.fields.length + extraColumnCount}>
                      Loading {resource.title.toLowerCase()}...
                    </TableCell>
                  </TableRow>
                ) : data.length === 0 ? (
                  <TableRow>
                    <TableCell className="h-24 text-center text-muted-foreground" colSpan={resource.fields.length + extraColumnCount}>
                      No {resource.title.toLowerCase()} found.
                    </TableCell>
                  </TableRow>
                ) : (
                  data.map((row) => (
                    <TableRow key={(row as { id?: string }).id ?? JSON.stringify(row)}>
                      {resource.fields.map((field) => (
                        <TableCell key={field.name}>{String((row as Record<string, unknown>)[field.name] ?? "—")}</TableCell>
                      ))}
                      {["warehouses", "zones", "locations"].includes(resource.table) ? (
                        <TableCell>
                          <div className="flex items-center gap-1">
                            <BarcodePrintDialog
                              labelType={resource.table === "warehouses" ? "warehouse" : resource.table === "zones" ? "zone" : "location"}
                              code={String((row as Record<string, unknown>).code ?? "")}
                              title={String((row as Record<string, unknown>).name ?? (row as Record<string, unknown>).code ?? resource.singular)}
                            />
                            {resource.table === "zones" && (
                              <ZoneLabelPage
                                code={String((row as Record<string, unknown>).code ?? "")}
                                name={String((row as Record<string, unknown>).name ?? (row as Record<string, unknown>).code ?? "")}
                                temperatureClass={String((row as Record<string, unknown>).temperature_class ?? "ambient")}
                                isStaging={Boolean((row as Record<string, unknown>).is_staging)}
                                isDispatch={Boolean((row as Record<string, unknown>).is_dispatch)}
                                isQuarantine={Boolean((row as Record<string, unknown>).is_quarantine)}
                              />
                            )}
                          </div>
                        </TableCell>
                      ) : null}
                      {resource.supportsHide ? (
                        <TableCell>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={async () => {
                              const record = row as Record<string, unknown> & { id?: string };
                              const id = record.id;
                              if (!id || !resource.archiveField) return;
                              const hidden = resource.archiveField === "active" ? record.active !== false : record.is_hidden === true;
                              await setResourceVisibility(resource.table, id, resource.archiveField, !hidden, !hidden ? "Hidden from UI" : undefined);
                              toast.success(hidden ? `${resource.singular} restored` : `${resource.singular} hidden`);
                              queryClient.invalidateQueries({ queryKey: [resource.table] });
                            }}
                          >
                            {((resource.archiveField === "active" ? (row as Record<string, unknown>).active !== false : (row as Record<string, unknown>).is_hidden === true))
                              ? "Restore"
                              : "Hide"}
                          </Button>
                        </TableCell>
                      ) : null}
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </TableFrame>
        </CardContent>
      </Card>
    </div>
  );
}

function ImportButton({ resource }: { resource: ResourceDefinition }) {
  return (
    <>
      <Button variant="outline" onClick={() => downloadCsvTemplate(resource)}>
        <FileDown data-icon="inline-start" />
        Template
      </Button>
      <Button
        variant="outline"
        onClick={() => {
          const input = document.createElement("input");
          input.type = "file";
          input.accept = ".csv";
          input.onchange = async () => {
            const file = input.files?.[0];
            if (!file) return;
            const errors = await importCsvToResource(resource, file);
            if (errors.length > 0) {
              downloadCsv(`${resource.table}-errors.csv`, errors);
              toast.error(`Imported with ${errors.length} row errors`);
            } else {
              toast.success(`${resource.title} imported`);
            }
          };
          input.click();
        }}
      >
        <Upload data-icon="inline-start" />
        Import CSV
      </Button>
    </>
  );
}

function LocationWizardDialog() {
  const queryClient = useQueryClient();
  const { data: options } = useQuery({ queryKey: ["options", "location-wizard"], queryFn: () => fetchOptions() });
  const [open, setOpen] = useState(false);
  const form = useForm({
    defaultValues: {
      warehouse_id: "",
      zone_id: "",
      prefix: "A",
      start_bay: 1,
      end_bay: 10,
      levels: 3,
      depth: 1,
      max_pallets: 1,
      location_type: "rack",
      temperature_class: "ambient",
      mixed_sku_allowed: false,
      mixed_lot_allowed: false,
    },
  });

  const mutation = useMutation({
    mutationFn: async (values: ReturnType<typeof form.getValues>) => {
      const startBay = Number(values.start_bay);
      const endBay = Number(values.end_bay);
      const levels = Number(values.levels);
      const locations = [];

      for (let bay = startBay; bay <= endBay; bay += 1) {
        for (let level = 1; level <= levels; level += 1) {
          locations.push({
            warehouse_id: values.warehouse_id,
            zone_id: values.zone_id,
            code: `${values.prefix}-${String(bay).padStart(2, "0")}-L${String(level).padStart(2, "0")}`,
            aisle: values.prefix,
            bay: String(bay).padStart(2, "0"),
            level,
            depth: Number(values.depth),
            max_pallets: Number(values.max_pallets),
            location_type: values.location_type,
            temperature_class: values.temperature_class,
            mixed_sku_allowed: values.mixed_sku_allowed,
            mixed_lot_allowed: values.mixed_lot_allowed,
            status: "active",
          });
        }
      }

      for (const location of locations) {
        await upsertRecord("locations", location);
      }

      return locations.length;
    },
    onSuccess: async (count) => {
      toast.success(`${count} locations created`);
      await queryClient.invalidateQueries({ queryKey: ["locations"] });
      setOpen(false);
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Location wizard failed"),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <MapPinned data-icon="inline-start" />
          Location wizard
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-hidden sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Create locations by range</DialogTitle>
          <DialogDescription>Generate repeated bay and level locations without typing every record.</DialogDescription>
        </DialogHeader>
        <ScrollArea className="max-h-[72vh] pr-4">
          <Form {...form}>
            <form className="grid gap-4 sm:grid-cols-2" onSubmit={form.handleSubmit((values) => mutation.mutate(values))}>
              <SelectField form={form} name="warehouse_id" label="Warehouse" options={(options?.warehouses ?? []).map((warehouse: any) => ({ label: warehouse.name, value: warehouse.id }))} />
              <SelectField form={form} name="zone_id" label="Zone" options={(options?.zones ?? []).map((zone: any) => ({ label: `${zone.code} - ${zone.name}`, value: zone.id }))} />
              <TextField form={form} name="prefix" label="Aisle prefix" />
              <TextField form={form} name="start_bay" label="Start bay" type="number" />
              <TextField form={form} name="end_bay" label="End bay" type="number" />
              <TextField form={form} name="levels" label="Levels" type="number" />
              <TextField form={form} name="depth" label="Depth" type="number" />
              <TextField form={form} name="max_pallets" label="Max pallets" type="number" />
              <SelectField form={form} name="location_type" label="Type" options={[
                { label: "Rack", value: "rack" },
                { label: "Staging", value: "staging" },
                { label: "Quarantine", value: "quarantine" },
                { label: "Dispatch", value: "dispatch" },
                { label: "Receiving", value: "receiving" },
                { label: "Floor", value: "floor" },
                { label: "Returns", value: "returns" },
              ]} />
              <SelectField form={form} name="temperature_class" label="Temperature" options={[
                { label: "Ambient", value: "ambient" },
                { label: "Cool", value: "cool" },
                { label: "Frozen", value: "frozen" },
              ]} />
              <Button className="sm:col-span-2" disabled={mutation.isPending} type="submit">
                {mutation.isPending ? <Loader2 className="animate-spin" /> : null}
                Create location range
              </Button>
            </form>
          </Form>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

function BarcodePrintDialog({ labelType, code, title }: { labelType: "warehouse" | "zone" | "location"; code: string; title: string }) {
  const printRef = useRef<HTMLDivElement>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const zpl = [
    "^XA",
    "^CI28",
    "^PW609",
    "^LL406",
    "^FO28,24^GB553,358,3^FS",
    `^FO40,44^A0N,34,34^FD${title.replace(/[\^~]/g, " ").slice(0, 34)}^FS`,
    `^FO40,92^A0N,24,24^FD${labelType.toUpperCase()}^FS`,
    `^FO64,130^BQN,2,7^FDLA,${code.replace(/[\^~]/g, " ").slice(0, 64)}^FS`,
    `^FO288,176^A0N,30,30^FD${code.replace(/[\^~]/g, " ").slice(0, 28)}^FS`,
    "^FO288,220^A0N,18,18^FDWarehouse Wizard^FS",
    "^XZ",
  ].join("\n");

  function handlePrint() {
    if (!printRef.current) return;
    const printWindow = window.open("", "_blank", "width=420,height=480");
    if (!printWindow) return;
    printWindow.document.write(`<!DOCTYPE html><html><head><title>Label — ${title}</title><style>
      @page { margin: 12mm; }
      body { font-family: system-ui, sans-serif; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; background: #fff; }
      .label { text-align: center; border: 1px solid #ccc; padding: 16px; border-radius: 8px; display: inline-block; }
      .label-type { font-size: 11px; text-transform: uppercase; color: #888; margin-top: 8px; letter-spacing: 0.08em; }
      .label-code { font-size: 18px; font-weight: 700; margin-top: 4px; letter-spacing: 0.04em; }
      .label-sub { font-size: 11px; color: #666; margin-top: 2px; }
    </style></head><body><div class="label">${printRef.current.innerHTML}
      <p class="label-type">${labelType}</p>
      <p class="label-code">${title}</p>
      <p class="label-sub">${code}</p>
    </div><script>window.onload=()=>{window.print();window.close();}</script></body></html>`);
    printWindow.document.close();
  }

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost">
          <QrCode data-icon="inline-start" />
          Print
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>Scan label with human-readable code.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div ref={printRef} className="mx-auto rounded-md border border-border bg-white p-4">
            <QRCodeSVG value={code} size={160} bgColor="#ffffff" fgColor="#000000" level="M" />
          </div>
          <div className="rounded-md border border-border p-3 text-center">
            <p className="text-xs uppercase text-muted-foreground">{labelType}</p>
            <p className="break-all text-xl font-semibold">{code}</p>
          </div>
          <Button className="w-full" onClick={handlePrint}>
            <Printer data-icon="inline-start" />
            Print label
          </Button>
          <button
            type="button"
            className="text-xs text-muted-foreground underline-offset-2 hover:underline text-left"
            onClick={() => setShowAdvanced((v) => !v)}
          >
            {showAdvanced ? "Hide" : "Show"} advanced (ZPL payload)
          </button>
          {showAdvanced && (
            <div className="rounded-lg border border-border bg-background p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="text-sm font-medium text-muted-foreground">ZPL payload</p>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={async () => {
                    await navigator.clipboard?.writeText(zpl);
                    toast.success("ZPL copied");
                  }}
                >
                  Copy
                </Button>
              </div>
              <pre className="max-h-36 overflow-auto whitespace-pre-wrap font-mono text-xs text-muted-foreground">{zpl}</pre>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function defaultFieldValue(field: FieldDefinition) {
  if (field.type === "boolean") return field.name === "active" || field.name === "lot_tracked";
  if (field.type === "number") return "";
  if (field.name === "temperature_class" || field.name === "temperature_requirement") return "ambient";
  if (field.name === "rotation_method") return "fifo";
  if (field.name === "status") return "active";
  return "";
}

function normalizeResourceValues(resource: ResourceDefinition, values: Record<string, unknown>) {
  return resource.fields.reduce<Record<string, unknown>>((payload, field) => {
    const value = values[field.name];
    if (value === "") {
      payload[field.name] = field.required ? value : null;
      return payload;
    }
    payload[field.name] = field.type === "number" && value != null ? Number(value) : value;
    return payload;
  }, {});
}

function getResourceFieldOptions(field: FieldDefinition, options?: Awaited<ReturnType<typeof fetchOptions>>) {
  if (field.options) return field.options;
  if (field.name === "warehouse_id") return (options?.warehouses ?? []).map((warehouse: any) => ({ label: `${warehouse.code} - ${warehouse.name}`, value: warehouse.id }));
  if (field.name === "zone_id") return (options?.zones ?? []).map((zone: any) => ({ label: `${zone.code} - ${zone.name}`, value: zone.id }));
  if (field.name === "client_owner_id") return (options?.clients ?? []).map((client: any) => ({ label: client.name, value: client.id }));
  if (field.name === "product_id") return (options?.products ?? []).map((product: any) => ({ label: `${product.sku} - ${product.name}`, value: product.id }));
  return [];
}

function shouldRestrictToDefaultWarehouse(roles: string[]) {
  return roles.some((role) => ["inventory_clerk", "warehouse_operator", "dispatch_driver"].includes(role)) &&
    !roles.some((role) => ["admin", "warehouse_manager"].includes(role));
}

export function DashboardPage() {
  const [mode, setMode] = useState<DashboardMode>("floor");
  const [cards, setCards] = useState<DashboardCardConfig[]>(loadLayout);
  const { data: metrics, isLoading } = useQuery({
    queryKey: ["dashboard-metrics"],
    queryFn: getDashboardMetrics,
  });
  const { data: reports } = useQuery({ queryKey: ["reports", "enterprise-dashboard"], queryFn: getReportData });
  const snapshot = useMemo(() => buildEnterpriseDashboard(metrics, reports), [metrics, reports]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      setCards((prev) => {
        const oldIdx = prev.findIndex((c) => c.id === active.id);
        const newIdx = prev.findIndex((c) => c.id === over.id);
        const next = arrayMove(prev, oldIdx, newIdx);
        saveLayout(next);
        return next;
      });
    }
  }, []);

  const handleResize = useCallback((id: string) => {
    setCards((prev) => {
      const next = prev.map((c) => {
        if (c.id !== id) return c;
        const nextSize: DashboardCardSize = c.size === "sm" ? "lg" : "sm";
        return { ...c, size: nextSize };
      });
      saveLayout(next);
      return next;
    });
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Command Center</h2>
          <p className="text-sm text-muted-foreground">Live warehouse metrics. Drag cards to reorder, hover to resize.</p>
        </div>
        <Tabs value={mode} onValueChange={(value) => setMode(value as DashboardMode)}>
          <TabsList className="grid h-auto w-full grid-cols-3 sm:w-fit">
            <TabsTrigger value="floor" className="gap-1.5"><Forklift className="h-3.5 w-3.5" /> Floor</TabsTrigger>
            <TabsTrigger value="dock" className="gap-1.5"><Truck className="h-3.5 w-3.5" /> Dock</TabsTrigger>
            <TabsTrigger value="office" className="gap-1.5"><BarChart3 className="h-3.5 w-3.5" /> Office</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={cards.map((c) => c.id)} strategy={rectSortingStrategy}>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {cards.map((card) => (
              <SortableMetricCard
                key={card.id}
                card={card}
                value={metrics?.[card.metricKey] ?? 0}
                isLoading={isLoading}
                onResize={handleResize}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>

      {mode === "floor" ? <WarehouseFloorMode snapshot={snapshot} /> : null}
      {mode === "dock" ? <DockHandoffBoard loads={snapshot.dockLoads} recommendations={snapshot.recommendations} /> : null}
      {mode === "office" ? <OfficeMonitoringMode snapshot={snapshot} /> : null}
    </div>
  );
}

function WarehouseFloorMode({ snapshot }: { snapshot: EnterpriseDashboardSnapshot }) {
  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(20rem,0.65fr)]">
      <div className="grid gap-4 md:grid-cols-2">
        {snapshot.floorQueues.map((queue) => (
          <Card key={queue.label} className={cn("border-l-4", toneBorder(queue.tone))}>
            <CardHeader>
              <CardTitle className="flex items-center justify-between gap-4">
                <span>{queue.label}</span>
                <span className="text-4xl">{formatNumber(queue.count)}</span>
              </CardTitle>
              <CardDescription>{queue.action}</CardDescription>
            </CardHeader>
            <CardContent>
              <Button className="h-14 w-full text-base" asChild>
                <Link to={queue.route}>Open workflow</Link>
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><RadioTower /> Andon & Lean Status</CardTitle>
          <CardDescription>5S, Kanban, DPMO, and exception signals for the current shift.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          {snapshot.leanMetrics.map((metric) => (
            <div key={metric.label} className="rounded-lg border border-border p-3">
              <div className="flex items-center justify-between gap-4">
                <span className="font-medium">{metric.label}</span>
                <Badge variant={metric.status === "off_target" ? "destructive" : metric.status === "watch" ? "secondary" : "default"}>
                  {metric.status.replace("_", " ")}
                </Badge>
              </div>
              <p className="mt-1 text-2xl font-semibold">{metric.value}</p>
              <p className="text-xs text-muted-foreground">Target: {metric.target}</p>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function DockHandoffBoard({
  loads,
  recommendations,
}: {
  loads: DockHandoffLoad[];
  recommendations: WarehouseBrainRecommendation[];
}) {
  return (
    <div className="grid gap-6">
      <div className="grid gap-4 lg:grid-cols-5">
        {["ready", "called", "loading", "blocked", "loaded"].map((status) => (
          <Card key={status} className={cn("min-h-72", status === "blocked" ? "border-destructive/50" : "")}>
            <CardHeader>
              <CardTitle className="capitalize">{status}</CardTitle>
              <CardDescription>Dock handoff lane</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              {loads.filter((load) => load.status === status).map((load) => (
                <div key={load.id} className="rounded-lg border border-border bg-secondary/30 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold">{load.route}</span>
                    <Badge>{load.door}</Badge>
                  </div>
                  <p className="mt-1 truncate text-sm">{load.customer}</p>
                  <p className="text-xs text-muted-foreground">{load.driver} · {load.pallets} pallet{load.pallets === 1 ? "" : "s"} · {load.temperatureClass}</p>
                  {load.blocker ? <p className="mt-2 text-xs text-destructive">{load.blocker}</p> : null}
                </div>
              ))}
            </CardContent>
          </Card>
        ))}
      </div>
      <WarehouseBrainPanel recommendations={recommendations} />
    </div>
  );
}

function OfficeMonitoringMode({ snapshot }: { snapshot: EnterpriseDashboardSnapshot }) {
  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(22rem,0.7fr)]">
      <div className="grid gap-4 md:grid-cols-2">
        {snapshot.officeWidgets.map((widget) => (
          <Card key={widget.label} className={cn("border-l-4", toneBorder(widget.tone))}>
            <CardHeader>
              <CardDescription>{widget.label}</CardDescription>
              <CardTitle className="text-4xl">{widget.value}</CardTitle>
              <CardDescription>{widget.detail}</CardDescription>
            </CardHeader>
          </Card>
        ))}
      </div>
      <div className="grid gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><ClipboardCheck /> Setup Checklist</CardTitle>
            <CardDescription>Go-live prompts for admin and management setup activities.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            {snapshot.setupChecklist.map((item) => (
              <div key={item.label} className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2">
                <div>
                  <p className="text-sm font-medium">{item.label}</p>
                  <p className="text-xs text-muted-foreground">{item.owner}</p>
                </div>
                <Badge variant={item.complete ? "default" : "secondary"}>{item.complete ? "Ready" : "Open"}</Badge>
              </div>
            ))}
          </CardContent>
        </Card>
        <WarehouseBrainPanel recommendations={snapshot.recommendations} />
      </div>
    </div>
  );
}

function WarehouseBrainPanel({ recommendations }: { recommendations: WarehouseBrainRecommendation[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Bot /> Warehouse Brain</CardTitle>
        <CardDescription>Explainable recommendations using live WMS context and role-aware next actions.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        {recommendations.map((recommendation) => (
          <div key={recommendation.id} className={cn("rounded-lg border border-border p-3", recommendation.severity === "critical" ? "bg-destructive/10" : recommendation.severity === "warning" ? "bg-warning/10" : "bg-secondary/30")}>
            <div className="flex items-center justify-between gap-3">
              <p className="font-medium">{recommendation.title}</p>
              <Badge variant={recommendation.severity === "critical" ? "destructive" : "secondary"}>{recommendation.severity}</Badge>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">{recommendation.reason}</p>
            <p className="mt-2 text-sm">{recommendation.nextAction}</p>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function toneBorder(tone: "success" | "warning" | "critical" | "info") {
  if (tone === "critical") return "border-l-destructive";
  if (tone === "warning") return "border-l-warning";
  if (tone === "info") return "border-l-info";
  return "border-l-success";
}

export function ReceivingPage() {
  const queryClient = useQueryClient();
  const { roles, profile } = useAuth();
  const restrictedToDefaultWarehouse = shouldRestrictToDefaultWarehouse(roles);
  const { data: options } = useQuery({
    queryKey: ["options", "receiving", restrictedToDefaultWarehouse, profile?.default_warehouse_id],
    queryFn: () => fetchOptions(false, { restrictToWarehouse: restrictedToDefaultWarehouse, warehouseId: profile?.default_warehouse_id }),
  });
  const form = useForm<z.infer<typeof receivingSchema>>({
    resolver: zodResolver(receivingSchema),
    defaultValues: {
      receipt_type: "manual",
      reference_number: "",
      quantity: 1,
    },
  });
  const [manualBarcode, setManualBarcode] = useState("");
  const [showZplAdvanced, setShowZplAdvanced] = useState(false);
  const receivedQuantity = form.watch("quantity");
  const zplPreview = useMemo(
    () =>
      manualBarcode
        ? generateZplLabel({
            labelType: "pallet",
            code: manualBarcode,
            title: "Pallet Label",
            subtitle: "Zebra ZPL queue-ready",
            quantity: Number(receivedQuantity ?? 1),
          })
        : "",
    [manualBarcode, receivedQuantity],
  );

  const mutation = useMutation({
    mutationFn: createReceiptFlow,
    onSuccess: async (result) => {
      toast.success(`Receipt posted. Putaway task ${result.putawayTask.task_number} ready.`);
      form.reset({ receipt_type: "manual", reference_number: "", quantity: 1 });
      setManualBarcode(result.pallet.pallet_barcode);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["dashboard-metrics"] }),
        queryClient.invalidateQueries({ queryKey: ["putaway-tasks"] }),
        queryClient.invalidateQueries({ queryKey: ["inventory-search"] }),
      ]);
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Receiving failed"),
  });

  return (
    <div className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(20rem,0.8fr)]">
      <Card className="min-w-0">
        <CardHeader>
          <CardTitle>Receive Stock</CardTitle>
          <CardDescription>Create a pallet, print the label, and launch directed putaway in one flow.</CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form className="grid gap-4 sm:grid-cols-2" onSubmit={form.handleSubmit((values) => mutation.mutate(values))}>
              <SelectField form={form} name="receipt_type" label="Receipt type" options={[
                { label: "Manual", value: "manual" },
                { label: "PO", value: "po" },
                { label: "Transfer", value: "transfer" },
              ]} />
              <TextField form={form} name="reference_number" label="Reference" />
              <SelectField form={form} name="warehouse_id" label="Warehouse" options={(options?.warehouses ?? []).map((warehouse) => ({ label: warehouse.name, value: warehouse.id }))} />
              <SelectField form={form} name="client_id" label="Client" options={(options?.clients ?? []).map((client) => ({ label: client.name, value: client.id }))} />
              <SelectField form={form} name="product_id" label="Product" options={(options?.products ?? []).map((product) => ({ label: `${product.sku} · ${product.name}`, value: product.id }))} />
              <SelectField form={form} name="packaging_profile_id" label="Packaging profile" options={(options?.packagingProfiles ?? []).map((profile) => ({ label: profile.profile_name, value: profile.id }))} />
              <TextField form={form} name="quantity" label="Quantity" type="number" />
              <TextField form={form} name="lot_number" label="Lot" />
              <TextField form={form} name="batch_number" label="Batch" />
              <TextField form={form} name="manufacture_date" label="Manufacture date" type="date" />
              <TextField form={form} name="expiry_date" label="Expiry date" type="date" />
              <TextField form={form} name="loading_date" label="Loading date" type="date" />
              <TextField form={form} name="rotation_date" label="Rotation date" type="date" />
              <TextField form={form} name="override_length" label="Override length" type="number" />
              <TextField form={form} name="override_width" label="Override width" type="number" />
              <TextField form={form} name="override_height" label="Override height" type="number" />
              <TextField form={form} name="override_weight" label="Override weight" type="number" />
              <Button className="w-full sm:col-span-2" type="submit" disabled={mutation.isPending}>
                {mutation.isPending ? <Loader2 className="animate-spin" /> : null}
                Receive and create pallet
              </Button>
            </form>
          </Form>
        </CardContent>
      </Card>

      <Card className="min-w-0">
        <CardHeader>
          <CardTitle>Scan & Print Pallet Label</CardTitle>
          <CardDescription>Enter or scan a barcode to preview and print a pallet label.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="rounded-xl border border-dashed border-border bg-secondary/30 p-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Camera />
              Camera scanning can be added by enabling `BarcodeDetector` on supported mobile browsers.
            </div>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Input className="min-w-0" value={manualBarcode} onChange={(event) => setManualBarcode(event.target.value)} placeholder="Latest pallet barcode" />
            <Button className="w-full sm:w-auto" variant="outline" onClick={() => window.print()}>
              <Printer data-icon="inline-start" />
              Print
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Each receipt creates a pallet label record, inventory balance, and a queued putaway task.
          </p>
          {zplPreview ? (
            <>
              <button
                type="button"
                className="text-xs text-muted-foreground underline-offset-2 hover:underline text-left"
                onClick={() => setShowZplAdvanced((v) => !v)}
              >
                {showZplAdvanced ? "Hide" : "Show"} advanced (ZPL payload)
              </button>
              {showZplAdvanced && (
                <div className="rounded-lg border border-border bg-background p-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <p className="text-sm font-medium text-muted-foreground">ZPL payload</p>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={async () => {
                        await navigator.clipboard?.writeText(zplPreview);
                        toast.success("ZPL copied");
                      }}
                    >
                      Copy
                    </Button>
                  </div>
                  <pre className="max-h-44 overflow-auto whitespace-pre-wrap font-mono text-xs text-muted-foreground">{zplPreview}</pre>
                </div>
              )}
            </>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

function TextField({
  form,
  name,
  label,
  type = "text",
}: {
  form: UseFormReturn<any>;
  name: string;
  label: string;
  type?: string;
}) {
  return (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{label}</FormLabel>
          <FormControl>
            <Input {...field} type={type} value={(field.value as string | number | readonly string[] | undefined) ?? ""} />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

function SelectField({
  form,
  name,
  label,
  options,
}: {
  form: UseFormReturn<any>;
  name: string;
  label: string;
  options: Array<{ label: string; value: string }>;
}) {
  return (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{label}</FormLabel>
          <Select onValueChange={field.onChange} value={(field.value as string | undefined) ?? undefined}>
            <FormControl>
              <SelectTrigger>
                <SelectValue placeholder={`Select ${label.toLowerCase()}`} />
              </SelectTrigger>
            </FormControl>
            <SelectContent>
              {options.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

export function PutawayTasksPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { data = [], isLoading } = useQuery({
    queryKey: ["putaway-tasks", user?.id],
    queryFn: () => getPutawayTasks(user?.id),
  });

  // Per-task scan inputs
  const [scanState, setScanState] = useState<Record<string, { pallet: string; location: string }>>({});
  // Per-task return-to-receiving dialog state
  const [returnState, setReturnState] = useState<Record<string, { open: boolean; reason: string }>>({});
  // Per-task exception dialog state
  const [exceptionState, setExceptionState] = useState<Record<string, { open: boolean; reason: string }>>({});

  const invalidate = async () => Promise.all([
    queryClient.invalidateQueries({ queryKey: ["putaway-tasks"] }),
    queryClient.invalidateQueries({ queryKey: ["inventory-search"] }),
    queryClient.invalidateQueries({ queryKey: ["dashboard-metrics"] }),
  ]);

  const confirmMutation = useMutation({
    mutationFn: async ({ taskId, pallet, location }: { taskId: string; pallet: string; location: string }) =>
      confirmPutaway(taskId, pallet, location),
    onSuccess: async () => {
      toast.success("✅ Putaway confirmed — stock is now available");
      await invalidate();
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Putaway failed"),
  });

  const returnMutation = useMutation({
    mutationFn: async ({ taskId, reason }: { taskId: string; reason: string }) =>
      sendBackToReceiving(taskId, reason),
    onSuccess: async (_data, { taskId }) => {
      setReturnState((s) => ({ ...s, [taskId]: { open: false, reason: "" } }));
      toast("Pallet returned to Receiving", {
        description: "The pallet is queued for re-inspection or re-labelling.",
        action: { label: "Go to Receiving", onClick: () => navigate("/receiving") },
        duration: 8000,
      });
      await invalidate();
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Return failed"),
  });

  const exceptionMutation = useMutation({
    mutationFn: async ({ taskId, reason }: { taskId: string; reason: string }) =>
      flagPutawayException(taskId, reason),
    onSuccess: async (_data, { taskId }) => {
      setExceptionState((s) => ({ ...s, [taskId]: { open: false, reason: "" } }));
      toast.warning("⚠️ Task flagged as exception — a manager will review it");
      await invalidate();
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Flag failed"),
  });

  const active = (data as any[]).filter((t: any) => !["completed", "cancelled"].includes(t.status));
  const done = (data as any[]).filter((t: any) => ["completed", "cancelled"].includes(t.status));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold">Putaway Tasks</h2>
          <p className="text-sm text-muted-foreground">
            Scan the pallet barcode on the physical pallet, scan the target location barcode, then confirm.
          </p>
        </div>
        {active.length > 0 && (
          <Badge variant="secondary" className="shrink-0 text-sm">
            {active.length} open
          </Badge>
        )}
      </div>

      {/* Solo-operator tip */}
      {active.length > 2 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30 p-3 text-sm text-amber-800 dark:text-amber-300 flex items-start gap-2">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            <strong>{active.length} tasks open.</strong> If you're working alone, complete putaway in received order so
            no pallets are left blocking the dock or staging zone.
          </span>
        </div>
      )}

      <div className="grid gap-4">
        {isLoading ? (
          <Card><CardContent className="p-6 text-sm text-muted-foreground">Loading putaway tasks…</CardContent></Card>
        ) : active.length === 0 && !isLoading ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
              <Forklift className="h-10 w-10 text-muted-foreground/40" />
              <p className="text-sm font-medium">No putaway tasks ready</p>
              <p className="text-xs text-muted-foreground">Tasks appear here after stock is received. Go to Receiving to create one.</p>
              <Button variant="outline" size="sm" onClick={() => navigate("/receiving")}>
                <ArrowLeft className="mr-2 h-4 w-4" />
                Go to Receiving
              </Button>
            </CardContent>
          </Card>
        ) : (
          active.map((task: any) => {
            const pallet = task.pallets as any;
            const product = pallet?.products as any;
            const lot = pallet?.inventory_lots as any;
            const suggestedLocation = task.locations as any;
            const localState = scanState[task.id] ?? { pallet: "", location: "" };
            const ret = returnState[task.id] ?? { open: false, reason: "" };
            const exc = exceptionState[task.id] ?? { open: false, reason: "" };
            const isCoolChain = product?.temperature_requirement === "cool" || product?.temperature_requirement === "frozen";

            return (
              <Card key={task.id} className={isCoolChain ? "border-blue-300 dark:border-blue-700" : undefined}>
                <CardHeader className="pb-3">
                  <CardTitle className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-mono text-sm text-muted-foreground">{task.task_number}</span>
                    <div className="flex gap-2">
                      {isCoolChain && (
                        <Badge variant="outline" className="border-blue-400 text-blue-600 dark:text-blue-400">
                          🧊 {product?.temperature_requirement}
                        </Badge>
                      )}
                      <Badge variant={task.status === "exception" ? "destructive" : "secondary"}>
                        {task.status}
                      </Badge>
                    </div>
                  </CardTitle>

                  {/* Product identity — the core confirmation row */}
                  {product ? (
                    <div className="mt-1 rounded-md bg-secondary/40 px-3 py-2">
                      <p className="text-base font-semibold leading-tight">{product.name}</p>
                      <p className="font-mono text-xs text-muted-foreground">{product.sku}</p>
                      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-sm">
                        <span><span className="text-muted-foreground">Qty: </span><strong>{formatNumber(pallet?.quantity)}</strong></span>
                        {lot?.lot_number && <span><span className="text-muted-foreground">Lot: </span>{lot.lot_number}</span>}
                        {lot?.batch_number && <span><span className="text-muted-foreground">Batch: </span>{lot.batch_number}</span>}
                        {lot?.expiry_date && <span><span className="text-muted-foreground">Expiry: </span>{formatDate(lot.expiry_date)}</span>}
                      </div>
                    </div>
                  ) : null}

                  {/* Pallet barcode — big and scannable */}
                  <div className="mt-2 rounded-md border border-dashed border-border bg-background px-3 py-2 text-center">
                    <p className="text-xs uppercase text-muted-foreground">Pallet barcode — scan this</p>
                    <p className="mt-0.5 font-mono text-lg font-bold tracking-widest">{pallet?.pallet_barcode ?? "—"}</p>
                  </div>

                  <CardDescription className="mt-2">
                    {suggestedLocation
                      ? <>Suggested location: <strong>{suggestedLocation.code}</strong> · {suggestedLocation.temperature_class} · {suggestedLocation.location_type}</>
                      : <span className="text-amber-600 dark:text-amber-400">⚠ No suggested location — scan any valid location barcode or flag an exception.</span>
                    }
                  </CardDescription>
                </CardHeader>

                <CardContent className="flex flex-col gap-3">
                  {/* Scan + confirm row */}
                  <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
                    <Input
                      className="min-w-0"
                      placeholder="Scan pallet barcode"
                      value={localState.pallet}
                      onChange={(e) => setScanState((s) => ({ ...s, [task.id]: { ...localState, pallet: e.target.value } }))}
                    />
                    <Input
                      className="min-w-0"
                      placeholder="Scan location barcode"
                      value={localState.location}
                      onChange={(e) => setScanState((s) => ({ ...s, [task.id]: { ...localState, location: e.target.value } }))}
                    />
                    <Button
                      className="w-full sm:w-auto"
                      disabled={confirmMutation.isPending || !localState.pallet || !localState.location}
                      onClick={() => confirmMutation.mutate({ taskId: task.id, pallet: localState.pallet, location: localState.location })}
                    >
                      {confirmMutation.isPending ? <Loader2 className="animate-spin h-4 w-4" /> : "Confirm"}
                    </Button>
                  </div>

                  {/* Secondary actions */}
                  <div className="flex flex-wrap gap-2 border-t border-border pt-2">
                    {/* Send back to receiving */}
                    {!ret.open && !exc.open && (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-amber-700 border-amber-300 hover:bg-amber-50 dark:text-amber-400 dark:border-amber-700 dark:hover:bg-amber-950/30"
                          onClick={() => setReturnState((s) => ({ ...s, [task.id]: { open: true, reason: "" } }))}
                        >
                          <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                          Send back to Receiving
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-destructive border-destructive/40 hover:bg-destructive/5"
                          onClick={() => setExceptionState((s) => ({ ...s, [task.id]: { open: true, reason: "" } }))}
                        >
                          <AlertTriangle className="mr-1.5 h-3.5 w-3.5" />
                          Flag exception
                        </Button>
                      </>
                    )}

                    {/* Return-to-receiving inline panel */}
                    {ret.open && (
                      <div className="w-full rounded-md border border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/30 p-3 flex flex-col gap-2">
                        <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
                          <RotateCcw className="inline mr-1.5 h-3.5 w-3.5" />
                          Return this pallet to Receiving
                        </p>
                        <p className="text-xs text-amber-700 dark:text-amber-400">
                          The pallet will be reset to "receiving" status. A new putaway task can be raised after re-inspection.
                        </p>
                        <Input
                          placeholder="Reason (e.g. wrong pallet, damaged, can't find location)"
                          value={ret.reason}
                          onChange={(e) => setReturnState((s) => ({ ...s, [task.id]: { ...ret, reason: e.target.value } }))}
                        />
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            className="border-amber-400"
                            disabled={returnMutation.isPending}
                            onClick={() => returnMutation.mutate({ taskId: task.id, reason: ret.reason })}
                          >
                            {returnMutation.isPending ? <Loader2 className="animate-spin h-3.5 w-3.5" /> : "Confirm return"}
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setReturnState((s) => ({ ...s, [task.id]: { open: false, reason: "" } }))}>
                            Cancel
                          </Button>
                        </div>
                      </div>
                    )}

                    {/* Exception inline panel */}
                    {exc.open && (
                      <div className="w-full rounded-md border border-destructive/30 bg-destructive/5 p-3 flex flex-col gap-2">
                        <p className="text-sm font-medium text-destructive">
                          <AlertTriangle className="inline mr-1.5 h-3.5 w-3.5" />
                          Flag as exception
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Describe the issue. A manager or supervisor will review and reassign. The pallet stays in its current status.
                        </p>
                        <Input
                          placeholder="Reason (e.g. location full, temp mismatch, pallet damaged)"
                          value={exc.reason}
                          onChange={(e) => setExceptionState((s) => ({ ...s, [task.id]: { ...exc, reason: e.target.value } }))}
                        />
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant="destructive"
                            disabled={exceptionMutation.isPending || !exc.reason.trim()}
                            onClick={() => exceptionMutation.mutate({ taskId: task.id, reason: exc.reason })}
                          >
                            {exceptionMutation.isPending ? <Loader2 className="animate-spin h-3.5 w-3.5" /> : "Flag exception"}
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setExceptionState((s) => ({ ...s, [task.id]: { open: false, reason: "" } }))}>
                            Cancel
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })
        )}

        {/* Completed / cancelled summary */}
        {done.length > 0 && (
          <details className="group">
            <summary className="cursor-pointer text-xs text-muted-foreground select-none list-none flex items-center gap-1 hover:text-foreground">
              <span className="inline-block transition-transform group-open:rotate-90">▶</span>
              {done.length} completed / cancelled task{done.length !== 1 ? "s" : ""}
            </summary>
            <div className="mt-2 grid gap-2">
              {done.map((task: any) => {
                const pallet = task.pallets as any;
                const product = pallet?.products as any;
                return (
                  <div key={task.id} className="rounded-md border border-border px-3 py-2 text-sm flex items-center justify-between gap-3 opacity-60">
                    <span className="font-mono text-xs">{task.task_number}</span>
                    <span className="text-xs truncate">{product?.name ?? "—"} · {formatNumber(pallet?.quantity)}</span>
                    <Badge variant="outline" className="shrink-0">{task.status}</Badge>
                  </div>
                );
              })}
            </div>
          </details>
        )}
      </div>
    </div>
  );
}

export function InventorySearchPage() {
  const { roles, profile } = useAuth();
  const [searchTerm, setSearchTerm] = useState("");
  const [status, setStatus] = useState<string>("all");
  const restrictedToDefaultWarehouse = shouldRestrictToDefaultWarehouse(roles);
  const { data: options } = useQuery({
    queryKey: ["options", "inventory", restrictedToDefaultWarehouse, profile?.default_warehouse_id],
    queryFn: () => fetchOptions(false, { restrictToWarehouse: restrictedToDefaultWarehouse, warehouseId: profile?.default_warehouse_id }),
  });
  const [warehouseId, setWarehouseId] = useState(restrictedToDefaultWarehouse ? profile?.default_warehouse_id ?? "" : "");
  const [locationScan, setLocationScan] = useState("");

  const scanMutation = useMutation({
    mutationFn: getWarehouseForLocationBarcode,
    onSuccess: (location) => {
      setWarehouseId(location.warehouse_id);
      toast.success(`Warehouse visibility switched to ${location.warehouses?.name ?? location.warehouses?.code ?? "scanned warehouse"}`);
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Location scan failed"),
  });

  const { data = [], isLoading } = useQuery({
    queryKey: ["inventory-search", searchTerm, status, warehouseId],
    queryFn: () => searchInventory({ search: searchTerm, status, warehouseId: warehouseId || undefined }),
  });

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-2xl font-semibold">Inventory Search</h2>
        <p className="text-sm text-muted-foreground">Search by SKU, pallet, barcode, lot, batch, expiry, owner, or location.</p>
      </div>
      <Card>
        <CardContent className="grid gap-3 p-4 lg:grid-cols-[minmax(0,2fr)_minmax(12rem,1fr)_minmax(12rem,1fr)_minmax(16rem,1fr)]">
          <div className="relative">
            <Search className="absolute left-3 top-3 text-muted-foreground" />
            <Input className="min-w-0 pl-10" value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder="Search inventory" />
          </div>
          <Select onValueChange={setWarehouseId} value={warehouseId}>
            <SelectTrigger>
              <SelectValue placeholder="All warehouses" />
            </SelectTrigger>
            <SelectContent>
              {(options?.warehouses ?? []).map((warehouse) => (
                <SelectItem key={warehouse.id} value={warehouse.id}>
                  {warehouse.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex min-w-0 gap-2">
            <Input className="min-w-0" value={locationScan} onChange={(event) => setLocationScan(event.target.value)} placeholder="Scan location barcode" />
            <Button size="icon" variant="outline" onClick={() => scanMutation.mutate(locationScan)} aria-label="Use scanned location warehouse">
              <QrCode />
            </Button>
          </div>
          <Select onValueChange={(value) => setStatus(value as typeof status)} value={status}>
            <SelectTrigger>
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {["receiving", "available", "reserved", "picked", "staged", "in_transit", "hold", "quarantine", "damaged", "missing"].map((item) => (
                <SelectItem key={item} value={item}>{item}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-0">
          <TableFrame>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>SKU</TableHead>
                  <TableHead>Pallet</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead>Warehouse</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Available</TableHead>
                  <TableHead>Expiry</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell className="h-24 text-center text-muted-foreground" colSpan={8}>Searching…</TableCell>
                  </TableRow>
                ) : data.length === 0 ? (
                  <TableRow>
                    <TableCell className="h-24 text-center text-muted-foreground" colSpan={8}>No inventory matched.</TableCell>
                  </TableRow>
                ) : (
                  data.map((row) => (
                    <TableRow key={row.inventory_balance_id}>
                      <TableCell>{row.sku}</TableCell>
                      <TableCell>{row.pallet_code}</TableCell>
                      <TableCell>{row.location_code ?? "Receiving"}</TableCell>
                      <TableCell>{row.warehouse_code}</TableCell>
                      <TableCell><Badge variant={row.status === "available" ? "default" : "secondary"}>{row.status}</Badge></TableCell>
                      <TableCell>{formatNumber(row.available_quantity)}</TableCell>
                      <TableCell>{formatDate(row.expiry_date)}</TableCell>
                      <TableCell>
                        <Button asChild size="sm" variant="ghost">
                          <Link to={`/inventory/${row.inventory_balance_id}`}>Detail</Link>
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </TableFrame>
        </CardContent>
      </Card>
    </div>
  );
}

function statusBadgeVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  if (status === "completed") return "default";
  if (status === "exception" || status === "cancelled") return "destructive";
  if (status === "in_progress" || status === "queued") return "secondary";
  return "outline";
}

export function PickListsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: options } = useQuery({ queryKey: ["options"], queryFn: () => fetchOptions() });
  const { data: pickLists = [] } = useQuery({ queryKey: ["pick-lists"], queryFn: listPickLists });
  const form = useForm<z.infer<typeof pickListSchema>>({
    resolver: zodResolver(pickListSchema),
    defaultValues: { lines: [{ product_id: "", quantity: 1 }] },
  });

  const mutation = useMutation({
    mutationFn: async (values: z.infer<typeof pickListSchema>) => createPickListFlow(values),
    onSuccess: async () => {
      toast.success("Pick list released", {
        action: { label: "View lists", onClick: () => navigate("/pick-lists") },
        duration: 6000,
      });
      form.reset({ lines: [{ product_id: "", quantity: 1 }] });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["pick-lists"] }),
        queryClient.invalidateQueries({ queryKey: ["dashboard-metrics"] }),
      ]);
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Pick list failed"),
  });

  const lines = form.watch("lines");
  const active = (pickLists as any[]).filter((pl) => !["completed", "cancelled"].includes(pl.status));
  const done = (pickLists as any[]).filter((pl) => ["completed", "cancelled"].includes(pl.status));

  return (
    <Tabs className="flex flex-col gap-6" defaultValue="lists">
      <div className="flex flex-col gap-2">
        <h2 className="text-2xl font-semibold">Pick Lists</h2>
        <p className="text-sm text-muted-foreground">Release outbound work and execute scan-confirmed picks.</p>
      </div>
      <TabsList className="grid h-auto w-full grid-cols-2 sm:w-fit">
        <TabsTrigger value="lists">Active Lists</TabsTrigger>
        <TabsTrigger value="create">Create Pick List</TabsTrigger>
      </TabsList>
      <TabsContent value="lists" className="grid gap-4">
        {active.length === 0 && (
          <div className="rounded-lg border border-dashed border-border p-8 text-center">
            <ClipboardList className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
            <p className="font-medium">No active pick lists</p>
            <p className="mt-1 text-sm text-muted-foreground">Release a pick list from the Create tab, or go to Receiving to check inbound stock.</p>
            <Button className="mt-4" variant="outline" asChild>
              <Link to="/receiving">Go to Receiving</Link>
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
              <CardContent className="grid gap-3">
                {tasks.map((task: any) => {
                  const product = task.pallets?.products as any;
                  return (
                    <div
                      key={task.id}
                      className={`flex flex-wrap items-center gap-3 rounded-md border px-3 py-2 text-sm ${task.status === "exception" ? "border-destructive/50 bg-destructive/5" : "border-border"}`}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="font-medium truncate">{product?.name ?? "—"}</p>
                        {product?.sku && <p className="font-mono text-xs text-muted-foreground">{product.sku}</p>}
                        {task.pallets?.pallet_barcode && (
                          <p className="font-mono text-xs text-muted-foreground">Pallet: {task.pallets.pallet_barcode}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-sm font-semibold">Qty {formatNumber(task.quantity)}</span>
                        <Badge variant={statusBadgeVariant(task.status)} className="text-xs">{task.status}</Badge>
                      </div>
                      {task.short_reason && (
                        <p className="w-full text-xs text-destructive">Short: {task.short_reason}</p>
                      )}
                    </div>
                  );
                })}
                <div className="flex flex-wrap gap-2 pt-1">
                  <Button asChild variant="outline" size="sm">
                    <Link to={`/pick-lists/${pickList.id}`}>Execute picks</Link>
                  </Button>
                  {exceptionCount > 0 && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => toast.warning("Short pick detected — check inventory levels or reassign stock from another location.", {
                        action: { label: "Inventory", onClick: () => navigate("/inventory-search") },
                        duration: 8000,
                      })}
                    >
                      <AlertTriangle className="mr-1 h-3 w-3" />
                      Resolve shortage
                    </Button>
                  )}
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
              {done.map((pl: any) => (
                <div key={pl.id} className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm opacity-60">
                  <span className="font-mono text-xs">{pl.pick_list_number}</span>
                  <Badge variant={statusBadgeVariant(pl.status)} className="text-xs">{pl.status}</Badge>
                </div>
              ))}
            </div>
          </details>
        )}
      </TabsContent>
      <TabsContent value="create">
        <Card>
          <CardContent className="p-6">
            <Form {...form}>
              <form className="grid gap-4 lg:grid-cols-2" onSubmit={form.handleSubmit((values) => mutation.mutate(values))}>
                <SelectField form={form} name="warehouse_id" label="Warehouse" options={(options?.warehouses ?? []).map((warehouse) => ({ label: warehouse.name, value: warehouse.id }))} />
                <SelectField form={form} name="client_id" label="Client" options={(options?.clients ?? []).map((client) => ({ label: client.name, value: client.id }))} />
                <TextField form={form} name="order_number" label="Order number" />
                <TextField form={form} name="requested_ship_date" label="Requested ship date" type="date" />
                <FormField
                  control={form.control}
                  name="notes"
                  render={({ field }) => (
                    <FormItem className="lg:col-span-2">
                      <FormLabel>Notes</FormLabel>
                      <FormControl>
                        <Textarea {...field} value={field.value ?? ""} />
                      </FormControl>
                    </FormItem>
                  )}
                />
                <Card className="lg:col-span-2">
                  <CardHeader>
                    <CardTitle className="text-base">Order lines</CardTitle>
                  </CardHeader>
                  <CardContent className="grid gap-3">
                    {lines.map((_, index) => (
                      <div key={index} className="grid gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(8rem,1fr)_auto]">
                        <SelectField
                          form={form}
                          name={`lines.${index}.product_id`}
                          label="Product"
                          options={(options?.products ?? []).map((product) => ({ label: `${product.sku} · ${product.name}`, value: product.id }))}
                        />
                        <TextField form={form} name={`lines.${index}.quantity`} label="Qty" type="number" />
                        <Button
                          className="w-full lg:mt-auto lg:w-auto"
                          type="button"
                          variant="outline"
                          onClick={() => form.setValue("lines", lines.filter((_, currentIndex) => currentIndex !== index))}
                        >
                          Remove
                        </Button>
                      </div>
                    ))}
                    <Button type="button" variant="outline" onClick={() => form.setValue("lines", [...lines, { product_id: "", quantity: 1 }])}>
                      Add line
                    </Button>
                  </CardContent>
                </Card>
                <Button className="w-full lg:col-span-2" type="submit" disabled={mutation.isPending}>
                  {mutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Release pick list
                </Button>
              </form>
            </Form>
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  );
}

export function TransfersPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: options } = useQuery({ queryKey: ["options"], queryFn: () => fetchOptions() });
  const { data: transfers = [] } = useQuery({ queryKey: ["transfers"], queryFn: listTransfers });
  const [signoffCodes, setSignoffCodes] = useState<Record<string, string>>({});
  // Per-transfer cancel panel state
  const [cancelState, setCancelState] = useState<Record<string, { open: boolean; reason: string }>>({});
  const form = useForm<z.infer<typeof transferSchema>>({
    resolver: zodResolver(transferSchema),
  });

  const createMutation = useMutation({
    mutationFn: async (values: z.infer<typeof transferSchema>) => createTransferFlow(values),
    onSuccess: async () => {
      toast.success("Transfer request created");
      form.reset();
      await queryClient.invalidateQueries({ queryKey: ["transfers"] });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Create transfer failed"),
  });

  const dispatchMutation = useMutation({
    mutationFn: async (transferId: string) => dispatchTransfer(transferId, signoffCodes[transferId] ?? ""),
    onSuccess: async () => {
      toast.success("Driver departure signed off — transfer dispatched");
      await queryClient.invalidateQueries({ queryKey: ["transfers"] });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Transfer dispatch failed"),
  });

  const receiveMutation = useMutation({
    mutationFn: async (transferId: string) => receiveTransfer(transferId),
    onSuccess: async () => {
      toast.success("Transfer received — putaway task created", {
        action: { label: "Go to Putaway", onClick: () => navigate("/putaway-tasks") },
        duration: 8000,
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["transfers"] }),
        queryClient.invalidateQueries({ queryKey: ["putaway-tasks"] }),
        queryClient.invalidateQueries({ queryKey: ["dashboard-metrics"] }),
      ]);
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Transfer receive failed"),
  });

  const cancelMutation = useMutation({
    mutationFn: async ({ transferId, reason }: { transferId: string; reason: string }) =>
      cancelTransfer(transferId, reason),
    onSuccess: async (_data, variables) => {
      setCancelState((s) => ({ ...s, [variables.transferId]: { open: false, reason: "" } }));
      toast.warning("Transfer cancelled — stock returned to receiving", {
        action: { label: "Go to Receiving", onClick: () => navigate("/receiving") },
        duration: 8000,
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["transfers"] }),
        queryClient.invalidateQueries({ queryKey: ["putaway-tasks"] }),
      ]);
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Cancel failed"),
  });

  const active = (transfers as any[]).filter((t) => !["completed", "cancelled"].includes(t.status));
  const done = (transfers as any[]).filter((t) => ["completed", "cancelled"].includes(t.status));

  return (
    <div className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
      <Card className="min-w-0">
        <CardHeader>
          <CardTitle>Create Transfer</CardTitle>
          <CardDescription>Preserve pallet identity, lot data, ownership, and audit history.</CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form className="grid gap-4" onSubmit={form.handleSubmit((values) => createMutation.mutate(values))}>
              <SelectField form={form} name="transfer_type" label="Transfer type" options={[
                { label: "Inter-warehouse", value: "inter_warehouse" },
                { label: "Intra-warehouse", value: "intra_warehouse" },
              ]} />
              <SelectField form={form} name="source_warehouse_id" label="Source warehouse" options={(options?.warehouses ?? []).map((warehouse) => ({ label: warehouse.name, value: warehouse.id }))} />
              <SelectField form={form} name="destination_warehouse_id" label="Destination warehouse" options={(options?.warehouses ?? []).map((warehouse) => ({ label: warehouse.name, value: warehouse.id }))} />
              <SelectField form={form} name="pallet_id" label="Pallet" options={(options?.pallets ?? []).map((pallet) => ({ label: `${pallet.pallet_code} · ${pallet.status}`, value: pallet.id }))} />
              <TextField form={form} name="quantity" label="Quantity" type="number" />
              <FormField
                control={form.control}
                name="notes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Notes</FormLabel>
                    <FormControl>
                      <Textarea {...field} value={field.value ?? ""} />
                    </FormControl>
                  </FormItem>
                )}
              />
              <Button className="w-full sm:w-auto" type="submit" disabled={createMutation.isPending}>
                {createMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Create transfer
              </Button>
            </form>
          </Form>
        </CardContent>
      </Card>

      <div className="grid min-w-0 content-start gap-4">
        {active.length === 0 && done.length === 0 && (
          <div className="rounded-lg border border-dashed border-border p-8 text-center">
            <Truck className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
            <p className="font-medium">No transfers yet</p>
            <p className="mt-1 text-sm text-muted-foreground">Create a transfer to move pallets between warehouses or zones.</p>
          </div>
        )}
        {active.map((transfer: any) => {
          const lines: any[] = transfer.transfer_lines ?? [];
          const cs = cancelState[transfer.id] ?? { open: false, reason: "" };
          const codeEntered = !!(signoffCodes[transfer.id] ?? "").trim();
          return (
            <Card key={transfer.id} className={transfer.status === "exception" ? "border-destructive/60" : ""}>
              <CardHeader>
                <CardTitle className="flex flex-wrap items-center justify-between gap-3">
                  <span className="min-w-0 font-mono text-base break-all">{transfer.transfer_number}</span>
                  <Badge variant={statusBadgeVariant(transfer.status)}>{transfer.status}</Badge>
                </CardTitle>
                <CardDescription>
                  {transfer.notes || "Pallet transfer"}
                  {transfer.dispatch_signed_off_at ? ` · departed ${formatDate(transfer.dispatch_signed_off_at)}` : ""}
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3">
                {/* Pallet / product summary */}
                {lines.map((line: any) => {
                  const product = line.pallets?.products as any;
                  return (
                    <div key={line.id} className="flex items-center gap-3 rounded-md border border-border bg-secondary/20 px-3 py-2 text-sm">
                      <Package className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <div className="min-w-0 flex-1">
                        <p className="font-medium truncate">{product?.name ?? "—"}</p>
                        {product?.sku && <p className="font-mono text-xs text-muted-foreground">{product.sku}</p>}
                        {line.pallets?.pallet_barcode && (
                          <p className="font-mono text-xs text-muted-foreground">Pallet: {line.pallets.pallet_barcode}</p>
                        )}
                      </div>
                      <span className="shrink-0 text-sm font-semibold">Qty {formatNumber(line.quantity)}</span>
                    </div>
                  );
                })}

                {/* Dispatch sign-off */}
                {transfer.status !== "completed" && transfer.status !== "cancelled" && (
                  <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-end">
                    <div>
                      <label className="text-sm font-medium" htmlFor={`signoff-${transfer.id}`}>Driver departure code</label>
                      <Input
                        id={`signoff-${transfer.id}`}
                        className="mt-1"
                        placeholder="Scan badge or enter user code"
                        value={signoffCodes[transfer.id] ?? ""}
                        onChange={(event) => setSignoffCodes((current) => ({ ...current, [transfer.id]: event.target.value }))}
                      />
                    </div>
                    <Button
                      className="w-full sm:w-auto"
                      variant="outline"
                      onClick={() => dispatchMutation.mutate(transfer.id)}
                      disabled={!codeEntered || transfer.status === "in_progress"}
                      title={!codeEntered ? "Enter driver code first" : undefined}
                    >
                      Dispatch
                    </Button>
                    <Button
                      className="w-full sm:w-auto"
                      onClick={() => receiveMutation.mutate(transfer.id)}
                      disabled={transfer.status === "queued"}
                      title={transfer.status === "queued" ? "Dispatch before receiving" : undefined}
                    >
                      Receive
                    </Button>
                  </div>
                )}
                <p className="text-xs text-muted-foreground">Departure requires the signed-in driver/admin/manager to scan their badge or enter their user code.</p>

                {/* Cancel / reroute panel */}
                {!["completed", "cancelled"].includes(transfer.status) && !cs.open && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-fit text-destructive hover:bg-destructive/10 hover:text-destructive"
                    onClick={() => setCancelState((s) => ({ ...s, [transfer.id]: { open: true, reason: "" } }))}
                  >
                    <PackageX className="mr-1 h-3.5 w-3.5" />
                    Cancel transfer
                  </Button>
                )}
                {cs.open && (
                  <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 grid gap-2">
                    <p className="text-sm font-medium text-destructive">Cancel this transfer?</p>
                    <p className="text-xs text-muted-foreground">Stock will be returned to Receiving and a new putaway task created.</p>
                    <Input
                      placeholder="Reason for cancellation (required)"
                      value={cs.reason}
                      onChange={(e) => setCancelState((s) => ({ ...s, [transfer.id]: { ...cs, reason: e.target.value } }))}
                    />
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="destructive"
                        disabled={!cs.reason.trim() || cancelMutation.isPending}
                        onClick={() => cancelMutation.mutate({ transferId: transfer.id, reason: cs.reason })}
                      >
                        Confirm cancel
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setCancelState((s) => ({ ...s, [transfer.id]: { open: false, reason: "" } }))}
                      >
                        Keep transfer
                      </Button>
                    </div>
                  </div>
                )}
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
              {done.map((t: any) => (
                <div key={t.id} className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm opacity-60">
                  <span className="font-mono text-xs">{t.transfer_number}</span>
                  <Badge variant={statusBadgeVariant(t.status)} className="text-xs">{t.status}</Badge>
                </div>
              ))}
            </div>
          </details>
        )}
      </div>
    </div>
  );
}

export function CycleCountsPage() {
  const queryClient = useQueryClient();
  const { data: options } = useQuery({ queryKey: ["options"], queryFn: () => fetchOptions() });
  const { data: counts = [] } = useQuery({ queryKey: ["cycle-counts"], queryFn: listCycleCounts });
  // Per-line "can't count" exception state
  const [exState, setExState] = useState<Record<string, { open: boolean; reason: string }>>({});

  const form = useForm<z.infer<typeof cycleCountSchema>>({
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

export function StatusPage() {
  const queryClient = useQueryClient();
  const { data = [] } = useQuery({ queryKey: ["status-pallets"], queryFn: listStatusPallets });
  const form = useForm<z.infer<typeof statusChangeSchema>>({
    resolver: zodResolver(statusChangeSchema),
  });
  const mutation = useMutation({
    mutationFn: changePalletStatus,
    onSuccess: async () => {
      toast.success("Status updated");
      form.reset({ pallet_id: "", reason: "" } as any);
      await queryClient.invalidateQueries({ queryKey: ["status-pallets"] });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Status update failed"),
  });

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_1fr]">
      <Card>
        <CardHeader>
          <CardTitle>Status Controls</CardTitle>
          <CardDescription>Move pallets into hold, quarantine, damage, available, or missing with audit logging.</CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form className="grid gap-4" onSubmit={form.handleSubmit((values) => mutation.mutate(values))}>
              <TextField form={form} name="pallet_id" label="Pallet barcode or ID" />
              <SelectField form={form} name="new_status" label="New status" options={[
                { label: "Hold", value: "hold" },
                { label: "Quarantine", value: "quarantine" },
                { label: "Damaged", value: "damaged" },
                { label: "Available", value: "available" },
                { label: "Missing", value: "missing" },
              ]} />
              <FormField
                control={form.control}
                name="reason"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Reason</FormLabel>
                    <FormControl>
                      <Textarea {...field} value={field.value ?? ""} />
                    </FormControl>
                  </FormItem>
                )}
              />
              <Button type="submit">Apply status</Button>
            </form>
          </Form>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Controlled stock</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3">
          {data.map((row: any) => (
            <div key={row.inventory_balance_id} className="flex items-center justify-between rounded-lg border border-border p-3">
              <div>
                <p className="font-medium">{row.sku}</p>
                <p className="text-sm text-muted-foreground">{row.pallet_code} · {row.location_code ?? "No location"}</p>
              </div>
              <Badge>{row.status}</Badge>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

export function ReportsPage() {
  const { data, isLoading } = useQuery({ queryKey: ["reports"], queryFn: getReportData });
  const { data: metrics } = useQuery({ queryKey: ["dashboard-metrics", "reports"], queryFn: getDashboardMetrics });
  const snapshot = useMemo(() => buildEnterpriseDashboard(metrics, data), [metrics, data]);
  const exportRows = useMemo(() => buildCsvReportRows(data), [data]);

  const stockByWarehouse = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of data?.inventory ?? []) {
      map.set(row.warehouse_code, (map.get(row.warehouse_code) ?? 0) + row.available_quantity);
    }
    return Array.from(map.entries());
  }, [data]);

  return (
    <div className="grid gap-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h2 className="text-2xl font-semibold">Reports & Analytics</h2>
          <p className="text-sm text-muted-foreground">Saved-style operational reporting, CSV export, AI recommendations, and Six Sigma signals.</p>
        </div>
        <Button variant="outline" onClick={() => downloadCsv("enterprise-inventory-report.csv", exportRows)}>
          <Download data-icon="inline-start" />
          Export inventory CSV
        </Button>
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {snapshot.officeWidgets.map((widget) => (
          <Card key={widget.label} className={cn("border-l-4", toneBorder(widget.tone))}>
            <CardHeader>
              <CardDescription>{widget.label}</CardDescription>
              <CardTitle className="text-3xl">{widget.value}</CardTitle>
              <CardDescription>{widget.detail}</CardDescription>
            </CardHeader>
          </Card>
        ))}
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Stock by warehouse</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2">
            {isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : stockByWarehouse.map(([warehouse, quantity]) => (
              <div key={warehouse} className="flex items-center justify-between rounded-lg bg-secondary/40 px-3 py-2">
                <span>{warehouse}</span>
                <span>{formatNumber(quantity)}</span>
              </div>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Occupancy view</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2">
            {(data?.occupancy ?? []).slice(0, 12).map((location: any) => (
              <div key={location.location_id} className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
                <div>
                  <p>{location.location_code}</p>
                  <p className="text-xs text-muted-foreground">{location.temperature_class}</p>
                </div>
                <Badge variant={location.is_full ? "destructive" : "secondary"}>
                  {location.occupied_pallets}/{location.max_pallets}
                </Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(22rem,0.75fr)]">
        <Card>
          <CardHeader>
            <CardTitle>Saved report catalog</CardTitle>
            <CardDescription>Decision-ready report outputs for managers, clerks, and auditors.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            {[
              ["Expiration risk", "Lots approaching FEFO cutoff by SKU, warehouse, and customer owner", "CSV"],
              ["Low stock warnings", "Balances at or below replenishment threshold with NetSuite sync status", "CSV"],
              ["Low turn stock", "Slow-moving inventory candidates for slotting or commercial review", "CSV"],
              ["Dock performance", "Staged, loaded, blocked, delayed, and route handoff timings", "CSV"],
              ["Six Sigma variance", "Cycle-count defects, DPMO, root cause, and corrective action fields", "CSV"],
            ].map(([title, description, output]) => (
              <div key={title} className="flex flex-col gap-2 rounded-lg border border-border p-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="font-medium">{title}</p>
                  <p className="text-sm text-muted-foreground">{description}</p>
                </div>
                <Badge variant="outline">{output}</Badge>
              </div>
            ))}
          </CardContent>
        </Card>
        <WarehouseBrainPanel recommendations={snapshot.recommendations} />
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Recent movements</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2">
          {(data?.audits ?? []).map((audit: any) => (
            <div key={audit.id} className="rounded-lg border border-border px-3 py-2 text-sm">
              <div className="flex items-center justify-between gap-4">
                <span className="font-medium">{audit.event_type}</span>
                <span className="text-xs text-muted-foreground">{formatDate(audit.created_at)}</span>
              </div>
              <p className="text-xs text-muted-foreground">{audit.entity_table} · {audit.entity_id}</p>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

const inviteUserSchema = z.object({
  email: z.string().email("Valid email required"),
  full_name: z.string().min(2, "Name required"),
  password: z.string().min(8, "Min 8 characters"),
  role_code: z.string().optional(),
  warehouse_id: z.string().optional(),
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
                    <Select onValueChange={field.onChange} value={field.value ?? ""}>
                      <FormControl>
                        <SelectTrigger><SelectValue placeholder="Select role" /></SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="">No role assigned</SelectItem>
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
                    <Select onValueChange={field.onChange} value={field.value ?? ""}>
                      <FormControl>
                        <SelectTrigger><SelectValue placeholder="All warehouses" /></SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="">All warehouses</SelectItem>
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
  const queryClient = useQueryClient();
  const [includeHidden, setIncludeHidden] = useState(false);
  const { data: options } = useQuery({ queryKey: ["options", includeHidden], queryFn: () => fetchOptions(includeHidden) });
  const { data: activities = [] } = useQuery({ queryKey: ["user-activities"], queryFn: () => listUserActivities() });
  const [selectedProfile, setSelectedProfile] = useState("");
  const [selectedRole, setSelectedRole] = useState("");
  const [activeTab, setActiveTab] = useState("users");

  const invalidateOptions = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["options"] }),
      queryClient.invalidateQueries({ queryKey: ["user-activities"] }),
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

  const visibilityMutation = useMutation({
    mutationFn: async ({ userRoleId, hidden }: { userRoleId: string; hidden: boolean }) =>
      setUserRoleVisibility(userRoleId, hidden, hidden ? "Access hidden from user management" : undefined),
    onSuccess: async (_, variables) => {
      toast.success(variables.hidden ? "Role assignment hidden" : "Role assignment restored");
      await invalidateOptions();
    },
  });

  const profileMutation = useMutation({
    mutationFn: async ({ profileId, active }: { profileId: string; active: boolean }) => setProfileActive(profileId, active),
    onSuccess: async (_, variables) => {
      toast.success(variables.active ? "Profile enabled" : "Profile disabled");
      await invalidateOptions();
    },
  });

  const profileEditMutation = useMutation({
    mutationFn: updateProfileDetails,
    onSuccess: async () => {
      toast.success("User updated");
      await invalidateOptions();
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Update failed"),
  });

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
        <TabsList className="w-full sm:w-auto">
          <TabsTrigger value="users" className="gap-1.5">
            <Users className="h-3.5 w-3.5" />
            Users ({profiles.length})
          </TabsTrigger>
          <TabsTrigger value="roles" className="gap-1.5">
            <ShieldCheck className="h-3.5 w-3.5" />
            Access
          </TabsTrigger>
          <TabsTrigger value="activity" className="gap-1.5">
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
          <div className="grid gap-3">
            {profiles.map((profile) => (
              <UserProfileRow
                key={profile.id}
                profile={profile}
                warehouses={(options?.warehouses ?? []) as WarehouseOption[]}
                userRoles={(options?.userRoles ?? []).filter((ur: any) => ur.user_id === profile.id)}
                onSave={(values) => profileEditMutation.mutate(values)}
                onToggleActive={() =>
                  profileMutation.mutate({ profileId: profile.id, active: !(profile.active ?? true) })
                }
              />
            ))}
            {profiles.length === 0 && (
              <div className="rounded-lg border border-dashed border-border py-10 text-center text-sm text-muted-foreground">
                No users found. Use "Add User" to create the first one.
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="roles" className="mt-4">
          <div className="grid gap-6 xl:grid-cols-[1fr_1.5fr]">
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
                    {(options?.roles ?? []).map((role: any) => (
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

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Current Access</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-2">
                {(options?.userRoles ?? []).map((userRole: any) => {
                  const profile = profiles.find((p) => p.id === userRole.user_id);
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
                          {(userRole.roles as { name?: string } | null)?.name ?? "Role"}
                        </Badge>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 text-xs"
                          onClick={() => visibilityMutation.mutate({ userRoleId: userRole.id, hidden: !userRole.is_hidden })}
                        >
                          {userRole.is_hidden ? "Restore" : "Revoke"}
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          </div>
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

function UserProfileRow({
  profile,
  warehouses,
  userRoles,
  onSave,
  onToggleActive,
}: {
  profile: ProfileRow;
  warehouses: WarehouseOption[];
  userRoles: any[];
  onSave: (values: Parameters<typeof updateProfileDetails>[0]) => void;
  onToggleActive: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState({
    full_name: profile.full_name ?? "",
    phone: profile.phone ?? "",
    default_warehouse_id: profile.default_warehouse_id ?? "",
    active: profile.active ?? true,
    approved: profile.approved ?? false,
    user_code: profile.user_code ?? "",
    badge_code: profile.badge_code ?? "",
  });

  const initials = (profile.full_name ?? profile.email ?? "?")
    .split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "").join("") || "?";

  const roleNames = userRoles
    .filter((ur) => !ur.is_hidden)
    .map((ur) => (ur.roles as { name?: string } | null)?.name ?? "")
    .filter(Boolean);

  return (
    <div className={cn(
      "rounded-xl border border-border bg-card transition-colors",
      !profile.active && "opacity-60"
    )}>
      <div className="flex items-center gap-3 p-4">
        <Avatar className="h-10 w-10 shrink-0">
          <AvatarFallback className={cn(
            "text-sm font-semibold",
            profile.approved ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
          )}>
            {initials}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate font-medium">{profile.full_name ?? profile.email ?? profile.id}</p>
            <Badge
              variant={profile.approved ? "default" : "secondary"}
              className="text-xs"
            >
              {profile.approved ? "Approved" : "Pending"}
            </Badge>
            {!profile.active && <Badge variant="outline" className="text-xs">Inactive</Badge>}
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>{profile.email}</span>
            {profile.user_code && <span>· {profile.user_code}</span>}
            {roleNames.length > 0 && (
              <span className="flex items-center gap-1">
                ·
                {roleNames.map((name) => (
                  <Badge key={name} variant="outline" className="text-xs px-1.5 py-0">{name}</Badge>
                ))}
              </span>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Button
            size="sm"
            variant="ghost"
            className="h-8 text-xs"
            onClick={onToggleActive}
          >
            {profile.active ? "Disable" : "Enable"}
          </Button>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button size="sm" variant="outline" className="h-8 text-xs">Edit</Button>
            </DialogTrigger>
            <DialogContent className="max-h-[90vh] overflow-hidden sm:max-w-lg">
              <DialogHeader>
                <DialogTitle>Edit User</DialogTitle>
                <DialogDescription>Update operational access, codes, and approval status.</DialogDescription>
              </DialogHeader>
              <ScrollArea className="max-h-[70vh] pr-4">
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
                    <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-border px-3 py-2.5 text-sm hover:bg-accent">
                      <Checkbox
                        checked={values.active}
                        onCheckedChange={(c) => setValues((v) => ({ ...v, active: Boolean(c) }))}
                      />
                      <div>
                        <p className="font-medium">Active</p>
                        <p className="text-xs text-muted-foreground">Can sign in</p>
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
                  <Button
                    className="w-full"
                    onClick={() => {
                      onSave({ profileId: profile.id, ...values });
                      setOpen(false);
                    }}
                  >
                    Save changes
                  </Button>
                </div>
              </ScrollArea>
            </DialogContent>
          </Dialog>
        </div>
      </div>
    </div>
  );
}

export function SettingsPage() {
  const { roles } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const resetMutation = useMutation({
    mutationFn: resetWmsData,
    onSuccess: async () => {
      toast.success("Environment reset complete. Launching the warehouse setup wizard.");
      await queryClient.invalidateQueries();
      navigate("/setup-wizard");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Reset failed"),
  });

  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Environment & Setup</CardTitle>
          <CardDescription>Use the setup wizard to build the warehouse structure and seed operational starter data.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm text-muted-foreground">
          <p>1. Keep users and role assignments in place.</p>
          <p>2. Launch the warehouse setup wizard to define warehouses, zones, and location rules.</p>
          <p>3. Seed starter operational data so receiving, putaway, picking, transfers, and counts can be tested immediately.</p>
          <div className="flex flex-wrap gap-2 pt-2">
            <Button asChild>
              <Link to="/setup-wizard">Open warehouse setup wizard</Link>
            </Button>
            <Button variant="destructive" onClick={() => resetMutation.mutate()} disabled={resetMutation.isPending || !roles.includes("admin")}>
              {resetMutation.isPending ? <Loader2 className="animate-spin" /> : <RotateCcw data-icon="inline-start" />}
              Reset all
            </Button>
          </div>
          {!roles.includes("admin") ? <p>Only admins can run Reset All.</p> : null}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Role Matrix</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2">
          {roles.map((role) => (
            <div key={role} className="rounded-lg border border-border px-3 py-2">
              <p className="font-medium">{ROLE_LABELS[role]}</p>
              <p className="text-xs text-muted-foreground">
                {role === "admin"
                  ? "Full system access"
                  : role === "warehouse_manager"
                    ? "Operational control across all warehouse functions"
                    : role === "inventory_clerk"
                      ? "Receiving, counts, search, and routine moves"
                      : role === "dispatch_driver"
                        ? "Transfer sign-off and inter-warehouse handoff visibility"
                        : "Assigned task execution and limited search"}
              </p>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

export function MobileActionBar({ primaryTo, primaryLabel }: { primaryTo: AppRoute; primaryLabel: string }) {
  return (
    <Drawer>
      <DrawerTrigger asChild>
        <Button className="fixed bottom-4 right-4 lg:hidden">
          <Plus data-icon="inline-start" />
          Quick actions
        </Button>
      </DrawerTrigger>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>Quick actions</DrawerTitle>
        </DrawerHeader>
        <div className="grid gap-2 p-4">
          <Button asChild>
            <Link to={primaryTo}>{primaryLabel}</Link>
          </Button>
          <Button asChild variant="outline">
            <Link to="/inventory-search">Search inventory</Link>
          </Button>
          <Button asChild variant="outline">
            <Link to="/putaway-tasks">Putaway queue</Link>
          </Button>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
