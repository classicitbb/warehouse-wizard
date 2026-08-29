import { describe, expect, it } from "vitest";

import {
  DEFAULT_CLEARANCE_SAFETY_MARGIN_MM,
  MM_PER_INCH,
  MM_PER_QUARTER_INCH,
  cmToMm,
  exceedsClearance,
  formatClearanceBlockReason,
  formatInches,
  formatMm,
  inchesToMm,
  mmToCm,
  mmToInches,
  mmToQuarterInches,
  mmToRoundedInches,
  quarterInchesToMm,
  resolveClearanceMarginMm,
  resolveEffectiveClearanceMm,
  resolveLocationClearanceMm,
  resolvePalletHeightMm,
  roundInchesToQuarter,
} from "@/lib/measure";

describe("unit constants", () => {
  it("pins the inch and quarter-inch definitions", () => {
    expect(MM_PER_INCH).toBe(25.4);
    expect(MM_PER_QUARTER_INCH).toBe(6.35);
    expect(MM_PER_INCH / 4).toBeCloseTo(MM_PER_QUARTER_INCH, 10);
    expect(DEFAULT_CLEARANCE_SAFETY_MARGIN_MM).toBe(76);
  });
});

describe("millimetre / centimetre conversion", () => {
  it("converts centimetres to whole millimetres", () => {
    expect(cmToMm(190)).toBe(1900);
    expect(cmToMm(22.4)).toBe(224);
    expect(cmToMm(null)).toBeNull();
    expect(cmToMm(undefined)).toBeNull();
  });

  it("converts millimetres back to centimetres", () => {
    expect(mmToCm(1905)).toBe(190.5);
    expect(mmToCm(null)).toBeNull();
  });
});

describe("inch conversion", () => {
  it("converts quarter inches to millimetres and back", () => {
    expect(quarterInchesToMm(4)).toBe(25);
    expect(quarterInchesToMm(300)).toBe(1905);
    expect(mmToQuarterInches(1905)).toBe(300);
  });

  it("round-trips every quarter inch in the realistic range", () => {
    // A quarter inch is 6.35 mm and integer-mm rounding costs at most 0.5 mm,
    // so round(round(q * 6.35) / 6.35) === q for every q. 0 to 2000 quarter
    // inches covers everything from a slip sheet to a 12.7 m mast.
    for (let q = 0; q <= 2000; q += 1) {
      expect(mmToQuarterInches(quarterInchesToMm(q))).toBe(q);
    }
  });

  it("keeps millimetre values stable across an inch round trip", () => {
    // The reverse trip is lossy by design — a quarter inch cannot represent
    // every millimetre — but never by more than half a quarter inch.
    for (let mm = 0; mm <= 3000; mm += 1) {
      const backAndForth = quarterInchesToMm(mmToQuarterInches(mm));
      expect(Math.abs(backAndForth - mm)).toBeLessThanOrEqual(MM_PER_QUARTER_INCH / 2 + 0.5);
    }
  });

  it("converts inches to whole millimetres", () => {
    expect(inchesToMm(75)).toBe(1905);
    expect(inchesToMm(3)).toBe(76);
    expect(mmToInches(1905)).toBeCloseTo(75, 10);
  });

  it("snaps inches to the nearest quarter", () => {
    expect(roundInchesToQuarter(8.66)).toBe(8.75);
    expect(roundInchesToQuarter(8.6)).toBe(8.5);
    expect(mmToRoundedInches(220)).toBe(8.75);
  });
});

describe("formatInches", () => {
  it("renders whole, half, and quarter inches without stray zeros", () => {
    expect(formatInches(1905)).toBe("75 in");
    expect(formatInches(220)).toBe("8.75 in");
    expect(formatInches(quarterInchesToMm(34))).toBe("8.5 in");
    expect(formatInches(quarterInchesToMm(33))).toBe("8.25 in");
  });

  it("accepts a custom suffix and returns empty for a missing value", () => {
    expect(formatInches(1905, { suffix: '"' })).toBe('75"');
    expect(formatInches(null)).toBe("");
    expect(formatInches(undefined)).toBe("");
  });

  it("renders raw millimetres for the block message", () => {
    expect(formatMm(1905)).toBe("1905 mm");
    expect(formatMm(null)).toBe("");
  });
});

