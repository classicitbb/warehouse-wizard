import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { InboundBrowserDialog } from "@/features/receiving/inbound-browser-dialog";
import type { InboundShipmentDetail, InboundShipmentSummary } from "@/features/receiving/netsuite-inbound";

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  detail: vi.fn(),
}));

// Mock at the Supabase boundary so the module's own detail query goes through the same fake.
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: {
      invoke: async (_name: string, { body }: { body: Record<string, unknown> }) => ({
        data: body.action === "list" ? await mocks.list(body) : await mocks.detail(body),
        error: null,
      }),
    },
  },
}));

vi.mock("@/components/barcode-scan-button", () => ({
  BarcodeScanButton: ({ title, onScan }: { title?: string; onScan: (value: string) => void }) => (
    <button type="button" aria-label={title} onClick={() => onScan("MSKU 1234565")}>{title}</button>
  ),
}));

const shipment = (over: Partial<InboundShipmentSummary>): InboundShipmentSummary => ({
  id: "5", number: "ISH-0098", containers: [], externalDocumentNumber: "MSKU1234565", billOfLading: "", vesselNumber: "",
  status: { code: "inTransit", label: "In Transit" }, expectedDeliveryDate: "2026-10-20", actualShippingDate: null,
  memo: "", poCount: 2, lineCount: 3, quantityExpected: 750, ...over,
});

const detail: InboundShipmentDetail = {
  shipmentId: "5",
  receivedKnown: true,
  pos: [
    { poId: "10", poNumber: "PO100", vendor: "Acme", lines: [{ shipmentLineId: "1", lineKey: "k1", lineNumber: 1, itemId: "7", itemName: "Lens A", description: "", quantityExpected: 600, quantityReceived: 0, quantityRemaining: 600, unit: "EA", location: null, localProductId: "p-1" }] },
    { poId: "11", poNumber: "PO200", vendor: "Beta", lines: [{ shipmentLineId: "2", lineKey: "k2", lineNumber: 1, itemId: "8", itemName: "Lens B", description: "", quantityExpected: 150, quantityReceived: 0, quantityRemaining: 150, unit: null, location: null, localProductId: null }] },
  ],
};

function renderDialog(props: Partial<React.ComponentProps<typeof InboundBrowserDialog>> = {}) {
  const onReceive = vi.fn(() => true);
  const onOpenChange = vi.fn();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <InboundBrowserDialog
        open
        onOpenChange={onOpenChange}
        online
        initialSearch=""
        drafts={[]}
        onReceive={onReceive}
        onShowDrafts={vi.fn()}
        {...props}
      />
    </QueryClientProvider>,
  );
  return { onReceive, onOpenChange };
}

