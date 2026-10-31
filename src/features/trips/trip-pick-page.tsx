// Handset pick for one fulfillment on a trip (outbound picking design, slice
// E: N1, N2, D9, D10, F5). The lines come in walk order: pick sequence, then
// bin. The picker scans the bin, enters what they took in the line's unit,
// and confirms. A line can take more than one pick (two faces). "Short"
// closes the line with what was found and asks for an urgent pallet on the
// face. A line with no stock in WW shows why; Short with nothing closes it.
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CheckCircle2, Loader2 } from "lucide-react";
import { useTenantPath } from "@/hooks/use-tenant-path";
import { alertToast, playBarcodeBeep } from "@/lib/floor-feedback";
import { normalizeScannerText } from "@/lib/scan-input";
import { formatSupabaseError } from "@/features/shared/core-types";
import { AppShell } from "@/features/shared/app-shell";
import { REPLENISHMENT_QUERY_KEY } from "@/features/replenishment/replenishment-core";
import { BarcodeScanButton } from "@/components/barcode-scan-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  TRIPS_QUERY_KEY,
  confirmTripPick,
  fetchTripPick,
  isOpenTask,
  remainingQuantity,
  taskQuantityLabel,
  taskUnit,
  toBaseUnits,
  type TripPickTask,
} from "./trips-core";

const FLAG_CLASS = "px-1.5 py-0 text-[11px] font-medium";

function unitName(task: TripPickTask): string {
  const unit = taskUnit(task);
  return unit?.abbreviation || unit?.unit_name || "units";
}

/** What to pre-fill: the remaining quantity in the line unit when it is whole, else nothing. */
function suggestedEntry(task: TripPickTask): string {
  const rate = Number(taskUnit(task)?.conversion_rate) || 1;
  const units = remainingQuantity(task) / rate;
  return Number.isInteger(units) && units > 0 ? String(units) : "";
}

function LineRow({ task, active, onSelect }: { task: TripPickTask; active: boolean; onSelect: () => void }) {
  const open = isOpenTask(task);
  const short = !open && Number(task.confirmed_quantity) < Number(task.requested_quantity) && task.status === "completed";
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={!open}
      className={cn(
        "flex w-full items-center justify-between gap-3 rounded-md border px-3 py-2 text-left text-sm",
        active ? "border-primary bg-primary/5" : "border-border",
        !open && "opacity-70",
      )}
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-mono font-medium">{task.location?.code ?? "—"}</span>
          <span className="truncate font-mono">{task.fulfillment_line?.product?.sku ?? "Unmapped item"}</span>
        </div>
        <div className="truncate text-xs text-muted-foreground">{task.fulfillment_line?.product?.name ?? task.short_reason}</div>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <span className="tabular-nums">
          {taskQuantityLabel(task, Number(task.confirmed_quantity))} / {taskQuantityLabel(task, Number(task.requested_quantity))}
        </span>
        {task.status === "exception" ? (
          <Badge variant="outline" className={cn(FLAG_CLASS, "border-amber-500 text-amber-700 dark:text-amber-400")}>No stock</Badge>
        ) : task.status === "cancelled" ? (
          <Badge variant="outline" className={FLAG_CLASS}>Removed</Badge>
        ) : short ? (
          <Badge variant="outline" className={cn(FLAG_CLASS, "border-amber-500 text-amber-700 dark:text-amber-400")}>Short</Badge>
        ) : !open ? (
          <Badge variant="outline" className={cn(FLAG_CLASS, "border-emerald-500 text-emerald-700 dark:text-emerald-400")}>Picked</Badge>
        ) : null}
      </div>
    </button>
  );
}

