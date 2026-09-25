// One SKU line in the Receiving shipment dialog: product, quantities, expiry,
// lot/batch/packaging and the leftover-quantity chooser.
import { type Dispatch, type KeyboardEvent, type KeyboardEventHandler, type MutableRefObject, type SetStateAction } from "react";
import { ArrowRight, CalendarDays, ChevronDown, Pencil, Plus, RotateCcw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { ProductSearch, type ProductOption, type ProductSearchHandle } from "@/components/product-search";
import { BarcodeScanButton } from "@/components/barcode-scan-button";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { formatPackCode, parsePackCode, resolveUnitsPerPallet } from "@/lib/measure";
import { type PalletQtyHint } from "@/lib/ai-assist";
import { normalizeScannerText } from "@/lib/scan-input";
import { reconcilePackToQuantity, shouldRedistributeOnTotal, type PerPalletSource, type ShipmentQuantityIssues } from "@/features/receiving/receiving-quantity-rules";
import { ShipmentFieldLabel, productRequiresExpiry, remainderForLine, type ReceivingShipmentLineState } from "@/features/receiving/receiving-form-state";

function parseShipmentDate(value: string) {
  if (!value) return undefined;
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return undefined;
  return new Date(year, month - 1, day);
}

function formatShipmentDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function ShipmentExpiryPicker({
  value,
  required,
  invalid,
  open,
  triggerRef,
  onKeyDown,
  onOpenChange,
  onChange,
}: {
  value: string;
  required: boolean;
  invalid: boolean;
  open: boolean;
  triggerRef: (node: HTMLButtonElement | null) => void;
  onKeyDown?: KeyboardEventHandler<HTMLButtonElement>;
  onOpenChange: (open: boolean) => void;
  onChange: (value: string) => void;
}) {
  const selected = parseShipmentDate(value);
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button
          ref={triggerRef}
          type="button"
          variant="outline"
          onKeyDown={onKeyDown}
          className={cn(
            "h-9 w-full justify-start px-3 text-left font-normal focus-visible:border-ring focus-visible:ring-0 focus-visible:shadow-[inset_0_0_0_1px_hsl(var(--ring)),inset_0_0_0_9999px_hsl(var(--ring)/0.04)] sm:h-10",
            !value && "text-muted-foreground",
            required && invalid && "border-amber-500 focus-visible:border-amber-500 focus-visible:shadow-[inset_0_0_0_1px_rgb(245_158_11),inset_0_0_0_9999px_rgb(245_158_11/0.08)]",
          )}
          aria-label="Expiry"
          aria-invalid={invalid}
        >
          <CalendarDays className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" />
          {value || "dd/mm/yyyy"}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(28rem,calc(100vw-2rem))] p-2 sm:w-auto sm:p-3">
        <Calendar
          mode="single"
          selected={selected}
          onSelect={(date) => {
            if (!date) return;
            onChange(formatShipmentDate(date));
            onOpenChange(false);
          }}
          initialFocus
          classNames={{
            caption_label: "text-base font-semibold sm:text-sm",
            head_cell: "w-11 rounded-md text-sm font-medium text-muted-foreground sm:w-9 sm:text-[0.8rem]",
            cell: "h-11 w-11 p-0 text-center text-base sm:h-9 sm:w-9 sm:text-sm",
            day: "inline-flex h-11 w-11 items-center justify-center rounded-md p-0 text-base font-medium hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-selected:opacity-100 sm:h-9 sm:w-9 sm:text-sm",
            day_selected: "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground focus:bg-primary focus:text-primary-foreground",
            day_today: "bg-accent text-accent-foreground ring-1 ring-primary/50",
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

export type ShipmentLineRefs = {
  productRefs: MutableRefObject<Record<string, ProductSearchHandle | null>>;
  productCommitRefs: MutableRefObject<Record<string, HTMLButtonElement | null>>;
  totalRefs: MutableRefObject<Record<string, HTMLInputElement | null>>;
  perPalletRefs: MutableRefObject<Record<string, HTMLInputElement | null>>;
  palletCountRefs: MutableRefObject<Record<string, HTMLInputElement | null>>;
  expiryRefs: MutableRefObject<Record<string, HTMLButtonElement | null>>;
  shipmentLineRefs: MutableRefObject<Record<string, HTMLDivElement | null>>;
  totalTypedRefs: MutableRefObject<Record<string, boolean>>;
};

type ShipmentField = "product" | "total" | "perPallet" | "count" | "expiry";

type ShipmentLineCardProps = {
  line: ReceivingShipmentLineState;
  index: number;
  /** Validated quantities for this line, from the page's per-render pass. */
  quantities: ShipmentQuantityIssues | undefined;
  perPalletSource: PerPalletSource;
  packStandard: any | null;
  palletQtyHint: PalletQtyHint | null | undefined;
  pendingCommit: boolean;
  collapsed: boolean;
  online: boolean;
  canEditPackaging: boolean;
  productOptions: Array<ProductOption & { expiry_tracked: boolean }>;
  packagingProfiles: any[];
  packCodeInputs: Record<string, string>;
  openExpiryLineId: string | null;
  openShipmentDetails: Record<string, boolean>;
  refs: ShipmentLineRefs;
  /** Absent when the line cannot be removed (the only line, or a draft edit). */
  onRemove?: () => void;
  updateLine: (id: string, patch: Partial<ReceivingShipmentLineState>, changed?: "total" | "perPallet" | "count") => void;
  resetShipmentLine: (lineId: string) => void;
  selectShipmentProduct: (line: ReceivingShipmentLineState, value: string) => Promise<void>;
  moveToNextShipmentField: (lineId: string, field: "product" | "total" | "perPallet" | "count") => void;
  handleShipmentFieldKeyDown: (lineId: string, field: ShipmentField, event: KeyboardEvent<HTMLElement>) => void;
  setActiveShipmentLineId: (lineId: string) => void;
  setPerPalletEntered: Dispatch<SetStateAction<Record<string, string>>>;
  setPackCodeInputs: Dispatch<SetStateAction<Record<string, string>>>;
  setOpenExpiryLineId: Dispatch<SetStateAction<string | null>>;
  setOpenShipmentDetails: Dispatch<SetStateAction<Record<string, boolean>>>;
  setCaptureLineId: (lineId: string) => void;
};

export function ShipmentLineCard({
  line,
  index,
  quantities,
  perPalletSource,
  packStandard,
  palletQtyHint,
  pendingCommit,
  collapsed,
  online,
  canEditPackaging,
  productOptions,
  packagingProfiles,
  packCodeInputs,
  openExpiryLineId,
  openShipmentDetails,
  refs,
  onRemove,
  updateLine,
  resetShipmentLine,
  selectShipmentProduct,
  moveToNextShipmentField,
  handleShipmentFieldKeyDown,
  setActiveShipmentLineId,
  setPerPalletEntered,
  setPackCodeInputs,
  setOpenExpiryLineId,
  setOpenShipmentDetails,
  setCaptureLineId,
}: ShipmentLineCardProps) {
  const { productRefs, productCommitRefs, totalRefs, perPalletRefs, palletCountRefs, expiryRefs, shipmentLineRefs, totalTypedRefs } = refs;
  const remainder = quantities?.facts.remainder ?? remainderForLine(line);
  const selectedProduct = productOptions.find((product) => product.id === line.product_id);
  const expiryRequired = productRequiresExpiry(selectedProduct);
  const allocatedQuantity = Math.max(0, Number(line.quantity_per_pallet || 0) * Number(line.pallet_count || 0));
  const productCommitPending = Boolean(pendingCommit && line.product_id);
                    // Only this SKU's profiles. The field used to list every
  // profile in the database whatever the line held.
  const lineProfiles = (packagingProfiles as any[]).filter(
    (profile) => Boolean(profile?.id) && profile.product_id === line.product_id,
  );
  const standardUnitsPerPallet = packStandard ? resolveUnitsPerPallet(packStandard) : null;
  const packCodeText = packStandard ? formatPackCode(packStandard) : "";
  const declaredPack = parsePackCode(packCodeInputs[line.id] ?? "");
  const packReconciliation = reconcilePackToQuantity({
    parsed: declaredPack,
    unitsPerPackage: packStandard?.units_per_package ?? null,
    quantityPerPallet: line.quantity_per_pallet,
  });
  const palletQtyHintApplied = Boolean(
    palletQtyHint
    && Number(line.total_quantity) > 0
    && Number(line.quantity_per_pallet) === palletQtyHint.suggestedQty,
  );
  return (
    <div ref={(node) => { shipmentLineRefs.current[line.id] = node; }} key={line.id} className="grid min-w-0 scroll-mt-3 gap-2 rounded-lg border border-border p-2 sm:gap-3 sm:p-3">
      {collapsed ? (
        <div className="grid min-w-0 gap-2 text-sm">
          <div className="flex min-w-0 items-start justify-between gap-3">
            <p className="flex min-w-0 items-center gap-2 font-medium text-foreground">
              <span className="shrink-0">SKU line {index + 1}</span>
              <span className="truncate">{selectedProduct?.name ?? selectedProduct?.sku ?? "Unknown product"}</span>
            </p>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-7 w-7 shrink-0"
              title={`Edit SKU line ${index + 1}`}
              aria-label={`Edit SKU line ${index + 1}`}
              onClick={() => setActiveShipmentLineId(line.id)}
            >
              <Pencil className="h-3.5 w-3.5" />
            </Button>
          </div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-foreground/75 sm:grid-cols-5 sm:gap-3">
              <span>SKU {selectedProduct?.sku ?? "—"}</span>
              <span>Total {line.total_quantity}</span>
              <span>Per pallet {line.quantity_per_pallet}</span>
              <span>Pallets {line.pallet_count}</span>
              <span>Exp. {line.expiry_date || "—"}</span>
            </div>
            {/* A collapsed line must not hide a split that does not add up. */}
            {quantities?.blocking ? (
              <p role="alert" className="text-xs font-medium text-amber-600 dark:text-amber-400">
                {quantities.blocking}
              </p>
            ) : null}
        </div>
      ) : (
        <>
      <div className="flex items-center justify-between gap-3">
        <p className="font-medium">SKU line {index + 1}</p>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            title="Reset SKU line"
            aria-label="Reset SKU line"
            onClick={() => resetShipmentLine(line.id)}
          >
            <RotateCcw className="h-4 w-4" />
          </Button>
          {onRemove && (
            <Button size="sm" variant="ghost" onClick={onRemove}>
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
      <div className="grid min-w-0 gap-2 lg:gap-3">
        <div className="grid min-w-0 gap-1.5">
          <ShipmentFieldLabel>Product</ShipmentFieldLabel>
          <div className="flex min-w-0 max-w-full flex-wrap gap-2 sm:flex-nowrap">
            <BarcodeScanButton
              className="h-9 shrink-0 self-start sm:h-10"
              title="Scan product"
              onScan={(value) => {
                const matched = productRefs.current[line.id]?.scanBarcode(value);
                if (!matched) toast.warning("No product matched that scan. Search results are open.");
              }}
            />
            <div className="order-3 min-w-0 max-w-full flex-1 basis-full sm:order-none sm:basis-0">
              <ProductSearch
                ref={(node) => { productRefs.current[line.id] = node; }}
                value={line.product_id}
                options={productOptions}
                placeholder="Select SKU"
                onSelectComplete={() => productCommitRefs.current[line.id]?.focus()}
                onChange={(value) => { void selectShipmentProduct(line, value); }}
              />
            </div>
            <Button
              ref={(node) => { productCommitRefs.current[line.id] = node; }}
              type="button"
              variant={productCommitPending ? "default" : "outline"}
              size="icon"
              className={cn(
                "h-9 w-9 shrink-0 sm:h-10 sm:w-10",
                productCommitPending && "ring-2 ring-primary ring-offset-2 ring-offset-background",
              )}
              title="Commit product and move to Total received"
              aria-label="Commit product and move to Total received"
              data-pending-commit={productCommitPending ? "true" : "false"}
              disabled={!line.product_id}
              onClick={() => moveToNextShipmentField(line.id, "product")}
            >
              <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <div className="grid min-w-0 gap-2 md:gap-3 sm:grid-cols-3">
          <div className="grid min-w-0 gap-1.5">
            <ShipmentFieldLabel>Total received</ShipmentFieldLabel>
            <Input
              ref={(node) => { totalRefs.current[line.id] = node; }}
              type="number"
              inputMode="numeric"
              pattern="[0-9]*"
              min={0}
              value={line.total_quantity}
              aria-label="Total received"
              onFocus={(e) => e.currentTarget.select()}
              onKeyDown={(e) => handleShipmentFieldKeyDown(line.id, "total", e)}
              aria-invalid={Boolean(quantities?.total)}
              className={cn(
                "h-9 sm:h-10",
                quantities?.total && "border-amber-500 focus-visible:border-amber-500",
              )}
              onChange={(e) => {
                const nextValue = e.currentTarget.value;
                totalTypedRefs.current[line.id] = nextValue.trim() !== "";
                // Every edit to the total redistributes the line, so the pallet
                // count follows the total as it is typed. It is held back only
                // while the qty per pallet is still an unconfirmed default —
                // there is nothing meaningful to divide by yet.
                updateLine(
                  line.id,
                  { total_quantity: nextValue },
                  shouldRedistributeOnTotal({ nextTotal: nextValue, perPalletSource }),
                );
              }}

            />
            {quantities?.total ? (
              <p role="alert" className="text-xs font-medium text-amber-600 dark:text-amber-400">
                {quantities.total}
              </p>
            ) : null}
          </div>
          <div className="grid min-w-0 gap-1.5">
            <div className="flex items-center justify-between gap-2">
              <ShipmentFieldLabel>Qty per pallet</ShipmentFieldLabel>
              {packCodeText && standardUnitsPerPallet ? (
                <span className="flex items-center gap-1.5">
                  <span className="rounded border border-primary/40 bg-primary/10 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-primary">
                    {packCodeText} · {standardUnitsPerPallet}
                  </span>
                  {Number(line.quantity_per_pallet) !== standardUnitsPerPallet ? (
                    <button
                      type="button"
                      tabIndex={-1}
                      className="text-[10px] font-medium text-primary underline-offset-2 hover:underline"
                      onClick={() => {
                        setPerPalletEntered((current) => ({ ...current, [line.id]: line.product_id }));
                        updateLine(line.id, { quantity_per_pallet: String(standardUnitsPerPallet) }, "perPallet");
                      }}
                    >
                      Use standard
                    </button>
                  ) : null}
                </span>
              ) : null}
            </div>
            <Input
              ref={(node) => { perPalletRefs.current[line.id] = node; }}
              type="number"
              inputMode="numeric"
              pattern="[0-9]*"
              min={1}
              value={line.quantity_per_pallet}
              aria-label="Qty per pallet"
              aria-invalid={Boolean(quantities?.perPallet)}
              className={cn(
                "h-9 sm:h-10",
                quantities?.perPallet && "border-amber-500 focus-visible:border-amber-500",
              )}
              onFocus={(e) => e.currentTarget.select()}
              onKeyDown={(e) => handleShipmentFieldKeyDown(line.id, "perPallet", e)}
              onChange={(e) => {
                // Typing here settles the qty per pallet for this SKU, so the
                // line stops asking for one and the total redistributes against it.
                if (line.product_id) {
                  setPerPalletEntered((current) => ({ ...current, [line.id]: line.product_id }));
                }
                const nextValue = e.currentTarget.value;
                updateLine(
                  line.id,
                  { quantity_per_pallet: nextValue },
                  nextValue === "" ? undefined : "perPallet",
                );
              }}
            />
            {quantities?.perPallet ? (
              <p role="alert" className="text-xs font-medium text-amber-600 dark:text-amber-400">
                {quantities.perPallet}
              </p>
            ) : palletQtyHintApplied ? (
              <p className="text-xs text-muted-foreground">
                Suggested from {palletQtyHint?.sampleCount} prior pallet{palletQtyHint?.sampleCount === 1 ? "" : "s"}.
              </p>
            ) : null}
          </div>
          <div className="grid min-w-0 gap-1.5">
            <ShipmentFieldLabel>Pallets</ShipmentFieldLabel>
            <Input
              ref={(node) => { palletCountRefs.current[line.id] = node; }}
              type="number"
              inputMode="numeric"
              pattern="[0-9]*"
              min={1}
              value={line.pallet_count}
              aria-label="Pallets"
              aria-invalid={Boolean(quantities?.palletCount)}
              className={cn(
                "h-9 sm:h-10",
                quantities?.palletCount && "border-amber-500 focus-visible:border-amber-500",
              )}
              onFocus={(e) => e.currentTarget.select()}
              onKeyDown={(e) => handleShipmentFieldKeyDown(line.id, "count", e)}
              onChange={(e) => updateLine(line.id, { pallet_count: e.currentTarget.value })}
            />
            {quantities?.palletCount ? (
              <p role="alert" className="text-xs font-medium text-amber-600 dark:text-amber-400">
                {quantities.palletCount}
              </p>
            ) : null}
          </div>
        </div>
      </div>
      <div className="grid gap-2">
        <div className="grid gap-1.5">
          <ShipmentFieldLabel>Expiry{expiryRequired ? " *" : ""}</ShipmentFieldLabel>
          <ShipmentExpiryPicker
            triggerRef={(node) => { expiryRefs.current[line.id] = node; }}
            required={expiryRequired}
            invalid={expiryRequired && !line.expiry_date}
            value={line.expiry_date}
            open={openExpiryLineId === line.id}
            onOpenChange={(open) => setOpenExpiryLineId(open ? line.id : null)}
            onKeyDown={(e) => handleShipmentFieldKeyDown(line.id, "expiry", e)}
            onChange={(value) => {
              updateLine(line.id, { expiry_date: value });
              setOpenExpiryLineId(null);
            }}
          />
        </div>
        <Collapsible open={Boolean(openShipmentDetails[line.id])} onOpenChange={(open) => setOpenShipmentDetails((current) => ({ ...current, [line.id]: open }))}>
          <CollapsibleTrigger asChild>
            <Button type="button" variant="ghost" tabIndex={-1} className="h-8 w-fit px-0 text-xs font-medium text-muted-foreground hover:bg-transparent hover:text-foreground">
              <ChevronDown className="mr-1 h-3.5 w-3.5" />
              Lot, batch, and packaging
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="grid gap-2 pt-1 md:grid-cols-3 md:gap-3">
            <div className="grid gap-1.5">
              <ShipmentFieldLabel>Lot</ShipmentFieldLabel>
              <Input
                tabIndex={-1}
                aria-label="Lot"
                className="h-9 sm:h-10"
                value={line.lot_number}
                onChange={(e) => updateLine(line.id, { lot_number: normalizeScannerText(e.target.value) })}
              />
            </div>
            <div className="grid gap-1.5">
              <ShipmentFieldLabel>Batch</ShipmentFieldLabel>
              <Input
                tabIndex={-1}
                aria-label="Batch"
                className="h-9 sm:h-10"
                value={line.batch_number}
                onChange={(e) => updateLine(line.id, { batch_number: normalizeScannerText(e.target.value) })}
              />
            </div>
            <div className="grid gap-1.5">
              <ShipmentFieldLabel>Packaging</ShipmentFieldLabel>
              <Select value={line.packaging_profile_id || undefined} onValueChange={(value) => updateLine(line.id, { packaging_profile_id: value })}>
                <SelectTrigger
                  tabIndex={-1}
                  aria-label="Packaging"
                  className="h-9 sm:h-10"
                >
                  <SelectValue placeholder="Optional" />
                </SelectTrigger>
                <SelectContent>
                  {/* Filtered to the line's SKU. Listing every profile in the
                      database for every SKU is what made this field noise. */}
                  {lineProfiles.length === 0 ? (
                    <SelectItem value="__no_packaging" disabled>
                      {line.product_id ? "No packaging profiles for this SKU" : "Select a SKU first"}
                    </SelectItem>
                  ) : null}
                  {lineProfiles.map((profile: any) => {
                    const code = formatPackCode(profile);
                    return (
                      <SelectItem key={profile.id} value={profile.id}>
                        {code ? `${profile.profile_name} · ${code}` : profile.profile_name}
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <ShipmentFieldLabel>Pack code</ShipmentFieldLabel>
              <Input
                tabIndex={-1}
                aria-label="Pack code"
                inputMode="text"
                placeholder="12 x 7"
                className="h-9 sm:h-10"
                value={packCodeInputs[line.id] ?? ""}
                onChange={(e) => setPackCodeInputs((current) => ({ ...current, [line.id]: e.target.value }))}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                tabIndex={-1}
                className="h-8 w-fit text-xs"
                // Master data created offline races duplicate
                // names in from several devices; the receipt
                // itself still queues safely.
                disabled={!line.product_id || !online || !canEditPackaging}
                title={
                  !line.product_id ? "Select a SKU first"
                    : !online ? "Pack standards are created online only"
                      : !canEditPackaging ? "Needs the packaging permission"
                        : undefined
                }
                onClick={() => setCaptureLineId(line.id)}
              >
                <Plus className="mr-1 h-3.5 w-3.5" />
                Create Package Standard
              </Button>
            </div>
          </CollapsibleContent>
          {/* Conformance is recorded, never blocking: a short last
              pallet is normal, and a blocked receipt gets worked
              around invisibly where a variance is data. */}
          {packReconciliation ? (
            <p className={cn(
              "mt-2 text-xs font-medium",
              packReconciliation.conformance === "standard"
                ? "text-muted-foreground"
                : "text-amber-600 dark:text-amber-400",
            )}>
              {packReconciliation.message}
            </p>
          ) : (packCodeInputs[line.id] ?? "").trim() !== "" ? (
            <p className="mt-2 text-xs text-muted-foreground">
              Enter a pack code as cases per layer × layers, e.g. 12 x 7.
            </p>
          ) : null}
        </Collapsible>
      </div>
      {quantities?.showRemainder && (
        <div className="grid gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
          <p className="font-medium">{remainder} unit{remainder === 1 ? "" : "s"} will be left after creating {line.pallet_count} pallet{Number(line.pallet_count) === 1 ? "" : "s"} of {line.quantity_per_pallet}.</p>
          <p className="text-xs">Allocated in WMS: {allocatedQuantity}. Total received: {line.total_quantity}.</p>
          <div className="grid gap-2 sm:grid-cols-3">
            {[
              ["waive", "Waive remainder"],
              ["manual", "Manage outside WMS"],
              ["special", "Create special pallet"],
            ].map(([value, label]) => (
              <label key={value} className="flex items-center gap-2 rounded-md border border-red-600 bg-red-500 px-3 py-2 text-black shadow-sm">
                <input type="radio" name={`remainder-${line.id}`} checked={line.remainder_action === value} onChange={() => updateLine(line.id, { remainder_action: value as ReceivingShipmentLineState["remainder_action"] })} />
                {label}
              </label>
            ))}
          </div>
        </div>
      )}
        </>
      )}
    </div>
  );
}
