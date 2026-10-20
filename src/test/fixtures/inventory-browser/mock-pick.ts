import { fixtureRows } from "./mock-core";
export const inventoryPickLists = async () => [{ id: "fixture-list", pick_list_number: "PKL-LOCAL-FIXTURE" }];
export async function inventoryPickWork(request: { balanceIds: string[]; mode: string }, commit?: unknown) {
  const recommended = fixtureRows.slice(0, request.mode === "product" ? 1 : new Set(request.balanceIds).size);
  const selected = request.mode === "product" ? recommended : fixtureRows.filter((row) => request.balanceIds.includes(row.inventory_balance_id));
  return { selected, recommended, warning: selected.some((row, i) => row.pallet_id !== recommended[i]?.pallet_id), token: "local-fixture",
    ...(commit ? { lists: [{ id: "fixture-list", pick_list_number: "PKL-LOCAL-FIXTURE" }] } : {}) };
}
