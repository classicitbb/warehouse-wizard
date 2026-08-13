import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PutawayTasksPage } from "@/components/wms-ui";
import { TooltipProvider } from "@/components/ui/tooltip";

const wmsMocks = vi.hoisted(() => ({
  getPutawayTasks: vi.fn(),
  getPutawayTaskHistory: vi.fn(async () => []),
  getWarehouseBayOccupancy: vi.fn(async () => [
    {
      zoneCode: "AMB",
      zoneName: "Ambient",
      aisle: "A1",
      bay: "B1",
      bayCode: "BAY:WH-1:AMB:A1:B1",
      totalCapacity: 2,
      totalOccupied: 0,
    },
    {
      zoneCode: "COOL",
      zoneName: "Cold",
      aisle: "C1",
      bay: "C1",
      bayCode: "BAY:WH-1:COOL:C1:C1",
      totalCapacity: 3,
      totalOccupied: 1,
    },
  ]),
  getBayOccupancy: vi.fn(async () => ({ aisle: "A1", bay: "B1", cells: [] })),
  getBinOccupancy: vi.fn(async () => ({ locationCode: "LOC-1", occupiedPallets: 0, maxPallets: 2 })),
  logPutawayBaySelection: vi.fn(async () => undefined),
  confirmPutaway: vi.fn(async () => undefined),
  revertPutawayToDraft: vi.fn(async (_taskId: string) => undefined),
}));

const openTasks = [
  {
    id: "task-1",
    task_number: "PTA-1",
    status: "queued",
    warehouse_id: "wh-1",
    pallets: {
      pallet_barcode: "PLT-1",
      pallet_code: "PALLET-1",
      quantity: 8,
      products: { sku: "SKU-1", name: "Product One" },
    },
    locations: { code: "SUG-1" },
  },
  {
    id: "task-2",
    task_number: "PTA-2",
    status: "assigned",
    warehouse_id: "wh-1",
    pallets: {
      pallet_barcode: "PLT-2",
      pallet_code: "PALLET-2",
      quantity: 5,
      products: { sku: "SKU-2", name: "Product Two" },
    },
    locations: { code: "SUG-2" },
  },
];

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

(globalThis as any).ResizeObserver = ResizeObserverStub;
Element.prototype.scrollIntoView = vi.fn();
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({
    user: { id: "user-1" },
    roles: ["warehouse_manager"],
  }),
}));

vi.mock("@/lib/wms-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/wms-core")>();
  return {
    ...actual,
    getPutawayTasks: wmsMocks.getPutawayTasks,
    getPutawayTaskHistory: wmsMocks.getPutawayTaskHistory,
    getWarehouseBayOccupancy: wmsMocks.getWarehouseBayOccupancy,
    getBayOccupancy: wmsMocks.getBayOccupancy,
    getBinOccupancy: wmsMocks.getBinOccupancy,
    logPutawayBaySelection: wmsMocks.logPutawayBaySelection,
    confirmPutaway: wmsMocks.confirmPutaway,
    revertPutawayToDraft: wmsMocks.revertPutawayToDraft,
  };
});

