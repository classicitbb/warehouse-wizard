import { describe, expect, it } from "vitest";
import { activeGroupKey, groupNavigation } from "@/features/shared/nav/nav-groups";
import { NAVIGATION } from "@/features/shared/core-types";

describe("groupNavigation", () => {
  it("folds grouped entries into one row at the first member's position", () => {
    const rows = groupNavigation([
      { to: "/a" },
      { to: "/b", group: "setup" as const },
      { to: "/c" },
      { to: "/d", group: "setup" as const },
    ]);
    expect(rows.map((r) => r.kind)).toEqual(["item", "group", "item"]);
    const group = rows[1];
    expect(group.kind === "group" && group.children.map((c) => c.to)).toEqual(["/b", "/d"]);
  });

  it("finds the group holding the current route", () => {
    expect(activeGroupKey([{ to: "/zones", group: "setup" }], "/zones")).toBe("setup");
    expect(activeGroupKey([{ to: "/zones", group: "setup" }], "/dashboard")).toBeNull();
  });

  it("puts warehouse setup screens under Setup", () => {
    const grouped = NAVIGATION.filter((n) => n.group === "setup").map((n) => n.label);
    expect(grouped).toEqual(["Warehouses", "Zones", "Bin Locations", "Products", "Clients", "Customers", "Packaging", "System Log", "Email Log"]);
  });
});
