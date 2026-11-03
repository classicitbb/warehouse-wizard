// Replenishment (outbound picking design, slice D): the queue of pallet moves
// from bulk into the pick faces, and the pick faces with what is in them. A
// pick face is a bin with status "pick_face"; its SKU comes with the pallet.
// The engine runs each 5 minutes; "Check now" runs it at once. A task starts
// as a WW move (D4) and closes when the move is scanned complete here or on
// Location Moves.
//
// Layout follows Inventory Search: fixed page height, a compact header, and a
// table card whose header stays put while only the rows scroll.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus, RefreshCw } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { invalidateAfterPalletMove } from "@/lib/query-invalidation";
import { alertToast } from "@/lib/floor-feedback";
import { normalizeScannerText } from "@/lib/scan-input";
import { formatDateTime, formatNumber, formatSupabaseError } from "@/features/shared/core-types";
import { completeMoveTask } from "@/features/moves/moves-core";
import { TableFrame } from "@/features/shared/resource-forms";
import { BarcodeScanButton } from "@/components/barcode-scan-button";
import { HintButton } from "@/components/hint-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import {
  MAX_PALLETS_PER_FACE,
  REPLENISHMENT_QUERY_KEY,
  cancelReplenishment,
  evaluateReplenishment,
  faceState,
  fetchOpenTasks,
  fetchPickFaces,
  fetchWarehouses,
  fillPercent,
  makePickFace,
  policyBasisLabel,
  projectedQuantity,
  reasonLabel,
  releasePickFace,
  startReplenishment,
  type FaceState,
  type ReplenishmentTask,
} from "./replenishment-core";

const SUPERVISOR_ROLES = ["admin", "developer", "warehouse_manager", "warehouse_supervisor"];
const MANAGER_ROLES = ["admin", "developer", "warehouse_manager"];
const FLAG_CLASS = "px-1.5 py-0 text-[11px] font-medium";
const QUEUE_COLUMNS = 9;
const FACE_COLUMNS = 9;

type Tab = "queue" | "faces";
type ActiveMove = { moveTaskId: string; moveTaskNumber: string; task: ReplenishmentTask };

function EmptyRow({ colSpan, children, tone }: { colSpan: number; children: React.ReactNode; tone?: "error" }) {
  return (
    <TableRow>
      <TableCell className={cn("h-24 text-center", tone === "error" ? "text-destructive" : "text-muted-foreground")} colSpan={colSpan}>
        {children}
      </TableCell>
    </TableRow>
  );
}

// ── Queue ────────────────────────────────────────────────────────────────────

function TaskRow({ task, canCancel, busy, onStart, onCancel }: {
  task: ReplenishmentTask;
  canCancel: boolean;
  busy: boolean;
  onStart: () => void;
  onCancel: () => void;
}) {
  const started = task.status === "in_progress" || task.status === "assigned";
  return (
    <TableRow className="even:bg-muted/30">
      <TableCell className="font-mono font-medium">{task.task_number}</TableCell>
      <TableCell>
        <div className="flex items-center gap-1">
          {task.priority === "urgent" && <Badge variant="destructive" className={FLAG_CLASS}>Urgent</Badge>}
          <Badge variant="outline" className={FLAG_CLASS}>{reasonLabel(task.reason)}</Badge>
        </div>
      </TableCell>
      <TableCell className="max-w-[16rem] truncate" title={task.product?.name}>
        <span className="font-mono">{task.product?.sku ?? "—"}</span>
        <span className="ml-2 text-muted-foreground">{task.product?.name}</span>
      </TableCell>
      <TableCell className="font-mono">{task.to_location?.code ?? "—"}</TableCell>
      <TableCell className="font-mono">
        {task.from_location?.code ?? "—"}
        {task.suggested_pallet && <span className="ml-2 text-muted-foreground">{task.suggested_pallet.pallet_barcode}</span>}
      </TableCell>
      <TableCell className="text-right tabular-nums">{formatNumber(task.target_quantity)}</TableCell>
      <TableCell className="text-right tabular-nums text-muted-foreground">
        {formatNumber(task.on_hand_quantity)} / {formatNumber(task.demand_quantity)}
      </TableCell>
      <TableCell>
        {task.status === "exception" ? (
          <span className="text-destructive" title={task.notes ?? undefined}>{task.notes ?? "Exception"}</span>
        ) : started ? (
          <span>Moving {task.move_task?.task_number ?? ""}</span>
        ) : (
          <span className="text-muted-foreground">Queued {formatDateTime(task.created_at)}</span>
        )}
      </TableCell>
      <TableCell>
        <div className="flex justify-end gap-1">
          <Button type="button" size="sm" className="h-7 px-2 text-xs" onClick={onStart} disabled={busy}>
            {started ? "Continue" : task.status === "exception" ? "Retry" : "Start"}
          </Button>
          {canCancel && (
            <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={onCancel} disabled={busy}>
              Cancel
            </Button>
          )}
        </div>
      </TableCell>
    </TableRow>
  );
}

