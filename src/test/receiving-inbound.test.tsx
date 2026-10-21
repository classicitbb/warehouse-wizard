// View inbound end to end on the Receiving page: browse a shipment, hand it to the New
// Shipment dialog, and save drafts that each carry their own PO.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ReceivingPage } from "@/components/wms-ui";
import { TooltipProvider } from "@/components/ui/tooltip";

const mocks = vi.hoisted(() => ({
  listDraftReceipts: vi.fn(async (): Promise<any[]> => []),
  saveShipmentDrafts: vi.fn(async () => ({ groupId: "shipment-1", draftIds: ["draft-1", "draft-2"], count: 2 })),
  toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() },
  invoke: vi.fn(),
  netsuiteActive: true,
  work: vi.fn(async (): Promise<any[]> => []),
}));

vi.mock("@/features/receiving/inbound-receiving-work", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/features/receiving/inbound-receiving-work")>();
  return { ...actual, listInboundReceivingWork: mocks.work };
});

// Only the edge-function call is faked; the rest of the client stays real.
vi.mock("@/integrations/supabase/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/integrations/supabase/client")>();
  const supabase = new Proxy(actual.supabase, {
    get: (target, prop, receiver) => (prop === "functions" ? { invoke: mocks.invoke } : Reflect.get(target, prop, receiver)),
  });
  return { ...actual, supabase };
});

vi.mock("sonner", async (importOriginal) => {
  const actual = await importOriginal<typeof import("sonner")>();
  const toast = Object.assign((...args: unknown[]) => (actual.toast as unknown as (...a: unknown[]) => unknown)(...args), actual.toast, mocks.toast);
  return { ...actual, toast };
});

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as any).ResizeObserver = ResizeObserverStub;
Element.prototype.scrollIntoView = vi.fn();

vi.mock("@/components/pallet-label-page", () => ({
  PalletLabelPage: ({ trigger }: { trigger?: React.ReactNode }) => (React.isValidElement(trigger) ? trigger : <button>Print label</button>),
  buildPalletLabelBatchPrintHtml: (labels: unknown[]) => `<html><body>${labels.length} labels</body></html>`,
}));

vi.mock("@/components/barcode-scan-button", () => ({
  BarcodeScanButton: ({ title }: { title?: string }) => <button type="button" aria-label={title}>{title}</button>,
}));

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ profile: { id: "user-1", default_warehouse_id: "wh-1" }, roles: ["warehouse_manager"] }),
}));

vi.mock("@/hooks/use-netsuite-active", () => ({
  NETSUITE_ACTIVE_QUERY_KEY: ["netsuite-integration-active"],
  useNetSuiteActive: () => mocks.netsuiteActive,
}));

vi.mock("@/hooks/use-network-status", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/use-network-status")>();
  return { ...actual, useNetworkStatus: () => ({ online: true }), assertOnline: () => undefined };
});

vi.mock("@/lib/ai-assist", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai-assist")>();
  return { ...actual, getProductPalletQtyHint: vi.fn(async () => null) };
});

vi.mock("@/lib/wms-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/wms-core")>();
  const fetchOptions = vi.fn(async () => ({
    warehouses: [{ id: "wh-1", name: "NEW - New Warehouse" }],
    clients: [{ id: "client-1", code: "RH", name: "Russell Hunte" }],
    products: [{ id: "prod-1", sku: "FLOUR", name: "Flour", barcode: "FLOUR" }],
    packagingProfiles: [],
  }));
  return {
    ...actual,
    fetchOptions,
    floorOptionsQuery: (...args: Parameters<typeof actual.floorOptionsQuery>) => ({ ...actual.floorOptionsQuery(...args), queryFn: fetchOptions }),
    listDraftReceipts: mocks.listDraftReceipts,
    saveShipmentDrafts: mocks.saveShipmentDrafts,
  };
});

