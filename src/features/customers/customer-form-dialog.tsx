// Customers page > New customer / Edit (standalone, no NetSuite). Saves
// through save_ww_customer: managers only, WW customers only. A blank number
// gets the next WC- number.
import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { alertToast } from "@/lib/floor-feedback";
import { formatSupabaseError } from "@/features/shared/core-types";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { saveWwCustomer, type ShipAddress, type WwCustomerInput } from "./ww-customers-core";

export type EditableCustomer = {
  id: string;
  customer_number: string;
  name: string;
  delivery_zone: string | null;
  default_ship_address: ShipAddress | null;
  email: string | null;
  phone: string | null;
  on_credit_hold: boolean;
  credit_review_required: boolean;
  ship_complete: boolean;
};

const EMPTY: WwCustomerInput = {
  customer_number: "",
  name: "",
  delivery_zone: "",
  email: "",
  phone: "",
  ship_address: {},
  on_credit_hold: false,
  credit_review_required: false,
  ship_complete: false,
};

function toInput(c: EditableCustomer | null): WwCustomerInput {
  if (!c) return EMPTY;
  return {
    customer_number: c.customer_number,
    name: c.name,
    delivery_zone: c.delivery_zone ?? "",
    email: c.email ?? "",
    phone: c.phone ?? "",
    ship_address: c.default_ship_address ?? {},
    on_credit_hold: c.on_credit_hold,
    credit_review_required: c.credit_review_required,
    ship_complete: c.ship_complete,
  };
}

const ADDRESS_FIELDS: { key: keyof ShipAddress; label: string }[] = [
  { key: "addr1", label: "Address" },
  { key: "addr2", label: "Address line 2" },
  { key: "city", label: "City" },
  { key: "state", label: "Parish / state" },
  { key: "zip", label: "Postal code" },
  { key: "country", label: "Country" },
];

export function CustomerFormDialog({
  open,
  customer,
  zones,
  queryKey,
  onOpenChange,
}: {
  open: boolean;
  customer: EditableCustomer | null;
  zones: readonly string[];
  queryKey: readonly unknown[];
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<WwCustomerInput>(EMPTY);

  useEffect(() => {
    if (open) setForm(toInput(customer));
  }, [open, customer]);

  const set = <K extends keyof WwCustomerInput>(key: K, value: WwCustomerInput[K]) => setForm((f) => ({ ...f, [key]: value }));
  const setAddress = (key: keyof ShipAddress, value: string) => setForm((f) => ({ ...f, ship_address: { ...f.ship_address, [key]: value } }));

  const save = useMutation({
    mutationFn: () => saveWwCustomer(customer?.id ?? null, form),
    onSuccess: async () => {
      alertToast.success(customer ? "Customer saved." : "Customer added.");
      await queryClient.invalidateQueries({ queryKey });
      await queryClient.invalidateQueries({ queryKey: ["orders-inbox", "form-options"] });
      onOpenChange(false);
    },
    onError: (e) => alertToast.noGo(formatSupabaseError(e, "Could not save the customer") || "Could not save the customer"),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{customer ? `Edit ${customer.name}` : "New customer"}</DialogTitle>
          <DialogDescription>A ship-to customer for orders entered in WW.</DialogDescription>
        </DialogHeader>
        <form
          id="customer-form"
          className="grid gap-3 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label htmlFor="cust-name">Name</Label>
            <Input id="cust-name" value={form.name} onChange={(e) => set("name", e.target.value)} required />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cust-number">Number</Label>
            <Input id="cust-number" value={form.customer_number} onChange={(e) => set("customer_number", e.target.value)} placeholder="Blank = next WC- number" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cust-zone">Delivery zone</Label>
            <Input id="cust-zone" list="cust-zone-list" value={form.delivery_zone} onChange={(e) => set("delivery_zone", e.target.value)} />
            <datalist id="cust-zone-list">{zones.map((z) => <option key={z} value={z} />)}</datalist>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cust-phone">Phone</Label>
            <Input id="cust-phone" type="tel" value={form.phone} onChange={(e) => set("phone", e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cust-email">Email</Label>
            <Input id="cust-email" type="email" value={form.email} onChange={(e) => set("email", e.target.value)} />
          </div>
          {ADDRESS_FIELDS.map((f) => (
            <div key={f.key} className={f.key === "addr1" || f.key === "addr2" ? "flex flex-col gap-1.5 sm:col-span-2" : "flex flex-col gap-1.5"}>
              <Label htmlFor={`cust-${f.key}`}>{f.label}</Label>
              <Input id={`cust-${f.key}`} value={form.ship_address[f.key] ?? ""} onChange={(e) => setAddress(f.key, e.target.value)} />
            </div>
          ))}
          <div className="flex flex-col gap-2 sm:col-span-2">
            {([
              ["on_credit_hold", "Credit hold (orders cannot be picked)"],
              ["credit_review_required", "Credit review"],
              ["ship_complete", "Ship complete"],
            ] as const).map(([key, label]) => (
              <label key={key} className="flex items-center gap-2 text-sm">
                <Checkbox checked={form[key]} onCheckedChange={(v) => set(key, v === true)} />
                {label}
              </label>
            ))}
          </div>
        </form>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="submit" form="customer-form" disabled={save.isPending || !form.name.trim()}>
            {save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