describe("InboundBrowserDialog", () => {
  beforeEach(() => {
    mocks.list.mockReset();
    mocks.detail.mockReset();
    mocks.list.mockResolvedValue({ shipments: [shipment({}), shipment({ id: "6", number: "ISH-0099", externalDocumentNumber: "TEMU6543210" })], hasMore: false });
    mocks.detail.mockResolvedValue({ detail });
  });

  it("lists ready-to-receive shipments by default, soonest first", async () => {
    renderDialog();
    expect(await screen.findByText("ISH-0098")).toBeInTheDocument();
    expect(screen.getByText("ISH-0099")).toBeInTheDocument();
    expect(mocks.list).toHaveBeenCalledWith(expect.objectContaining({ status: "open", sort: "expected_delivery", direction: "asc", search: "" }));
    expect(screen.getByRole("button", { name: "Ready to receive" })).toHaveAttribute("aria-pressed", "true");
  });

  it("searches after a pause and keeps the typed term in the request", async () => {
    renderDialog();
    await screen.findByText("ISH-0098");
    fireEvent.change(screen.getByLabelText("Search inbound shipments"), { target: { value: "PO200" } });
    await waitFor(() => expect(mocks.list).toHaveBeenCalledWith(expect.objectContaining({ search: "PO200" })), { timeout: 2000 });
  });

  it("starts from the search it was opened with", async () => {
    renderDialog({ initialSearch: "ISH-0098" });
    await waitFor(() => expect(mocks.list).toHaveBeenCalledWith(expect.objectContaining({ search: "ISH-0098" })));
  });

  it("switches the status filter and the sort direction", async () => {
    renderDialog();
    await screen.findByText("ISH-0098");
    fireEvent.click(screen.getByRole("button", { name: "All" }));
    await waitFor(() => expect(mocks.list).toHaveBeenCalledWith(expect.objectContaining({ status: "all" })));
    fireEvent.click(screen.getByRole("button", { name: /Sorted ascending/ }));
    await waitFor(() => expect(mocks.list).toHaveBeenCalledWith(expect.objectContaining({ direction: "desc" })));
  });

  it("previews every PO and item when a shipment is opened, flagging items not imported", async () => {
    renderDialog();
    fireEvent.click((await screen.findByText("ISH-0098")).closest("button")!);
    expect(await screen.findByText(/PO PO100/)).toBeInTheDocument();
    expect(screen.getByText(/PO PO200/)).toBeInTheDocument();
    expect(screen.getByText("Lens A")).toBeInTheDocument();
    expect(screen.getByText(/item not imported/)).toBeInTheDocument();
  });

  it("hands the shipment and its detail to the form, then closes", async () => {
    const { onReceive, onOpenChange } = renderDialog();
    await screen.findByText("ISH-0098");
    fireEvent.click(screen.getAllByRole("button", { name: /Receive this shipment/ })[0]);
    await waitFor(() => expect(onReceive).toHaveBeenCalledWith(expect.objectContaining({ id: "5" }), detail, "MSKU1234565"));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("stays open when the form could not take the shipment", async () => {
    const onReceive = vi.fn(() => false);
    const { onOpenChange } = renderDialog({ onReceive });
    await screen.findByText("ISH-0098");
    fireEvent.click(screen.getAllByRole("button", { name: /Receive this shipment/ })[0]);
    await waitFor(() => expect(onReceive).toHaveBeenCalled());
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("blocks a second prefill when drafts already stand for the shipment", async () => {
    const onShowDrafts = vi.fn();
    const { onReceive } = renderDialog({
      drafts: [{ container_number: "msku1234565", notes: null }],
      onShowDrafts,
    });
    await screen.findByText("ISH-0098");
    expect(screen.getByText("Drafts in progress")).toBeInTheDocument();
    // ISH-0099 has a different container, so it can still be received.
    expect(screen.getAllByRole("button", { name: /Receive this shipment/ })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: /Show drafts \(1\)/ }));
    expect(onShowDrafts).toHaveBeenCalledWith(expect.objectContaining({ id: "5" }), "MSKU1234565");
    expect(onReceive).not.toHaveBeenCalled();
  });

  it("offers one Receive button per container on a multi-container shipment, and passes the chosen one", async () => {
    mocks.list.mockResolvedValue({ shipments: [shipment({ containers: ["SMLU7872173", "SMLU3120938"] })], hasMore: false, containerField: "custrecord_container_no" });
    const { onReceive } = renderDialog();
    expect(await screen.findByText(/Containers SMLU7872173, SMLU3120938/)).toBeInTheDocument();
    expect(screen.getByText(/has 2 containers/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Receive SMLU3120938" }));
    await waitFor(() => expect(onReceive).toHaveBeenCalledWith(expect.objectContaining({ id: "5" }), detail, "SMLU3120938"));
  });

  it("blocks just the container that already has drafts", async () => {
    mocks.list.mockResolvedValue({ shipments: [shipment({ containers: ["SMLU7872173", "SMLU3120938"] })], hasMore: false, containerField: "custrecord_container_no" });
    renderDialog({ drafts: [{ container_number: "SMLU7872173", notes: null }] });
    await screen.findByText(/Containers SMLU7872173/);
    expect(screen.getByRole("button", { name: /SMLU7872173: Show drafts \(1\)/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Receive SMLU3120938" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Receive SMLU7872173" })).not.toBeInTheDocument();
  });

  it("says nothing about NetSuite's container field, which the browser no longer needs", async () => {
    mocks.list.mockResolvedValue({ shipments: [shipment({})], hasMore: false, containerField: null });
    renderDialog();
    expect(await screen.findByText("ISH-0098")).toBeInTheDocument();
    expect(screen.queryByText(/Container No field was not found/)).not.toBeInTheDocument();
  });

  it("says how many shipments are shown and whether more can be loaded", async () => {
    mocks.list.mockResolvedValue({ shipments: [shipment({})], hasMore: true });
    renderDialog();
    expect(await screen.findByText(/1 shown · more available/)).toBeInTheDocument();
  });

  it("says so when nothing matches, and offers All", async () => {
    mocks.list.mockResolvedValue({ shipments: [], hasMore: false });
    renderDialog({ initialSearch: "ZZZ" });
    expect(await screen.findByText(/No inbound shipments match "ZZZ"/)).toBeInTheDocument();
    expect(screen.getByText(/Try All/)).toBeInTheDocument();
  });

  it("shows the NetSuite message when it is unavailable, and does not call it offline", async () => {
    mocks.list.mockResolvedValue({ unavailable: true, message: "NetSuite is not configured" });
    renderDialog();
    expect(await screen.findByText("NetSuite is not configured")).toBeInTheDocument();
  });

  it("does not query NetSuite while offline", () => {
    renderDialog({ online: false });
    expect(screen.getByText(/Connect to the network/)).toBeInTheDocument();
    expect(mocks.list).not.toHaveBeenCalled();
  });
});
