// Receiving's "Print Draft Labels" dialog: pick drafts (optionally by container),
// print their labels, then confirm the physical labels to send them to Put-Away.
import { useState, type Dispatch, type SetStateAction } from "react";
import { Printer } from "lucide-react";
import { toast } from "sonner";
import { type DraftReceipt } from "@/lib/wms-core";
import { cn } from "@/lib/utils";
import { normalizeContainerNumber, validateIso6346ContainerNumber } from "@/lib/container-number";
import { resolveContainerScanValue } from "@/lib/scan-input";
import { BarcodeScanButton } from "@/components/barcode-scan-button";
import { type ProductOption } from "@/components/product-search";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { parseDraftMeta } from "@/features/receiving/receiving-form-state";
import { ButtonProgress } from "@/features/receiving/button-progress";

type PrintDraftsDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  printContainer: string;
  setPrintContainer: (value: string) => void;
  /** Drafts matching the container filter. */
  printDrafts: DraftReceipt[];
  selectedDraftIds: Set<string>;
  setSelectedDraftIds: Dispatch<SetStateAction<Set<string>>>;
  productOptions: ProductOption[];
  online: boolean;
  /** True while the confirmed labels are being received. */
  sending: boolean;
  sendProgress: { completed: number; total: number };
  onPrintLabels: (drafts: DraftReceipt[]) => void;
  onConfirmPrinted: (drafts: DraftReceipt[]) => void;
};

export function PrintDraftsDialog({
  open,
  onOpenChange,
  printContainer,
  setPrintContainer,
  printDrafts,
  selectedDraftIds,
  setSelectedDraftIds,
  productOptions,
  online,
  sending,
  sendProgress,
  onPrintLabels,
  onConfirmPrinted,
}: PrintDraftsDialogProps) {
  const [printContainerWarning, setPrintContainerWarning] = useState<string | null>(null);
  const selectedPrintDrafts = printDrafts.filter((draft) => selectedDraftIds.has(draft.id));

  function applyPrintContainerScan(value: unknown) {
    const result = resolveContainerScanValue(value);
    setPrintContainer(result.value);
    setPrintContainerWarning(result.valid ? null : result.message);
    if (!result.valid) toast.warning(result.message);
  }

  return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[90vh] overflow-hidden sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Print Draft Labels</DialogTitle>
            <DialogDescription>Print the selected labels, then confirm the physical output before creating Awaiting Put-Away stock.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <div className="flex gap-2">
                <Input
                  value={printContainer}
                  onChange={(e) => {
                    const next = normalizeContainerNumber(e.target.value);
                    setPrintContainer(next);
                    if (next.length >= 11) {
                      const validation = validateIso6346ContainerNumber(next);
                      setPrintContainerWarning(validation.valid ? null : validation.message);
                    } else {
                      setPrintContainerWarning(null);
                    }
                  }}
                  className={cn(printContainerWarning && "border-destructive focus-visible:border-destructive focus-visible:shadow-[inset_0_0_0_1px_hsl(var(--destructive)),inset_0_0_0_9999px_hsl(var(--destructive)/0.08)]")}
                  placeholder="Filter by container number"
                  aria-invalid={Boolean(printContainerWarning)}
                />
                <BarcodeScanButton title="Scan container number" enableTextRecognition onScan={applyPrintContainerScan} />
              </div>
              <p className={cn("text-xs", printContainerWarning ? "text-destructive" : "text-muted-foreground")}>
                {printContainerWarning ?? "Enter or scan an ISO 6346 container number to narrow this label batch."}
              </p>
            </div>
            <div className="max-h-[50vh] overflow-y-auto pr-3">
              <div className="grid gap-2">
                {printDrafts.map((draft) => {
                  const meta = parseDraftMeta(draft.notes);
                  const product = productOptions.find((p) => p.id === (draft.product_id ?? meta.product_id));
                  const checked = selectedDraftIds.has(draft.id);
                  return (
                    <label key={draft.id} className="flex cursor-pointer items-center gap-3 rounded-md border border-border px-3 py-2">
                      <Checkbox checked={checked} onCheckedChange={(value) => {
                        setSelectedDraftIds((current) => {
                          const next = new Set(current);
                          if (value) next.add(draft.id); else next.delete(draft.id);
                          return next;
                        });
                      }} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{draft.draft_pallet_barcode ?? draft.receipt_number} · {product?.sku ?? "Unknown SKU"}</span>
                        <span className="block text-xs text-muted-foreground">Container {draft.container_number ?? "—"} · Qty {draft.quantity ?? "?"}</span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSelectedDraftIds(new Set(printDrafts.map((draft) => draft.id)))}>Select all shown</Button>
            <Button variant="outline" disabled={selectedDraftIds.size === 0} onClick={() => setSelectedDraftIds(new Set())}>Deselect all</Button>
            <Button variant="outline" disabled={!online || sending || selectedPrintDrafts.length === 0} onClick={() => onPrintLabels(selectedPrintDrafts)}>
              <Printer data-icon="inline-start" />
              Print selected labels
            </Button>
            <Button className="relative overflow-hidden" disabled={!online || sending || selectedPrintDrafts.length === 0} onClick={() => onConfirmPrinted(selectedPrintDrafts)}>
              {sending ? (
                <ButtonProgress
                  value={(sendProgress.completed / Math.max(sendProgress.total, 1)) * 100}
                  label={`Sending ${sendProgress.completed}/${Math.max(sendProgress.total, selectedPrintDrafts.length)}`}
                />
              ) : (
                <>
                  <Printer data-icon="inline-start" />
                  Labels printed — send to Put-Away
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
  );
}
