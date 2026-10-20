import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
const mocks = vi.hoisted(() => ({ preview: vi.fn(), rows: Array.from({ length: 3 }, (_, n) => ({
  inventory_balance_id: `balance-${n}`, pallet_id: `pallet-${n}`, pallet_code: `PAL-${n}`, sku: "SKU",
  product_name: `Product ${n}`, status: "available", quantity: 20, available_quantity: 20,
  warehouse_id: n === 2 ? "other" : "warehouse", warehouse_code: n === 2 ? "OTHER" : "TEST",
})) }));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ roles: ["warehouse_operator"], profile: { default_warehouse_id: "warehouse" } }) }));
vi.mock("@/features/inventory/unrecorded-pallets-banner", () => ({ UnrecordedPalletsBanner: () => null }));
vi.mock("@/features/picking/inventory-pick-core", () => ({ inventoryPickWork: mocks.preview, inventoryPickLists: vi.fn(async () => []) }));
vi.mock("@/lib/wms-core", async (original) => ({
  ...await original<typeof import("@/lib/wms-core")>(),
  floorOptionsQuery: () => ({ queryKey: ["fixture-options"], queryFn: async () => ({ warehouses: [{ id: "warehouse", name: "Test warehouse" }] }) }),
  loadInventoryRows: async () => mocks.rows,
  countInventory: async () => 3,
  loadInventorySearchState: () => ({ search: "", status: "all", warehouseId: "", ageBucket: "", expiryWindow: "", includeHistoric: false }),
  getInventoryDetail: async () => ({}),
}));
import { InventorySearchPage } from "@/features/inventory/inventory-page";
afterEach(cleanup);

describe("inventory multi-selection", () => {
  it("enters selection, toggles taps/checkboxes without duplicates, and previews exact balance IDs", async () => {
    mocks.preview.mockResolvedValue({ selected: [], recommended: [], warning: false, token: "token" });
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <TooltipProvider><MemoryRouter><InventorySearchPage /></MemoryRouter></TooltipProvider>
    </QueryClientProvider>);
    const first = (await screen.findByText("PAL-0")).closest("tr")!;
    const second = screen.getByText("PAL-1").closest("tr")!;
    const other = screen.getByText("PAL-2").closest("tr")!;
    fireEvent.contextMenu(first);
    fireEvent.click(await screen.findByRole("menuitem", { name: "Select" }));
    expect(screen.getByRole("button", { name: "Add to pick list (1)" })).toBeVisible();
    expect(first).toHaveAttribute("data-state", "selected");
    fireEvent.pointerDown(second); fireEvent.click(second);
    expect(screen.getByRole("button", { name: "Add to pick list (2)" })).toBeVisible();
    fireEvent.click(within(second).getByRole("checkbox"));
    expect(screen.getByRole("button", { name: "Add to pick list (1)" })).toBeVisible();
    expect(within(other).getByRole("checkbox")).toBeDisabled();
    fireEvent.pointerDown(other); fireEvent.click(other);
    expect(screen.getByRole("button", { name: "Add to pick list (1)" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Add to pick list (1)" }));
    await screen.findByRole("dialog");
    expect(mocks.preview).toHaveBeenCalledWith({ warehouseId: "warehouse", balanceIds: ["balance-0"], mode: "pallet" });
  });
});
