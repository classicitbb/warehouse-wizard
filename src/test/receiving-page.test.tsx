import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ReceivingPage } from "@/components/wms-ui";
import { TooltipProvider } from "@/components/ui/tooltip";

const wmsMocks = vi.hoisted(() => {
  const draft = {
    id: "draft-1",
    receipt_number: "RCT-1",
    receipt_type: "po",
    reference_number: "PO-1",
    container_number: "MSKU1234565",
    po_number: "PO-1",
    draft_group_id: "shipment-1",
    draft_pallet_barcode: "PLT-1",
    draft_sequence: 1,
    draft_count: 1,
    warehouse_id: "wh-1",
    client_id: "client-1",
    status: "draft",
    product_id: "prod-1",
    quantity: 1,
    expiry_date: null,
    lot_number: null,
    batch_number: null,
    created_at: "2026-06-05T00:00:00.000Z",
    notes: JSON.stringify({ _draft: true, product_id: "prod-1", quantity: 1, draft_pallet_barcode: "PLT-1", container_number: "MSKU1234565", po_number: "PO-1" }),
    source_label: null,
  };
  return {
    draft,
    listDraftReceipts: vi.fn(async () => []),
    saveShipmentDrafts: vi.fn(async () => ({ groupId: "shipment-1", draftIds: ["draft-1"], count: 1 })),
    updateDraftReceipt: vi.fn(async () => undefined),
    completeReceiptFromDraft: vi.fn(async () => ({ palletBarcode: "PLT-1", putawayTaskNumber: "PTA-1" })),
  };
});

type PalletQtyHintResult = { suggestedQty: number; confidence: number; sampleCount: number } | null;
const aiMocks = vi.hoisted(() => ({
  getProductPalletQtyHint: vi.fn(
    async (_productId: string, _warehouseId?: string | null): Promise<{ suggestedQty: number; confidence: number; sampleCount: number } | null> => null,
  ),
}));
const networkState = vi.hoisted(() => ({ online: true }));

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as any).ResizeObserver = ResizeObserverStub;
Element.prototype.scrollIntoView = vi.fn();

vi.mock("@/components/pallet-label-page", () => ({
  PalletLabelPage: ({ trigger, onPrinted }: { trigger?: React.ReactNode; onPrinted?: () => void }) => {
    const element = React.isValidElement(trigger) ? trigger : <button>Print label</button>;
    return React.cloneElement(element as React.ReactElement<any>, {
      onClick: () => onPrinted?.(),
    });
  },
}));

vi.mock("@/components/barcode-scan-button", () => ({
  BarcodeScanButton: ({ title, buttonLabel, onScan }: { title?: string; buttonLabel?: string; onScan: (value: string) => void }) => (
    <button type="button" aria-label={title} onClick={() => onScan(title === "Scan product" ? "FLOUR" : "MSKU 1234565")}>
      {buttonLabel ?? title}
    </button>
  ),
}));

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({
    profile: { id: "user-1", default_warehouse_id: "wh-1" },
    roles: ["warehouse_manager"],
  }),
}));

vi.mock("@/hooks/use-network-status", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/use-network-status")>();
  return {
    ...actual,
    useNetworkStatus: () => ({ online: networkState.online }),
    assertOnline: () => {
      if (!networkState.online) {
        throw new Error(actual.OFFLINE_WORK_MESSAGE);
      }
    },
  };
});

vi.mock("@/lib/ai-assist", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai-assist")>();
  return {
    ...actual,
    getProductPalletQtyHint: aiMocks.getProductPalletQtyHint,
  };
});

vi.mock("@/lib/wms-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/wms-core")>();
  return {
    ...actual,
    fetchOptions: vi.fn(async () => ({
      warehouses: [{ id: "wh-1", name: "NEW - New Warehouse" }],
      clients: [{ id: "client-1", code: "RH", name: "Russell Hunte" }],
      products: [{ id: "prod-1", sku: "FLOUR", name: "Flour", barcode: "FLOUR" }],
      packagingProfiles: [],
    })),
    listDraftReceipts: wmsMocks.listDraftReceipts,
    saveShipmentDrafts: wmsMocks.saveShipmentDrafts,
    updateDraftReceipt: wmsMocks.updateDraftReceipt,
    completeReceiptFromDraft: wmsMocks.completeReceiptFromDraft,
  };
});

