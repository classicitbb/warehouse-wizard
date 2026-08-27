import { describe, expect, it, beforeEach } from "vitest";

import {
  DEFAULT_SCAN_COOLDOWN_MS,
  getScanCooldownMs,
  getScanDwellMs,
  isWithinScanCooldown,
  setScanCooldownMs,
  setScanDwellMs,
} from "@/lib/scan-settings";

describe("scan settings", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("defaults to instant dwell and a duplicate cooldown", () => {
    expect(getScanDwellMs()).toBe(0);
    expect(getScanCooldownMs()).toBe(DEFAULT_SCAN_COOLDOWN_MS);
  });

  it("persists and clamps configured values", () => {
    expect(setScanDwellMs(600)).toBe(600);
    expect(getScanDwellMs()).toBe(600);
    expect(setScanDwellMs(99999)).toBe(3000);
    expect(setScanCooldownMs(-5)).toBe(0);
  });

  it("ignores the same code inside the cooldown window", () => {
    const last = { value: "PLT-1", at: 1_000 };
    expect(isWithinScanCooldown(last, "PLT-1", 1_500, 1_500)).toBe(true);
    expect(isWithinScanCooldown(last, "PLT-1", 3_000, 1_500)).toBe(false);
    expect(isWithinScanCooldown(last, "PLT-2", 1_100, 1_500)).toBe(false);
    expect(isWithinScanCooldown(null, "PLT-1", 1_100, 1_500)).toBe(false);
  });
});
