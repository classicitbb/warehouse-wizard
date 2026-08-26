// Editing a stored pallet, from Inventory.
//
// The rules this dialog exists to enforce:
//   * An edit may be blank. Opening a pallet, changing nothing and pressing
//     Save as draft is a valid outcome.
//   * Cancel puts the pallet back exactly as it was. Only an audit record of
//     the attempted edit survives.
//   * The pallet number never changes on the way in. It changes only when a
//     committed edit needs a new label, or when the pallet goes back to Drafts.
import { useCallback, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { CalendarDays, Loader2, X } from "lucide-react";
import { toast } from "sonner";

import { PalletLabelPage } from "@/components/pallet-label-page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useNetworkStatus } from "@/hooks/use-network-status";
import { useTenantPath } from "@/hooks/use-tenant-path";
import { cn } from "@/lib/utils";
import {
  beginInventoryPalletCorrection,
  cancelInventoryPalletCorrection,
  completeInventoryPalletCorrection,
  completeInventoryPalletCorrectionInPlace,
  saveInventoryPalletCorrectionAsDraft,
} from "@/lib/wms-core";

/** Everything the dialog shows or copies onto a replacement label. */
export type PalletEditTarget = {
  balanceId: string;
  palletBarcode: string;
  quantity: number;
  expiryDate: string | null;
  productSku?: string | null;
  productName?: string | null;
  lotNumber?: string | null;
  batchNumber?: string | null;
  clientName?: string | null;
  warehouseName?: string | null;
  locationCode?: string | null;
  containerNumber?: string | null;
  poNumber?: string | null;
  receiptReference?: string | null;
  packaging?: string | null;
  temperatureClass?: string;
};

function parseIsoDate(value: string) {
  if (!value) return undefined;
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return undefined;
  return new Date(year, month - 1, day);
}

function formatIsoDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function PalletEditDialog({
  open,
  onOpenChange,
  target,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: PalletEditTarget | null;
}) {
  const navigate = useNavigate();
  const { toPath } = useTenantPath();
  const queryClient = useQueryClient();
  const { online } = useNetworkStatus();

  const [draftId, setDraftId] = useState("");
  const [replacementBarcode, setReplacementBarcode] = useState("");
  const [quantity, setQuantity] = useState("");
  const [expiry, setExpiry] = useState("");
  const [expiryTouched, setExpiryTouched] = useState(false);
  const [expiryOpen, setExpiryOpen] = useState(false);
  const [locationPromptOpen, setLocationPromptOpen] = useState(false);
  const [stillAtLocation, setStillAtLocation] = useState<boolean | null>(null);
  const [preparingCommit, setPreparingCommit] = useState(false);

  const originalQuantity = Number(target?.quantity ?? 0);
  const originalExpiry = target?.expiryDate ?? "";
  const locationCode = target?.locationCode || "its former location";

  // A field left blank counts as "unchanged", never as zero or cleared, so a
  // blank edit stays blank all the way through to Save as draft.
  const quantityEntered = quantity.trim() !== "";
  const quantityChanged = quantityEntered && Number(quantity) !== originalQuantity;
  const expiryChanged = expiryTouched && expiry !== originalExpiry;
  const hasChange = quantityChanged || expiryChanged;
  const effectiveQuantity = quantityEntered ? Number(quantity) : originalQuantity;
  const effectiveExpiry = expiryTouched ? expiry : originalExpiry;
  const quantityInvalid = quantityEntered && !(Number(quantity) > 0);
  // Only a printed label mints a new number; quantity-only fixes stay in place.
  const needsNewLabel = expiryChanged || stillAtLocation === false;

  function resetSession() {
    setDraftId("");
    setReplacementBarcode("");
    setQuantity("");
    setExpiry("");
    setExpiryTouched(false);
    setExpiryOpen(false);
    setLocationPromptOpen(false);
    setStillAtLocation(null);
    setPreparingCommit(false);
  }

  async function refreshInventory() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["inventory-search"] }),
      queryClient.invalidateQueries({ queryKey: ["inventory-detail"] }),
      queryClient.invalidateQueries({ queryKey: ["draft-receipts"] }),
      queryClient.invalidateQueries({ queryKey: ["dashboard-metrics"] }),
    ]);
  }

  // The correction draft is created lazily — only when the operator commits to
  // an action (Save changes / Save as draft). Opening the dialog changes
  // nothing on the pallet: no RPC, no hold, no reserved pallet number.
  const ensureDraft = useCallback(async () => {
    if (draftId) return { draftId, replacementPalletBarcode: replacementBarcode };
    if (!target?.balanceId) throw new Error("No pallet selected.");
    const result = await beginInventoryPalletCorrection(target.balanceId);
    setDraftId(result.draftId);
    setReplacementBarcode(result.replacementPalletBarcode);
    void queryClient.invalidateQueries({ queryKey: ["inventory-detail"] });
    return result;
  }, [draftId, replacementBarcode, target?.balanceId, queryClient]);

  // Begin the correction as the operator commits to the save path — the
  // answer to this prompt decides which label flow comes next.
  async function answerLocationPrompt(stillThere: boolean) {
    setPreparingCommit(true);
    try {
      await ensureDraft();
      setStillAtLocation(stillThere);
      setLocationPromptOpen(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not open this pallet for editing.");
    } finally {
      setPreparingCommit(false);
    }
  }

  const cancelMutation = useMutation({
    mutationFn: () => cancelInventoryPalletCorrection(draftId, {
      quantity: quantityEntered ? Number(quantity) : null,
      expiryDate: expiryTouched ? expiry || null : null,
      changed: hasChange,
    }),
    onSuccess: async () => {
      toast.success(`Pallet ${target?.palletBarcode ?? ""} left unchanged.`.trim());
      onOpenChange(false);
      resetSession();
      await refreshInventory();
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Could not restore the pallet to Inventory."),
  });

  const saveDraftMutation = useMutation({
    mutationFn: async () => {
      const session = await ensureDraft();
      return saveInventoryPalletCorrectionAsDraft({
        draftId: session.draftId,
        quantity: quantityEntered ? Number(quantity) : null,
        expiryDate: expiryTouched ? expiry || null : null,
        expiryProvided: expiryTouched,
      });
    },
    onSuccess: async (result) => {
      onOpenChange(false);
      resetSession();
      await refreshInventory();
      toast.success(`Pallet returned to Drafts as ${result.draftPalletBarcode}. Print its label in Receiving to receive it.`);
      navigate(toPath("/receiving"));
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Could not return the pallet to Drafts."),
  });

  const updateInPlaceMutation = useMutation({
    mutationFn: async () => {
      const session = await ensureDraft();
      return completeInventoryPalletCorrectionInPlace({ draftId: session.draftId, quantity: effectiveQuantity });
    },
    onSuccess: async (result) => {
      onOpenChange(false);
      resetSession();
      await refreshInventory();
      toast.success(`Pallet ${result.palletBarcode} updated. Its number and label are unchanged.`);
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Could not update the pallet in place."),
  });

  const replaceMutation = useMutation({
    mutationFn: async () => {
      const session = await ensureDraft();
      return completeInventoryPalletCorrection({
        draftId: session.draftId,
        quantity: effectiveQuantity,
        expiryDate: effectiveExpiry || null,
        stillAtFormerLocation: stillAtLocation === true,
      });
    },
    onSuccess: async (result) => {
      onOpenChange(false);
      resetSession();
      await refreshInventory();
      await queryClient.invalidateQueries({ queryKey: ["putaway-tasks"] });
      if (result.putawayTaskId) {
        toast.success(`Replacement ${result.palletBarcode} is queued for Put-Away.`);
        navigate(`${toPath("/putaway-tasks")}?correctionTask=${encodeURIComponent(result.putawayTaskId)}`);
        return;
      }
      toast.success(`Replacement ${result.palletBarcode} remains at ${locationCode}.`);
      navigate(toPath(`/inventory/${result.inventoryBalanceId}`));
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Could not receive the replacement pallet."),
  });

  const busy = preparingCommit || cancelMutation.isPending || saveDraftMutation.isPending ||
    updateInPlaceMutation.isPending || replaceMutation.isPending;

  function handleCancel() {
    if (!draftId) {
      onOpenChange(false);
      resetSession();
      return;
    }
    cancelMutation.mutate();
  }

  return (
    <>
      <Dialog open={open} onOpenChange={(next) => { if (!next) handleCancel(); }}>
        <DialogContent
          className="max-h-[92vh] overflow-y-auto sm:max-w-lg"
          onOpenAutoFocus={(event) => event.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle>Edit pallet {target?.palletBarcode ?? ""}</DialogTitle>
            <DialogDescription>
              Change quantity or expiry, or leave everything as it is and send the pallet back to Drafts.
              Cancel leaves the pallet exactly where it is.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3 text-sm">
            <div className="grid gap-1 rounded-lg border border-border bg-secondary/10 p-3">
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">SKU</span>
                <span className="text-right">{target?.productSku || target?.productName || "—"}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">Location</span>
                <span className="font-mono text-right">{target?.locationCode || "—"}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">Pallet number</span>
                <Badge variant="secondary" className="font-mono">{target?.palletBarcode || "—"}</Badge>
              </div>
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="pallet-edit-quantity">Quantity</Label>
              <Input
                id="pallet-edit-quantity"
                inputMode="numeric"
                disabled={preparing}
                placeholder={String(originalQuantity)}
                value={quantity}
                onFocus={(event) => event.currentTarget.select()}
                onChange={(event) => setQuantity(event.currentTarget.value)}
                aria-invalid={quantityInvalid}
                className={cn(quantityInvalid && "border-amber-500")}
              />
              <p className="text-xs text-muted-foreground">Leave blank to keep {originalQuantity}.</p>
            </div>

            <div className="grid gap-1.5">
              <Label>Expiry</Label>
              <div className="flex gap-2">
                <Popover open={expiryOpen} onOpenChange={setExpiryOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={preparing}
                      className={cn("h-10 flex-1 justify-start px-3 text-left font-normal", !effectiveExpiry && "text-muted-foreground")}
                      aria-label="Expiry"
                    >
                      <CalendarDays className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" />
                      {effectiveExpiry || "No expiry"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent align="start" className="w-auto p-2">
                    <Calendar
                      mode="single"
                      selected={parseIsoDate(effectiveExpiry)}
                      onSelect={(date) => {
                        if (!date) return;
                        setExpiry(formatIsoDate(date));
                        setExpiryTouched(true);
                        setExpiryOpen(false);
                      }}
                      initialFocus
                    />
                  </PopoverContent>
                </Popover>
                {effectiveExpiry && (
                  <Button
                    type="button"
                    variant="outline"
                    className="h-10"
                    disabled={preparing}
                    title="Clear expiry"
                    onClick={() => { setExpiry(""); setExpiryTouched(true); }}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                {expiryChanged
                  ? `Changing expiry prints a new label, so the pallet takes a new number.`
                  : `Quantity-only fixes keep pallet number ${target?.palletBarcode ?? ""}.`}
              </p>
            </div>
          </div>

          <DialogFooter className="flex-row flex-wrap justify-end gap-2">
            {quantityInvalid && (
              <p className="mr-auto w-full text-xs font-medium text-amber-500 sm:w-auto sm:self-center">
                Quantity must be greater than zero.
              </p>
            )}
            <Button variant="outline" disabled={busy} onClick={handleCancel}>
              {cancelMutation.isPending ? "Cancelling…" : "Cancel"}
            </Button>
            <Button
              variant="outline"
              disabled={!online || preparing || busy || quantityInvalid}
              title="Retire this pallet and hold the edit in Receiving > Drafts under a new pallet number"
              onClick={() => saveDraftMutation.mutate()}
            >
              {saveDraftMutation.isPending ? "Saving…" : "Save as draft"}
            </Button>
            <Button
              disabled={!online || preparing || busy || quantityInvalid || !hasChange}
              title={hasChange ? "Commit this edit" : "Change quantity or expiry to save, or send the pallet back to Drafts"}
              onClick={() => setLocationPromptOpen(true)}
            >
              {preparing ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={locationPromptOpen} onOpenChange={setLocationPromptOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Confirm pallet location</DialogTitle>
            <DialogDescription>
              Is the pallet still in {locationCode}? Yes keeps it there. No queues it for Put-Away after the label prints.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-row flex-wrap justify-end gap-2">
            <Button variant="outline" onClick={() => setLocationPromptOpen(false)}>Back</Button>
            <Button variant="outline" onClick={() => { setStillAtLocation(false); setLocationPromptOpen(false); }}>
              No — send to Put-Away
            </Button>
            <Button onClick={() => { setStillAtLocation(true); setLocationPromptOpen(false); }}>
              Yes — keep at {locationCode}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Once the location is known, either update in place under the same
          number, or print the replacement label that earns a new one. */}
      <PalletCommitStep
        active={open && stillAtLocation !== null && !locationPromptOpen}
        needsNewLabel={needsNewLabel}
        busy={busy}
        online={online}
        target={target}
        quantity={effectiveQuantity}
        expiry={effectiveExpiry}
        replacementBarcode={replacementBarcode}
        onUpdateInPlace={() => updateInPlaceMutation.mutate()}
        onPrinted={async () => { await replaceMutation.mutateAsync(); }}
        onBack={() => setStillAtLocation(null)}
      />
    </>
  );
}

/** The confirm step: no label for an in-place fix, a printed label otherwise. */
function PalletCommitStep({
  active,
  needsNewLabel,
  busy,
  online,
  target,
  quantity,
  expiry,
  replacementBarcode,
  onUpdateInPlace,
  onPrinted,
  onBack,
}: {
  active: boolean;
  needsNewLabel: boolean;
  busy: boolean;
  online: boolean;
  target: PalletEditTarget | null;
  quantity: number;
  expiry: string;
  replacementBarcode: string;
  onUpdateInPlace: () => void;
  onPrinted: () => Promise<void>;
  onBack: () => void;
}) {
  if (!active) return null;
  return (
    <Dialog open onOpenChange={(next) => { if (!next) onBack(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{needsNewLabel ? "Print the replacement label" : "Confirm the update"}</DialogTitle>
          <DialogDescription>
            {needsNewLabel
              ? `This edit needs a new label, so the pallet becomes ${replacementBarcode}. The old number is kept in history.`
              : `Pallet ${target?.palletBarcode ?? ""} keeps its number and its label — only the quantity changes.`}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="flex-row flex-wrap justify-end gap-2">
          <Button variant="outline" disabled={busy} onClick={onBack}>Back</Button>
          {needsNewLabel ? (
            <PalletLabelPage
              barcode={replacementBarcode}
              quantity={quantity}
              productSku={target?.productSku ?? undefined}
              productName={target?.productName ?? undefined}
              lotNumber={target?.lotNumber}
              batchNumber={target?.batchNumber}
              expiryDate={expiry || null}
              containerNumber={target?.containerNumber}
              poNumber={target?.poNumber}
              clientName={target?.clientName}
              warehouseName={target?.warehouseName}
              locationCode={target?.locationCode}
              receiptReference={target?.receiptReference}
              packaging={target?.packaging}
              temperatureClass={target?.temperatureClass}
              trigger={<Button disabled={!online || busy}>Print & save</Button>}
              onPrinted={onPrinted}
            />
          ) : (
            <Button disabled={!online || busy} onClick={onUpdateInPlace}>
              {busy ? "Updating…" : "Update & close"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
