import { useEffect, useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Archive, CheckCircle2, ChevronDown, ClipboardCheck, Eye, Plus, RefreshCw, Search, ShieldCheck, Trash2, UserCog, XCircle } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";

import { useAuth } from "@/hooks/use-auth";
import { OFFLINE_WORK_MESSAGE, assertOnline, useNetworkStatus } from "@/hooks/use-network-status";
import { isLikelyNetworkError } from "@/lib/offline-queue";
import { alertToast } from "@/features/shared/ui-shared";
import {
  acceptCycleCountExceptionLine,
  archiveCancelledCycleCount,
  canCancelCycleCount,
  cancelCycleCount,
  claimCycleCountLine,
  approveCycleCountLine,
  closeCycleCount,
  createCycleCountFlow,
  cycleCountSchema,
  discardDraftCycleCount,
  fetchOptions,
  flagCycleCountLineException,
  formatDate,
  formatNumber,
  listCycleCounts,
  listCycleCountAssignees,
  listCycleCountProductIds,
  listMyCycleCountLines,
  releaseCycleCountLineClaim,
  rejectCycleCountLine,
  returnCycleCountExceptionLine,
  submitCycleCountLine,
  ROLE_LABELS,
  type RoleCode,
} from "@/lib/wms-core";
import {
  clearCycleCountResumeSnapshot,
  loadCycleCountResumeSnapshot,
  saveCycleCountResumeSnapshot,
} from "@/lib/floor-task-resume";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

const supervisorRoles = new Set(["developer", "admin", "warehouse_manager", "warehouse_supervisor"]);
const managerRoles = new Set(["developer", "admin", "warehouse_manager"]);
const rolePreviewOptions: RoleCode[] = [
  "developer",
  "admin",
  "warehouse_manager",
  "warehouse_supervisor",
  "inventory_clerk",
  "warehouse_operator",
  "dispatch_driver",
];
const countStatusFilters = ["all", "active", "draft", "frozen", "counting", "review", "approved", "closed", "cancelled", "archived"] as const;
type CountStatusFilter = (typeof countStatusFilters)[number];
type CycleCountCancellationTarget = { id: string; count_number: string; status: string };

function lineStatus(line: any) {
  return line.line_status ?? line.status ?? "queued";
}

function countStatusVariant(status: string) {
  if (["approved", "closed", "reconciled", "adjusted"].includes(status)) return "default";
  if (["review", "variance_hold", "exception", "recount"].includes(status)) return "destructive";
  if (["counting", "frozen", "queued", "counted"].includes(status)) return "secondary";
  return "outline";
}

function locationLabel(location: any) {
  return location?.code ?? [location?.aisle, location?.bay, location?.level, location?.position].filter(Boolean).join("-") ?? "Unassigned bin";
}

function isCountArchived(count: any) {
  return Boolean(count.archived_at) || String(count.notes ?? "").includes("[archived]");
}

