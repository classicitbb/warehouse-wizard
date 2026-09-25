import { lazy, Suspense, useEffect, useState, type ComponentProps } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, RefreshCw } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";

import { useAuth } from "@/hooks/use-auth";
import { formatDate, formatDateTime, formatNumber, getInventoryDetail } from "@/lib/wms-core";
import { AppShell } from "@/features/shared/app-shell";
import { PalletEditDialog, type PalletEditTarget } from "@/features/inventory/pallet-edit-dialog";
import { palletEditBlockedReason, palletOutsideStaging, PUTAWAY_STAGING_LOCATION_CODE, STAGING_EDIT_HINT } from "@/features/inventory/pallet-edit-rules";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";

// Label printing pulls in react-dom/server; load it only when a pallet shows.
const PalletLabelPageLazy = lazy(() =>
  import("@/components/pallet-label-page").then((mod) => ({ default: mod.PalletLabelPage })),
);

function PalletLabelPage(props: ComponentProps<typeof PalletLabelPageLazy>) {
  return (
    <Suspense fallback={null}>
      <PalletLabelPageLazy {...props} />
    </Suspense>
  );
}

function PalletBarcodePreview({ code }: { code?: string | null }) {
  if (!code) return null;
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-border bg-white p-3">
      <QRCodeSVG value={code} size={160} bgColor="#ffffff" fgColor="#000000" level="H" />
      <p className="font-mono text-xs font-semibold tracking-wider text-black">{code}</p>
    </div>
  );
}


type InventoryDetailData = {
  balance: {
    status: string;
    quantity: number;
    available_quantity: number;
    reserved_quantity?: number;
    held_quantity?: number;
    damaged_quantity?: number;
    received_at?: string | null;
    correction_state?: "pending" | "superseded" | null;
  };
  pallet: {
    pallet_code: string | null;
    pallet_barcode: string | null;
    length?: number | null;
    width?: number | null;
    height?: number | null;
    weight?: number | null;
    correction_state?: "pending" | "superseded" | null;
  } | null;
  product?: {
    sku?: string | null;
    name?: string | null;
    barcode?: string | null;
    temperature_requirement?: string | null;
  } | null;
  client?: { code?: string | null; name?: string | null } | null;
  warehouse?: { code?: string | null; name?: string | null } | null;
  location?: { code?: string | null; aisle?: string | null; bay?: string | null; level?: string | null; location_type?: string | null } | null;
  receipt?: {
    receipt_number?: string | null;
    receipt_type?: string | null;
    reference_number?: string | null;
    container_number?: string | null;
    po_number?: string | null;
    draft_sequence?: number | null;
    draft_count?: number | null;
    created_at?: string | null;
  } | null;
  receiptLine?: {
    quantity?: number | null;
    received_quantity?: number | null;
    override_length?: number | null;
    override_width?: number | null;
    override_height?: number | null;
    override_weight?: number | null;
  } | null;
  packaging?: {
    profile_name?: string | null;
    name?: string | null;
    unit_name?: string | null;
    unit_of_measure?: string | null;
  } | null;
  lot: {
    expiry_date: string | null;
    lot_number: string | null;
    batch_number: string | null;
    manufacture_date?: string | null;
  } | null;
  audit: Array<{
    id: string;
    event_type: string;
    created_at: string;
    entity_table: string;
  }>;
};

