// Orders page > New order (standalone, no NetSuite): customer, warehouse,
// ship date and product lines in base units. Saved by create_ww_order as an
// open WW sales order; plan its trip from the order sheet.
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { alertToast } from "@/lib/floor-feedback";
import { formatSupabaseError } from "@/features/shared/core-types";
import { ProductSearch } from "@/components/product-search";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ORDERS_INBOX_QUERY_KEY } from "./orders-inbox-core";
import {
  ORDER_FORM_OPTIONS_QUERY_KEY,
  createWwOrder,
  fetchOrderFormOptions,
  normalizeOrderLines,
  orderInputProblem,
} from "./ww-orders-core";

type DraftLine = { key: number; product_id: string; quantity: string };

let lineKey = 0;
const newLine = (): DraftLine => ({ key: ++lineKey, product_id: "", quantity: "" });

export function WwOrderDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient();
  const { profile } = useAuth();
  const [warehouseId, setWarehouseId] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [shipDate, setShipDate] = useState("");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<DraftLine[]>(() => [newLine()]);

  const { data: options, isLoading } = useQuery({
    queryKey: ORDER_FORM_OPTIONS_QUERY_KEY,
    queryFn: fetchOrderFormOptions,
    enabled: open,
    staleTime: 60_000,
  });

  useEffect(() => {
    if (!open) return;
    setCustomerId("");
    setShipDate("");
    setReference("");
    setNotes("");
    setLines([newLine()]);
  }, [open]);

  useEffect(() => {
    if (!open || warehouseId || !options) return;
    const fallback = profile?.default_warehouse_id ?? (options.warehouses.length === 1 ? options.warehouses[0].id : "");
    if (fallback) setWarehouseId(fallback);
  }, [open, options, profile?.default_warehouse_id, warehouseId]);

  const normalized = normalizeOrderLines(lines);
  const problem = orderInputProblem({ warehouse_id: warehouseId, customer_id: customerId, lines: normalized });
  const customer = options?.customers.find((c) => c.id === customerId);

  const save = useMutation({
    mutationFn: () =>
      createWwOrder({
        warehouse_id: warehouseId,
        customer_id: customerId,
        requested_ship_date: shipDate || null,
        customer_reference: reference,
        notes,
        lines: normalized,
      }),
    onSuccess: async () => {
      alertToast.success("Order saved. Open it to plan its trip.");
      await queryClient.invalidateQueries({ queryKey: ORDERS_INBOX_QUERY_KEY });
      onOpenChange(false);
    },
    onError: (e) => alertToast.noGo(formatSupabaseError(e, "Could not save the order") || "Could not save the order"),
  });

  const setLine = (key: number, patch: Partial<DraftLine>) => setLines((current) => current.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const productOptions = (options?.products ?? []).map((p) => ({ id: p.id, sku: p.sku, name: p.name, barcode: p.barcode ?? undefined }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>New order</DialogTitle>
          <DialogDescription>A sales order for the floor. Quantities are in base units. Plan the trip from the order after you save.</DialogDescription>
        </DialogHeader>

        {isLoading || !options ? (
          <p className="py-6 text-sm text-muted-foreground">Loading…</p>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="ww-order-customer">Customer</Label>
                <Select value={customerId} onValueChange={setCustomerId}>
                  <SelectTrigger id="ww-order-customer"><SelectValue placeholder={options.customers.length ? "Choose the customer" : "No customers yet"} /></SelectTrigger>
                  <SelectContent>
                    {options.customers.map((c) => (
                      <SelectItem key={c.id} value={c.id}>{c.name} ({c.customer_number}){c.on_credit_hold ? " · credit hold" : ""}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {options.customers.length === 0 && <p className="text-xs text-muted-foreground">Add customers on the Customers page first.</p>}
                {customer?.on_credit_hold && <p className="text-xs text-destructive">This customer is on credit hold. The order cannot be picked until a manager releases it.</p>}
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="ww-order-warehouse">Ship from</Label>
                <Select value={warehouseId} onValueChange={setWarehouseId}>
                  <SelectTrigger id="ww-order-warehouse"><SelectValue placeholder="Choose the warehouse" /></SelectTrigger>
                  <SelectContent>
                    {options.warehouses.map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="ww-order-date">Ship date</Label>
                <Input id="ww-order-date" type="date" value={shipDate} onChange={(e) => setShipDate(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="ww-order-ref">Customer reference</Label>
                <Input id="ww-order-ref" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="PO or reference (optional)" />
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <Label>Lines</Label>
              {lines.map((line) => (
                <div key={line.key} className="flex items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <ProductSearch value={line.product_id} onChange={(id) => setLine(line.key, { product_id: id })} options={productOptions} />
                  </div>
                  <Input
                    className="w-28"
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step="any"
                    value={line.quantity}
                    onChange={(e) => setLine(line.key, { quantity: e.target.value })}
                    placeholder="Qty"
                    aria-label="Quantity"
                  />
                  <Button type="button" variant="ghost" size="icon" aria-label="Remove line" disabled={lines.length === 1} onClick={() => setLines((current) => current.filter((l) => l.key !== line.key))}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              <Button type="button" variant="outline" size="sm" className="self-start" onClick={() => setLines((current) => [...current, newLine()])}>
                <Plus className="mr-1 h-4 w-4" /> Add line
              </Button>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ww-order-notes">Notes</Label>
              <Textarea id="ww-order-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
          </div>
        )}

        <DialogFooter className="items-center gap-2">
          {problem && options && <span className="mr-auto text-xs text-muted-foreground">{problem}</span>}
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="button" onClick={() => save.mutate()} disabled={!!problem || save.isPending}>
            {save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save order
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
