import { describe, expect, it } from "vitest";
import { getScanTargetRect, isRegionInsideTarget } from "@/lib/scan-target";

describe("scan target", () => {
  it("centres a square target inside a 16:9 frame", () => {
    const target = getScanTargetRect("generic", 16 / 9);
    expect(target.height).toBeCloseTo(0.68, 5);
    expect(target.width).toBeCloseTo(0.68 * (9 / 16), 5);
    expect(target.x + target.width / 2).toBeCloseTo(0.5, 5);
    expect(target.y + target.height / 2).toBeCloseTo(0.5, 5);
  });

  it("uses a taller portrait target for container numbers", () => {
    const target = getScanTargetRect("containerNumber", 16 / 9);
    expect(target.height).toBeCloseTo(0.82, 5);
    expect(target.width / target.height).toBeLessThan(1);
  });

  it("accepts a code fully inside the target", () => {
    const target = getScanTargetRect("generic", 16 / 9);
    expect(isRegionInsideTarget({ x: 0.45, y: 0.45, width: 0.05, height: 0.05 }, target)).toBe(true);
  });

  it("rejects a code outside the target", () => {
    const target = getScanTargetRect("generic", 16 / 9);
    expect(isRegionInsideTarget({ x: 0.02, y: 0.05, width: 0.1, height: 0.05 }, target)).toBe(false);
    expect(isRegionInsideTarget({ x: 0.8, y: 0.8, width: 0.15, height: 0.1 }, target)).toBe(false);
  });

  it("accepts when no geometry is reported", () => {
    const target = getScanTargetRect("generic", 16 / 9);
    expect(isRegionInsideTarget(null, target)).toBe(true);
    expect(isRegionInsideTarget({ x: 0, y: 0, width: 0, height: 0 }, target)).toBe(true);
  });
});