describe("ReceivingPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    networkState.online = true;
    wmsMocks.listDraftReceipts.mockResolvedValue([]);
    aiMocks.getProductPalletQtyHint.mockResolvedValue(null);
    window.localStorage.clear();
  });

  function renderReceivingPage() {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <MemoryRouter>
            <ReceivingPage />
          </MemoryRouter>
        </TooltipProvider>
      </QueryClientProvider>,
    );
    return queryClient;
  }

  async function openShipmentDialog(mode: "shipment" | "pallet" = "shipment") {
    const trigger = await screen.findByRole("button", { name: /^new$/i });
    fireEvent.pointerDown(trigger);
    fireEvent.mouseDown(trigger);
    fireEvent.click(trigger);
    const item = await screen.findByText(mode === "shipment" ? /new shipment/i : /new pallet/i);
    fireEvent.click(item);
    return await screen.findByRole("dialog");
  }

  async function selectFlourProduct(dialog: HTMLElement) {
    fireEvent.click(within(dialog).getByRole("combobox", { name: /select sku|FLOUR/i }));
    const productOption = await screen.findByRole("option", { name: /FLOUR.*Flour/i });
    fireEvent.click(productOption);
  }

  it("opens the new shipment modal with visible form content", async () => {
    renderReceivingPage();

    const dialog = await openShipmentDialog();

    expect(dialog).toBeInTheDocument();
    expect(screen.getByText("New Shipment")).toBeInTheDocument();
    expect(screen.getByText("Container number")).toBeInTheDocument();
    expect(screen.getByText("SKU line 1")).toBeInTheDocument();
  });

  it("shows tappable hint buttons next to receiving section titles", async () => {
    renderReceivingPage();

    expect(await screen.findByRole("button", { name: "Receiving hints" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Draft Pallets hints" })).toBeInTheDocument();
  });

  it("focuses container first, advances to PO, then opens product search on PO Enter", async () => {
    renderReceivingPage();

    const dialog = await openShipmentDialog();
    const containerInput = within(dialog).getByLabelText("Container number");
    const poInput = within(dialog).getByLabelText("PO number");

    await waitFor(() => expect(containerInput).toHaveFocus());

    fireEvent.change(containerInput, { target: { value: "MSKU1234565" } });
    await waitFor(() => expect(poInput).toHaveFocus());

    fireEvent.keyDown(poInput, { key: "Enter", code: "Enter" });
    expect(await screen.findByPlaceholderText(/type sku, name, or scan barcode/i)).toBeInTheDocument();
  });

  it("places the container scanner left of the input and scan inserts then focuses PO", async () => {
    renderReceivingPage();

    const dialog = await openShipmentDialog();
    const scanButton = within(dialog).getByRole("button", { name: "Scan container number" });
    const containerInput = within(dialog).getByLabelText("Container number");
    const poInput = within(dialog).getByLabelText("PO number");

    expect(scanButton).toHaveTextContent("Scan container number");
    expect(Boolean(scanButton.compareDocumentPosition(containerInput) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);

    fireEvent.click(scanButton);

    await waitFor(() => expect(containerInput).toHaveDisplayValue("MSKU1234565"));
    await waitFor(() => expect(poInput).toHaveFocus());
  });

  it("places the product scanner left of product search", async () => {
    renderReceivingPage();

    const dialog = await openShipmentDialog();
    const scanButton = within(dialog).getByRole("button", { name: "Scan product" });
    const productSearch = within(dialog).getByRole("combobox", { name: /select sku/i });

    expect(Boolean(scanButton.compareDocumentPosition(productSearch) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
  });

  it("waits for the product commit arrow before moving to Total received", async () => {
    renderReceivingPage();

    const dialog = await openShipmentDialog();
    await waitFor(() => expect(within(dialog).getByLabelText("Container number")).toHaveFocus());
    await selectFlourProduct(dialog);

    const totalInput = within(dialog).getByLabelText("Total received");
    const commitButton = within(dialog).getByRole("button", { name: /commit product and move to total received/i });
    expect(totalInput).not.toHaveFocus();
    await waitFor(() => expect(commitButton).toHaveFocus());
    expect(commitButton).toHaveAttribute("data-pending-commit", "true");

    fireEvent.click(commitButton);
    await waitFor(() => expect(totalInput).toHaveFocus());
    expect(commitButton).toHaveAttribute("data-pending-commit", "false");
  });

  it("collapses a completed shipment SKU line when adding the next line and reopens it for editing", async () => {
    renderReceivingPage();
    const dialog = await openShipmentDialog();
    await selectFlourProduct(dialog);

    fireEvent.click(within(dialog).getByRole("button", { name: /add sku line/i }));

    await waitFor(() => expect(Element.prototype.scrollIntoView).toHaveBeenCalled());
    expect(within(dialog).getByText("SKU line 1")).toBeInTheDocument();
    expect(within(dialog).getByText("Flour")).toBeInTheDocument();
    expect(within(dialog).getByText("SKU FLOUR")).toBeInTheDocument();
    expect(within(dialog).getByText("Total 1")).toBeInTheDocument();
    expect(within(dialog).getByText("Per pallet 1")).toBeInTheDocument();
    expect(within(dialog).getByText("Pallets 1")).toBeInTheDocument();
    expect(within(dialog).getByText("SKU line 2")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: /edit sku line 1/i })).toBeInTheDocument();

    const scrollCallsBeforeEdit = vi.mocked(Element.prototype.scrollIntoView).mock.calls.length;
    fireEvent.click(within(dialog).getByRole("button", { name: /edit sku line 1/i }));

    expect(await within(dialog).findAllByRole("button", { name: /reset sku line/i })).toHaveLength(2);
    await waitFor(() => expect(vi.mocked(Element.prototype.scrollIntoView).mock.calls.length).toBeGreaterThan(scrollCallsBeforeEdit));
  });

  it("uses the same compact SKU-line handoff in standalone pallet mode", async () => {
    renderReceivingPage();
    const dialog = await openShipmentDialog("pallet");
    await selectFlourProduct(dialog);

    fireEvent.click(within(dialog).getByRole("button", { name: /add sku line/i }));

    expect(within(dialog).getByText("SKU line 1")).toBeInTheDocument();
    expect(within(dialog).getByText("Flour")).toBeInTheDocument();
    expect(within(dialog).getByText("SKU line 2")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: /edit sku line 1/i })).toBeInTheDocument();
  });

  it("uses arrow keys to move through the SKU line fields", async () => {
    renderReceivingPage();

    const dialog = await openShipmentDialog();
    await selectFlourProduct(dialog);

    const totalInput = within(dialog).getByLabelText("Total received");
    const perPalletInput = within(dialog).getByLabelText("Qty per pallet");
    const commitButton = within(dialog).getByRole("button", { name: /commit product and move to total received/i });

    fireEvent.click(commitButton);
    await waitFor(() => expect(totalInput).toHaveFocus());

    fireEvent.keyDown(totalInput, { key: "ArrowRight", code: "ArrowRight" });
    await waitFor(() => expect(perPalletInput).toHaveFocus());
  });

  it("recalculates pallet count immediately while typing qty per pallet", async () => {
    renderReceivingPage();

    const dialog = await openShipmentDialog();
    await selectFlourProduct(dialog);

    const totalInput = within(dialog).getByLabelText("Total received");
    const perPalletInput = within(dialog).getByLabelText("Qty per pallet");
    const palletsInput = within(dialog).getByLabelText("Pallets");

    fireEvent.change(totalInput, { target: { value: "1000" } });
    fireEvent.change(perPalletInput, { target: { value: "5" } });
    expect(palletsInput).toHaveDisplayValue("200");

    fireEvent.change(perPalletInput, { target: { value: "50" } });
    expect(palletsInput).toHaveDisplayValue("20");
  });

  it("keeps the lot, batch, and packaging collapse out of tab order", async () => {
    renderReceivingPage();

    const dialog = await openShipmentDialog();
    const detailsTrigger = within(dialog).getByRole("button", { name: /lot, batch, and packaging/i });
    expect(detailsTrigger).toHaveAttribute("tabindex", "-1");

    fireEvent.click(detailsTrigger);

    expect(within(dialog).getByLabelText("Lot")).toHaveAttribute("tabindex", "-1");
    expect(within(dialog).getByLabelText("Batch")).toHaveAttribute("tabindex", "-1");
    expect(within(dialog).getByLabelText("Packaging")).toHaveAttribute("tabindex", "-1");
  });

  it("product scan selects product and focuses the highlighted commit arrow", async () => {
    renderReceivingPage();

    const dialog = await openShipmentDialog();
    fireEvent.click(within(dialog).getByRole("button", { name: "Scan product" }));

    const commitButton = within(dialog).getByRole("button", { name: /commit product and move to total received/i });
    await waitFor(() => expect(commitButton).toHaveFocus());
    expect(commitButton).toHaveAttribute("data-pending-commit", "true");
  });

  it("lets operators type multi-digit quantities without resetting to one", async () => {
    renderReceivingPage();

    const dialog = await openShipmentDialog();
    const totalInput = within(dialog).getByLabelText("Total received");
    const perPalletInput = within(dialog).getByLabelText("Qty per pallet");

    fireEvent.change(totalInput, { target: { value: "" } });
    expect(totalInput).toHaveDisplayValue("");

    fireEvent.change(totalInput, { target: { value: "100" } });
    expect(totalInput).toHaveDisplayValue("100");
    expect(perPalletInput).toHaveDisplayValue("1");

    fireEvent.keyDown(totalInput, { key: "Enter", code: "Enter" });
    await waitFor(() => expect(perPalletInput).toHaveFocus());
  });

  it("prefills learned quantity per pallet after one prior product observation", async () => {
    aiMocks.getProductPalletQtyHint.mockResolvedValueOnce({ suggestedQty: 24, confidence: 0.05, sampleCount: 1 });
    renderReceivingPage();

    const dialog = await openShipmentDialog();
    await selectFlourProduct(dialog);

    await waitFor(() => expect(within(dialog).getByLabelText("Qty per pallet")).toHaveDisplayValue("24"));
    expect(within(dialog).getByText("Suggested from 1 prior pallet.")).toBeInTheDocument();
  });

  it("saves a shipment draft and opens the print dialog for Save & Receive", async () => {
    wmsMocks.listDraftReceipts
      .mockResolvedValueOnce([] as never)
      .mockResolvedValue([wmsMocks.draft] as never);
    renderReceivingPage();

    const dialog = await openShipmentDialog();
    const containerInput = within(dialog).getByLabelText("Container number");
    const poInput = within(dialog).getByLabelText("PO number");
    fireEvent.change(containerInput, { target: { value: "MSKU1234565" } });
    await waitFor(() => expect(poInput).toHaveFocus());
    fireEvent.change(poInput, { target: { value: "PO-1" } });
    await waitFor(() => expect(poInput).toHaveDisplayValue("PO-1"));
    await selectFlourProduct(dialog);
    await waitFor(() => expect(within(dialog).getByRole("button", { name: /commit product and move to total received/i })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: /save & receive/i }));

    await waitFor(() => expect(wmsMocks.saveShipmentDrafts).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("Print Draft Labels")).toBeInTheDocument();
    expect(screen.getAllByText(/PLT-1/).length).toBeGreaterThan(0);
  });

  it("opens standalone pallet mode without requiring a container number", async () => {
    renderReceivingPage();

    const dialog = await openShipmentDialog("pallet");
    expect(within(dialog).queryByLabelText("Container number")).not.toBeInTheDocument();
    expect(within(dialog).getByText(/standalone pallet mode/i)).toBeInTheDocument();

    await selectFlourProduct(dialog);
    fireEvent.click(within(dialog).getByRole("button", { name: /receive pallet/i }));

    await waitFor(() => expect(wmsMocks.saveShipmentDrafts).toHaveBeenCalledTimes(1));
    expect(wmsMocks.saveShipmentDrafts).toHaveBeenCalledWith(expect.objectContaining({
      receipt_type: "other",
      container_number: "",
    }));
  });

  it("reopens standalone pallet drafts in pallet edit mode without container requirements", async () => {
    wmsMocks.listDraftReceipts.mockResolvedValue([{
      ...wmsMocks.draft,
      receipt_type: "other",
      reference_number: "PALLET-REF",
      container_number: null,
      po_number: null,
      notes: JSON.stringify({
        _draft: true,
        _standalone_pallet: true,
        entry_mode: "pallet",
        receipt_type: "other",
        product_id: "prod-1",
        quantity: 1,
        draft_pallet_barcode: "PLT-1",
      }),
    }] as never);
    renderReceivingPage();

    fireEvent.click(await screen.findByRole("button", { name: /^edit$/i }));
    const dialog = await screen.findByRole("dialog", { name: /edit draft pallet/i });

    expect(within(dialog).queryByLabelText("Container number")).not.toBeInTheDocument();
    expect(within(dialog).getByText(/standalone pallet mode/i)).toBeInTheDocument();
    expect(within(dialog).queryByText(/enter a container number before saving/i)).not.toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: /save draft/i }));

    await waitFor(() => expect(wmsMocks.updateDraftReceipt).toHaveBeenCalledTimes(1));
    expect(wmsMocks.updateDraftReceipt).toHaveBeenCalledWith("draft-1", expect.objectContaining({
      receipt_type: "other",
      container_number: "",
      po_number: "",
    }));
  });

  it("keeps shipment drafts in shipment edit mode with container fields", async () => {
    wmsMocks.listDraftReceipts.mockResolvedValue([{
      ...wmsMocks.draft,
      receipt_type: "po",
      notes: JSON.stringify({
        _draft: true,
        entry_mode: "shipment",
        receipt_type: "po",
        product_id: "prod-1",
        quantity: 1,
        draft_pallet_barcode: "PLT-1",
        container_number: "MSKU1234565",
        po_number: "PO-1",
      }),
    }] as never);
    renderReceivingPage();

    fireEvent.click(await screen.findByRole("button", { name: /^edit$/i }));
    const dialog = await screen.findByRole("dialog", { name: /edit draft pallet/i });

    expect(within(dialog).getByLabelText("Container number")).toHaveDisplayValue("MSKU1234565");
    expect(within(dialog).queryByText(/standalone pallet mode/i)).not.toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: /save draft/i }));

    await waitFor(() => expect(wmsMocks.updateDraftReceipt).toHaveBeenCalledTimes(1));
    expect(wmsMocks.updateDraftReceipt).toHaveBeenCalledWith("draft-1", expect.objectContaining({
      receipt_type: "po",
      container_number: "MSKU1234565",
      po_number: "PO-1",
    }));
  });

  it("printing a draft row completes receiving and sends it to putaway", async () => {
    wmsMocks.listDraftReceipts.mockResolvedValue([wmsMocks.draft] as never);
    renderReceivingPage();

    fireEvent.click(await screen.findByRole("button", { name: /print & receive/i }));

    await waitFor(() => expect(wmsMocks.completeReceiptFromDraft).toHaveBeenCalledWith("draft-1", expect.objectContaining({
      pallet_barcode: "PLT-1",
      product_id: "prod-1",
      quantity: 1,
    })));
  });

  it("freezes receiving posts while offline and keeps the form local", async () => {
    networkState.online = false;
    renderReceivingPage();

    expect(await screen.findByText(/this device is offline\. receiving posts are frozen\./i)).toBeInTheDocument();

    const dialog = await openShipmentDialog();
    const containerInput = within(dialog).getByLabelText("Container number");
    const poInput = within(dialog).getByLabelText("PO number");

    fireEvent.change(containerInput, { target: { value: "MSKU1234565" } });
    fireEvent.change(poInput, { target: { value: "PO-1" } });
    await selectFlourProduct(dialog);

    expect(within(dialog).getByRole("button", { name: /save & receive/i })).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: /save & new/i })).toBeDisabled();
    expect(wmsMocks.saveShipmentDrafts).not.toHaveBeenCalled();
  });

  it("shows draft metadata container fallback and mobile-friendly draft row layout", async () => {
    wmsMocks.listDraftReceipts.mockResolvedValue([{
      ...wmsMocks.draft,
      container_number: null,
      po_number: null,
      reference_number: null,
      notes: JSON.stringify({
        _draft: true,
        product_id: "prod-1",
        quantity: 1,
        draft_pallet_barcode: "PLT-1",
        container_number: "MSKU1234565",
        po_number: "PO-META",
      }),
    }] as never);
    renderReceivingPage();

    const meta = await screen.findByText(/Container MSKU1234565 .* PO PO-META .* Qty 1/i);
    expect(meta).toBeInTheDocument();

    const title = screen.getByText("FLOUR · Flour");
    expect(title).not.toHaveClass("truncate");
    expect(title).toHaveClass("sm:truncate");

    const row = meta.closest(".border-y");
    expect(row).toHaveClass("border-y");
    expect(row).toHaveClass("sm:rounded-lg");
  });

  it("deselect all clears every checkbox in the print dialog and keeps them cleared", async () => {
    wmsMocks.listDraftReceipts.mockResolvedValue([wmsMocks.draft] as never);
    renderReceivingPage();

    fireEvent.click(await screen.findByRole("button", { name: /^print drafts$/i }));
    const dialog = await screen.findByRole("dialog", { name: /print draft labels/i });

    const checkbox = await within(dialog).findByRole("checkbox");
    await waitFor(() => expect(checkbox).toBeChecked());

    const printButton = within(dialog).getByRole("button", { name: /print selected & send to put-away/i });
    const deselectButton = within(dialog).getByRole("button", { name: /deselect all/i });
    expect(printButton).toBeEnabled();
    expect(deselectButton).toBeEnabled();

    fireEvent.click(deselectButton);

    // Regression: an effect used to re-select every draft whenever the
    // selection count hit zero while the dialog was open, so the checkbox
    // would flash unchecked and immediately snap back to checked. Assert it
    // stays unchecked instead of only checking the instant after the click.
    await waitFor(() => expect(checkbox).not.toBeChecked());
    expect(checkbox).not.toBeChecked();
    expect(deselectButton).toBeDisabled();
    expect(printButton).toBeDisabled();

    // Give any stray effect a chance to re-fire before asserting again.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(checkbox).not.toBeChecked();
    expect(printButton).toBeDisabled();
  });
});
