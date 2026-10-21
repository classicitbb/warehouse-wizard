import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatDate, formatDateTime, formatNumber } from "@/features/shared/core-types";
import { displayRackLocationCode } from "@/features/setup/setup-core";
import { inventoryPickLists, inventoryPickWork, type WholePallet } from "@/features/picking/inventory-pick-core";

function PalletEvidence({ title, rows }: { title: string; rows: WholePallet[] }) {
  return <div className="space-y-2">
    <h3 className="font-medium">{title}</h3>
    <ul className="space-y-2 text-sm">
      {rows.map((row) => <li key={row.pallet_id} className="rounded-md border p-2">
        <span className="font-medium">{row.pallet_code} · {row.sku}</span>
        <div>{displayRackLocationCode(row.location_code)} · {formatNumber(row.quantity)} units · 1 whole pallet</div>
        <div className="text-muted-foreground">{row.rotation_method.toUpperCase()} · Received {formatDateTime(row.received_at)} · Expiry {formatDate(row.expiry_date)}</div>
      </li>)}
    </ul>
  </div>;
}

export function InventoryPickDialog({ warehouseId, balanceIds, single, onClose, onAdded }: {
  warehouseId: string; balanceIds: string[]; single: boolean; onClose: () => void;
  onAdded: (lists: { id: string; pick_list_number: string }[]) => void;
}) {
  const [mode, setMode] = useState<"pallet" | "product" | null>(single ? null : "pallet");
  const [choice, setChoice] = useState<"selected" | "recommended" | null>(null);
  const [listId, setListId] = useState("new");
  const [orderNumber, setOrderNumber] = useState("");
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const request = { warehouseId, balanceIds, mode: mode ?? "pallet" as const };
  const preview = useQuery({
    queryKey: ["inventory-pick-preview", warehouseId, balanceIds, mode],
    queryFn: () => inventoryPickWork(request), enabled: mode !== null,
    staleTime: 0, gcTime: 0, retry: false, networkMode: "always",
    refetchOnWindowFocus: false, refetchOnReconnect: false,
  });
  const plan = preview.data;
  const ownerIds = new Set(plan?.selected.map((row) => row.client_id));
  const listOptions = useQuery({
    queryKey: ["inventory-pick-lists", warehouseId, plan?.selected[0]?.client_id],
    queryFn: () => inventoryPickLists(warehouseId, plan?.selected[0]?.client_id ?? null),
    enabled: Boolean(plan) && ownerIds.size === 1, retry: false,
  });
  const save = useMutation({
    networkMode: "always",
    mutationFn: async () => {
      if (!plan || !mode || needsRefresh) throw new Error("Refresh the preview before adding work.");
      return inventoryPickWork(request, { token: plan.token, choice: choice ?? "selected",
        listId: listId === "new" ? null : listId, orderNumber });
    },
    onSuccess: (result) => onAdded(result.lists ?? []),
    onError: () => setNeedsRefresh(true),
  });
  const warning = Boolean(plan?.warning && choice === null);
  const rows = choice === "recommended" ? plan?.recommended : plan?.selected;
  const error = preview.error ?? save.error;
  return <Dialog open onOpenChange={(open) => { if (!open && !save.isPending) onClose(); }}>
    <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl" onEscapeKeyDown={(event) => { if (save.isPending) event.preventDefault(); }} onPointerDownOutside={(event) => { if (save.isPending) event.preventDefault(); }}>
      <DialogHeader>
        <DialogTitle>{warning ? "Review stock rotation" : "Add to pick list"}</DialogTitle>
        <DialogDescription>Creates queued work. Physical picking still requires the existing scan and confirmation flow. Each selected pallet is one whole pallet.</DialogDescription>
      </DialogHeader>
      {mode === null ? <div className="space-y-3">
        <p className="text-sm">This pallet keeps the exact pallet. This product chooses exactly one eligible whole pallet using FIFO or FEFO, regardless of its quantity.</p>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setMode("pallet")}>This pallet</Button>
          <Button variant="outline" onClick={() => setMode("product")}>This product</Button>
        </div>
      </div> : preview.isFetching ? <p role="status">Checking eligible pallets…</p> : null}
      {error ? <p role="alert" className="text-sm text-destructive">{error.message}</p> : null}
      {plan && !preview.isFetching && !needsRefresh ? <>
        {warning ? <>
          <p className="text-sm">Selected pallets bypass earlier eligible stock. Review receipt and expiry evidence before choosing.</p>
          <PalletEvidence title="Chosen pallets" rows={plan.selected} />
          <PalletEvidence title="Recommended pallets" rows={plan.recommended} />
        </> : <>
          <PalletEvidence title="Pallets to add" rows={rows ?? []} />
          {ownerIds.size > 1 ? <p className="text-sm">A separate new pick list and order will be created for each owner.</p> : <div className="space-y-1">
            <label htmlFor="inventory-pick-list" className="text-sm font-medium">Pick list</label>
            <Select value={listId} onValueChange={setListId} disabled={save.isPending}>
              <SelectTrigger id="inventory-pick-list"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="new">Create new list</SelectItem>
                {(listOptions.data ?? []).map((list) => <SelectItem key={list.id} value={list.id}>{list.pick_list_number}</SelectItem>)}
              </SelectContent>
            </Select>
            {listOptions.error ? <p role="alert" className="text-sm text-destructive">Could not load existing lists. Retry the preview or create a new list.</p> : null}
          </div>}
          {listId === "new" ? <div className="space-y-1">
            <label htmlFor="inventory-pick-order" className="text-sm font-medium">Order number (required)</label>
            <Input id="inventory-pick-order" value={orderNumber} minLength={2} maxLength={120} required disabled={save.isPending} onChange={(event) => setOrderNumber(event.target.value)} />
            {ownerIds.size > 1 ? <p className="text-xs text-muted-foreground">Owner orders receive numbered suffixes.</p> : null}
          </div> : null}
        </>}
      </> : null}
      <DialogFooter className="gap-2">
        <Button variant="outline" disabled={save.isPending} onClick={onClose}>Cancel</Button>
        {warning && !needsRefresh ? <>
          <Button variant="outline" onClick={() => setChoice("selected")}>Keep selected pallets</Button>
          <Button onClick={() => setChoice("recommended")}>Use recommended pallets</Button>
        </> : null}
        {(preview.isError || needsRefresh) ? <Button onClick={() => {
          save.reset(); setNeedsRefresh(false); setChoice(null); setListId("new");
          void preview.refetch(); void listOptions.refetch();
        }} disabled={preview.isFetching}>Refresh preview</Button> : null}
        {plan && !warning && !needsRefresh ? <Button disabled={save.isPending || preview.isFetching || (listId === "new" && orderNumber.trim().length < 2)}
          onClick={() => save.mutate()}>{save.isPending ? "Adding…" : `Add ${rows?.length ?? 0} whole pallet${rows?.length === 1 ? "" : "s"}`}</Button> : null}
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
