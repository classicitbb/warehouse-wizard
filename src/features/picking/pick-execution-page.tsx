import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { AlertTriangle, ArrowLeft, CheckCircle2, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { OFFLINE_WORK_MESSAGE, assertOnline, useNetworkStatus } from "@/hooks/use-network-status";
import { useTenantPath } from "@/hooks/use-tenant-path";
import { isLikelyNetworkError } from "@/lib/offline-queue";
import { supabase } from "@/integrations/supabase/client";
import {
  buildBayOccupancyGrid,
  confirmPickTask,
  createPickShortfallTask,
  formatNumber,
  formatPickRackInstruction,
  getBayOccupancy,
  getPickExecution,
  normalizeRackLocationCode,
  PickQuantityAnomalyError,
  previewPickSourceOverride,
} from "@/lib/wms-core";
import { beginActiveWork } from "@/lib/active-work";
import {
  casesForQuantity,
  formatPackStandardLine,
  resolveDefaultProfileForProduct,
  summarizePackStandard,
} from "@/lib/pack-standard-payload";
import {
  clearPickTaskResumeSnapshot,
  loadPickTaskResumeSnapshot,
  savePickTaskResumeSnapshot,
} from "@/lib/floor-task-resume";
import { cn } from "@/lib/utils";
import { normalizePalletBarcode, palletBarcodeError } from "@/lib/code-input";
import { AppShell } from "@/features/shared/app-shell";
import { alertToast, flashInput, playBarcodeBeep } from "@/lib/floor-feedback";
import { isBaySelectorCode, normalizeScannerText } from "@/lib/scan-input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { BarcodeScanButton } from "@/components/barcode-scan-button";
import { HintButton } from "@/components/hint-button";

function describePickLocation(
  location:
    | {
        code?: string | null;
        aisle?: string | number | null;
        bay?: string | number | null;
        level?: string | number | null;
        position?: string | number | null;
      }
    | null
    | undefined,
) {
  const code = normalizeRackLocationCode(String(location?.code ?? ""));
  if (!code) {
    return {
      fullCode: "assigned location",
      goTo: "assigned location",
    };
  }

  return {
    fullCode: code,
    goTo: formatPickRackInstruction({ ...location, code }),
  };
}


type PickExecutionData = {
  pickTasks: any[];
};

const PICK_OPEN_STATUSES = new Set(["queued", "assigned", "in_progress"]);

export function PickExecutionPage() {
  const { pickListId = "" } = useParams();
  const navigate = useNavigate();
  const { toPath } = useTenantPath();
  const queryClient = useQueryClient();
  const { online } = useNetworkStatus();
  const { data } = useQuery<PickExecutionData>({
    queryKey: ["pick-execution", pickListId],
    queryFn: async () => (await getPickExecution(pickListId)) as unknown as PickExecutionData,
    enabled: Boolean(pickListId),
  });

  // While the operator is on a pick-execution screen, mark active work so
  // background refresh and SW reloads defer until they navigate away.
  useEffect(() => {
    if (!pickListId) return;
    const release = beginActiveWork();
    return () => release();
  }, [pickListId]);

  const tasks = data?.pickTasks ?? [];
  const expectedPickListCode = String((data as any)?.pickList?.pick_list_number ?? "");
  const taskLocationRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const [confirmErrorNonceByTask, setConfirmErrorNonceByTask] = useState<Record<string, number>>({});
  const [pickAnomalyByTask, setPickAnomalyByTask] = useState<
    Record<string, { availableQuantity: number; requestedQuantity: number } | undefined>
  >({});
  const [shortfallPrompt, setShortfallPrompt] = useState<{ taskId: string; quantity: number } | null>(null);

  const focusNextOpen = useCallback(
    (justConfirmedId: string) => {
      const list = tasks;
      const idx = list.findIndex((t) => t.id === justConfirmedId);
      const next = list.slice(idx + 1).find((t) => PICK_OPEN_STATUSES.has(t.status));
      if (!next) return;
      const el = taskLocationRefs.current[next.id];
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        setTimeout(() => el.focus(), 250);
      }
    },
    [tasks],
  );

  const mutation = useMutation({
    mutationFn: async ({
      taskId,
      locationCode,
      palletBarcode,
      quantity,
      override,
      confirmSourceOverride,
      allowSourceQuantityVariance,
      pickListCode,
    }: {
      taskId: string;
      locationCode: string;
      palletBarcode: string;
      quantity: number;
      override?: boolean;
      confirmSourceOverride?: boolean;
      allowSourceQuantityVariance?: boolean;
      pickListCode: string;
    }) => {
      assertOnline();
      try {
        return await confirmPickTask(
          taskId,
          pickListCode,
          palletBarcode,
          quantity,
          Boolean(override),
          Boolean(confirmSourceOverride),
          Boolean(allowSourceQuantityVariance),
        );
      } catch (err) {
        if (isLikelyNetworkError(err)) {
          throw new Error(OFFLINE_WORK_MESSAGE);
        }
        throw err;
      }
    },
    onSuccess: async (result: any, variables) => {
      setPickAnomalyByTask((current) => {
        if (!(variables.taskId in current)) return current;
        const next = { ...current };
        delete next[variables.taskId];
        return next;
      });
      alertToast.success(
        variables.confirmSourceOverride
          ? "Alternate source picked — task reassigned and movement recorded"
          : variables.override
            ? "Pick confirmed with override — anomaly logged for review"
            : "Pick task confirmed",
        {
          className: "task-success-toast-rim",
        },
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["pick-execution", pickListId] }),
        queryClient.invalidateQueries({ queryKey: ["pick-lists"] }),
        queryClient.invalidateQueries({ queryKey: ["inventory-search"] }),
        queryClient.invalidateQueries({ queryKey: ["product-qty-totals"] }),
        queryClient.invalidateQueries({ queryKey: ["pick-bay-occupancy"] }),
        queryClient.invalidateQueries({ queryKey: ["bay-occupancy"] }),
        queryClient.invalidateQueries({ queryKey: ["bin-occupancy"] }),
        queryClient.invalidateQueries({ queryKey: ["dashboard-metrics"] }),
      ]);
      const shortfall = Number(result?.shortfall ?? 0);
      if (shortfall > 0) {
        setShortfallPrompt({ taskId: variables.taskId, quantity: shortfall });
        return;
      }
      setTimeout(() => focusNextOpen(variables.taskId), 300);
    },
    onError: (error, variables) => {
      if (variables?.taskId) {
        setConfirmErrorNonceByTask((current) => ({
          ...current,
          [variables.taskId]: (current[variables.taskId] ?? 0) + 1,
        }));
      }
      if (error instanceof PickQuantityAnomalyError && variables?.taskId) {
        setPickAnomalyByTask((current) => ({
          ...current,
          [variables.taskId]: {
            availableQuantity: error.availableQuantity,
            requestedQuantity: error.requestedQuantity,
          },
        }));
        alertToast.attention(
          `Only ${error.availableQuantity} available on this pallet (requested ${error.requestedQuantity}). Confirm the pallet and override to complete the pick for ${error.availableQuantity}.`,
          { duration: 8000 },
        );
        return;
      }
      alertToast.noGo(error instanceof Error ? error.message : "Pick confirmation failed");
    },
  });

  const completeMutation = useMutation({
    mutationFn: async () => {
      const { data: openTasks, error: openError } = await supabase
        .from("pick_tasks")
        .select("id, status")
        .eq("pick_list_id", pickListId)
        .in("status", Array.from(PICK_OPEN_STATUSES) as ("queued" | "assigned" | "in_progress")[]);
      if (openError) throw openError;
      if ((openTasks ?? []).length > 0) {
        throw new Error("Confirm every pick task before closing the pick list.");
      }
      const { error } = await supabase.from("pick_lists").update({ status: "completed" }).eq("id", pickListId);
      if (error) throw error;
    },
    onSuccess: async () => {
      alertToast.success("Pick list complete — handed to dispatch");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["pick-execution", pickListId] }),
        queryClient.invalidateQueries({ queryKey: ["pick-lists"] }),
        queryClient.invalidateQueries({ queryKey: ["inventory-search"] }),
        queryClient.invalidateQueries({ queryKey: ["dashboard-metrics"] }),
      ]);
      navigate(toPath("/pick-lists"));
    },
    onError: (error) => alertToast.noGo(error instanceof Error ? error.message : "Could not mark complete"),
  });

  const shortfallMutation = useMutation({
    mutationFn: async ({ taskId, quantity }: { taskId: string; quantity: number }) =>
      createPickShortfallTask(taskId, quantity),
    onSuccess: async (result: any) => {
      setShortfallPrompt(null);
      if (result?.pallet_found) {
        alertToast.success(`Follow-up pick task ${result.task_number} created for the shortfall`);
      } else {
        alertToast.attention(
          `No available pallet found — ${result?.task_number ?? "the follow-up task"} was raised as an exception.`,
        );
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["pick-execution", pickListId] }),
        queryClient.invalidateQueries({ queryKey: ["pick-lists"] }),
      ]);
    },
    onError: (error) =>
      alertToast.noGo(error instanceof Error ? error.message : "Could not create the follow-up pick task"),
  });

  const allTasksClosed = tasks.length > 0 && tasks.every((t) => !PICK_OPEN_STATUSES.has(t.status));
  const listStatus = (data as any)?.pickList?.status ?? (tasks[0] as any)?.pick_lists?.status;
  const listAlreadyClosed = listStatus === "completed" || listStatus === "cancelled";
  return (
    <AppShell>
      <div className="flex flex-col gap-6">
        <Button variant="ghost" className="w-fit -ml-1 gap-1.5 text-muted-foreground" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-4 w-4" /> Back
        </Button>
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-2xl font-semibold">Pick Execution</h2>
            <HintButton label="Pick Execution hints">
              Open the assigned list, scan location and pallet, then confirm quantity.
            </HintButton>
          </div>
        </div>
        {!online ? (
          <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
            <p className="font-medium">This device is offline. Live pick confirmations are frozen.</p>
            <p className="mt-1 text-xs sm:text-sm">
              Your scan position stays on this device. Reconnect before you post the pick so the app can validate
              against live stock.
            </p>
          </div>
        ) : null}
        {tasks.map((task) => (
          <PickTaskCard
            key={task.id}
            task={task}
            onConfirm={(payload) => mutation.mutate(payload)}
            isPending={mutation.isPending && mutation.variables?.taskId === task.id}
            confirmErrorNonce={confirmErrorNonceByTask[task.id] ?? 0}
            anomaly={pickAnomalyByTask[task.id]}
            onClearAnomaly={() => {
              setPickAnomalyByTask((current) => {
                if (!(task.id in current)) return current;
                const next = { ...current };
                delete next[task.id];
                return next;
              });
            }}
            pickListCode={expectedPickListCode}
            registerLocationRef={(el) => {
              taskLocationRefs.current[task.id] = el;
            }}
          />
        ))}
        {tasks.length > 0 && (
          <Card>
            <CardContent className="flex flex-col gap-3 pt-6">
              <Button
                className="w-full"
                size="lg"
                disabled={!allTasksClosed || listAlreadyClosed || completeMutation.isPending}
                onClick={() => completeMutation.mutate()}
              >
                {completeMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="h-4 w-4" />
                )}
                {listAlreadyClosed ? "Pick list closed" : "Mark pick list complete"}
              </Button>
              <p className="text-xs text-muted-foreground text-center">
                Marking complete means pallets have been delivered to the dispatch/staging area and are handed off to
                the ERP.
              </p>
            </CardContent>
          </Card>
        )}
      </div>
      <Dialog
        open={Boolean(shortfallPrompt)}
        onOpenChange={(open) => {
          if (!open) setShortfallPrompt(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Shortfall of {formatNumber(shortfallPrompt?.quantity ?? 0)}</DialogTitle>
            <DialogDescription>
              The pallet you picked was smaller than the requested quantity. Pick another pallet to make up the
              remaining {formatNumber(shortfallPrompt?.quantity ?? 0)}, or leave the line short as is.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="outline" disabled={shortfallMutation.isPending} onClick={() => setShortfallPrompt(null)}>
              Leave as is
            </Button>
            <Button
              disabled={shortfallMutation.isPending}
              onClick={() => shortfallPrompt && shortfallMutation.mutate(shortfallPrompt)}
            >
              {shortfallMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Pick another pallet
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}

function PickBayGrid({
  bayCode,
  assignedLocationCode,
  onSelectAssigned,
}: {
  bayCode: string;
  assignedLocationCode: string;
  onSelectAssigned: (locationCode: string) => void;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ["pick-bay-occupancy", bayCode],
    queryFn: () => getBayOccupancy(bayCode),
    enabled: bayCode.trim().length > 0,
    staleTime: 10_000,
  });
  const assigned = assignedLocationCode.trim().toUpperCase();

  if (isLoading && !data) {
    return (
      <div className="lg:col-span-4 rounded-md border border-border bg-secondary/20 px-3 py-2 text-xs text-muted-foreground">
        Loading bay locations…
      </div>
    );
  }

  if (!data || data.cells.length === 0) {
    return (
      <div className="lg:col-span-4 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
        No locations found for this bay barcode.
      </div>
    );
  }

  const hasAssignedLocation = data.cells.some(
    (cell: { locationCode: string }) => cell.locationCode.toUpperCase() === assigned,
  );

  return (
    <div className="lg:col-span-4 grid gap-2 rounded-md border border-border bg-secondary/20 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>
          Bay {data.aisle ?? "?"}-{data.bay ?? "?"}
        </span>
        <span>
          Pick from{" "}
          <span className="font-mono font-semibold text-foreground">{assignedLocationCode || "assigned location"}</span>
        </span>
      </div>
      <div className="grid gap-2">
        {buildBayOccupancyGrid(data.cells).map((row) => (
          <div
            key={`level-${row[0]?.level ?? "unknown"}`}
            className="grid gap-2"
            style={{ gridTemplateColumns: `repeat(${row.length}, minmax(0, 1fr))` }}
          >
            {row.map((slot) => {
              const cell = slot.cell;
              if (!cell) {
                return (
                  <div
                    key={`empty-${slot.level}-${slot.position}`}
                    aria-hidden="true"
                    className="min-h-16 rounded-md border border-dashed border-border/60 bg-background/40"
                  />
                );
              }

              const isAssigned = cell.locationCode.toUpperCase() === assigned;
              const canSelect = isAssigned && cell.status === "active";
              return (
                <button
                  key={cell.locationId}
                  type="button"
                  disabled={!canSelect}
                  onClick={() => onSelectAssigned(cell.locationCode)}
                  className={[
                    "min-h-16 rounded-md border px-2 py-2 text-left text-xs transition focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
                    isAssigned
                      ? "animate-pulse border-yellow-300 bg-yellow-100 text-yellow-950 ring-2 ring-yellow-300 dark:border-yellow-500 dark:bg-yellow-950/50 dark:text-yellow-50"
                      : "cursor-not-allowed border-muted bg-muted text-muted-foreground opacity-70",
                  ].join(" ")}
                >
                  <span className="block font-mono font-semibold">{cell.locationCode}</span>
                  <span className="mt-1 block">
                    {cell.occupiedPallets}/{cell.maxPallets} pallets
                  </span>
                  <span className="block">
                    {isAssigned ? "Pallet location" : cell.status !== "active" ? cell.status : "Other bin"}
                  </span>
                </button>
              );
            })}
          </div>
        ))}
      </div>
      {!hasAssignedLocation ? (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
          The assigned pallet location is not inside this scanned bay.
        </div>
      ) : null}
    </div>
  );
}

function PickTaskCard({
  task,
  onConfirm,
  isPending,
  confirmErrorNonce,
  anomaly,
  onClearAnomaly,
  registerLocationRef,
  pickListCode,
}: {
  task: any;
  onConfirm: (payload: {
    taskId: string;
    locationCode: string;
    palletBarcode: string;
    quantity: number;
    override?: boolean;
    confirmSourceOverride?: boolean;
    allowSourceQuantityVariance?: boolean;
    pickListCode: string;
  }) => void;
  isPending: boolean;
  confirmErrorNonce: number;
  anomaly?: { availableQuantity: number; requestedQuantity: number };
  onClearAnomaly?: () => void;
  registerLocationRef: (el: HTMLInputElement | null) => void;
  pickListCode: string;
}) {
  const form = useForm({
    defaultValues: {
      locationCode: "",
      palletBarcode: "",
      quantity: task.requested_quantity,
    },
  });
  const locationRef = useRef<HTMLInputElement | null>(null);
  const palletRef = useRef<HTMLInputElement | null>(null);
  const locationScanButtonRef = useRef<HTMLDivElement | null>(null);
  const confirmRef = useRef<HTMLButtonElement | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [confirmPrompt, setConfirmPrompt] = useState(false);
  const [bayScan, setBayScan] = useState("");
  const [alternateMode, setAlternateMode] = useState(false);
  const [alternatePalletBarcode, setAlternatePalletBarcode] = useState("");
  const [alternatePreview, setAlternatePreview] = useState<Awaited<
    ReturnType<typeof previewPickSourceOverride>
  > | null>(null);
  const [alternateArmed, setAlternateArmed] = useState(false);
  const pallet = task.pallets as any;
  const product = pallet?.products as any;
  const location = task.locations ?? task.pick_balance?.locations ?? null;
  const locationCode = normalizeRackLocationCode(location?.code ?? "");
  const locationDescriptor = describePickLocation(location);
  const palletBarcode = pallet?.pallet_barcode ?? "";
  const palletQuantity =
    task.pick_balance?.available_quantity ?? pallet?.available_quantity ?? pallet?.quantity ?? task.requested_quantity;
  const wholePalletQuantity = Number(palletQuantity ?? task.requested_quantity ?? 0);
  const isOpen = PICK_OPEN_STATUSES.has(task.status);
  const scannedLocation = String(form.watch("locationCode") ?? "").trim();
  const scannedPallet = String(form.watch("palletBarcode") ?? "").trim();
  const scannedPalletError = palletBarcodeError(scannedPallet);
  const alternatePalletError = palletBarcodeError(alternatePalletBarcode);
  const readyToConfirm = Boolean(scannedLocation && scannedPallet && !scannedPalletError);
  const sourceOverrideScanned =
    readyToConfirm &&
    (normalizeRackLocationCode(scannedLocation) !== locationCode ||
      scannedPallet.toUpperCase() !== String(palletBarcode).toUpperCase());
  const lockForConfirm = confirmPrompt && readyToConfirm;
  const pickListId = String(task.pick_list_id ?? "");

  useEffect(() => {
    if (!isOpen) {
      clearPickTaskResumeSnapshot(task.id, pickListId);
      return;
    }
    const snapshot = loadPickTaskResumeSnapshot(task.id, pickListId);
    if (!snapshot) return;
    form.reset({
      locationCode: snapshot.locationCode ?? "",
      palletBarcode: snapshot.palletBarcode ?? "",
      quantity: task.requested_quantity,
    });
    setBayScan(snapshot.bayScan ?? "");
    setConfirmPrompt(Boolean(snapshot.confirmPrompt && snapshot.locationCode && snapshot.palletBarcode));
  }, [form, isOpen, pickListId, task.id, task.requested_quantity]);

  useEffect(() => {
    if (confirmErrorNonce > 0) setConfirmPrompt(false);
  }, [confirmErrorNonce]);

  useEffect(() => {
    if (!isOpen) {
      clearPickTaskResumeSnapshot(task.id, pickListId);
      return;
    }
    savePickTaskResumeSnapshot({
      taskId: task.id,
      pickListId,
      locationCode: scannedLocation,
      palletBarcode: scannedPallet,
      bayScan,
      confirmPrompt,
      updatedAt: Date.now(),
    });
  }, [bayScan, confirmPrompt, isOpen, pickListId, scannedLocation, scannedPallet, task.id]);

  if (!isOpen) {
    const tone =
      task.status === "completed"
        ? "border-l-4 border-l-green-500 bg-muted/40"
        : task.status === "exception"
          ? "border-l-4 border-l-amber-500 bg-muted/40"
          : "border-l-4 border-l-muted-foreground/40 bg-muted/30";
    return (
      <Card className={tone}>
        <CardHeader>
          <CardTitle className="flex items-center justify-between gap-4">
            <span className="min-w-0 break-all">{task.task_number}</span>
            <Badge variant={task.status === "completed" ? "default" : "secondary"}>{task.status}</Badge>
          </CardTitle>
          <CardDescription>
            {product?.sku ? `${product.sku} · ` : ""}
            {product?.name ?? "Product"} · {locationCode || "—"} · pallet {palletBarcode || "—"}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2 text-sm sm:grid-cols-3">
          <div>
            <span className="text-muted-foreground">Requested:</span> {formatNumber(task.requested_quantity)}
          </div>
          <div>
            <span className="text-muted-foreground">Confirmed:</span> {formatNumber(task.confirmed_quantity ?? 0)}
          </div>
          {task.short_reason ? (
            <div className="text-amber-600 sm:col-span-1">
              <span className="text-muted-foreground">Short:</span> {task.short_reason}
            </div>
          ) : (
            <div />
          )}
        </CardContent>
      </Card>
    );
  }

  const packSummary = summarizePackStandard(
    resolveDefaultProfileForProduct(product?.product_packaging_profiles, product?.id),
  );
  const packStandardValue = (() => {
    const line = formatPackStandardLine(packSummary);
    if (!line) return "";
    const cases = casesForQuantity(palletQuantity ?? task.requested_quantity, packSummary);
    if (cases === null) return line;
    const exact = Number.isInteger(cases);
    const shown = exact ? cases : `≈${Math.round(cases)}`;
    return `${line} · pick ${shown} ${cases === 1 ? "case" : "cases"}`;
  })();

  const instructionRows = [
    { label: "Go to:", value: locationDescriptor.goTo },
    { label: "Pallet:", value: palletBarcode || "assigned pallet" },
    { label: "Product:", value: `${product?.sku ? `${product.sku} · ` : ""}${product?.name ?? "assigned product"}` },
    { label: "Pallet qty:", value: formatNumber(Number(palletQuantity ?? 0)) },
    ...(packStandardValue ? [{ label: "Pack standard:", value: packStandardValue }] : []),
  ];

  const handleSubmit = form.handleSubmit((values) => {
    if (!readyToConfirm) {
      alertToast.noGo("Scan the bay/location and pallet before confirming.");
      return;
    }
    if (sourceOverrideScanned) {
      alertToast.attention(
        "This pallet or location differs from the task. Use Pick a different pallet to verify and override it.",
      );
      return;
    }
    onConfirm({
      taskId: task.id,
      locationCode: values.locationCode,
      palletBarcode: values.palletBarcode,
      quantity: wholePalletQuantity,
      pickListCode,
    });
    if (cardRef.current) {
      flashInput(cardRef.current, "green");
    }
  });

  function applyLocationScan(value: string) {
    const scanned = normalizeScannerText(value);
    if (!scanned) return;
    onClearAnomaly?.();
    if (isBaySelectorCode(scanned)) {
      setBayScan(scanned);
      form.setValue("locationCode", "");
      setConfirmPrompt(false);
      playBarcodeBeep();
      flashInput(locationScanButtonRef.current, "yellow");
      flashInput(locationRef.current, "yellow");
      return;
    }
    setBayScan("");
    form.setValue("locationCode", scanned);
    setConfirmPrompt(false);
    playBarcodeBeep();
    flashInput(locationRef.current, "blue");
    setTimeout(() => {
      flashInput(palletRef.current, "orange");
      palletRef.current?.focus();
    }, 50);
  }

  function previewAlternate(value: string) {
    const scanned = normalizePalletBarcode(value);
    if (!scanned) return;
    setAlternatePalletBarcode(scanned);
    setAlternatePreview(null);
    setAlternateArmed(false);
    const prefixError = palletBarcodeError(scanned);
    if (prefixError) {
      alertToast.noGo(prefixError);
      return;
    }

    void previewPickSourceOverride(task.id, pickListCode, scanned)
      .then((preview) => {
        if (!preview.source_override) {
          toast.info("This is the directed pallet. Scan it in the normal pick flow.");
          setAlternateMode(false);
          return;
        }
        setAlternatePreview(preview);
      })
      .catch((error) =>
        alertToast.noGo(error instanceof Error ? error.message : "Could not verify the alternate pallet."),
      );
  }

  return (
    <div ref={cardRef} className="rounded-lg transition-shadow duration-300">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between gap-4">
            <span className="min-w-0 break-all">{task.task_number}</span>
            <Badge>{task.status}</Badge>
          </CardTitle>
          <CardDescription>Requested quantity: {formatNumber(task.requested_quantity)}</CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form className="grid gap-4 lg:grid-cols-4" onSubmit={handleSubmit}>
              <div
                className="lg:col-span-4 grid gap-1.5 rounded-md border border-border bg-muted/50 px-3 py-2 font-mono text-sm"
                aria-label="Pick task instructions"
              >
                {instructionRows.map((row) => (
                  <div key={row.label} className="grid gap-1 sm:grid-cols-[7rem_minmax(0,1fr)]">
                    <span className="font-semibold text-muted-foreground">{row.label}</span>
                    <span className="min-w-0 break-words text-foreground">{row.value}</span>
                  </div>
                ))}
              </div>
              <FormField
                control={form.control}
                name="locationCode"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Bay/Location Code</FormLabel>
                    <FormControl>
                      <div className="flex gap-2">
                        <Input
                          {...field}
                          ref={(el) => {
                            field.ref(el);
                            locationRef.current = el;
                            registerLocationRef(el);
                          }}
                          className="min-h-10 min-w-0 flex-1 transition-shadow duration-300"
                          disabled={lockForConfirm}
                          placeholder="Scan location barcode"
                          onChange={(event) => {
                            const value = normalizeScannerText(event.target.value.replace(/[\r\n]/g, ""));
                            if (/^BAY:[^:]+:[^:]+:[^:]+:[^:]+$/i.test(value.trim())) {
                              applyLocationScan(value);
                              return;
                            }
                            if (!value.toUpperCase().startsWith("BAY:")) setBayScan("");
                            field.onChange(value);
                          }}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              event.preventDefault();
                              applyLocationScan(event.currentTarget.value);
                            }
                          }}
                        />
                        <div ref={locationScanButtonRef} className="rounded-md transition-shadow duration-300">
                          <BarcodeScanButton
                            title="Scan Bay/Location Code"
                            onScan={applyLocationScan}
                            disabled={lockForConfirm}
                            className="w-20"
                          />
                        </div>
                      </div>
                    </FormControl>
                  </FormItem>
                )}
              />
              {bayScan ? (
                <PickBayGrid
                  bayCode={bayScan}
                  assignedLocationCode={locationCode}
                  onSelectAssigned={(selectedLocation) => {
                    setBayScan("");
                    form.setValue("locationCode", selectedLocation);
                    setConfirmPrompt(false);
                    playBarcodeBeep();
                    flashInput(locationRef.current, "yellow");
                    setTimeout(() => {
                      flashInput(palletRef.current, "orange");
                      palletRef.current?.focus();
                    }, 50);
                  }}
                />
              ) : null}
              <FormField
                control={form.control}
                name="palletBarcode"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Pallet barcode</FormLabel>
                    <FormControl>
                      <div className="flex gap-2">
                        <Input
                          {...field}
                          ref={(el) => {
                            field.ref(el);
                            palletRef.current = el;
                          }}
                          className="min-h-10 min-w-0 flex-1 transition-shadow duration-300"
                          disabled={lockForConfirm}
                          placeholder="Scan pallet barcode (PLT-…)"
                          onChange={(event) => {
                            onClearAnomaly?.();
                            field.onChange(normalizePalletBarcode(event.target.value));
                          }}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              event.preventDefault();
                              playBarcodeBeep();
                              flashInput(palletRef.current, "blue");
                              setConfirmPrompt(true);
                              setTimeout(() => {
                                flashInput(confirmRef.current, "yellow");
                                confirmRef.current?.focus();
                              }, 50);
                            }
                          }}
                        />
                        <BarcodeScanButton
                          title="Scan pallet barcode"
                          onScan={(value) => {
                            form.setValue("palletBarcode", normalizePalletBarcode(value));
                            playBarcodeBeep();
                            flashInput(palletRef.current, "blue");
                            setConfirmPrompt(true);
                            setTimeout(() => {
                              flashInput(confirmRef.current, "yellow");
                              confirmRef.current?.focus();
                            }, 50);
                          }}
                          disabled={lockForConfirm}
                          className="w-20"
                        />
                      </div>
                    </FormControl>
                    {scannedPalletError ? <p className="text-xs text-destructive">{scannedPalletError}</p> : null}
                  </FormItem>
                )}
              />

              <div className="lg:col-span-2 grid gap-1 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">
                <span className="text-xs font-medium text-muted-foreground">Full pallet qty</span>
                <span className="font-mono text-base font-semibold">{formatNumber(wholePalletQuantity)}</span>
              </div>
              <div className="lg:col-span-4 rounded-md border border-dashed border-amber-400 bg-amber-50/60 p-3 dark:border-amber-600 dark:bg-amber-950/20">
                {!alternateMode ? (
                  <Button type="button" variant="outline" disabled={isPending} onClick={() => setAlternateMode(true)}>
                    Pick a different matching pallet
                  </Button>
                ) : (
                  <div className="grid gap-3">
                    <div>
                      <p className="font-medium text-amber-900 dark:text-amber-200">Verify an alternate pallet</p>
                      <p className="text-xs text-amber-800 dark:text-amber-300">
                        Scan the pallet. Its live location, SKU, quantity, assignment, and freeze status are checked
                        before an override can be armed.
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <Input
                        value={alternatePalletBarcode}
                        disabled={isPending}
                        placeholder="Scan alternate pallet barcode (PLT-…)"
                        onChange={(event) => setAlternatePalletBarcode(normalizePalletBarcode(event.target.value))}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            previewAlternate(event.currentTarget.value);
                          }
                        }}
                      />
                      <BarcodeScanButton
                        title="Scan alternate pallet barcode"
                        disabled={isPending}
                        onScan={previewAlternate}
                      />
                    </div>
                    {alternatePalletError ? <p className="text-xs text-destructive">{alternatePalletError}</p> : null}
                    {alternatePreview
                      ? (() => {
                          const scannedQty = Number(
                            alternatePreview.scanned_available_quantity ?? alternatePreview.requested_quantity,
                          );
                          const variance = Boolean(alternatePreview.quantity_variance);
                          const delta = scannedQty - Number(alternatePreview.requested_quantity ?? 0);
                          return (
                            <div className="grid gap-2 rounded-md border border-amber-400 bg-amber-100/70 p-3 text-sm text-amber-950 dark:border-amber-600 dark:bg-amber-950/50 dark:text-amber-100">
                              {variance ? (
                                <p>
                                  <AlertTriangle className="mr-1 inline h-4 w-4" />
                                  SKU <span className="font-mono font-semibold">{alternatePreview.sku}</span> matches,
                                  but this pallet holds{" "}
                                  <span className="font-mono font-semibold">{formatNumber(scannedQty)}</span> versus the
                                  requested{" "}
                                  <span className="font-mono font-semibold">
                                    {formatNumber(alternatePreview.requested_quantity)}
                                  </span>{" "}
                                  (
                                  {delta > 0 ? `${formatNumber(delta)} over` : `${formatNumber(Math.abs(delta))} short`}
                                  ). The whole pallet will be picked and the variance recorded on the task.
                                </p>
                              ) : (
                                <p>
                                  <CheckCircle2 className="mr-1 inline h-4 w-4" />
                                  SKU <span className="font-mono font-semibold">{alternatePreview.sku}</span> and
                                  full-pallet quantity{" "}
                                  <span className="font-mono font-semibold">{formatNumber(scannedQty)}</span> match this
                                  pick task.
                                </p>
                              )}
                              <p>
                                Directed: <span className="font-mono">{palletBarcode}</span> at{" "}
                                <span className="font-mono">{locationCode}</span>
                              </p>
                              <p>
                                Found: <span className="font-mono">{alternatePreview.scanned_pallet_barcode}</span> at{" "}
                                <span className="font-mono">{alternatePreview.scanned_location_code}</span>
                              </p>
                              {!alternateArmed ? (
                                <Button
                                  type="button"
                                  variant="outline"
                                  className="w-fit border-amber-500"
                                  onClick={() => setAlternateArmed(true)}
                                >
                                  {variance
                                    ? `Override & pick ${formatNumber(scannedQty)} (requested ${formatNumber(alternatePreview.requested_quantity)})`
                                    : "Override source"}
                                </Button>
                              ) : (
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="font-medium">
                                    The directed pallet will be released from this task. Its inventory stays available.
                                  </span>
                                  <Button
                                    type="button"
                                    disabled={isPending}
                                    onClick={() =>
                                      onConfirm({
                                        taskId: task.id,
                                        locationCode: alternatePreview.scanned_location_code,
                                        palletBarcode: alternatePreview.scanned_pallet_barcode,
                                        quantity: scannedQty,
                                        pickListCode,
                                        confirmSourceOverride: true,
                                        allowSourceQuantityVariance: variance,
                                      })
                                    }
                                  >
                                    {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                                    Confirm pick
                                  </Button>
                                </div>
                              )}
                            </div>
                          );
                        })()
                      : null}
                    <Button
                      type="button"
                      variant="ghost"
                      className="w-fit"
                      onClick={() => {
                        setAlternateMode(false);
                        setAlternatePreview(null);
                        setAlternateArmed(false);
                      }}
                    >
                      Cancel alternate pallet
                    </Button>
                  </div>
                )}
              </div>
              {anomaly ? (
                <div className="lg:col-span-4 flex flex-col gap-2 rounded-md border border-amber-400 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-600 dark:bg-amber-950/40 dark:text-amber-200">
                  <p>
                    <AlertTriangle className="mr-1 inline h-4 w-4" />
                    This pallet has already been debited — only{" "}
                    <span className="font-mono font-semibold">{formatNumber(anomaly.availableQuantity)}</span> is
                    available now (requested{" "}
                    <span className="font-mono font-semibold">{formatNumber(anomaly.requestedQuantity)}</span>).
                    Re-check the physical pallet, then override to complete the pick for the actual quantity. This will
                    log a record-count warning for admins and managers to review.
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    className="w-fit border-amber-500 text-amber-900 hover:bg-amber-100 dark:text-amber-200"
                    disabled={isPending || !readyToConfirm}
                    onClick={() =>
                      onConfirm({
                        taskId: task.id,
                        locationCode: scannedLocation,
                        palletBarcode: scannedPallet,
                        quantity: wholePalletQuantity,
                        override: true,
                        pickListCode,
                      })
                    }
                  >
                    {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    Override & confirm remaining {formatNumber(anomaly.availableQuantity)}
                  </Button>
                </div>
              ) : null}
              <Button
                ref={confirmRef}
                className={cn(
                  "w-full lg:col-span-4",
                  confirmPrompt &&
                    readyToConfirm &&
                    "animate-pulse border border-yellow-300 bg-yellow-300 text-yellow-950 hover:bg-yellow-300",
                )}
                type="submit"
                disabled={isPending || !readyToConfirm}
              >
                {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Confirm pick
              </Button>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