export function TripPickPage() {
  const { pickListId = "" } = useParams();
  const navigate = useNavigate();
  const { toPath } = useTenantPath();
  const queryClient = useQueryClient();
  const queryKey = [...TRIPS_QUERY_KEY, "pick", pickListId];
  const { data, isLoading, error } = useQuery({ queryKey, queryFn: () => fetchTripPick(pickListId), enabled: Boolean(pickListId) });
  const tasks = useMemo(() => data?.tasks ?? [], [data]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [bin, setBin] = useState("");
  const [quantity, setQuantity] = useState("");

  const current = tasks.find((t) => t.id === selectedId && isOpenTask(t)) ?? tasks.find(isOpenTask) ?? null;

  useEffect(() => {
    setBin("");
    setQuantity(current ? suggestedEntry(current) : "");
    // A new line resets the form; a refetch of the same line keeps what the picker typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id]);

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: TRIPS_QUERY_KEY });
    await queryClient.invalidateQueries({ queryKey: REPLENISHMENT_QUERY_KEY });
  };

  const confirm = useMutation({
    mutationFn: ({ short }: { short: boolean }) => {
      if (!current) throw new Error("No line to pick.");
      // A no-stock line closes short with nothing picked.
      const entered = current.status === "exception" || quantity.trim() === "" ? 0 : Number(quantity);
      if (!Number.isFinite(entered) || entered < 0) throw new Error("Enter the quantity you picked.");
      const base = toBaseUnits(entered, taskUnit(current));
      if (base > 0 && !bin.trim()) throw new Error("Scan the bin you picked from.");
      return confirmTripPick(current.id, bin, base, short);
    },
    onSuccess: async (result, { short }) => {
      if (result.list_complete) alertToast.success("Order picked. Take it to staging.");
      else if (short) alertToast.attention(result.replenishment_task_id ? "Line closed short. An urgent pallet is on its way to the face." : "Line closed short.");
      else if (result.task_status === "completed") alertToast.success("Line picked");
      else alertToast.attention("Picked. Take the rest from another bin, or press Short.");
      setSelectedId(null);
      await refresh();
    },
    onError: (e) => alertToast.noGo(formatSupabaseError(e, "Pick failed") || "Pick failed"),
  });

  const list = data?.list;
  const done = tasks.length > 0 && !tasks.some(isOpenTask);
  const unit = current ? unitName(current) : "";
  const rate = current ? Number(taskUnit(current)?.conversion_rate) || 1 : 1;

  return (
    <AppShell>
      <div className="mx-auto flex w-full max-w-xl flex-col gap-4">
        <div className="flex items-center gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={() => navigate(toPath("/trips"))}>
            <ArrowLeft className="mr-1 h-4 w-4" /> Trips
          </Button>
        </div>

        {error ? (
          <p className="text-destructive">Could not load the pick: {error instanceof Error ? error.message : String(error)}</p>
        ) : isLoading || !list ? (
          <p className="text-muted-foreground">Loading…</p>
        ) : (
          <>
            <div>
              <h2 className="text-xl font-semibold">{list.order?.order_number ?? list.fulfillment?.document_number}</h2>
              <p className="text-sm text-muted-foreground">
                {[list.order?.customer_name, list.notes, list.fulfillment?.document_number].filter(Boolean).join(" · ")}
              </p>
            </div>

            {done ? (
              <Card>
                <CardContent className="flex items-center gap-3 p-4">
                  <CheckCircle2 className="h-6 w-6 text-emerald-600" />
                  <div>
                    <div className="font-medium">All lines are closed.</div>
                    <div className="text-sm text-muted-foreground">Take the order to staging for the trip.</div>
                  </div>
                </CardContent>
              </Card>
            ) : current ? (
              <Card>
                <CardContent className="grid gap-4 p-4">
                  <div>
                    <div className="text-xs uppercase text-muted-foreground">Go to</div>
                    <div className="font-mono text-3xl font-bold">{current.location?.code ?? "No bin"}</div>
                    {current.location?.status === "pick_face" && <Badge variant="outline" className={FLAG_CLASS}>Pick face</Badge>}
                  </div>
                  <div>
                    <div className="font-mono font-medium">{current.fulfillment_line?.product?.sku ?? "Unmapped item"}</div>
                    <div className="text-sm text-muted-foreground">{current.fulfillment_line?.product?.name}</div>
                    <div className="mt-1 text-lg font-semibold tabular-nums">
                      Pick {taskQuantityLabel(current, remainingQuantity(current))}
                      {Number(current.confirmed_quantity) > 0 && (
                        <span className="ml-2 text-sm font-normal text-muted-foreground">({taskQuantityLabel(current, Number(current.confirmed_quantity))} picked)</span>
                      )}
                    </div>
                  </div>

                  {current.status === "exception" ? (
                    <p className="text-sm text-amber-700 dark:text-amber-400">{current.short_reason}</p>
                  ) : (
                    <form
                      className="grid gap-3"
                      onSubmit={(e) => {
                        e.preventDefault();
                        confirm.mutate({ short: false });
                      }}
                    >
                      <div className="grid gap-1.5">
                        <Label htmlFor="trip-pick-bin">Bin</Label>
                        <div className="flex gap-2">
                          <Input
                            id="trip-pick-bin"
                            value={bin}
                            onChange={(e) => setBin(e.target.value)}
                            className="h-11 font-mono uppercase"
                            autoComplete="off"
                            autoFocus
                          />
                          <BarcodeScanButton
                            className="h-11 w-20"
                            title="Scan the bay label"
                            onScan={(v) => {
                              playBarcodeBeep();
                              setBin(normalizeScannerText(v));
                            }}
                          />
                        </div>
                      </div>
                      <div className="grid gap-1.5">
                        <Label htmlFor="trip-pick-qty">Quantity ({unit})</Label>
                        <Input
                          id="trip-pick-qty"
                          type="number"
                          inputMode="decimal"
                          min={0}
                          step="any"
                          value={quantity}
                          onChange={(e) => setQuantity(e.target.value)}
                          className="h-11 w-40 tabular-nums"
                        />
                        {rate !== 1 && quantity.trim() !== "" && Number.isFinite(Number(quantity)) && (
                          <span className="text-xs text-muted-foreground">= {toBaseUnits(Number(quantity), taskUnit(current))} base units</span>
                        )}
                      </div>
                      <div className="flex gap-2">
                        <Button type="submit" className="h-11 flex-1" disabled={confirm.isPending}>
                          {confirm.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                          Confirm pick
                        </Button>
                        <Button type="button" variant="outline" className="h-11" disabled={confirm.isPending} onClick={() => confirm.mutate({ short: true })}>
                          Short
                        </Button>
                      </div>
                    </form>
                  )}
                  {current.status === "exception" && (
                    <Button type="button" variant="outline" className="h-11" disabled={confirm.isPending} onClick={() => confirm.mutate({ short: true })}>
                      Close line short
                    </Button>
                  )}
                </CardContent>
              </Card>
            ) : null}

            <div className="grid gap-2">
              {tasks.map((task) => (
                <LineRow key={task.id} task={task} active={task.id === current?.id} onSelect={() => setSelectedId(task.id)} />
              ))}
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}
