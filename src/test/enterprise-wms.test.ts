import { describe, expect, it } from "vitest";

import {
  buildCsvReportRows,
  buildEnterpriseDashboard,
  buildNetSuiteInventoryAdjustment,
  buildWarehouseBrainRecommendations,
  generateZplLabel,
  mapNetSuiteItemToProduct,
} from "@/lib/enterprise-wms";
import type { DashboardMetrics } from "@/lib/wms-core";

function dashboardMetrics(overrides: Partial<DashboardMetrics> = {}): DashboardMetrics {
  return {
    totalPallets: 0,
    availablePallets: 0,
    totalPalletCapacity: 0,
    warehousePallets: 0,
    warehousePalletCapacity: 0,
    coolZoneOccupancy: 0,
    openReceipts: 0,
    openPutawayTasks: 0,
    openPickLists: 0,
    openMoveTasks: 0,
    openTransfers: 0,
    openCycleCounts: 0,
    openDockLoads: 0,
    openReplenishmentTasks: 0,
    recentAuditEvents: 0,
    holdStock: 0,
    quarantineStock: 0,
    putawayTaskRows: [],
    pickListRows: [],
    moveTaskRows: [],
    transferRows: [],
    cycleCountRows: [],
    dockLoadRows: [],
    replenishmentRows: [],
    blockedBalanceRows: [],
    receiptRows: [],
    expiryWarning30: 0,
    expiryWarning60: 0,
    stockAge3Months: 0,
    stockAge6Months: 0,
    stockAge12Months: 0,
    ...overrides,
  };
}

describe("generateZplLabel", () => {
  it("creates queue-ready Zebra ZPL and sanitizes control characters", () => {
    const zpl = generateZplLabel({
      labelType: "pallet",
      code: "PLT-123^BAD",
      title: "Cold Chain Pallet",
      subtitle: "Lot A",
      quantity: 48,
    });

    expect(zpl).toContain("^XA");
    expect(zpl).toContain("^BCN");
    expect(zpl).toContain("PLT-123 BAD");
    expect(zpl).toContain("QTY 48");
    expect(zpl).toContain("^XZ");
  });
});

describe("NetSuite integration helpers", () => {
  it("maps a NetSuite item into product master fields", () => {
    expect(
      mapNetSuiteItemToProduct({
        id: "912",
        itemId: "SKU-COLD",
        displayName: "Cold SKU",
        upcCode: "000123",
        custitem_temperature_class: "Cool",
        custitem_lot_tracked: true,
        custitem_expiry_tracked: true,
      }),
    ).toMatchObject({
      external_system: "netsuite",
      external_id: "912",
      sku: "SKU-COLD",
      barcode: "000123",
      temperature_requirement: "cool",
      lot_tracked: true,
      expiry_tracked: true,
      rotation_method: "fefo",
      active: true,
    });
  });

  it("builds idempotent inventory adjustment payloads", () => {
    const payload = buildNetSuiteInventoryAdjustment({
      accountId: "ACCT",
      sku: "SKU-1",
      locationExternalId: "MAIN",
      quantityDelta: -3,
      memo: "Cycle count variance",
    });

    expect(payload.recordType).toBe("inventoryAdjustment");
    expect(payload.inventory.items[0]).toMatchObject({ adjustQtyBy: -3 });
    expect(payload.idempotencyKey).toContain("SKU-1-MAIN--3");
  });
});

describe("enterprise dashboard and brain", () => {
  it("surfaces expiration, forecast, controlled stock, and setup signals", () => {
    const soon = new Date();
    soon.setDate(soon.getDate() + 7);

    const snapshot = buildEnterpriseDashboard(
      dashboardMetrics({
        totalPallets: 4,
        availablePallets: 2,
        totalPalletCapacity: 10,
        warehousePallets: 4,
        warehousePalletCapacity: 10,
        coolZoneOccupancy: 1,
        openReceipts: 1,
        openPutawayTasks: 2,
        openPickLists: 1,
        holdStock: 1,
        quarantineStock: 1,
        putawayTaskRows: [],
        pickListRows: [],
        blockedBalanceRows: [],
      }),
      {
        inventory: [
          { sku: "A", available_quantity: 5, expiry_date: soon.toISOString(), status: "staged", pallet_code: "P1" },
          { sku: "B", available_quantity: 50, status: "available", pallet_code: "P2" },
        ],
        occupancy: [{ location_id: "L1", occupied_pallets: 1, max_pallets: 2, is_full: false }],
        cycleCounts: [{ variance_quantity: 2, status: "exception" }],
        stagingLoads: [{ id: "SL1", route_code: "R-01", status: "ready" }],
        reorderAlerts: [{ available_quantity: 5, reorder_point: 12, recommended_quantity: 30, products: { sku: "A" } }],
      },
    );

    expect(snapshot.officeWidgets.find((widget) => widget.label === "Expiration risk")?.value).toBe("1");
    expect(snapshot.floorQueues.find((queue) => queue.label === "Blocked Exceptions")?.count).toBe(2);
    expect(snapshot.dockLoads[0]).toMatchObject({ route: "R-01", status: "ready" });
    expect(snapshot.recommendations.map((item) => item.id)).toContain("expiry-risk");
    expect(snapshot.recommendations.find((item) => item.id === "low-stock")).toMatchObject({
      evidence: ["A: 5 available; reorder point 12; replenish 30"],
    });
  });

  it("returns an insufficient-data recommendation when no live evidence supports intel", () => {
    const recommendations = buildWarehouseBrainRecommendations(
      dashboardMetrics(),
      { inventory: [] },
    );

    expect(recommendations).toHaveLength(1);
    expect(recommendations[0].id).toBe("insufficient-data");
  });

  it("does not create a low-stock recommendation from a hard-coded inventory threshold", () => {
    const recommendations = buildWarehouseBrainRecommendations(
      dashboardMetrics(),
      { inventory: [{ sku: "A", available_quantity: 1 }] },
    );

    expect(recommendations.map((item) => item.id)).not.toContain("low-stock");
  });

  it("does not invent dock loads without live staging load data", () => {
    const snapshot = buildEnterpriseDashboard(dashboardMetrics(), { inventory: [{ sku: "A", available_quantity: 4 }] });

    expect(snapshot.dockLoads).toEqual([]);
  });
});

describe("buildCsvReportRows", () => {
  it("creates human-readable inventory report rows", () => {
    expect(
      buildCsvReportRows({
        inventory: [{ sku: "SKU-1", product_name: "Widget", available_quantity: 3, location_code: null }],
      }),
    ).toEqual([
      {
        sku: "SKU-1",
        product: "Widget",
        warehouse: "",
        location: "receiving",
        pallet: "",
        status: "",
        available_quantity: 3,
        expiry_date: "",
      },
    ]);
  });
});
