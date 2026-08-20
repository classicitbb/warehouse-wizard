import { describe, expect, it } from "vitest";

import { canAccessCopilot, MAX_TOOLBAR_MODULES, sanitizeToolbarModules, serializeToolbarModules } from "@/hooks/use-feature-flags";

describe("mobile toolbar preferences", () => {
  it("migrates legacy favourites by adding Dashboard", () => {
    expect(sanitizeToolbarModules(["receiving", "inventory"])).toEqual(["dashboard", "receiving", "inventory"]);
  });

  it("preserves an intentional Dashboard removal in version 2 preferences", () => {
    expect(sanitizeToolbarModules(serializeToolbarModules(["receiving", "inventory"]))).toEqual(["receiving", "inventory"]);
  });

  it("limits the dock to eight unique module shortcuts", () => {
    const modules = sanitizeToolbarModules(serializeToolbarModules([
      "dashboard", "receiving", "putaway", "inventory", "pick-lists", "location-moves", "products", "warehouses", "zones", "receiving",
    ]));

    expect(MAX_TOOLBAR_MODULES).toBe(8);
    expect(modules).toHaveLength(8);
    expect(new Set(modules).size).toBe(8);
  });
});

describe("Copilot access", () => {
  it.each([
    "developer", "admin", "warehouse_manager", "warehouse_supervisor",
    "inventory_clerk", "warehouse_operator", "dispatch_driver",
  ])("allows the role %s", (role) => expect(canAccessCopilot([role])).toBe(true));

  it("allows users with no roles yet", () => expect(canAccessCopilot([])).toBe(true));
});
