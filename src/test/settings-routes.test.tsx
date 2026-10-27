import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";

import { SettingsPage } from "@/features/admin/admin-page";
import { getVisibleSettingsTabs, settingsTabFromSplat } from "@/features/admin/settings-tabs";

const authState = vi.hoisted(() => ({ roles: ["warehouse_manager"] as string[] }));

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ roles: authState.roles }),
}));
vi.mock("@/hooks/use-feature-flags", () => ({
  useFeatureFlags: () => ({ isEnabled: () => false }),
}));
vi.mock("@/components/warehouse-tree-view", () => ({ WarehouseStructureTab: () => <div>structure-tab</div> }));
vi.mock("@/features/admin/about-settings-tab", () => ({ AboutSettingsTab: () => <div>about-tab</div> }));
vi.mock("@/features/admin/environment-settings-tab", () => ({ EnvironmentSettingsTab: () => <div>environment-tab</div> }));
vi.mock("@/features/admin/audio-cues-card", () => ({ AudioCuesCard: () => null }));
vi.mock("@/features/shared/notification-settings", () => ({ NotificationSettingsPanel: () => <div>notifications-tab</div> }));

function LocationProbe() {
  const { pathname, search } = useLocation();
  return <div data-testid="location">{pathname + search}</div>;
}

function renderAt(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <TooltipProvider>
        <LocationProbe />
        <Routes>
          <Route path="/settings/*" element={<SettingsPage />} />
        </Routes>
      </TooltipProvider>
    </MemoryRouter>,
  );
}

describe("settings routes", () => {
  it("redirects /settings to the default tab", async () => {
    renderAt("/settings");
    await waitFor(() => expect(screen.getByTestId("location").textContent).toBe("/settings/warehouse-structure"));
  });

  it("redirects legacy ?tab= links to the tab path and keeps other params", async () => {
    renderAt("/settings?tab=about&x=1");
    await waitFor(() => expect(screen.getByTestId("location").textContent).toBe("/settings/about?x=1"));
    expect(await screen.findByText("about-tab")).toBeTruthy();
  });

  it("redirects unknown slugs to the default tab", async () => {
    renderAt("/settings/nope");
    await waitFor(() => expect(screen.getByTestId("location").textContent).toBe("/settings/warehouse-structure"));
  });

  it("shows an access message for a tab the role cannot see", async () => {
    authState.roles = ["warehouse_operator"];
    renderAt("/settings/users-roles");
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByTestId("location").textContent).toBe("/settings/users-roles");
    authState.roles = ["warehouse_manager"];
  });
});

describe("settings tab registry", () => {
  it("gates tabs by role and feature flag", () => {
    const base = { canViewUsersRoles: false, isDeveloperOrAdmin: false, clientsEnabled: false };
    expect(getVisibleSettingsTabs(base)).not.toContain("integrations");
    expect(getVisibleSettingsTabs({ ...base, isDeveloperOrAdmin: true })).toContain("integrations");
    expect(getVisibleSettingsTabs({ ...base, clientsEnabled: true })).toContain("client-vars");
  });

  it("reads the tab from the first splat segment", () => {
    expect(settingsTabFromSplat("integrations/netsuite")).toBe("integrations");
    expect(settingsTabFromSplat(undefined)).toBe("");
  });
});
