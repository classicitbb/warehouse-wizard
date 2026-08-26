import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PalletEditDialog, type PalletEditTarget } from "@/features/inventory/pallet-edit-dialog";
import { TooltipProvider } from "@/components/ui/tooltip";

const wmsMocks = vi.hoisted(() => ({
  beginInventoryPalletCorrection: vi.fn(async () => ({
    draftId: "draft-1",
    replacementPalletBarcode: "PLT-NEW",
    formerLocationCode: "A-01-L01-P1",
  })),
  cancelInventoryPalletCorrection: vi.fn(async () => undefined),
  saveInventoryPalletCorrectionAsDraft: vi.fn(async () => ({
    draftId: "draft-1",
    draftPalletBarcode: "PLT-NEW",
    quantity: 40,
    expiryDate: "2026-12-01",
  })),
  completeInventoryPalletCorrection: vi.fn(async (): Promise<any> => ({
    inventoryBalanceId: "balance-new",
    palletId: "pallet-new",
    palletBarcode: "PLT-NEW",
    putawayTaskId: null,
    putawayTaskNumber: null,
  })),
  completeInventoryPalletCorrectionInPlace: vi.fn(async (): Promise<any> => ({
    inventoryBalanceId: "balance-1",
    palletId: "pallet-1",
    palletBarcode: "PLT-OLD",
    putawayTaskId: null,
    putawayTaskNumber: null,
  })),
}));

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
    return React.cloneElement(element as React.ReactElement<any>, { onClick: () => onPrinted?.() });
  },
}));

vi.mock("@/hooks/use-network-status", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/use-network-status")>();
  return { ...actual, useNetworkStatus: () => ({ online: true }) };
});

vi.mock("@/lib/wms-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/wms-core")>();
  return { ...actual, ...wmsMocks };
});

const target: PalletEditTarget = {
  balanceId: "balance-1",
  palletBarcode: "PLT-OLD",
  quantity: 40,
  expiryDate: "2026-12-01",
  productSku: "FLOUR",
  productName: "Flour",
  locationCode: "A-01-L01-P1",
};