const SHIPMENT = {
  id: "5", number: "ISH-0098", externalDocumentNumber: "MSKU1234565", billOfLading: "", vesselNumber: "",
  status: { code: "inTransit", label: "In Transit" }, expectedDeliveryDate: "2026-10-20", actualShippingDate: null,
  memo: "", poCount: 2, lineCount: 2, quantityExpected: 750,
};

const line = (id: string, key: string, expected: number) => ({
  shipmentLineId: id, lineKey: key, lineNumber: 1, itemId: "7", itemName: "Flour", description: "", quantityExpected: expected,
  quantityReceived: 0, quantityRemaining: expected, unit: null, location: null, localProductId: "prod-1",
});

const DETAIL = {
  shipmentId: "5",
  receivedKnown: true,
  pos: [
    { poId: "10", poNumber: "PO100", vendor: "Acme", lines: [line("1", "k1", 600)] },
    { poId: "11", poNumber: "PO200", vendor: "Beta", lines: [line("2", "k2", 150)] },
  ],
};

function mockNetSuite(overrides: { list?: unknown } = {}) {
  return mocks.invoke.mockImplementation((async (name: string, options?: { body?: Record<string, unknown> }) => {
    if (name !== "netsuite-inbound") return { data: null, error: null };
    const action = options?.body?.action;
    if (action === "list") return { data: overrides.list ?? { shipments: [SHIPMENT], hasMore: false }, error: null };
    if (action === "detail") return { data: { detail: DETAIL }, error: null };
    return { data: { shipments: [] }, error: null };
  }) as never);
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <MemoryRouter initialEntries={["/receiving"]}>
          <ReceivingPage />
        </MemoryRouter>
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

describe("Receiving > View inbound", () => {
  beforeEach(() => {
    mocks.invoke.mockReset();
    mocks.listDraftReceipts.mockReset();
    mocks.listDraftReceipts.mockResolvedValue([]);
    mocks.saveShipmentDrafts.mockClear();
    mocks.toast.error.mockClear();
    mocks.toast.warning.mockClear();
    mocks.netsuiteActive = true;
    mocks.work.mockReset();
    mocks.work.mockResolvedValue([]);
    window.localStorage.clear();
  });

  it("hides every NetSuite entry point when NetSuite is not set up", async () => {
    mocks.netsuiteActive = false;
    mockNetSuite();
    renderPage();

    expect(await screen.findByRole("button", { name: /print drafts/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /view inbound/i })).not.toBeInTheDocument();
    expect(mocks.invoke).not.toHaveBeenCalledWith("netsuite-inbound", expect.anything());
  });

  it("loads every PO's lines into the New Shipment dialog with the container, and saves each line under its own PO", async () => {
    mockNetSuite();
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: /view inbound/i }));
    const browser = await screen.findByRole("dialog", { name: /inbound shipments/i });
    expect(await within(browser).findByText("ISH-0098")).toBeInTheDocument();
    expect(within(browser).getByText(/Container MSKU1234565/)).toBeInTheDocument();

    fireEvent.click(within(browser).getByRole("button", { name: /receive this shipment/i }));

    const dialog = await screen.findByRole("dialog", { name: /new shipment/i });
    expect(within(dialog).getByLabelText("Container number")).toHaveValue("MSKU1234565");
    const chips = within(dialog).getByLabelText("Purchase orders on this shipment");
    expect(within(chips).getByText("ISH-0098")).toBeInTheDocument();
    expect(within(chips).getByText("PO PO100")).toBeInTheDocument();
    expect(within(chips).getByText("PO PO200")).toBeInTheDocument();
    expect(within(dialog).queryByLabelText("PO number")).not.toBeInTheDocument();
    expect(await within(dialog).findByText(/PO PO100 · shipment ISH-0098/)).toBeInTheDocument();

    const save = screen.getByRole("button", { name: /save & receive/i });
    await waitFor(() => expect(save).toBeEnabled());
    fireEvent.click(save);

    await waitFor(() => expect(mocks.saveShipmentDrafts).toHaveBeenCalledTimes(1));
    const saved = (mocks.saveShipmentDrafts.mock.calls[0] as unknown as [any])[0];
    expect(saved.container_number).toBe("MSKU1234565");
    expect(saved.reference_number).toBe("ISH-0098");
    expect(saved.lines.map((l: any) => [l.po_number, l.total_quantity])).toEqual([["PO100", 600], ["PO200", 150]]);
    expect(saved.lines[1].netsuite).toMatchObject({ lineKey: "k2", poId: "11", inboundShipmentId: "5", inboundShipmentNumber: "ISH-0098" });
  });

  it("receives one chosen container of a two-container shipment and says the lines cover both", async () => {
    mockNetSuite({ list: { shipments: [{ ...SHIPMENT, containers: ["SMLU7872173", "SMLU3120938"] }], hasMore: false, containerField: "custrecord_container_no" } });
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: /view inbound/i }));
    const browser = await screen.findByRole("dialog", { name: /inbound shipments/i });
    fireEvent.click(await within(browser).findByRole("button", { name: "Receive SMLU3120938" }));

    const dialog = await screen.findByRole("dialog", { name: /new shipment/i });
    expect(within(dialog).getByLabelText("Container number")).toHaveValue("SMLU3120938");
    expect(await within(dialog).findByText(/has 2 containers, and these lines cover all of them/)).toBeInTheDocument();
    expect(within(dialog).getByText(/container SMLU3120938/)).toBeInTheDocument();
  });

  it("blocks a second prefill while drafts for the container exist", async () => {
    mocks.listDraftReceipts.mockResolvedValue([
      { id: "d1", receipt_number: "RCT-1", receipt_type: "po", container_number: "MSKU1234565", po_number: "PO100", status: "draft", warehouse_id: "wh-1", notes: JSON.stringify({ _draft: true }) },
    ]);
    mockNetSuite();
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: /view inbound/i }));
    const browser = await screen.findByRole("dialog", { name: /inbound shipments/i });
   
    await within(browser).findByText("ISH-0098");
    await waitFor(() => expect(within(browser).getByText("Drafts in progress")).toBeInTheDocument());
    expect(within(browser).queryByRole("button", { name: /receive this shipment/i })).not.toBeInTheDocument();
    fireEvent.click(within(browser).getByRole("button", { name: /show drafts/i }));
    await waitFor(() => expect(screen.getByPlaceholderText(/search container, po/i)).toHaveValue("MSKU1234565"));
  });

  it("blocks an inbound container whose dock receipts are in Put-Away", async () => {
    mocks.work.mockResolvedValue([{ id: "r1", container_number: "MSKU1234565", notes: JSON.stringify({ netsuite: { inboundShipmentId: "5" } }), stage: "putaway" }]);
    mockNetSuite();
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: /view inbound/i }));
    const browser = await screen.findByRole("dialog", { name: /inbound shipments/i });
    expect(await within(browser).findByText("In Put-Away")).toBeInTheDocument();
    expect(within(browser).queryByRole("button", { name: /receive this shipment/i })).not.toBeInTheDocument();
    expect(mocks.saveShipmentDrafts).not.toHaveBeenCalled();
  });

  it("rechecks work when Receive is clicked instead of trusting an earlier empty list", async () => {
    mocks.work.mockResolvedValueOnce([]).mockResolvedValue([{ id: "r1", container_number: "MSKU1234565", notes: null, stage: "putaway" }]);
    mockNetSuite();
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: /view inbound/i }));
    const browser = await screen.findByRole("dialog", { name: /inbound shipments/i });
    const receive = await within(browser).findByRole("button", { name: /receive this shipment/i });
    await waitFor(() => expect(receive).toBeEnabled());
    fireEvent.click(receive);
    await waitFor(() => expect(mocks.toast.error).toHaveBeenCalledWith(expect.stringContaining("already in Put-Away")));
    expect(screen.queryByRole("dialog", { name: /new shipment/i })).not.toBeInTheDocument();
  });
});
