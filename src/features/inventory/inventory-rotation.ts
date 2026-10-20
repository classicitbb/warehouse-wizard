/** Missing dates sort last. FEFO uses receipt time as its secondary key. */
export function compareRotationRows(left: any, right: any): number {
  const date = (value: unknown) => value ? String(value) : "9999-12-31T23:59:59Z";
  const expiry = (row: any) => row.rotation_expiry_date ?? row.expiry_date;
  return (left.rotation_method === "fefo" ? date(expiry(left)).localeCompare(date(expiry(right))) : 0)
    || date(left.received_at).localeCompare(date(right.received_at))
    || String(left.pallet_id ?? "").localeCompare(String(right.pallet_id ?? ""))
    || String(left.inventory_balance_id ?? "").localeCompare(String(right.inventory_balance_id ?? ""));
}

export function sortInventoryByRotation<T extends Record<string, any>>(rows: T[]): T[] {
  return [...rows].sort((left, right) =>
    String(left.product_id ?? left.sku ?? "").localeCompare(String(right.product_id ?? right.sku ?? ""))
    || compareRotationRows(left, right));
}
