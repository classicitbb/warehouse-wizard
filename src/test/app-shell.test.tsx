import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AppShell } from "@/components/wms-ui";

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
}));

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({
    profile: { full_name: "Alex Manager" },
    roles: ["warehouse_manager"],
    signOut: vi.fn(),
    user: { id: "user-1" },
    refreshProfile: vi.fn(),
  }),
}));

vi.mock("@/lib/wms-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/wms-core")>();
  return {
    ...actual,
    fetchOptions: wmsMocks.fetchOptions,
    getDashboardMetrics: wmsMocks.getDashboardMetrics,
    getPutawayTasks: wmsMocks.getPutawayTasks,
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
  }),
}));

describe("AppShell", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    wmsMocks.getPutawayTasks.mockResolvedValue([
      { id: "task-1", status: "queued" },
      { id: "task-2", status: "assigned" },
    ] as never);
    wmsMocks.getDashboardMetrics.mockResolvedValue({
      openReceipts: 3,
      openPickLists: 4,
    } as never);
  });

  const renderAppShell = () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });

    return render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/dashboard"]}>
          <AppShell>
            <div>Content</div>
          </AppShell>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  };

  it("shows only navigation allowed for the current role", () => {
    renderAppShell();

    expect(screen.getAllByText("Dashboard").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Warehouses").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Help").length).toBeGreaterThan(0);
    expect(screen.queryByText("Users")).not.toBeInTheDocument();
  });

  it("keeps the page title compact and uses a dedicated scroll container for body content", () => {
    const { container } = renderAppShell();

    expect(screen.getByText("Warehouse Wizard Enterprise WMS")).toBeInTheDocument();
    expect(screen.queryByText("2-warehouse, scan-first control room")).not.toBeInTheDocument();

    const bodyScrollRegion = container.querySelector(".overflow-y-auto.px-4");
    expect(bodyScrollRegion).not.toBeNull();
    expect(bodyScrollRegion?.className).toContain("flex-1");
    expect(bodyScrollRegion?.className).toContain("min-h-0");
  });

  it("shows workflow counts on navigation badges", async () => {
    const { container } = renderAppShell();

    await waitFor(() => expect(wmsMocks.getPutawayTasks).toHaveBeenCalled());
    await waitFor(() => expect(wmsMocks.getDashboardMetrics).toHaveBeenCalled());

    expect(container.querySelectorAll('[aria-label="3 open Receiving tasks"]').length).toBeGreaterThanOrEqual(2);
    expect(container.querySelectorAll('[aria-label="2 open Put-Away tasks"]').length).toBeGreaterThanOrEqual(2);
    expect(container.querySelectorAll('[aria-label="4 open Pick Lists"]').length).toBeGreaterThanOrEqual(2);
  });

  it("marks the active route icon with the accent colour", () => {
    const { container } = renderAppShell();

    const activeIcons = Array.from(container.querySelectorAll('[data-active-icon="true"]'));
    expect(activeIcons.length).toBeGreaterThan(0);
    expect(activeIcons.every((icon) => icon.getAttribute("class")?.includes("text-accent"))).toBe(true);

    const inactiveIcons = Array.from(container.querySelectorAll('[data-active-icon="false"]'));
    expect(inactiveIcons.some((icon) => icon.getAttribute("class")?.includes("text-accent"))).toBe(false);
  });
});
