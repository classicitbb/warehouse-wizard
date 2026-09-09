import { beforeEach, describe, expect, it, vi } from "vitest";

const supabaseMock = vi.hoisted(() => ({
  upsertCalls: [] as Array<{ table: string; payload: any; options: any }>,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: vi.fn((table: string) => ({
      upsert: vi.fn((payload: any, options: any) => {
        supabaseMock.upsertCalls.push({ table, payload, options });
        return Promise.resolve({ error: null });
      }),
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn(() => Promise.resolve({ data: null, error: null })),
            })),
          })),
        })),
      })),
    })),
  },
}));

import {
  filterDashboardTileDefinitions,
  hiddenDashboardTiles,
  saveDashboardDeviceLayout,
  sanitizeDashboardLayout,
  visibleDashboardTiles,
  type DashboardTileConfig,
  type DashboardTileDefinition,
} from "@/lib/dashboard-preferences";
import { getDashboardMetricKeysForModules } from "@/lib/wms-core";

const defaults: DashboardTileConfig[] = [
  { id: "totalPallets", size: "2x1" },
  { id: "openReceipts", size: "1x1" },
  { id: "Inbound", size: "2x1" },
];

describe("dashboard preference sanitizing", () => {
  beforeEach(() => {
    supabaseMock.upsertCalls.length = 0;
  });

  it("drops unknown tiles, de-duplicates known tiles, and appends new defaults", () => {
    const layout = sanitizeDashboardLayout(
      [
        { id: "missing", size: "2x1" },
        { id: "openReceipts", size: "2x1" },
        { id: "openReceipts", size: "1x1" },
      ],
      defaults,
    );

    expect(layout).toEqual([
      { id: "openReceipts", size: "2x1" },
      { id: "totalPallets", size: "2x1" },
      { id: "Inbound", size: "2x1" },
    ]);
  });

  it("keeps user-hidden tiles out of the main grid and returns them for restore controls", () => {
    const visibility = { openReceipts: false };

    expect(visibleDashboardTiles(defaults, visibility, false).map((tile) => tile.id)).toEqual(["totalPallets", "Inbound"]);
    expect(visibleDashboardTiles(defaults, visibility, true).map((tile) => tile.id)).toEqual(["totalPallets", "Inbound"]);
    expect(hiddenDashboardTiles(defaults, visibility).map((tile) => tile.id)).toEqual(["openReceipts"]);
  });

  it("filters tile definitions by enabled modules", () => {
    const definitions: Array<DashboardTileDefinition<"inventory" | "receiving">> = [
      { id: "totalPallets", label: "Total Pallets", size: "2x1", moduleKey: "inventory" },
      { id: "openReceipts", label: "Open Receipts", size: "1x1", moduleKey: "receiving" },
      { id: "warehouse-brain", label: "Warehouse Brain", size: "2x1" },
    ];

    expect(filterDashboardTileDefinitions(definitions, (key) => key !== "receiving").map((tile) => tile.id)).toEqual([
      "totalPallets",
      "warehouse-brain",
    ]);
  });

  it("saves layout rows separately per device", async () => {
    await saveDashboardDeviceLayout("user-1", "device-111111111111", "floor", defaults);
    await saveDashboardDeviceLayout("user-1", "device-222222222222", "floor", defaults);

    expect(supabaseMock.upsertCalls).toHaveLength(2);
    expect(supabaseMock.upsertCalls.map((call) => call.payload.device_id)).toEqual([
      "device-111111111111",
      "device-222222222222",
    ]);
    expect(supabaseMock.upsertCalls[0].options.onConflict).toBe("user_id,device_id,mode");
  });
});

describe("dashboard KPI module filtering", () => {
  it("removes receiving KPIs when receiving is disabled", () => {
    const keys = getDashboardMetricKeysForModules({ receiving: false });

    expect(keys).not.toContain("openReceipts");
    expect(keys).toContain("totalPallets");
  });

  it("removes pick-list KPIs when pick lists are disabled", () => {
    const keys = getDashboardMetricKeysForModules({ "pick-lists": false });

    expect(keys).not.toContain("openPickLists");
    expect(keys).toContain("openPutawayTasks");
  });
});
