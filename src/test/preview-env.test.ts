import { afterEach, describe, expect, it, vi } from "vitest";

import { isPreviewHost } from "@/lib/preview-env";

function setHostname(hostname: string) {
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { ...window.location, hostname },
  });
}

const originalLocation = window.location;

afterEach(() => {
  Object.defineProperty(window, "location", { configurable: true, value: originalLocation });
  vi.restoreAllMocks();
});

describe("isPreviewHost", () => {
  it("treats the Lovable preview sandbox as a preview", () => {
    setHostname("id-preview--b1278655-12aa-44aa-a245-7d311e40dddf.lovable.app");
    expect(isPreviewHost()).toBe(true);

    setHostname("something.lovableproject.com");
    expect(isPreviewHost()).toBe(true);
  });

  it("does NOT treat the published app as a preview", () => {
    // Regression: the published site lives on a *.lovable.app subdomain too.
    // Matching all of lovable.app disabled forced updates and the morning
    // refresh for every operator on that URL.
    setHostname("threeplmgmt.lovable.app");
    expect(isPreviewHost()).toBe(false);

    setHostname("warehousewizard.app");
    expect(isPreviewHost()).toBe(false);

    setHostname("www.warehousewizard.app");
    expect(isPreviewHost()).toBe(false);

    setHostname("localhost");
    expect(isPreviewHost()).toBe(false);
  });
});