export function CycleCountsPage() {
  const auth = useAuth();
  const queryClient = useQueryClient();
  const { online } = useNetworkStatus();
  const actualIsSupervisor = auth.roles.some((role) => supervisorRoles.has(role));
  const isDeveloper = auth.roles.includes("developer");
  const [rolePreview, setRolePreview] = useState<RoleCode>("developer");
  const effectiveRoles = isDeveloper ? [rolePreview] : auth.roles;
  const isSupervisor = effectiveRoles.some((role) => supervisorRoles.has(role));
  const isManager = effectiveRoles.some((role) => managerRoles.has(role));
  const [activeTab, setActiveTab] = useState(actualIsSupervisor ? "manage" : "entry");
  const [createOpen, setCreateOpen] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<CycleCountCancellationTarget | null>(null);
  const [cancellationReason, setCancellationReason] = useState("");
  const [statusFilter, setStatusFilter] = useState<CountStatusFilter>("active");
  const [entryQty, setEntryQty] = useState<Record<string, string>>({});
  const [exceptionReason, setExceptionReason] = useState<Record<string, string>>({});
  const [approvalReason, setApprovalReason] = useState<Record<string, string>>({});
  const resumeHydratedRef = useRef(false);
  const wasOfflineRef = useRef(!online);
  const resumeUserId = auth.profile?.id ?? null;

  const { data: options } = useQuery({ queryKey: ["options", "cycle-counts"], queryFn: () => fetchOptions() });
  const { data: counts = [] } = useQuery({
    queryKey: ["cycle-counts"],
    queryFn: listCycleCounts,
    enabled: actualIsSupervisor,
  });
  const { data: assignedLines = [] } = useQuery({
    queryKey: ["cycle-count-lines", "assigned"],
    queryFn: listMyCycleCountLines,
    refetchInterval: 30_000,
  });

  const form = useForm<z.infer<typeof cycleCountSchema>>({
    resolver: zodResolver(cycleCountSchema),
    defaultValues: {
      scope: "spot",
      location_ids: [],
      zone_ids: [],
      product_ids: [],
      variance_threshold_percent: 5,
      freeze_hours: 4,
      assigned_user_id: "",
      assigned_user_ids: [],
    },
  });

  useEffect(() => {
    if (!isSupervisor && activeTab !== "entry") {
      setActiveTab("entry");
    }
  }, [activeTab, isSupervisor]);

  const activeWarehouseId = auth.profile?.default_warehouse_id ?? options?.warehouses?.[0]?.id ?? "";
  const activeWarehouse = (options?.warehouses ?? []).find((warehouse: any) => warehouse.id === activeWarehouseId);
  const availableZones = (options?.zones ?? []).filter((zone: any) => zone.warehouse_id === activeWarehouseId);
  const selectedZoneIds = form.watch("zone_ids") ?? [];
  const selectedLocationIds = form.watch("location_ids") ?? [];
  const selectedProductIds = form.watch("product_ids") ?? [];
  const selectedAssigneeIds = form.watch("assigned_user_ids") ?? [];
  const availableLocations = (options?.locations ?? []).filter((location: any) =>
    location.warehouse_id === activeWarehouseId && (selectedZoneIds.length === 0 || selectedZoneIds.includes(location.zone_id)),
  );
  const { data: countableProductIds = [] } = useQuery({
    queryKey: ["cycle-count-product-ids", activeWarehouseId, selectedZoneIds, selectedLocationIds],
    queryFn: () => listCycleCountProductIds({ warehouseId: activeWarehouseId, zoneIds: selectedZoneIds, locationIds: selectedLocationIds }),
    enabled: Boolean(activeWarehouseId),
  });
  const availableProducts = (options?.products ?? []).filter((product: any) => countableProductIds.includes(product.id));
  const { data: availableAssignees = [] } = useQuery({
    queryKey: ["cycle-count-assignees", activeWarehouseId],
    queryFn: () => listCycleCountAssignees(activeWarehouseId),
    enabled: Boolean(activeWarehouseId),
  });
  const zoneSelectionLabel = selectedZoneIds.length === 0
    ? "Any zone"
    : selectedZoneIds.length === availableZones.length
      ? "All zones"
      : `${selectedZoneIds.length} zone${selectedZoneIds.length === 1 ? "" : "s"} selected`;

  useEffect(() => {
    if (!activeWarehouseId) return;
    form.setValue("warehouse_id", activeWarehouseId, { shouldValidate: true });
    form.setValue("zone_ids", []);
    form.setValue("zone_id", "");
    form.setValue("location_ids", []);
    form.setValue("location_id", "");
    form.setValue("product_ids", []);
    form.setValue("product_id", "");
  }, [activeWarehouseId, form]);

  useEffect(() => {
    const availableProductIdSet = new Set(countableProductIds);
    const retainedProductIds = selectedProductIds.filter((productId) => availableProductIdSet.has(productId));
    if (retainedProductIds.length !== selectedProductIds.length) {
      form.setValue("product_ids", retainedProductIds, { shouldValidate: true });
      form.setValue("product_id", retainedProductIds.length === 1 ? retainedProductIds[0] : "");
      toast.message("Products outside the current location scope were cleared.");
    }
  }, [countableProductIds, form, selectedProductIds]);

  useEffect(() => {
    if (resumeHydratedRef.current) return;
    if (!resumeUserId) return;
    resumeHydratedRef.current = true;
    const snapshot = loadCycleCountResumeSnapshot({ userId: resumeUserId });
    if (!snapshot) return;
    setEntryQty(snapshot.entryQty ?? {});
    setExceptionReason(snapshot.exceptionReason ?? {});
    setApprovalReason(snapshot.approvalReason ?? {});
  }, [resumeUserId]);

  useEffect(() => {
    if (!resumeUserId) return;
    const hasResumeState =
      Object.values(entryQty).some((value) => value.trim().length > 0) ||
      Object.values(exceptionReason).some((value) => value.trim().length > 0) ||
      Object.values(approvalReason).some((value) => value.trim().length > 0);
    if (!hasResumeState) {
      clearCycleCountResumeSnapshot();
      return;
    }
    saveCycleCountResumeSnapshot({
      userId: resumeUserId,
      entryQty,
      exceptionReason,
      approvalReason,
      updatedAt: Date.now(),
    });
  }, [approvalReason, entryQty, exceptionReason, resumeUserId]);

  useEffect(() => {
    if (!online) {
      wasOfflineRef.current = true;
      return;
    }
    if (!wasOfflineRef.current) return;
    wasOfflineRef.current = false;
    void Promise.all([
      queryClient.invalidateQueries({ queryKey: ["cycle-counts"] }),
      queryClient.invalidateQueries({ queryKey: ["cycle-count-lines", "assigned"] }),
      queryClient.invalidateQueries({ queryKey: ["options", "cycle-counts"] }),
    ]);
    toast.message("Connection restored. Refreshing live cycle-count state before the next post.");
  }, [online, queryClient]);

  async function runOnlineCycleCountCommit<T>(operation: () => Promise<T>) {
    assertOnline();
    try {
      return await operation();
    } catch (error) {
      if (isLikelyNetworkError(error)) {
        throw new Error(OFFLINE_WORK_MESSAGE);
      }
      throw error;
    }
  }

  const createMutation = useMutation({
    mutationFn: (values: z.infer<typeof cycleCountSchema>) => runOnlineCycleCountCommit(() => createCycleCountFlow(values)),
    onSuccess: async (result: any) => {
      alertToast.success(`Count created with ${result.claimed_line_count ?? 0} line(s)`);
      form.reset({ warehouse_id: activeWarehouseId, scope: "spot", zone_id: "", zone_ids: [], location_id: "", location_ids: [], product_id: "", product_ids: [], variance_threshold_percent: 5, freeze_hours: 4, assigned_user_id: "", assigned_user_ids: [] });
      setCreateOpen(false);
      await queryClient.invalidateQueries({ queryKey: ["cycle-counts"] });
      await queryClient.invalidateQueries({ queryKey: ["cycle-count-lines", "assigned"] });
    },
    onError: (error) => alertToast.noGo(error instanceof Error ? error.message : "Count creation failed"),
  });

  const submitMutation = useMutation({
    mutationFn: ({ lineId, quantity }: { lineId: string; quantity: number }) => runOnlineCycleCountCommit(() => submitCycleCountLine(lineId, quantity)),
    onSuccess: async (_data, variables) => {
      setEntryQty((current) => ({ ...current, [variables.lineId]: "" }));
      alertToast.success("Blind count submitted");
      await queryClient.invalidateQueries({ queryKey: ["cycle-counts"] });
      await queryClient.invalidateQueries({ queryKey: ["cycle-count-lines", "assigned"] });
    },
    onError: (error) => alertToast.noGo(error instanceof Error ? error.message : "Submit failed"),
  });

  const claimMutation = useMutation({
    mutationFn: (lineId: string) => runOnlineCycleCountCommit(() => claimCycleCountLine(lineId)),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["cycle-count-lines", "assigned"] });
    },
    onError: (error) => alertToast.noGo(error instanceof Error ? error.message : "Could not claim this count line"),
  });

  const releaseClaimMutation = useMutation({
    mutationFn: (lineId: string) => runOnlineCycleCountCommit(() => releaseCycleCountLineClaim(lineId)),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["cycle-count-lines", "assigned"] });
    },
    onError: (error) => alertToast.noGo(error instanceof Error ? error.message : "Could not release this count-line claim"),
  });

  const exceptionMutation = useMutation({
    mutationFn: ({ lineId, reason }: { lineId: string; reason: string }) => runOnlineCycleCountCommit(() => flagCycleCountLineException(lineId, reason)),
    onSuccess: async (_data, variables) => {
      setExceptionReason((current) => ({ ...current, [variables.lineId]: "" }));
      alertToast.attention("Line flagged for supervisor review");
      await queryClient.invalidateQueries({ queryKey: ["cycle-counts"] });
      await queryClient.invalidateQueries({ queryKey: ["cycle-count-lines", "assigned"] });
    },
    onError: (error) => alertToast.noGo(error instanceof Error ? error.message : "Exception update failed"),
  });

  const approveMutation = useMutation({
    mutationFn: ({ lineId, reason }: { lineId: string; reason: string }) => runOnlineCycleCountCommit(() => approveCycleCountLine(lineId, reason)),
    onSuccess: async (_data, variables) => {
      setApprovalReason((current) => ({ ...current, [variables.lineId]: "" }));
      alertToast.success("Variance approved and posted");
      await queryClient.invalidateQueries({ queryKey: ["cycle-counts"] });
    },
    onError: (error) => alertToast.noGo(error instanceof Error ? error.message : "Approval failed"),
  });

  const rejectMutation = useMutation({
    mutationFn: ({ lineId, reason }: { lineId: string; reason: string }) => runOnlineCycleCountCommit(() => rejectCycleCountLine(lineId, reason)),
    onSuccess: async (_data, variables) => {
      setApprovalReason((current) => ({ ...current, [variables.lineId]: "" }));
      toast.info("Line returned for recount");
      await queryClient.invalidateQueries({ queryKey: ["cycle-counts"] });
    },
    onError: (error) => alertToast.noGo(error instanceof Error ? error.message : "Reject failed"),
  });

  const acceptExceptionMutation = useMutation({
    mutationFn: ({ lineId, reason }: { lineId: string; reason: string }) => runOnlineCycleCountCommit(() => acceptCycleCountExceptionLine(lineId, reason)),
    onSuccess: async (_data, variables) => {
      setApprovalReason((current) => ({ ...current, [variables.lineId]: "" }));
      alertToast.success("Exception reviewed");
      await queryClient.invalidateQueries({ queryKey: ["cycle-counts"] });
    },
    onError: (error) => alertToast.noGo(error instanceof Error ? error.message : "Exception review failed"),
  });

  const returnExceptionMutation = useMutation({
    mutationFn: ({ lineId, reason }: { lineId: string; reason: string }) => runOnlineCycleCountCommit(() => returnCycleCountExceptionLine(lineId, reason)),
    onSuccess: async (_data, variables) => {
      setApprovalReason((current) => ({ ...current, [variables.lineId]: "" }));
      toast.info("Exception returned to blind entry");
      await queryClient.invalidateQueries({ queryKey: ["cycle-counts"] });
      await queryClient.invalidateQueries({ queryKey: ["cycle-count-lines", "assigned"] });
    },
    onError: (error) => alertToast.noGo(error instanceof Error ? error.message : "Return failed"),
  });

  const closeMutation = useMutation({
    mutationFn: (countId: string) => runOnlineCycleCountCommit(() => closeCycleCount(countId)),
    onSuccess: async () => {
      alertToast.success("Cycle count closed and freezes released");
      await queryClient.invalidateQueries({ queryKey: ["cycle-counts"] });
    },
    onError: (error) => alertToast.noGo(error instanceof Error ? error.message : "Close failed"),
  });

  const discardDraftMutation = useMutation({
    mutationFn: (countId: string) => runOnlineCycleCountCommit(() => discardDraftCycleCount(countId)),
    onSuccess: async () => {
      alertToast.success("Draft count discarded");
      await queryClient.invalidateQueries({ queryKey: ["cycle-counts"] });
    },
    onError: (error) => alertToast.noGo(error instanceof Error ? error.message : "Discard failed"),
  });

  const archiveCancelledMutation = useMutation({
    mutationFn: (countId: string) => runOnlineCycleCountCommit(() => archiveCancelledCycleCount(countId)),
    onSuccess: async () => {
      alertToast.success("Cancelled count archived");
      await queryClient.invalidateQueries({ queryKey: ["cycle-counts"] });
    },
    onError: (error) => alertToast.noGo(error instanceof Error ? error.message : "Archive failed"),
  });

  const cancelMutation = useMutation({
    mutationFn: ({ countId, reason }: { countId: string; reason: string }) =>
      runOnlineCycleCountCommit(() => cancelCycleCount(countId, reason)),
    onSuccess: async (result) => {
      setCancelTarget(null);
      setCancellationReason("");
      const retainedAdjustmentMessage = result.adjustments_retained > 0
        ? ` ${result.adjustments_retained} posted adjustment(s) were retained.`
        : "";
      alertToast.success(`Cycle count cancelled and ${result.freezes_released} freeze(s) released.${retainedAdjustmentMessage}`);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["cycle-counts"] }),
        queryClient.invalidateQueries({ queryKey: ["cycle-count-lines", "assigned"] }),
      ]);
    },
    onError: (error) => alertToast.noGo(error instanceof Error ? error.message : "Cancellation failed"),
  });

  const filteredCounts = useMemo(() => {
    return (counts as any[]).filter((count) => {
      const archived = isCountArchived(count);
      if (statusFilter === "archived") return archived;
      if (archived) return false;
      if (statusFilter === "all") return true;
      if (statusFilter === "active") return !["closed", "cancelled"].includes(count.status);
      return count.status === statusFilter;
    });
  }, [counts, statusFilter]);

  const reviewLines = useMemo(
    () => (counts as any[]).flatMap((count) =>
      (count.cycle_count_lines ?? [])
        .filter((line: any) => lineStatus(line) === "variance_hold" || (lineStatus(line) === "exception" && !line.approved_at))
        .map((line: any) => ({ ...line, count })),
    ),
    [counts],
  );

  function setSelectedZones(zoneIds: string[]) {
    const uniqueZoneIds = Array.from(new Set(zoneIds));
    form.setValue("zone_ids", uniqueZoneIds, { shouldValidate: true });
    form.setValue("zone_id", uniqueZoneIds.length === 1 ? uniqueZoneIds[0] : "");
    const validLocationIds = new Set((options?.locations ?? [])
      .filter((location: any) => location.warehouse_id === activeWarehouseId && (uniqueZoneIds.length === 0 || uniqueZoneIds.includes(location.zone_id)))
      .map((location: any) => location.id));
    const retainedLocations = form.getValues("location_ids").filter((locationId) => validLocationIds.has(locationId));
    if (retainedLocations.length !== form.getValues("location_ids").length) {
      form.setValue("location_ids", retainedLocations, { shouldValidate: true });
      form.setValue("location_id", retainedLocations.length === 1 ? retainedLocations[0] : "");
      toast.message("Locations outside the selected zones were cleared.");
    }
  }

  function openCreateDialog() {
    form.reset({
      warehouse_id: activeWarehouseId,
      scope: "spot",
      zone_id: "",
      zone_ids: [],
      location_id: "",
      location_ids: [],
      product_id: "",
      product_ids: [],
      variance_threshold_percent: 5,
      freeze_hours: 4,
      assigned_user_id: "",
      assigned_user_ids: [],
    });
    setCreateOpen(true);
  }

  return (
    <div className="grid min-w-0 gap-5">
      {!online && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
          <p className="font-medium">This device is offline. Cycle-count posts are frozen.</p>
          <p className="mt-1">Keep entered quantities and reasons on this device, reconnect, and refresh live state before submitting or approving.</p>
        </div>
      )}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-normal">Cycle Counts</h1>
          <p className="text-sm text-muted-foreground">Blind counting with bin freezes, recounts, and supervisor approval.</p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {isDeveloper && (
            <div className="flex min-w-[220px] items-center gap-2 rounded-md border border-border bg-card px-2 py-1">
              <UserCog className="h-4 w-4 text-muted-foreground" />
              <Select value={rolePreview} onValueChange={(value) => setRolePreview(value as RoleCode)}>
                <SelectTrigger className="h-8 border-0 bg-transparent px-0 shadow-none focus:ring-0">
                  <SelectValue aria-label="Preview role" />
                </SelectTrigger>
                <SelectContent>
                  {rolePreviewOptions.map((role) => (
                    <SelectItem key={role} value={role}>{ROLE_LABELS[role]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {isSupervisor && (
            <Button onClick={openCreateDialog} disabled={!online || !activeWarehouseId}>
              <Plus className="mr-2 h-4 w-4" />
              New count
            </Button>
          )}
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="min-w-0">
        <TabsList className="flex h-auto flex-wrap justify-start">
          {isSupervisor && <TabsTrigger value="manage">Create & Monitor</TabsTrigger>}
          <TabsTrigger value="entry">Blind Entry</TabsTrigger>
          {isSupervisor && <TabsTrigger value="approvals">Approvals</TabsTrigger>}
        </TabsList>

        {isSupervisor && (
          <TabsContent value="manage" className="mt-4 grid min-w-0 gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Eye className="h-4 w-4" />
                <span>{filteredCounts.length} of {(counts as any[]).length} count{(counts as any[]).length === 1 ? "" : "s"}</span>
              </div>
              <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as CountStatusFilter)}>
                <SelectTrigger className="w-full sm:w-[220px]">
                  <SelectValue placeholder="Filter status" />
                </SelectTrigger>
                <SelectContent>
                  {countStatusFilters.map((status) => (
                    <SelectItem key={status} value={status}>
                      {status === "all" ? "All statuses" : status === "active" ? "Active counts" : status[0].toUpperCase() + status.slice(1)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid content-start gap-3">
              {(counts as any[]).length === 0 ? (
                <EmptyState title="No counts yet" body="Create a count to claim bins and generate blind entry work." />
              ) : filteredCounts.length === 0 ? (
                <EmptyState title="No counts match" body="Change the status filter to review another part of the count history." />
              ) : filteredCounts.map((count: any) => {
                const lines = count.cycle_count_lines ?? [];
                const openFreezes = (count.inventory_freezes ?? []).filter((freeze: any) => freeze.status === "active");
                const doneLines = lines.filter((line: any) => ["reconciled", "adjusted", "exception"].includes(lineStatus(line))).length;
                return (
                  <Card key={count.id}>
                    <CardHeader className="pb-3">
                      <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base">
                        <span className="font-mono">{count.count_number}</span>
                        <div className="flex flex-wrap items-center gap-2">
                          {isCountArchived(count) && <Badge variant="outline">archived</Badge>}
                          <Badge variant={countStatusVariant(count.status) as any}>{count.status}</Badge>
                        </div>
                      </CardTitle>
                      <CardDescription>
                        {count.scope} · {doneLines}/{lines.length} lines resolved · {openFreezes.length} active freeze(s) · expires {formatDate(count.freeze_expires_at)}
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="grid gap-2">
                      {count.notes && <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">{count.notes}</p>}
                      {lines.slice(0, 8).map((line: any) => (
                        <div key={line.id} className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm">
                          <div className="min-w-0">
                            <p className="truncate font-medium">{line.products?.sku ?? "Product"} · {locationLabel(line.locations)}</p>
                            <p className="text-xs text-muted-foreground">Expected {formatNumber(line.expected_quantity)} · variance {formatNumber(line.variance_quantity)} ({Number(line.variance_percent ?? 0).toFixed(1)}%)</p>
                          </div>
                          <Badge variant={countStatusVariant(lineStatus(line)) as any}>{lineStatus(line)}</Badge>
                        </div>
                      ))}
                      {lines.length > 8 && <p className="text-xs text-muted-foreground">Showing 8 of {lines.length} lines.</p>}
                      <div className="flex flex-wrap gap-2">
                        {count.status === "approved" && (
                          <Button size="sm" onClick={() => closeMutation.mutate(count.id)} disabled={!online || closeMutation.isPending}>
                            <CheckCircle2 className="mr-2 h-4 w-4" />
                            Close and release freezes
                          </Button>
                        )}
                        {count.status === "draft" && !isManager && (
                          <Button size="sm" variant="outline" onClick={() => discardDraftMutation.mutate(count.id)} disabled={!online || discardDraftMutation.isPending}>
                            <Trash2 className="mr-2 h-4 w-4" />
                            Discard draft
                          </Button>
                        )}
                        {isManager && canCancelCycleCount(count.status) && (
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => {
                              setCancelTarget(count);
                              setCancellationReason("");
                            }}
                            disabled={!online || cancelMutation.isPending}
                          >
                            <XCircle className="mr-2 h-4 w-4" />
                            Cancel count
                          </Button>
                        )}
                        {count.status === "cancelled" && !isCountArchived(count) && (
                          <Button size="sm" variant="outline" onClick={() => archiveCancelledMutation.mutate(count.id)} disabled={!online || archiveCancelledMutation.isPending}>
                            <Archive className="mr-2 h-4 w-4" />
                            Archive cancelled
                          </Button>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </TabsContent>
        )}

        <TabsContent value="entry" className="mt-4 grid gap-3">
          {assignedLines.length === 0 ? (
            <EmptyState title="No assigned lines" body="Assigned blind count work appears here. Expected quantities are not shown." />
          ) : assignedLines.map((line: any) => {
            const status = lineStatus(line);
            const qtyValue = entryQty[line.id] ?? "";
            const reason = exceptionReason[line.id] ?? "";
            const claimSupportAvailable = !line.claim_support_unavailable;
            const claimIsActive = Boolean(line.claimed_by_user_id && line.claim_expires_at && new Date(line.claim_expires_at).getTime() > Date.now());
            const claimedByMe = !claimSupportAvailable || (claimIsActive && line.claimed_by_user_id === resumeUserId);
            const claimedByAnotherCounter = claimSupportAvailable && claimIsActive && !claimedByMe;
            return (
              <Card key={line.id}>
                <CardHeader className="pb-3">
                  <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base">
                    <span>{line.cycle_counts?.count_number ?? line.cycle_count_id} · {line.products?.sku ?? "Confirm empty location"} · {locationLabel(line.locations)}</span>
                    <Badge variant={countStatusVariant(status) as any}>{status}</Badge>
                  </CardTitle>
                  <CardDescription>{line.products?.name ?? line.notes ?? "Blind count"} · {line.cycle_counts?.scope ?? "cycle"} count · shared team line</CardDescription>
                </CardHeader>
                {claimedByMe ? (
                  <CardContent className="grid gap-3 sm:grid-cols-[minmax(160px,260px)_1fr]">
                    <div className="grid gap-2">
                      <div className="flex items-center justify-between gap-2">
                        <Label htmlFor={`qty-${line.id}`}>{status === "recount" ? "Recount quantity" : "Count quantity"}</Label>
                        {claimSupportAvailable && <Button variant="ghost" size="sm" disabled={!online || releaseClaimMutation.isPending} onClick={() => releaseClaimMutation.mutate(line.id)}>Release my claim</Button>}
                      </div>
                      <Input
                        id={`qty-${line.id}`}
                        inputMode="decimal"
                        type="number"
                        min="0"
                        value={qtyValue}
                        onChange={(event) => setEntryQty((current) => ({ ...current, [line.id]: event.target.value }))}
                      />
                      <Button
                        disabled={!online || submitMutation.isPending || qtyValue.trim() === ""}
                        onClick={() => submitMutation.mutate({ lineId: line.id, quantity: Number(qtyValue) })}
                      >
                        Submit blind count
                      </Button>
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor={`exception-${line.id}`}>Cannot count reason</Label>
                      <Textarea
                        id={`exception-${line.id}`}
                        value={reason}
                        onChange={(event) => setExceptionReason((current) => ({ ...current, [line.id]: event.target.value }))}
                        placeholder="Blocked location, damaged pallet, unsafe access..."
                      />
                      <Button
                        variant="outline"
                        disabled={!online || exceptionMutation.isPending || reason.trim().length < 3}
                        onClick={() => exceptionMutation.mutate({ lineId: line.id, reason })}
                      >
                        <AlertTriangle className="mr-2 h-4 w-4" />
                        Flag exception
                      </Button>
                    </div>
                  </CardContent>
                ) : (
                  <CardContent className="flex flex-wrap items-center justify-between gap-3">
                    <p className="text-sm text-muted-foreground">
                      {claimedByAnotherCounter ? "Another counter is entering this line. It returns to the team when released or after 15 minutes of inactivity." : "Claim this line to enter a blind count."}
                    </p>
                    <Button disabled={!online || claimedByAnotherCounter || claimMutation.isPending} onClick={() => claimMutation.mutate(line.id)}>
                      Claim count line
                    </Button>
                  </CardContent>
                )}
              </Card>
            );
          })}
        </TabsContent>

        {isSupervisor && (
          <TabsContent value="approvals" className="mt-4 grid gap-3">
            {reviewLines.length === 0 ? (
              <EmptyState title="No reviews waiting" body="Over-threshold recounts and count exceptions appear here for supervisor action." />
            ) : reviewLines.map((line: any) => {
              const reason = approvalReason[line.id] ?? "";
              const isException = lineStatus(line) === "exception";
              return (
                <Card key={line.id} className="border-amber-500/60">
                  <CardHeader className="pb-3">
                    <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base">
                      <span>{line.count.count_number} · {line.products?.sku ?? "Product"}</span>
                      <Badge variant="destructive">{isException ? "Exception review" : "Variance hold"}</Badge>
                    </CardTitle>
                    <CardDescription>
                      {isException
                        ? `${locationLabel(line.locations)} · expected ${formatNumber(line.expected_quantity)} · ${line.exception_reason ?? line.notes ?? "No reason recorded"}`
                        : `${locationLabel(line.locations)} · first ${formatNumber(line.first_count_qty)} · recount ${formatNumber(line.recount_qty)} · expected ${formatNumber(line.expected_quantity)}`}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="grid gap-3">
                    <div className="flex flex-wrap gap-2 text-sm">
                      <Badge variant="outline">Qty variance {formatNumber(line.variance_quantity)}</Badge>
                      <Badge variant="outline">{Number(line.variance_percent ?? 0).toFixed(1)}%</Badge>
                    </div>
                    <Textarea
                      value={reason}
                      onChange={(event) => setApprovalReason((current) => ({ ...current, [line.id]: event.target.value }))}
                      placeholder={isException ? "Supervisor exception review note" : "Approval or rejection reason"}
                    />
                    <div className="flex flex-wrap gap-2">
                      {isException ? (
                        <>
                          <Button disabled={!online || acceptExceptionMutation.isPending || reason.trim().length < 3} onClick={() => acceptExceptionMutation.mutate({ lineId: line.id, reason })}>
                            <ShieldCheck className="mr-2 h-4 w-4" />
                            Accept exception
                          </Button>
                          <Button variant="outline" disabled={!online || returnExceptionMutation.isPending || reason.trim().length < 3} onClick={() => returnExceptionMutation.mutate({ lineId: line.id, reason })}>
                            <XCircle className="mr-2 h-4 w-4" />
                            Return to blind entry
                          </Button>
                        </>
                      ) : (
                        <>
                          <Button disabled={!online || approveMutation.isPending || reason.trim().length < 3} onClick={() => approveMutation.mutate({ lineId: line.id, reason })}>
                            <ShieldCheck className="mr-2 h-4 w-4" />
                            Approve and post
                          </Button>
                          <Button variant="outline" disabled={!online || rejectMutation.isPending || reason.trim().length < 3} onClick={() => rejectMutation.mutate({ lineId: line.id, reason })}>
                            <XCircle className="mr-2 h-4 w-4" />
                            Reject for recount
                          </Button>
                        </>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </TabsContent>
        )}
      </Tabs>

      <Dialog open={createOpen} onOpenChange={(open) => { if (!createMutation.isPending) setCreateOpen(open); }}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Plus className="h-4 w-4" />
              Create Count
            </DialogTitle>
            <DialogDescription>Supervisors create a frozen bin claim before counters enter quantities.</DialogDescription>
          </DialogHeader>
          <form className="grid gap-3" onSubmit={form.handleSubmit((values) => createMutation.mutate(values))}>
            <Select value={activeWarehouseId} disabled>
              <SelectTrigger aria-label="Active warehouse"><SelectValue placeholder="Active warehouse" /></SelectTrigger>
              <SelectContent>
                {activeWarehouse && <SelectItem value={activeWarehouse.id}>{activeWarehouse.name}</SelectItem>}
              </SelectContent>
            </Select>
            <Select value={form.watch("scope")} onValueChange={(value: any) => form.setValue("scope", value, { shouldValidate: true })}>
              <SelectTrigger><SelectValue placeholder="Scope" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="spot">Spot/bin</SelectItem>
                <SelectItem value="location">Location</SelectItem>
                <SelectItem value="zone">Zone/aisle sweep</SelectItem>
                <SelectItem value="sku">SKU</SelectItem>
                <SelectItem value="abc">ABC scheduled class</SelectItem>
              </SelectContent>
            </Select>
            <Popover>
              <PopoverTrigger asChild>
                <Button type="button" variant="outline" role="combobox" aria-label="Choose zones" className="w-full justify-between font-normal">
                  <span>{zoneSelectionLabel}</span>
                  <ChevronDown className="h-4 w-4 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-3" align="start">
                <div className="mb-2 flex items-center justify-between gap-2 border-b pb-2">
                  <span className="text-sm font-medium">Zones</span>
                  <div className="flex gap-2">
                    <Button type="button" variant="ghost" size="sm" className="h-7 px-2" onClick={() => setSelectedZones([])}>Any zone</Button>
                    <Button type="button" variant="ghost" size="sm" className="h-7 px-2" onClick={() => setSelectedZones(availableZones.map((zone: any) => zone.id))}>Select all</Button>
                  </div>
                </div>
                <div role="group" aria-label="Zone selection" className="grid max-h-64 gap-1 overflow-y-auto">
                  {availableZones.map((zone: any) => {
                    const checked = selectedZoneIds.includes(zone.id);
                    return (
                      <label key={zone.id} className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent">
                        <Checkbox checked={checked} onCheckedChange={() => setSelectedZones(checked ? selectedZoneIds.filter((id) => id !== zone.id) : [...selectedZoneIds, zone.id])} />
                        <span>{zone.name}</span>
                      </label>
                    );
                  })}
                  {availableZones.length === 0 && <p className="px-2 py-1 text-sm text-muted-foreground">No zones in the active warehouse.</p>}
                </div>
              </PopoverContent>
            </Popover>
            <SearchableChecklist
              label="Locations"
              anyLabel="Any location"
              items={availableLocations}
              selectedIds={selectedLocationIds}
              onChange={(locationIds) => {
                form.setValue("location_ids", locationIds, { shouldValidate: true });
                form.setValue("location_id", locationIds.length === 1 ? locationIds[0] : "");
              }}
              getLabel={(location: any) => location.code ?? "Unnamed location"}
              getSearchText={(location: any) => [location.code, location.bay, location.aisle, location.level, location.position].filter(Boolean).join(" ")}
              searchPlaceholder="Search bay or location code"
              emptyMessage="No locations match the selected zones."
            />
            <SearchableChecklist
              label="Products"
              anyLabel="Any product"
              items={availableProducts}
              selectedIds={selectedProductIds}
              onChange={(productIds) => {
                form.setValue("product_ids", productIds, { shouldValidate: true });
                form.setValue("product_id", productIds.length === 1 ? productIds[0] : "");
              }}
              getLabel={(product: any) => `${product.sku} · ${product.name}`}
              getSearchText={(product: any) => [product.name, product.description, product.sku, product.barcode].filter(Boolean).join(" ")}
              searchPlaceholder="Search name, description, SKU, or barcode"
              emptyMessage="No countable products match the current scope."
            />
            <SearchableChecklist
              label="Count team"
              anyLabel="Unassigned queue"
              items={availableAssignees}
              selectedIds={selectedAssigneeIds}
              onChange={(assigneeIds) => {
                form.setValue("assigned_user_ids", assigneeIds, { shouldValidate: true });
                form.setValue("assigned_user_id", assigneeIds.length === 1 ? assigneeIds[0] : "");
              }}
              getLabel={(profile: any) => profile.full_name ?? "Unnamed user"}
              getSearchText={(profile: any) => profile.full_name ?? ""}
              searchPlaceholder="Search counter name"
              emptyMessage="No approved, authorized counters are assigned to this warehouse."
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="variance_threshold_percent">Variance %</Label>
                <Input id="variance_threshold_percent" type="number" step="0.1" {...form.register("variance_threshold_percent")} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="freeze_hours">Freeze hours</Label>
                <Input id="freeze_hours" type="number" min={1} max={168} {...form.register("freeze_hours")} />
              </div>
            </div>
            <DialogFooter>
              <Button type="submit" disabled={!online || createMutation.isPending}>
                {createMutation.isPending ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : <ClipboardCheck className="mr-2 h-4 w-4" />}
                Freeze and create count
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(cancelTarget)}
        onOpenChange={(open) => {
          if (open || cancelMutation.isPending) return;
          setCancelTarget(null);
          setCancellationReason("");
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Cancel cycle count {cancelTarget?.count_number}</DialogTitle>
            <DialogDescription>
              This stops further counting and review, clears active line claims, and releases every active inventory freeze for this count.
              {cancelTarget?.status === "approved" && " Stock adjustments already posted during approval are permanent and will not be reversed."}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="cycle-count-cancellation-reason">Cancellation reason</Label>
            <Textarea
              id="cycle-count-cancellation-reason"
              value={cancellationReason}
              onChange={(event) => setCancellationReason(event.target.value)}
              maxLength={500}
              placeholder="Explain why this count is being stopped"
              disabled={cancelMutation.isPending}
            />
            <p className="text-xs text-muted-foreground">Required. This reason is saved with the count and audit event.</p>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setCancelTarget(null);
                setCancellationReason("");
              }}
              disabled={cancelMutation.isPending}
            >
              Keep count active
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => cancelTarget && cancelMutation.mutate({ countId: cancelTarget.id, reason: cancellationReason })}
              disabled={!online || cancelMutation.isPending || cancellationReason.trim().length < 4}
            >
              <XCircle className="mr-2 h-4 w-4" />
              {cancelMutation.isPending ? "Cancelling…" : "Cancel and release freezes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SearchableChecklist({
  label,
  anyLabel,
  items,
  selectedIds,
  onChange,
  getLabel,
  getSearchText,
  searchPlaceholder,
  emptyMessage,
}: {
  label: string;
  anyLabel: string;
  items: any[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  getLabel: (item: any) => string;
  getSearchText: (item: any) => string;
  searchPlaceholder: string;
  emptyMessage: string;
}) {
  const [search, setSearch] = useState("");
  const matchingItems = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    if (!query) return items;
    return items.filter((item) => getSearchText(item).toLocaleLowerCase().includes(query));
  }, [getSearchText, items, search]);
  const selectionLabel = selectedIds.length === 0
    ? anyLabel
    : selectedIds.length === items.length
      ? `All ${label.toLocaleLowerCase()}`
      : `${selectedIds.length} ${label.toLocaleLowerCase()} selected`;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" role="combobox" aria-label={`Choose ${label.toLocaleLowerCase()}`} className="w-full justify-between font-normal">
          <span className="truncate">{selectionLabel}</span>
          <ChevronDown className="h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-3" align="start">
        <div className="mb-2 flex items-center justify-between gap-2 border-b pb-2">
          <span className="text-sm font-medium">{label}</span>
          <div className="flex gap-2">
            <Button type="button" variant="ghost" size="sm" className="h-7 px-2" onClick={() => onChange([])}>{anyLabel}</Button>
            <Button type="button" variant="ghost" size="sm" className="h-7 px-2" onClick={() => onChange(items.map((item) => item.id))}>Select all</Button>
          </div>
        </div>
        <div className="relative mb-2">
          <Search className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input value={search} onChange={(event) => setSearch(event.target.value)} className="pl-8" placeholder={searchPlaceholder} />
        </div>
        <div role="group" aria-label={`${label} selection`} className="grid max-h-64 gap-1 overflow-y-auto">
          {matchingItems.map((item) => {
            const checked = selectedIds.includes(item.id);
            return (
              <label key={item.id} className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent">
                <Checkbox checked={checked} onCheckedChange={() => onChange(checked ? selectedIds.filter((id) => id !== item.id) : [...selectedIds, item.id])} />
                <span className="min-w-0 truncate">{getLabel(item)}</span>
              </label>
            );
          })}
          {matchingItems.length === 0 && <p className="px-2 py-1 text-sm text-muted-foreground">{emptyMessage}</p>}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-lg border border-dashed border-border p-8 text-center">
      <ClipboardCheck className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
      <p className="font-medium">{title}</p>
      <p className="mt-1 text-sm text-muted-foreground">{body}</p>
    </div>
  );
}
