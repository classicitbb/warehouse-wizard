import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { StatusPage } from "@/components/wms-ui";
import { TooltipProvider } from "@/components/ui/tooltip";

const statusMocks = vi.hoisted(() => ({
  listStatusPallets: vi.fn(async (): Promise<any[]> => []),
  changePalletStatus: vi.fn(async () => undefined),
  recoverMissingPalletToPutaway: vi.fn(async () => ({
    palletId: "pallet-1",
    palletBarcode: "PLT-51699909EFTV",
    putawayTaskId: "task-1",
    putawayTaskNumber: "PTA-1",
  })),
  recoverMissingPalletToDraft: vi.fn(async () => ({
    draftId: "draft-1",
    draftPalletBarcode: "PLT-NEW",
    quantity: 40,
  })),
}));

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as any).ResizeObserver = ResizeObserverStub;
Element.prototype.scrollIntoView = vi.fn();

const dbRows = vi.hoisted(() => ({ value: [] as any[] }));

vi.mock("@/features/shared/core-types", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/features/shared/core-types")>();
  return {
    ...actual,
    db: (table: string) => {
      if (table !== "inventory_search_view") return (actual as any).db(table);
      const builder: any = {
        select: () => builder,
        in: () => builder,
        order: async () => ({ data: dbRows.value, error: null }),
      };
      return builder;
    },
  };
});

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ roles: ["warehouse_manager"], profile: { id: "user-1", default_warehouse_id: "wh-1" } }),
}));

vi.mock("@/hooks/use-network-status", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/use-network-status")>();
  return { ...actual, useNetworkStatus: () => ({ online: true }) };
});

vi.mock("@/lib/wms-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/wms-core")>();
  return { ...actual, ...statusMocks };
});

vi.mock("@/components/barcode-scan-button", () => ({
  BarcodeScanButton: ({ onScan, title }: { onScan: (value: string) => void; title: string }) => (
    <button type="button" onClick={() => onScan(" plt-51699909eftv ")}>{title}</button>
  ),
}));

const missingNoLocation = {
  inventory_balance_id: "balance-1",
  pallet_id: "pallet-1",
  pallet_code: "PLT-51699909EFTV",
  sku: "PPIHC12",
  status: "missing",
  location_code: null,
};

describe("listStatusPallets", () => {
  it("drops superseded pallets from controlled stock", async () => {
    const core = await vi.importActual<typeof import("@/features/status/status-core")>("@/features/status/status-core");
    const rows = [
      { inventory_balance_id: "b1", status: "missing", correction_state: null, pallet_correction_state: null, location_code: null },
      { inventory_balance_id: "b2", status: "missing", correction_state: "superseded", pallet_correction_state: null, location_code: null },
      { inventory_balance_id: "b3", status: "missing", correction_state: null, pallet_correction_state: "superseded", location_code: null },
    ];
    dbRows.value = rows;

    const result = await core.listStatusPallets();

    expect(result.map((row: any) => row.inventory_balance_id)).toEqual(["b1"]);
  });
});

describe("StatusPage controlled stock", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    statusMocks.listStatusPallets.mockResolvedValue([missingNoLocation]);
  });

  function renderStatusPage() {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <MemoryRouter initialEntries={["/status"]}>
            <StatusPage />
          </MemoryRouter>
        </TooltipProvider>
      </QueryClientProvider>,
    );
  }

  async function openFoundDialog() {
    renderStatusPage();
    fireEvent.click(await screen.findByRole("button", { name: /^found$/i }));
    return await screen.findByRole("dialog", { name: /found plt-51699909eftv/i });
  }

  it("offers Found only for a missing pallet that has no location", async () => {
    statusMocks.listStatusPallets.mockResolvedValue([
      missingNoLocation,
      { ...missingNoLocation, inventory_balance_id: "balance-2", pallet_code: "PLT-2", location_code: "A-01-L01-P1" },
      { ...missingNoLocation, inventory_balance_id: "balance-3", pallet_code: "PLT-3", status: "hold" },
    ]);
    renderStatusPage();

    await screen.findByText("PLT-51699909EFTV · No location");
    expect(screen.getAllByRole("button", { name: /^found$/i })).toHaveLength(1);
  });

  it("uses the shared pallet-code normalizer for typed and camera-scanned values", async () => {
    renderStatusPage();

    const input = screen.getByLabelText("Pallet barcode or ID");
    fireEvent.change(input, { target: { value: " plt-typed 01 " } });
    expect(input).toHaveValue("PLT-TYPED01");

    fireEvent.click(screen.getByRole("button", { name: "Scan pallet barcode" }));
    await waitFor(() => expect(input).toHaveValue("PLT-51699909EFTV"));
    expect(input).not.toBeDisabled();
    expect(input).not.toHaveAttribute("readonly");
  });

  it("sends a found pallet to Put-Away under its own number", async () => {
    const dialog = await openFoundDialog();

    expect(dialog).toHaveTextContent("PLT-51699909EFTV");
    fireEvent.click(within(dialog).getByRole("button", { name: /send to put-away/i }));

    await waitFor(() => expect(statusMocks.recoverMissingPalletToPutaway).toHaveBeenCalledWith("balance-1"));
    expect(statusMocks.recoverMissingPalletToDraft).not.toHaveBeenCalled();
  });

  it("returns a found pallet to drafts when it needs re-labelling", async () => {
    const dialog = await openFoundDialog();

    fireEvent.click(within(dialog).getByRole("button", { name: /save as draft/i }));

    await waitFor(() => expect(statusMocks.recoverMissingPalletToDraft).toHaveBeenCalledWith("balance-1"));
    expect(statusMocks.recoverMissingPalletToPutaway).not.toHaveBeenCalled();
  });
});