function CompleteMoveDialog({ move, onClose, onDone }: { move: ActiveMove | null; onClose: () => void; onDone: () => Promise<void> }) {
  const [pallet, setPallet] = useState("");
  const [location, setLocation] = useState("");
  const complete = useMutation({
    mutationFn: () => completeMoveTask(move!.moveTaskId, pallet.trim(), location.trim().toUpperCase()),
    onSuccess: async () => {
      alertToast.success(`Replenished ${move?.task.to_location?.code ?? "the pick face"}`);
      setPallet("");
      setLocation("");
      await onDone();
      onClose();
    },
    onError: (e) => alertToast.noGo(formatSupabaseError(e, "Move failed") || "Move failed"),
  });
  const task = move?.task;
  return (
    <Dialog open={move !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{task?.task_number} · {move?.moveTaskNumber}</DialogTitle>
          <DialogDescription>
            Take a pallet of {task?.product?.sku} from {task?.from_location?.code ?? "bulk"}
            {task?.suggested_pallet ? ` (pallet ${task.suggested_pallet.pallet_barcode})` : ""} to the pick face{" "}
            {task?.to_location?.code}. Stack a low remainder on top of the new pallet. Scan the pallet, then the pick-face bin.
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (pallet.trim() && location.trim() && !complete.isPending) complete.mutate();
          }}
        >
          <div className="grid gap-1.5">
            <Label htmlFor="replen-pallet">Pallet</Label>
            <div className="flex gap-2">
              <Input id="replen-pallet" value={pallet} onChange={(e) => setPallet(e.target.value)} autoFocus className="h-11 font-mono" />
              <BarcodeScanButton className="h-11 w-20" title="Scan the pallet" onScan={(v) => setPallet(normalizeScannerText(v))} />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="replen-location">Pick-face bin</Label>
            <div className="flex gap-2">
              <Input id="replen-location" value={location} onChange={(e) => setLocation(e.target.value)} className="h-11 font-mono uppercase" />
              <BarcodeScanButton className="h-11 w-20" title="Scan the pick-face bin" onScan={(v) => setLocation(normalizeScannerText(v))} />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Later</Button>
            <Button type="submit" disabled={!pallet.trim() || !location.trim() || complete.isPending}>
              {complete.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Confirm move
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function QueueTable({ canCancel }: { canCancel: boolean }) {
  const queryClient = useQueryClient();
  const [activeMove, setActiveMove] = useState<ActiveMove | null>(null);
  const { data: tasks = [], isLoading, error } = useQuery({
    queryKey: [...REPLENISHMENT_QUERY_KEY, "tasks"],
    queryFn: fetchOpenTasks,
    refetchInterval: 60_000,
  });
  const refresh = () => invalidateAfterPalletMove(queryClient, [REPLENISHMENT_QUERY_KEY, ["move-tasks"]]);

  const start = useMutation({
    mutationFn: (task: ReplenishmentTask) => startReplenishment(task.id).then((move) => ({ move, task })),
    onSuccess: async ({ move, task }) => {
      setActiveMove({ moveTaskId: move.move_task_id, moveTaskNumber: move.move_task_number, task });
      await refresh();
    },
    onError: async (e) => {
      alertToast.noGo(formatSupabaseError(e, "Could not start the task") || "Could not start the task");
      await refresh();
    },
  });
  const cancel = useMutation({
    mutationFn: (taskId: string) => cancelReplenishment(taskId),
    onSuccess: async () => {
      alertToast.attention("Replenishment cancelled");
      await refresh();
    },
    onError: (e) => alertToast.noGo(formatSupabaseError(e, "Cancel failed") || "Cancel failed"),
  });
  const busy = start.isPending || cancel.isPending;

  return (
    <>
      <Table className="[&_td]:whitespace-nowrap [&_th]:whitespace-nowrap">
        <TableHeader className="sticky top-0 z-20 bg-card shadow-sm">
          <TableRow>
            <TableHead>Task</TableHead>
            <TableHead>Why</TableHead>
            <TableHead>Product</TableHead>
            <TableHead>To face</TableHead>
            <TableHead>From bulk</TableHead>
            <TableHead className="text-right" title="Quantity on the bulk pallet">Pallet qty</TableHead>
            <TableHead className="text-right" title="Face stock of the SKU / open demand">On hand / demand</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {error ? (
            <EmptyRow colSpan={QUEUE_COLUMNS} tone="error">Could not load tasks: {error instanceof Error ? error.message : String(error)}</EmptyRow>
          ) : isLoading ? (
            <EmptyRow colSpan={QUEUE_COLUMNS}>Loading…</EmptyRow>
          ) : tasks.length === 0 ? (
            <EmptyRow colSpan={QUEUE_COLUMNS}>No replenishment needed. Every pick face is above its trigger level.</EmptyRow>
          ) : (
            tasks.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                canCancel={canCancel}
                busy={busy}
                onStart={() => start.mutate(task)}
                onCancel={() => cancel.mutate(task.id)}
              />
            ))
          )}
        </TableBody>
      </Table>
      <CompleteMoveDialog move={activeMove} onClose={() => setActiveMove(null)} onDone={refresh} />
    </>
  );
}