export function InventoryDetailPage() {
  const { balanceId = "" } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { roles } = useAuth();
  const [editOpen, setEditOpen] = useState(false);
  const { data, isLoading } = useQuery<InventoryDetailData>({
    queryKey: ["inventory-detail", balanceId],
    queryFn: async () => (await getInventoryDetail(balanceId)) as unknown as InventoryDetailData,
    enabled: Boolean(balanceId),
  });
  const palletBarcode = data?.pallet?.pallet_barcode ?? data?.pallet?.pallet_code ?? "";
  const productLabel =
    data?.product?.sku || data?.product?.name
      ? `${data.product?.sku ?? ""}${data.product?.sku && data.product?.name ? " · " : ""}${data.product?.name ?? ""}`
      : "—";
  const clientLabel =
    data?.client?.code || data?.client?.name
      ? `${data.client?.code ?? ""}${data.client?.code && data.client?.name ? " · " : ""}${data.client?.name ?? ""}`
      : "—";
  const warehouseLabel =
    data?.warehouse?.code || data?.warehouse?.name
      ? `${data.warehouse?.code ?? ""}${data.warehouse?.code && data.warehouse?.name ? " · " : ""}${data.warehouse?.name ?? ""}`
      : "—";
  const canReceive = roles.some((role) =>
    [
      "developer",
      "dev",
      "admin",
      "warehouse_manager",
      "warehouse_supervisor",
      "supervisor",
      "inventory_clerk",
    ].includes(role),
  );
  // A pending edit is resumable rather than blocked — reopening it picks the
  // same draft back up instead of reserving a second pallet number.
  const correctionBlockedReason = data
    ? palletEditBlockedReason({
        hasPallet: Boolean(data.pallet),
        balanceCorrectionState: data.balance.correction_state ?? null,
        palletCorrectionState: data.pallet?.correction_state ?? null,
        balanceStatus: data.balance.status,
        reservedQuantity: data.balance.reserved_quantity ?? 0,
        availableQuantity: data.balance.available_quantity ?? 0,
        locationCode: data.location?.code ?? null,
        locationType: data.location?.location_type ?? null,
      })
    : "";
  const outsideStaging = palletOutsideStaging({
    locationCode: data?.location?.code ?? null,
    locationType: data?.location?.location_type ?? null,
  });
  const showStagingHint = Boolean(
    correctionBlockedReason &&
    outsideStaging &&
    data?.balance.correction_state !== "pending" &&
    data?.pallet?.correction_state !== "pending",
  );
  const editTarget: PalletEditTarget | null = data?.pallet
    ? {
        balanceId,
        palletBarcode,
        quantity: Number(data.balance.quantity ?? 0),
        expiryDate: data.lot?.expiry_date ?? null,
        productSku: data.product?.sku ?? null,
        productName: data.product?.name ?? null,
        lotNumber: data.lot?.lot_number ?? null,
        batchNumber: data.lot?.batch_number ?? null,
        clientName: data.client?.name ?? data.client?.code ?? null,
        warehouseName: data.warehouse
          ? `${data.warehouse.code ? `${data.warehouse.code} - ` : ""}${data.warehouse.name ?? ""}`
          : null,
        locationCode: data.location?.code ?? null,
        containerNumber: data.receipt?.container_number ?? null,
        poNumber: data.receipt?.po_number ?? null,
        receiptReference: data.receipt?.reference_number ?? data.receipt?.receipt_number ?? null,
        packaging:
          data.packaging?.profile_name ??
          data.packaging?.name ??
          data.packaging?.unit_name ??
          data.packaging?.unit_of_measure ??
          null,
        temperatureClass: data.product?.temperature_requirement ?? undefined,
        correctionPending:
          data.balance.correction_state === "pending" || data.pallet?.correction_state === "pending",
      }
    : null;

  // Receiving hands a pending edit back here rather than editing it there.
  const canOpenEdit = Boolean(editTarget) && !correctionBlockedReason;
  useEffect(() => {
    if (searchParams.get("edit") !== "1" || !canOpenEdit) return;
    setEditOpen(true);
    setSearchParams({}, { replace: true });
  }, [canOpenEdit, searchParams, setSearchParams]);

  return (
    <AppShell>
      <div className="flex flex-col gap-6">
        <Button variant="ghost" className="w-fit -ml-1 gap-1.5 text-muted-foreground" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-4 w-4" /> Back
        </Button>
        <div className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <Card className="min-w-0">
            <CardHeader>
              <CardTitle>Inventory Detail</CardTitle>
              <CardDescription>Pallet, lot, status, and location context.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 text-sm">
              {isLoading ? (
                <p className="text-muted-foreground">Loading…</p>
              ) : data ? (
                <>
                  <div className="flex items-center justify-between gap-4">
                    <span>Pallet</span>
                    <span className="font-mono text-right">{data.pallet?.pallet_code ?? "—"}</span>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <span>Pallet barcode</span>
                    <span className="font-mono text-right">{palletBarcode || "—"}</span>
                  </div>
                  <PalletBarcodePreview code={palletBarcode} />
                  <div className="flex items-center justify-between gap-4">
                    <span>Product</span>
                    <span className="text-right">{productLabel}</span>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <span>Product barcode</span>
                    <span className="font-mono text-right">{data.product?.barcode ?? "—"}</span>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <span>Client</span>
                    <span className="text-right">{clientLabel}</span>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <span>Warehouse</span>
                    <span className="text-right">{warehouseLabel}</span>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <span>Location</span>
                    <span className="font-mono text-right">{data.location?.code ?? "Receiving / not stored"}</span>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <span>Status</span>
                    <Badge>{data.balance.status}</Badge>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <span>Quantity</span>
                    <span>{formatNumber(data.balance.quantity)}</span>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <span>Available</span>
                    <span>{formatNumber(data.balance.available_quantity)}</span>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <span>Received qty</span>
                    <span>
                      {formatNumber(
                        data.receiptLine?.received_quantity ?? data.receiptLine?.quantity ?? data.balance.quantity,
                      )}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <span>Receipt</span>
                    <span className="font-mono text-right">{data.receipt?.receipt_number ?? "—"}</span>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <span>Reference</span>
                    <span className="text-right">{data.receipt?.reference_number ?? "—"}</span>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <span>Expiry</span>
                    <span>{formatDate(data.lot?.expiry_date)}</span>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <span>Lot</span>
                    <span>{data.lot?.lot_number ?? "—"}</span>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <span>Batch</span>
                    <span>{data.lot?.batch_number ?? "—"}</span>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <span>Manufactured</span>
                    <span>{formatDate(data.lot?.manufacture_date)}</span>
                  </div>
                  <div className="grid gap-2 rounded-lg border border-border p-3">
                    <div className="flex items-center justify-between gap-4">
                      <span>Dimensions</span>
                      <span className="text-right">
                        {[
                          data.receiptLine?.override_length ?? data.pallet?.length,
                          data.receiptLine?.override_width ?? data.pallet?.width,
                          data.receiptLine?.override_height ?? data.pallet?.height,
                        ]
                          .map((value) => (value == null ? "—" : formatNumber(value)))
                          .join(" × ")}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-4">
                      <span>Weight</span>
                      <span>{formatNumber(data.receiptLine?.override_weight ?? data.pallet?.weight)} kg</span>
                    </div>
                  </div>
                  {palletBarcode && (
                    <div className="flex flex-wrap gap-2">
                      <PalletLabelPage
                        barcode={palletBarcode}
                        quantity={Number(data.balance.quantity ?? 0)}
                        productSku={data.product?.sku ?? undefined}
                        productName={data.product?.name ?? undefined}
                        lotNumber={data.lot?.lot_number}
                        batchNumber={data.lot?.batch_number}
                        expiryDate={data.lot?.expiry_date}
                        containerNumber={data.receipt?.container_number}
                        poNumber={data.receipt?.po_number}
                        clientName={data.client?.name ?? data.client?.code}
                        warehouseName={
                          data.warehouse
                            ? `${data.warehouse.code ? `${data.warehouse.code} - ` : ""}${data.warehouse.name ?? ""}`
                            : undefined
                        }
                        locationCode={data.location?.code}
                        receiptReference={data.receipt?.reference_number ?? data.receipt?.receipt_number}
                        packaging={
                          data.packaging?.profile_name ??
                          data.packaging?.name ??
                          data.packaging?.unit_name ??
                          data.packaging?.unit_of_measure
                        }
                        draftSequence={data.receipt?.draft_sequence}
                        draftCount={data.receipt?.draft_count}
                        temperatureClass={data.product?.temperature_requirement ?? undefined}
                        trigger={<Button variant="outline">Preview pallet label</Button>}
                      />
                    </div>
                  )}
                  {canReceive && (
                    <div className="flex flex-col gap-2">
                      <Button
                        variant="outline"
                        className="w-fit"
                        disabled={Boolean(correctionBlockedReason)}
                        title={
                          correctionBlockedReason || "Edit this pallet's quantity or expiry, or send it back to Drafts"
                        }
                        onClick={() => setEditOpen(true)}
                      >
                        <RefreshCw className="mr-2 h-4 w-4" />
                        Edit pallet
                      </Button>
                      {showStagingHint && data?.pallet && data.location?.code ? (
                        <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs">
                          <p className="text-amber-700 dark:text-amber-400">{STAGING_EDIT_HINT}</p>
                          <Button size="sm" variant="link" className="mt-1 h-auto px-0 text-xs" asChild>
                            <Link
                              to={`/location-moves?pallet=${encodeURIComponent(palletBarcode)}&bay=${encodeURIComponent(PUTAWAY_STAGING_LOCATION_CODE)}&from=${encodeURIComponent(`/inventory/${balanceId}`)}`}
                            >
                              Go to Location Moves
                            </Link>
                          </Button>
                        </div>
                      ) : null}
                    </div>
                  )}
                </>
              ) : null}
            </CardContent>
          </Card>
          <Card className="min-w-0">
            <CardHeader>
              <CardTitle>Movement History</CardTitle>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[420px]">
                <div className="grid gap-3">
                  {(data?.audit ?? []).map((event) => (
                    <div key={event.id} className="rounded-lg border border-border px-3 py-2 text-sm">
                      <div className="flex items-center justify-between gap-4">
                        <span className="font-medium">{event.event_type}</span>
                        <span className="text-xs text-muted-foreground">{formatDateTime(event.created_at)}</span>
                      </div>
                      <p className="text-xs text-muted-foreground">{event.entity_table}</p>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </div>
      </div>
      <PalletEditDialog open={editOpen} onOpenChange={setEditOpen} target={editTarget} />
    </AppShell>
  );
}

