import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PutawayTasksPage } from "@/components/wms-ui";

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
  ]),
  getBayOccupancy: vi.fn(async () => ({ aisle: "A1", bay: "B1", cells: [] })),
  getBinOccupancy: vi.fn(async () => ({ locationCode: "LOC-1", occupiedPallets: 0, maxPallets: 2 })),
  logPutawayBaySelection: vi.fn(async () => undefined),
  confirmPutaway: vi.fn(async () => undefined),
  revertPutawayToDraft: vi.fn(async () => undefined),
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
    vi.clearAllMocks();
    window.localStorage.clear();
    setPointerCoarse(false);
    wmsMocks.getPutawayTasks.mockResolvedValue(openTasks);
    wmsMocks.getPutawayTaskHistory.mockResolvedValue([]);
    wmsMocks.confirmPutaway.mockResolvedValue(undefined);
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
          <PutawayTasksPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    return { queryClient, invalidateSpy };
  }

  async function enterPallet(value: string) {
    const input = await screen.findByLabelText("Pallet number");
    fireEvent.change(input, { target: { value } });
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });
  }

  it("opens the pallet scan dialog by default", async () => {
    renderPutawayPage();

    expect(await screen.findByRole("dialog", { name: /scan pallet for put-away/i })).toBeInTheDocument();
    expect(screen.getByLabelText("Pallet number")).toHaveFocus();
  });

  it("shows the idle scan glow until pallet input begins", async () => {
    renderPutawayPage();

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

  it("reveals only the matching task and opens the bay selector", async () => {
    renderPutawayPage();

    await enterPallet("PLT-1");

    expect(await screen.findByRole("dialog", { name: /select a bay/i })).toBeInTheDocument();
    expect(screen.getByText(/SKU-1/)).toBeInTheDocument();
    expect(screen.queryByText(/SKU-2/)).not.toBeInTheDocument();
  });

  it("keeps the selected task active when the bay selector is closed", async () => {
    renderPutawayPage();

    await enterPallet("PLT-1");
    const bayDialog = await screen.findByRole("dialog", { name: /select a bay/i });
    fireEvent.click(within(bayDialog).getByRole("button", { name: /close/i }));

    expect(await screen.findByText(/SKU-1/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByPlaceholderText("Scan location barcode")).toHaveFocus());
  });

  it("keeps open tasks hidden after cancelling until the section is expanded", async () => {
    renderPutawayPage();

    const scanDialog = await screen.findByRole("dialog", { name: /scan pallet for put-away/i });
    fireEvent.click(within(scanDialog).getByRole("button", { name: /^cancel$/i }));

    expect(await screen.findByText("Scan a pallet to begin Put-Away")).toBeInTheDocument();
    expect(screen.queryByText(/SKU-1/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByText(/show 2 open put-away tasks/i));

    expect(await screen.findByText(/SKU-1/)).toBeInTheDocument();
    expect(screen.getByText(/SKU-2/)).toBeInTheDocument();
  });

  it("shows a no-match error without revealing tasks", async () => {
    renderPutawayPage();

    await enterPallet("MISSING");

    expect(await screen.findByText(/No open Put-Away task found for pallet MISSING/)).toBeInTheDocument();
    expect(screen.queryByText(/SKU-1/)).not.toBeInTheDocument();
    expect(screen.queryByText(/SKU-2/)).not.toBeInTheDocument();
  });

  it("clears the current task and invalidates warehouse data after confirm", async () => {
    const { invalidateSpy } = renderPutawayPage();

    await enterPallet("PLT-1");
    const bayDialog = await screen.findByRole("dialog", { name: /select a bay/i });
    fireEvent.click(within(bayDialog).getByRole("button", { name: /close/i }));

    const locationInput = await screen.findByPlaceholderText("Scan location barcode");
    fireEvent.change(locationInput, { target: { value: "LOC-1" } });
    fireEvent.click(screen.getByRole("button", { name: /^Confirm Put-Away$/i }));

    await waitFor(() => expect(wmsMocks.confirmPutaway).toHaveBeenCalledWith("task-1", "PLT-1", "LOC-1", expect.any(Object)));
    await waitFor(() => expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["putaway-tasks"] }));
    expect(await screen.findByRole("dialog", { name: /scan pallet for put-away/i })).toBeInTheDocument();
    expect(screen.queryByText(/SKU-1/)).not.toBeInTheDocument();
  });
});