describe("PalletEditDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function renderDialog() {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <MemoryRouter initialEntries={["/inventory/balance-1"]}>
            <PalletEditDialog open onOpenChange={() => {}} target={target} />
          </MemoryRouter>
        </TooltipProvider>
      </QueryClientProvider>,
    );
  }

  async function openedDialog() {
    renderDialog();
    const dialog = await screen.findByRole("dialog", { name: /edit pallet plt-old/i });
    return dialog;
  }

  it("keeps the pallet's own number on screen and reserves nothing up front", async () => {
    const dialog = await openedDialog();

    // Opening the dialog must not touch the pallet — no correction begins
    // until the operator commits to a save action.
    expect(wmsMocks.beginInventoryPalletCorrection).not.toHaveBeenCalled();
    expect(within(dialog).getAllByText("PLT-OLD").length).toBeGreaterThan(0);
    expect(within(dialog).queryByText("PLT-NEW")).not.toBeInTheDocument();
  });

  it("saves a blank edit straight to drafts without requiring a change", async () => {
    const dialog = await openedDialog();

    expect(within(dialog).getByRole("button", { name: /save changes/i })).toBeDisabled();
    const saveDraft = within(dialog).getByRole("button", { name: /save as draft/i });
    expect(saveDraft).toBeEnabled();
    fireEvent.click(saveDraft);

    // Saving lazily begins the correction, then writes the draft.
    await waitFor(() => expect(wmsMocks.beginInventoryPalletCorrection).toHaveBeenCalledWith("balance-1"));
    await waitFor(() => expect(wmsMocks.saveInventoryPalletCorrectionAsDraft).toHaveBeenCalledWith({
      draftId: "draft-1",
      quantity: null,
      expiryDate: null,
      expiryProvided: false,
    }));
    expect(wmsMocks.completeInventoryPalletCorrection).not.toHaveBeenCalled();
    expect(wmsMocks.completeInventoryPalletCorrectionInPlace).not.toHaveBeenCalled();
  });

  it("carries an edited quantity into the draft", async () => {
    const dialog = await openedDialog();

    fireEvent.change(within(dialog).getByLabelText("Quantity"), { target: { value: "96" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /save as draft/i }));

    await waitFor(() => expect(wmsMocks.saveInventoryPalletCorrectionAsDraft).toHaveBeenCalledWith({
      draftId: "draft-1",
      quantity: 96,
      expiryDate: null,
      expiryProvided: false,
    }));
  });

  it("cancel before any save leaves the pallet untouched — no RPCs at all", async () => {
    const dialog = await openedDialog();

    fireEvent.change(within(dialog).getByLabelText("Quantity"), { target: { value: "96" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /^cancel$/i }));

    // No draft was ever created, so cancel is a pure dismiss.
    await waitFor(() => expect(screen.queryByRole("dialog", { name: /edit pallet plt-old/i })).not.toBeInTheDocument());
    expect(wmsMocks.beginInventoryPalletCorrection).not.toHaveBeenCalled();
    expect(wmsMocks.cancelInventoryPalletCorrection).not.toHaveBeenCalled();
    expect(wmsMocks.saveInventoryPalletCorrectionAsDraft).not.toHaveBeenCalled();
    expect(wmsMocks.completeInventoryPalletCorrection).not.toHaveBeenCalled();
    expect(wmsMocks.completeInventoryPalletCorrectionInPlace).not.toHaveBeenCalled();
  });

  it("updates a same-location quantity fix in place, keeping the pallet number", async () => {
    const dialog = await openedDialog();

    fireEvent.change(within(dialog).getByLabelText("Quantity"), { target: { value: "96" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /save changes/i }));

    const prompt = await screen.findByRole("dialog", { name: /confirm pallet location/i });
    expect(prompt).toHaveTextContent("A-01-L01-P1");
    fireEvent.click(within(prompt).getByRole("button", { name: /yes — keep/i }));

    const confirm = await screen.findByRole("dialog", { name: /confirm the update/i });
    expect(confirm).toHaveTextContent("PLT-OLD");
    fireEvent.click(within(confirm).getByRole("button", { name: /update & close/i }));

    await waitFor(() => expect(wmsMocks.completeInventoryPalletCorrectionInPlace).toHaveBeenCalledWith({
      draftId: "draft-1",
      quantity: 96,
    }));
    expect(wmsMocks.completeInventoryPalletCorrection).not.toHaveBeenCalled();
  });

  it("prints a replacement label, and only then takes a new number, when the pallet has moved", async () => {
    wmsMocks.completeInventoryPalletCorrection.mockResolvedValue({
      inventoryBalanceId: "balance-new",
      palletId: "pallet-new",
      palletBarcode: "PLT-NEW",
      putawayTaskId: "task-1",
      putawayTaskNumber: "PTA-1",
    });
    const dialog = await openedDialog();

    fireEvent.change(within(dialog).getByLabelText("Quantity"), { target: { value: "96" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /save changes/i }));

    const prompt = await screen.findByRole("dialog", { name: /confirm pallet location/i });
    fireEvent.click(within(prompt).getByRole("button", { name: /no — send to put-away/i }));

    const confirm = await screen.findByRole("dialog", { name: /print the replacement label/i });
    expect(confirm).toHaveTextContent("PLT-NEW");
    fireEvent.click(within(confirm).getByRole("button", { name: /print & save/i }));

    await waitFor(() => expect(wmsMocks.completeInventoryPalletCorrection).toHaveBeenCalledWith({
      draftId: "draft-1",
      quantity: 96,
      expiryDate: "2026-12-01",
      stillAtFormerLocation: false,
    }));
  });
});
