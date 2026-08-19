import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.hoisted(() => vi.fn());

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc, from: vi.fn() },
}));

import { confirmPickTask, createPickShortfallTask, previewPickSourceOverride } from "@/lib/wms-core";

describe("confirmPickTask", () => {
  beforeEach(() => {
    rpc.mockReset();
  });

  it("commits a normal pick through the transactional database operation", async () => {
    rpc.mockResolvedValue({ data: { confirmed_quantity: 10, source_override: false }, error: null });

    await expect(confirmPickTask("task-1", "PKL-1", "PBC-1", 10)).resolves.toMatchObject({ confirmed_quantity: 10 });

    expect(rpc).toHaveBeenCalledWith("confirm_pick_task", {
      in_task_id: "task-1",
      in_pick_list_code: "PKL-1",
      in_scanned_pallet_barcode: "PBC-1",
      in_confirmed_quantity: 10,
      in_allow_quantity_anomaly: false,
      in_confirm_source_override: false,
      in_allow_source_quantity_variance: false,
    });
  });

  it("allows an alternate pallet with a different quantity when the variance is explicitly accepted", async () => {
    rpc.mockResolvedValue({ data: { confirmed_quantity: 40, quantity_variance: true, shortfall: 20 }, error: null });

    await expect(confirmPickTask("task-1", "PKL-1", "PBC-2", 40, false, true, true)).resolves.toMatchObject({
      shortfall: 20,
    });

    expect(rpc).toHaveBeenCalledWith("confirm_pick_task", expect.objectContaining({
      in_confirmed_quantity: 40,
      in_confirm_source_override: true,
      in_allow_source_quantity_variance: true,
    }));
  });

  it("creates a follow-up task for the outstanding shortfall", async () => {
    rpc.mockResolvedValue({ data: { task_id: "task-2", task_number: "PKT-2", pallet_found: true }, error: null });

    await expect(createPickShortfallTask("task-1", 20)).resolves.toMatchObject({ task_number: "PKT-2" });

    expect(rpc).toHaveBeenCalledWith("create_pick_shortfall_task", {
      in_task_id: "task-1",
      in_quantity: 20,
    });
  });

  it("requires an explicit source-override confirmation in the commit payload", async () => {
    rpc.mockResolvedValue({ data: { source_override: true, picked_pallet_id: "pallet-2" }, error: null });

    await confirmPickTask("task-1", "PKL-1", "PBC-2", 10, false, true);

    expect(rpc).toHaveBeenCalledWith("confirm_pick_task", expect.objectContaining({
      in_pick_list_code: "PKL-1",
      in_scanned_pallet_barcode: "PBC-2",
      in_confirm_source_override: true,
    }));
  });

  it("keeps the quantity-anomaly recovery flow typed for the picker", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { message: "PICK_QTY_ANOMALY: available=6;requested=10" },
    });

    await expect(confirmPickTask("task-1", "PKL-1", "PBC-1", 10)).rejects.toEqual(
      expect.objectContaining({
        name: "PickQuantityAnomalyError",
        availableQuantity: 6,
        requestedQuantity: 10,
      }),
    );
  });

  it("allows the existing short-pallet recovery only when explicitly confirmed", async () => {
    rpc.mockResolvedValue({ data: { confirmed_quantity: 6, quantity_anomaly_override: true }, error: null });

    await expect(confirmPickTask("task-1", "PKL-1", "PBC-1", 10, true)).resolves.toMatchObject({ confirmed_quantity: 6 });

    expect(rpc).toHaveBeenCalledWith("confirm_pick_task", expect.objectContaining({
      in_allow_quantity_anomaly: true,
    }));
  });

  it("surfaces server validation failures without attempting client-side inventory writes", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "This pallet is already directed to another active pick task." } });

    await expect(confirmPickTask("task-1", "PKL-1", "PBC-2", 10, false, true)).rejects.toThrow(
      "already directed to another active pick task",
    );
  });

  it("previews the alternate pallet before allowing an override", async () => {
    rpc.mockResolvedValue({ data: { sku: "SKU-1", requested_quantity: 10, source_override: true }, error: null });

    await expect(previewPickSourceOverride("task-1", "PKL-1", "PBC-2")).resolves.toMatchObject({ source_override: true });

    expect(rpc).toHaveBeenCalledWith("preview_pick_source_override", {
      in_task_id: "task-1",
      in_pick_list_code: "PKL-1",
      in_scanned_pallet_barcode: "PBC-2",
    });
  });
});
