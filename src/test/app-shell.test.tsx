import { act, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AppShell } from "@/components/wms-ui";

const networkState = vi.hoisted(() => ({ online: true }));
const sonnerMocks = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  message: vi.fn(),
  custom: vi.fn(),
  dismiss: vi.fn(),
}));

const wmsMocks = vi.hoisted(() => ({
  getPutawayTasks: vi.fn(async () => [
    { id: "task-1", status: "queued" },
    { id: "task-2", status: "assigned" },
  ]),
  getDashboardMetrics: vi.fn(async () => ({
    openReceipts: 3,
    openPickLists: 4,
  })),
  fetchOptions: vi.fn(async () => ({ warehouses: [], userRoles: [] })),
  listSystemLogs: vi.fn(async () => []),
  writeSystemLog: vi.fn(async () => "log-1"),
  resolveSystemLog: vi.fn(async () => undefined),
}));

vi.mock("sonner", () => ({
  toast: sonnerMocks,
}));

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({
    profile: { full_name: "Alex Manager", default_warehouse_id: "wh-1" },
    roles: ["warehouse_manager"],
    signOut: vi.fn(),
    user: { id: "user-1", email: "alex@example.com" },
    refreshProfile: vi.fn(),
  }),
}));

vi.mock("@/hooks/use-network-status", () => ({
  useNetworkStatus: () => ({ online: networkState.online }),
}));

vi.mock("@/lib/device-identity", () => ({
  getOrCreateDeviceId: () => "device-1",
}));

vi.mock("@/lib/wms-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/wms-core")>();
  return {
    ...actual,
    fetchOptions: wmsMocks.fetchOptions,
    getDashboardMetrics: wmsMocks.getDashboardMetrics,
    getPutawayTasks: wmsMocks.getPutawayTasks,
    listSystemLogs: wmsMocks.listSystemLogs,
    writeSystemLog: wmsMocks.writeSystemLog,
    resolveSystemLog: wmsMocks.resolveSystemLog,
  };
});

vi.mock("@/hooks/use-feature-flags", () => ({
  STARTER_MODULES: {
    receiving: true,
    putaway: true,
    inventory: true,
    "location-moves": true,
    transfers: true,
    "pick-lists": true,
    products: true,
    warehouses: true,
    zones: true,
    locations: true,
    users: true,
    settings: true,
    clients: true,
    packaging: true,
    "cycle-counts": true,
    reports: true,
    status: true,
    "system-log": true,
    "email-log": true,
  },
  useFeatureFlags: () => ({
    isEnabled: () => true,
    toolbarModules: ["receiving", "putaway", "inventory", "pick-lists", "location-moves", "products", "warehouses"],
  }),
}));

function renderShell(queryClient?: QueryClient) {
  const client = queryClient ?? new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });

  return {
    client,
    ...render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={["/dashboard"]}>
          <AppShell>
            <div>Content</div>
          </AppShell>
        </MemoryRouter>
      </QueryClientProvider>,
    ),
  };
}