describe("PutawayTasksPage scan-first flow", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    window.localStorage.clear();
    setPointerCoarse(false);
    wmsMocks.getPutawayTasks.mockResolvedValue(openTasks);
    wmsMocks.getPutawayTaskHistory.mockResolvedValue([]);
    wmsMocks.confirmPutaway.mockResolvedValue(undefined);
    wmsMocks.revertPutawayToDraft.mockResolvedValue(undefined);
  });

  function setPointerCoarse(matches: boolean) {
    vi.mocked(window.matchMedia).mockImplementation((query: string) => ({
      matches,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
  }

  function renderPutawayPage() {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <TooltipProvider>
            <PutawayTasksPage />
            <LocationIndicator />
          </TooltipProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    return { queryClient, invalidateSpy };
  }

  function LocationIndicator() {
    const location = useLocation();
    return <output data-testid="location">{location.pathname}</output>;
  }

  async function openBatchReturnDialog() {
    fireEvent.click(await screen.findByRole("button", { name: /return tasks to receiving/i }));
    return screen.findByRole("dialog", { name: /return put-away tasks to receiving/i });
  }

  async function enterPallet(value: string) {
    await openPalletDialog();
    const input = await screen.findByLabelText("Pallet number");
    fireEvent.change(input, { target: { value } });
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });
  }

  async function openPalletDialog() {
    const existing = screen.queryByRole("dialog", { name: /scan pallet for put-away/i });
    if (existing) return existing;
    const trigger = await screen.findByRole("button", { name: /^scan pallet$/i });
    fireEvent.click(trigger);
    return screen.findByRole("dialog", { name: /scan pallet for put-away/i });
  }

  async function closeLocationScanner() {
    const scannerDialog = await screen.findByRole("dialog", { name: /scan location barcode/i });
    fireEvent.click(within(scannerDialog).getByRole("button", { name: /close/i }));
  }

  it("opens the pallet scan dialog from the idle scan button", async () => {
    renderPutawayPage();

    expect(await openPalletDialog()).toBeInTheDocument();
    expect(screen.getByLabelText("Pallet number")).toBeInTheDocument();
  });

  it("shows the idle scan glow until pallet input begins", async () => {
    renderPutawayPage();

    await openPalletDialog();
    const input = await screen.findByLabelText("Pallet number");
    const prompt = screen.getByTestId("putaway-scan-prompt");
    const camera = screen.getByRole("button", { name: /scan pallet barcode/i });

    expect(prompt).toHaveAttribute("data-waiting-for-input", "true");
    expect(prompt).toHaveClass("scan-prompt-halo");
    expect(input).toHaveClass("scan-prompt-input");
    expect(camera).toHaveClass("scan-prompt-camera");

    fireEvent.change(input, { target: { value: "P" } });

    expect(prompt).toHaveAttribute("data-waiting-for-input", "false");
    expect(prompt).not.toHaveClass("scan-prompt-halo");
    expect(input).not.toHaveClass("scan-prompt-input");
    expect(camera).not.toHaveClass("scan-prompt-camera");
  });

  it("asks mobile scanner users whether to open the scanner first next time", async () => {
    setPointerCoarse(true);
    renderPutawayPage();

    await openPalletDialog();
    fireEvent.click(await screen.findByRole("button", { name: /scan pallet barcode/i }));
    const cameraDialog = await screen.findByRole("dialog", { name: /scan pallet barcode/i });
    fireEvent.click(within(cameraDialog).getByRole("button", { name: /close/i }));

    expect(await screen.findByText("Open scanner first next time?")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Remember" }));

    expect(window.localStorage.getItem("warehouseWizard.putaway.scannerFirst")).toBe("true");
    expect(screen.queryByText("Open scanner first next time?")).not.toBeInTheDocument();
  });

  it("auto-opens the pallet scanner on mobile when remembered", async () => {
    setPointerCoarse(true);
    window.localStorage.setItem("warehouseWizard.putaway.scannerFirst", "true");
    renderPutawayPage();

    expect(await screen.findByRole("dialog", { name: /scan pallet barcode/i })).toBeInTheDocument();
    expect(screen.queryByText("Open scanner first next time?")).not.toBeInTheDocument();
  });

  it("reveals only the matching task and opens the location scanner", async () => {
    renderPutawayPage();

    await enterPallet("PLT-1");

    const scannerDialog = await screen.findByRole("dialog", { name: /scan location barcode/i });
    expect(within(scannerDialog).getByRole("button", { name: /select location manually/i })).toBeInTheDocument();
    expect(screen.getByText(/SKU-1/)).toBeInTheDocument();
    expect(screen.queryByText(/SKU-2/)).not.toBeInTheDocument();
    expect(screen.queryByText("SUG-1")).not.toBeInTheDocument();
  });

  it("does not show override controls for a simple suggested-location mismatch", async () => {
    renderPutawayPage();

    await enterPallet("PLT-1");
    await closeLocationScanner();

    const locationInput = await screen.findByPlaceholderText("Scan location barcode");
    fireEvent.change(locationInput, { target: { value: "LOC-1" } });

    expect(screen.queryByText(/operator override/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/override location rules/i)).not.toBeInTheDocument();
  });

  it("shows override controls only after a rule violation", async () => {
    wmsMocks.confirmPutaway
      .mockRejectedValueOnce(new Error("RULE_VIOLATION: Location is full"))
      .mockResolvedValueOnce(undefined);
    renderPutawayPage();

    await enterPallet("PLT-1");
    await closeLocationScanner();

    const locationInput = await screen.findByPlaceholderText("Scan location barcode");
    fireEvent.change(locationInput, { target: { value: "LOC-1" } });
    fireEvent.click(screen.getByRole("button", { name: /^Confirm Put-Away$/i }));

    expect(await screen.findByText(/rule violation: location is full/i)).toBeInTheDocument();
    const override = screen.getByLabelText(/override location rules/i);
    fireEvent.click(override);
    fireEvent.change(screen.getByPlaceholderText(/reason for override/i), { target: { value: "Supervisor approved" } });
    fireEvent.click(screen.getByRole("button", { name: /^Override & Confirm Put-Away$/i }));

    await waitFor(() => expect(wmsMocks.confirmPutaway).toHaveBeenLastCalledWith(
      "task-1",
      "PLT-1",
      "LOC-1",
      { override: true, overrideReason: "Supervisor approved" },
    ));
  });

  it("does not show suggested locations in completed task history", async () => {
    wmsMocks.getPutawayTasks.mockResolvedValue([]);
    wmsMocks.getPutawayTaskHistory.mockResolvedValue([{
      id: "done-1",
      task_number: "PTA-DONE",
      status: "completed",
      pallets: {
        pallet_barcode: "PLT-DONE",
        products: { sku: "SKU-DONE", name: "Done Product" },
      },
      locations: { code: "SUG-HISTORY" },
    }] as any);

    renderPutawayPage();

    expect(await screen.findByText(/show 1 completed \/ returned/i)).toBeInTheDocument();
    expect(screen.queryByText(/SUG-HISTORY/)).not.toBeInTheDocument();
  });

  it("opens the bay selector from the location scanner manual action", async () => {
    renderPutawayPage();

    await enterPallet("PLT-1");
    const scannerDialog = await screen.findByRole("dialog", { name: /scan location barcode/i });
    fireEvent.click(within(scannerDialog).getByRole("button", { name: /select location manually/i }));

    const bayDialog = await screen.findByRole("dialog", { name: /select a bay/i });
    expect(within(bayDialog).getByRole("button", { name: /^scan$/i })).toBeInTheDocument();
    expect(await within(bayDialog).findByRole("button", { name: /A1-B1/i })).toHaveClass("min-h-[4.25rem]");
    fireEvent.click(within(bayDialog).getByRole("button", { name: /close/i }));

    expect(await screen.findByText(/SKU-1/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByPlaceholderText("Scan location barcode")).toHaveFocus());
  });

  it("switches from manual bay selection back to scanning", async () => {
    renderPutawayPage();

    await enterPallet("PLT-1");
    const scannerDialog = await screen.findByRole("dialog", { name: /scan location barcode/i });
    fireEvent.click(within(scannerDialog).getByRole("button", { name: /select location manually/i }));

    const bayDialog = await screen.findByRole("dialog", { name: /select a bay/i });
    fireEvent.click(within(bayDialog).getByRole("button", { name: /^scan$/i }));

    expect(await screen.findByRole("dialog", { name: /scan location barcode/i })).toBeInTheDocument();
  });

  it("filters manual bay selection to a typed zone code", async () => {
    renderPutawayPage();

    await enterPallet("PLT-1");
    await closeLocationScanner();

    const locationInput = await screen.findByPlaceholderText("Scan location barcode");
    fireEvent.change(locationInput, { target: { value: "COOL" } });
    fireEvent.click(screen.getByRole("button", { name: /browse bays/i }));

    const bayDialog = await screen.findByRole("dialog", { name: /select a bay/i });
    expect(await within(bayDialog).findByText("Cold")).toBeInTheDocument();
    expect(within(bayDialog).queryByText("Ambient")).not.toBeInTheDocument();
  });

  it("scrolls the full location selector into view after scanning a bay", async () => {
    renderPutawayPage();

    await enterPallet("PLT-1");
    await closeLocationScanner();

    fireEvent.change(screen.getByPlaceholderText("Scan location barcode"), {
      target: { value: "BAY:WH-1:AMB:A1:B1" },
    });

    const selector = await screen.findByTestId("putaway-location-selector-task-1");
    expect(screen.getByRole("button", { name: /^cancel$/i })).toBeEnabled();
    await waitFor(() => expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "center" }));
    expect(vi.mocked(Element.prototype.scrollIntoView).mock.instances).toContain(selector);
    await waitFor(() => expect(vi.mocked(Element.prototype.scrollIntoView).mock.instances.filter((instance) => instance === selector)).toHaveLength(2));
  });

  it("scrolls the full location selector into view after choosing a bay", async () => {
    renderPutawayPage();

    await enterPallet("PLT-1");
    const scannerDialog = await screen.findByRole("dialog", { name: /scan location barcode/i });
    fireEvent.click(within(scannerDialog).getByRole("button", { name: /select location manually/i }));

    const bayDialog = await screen.findByRole("dialog", { name: /select a bay/i });
    fireEvent.click(await within(bayDialog).findByRole("button", { name: /A1-B1/i }));

    const selector = await screen.findByTestId("putaway-location-selector-task-1");
    await waitFor(() => expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "center" }));
    expect(vi.mocked(Element.prototype.scrollIntoView).mock.instances).toContain(selector);
    await waitFor(() => expect(vi.mocked(Element.prototype.scrollIntoView).mock.instances.filter((instance) => instance === selector)).toHaveLength(2));
  });

  it("keeps open tasks hidden after cancelling until the section is expanded", async () => {
    renderPutawayPage();

    const scanDialog = await openPalletDialog();
    fireEvent.click(within(scanDialog).getByRole("button", { name: /^cancel$/i }));

    expect(await screen.findByText("Scan a pallet to begin Put-Away")).toBeInTheDocument();
    expect(screen.queryByText(/SKU-1/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByText(/show 2 open put-away tasks/i));

    expect(await screen.findByText(/SKU-1/)).toBeInTheDocument();
    expect(screen.getByText(/SKU-2/)).toBeInTheDocument();
  });

  it("enables Cancel only while a task card has active local changes", async () => {
    renderPutawayPage();

    const scanDialog = await openPalletDialog();
    fireEvent.click(within(scanDialog).getByRole("button", { name: /^cancel$/i }));
    fireEvent.click(screen.getByText(/show 2 open put-away tasks/i));

    const firstPallet = (await screen.findAllByPlaceholderText("Scan pallet barcode"))[0];
    const firstCancel = screen.getAllByRole("button", { name: /^cancel$/i })[0];
    const firstLocation = screen.getAllByPlaceholderText("Scan location barcode")[0];

    expect(firstCancel).toBeDisabled();
    fireEvent.change(firstPallet, { target: { value: "PLT-1" } });
    expect(firstCancel).toBeEnabled();
    fireEvent.change(firstPallet, { target: { value: "" } });
    expect(firstCancel).toBeDisabled();
    fireEvent.change(firstLocation, { target: { value: "LOC-1" } });
    expect(firstCancel).toBeEnabled();
  });

  it("keeps batch return available while open tasks are hidden and selects every scoped task", async () => {
    renderPutawayPage();

    expect(screen.queryByText(/SKU-1/)).not.toBeInTheDocument();
    const dialog = await openBatchReturnDialog();
    const checkboxes = within(dialog).getAllByRole("checkbox");

    expect(within(dialog).getByText(/PLT-1 .* SKU-1/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/Task PTA-2 .* Qty 5/i)).toBeInTheDocument();
    expect(checkboxes).toHaveLength(2);
    expect(checkboxes.every((checkbox) => (checkbox as HTMLButtonElement).getAttribute("data-state") === "checked")).toBe(true);
  });

  it("lets operators select and deselect the batch return task list", async () => {
    renderPutawayPage();
    const dialog = await openBatchReturnDialog();

    fireEvent.click(within(dialog).getByRole("button", { name: /deselect all/i }));
    expect(within(dialog).getByRole("button", { name: /return selected as drafts/i })).toBeDisabled();
    expect(within(dialog).getAllByRole("checkbox").every((checkbox) => (checkbox as HTMLButtonElement).getAttribute("data-state") === "unchecked")).toBe(true);

    fireEvent.click(within(dialog).getByRole("button", { name: /select all shown/i }));
    expect(within(dialog).getByRole("button", { name: /return selected as drafts/i })).toBeEnabled();
    expect(within(dialog).getAllByRole("checkbox").every((checkbox) => (checkbox as HTMLButtonElement).getAttribute("data-state") === "checked")).toBe(true);
  });

  it("returns selected tasks as drafts without leaving Put-Away", async () => {
    const { invalidateSpy } = renderPutawayPage();
    const dialog = await openBatchReturnDialog();

    fireEvent.click(within(dialog).getByRole("button", { name: /return selected as drafts/i }));

    await waitFor(() => expect(wmsMocks.revertPutawayToDraft).toHaveBeenCalledTimes(2));
    expect(wmsMocks.revertPutawayToDraft).toHaveBeenCalledWith("task-1");
    expect(wmsMocks.revertPutawayToDraft).toHaveBeenCalledWith("task-2");
    await waitFor(() => expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["draft-receipts"] }));
    expect(screen.getByTestId("location")).toHaveTextContent("/");
  });

  it("returns selected tasks and opens Receiving when requested", async () => {
    renderPutawayPage();
    const dialog = await openBatchReturnDialog();

    fireEvent.click(within(dialog).getByRole("button", { name: /return selected & open receiving/i }));

    await waitFor(() => expect(wmsMocks.revertPutawayToDraft).toHaveBeenCalledTimes(2));
    expect(await screen.findByTestId("location")).toHaveTextContent("/receiving");
  });

  it("keeps failed batch returns selected for retry", async () => {
    wmsMocks.revertPutawayToDraft.mockImplementation(async (taskId: string) => {
      if (taskId === "task-2") throw new Error("Task is no longer open");
    });
    renderPutawayPage();
    const dialog = await openBatchReturnDialog();

    fireEvent.click(within(dialog).getByRole("button", { name: /return selected as drafts/i }));

    await waitFor(() => expect(wmsMocks.revertPutawayToDraft).toHaveBeenCalledTimes(2));
    expect(await within(dialog).findByText(/some tasks could not be returned/i)).toBeInTheDocument();
    expect(within(dialog).getAllByRole("checkbox")).toHaveLength(1);
    expect((within(dialog).getByRole("checkbox") as HTMLButtonElement).getAttribute("data-state")).toBe("checked");
    expect(within(dialog).getByText("Task is no longer open")).toBeInTheDocument();
  });

  it("shows a no-match error without revealing tasks", async () => {
    renderPutawayPage();

    await enterPallet("MISSING");

    expect(await screen.findByText(/No open Put-Away task found for pallet MISSING/)).toBeInTheDocument();
    expect(screen.queryByText(/SKU-1/)).not.toBeInTheDocument();
    expect(screen.queryByText(/SKU-2/)).not.toBeInTheDocument();
  });

  it("freezes confirmation while offline instead of queueing stale work", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    renderPutawayPage();

    await enterPallet("PLT-1");
    await closeLocationScanner();

    const locationInput = await screen.findByPlaceholderText("Scan location barcode");
    fireEvent.change(locationInput, { target: { value: "LOC-1" } });
    fireEvent.click(screen.getByRole("button", { name: /^Confirm Put-Away$/i }));

    await screen.findByText(/live put-away confirmations are frozen/i);
    expect(wmsMocks.confirmPutaway).not.toHaveBeenCalled();
  });

  it("clears the current task and invalidates warehouse data after confirm", async () => {
    const { invalidateSpy } = renderPutawayPage();

    await enterPallet("PLT-1");
    await closeLocationScanner();

    const locationInput = await screen.findByPlaceholderText("Scan location barcode");
    fireEvent.change(locationInput, { target: { value: "LOC-1" } });
    fireEvent.click(screen.getByRole("button", { name: /^Confirm Put-Away$/i }));

    await waitFor(() => expect(wmsMocks.confirmPutaway).toHaveBeenCalledWith("task-1", "PLT-1", "LOC-1", expect.any(Object)));
    await waitFor(() => expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["putaway-tasks"] }));
    expect(await screen.findByRole("button", { name: /^scan pallet$/i })).toBeInTheDocument();
    expect(screen.queryByText(/SKU-1/)).not.toBeInTheDocument();
  });

  it("cancels the current Put-Away flow without changing the warehouse task", async () => {
    setPointerCoarse(true);
    renderPutawayPage();

    await enterPallet("PLT-1");
    await closeLocationScanner();

    const cancelButton = await screen.findByRole("button", { name: /^cancel$/i });
    const confirmButton = screen.getByRole("button", { name: /^Confirm Put-Away$/i });

    expect(cancelButton.parentElement).toContainElement(confirmButton);
    expect(cancelButton).not.toHaveClass("w-full");
    expect(cancelButton).toHaveClass("bg-amber-400");
    fireEvent.click(cancelButton);

    expect(await screen.findByRole("button", { name: /^scan pallet$/i })).toBeInTheDocument();
    expect(screen.queryByText(/SKU-1/)).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: /scan pallet for put-away/i })).not.toBeInTheDocument();
    expect(wmsMocks.confirmPutaway).not.toHaveBeenCalled();
    expect(wmsMocks.revertPutawayToDraft).not.toHaveBeenCalled();
  });
});