describe("resolveLocationClearanceMm", () => {
  it("prefers the millimetre column", () => {
    expect(resolveLocationClearanceMm({ max_height_mm: 1900, max_height: 195 })).toBe(1900);
  });

  it("falls back to either centimetre column", () => {
    expect(resolveLocationClearanceMm({ max_height: 190 })).toBe(1900);
    expect(resolveLocationClearanceMm({ max_pallet_height_cm: 180 })).toBe(1800);
  });

  it("takes the least non-null ceiling, so no source can widen the rule", () => {
    expect(
      resolveLocationClearanceMm({ max_height_mm: 2000, max_height: 195, max_pallet_height_cm: 180 }),
    ).toBe(1800);
  });

  it("treats missing, zero, and negative ceilings as no restriction", () => {
    expect(resolveLocationClearanceMm({})).toBeNull();
    expect(resolveLocationClearanceMm(null)).toBeNull();
    expect(resolveLocationClearanceMm({ max_height_mm: 0, max_height: null })).toBeNull();
    expect(resolveLocationClearanceMm({ max_height_mm: -5 })).toBeNull();
  });
});

describe("clearance margin arithmetic", () => {
  it("defaults to the ratified 3 in", () => {
    expect(resolveClearanceMarginMm(null)).toBe(76);
    expect(resolveClearanceMarginMm(undefined)).toBe(76);
    expect(resolveClearanceMarginMm(-10)).toBe(76);
    expect(resolveClearanceMarginMm(0)).toBe(0);
    expect(resolveClearanceMarginMm(100)).toBe(100);
  });

  it("subtracts the margin from the bin ceiling", () => {
    expect(resolveEffectiveClearanceMm({ max_height_mm: 2000 }, 76)).toBe(1924);
    expect(resolveEffectiveClearanceMm({ max_height_mm: 2000 })).toBe(1924);
    expect(resolveEffectiveClearanceMm({ max_height_mm: 2000 }, 0)).toBe(2000);
  });

  it("never returns a negative usable clearance", () => {
    expect(resolveEffectiveClearanceMm({ max_height_mm: 50 }, 76)).toBe(0);
  });

  it("stays null for a bin with no recorded ceiling", () => {
    expect(resolveEffectiveClearanceMm({}, 76)).toBeNull();
  });
});

describe("resolvePalletHeightMm", () => {
  it("prefers the millimetre snapshot", () => {
    expect(resolvePalletHeightMm({ standard_height_mm: 1905, height: 22 })).toBe(1905);
  });

  it("falls back to the legacy centimetre column", () => {
    expect(resolvePalletHeightMm({ height: 190.5 })).toBe(1905);
  });

  it("returns null when the pallet has no recorded height", () => {
    expect(resolvePalletHeightMm({})).toBeNull();
    expect(resolvePalletHeightMm({ standard_height_mm: 0, height: 0 })).toBeNull();
    expect(resolvePalletHeightMm(null)).toBeNull();
  });
});

describe("exceedsClearance", () => {
  it("blocks a pallet that eats into the safety margin", () => {
    // 2000 mm bay at a 76 mm margin accepts 1924 mm.
    expect(exceedsClearance({ palletHeightMm: 1905, clearanceMm: 2000, marginMm: 76 })).toBe(false);
    expect(exceedsClearance({ palletHeightMm: 1930, clearanceMm: 2000, marginMm: 76 })).toBe(true);
    expect(exceedsClearance({ palletHeightMm: 1924, clearanceMm: 2000, marginMm: 76 })).toBe(false);
  });

  it("blocks a 1905 mm pallet in a 1900 mm bin", () => {
    expect(exceedsClearance({ palletHeightMm: 1905, clearanceMm: 1900, marginMm: 76 })).toBe(true);
  });

  it("never blocks when either side is unknown", () => {
    expect(exceedsClearance({ palletHeightMm: null, clearanceMm: 1900 })).toBe(false);
    expect(exceedsClearance({ palletHeightMm: 1905, clearanceMm: null })).toBe(false);
    expect(exceedsClearance({})).toBe(false);
  });
});

describe("formatClearanceBlockReason", () => {
  it("quotes actual millimetres on both sides plus the margin", () => {
    const reason = formatClearanceBlockReason({
      palletHeightMm: 1905,
      clearanceMm: 1900,
      marginMm: 76,
    });
    expect(reason).toContain("1905 mm pallet");
    expect(reason).toContain("1900 mm bin");
    expect(reason).toContain("76 mm margin");
  });

  it("names the default margin when the warehouse has none set", () => {
    expect(
      formatClearanceBlockReason({ palletHeightMm: 1905, clearanceMm: 1900, marginMm: null }),
    ).toContain("76 mm margin");
  });
});