describe("AppShell", () => {
  beforeEach(() => {
    networkState.online = true;
    vi.clearAllMocks();
    window.sessionStorage.clear();
    wmsMocks.getPutawayTasks.mockResolvedValue([
      { id: "task-1", status: "queued" },
      { id: "task-2", status: "assigned" },
    ] as never);
    wmsMocks.getDashboardMetrics.mockResolvedValue({
      openReceipts: 3,
      openPickLists: 4,
    } as never);
    wmsMocks.listSystemLogs.mockResolvedValue([] as never);
  });

  it("shows only navigation allowed for the current role", () => {
    renderShell();

    expect(screen.getAllByText("Dashboard").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Warehouses").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Help").length).toBeGreaterThan(0);
    expect(screen.queryByText("Users")).not.toBeInTheDocument();
  });

  it("keeps the page title compact and uses a dedicated scroll container for body content", () => {
    const { container } = renderShell();

    expect(screen.getAllByText("WW").length).toBeGreaterThan(0);
    expect(screen.queryByText("2-warehouse, scan-first control room")).not.toBeInTheDocument();

    const bodyScrollRegion = container.querySelector(".overflow-y-auto.px-4");
    expect(bodyScrollRegion).not.toBeNull();
    expect(bodyScrollRegion?.className).toContain("flex-1");
    expect(bodyScrollRegion?.className).toContain("min-h-0");
  });

  it("shows workflow counts on navigation badges", async () => {
    const { container } = renderShell();

    await waitFor(() => expect(wmsMocks.getPutawayTasks).toHaveBeenCalled());
    await waitFor(() => expect(wmsMocks.getDashboardMetrics).toHaveBeenCalled());

    expect(container.querySelectorAll('[aria-label="3 open Receiving tasks"]').length).toBeGreaterThanOrEqual(2);
    expect(container.querySelectorAll('[aria-label="2 open Put-Away tasks"]').length).toBeGreaterThanOrEqual(2);
    expect(container.querySelectorAll('[aria-label="4 open Pick Lists"]').length).toBeGreaterThanOrEqual(2);
  });

  it("marks the active route icon with the accent colour", () => {
    const { container } = renderShell();

    const activeIcons = Array.from(container.querySelectorAll('[data-active-icon="true"]'));
    expect(activeIcons.length).toBeGreaterThan(0);
    expect(activeIcons.every((icon) => icon.getAttribute("class")?.includes("text-accent"))).toBe(true);

    const inactiveIcons = Array.from(container.querySelectorAll('[data-active-icon="false"]'));
    expect(inactiveIcons.some((icon) => icon.getAttribute("class")?.includes("text-accent"))).toBe(false);
  });

  it("keeps Dashboard fixed and uses the first four personal favourites in the mobile shortcut bar", () => {
    renderShell();

    const mobileBar = screen.getByRole("navigation", { name: "Primary mobile navigation" });
    expect(mobileBar).toHaveTextContent("Dashboard");
    expect(mobileBar).toHaveTextContent("Receiving");
    expect(mobileBar).toHaveTextContent("Put-Away");
    expect(mobileBar).toHaveTextContent("Inventory");
    expect(mobileBar).toHaveTextContent("Pick Lists");
    expect(mobileBar).not.toHaveTextContent("Location Moves");
    expect(mobileBar).not.toHaveTextContent("Products");
    expect(mobileBar).not.toHaveTextContent("Warehouses");
  });

  it("persists an RF disconnect locally and delivers its supervisor alert after reconnect", async () => {
    const { client, rerender } = renderShell();

    networkState.online = false;
    rerender(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={["/dashboard"]}>
          <AppShell>
            <div>Content</div>
          </AppShell>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await waitFor(() => expect(window.sessionStorage.getItem("warehouseWizard.offlineAlert.current")).not.toBeNull());
    expect(wmsMocks.writeSystemLog).not.toHaveBeenCalled();

    networkState.online = true;
    rerender(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={["/dashboard"]}>
          <AppShell>
            <div>Content</div>
          </AppShell>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await waitFor(() => expect(wmsMocks.writeSystemLog).toHaveBeenCalledTimes(1));
    expect(wmsMocks.writeSystemLog).toHaveBeenCalledWith(expect.objectContaining({
      source: "rf.offline_disconnect",
      severity: "critical",
      title: "RF device offline — commits frozen",
    }));
  });

  it("shows inline reconnect refresh state instead of a restored toast", async () => {
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });
    let resolveRefresh: () => void = () => undefined;
    const refreshPromise = new Promise<void>((resolve) => {
      resolveRefresh = resolve;
    });
    vi.spyOn(client, "invalidateQueries").mockReturnValue(refreshPromise as ReturnType<QueryClient["invalidateQueries"]>);
    const { rerender } = renderShell(client);

    networkState.online = false;
    rerender(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={["/dashboard"]}>
          <AppShell>
            <div>Content</div>
          </AppShell>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    networkState.online = true;
    rerender(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={["/dashboard"]}>
          <AppShell>
            <div>Content</div>
          </AppShell>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect((await screen.findAllByRole("status", { name: /refreshing live warehouse state/i })).length).toBeGreaterThan(0);
    expect(sonnerMocks.success).not.toHaveBeenCalledWith("Connection restored. Refreshing live warehouse state.");

    await act(async () => {
      resolveRefresh();
      await refreshPromise;
    });

    await waitFor(() =>
      expect(screen.queryAllByRole("status", { name: /refreshing live warehouse state/i })).toHaveLength(0),
    );
  });

  it("raises a supervisor acknowledgement toast for unresolved offline alerts", async () => {
    wmsMocks.listSystemLogs.mockResolvedValue([
      {
        id: "offline-log-1",
        title: "RF device offline — commits frozen",
        message: "Operator lost connectivity.",
        created_at: "2026-07-08T12:00:00.000Z",
        source: "rf.offline_disconnect",
      },
    ] as never);

    renderShell();

    await waitFor(() => expect(sonnerMocks.custom).toHaveBeenCalledTimes(1));
  });
});
