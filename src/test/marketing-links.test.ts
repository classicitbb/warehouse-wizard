import { describe, expect, it } from "vitest";
import { marketingUrl } from "@/lib/marketing-links";

describe("marketingUrl", () => {
  it("points at the root domain", () => {
    expect(marketingUrl()).toBe("https://warehousewizard.app");
  });
  it("deep-links to an explainer section", () => {
    expect(marketingUrl("cycle-counts")).toBe("https://warehousewizard.app/#cycle-counts");
  });
});
