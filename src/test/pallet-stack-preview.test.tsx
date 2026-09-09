import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PalletStackPreview } from "@/components/pallet-stack-preview";
import { buildPalletStackGeometry, type PalletStackSpec } from "@/lib/pallet-geometry";

const SPEC: PalletStackSpec = {
  packagesPerLayer: 12,
  layersPerPallet: 7,
  packageHeightMm: 225,
  layerColumns: 4,
};

// Deliberately no snapshot of SVG path data: it would fail on every legitimate
// tweak to the projection and teach the team to re-baseline without reading.

describe("PalletStackPreview", () => {
  it("paints one polygon per geometry quad plus its guides", () => {
    const spec = { ...SPEC, binClearanceMm: 2000 };
    const geometry = buildPalletStackGeometry(spec);
    const { container } = render(<PalletStackPreview spec={spec} />);
    expect(container.querySelectorAll("polygon")).toHaveLength(
      geometry.quads.length + geometry.guides.length,
    );
  });

  it("names the pack code and both verdicts to a screen reader", () => {
    render(<PalletStackPreview spec={{ ...SPEC, binClearanceMm: 2000 }} />);
    const label = screen.getByRole("img").getAttribute("aria-label") ?? "";
    expect(label).toContain("12 × 7");
    expect(label).toContain("Standard");
    expect(label).toContain("Fits");
  });

  it("tells a screen reader when the build is blocked, with the remedy", () => {
    render(<PalletStackPreview spec={{ ...SPEC, binClearanceMm: 1700 }} />);
    const label = screen.getByRole("img").getAttribute("aria-label") ?? "";
    expect(label).toContain("Blocked");
    expect(label).toContain("Drop to 6 layers");
  });

  it("describes a short pallet rather than only its total", () => {
    render(<PalletStackPreview spec={{ ...SPEC, actualPackages: 63 }} />);
    const label = screen.getByRole("img").getAttribute("aria-label") ?? "";
    expect(label).toContain("5 full layers");
    expect(label).toContain("3 of 12 on top");
  });

  it("renders an explanatory placeholder rather than an empty frame", () => {
    render(<PalletStackPreview spec={{ ...SPEC, packagesPerLayer: null }} />);
    expect(screen.getByRole("img").getAttribute("aria-label")).toContain("No pallet build");
  });

  it("hides the ceilings when asked", () => {
    const spec = { ...SPEC, binClearanceMm: 2000 };
    const withCeilings = render(<PalletStackPreview spec={spec} />).container.querySelectorAll("polygon").length;
    const without = render(
      <PalletStackPreview spec={spec} showCeilings={false} />,
    ).container.querySelectorAll("polygon").length;
    expect(without).toBeLessThan(withCeilings);
  });

  it("never emits NaN into a rendered attribute", () => {
    const { container } = render(
      <PalletStackPreview spec={{ ...SPEC, binClearanceMm: 2000, allowanceLengthMm: 1250, allowanceWidthMm: 1250 }} />,
    );
    expect(container.innerHTML).not.toContain("NaN");
  });

  it("uses theme tokens rather than hard-coded colours", () => {
    // AGENTS.md locks the palette in src/index.css; a literal hex here would
    // break the moment the theme moves.
    const { container } = render(<PalletStackPreview spec={{ ...SPEC, binClearanceMm: 1700 }} />);
    const html = container.innerHTML;
    expect(html).toContain("hsl(var(--primary))");
    expect(html).not.toMatch(/#[0-9a-fA-F]{6}/);
  });
});
