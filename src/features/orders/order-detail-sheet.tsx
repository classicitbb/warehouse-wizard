// Orders inbox detail: one order's lines (in the line's own unit) and the
// fulfillments the office made for it, numbered "part n of m" (N2).
import { useQuery } from "@tanstack/react-query";
import { formatDate } from "@/features/shared/core-types";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  ORDERS_INBOX_QUERY_KEY,
  blockReasons,
  fetchOrderDetail,
  formatLineQuantity,
  fulfillmentParts,
  fulfillmentStatusLabel,
  isAgedFulfillment,
  orderStatusLabel,
  type InboxRow,
} from "./orders-inbox-core";

export function OrderDetailSheet({ row, onClose }: { row: InboxRow | null; onClose: () => void }) {
  const { data, isLoading, error } = useQuery({
    queryKey: [...ORDERS_INBOX_QUERY_KEY, "detail", row?.id],
    queryFn: () => fetchOrderDetail(row!.id),
    enabled: !!row,
  });
  const parts = fulfillmentParts(data?.fulfillments ?? []);
  const reasons = row ? blockReasons(row) : [];

  return (
    <Sheet open={!!row} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
        {row && (
          <>
            <SheetHeader>
              <SheetTitle className="flex flex-wrap items-center gap-2">
                <span className="font-mono">{row.order_number}</span>
                <Badge variant="secondary">{row.order_type === "transfer" ? "Transfer" : "Sales"}</Badge>
              </SheetTitle>
              <SheetDescription>
                {row.order_type === "transfer"
                  ? `To ${row.destination_location_name ?? "unknown location"}`
                  : `${row.customer_name ?? "Unknown customer"}${row.customer_number ? ` (${row.customer_number})` : ""}`}
                {" · "}
                {orderStatusLabel(row.external_status)}
                {row.requested_ship_date ? ` · ship ${formatDate(row.requested_ship_date)}` : ""}
              </SheetDescription>
            </SheetHeader>

            {reasons.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-1">
                {reasons.map((r) => (
                  <Badge key={r.code} variant={r.tone === "block" ? "destructive" : "outline"}>{r.label}</Badge>
                ))}
              </div>
            )}

            {error ? (
              <p className="mt-6 text-sm text-destructive">Could not load the order: {error instanceof Error ? error.message : String(error)}</p>
            ) : isLoading || !data ? (
              <p className="mt-6 text-sm text-muted-foreground">Loading…</p>
            ) : (
              <div className="mt-6 flex flex-col gap-6">
                <section>
                  <h3 className="mb-2 text-sm font-semibold">Lines</h3>
                  {data.lines.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No lines with items that WW knows.</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Item</TableHead>
                            <TableHead className="text-right">Ordered</TableHead>
                            <TableHead className="text-right">Committed</TableHead>
                            <TableHead className="text-right">Shipped</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {data.lines.map((line) => (
                            <TableRow key={line.id} className={line.is_closed ? "opacity-50" : undefined}>
                              <TableCell>
                                <div className="font-mono text-xs">{line.product?.sku ?? "—"}</div>
                                <div className="text-sm">{line.product?.name}</div>
                              </TableCell>
                              <TableCell className="text-right">{formatLineQuantity(line.quantity, line.unit)}</TableCell>
                              <TableCell className={line.committed_quantity < line.quantity - line.fulfilled_quantity ? "text-right text-amber-700 dark:text-amber-400" : "text-right"}>
                                {formatLineQuantity(line.committed_quantity, line.unit)}
                              </TableCell>
                              <TableCell className="text-right">{formatLineQuantity(line.fulfilled_quantity, line.unit)}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                  {row.unmapped_line_count > 0 && (
                    <p className="mt-2 text-xs text-destructive">
                      {row.unmapped_line_count} more line{row.unmapped_line_count === 1 ? " has an item" : "s have items"} that WW does not know. Import the items, then sync again.
                    </p>
                  )}
                </section>

                <section>
                  <h3 className="mb-2 text-sm font-semibold">Fulfillments</h3>
                  {data.fulfillments.length === 0 ? (
                    <p className="text-sm text-muted-foreground">The office has not planned this order yet (Fulfill Orders in NetSuite).</p>
                  ) : (
                    <ul className="flex flex-col gap-2">
                      {data.fulfillments.map((f) => (
                        <li key={f.id} className="rounded-md border p-3 text-sm">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-mono">{f.document_number}</span>
                            {parts.get(f.id) && <span className="text-muted-foreground">{parts.get(f.id)}</span>}
                            <Badge variant={f.external_status === "C" ? "secondary" : "default"}>{fulfillmentStatusLabel(f.external_status)}</Badge>
                            {isAgedFulfillment(f.external_status, f.fulfillment_date) && (
                              <Badge variant="outline" className="border-amber-500 text-amber-700 dark:text-amber-400">Aged</Badge>
                            )}
                          </div>
                          <div className="mt-1 text-muted-foreground">
                            {[formatDate(f.fulfillment_date), f.truck_name, f.trip_number ? `Trip ${f.trip_number}` : null, f.picker_name ? `Picker ${f.picker_name}` : null]
                              .filter(Boolean)
                              .join(" · ")}
                            {` · ${f.order_fulfillment_lines.length} line${f.order_fulfillment_lines.length === 1 ? "" : "s"}`}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              </div>
            )}
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
