export * from "../../../lib/wms-core";
import { sortInventoryByRotation } from "../../../features/inventory/inventory-rotation";
export const fixtureRows = [
  ["1",7,"2026-01-01T08:00:00Z","2027-05-01"],
  ["2",90,"2026-02-01T08:00:00Z","2027-06-01"],
  ["3",30,"2026-03-01T08:00:00Z",null],
].map(([n, quantity, receipt, expiry]) => ({
  inventory_balance_id: `balance-${n}`, pallet_id: `pallet-${n}`, pallet_code: `PAL-${n}`,
  sku: "TEST-SKU", product_name: "Fixture product", product_id: "fixture-product", client_id: "fixture-owner",
  warehouse_id: "fixture-warehouse", warehouse_code: "TEST", location_id: `location-${n}`, location_code: `A-0${n}-A`,
  status: "available", quantity: Number(quantity), available_quantity: Number(quantity), received_at: String(receipt),
  expiry_date: expiry ? String(expiry) : null, rotation_method: "fifo", is_historic: false,
}));
export const loadInventoryRows = async () => sortInventoryByRotation(fixtureRows);
export const applyInventorySearchTerm = async (rows: typeof fixtureRows, filters: { search: string }) =>
  rows.filter((row) => `${row.sku} ${row.pallet_code}`.toLowerCase().includes(filters.search.toLowerCase()));
export const countInventory = async () => fixtureRows.length;
export const getInventoryDetail = async () => ({});
export const loadInventorySearchState = () => ({ search: "", status: "all", warehouseId: "", ageBucket: "", expiryWindow: "", includeHistoric: false });
export const floorOptionsQuery = () => ({ queryKey: ["fixture-warehouses"], queryFn: async () => ({ warehouses: [{ id: "fixture-warehouse", code: "TEST", name: "Local test warehouse" }] }) });
