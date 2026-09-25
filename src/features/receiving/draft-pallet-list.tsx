// Receiving's "Draft Pallets" list: each saved draft with its label, confirm,
// edit and cancel actions.
import { Pencil, Printer, Trash2 } from "lucide-react";
import { type DraftReceipt, formatDate } from "@/lib/wms-core";
import { PalletLabelPage } from "@/components/pallet-label-page";
import { HintButton } from "@/components/hint-button";
import { type ProductOption } from "@/components/product-search";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { parseDraftMeta } from "@/features/receiving/receiving-form-state";

type DraftPalletListProps = {
  drafts: DraftReceipt[];
  /** Drafts left after the search filter. */
  visibleDrafts: DraftReceipt[];
  draftSearch: string;
  productOptions: Array<ProductOption & { temperature_requirement?: string }>;
  clients: any[];
  warehouses: any[];
  packagingProfiles: any[];
  online: boolean;
  receivePending: boolean;
  deletePending: boolean;
  onReceive: (draft: DraftReceipt) => void;
  onEdit: (draft: DraftReceipt) => void;
  onDelete: (draftId: string) => void;
};

export function DraftPalletList({
  drafts,
  visibleDrafts,
  draftSearch,
  productOptions,
  clients,
  warehouses,
  packagingProfiles,
  online,
  receivePending,
  deletePending,
  onReceive,
  onEdit,
  onDelete,
}: DraftPalletListProps) {
  return (
      <Card className="min-h-0">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <span>Draft Pallets</span>
            {drafts.length > 0 && <Badge variant="secondary">{drafts.length}</Badge>}
            <HintButton label="Draft Pallets hints">
              Print labels first, then confirm they printed to send stock to Put-Away.
            </HintButton>
          </CardTitle>
          <CardDescription className="hidden sm:block">Printing alone keeps stock out of inventory. Confirm printed labels to create its Awaiting Put-Away work.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-0 px-0 pb-0 sm:gap-3 sm:px-6 sm:pb-6">
          {visibleDrafts.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
              {drafts.length === 0 ? "No draft pallets yet." : `No drafts matched "${draftSearch}".`}
            </p>
          ) : visibleDrafts.map((draft) => {
            const meta = parseDraftMeta(draft.notes);
            const product = productOptions.find((p) => p.id === (draft.product_id ?? meta.product_id));
            const client = clients.find((item) => item.id === draft.client_id);
            const warehouse = warehouses.find((item) => item.id === draft.warehouse_id);
            const packaging = packagingProfiles.find((item: any) => item.id === meta.packaging_profile_id);
            const barcode = draft.draft_pallet_barcode ?? meta.draft_pallet_barcode ?? draft.receipt_number;
            const containerNumber = draft.container_number ?? meta.container_number;
            const poNumber = draft.po_number ?? draft.reference_number ?? meta.po_number ?? meta.reference_number;
            return (
              <div key={draft.id} className="grid gap-3 border-y border-border px-6 py-3 sm:rounded-lg sm:border sm:px-4 lg:grid-cols-[1fr_auto] lg:items-center">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="min-w-0 text-sm font-medium leading-5 sm:truncate">{product ? `${product.sku} · ${product.name}` : "Unknown product"}</p>
                    <Badge variant="outline" className="font-mono">{barcode}</Badge>
                    {draft.draft_sequence && draft.draft_count ? <Badge variant="secondary">{draft.draft_sequence}/{draft.draft_count}</Badge> : null}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Container {containerNumber ?? "—"} · PO {poNumber ?? "—"} · Qty {draft.quantity ?? "?"} · Exp {draft.expiry_date ? formatDate(draft.expiry_date) : "—"}
                  </p>
                  {draft.source_label && <p className="text-xs font-medium text-amber-700 dark:text-amber-300">Returned from {draft.source_label}</p>}
                </div>
                <div className="flex flex-wrap gap-2 lg:justify-end">
                  <PalletLabelPage
                    barcode={barcode}
                    quantity={Number(draft.quantity ?? meta.quantity ?? 1)}
                    productSku={product?.sku}
                    productName={product?.name}
                    lotNumber={draft.lot_number ?? meta.lot_number}
                    batchNumber={draft.batch_number ?? meta.batch_number}
                    expiryDate={draft.expiry_date ?? meta.expiry_date}
                    containerNumber={draft.container_number ?? meta.container_number}
                    poNumber={draft.po_number ?? meta.po_number}
                    clientName={client?.name}
                    warehouseName={warehouse ? `${warehouse.code ? `${warehouse.code} - ` : ""}${warehouse.name}` : undefined}
                    receiptReference={draft.reference_number ?? draft.receipt_number}
                    packaging={packaging?.name ?? packaging?.unit_name ?? packaging?.unit_of_measure}
                    draftSequence={draft.draft_sequence}
                    draftCount={draft.draft_count}
                    temperatureClass={product?.temperature_requirement}
                    trigger={<Button size="sm" variant="outline" disabled={!online || receivePending}><Printer data-icon="inline-start" />Print label</Button>}
                  />
                  <Button size="sm" disabled={!online || receivePending} onClick={() => onReceive(draft)}>
                    Labels printed
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => onEdit(draft)}><Pencil data-icon="inline-start" />Edit</Button>
                  {draft.status === "draft" && (
                    <Button size="sm" variant="ghost" onClick={() => onDelete(draft.id)} disabled={deletePending}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>
  );
}
