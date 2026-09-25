import type { QueryClient, QueryKey } from "@tanstack/react-query";

const warehouseDataQueryKeys = [
  ["dashboard-metrics"],
  ["inventory-search"],
  ["putaway-tasks"],
  ["pick-lists"],
  ["transfers"],
  ["cycle-counts"],
  ["move-tasks"],
  ["status-pallets"],
  ["reports"],
  ["warehouses"],
  ["zones"],
  ["locations"],
  ["clients"],
  ["products"],
  ["product_packaging_profiles"],
  ["options"],
] as const;

// Every cache a pallet changing place or quantity makes stale: stock search,
// status lists, dashboard counts and each occupancy grid (so a bay never keeps
// the count from the location a pallet just left).
const palletMoveQueryKeys = [
  ["inventory-search"],
  ["dashboard-metrics"],
  ["status-pallets"],
  ["product-qty-totals"],
  ["bay-occupancy"],
  ["bin-occupancy"],
  ["pick-bay-occupancy"],
  ["warehouse-bay-occupancy"],
] as const;

/** Refresh after receiving, put-away, a move or a pick. `extraKeys` are the page's own lists. */
export async function invalidateAfterPalletMove(queryClient: QueryClient, extraKeys: readonly QueryKey[] = []) {
  await Promise.all(
    [...palletMoveQueryKeys, ...extraKeys].map((queryKey) =>
      queryClient.invalidateQueries({ queryKey: [...queryKey] }),
    ),
  );
}

export async function invalidateWarehouseData(queryClient: QueryClient) {
  await Promise.all(
    warehouseDataQueryKeys.map((queryKey) =>
      queryClient.invalidateQueries({ queryKey: [...queryKey] }),
    ),
  );
}