// ── Pick faces ───────────────────────────────────────────────────────────────

function MakePickFaceDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [warehouseId, setWarehouseId] = useState("");
  const [bin, setBin] = useState("");
  const [maxPallets, setMaxPallets] = useState(2);
  const { data: warehouses = [] } = useQuery({ queryKey: [...REPLENISHMENT_QUERY_KEY, "warehouses"], queryFn: fetchWarehouses, enabled: open });
  const make = useMutation({
    mutationFn: () => makePickFace(warehouseId, bin, maxPallets),
    onSuccess: async () => {
      alertToast.success(`${bin.trim().toUpperCase()} is now a pick face`);
      setBin("");
      await queryClient.invalidateQueries({ queryKey: REPLENISHMENT_QUERY_KEY });
      onClose();
    },
    onError: (e) => alertToast.noGo(formatSupabaseError(e, "Could not make the pick face") || "Could not make the pick face"),
  });

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Make pick face</DialogTitle>
          <DialogDescription>
            The bin keeps its code and barcode. Put-away stops using it, and only replenishment fills it. The SKU comes with
            the first pallet moved in.
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (warehouseId && bin.trim() && !make.isPending) make.mutate();
          }}
        >
          <div className="grid gap-1.5">
            <Label>Warehouse</Label>
            <Select value={warehouseId} onValueChange={setWarehouseId}>
              <SelectTrigger><SelectValue placeholder="Choose a warehouse" /></SelectTrigger>
              <SelectContent>
                {warehouses.map((w) => <SelectItem key={w.id} value={w.id}>{w.code} · {w.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="face-bin">Bin</Label>
            <div className="flex gap-2">
              <Input id="face-bin" value={bin} onChange={(e) => setBin(e.target.value)} className="h-11 font-mono uppercase" />
              <BarcodeScanButton className="h-11 w-20" title="Scan the bay label" onScan={(v) => setBin(normalizeScannerText(v))} />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="face-pallets">Pallets per face</Label>
            <Input
              id="face-pallets"
              type="number"
              min={1}
              max={MAX_PALLETS_PER_FACE}
              value={maxPallets}
              onChange={(e) => setMaxPallets(Number(e.target.value))}
              className="w-24"
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={!warehouseId || !bin.trim() || make.isPending}>
              {make.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Make pick face
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const FACE_STATE_BADGE: Record<FaceState, { label: string; className: string }> = {
  short: { label: "Short", className: "border-destructive text-destructive" },
  refill: { label: "Refill", className: "border-amber-500 text-amber-700 dark:text-amber-400" },
  ok: { label: "OK", className: "text-muted-foreground" },
  empty: { label: "Free", className: "text-muted-foreground" },
};

function PickFacesTable({ canManage }: { canManage: boolean }) {
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const { data: faces = [], isLoading, error } = useQuery({ queryKey: [...REPLENISHMENT_QUERY_KEY, "faces"], queryFn: fetchPickFaces });
  const release = useMutation({
    mutationFn: (locationId: string) => releasePickFace(locationId, "active"),
    onSuccess: async () => {
      alertToast.attention("Pick face released. The bin is a normal bin again.");
      await queryClient.invalidateQueries({ queryKey: REPLENISHMENT_QUERY_KEY });
    },
    onError: (e) => alertToast.noGo(formatSupabaseError(e, "Could not release the pick face") || "Could not release the pick face"),
  });

  return (
    <>
      <Table className="[&_td]:whitespace-nowrap [&_th]:whitespace-nowrap">
        <TableHeader className="sticky top-0 z-20 bg-card shadow-sm">
          <TableRow>
            <TableHead>Bin</TableHead>
            <TableHead className="text-right" title="Pallets in the face / pallets per face">Pallets</TableHead>
            <TableHead>Product</TableHead>
            <TableHead className="text-right" title="Stock now / stock after the last fill">On hand / fill</TableHead>
            <TableHead className="text-right" title="Trigger % of the fill, and full pallets per trigger (learned from 30 days of use)">Trigger</TableHead>
            <TableHead className="text-right" title="Open fulfillments (not aged), less what WW picked">Demand</TableHead>
            <TableHead className="text-right" title="Pallets on their way">Coming</TableHead>
            <TableHead>State</TableHead>
            <TableHead className="text-right">
              {canManage && (
                <Button type="button" size="sm" className="h-7 px-2 text-xs" onClick={() => setDialogOpen(true)}>
                  <Plus className="mr-1 h-3.5 w-3.5" /> Make pick face
                </Button>
              )}
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {error ? (
            <EmptyRow colSpan={FACE_COLUMNS} tone="error">Could not load pick faces: {error instanceof Error ? error.message : String(error)}</EmptyRow>
          ) : isLoading ? (
            <EmptyRow colSpan={FACE_COLUMNS}>Loading…</EmptyRow>
          ) : faces.length === 0 ? (
            <EmptyRow colSpan={FACE_COLUMNS}>No pick faces yet. Use "Make pick face" on a bay that the floor picks from.</EmptyRow>
          ) : (
            faces.map((face, index) => {
              const state = FACE_STATE_BADGE[faceState(face)];
              const fill = fillPercent(face);
              const firstOfBin = index === 0 || faces[index - 1].location_id !== face.location_id;
              return (
                <TableRow key={`${face.location_id}-${face.product_id ?? "free"}`} className="even:bg-muted/30">
                  <TableCell className="font-mono font-medium">{firstOfBin ? `${face.warehouse_code} · ${face.location_code}` : ""}</TableCell>
                  <TableCell className="text-right tabular-nums">{firstOfBin ? `${face.pallets_in_face} / ${face.max_pallets ?? 1}` : ""}</TableCell>
                  <TableCell className="max-w-[16rem] truncate" title={face.product_name ?? undefined}>
                    {face.sku ? (
                      <>
                        <span className="font-mono">{face.sku}</span>
                        <span className="ml-2 text-muted-foreground">{face.product_name}</span>
                      </>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {face.sku ? (
                      <>
                        {formatNumber(face.on_hand_quantity)} / {formatNumber(Math.max(Number(face.full_quantity ?? 0), Number(face.on_hand_quantity)))}
                        {fill !== null && <span className="ml-1 text-muted-foreground">({fill}%)</span>}
                      </>
                    ) : "—"}
                  </TableCell>
                  <TableCell
                    className="text-right tabular-nums text-muted-foreground"
                    title={
                      face.sku
                        ? `${policyBasisLabel(face.policy_basis)}${face.daily_use != null ? ` · ${formatNumber(face.daily_use)} a day` : ""}`
                        : undefined
                    }
                  >
                    {face.sku ? (
                      <>
                        {formatNumber(face.trigger_pct)}% · {face.reorder_pallets} plt
                        {face.policy_basis === "learning" && <span className="ml-1 text-[11px]">(learning)</span>}
                      </>
                    ) : "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums" title={face.sku ? `Projected ${formatNumber(projectedQuantity(face))}` : undefined}>
                    {face.sku ? formatNumber(face.demand_quantity) : "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{face.pallets_coming > 0 ? face.pallets_coming : ""}</TableCell>
                  <TableCell><Badge variant="outline" className={cn(FLAG_CLASS, state.className)}>{state.label}</Badge></TableCell>
                  <TableCell>
                    {canManage && firstOfBin && (
                      <div className="flex justify-end">
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-xs"
                          disabled={release.isPending}
                          onClick={() => release.mutate(face.location_id)}
                        >
                          Release
                        </Button>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              );
            })
          )}
        </TableBody>
      </Table>
      <MakePickFaceDialog open={dialogOpen} onClose={() => setDialogOpen(false)} />
    </>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export function ReplenishmentPage() {
  const queryClient = useQueryClient();
  const { roles } = useAuth();
  const canSupervise = roles.some((role) => SUPERVISOR_ROLES.includes(role));
  const canManage = roles.some((role) => MANAGER_ROLES.includes(role));
  const [tab, setTab] = useState<Tab>("queue");
  const evaluate = useMutation({
    mutationFn: () => evaluateReplenishment(null),
    onSuccess: async (result) => {
      alertToast.success(
        `Checked pick faces: ${result.created} new, ${result.updated} updated, ${result.cancelled} no longer needed, ${result.released} faces freed`,
      );
      await queryClient.invalidateQueries({ queryKey: REPLENISHMENT_QUERY_KEY });
    },
    onError: (e) => alertToast.noGo(formatSupabaseError(e, "Check failed") || "Check failed"),
  });

  return (
    <div className="flex h-full min-h-0 flex-col gap-6 overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex items-center gap-2">
          <h2 className="text-2xl font-semibold">Replenishment</h2>
          <HintButton label="Replenishment hints">
            Full pallets from bulk into the pick faces. Every 5 minutes WW takes the stock in each face, less the open demand
            (the office's open fulfillments that are not aged, less what is picked). When that goes down to the trigger level, a
            task asks for full pallets. WW learns the level and the pallets from 30 days of use: a product that ships a pallet
            or more a day gets 75% and 2 or more pallets; others get 50% and 1 pallet, as does every product while WW learns. Urgent tasks
            come first: the face cannot cover the open orders, or a picker reported short. Start a task, then scan the pallet
            and the pick-face bin.
          </HintButton>
        </div>
        <div className="flex items-center gap-2">
          <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
            <TabsList className="h-8">
              <TabsTrigger value="queue" className="h-6 px-2 text-xs">Queue</TabsTrigger>
              <TabsTrigger value="faces" className="h-6 px-2 text-xs">Pick faces</TabsTrigger>
            </TabsList>
          </Tabs>
          {canSupervise && (
            <Button type="button" size="sm" variant="outline" className="h-8" onClick={() => evaluate.mutate()} disabled={evaluate.isPending}>
              {evaluate.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
              Check now
            </Button>
          )}
        </div>
      </div>

      <Card className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <CardContent className="flex min-h-0 min-w-0 flex-1 p-0">
          <TableFrame className="h-full min-w-0 flex-1">
            {tab === "queue" ? <QueueTable canCancel={canSupervise} /> : <PickFacesTable canManage={canManage} />}
          </TableFrame>
        </CardContent>
      </Card>
    </div>
  );
}
