import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
const api = vi.hoisted(() => ({ inventoryPickWork: vi.fn(), inventoryPickLists: vi.fn() }));
vi.mock("@/features/picking/inventory-pick-core", () => api);
import { InventoryPickDialog } from "@/features/inventory/inventory-pick-dialog";
import { InventoryResultActions, InventoryResultContext } from "@/features/inventory/inventory-result-actions";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";

const chosen = { inventory_balance_id: "balance-2", pallet_id: "pallet-2", pallet_code: "PAL-LATER", product_id: "product", sku: "SKU", client_id: "owner", location_id: "location", location_code: "A-01-A", quantity: 90, received_at: "2026-02-01", expiry_date: "2027-05-01", rotation_method: "fifo" };
const recommended = { ...chosen, inventory_balance_id: "balance-1", pallet_id: "pallet-1", pallet_code: "PAL-FIRST", quantity: 7, received_at: "2026-01-01" };
const plan = { selected: [chosen], recommended: [recommended], warning: true, token: "review-token" };
function open(single = true) {
  const onAdded = vi.fn(), onClose = vi.fn();
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <InventoryPickDialog warehouseId="warehouse" balanceIds={["balance-2"]} single={single} onAdded={onAdded} onClose={onClose} />
  </QueryClientProvider>);
  return { onAdded, onClose };
}
beforeEach(() => {
  api.inventoryPickWork.mockReset().mockResolvedValue(plan);
  api.inventoryPickLists.mockReset().mockResolvedValue([]);
});
afterEach(cleanup);

describe("inventory pallet action review", () => {
  it("offers This pallet/This product and never a quantity input; product uses one pallet", async () => {
    api.inventoryPickWork.mockResolvedValue({ ...plan, selected: [recommended], recommended: [recommended], warning: false });
    open();
    expect(api.inventoryPickWork).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "This product" }));
    await screen.findByText("PAL-FIRST · SKU");
    expect(api.inventoryPickWork).toHaveBeenCalledWith({ warehouseId: "warehouse", balanceIds: ["balance-2"], mode: "product" });
    expect(screen.queryByRole("spinbutton")).toBeNull();
    expect(screen.getByRole("button", { name: "Add 1 whole pallet" })).toBeDisabled();
  });
  it.each(["Keep selected pallets", "Use recommended pallets"])("shows evidence and requires review before saving: %s", async (label) => {
    const { onAdded } = open(false);
    await screen.findByText("Review stock rotation");
    expect(screen.getByText("PAL-LATER · SKU")).toBeVisible();
    expect(screen.getByText("PAL-FIRST · SKU")).toBeVisible();
    expect(screen.getByText(/90 units/)).toBeVisible();
    expect(screen.getByText(/7 units/)).toBeVisible();
    expect(screen.queryByRole("button", { name: "Add 1 whole pallet" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: label }));
    fireEvent.change(screen.getByLabelText("Order number (required)"), { target: { value: "ORDER-TEST" } });
    api.inventoryPickWork.mockResolvedValueOnce({ ...plan, lists: [{ id: "list", pick_list_number: "PKL-TEST" }] });
    fireEvent.click(screen.getByRole("button", { name: "Add 1 whole pallet" }));
    await waitFor(() => expect(onAdded).toHaveBeenCalled());
    expect(api.inventoryPickWork).toHaveBeenLastCalledWith(expect.anything(), {
      token: "review-token", choice: label.startsWith("Keep") ? "selected" : "recommended", listId: null, orderNumber: "ORDER-TEST",
    });
  });
  it("requires refresh/review after stale rejection and does not silently substitute", async () => {
    const { onAdded } = open(false);
    fireEvent.click(await screen.findByRole("button", { name: "Keep selected pallets" }));
    fireEvent.change(screen.getByLabelText("Order number (required)"), { target: { value: "ORDER-TEST" } });
    api.inventoryPickWork.mockRejectedValueOnce(new Error("Availability changed since review"));
    fireEvent.click(screen.getByRole("button", { name: "Add 1 whole pallet" }));
    await screen.findByRole("alert");
    expect(onAdded).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Add 1 whole pallet" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Refresh preview" }));
    await screen.findByRole("button", { name: "Keep selected pallets" });
  });
  it("cancel closes without creating work", async () => {
    const { onClose } = open(false);
    await screen.findByText("Review stock rotation");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledOnce();
    expect(api.inventoryPickWork).toHaveBeenCalledTimes(1);
  });
  it("opens the context menu on right click with equivalent accessible actions", async () => {
    const onView = vi.fn(), onAdd = vi.fn(), onSelect = vi.fn();
    const actions = { onView, onAdd, onSelect, canView: true, canAdd: true };
    render(<Table><TableBody><InventoryResultContext {...actions} onOpen={vi.fn()}>
      <TableRow><TableCell><InventoryResultActions palletCode="PAL-TEST" {...actions} /></TableCell></TableRow>
    </InventoryResultContext></TableBody></Table>);
    fireEvent.contextMenu(screen.getByRole("row"));
    expect(await screen.findByRole("menuitem", { name: "View item" })).toBeVisible();
    expect(screen.getByRole("menuitem", { name: "Add to pick list" })).toBeVisible();
    fireEvent.click(screen.getByRole("menuitem", { name: "Select" }));
    expect(onSelect).toHaveBeenCalledOnce();
  });
  it("opens the same menu after a touch long-press", async () => {
    const actions = { onView: vi.fn(), onAdd: vi.fn(), onSelect: vi.fn(), canView: true, canAdd: true };
    const onOpen = vi.fn();
    render(<Table><TableBody><InventoryResultContext {...actions} onOpen={onOpen}>
      <TableRow><TableCell>Touch pallet</TableCell></TableRow>
    </InventoryResultContext></TableBody></Table>);
    fireEvent(screen.getByRole("row"), Object.assign(new Event("pointerdown", { bubbles: true }),
      { pointerType: "touch", clientX: 20, clientY: 20, button: 0, ctrlKey: false }));
    expect(await screen.findByRole("menuitem", { name: "Add to pick list" })).toBeVisible();
    expect(onOpen).toHaveBeenCalledOnce();
    expect(actions.onView).not.toHaveBeenCalled();
  });
});
