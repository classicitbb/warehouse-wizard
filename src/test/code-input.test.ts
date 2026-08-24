import { describe, expect, it } from "vitest";

import {
  buildKnownCodeIndex,
  knownCodeError,
  palletBarcodeError,
  resolveKnownCode,
  stripCodeSeparators,
  UNKNOWN_LOCATION_CODE_MESSAGE,
} from "@/lib/code-input";

const index = buildKnownCodeIndex([
  { code: "A-01-A", zone_code: "DRY", warehouse_code: "WH1" },
  { code: "A-02-A", zone_code: "DRY", warehouse_code: "WH1" },
  { code: "J-08-C", zone_code: "DRY", warehouse_code: "WH1" },
]);

describe("pallet barcode rule", () => {
  it("keeps empty neutral and flags non PLT codes", () => {
    expect(palletBarcodeError("")).toBeNull();
    expect(palletBarcodeError("PLT-123")).toBeNull();
    expect(palletBarcodeError("A-01-A")).not.toBeNull();
  });
});

describe("dash-free location entry", () => {
  it("strips separators", () => {
    expect(stripCodeSeparators("a-01-a")).toBe("A01A");
  });

  it("autocorrects a unique dash-free code", () => {
    expect(resolveKnownCode(index, "J08C")).toEqual({ value: "J-08-C", corrected: true });
    expect(resolveKnownCode(index, "a01a")).toEqual({ value: "A-01-A", corrected: true });
  });

  it("corrects partial typing as it goes", () => {
    expect(resolveKnownCode(index, "J08").value).toBe("J-08-");
  });

  it("leaves ambiguous prefixes as typed", () => {
    expect(resolveKnownCode(index, "A0")).toEqual({ value: "A0", corrected: false });
  });

  it("leaves already-canonical codes untouched", () => {
    expect(resolveKnownCode(index, "A-01-A")).toEqual({ value: "A-01-A", corrected: false });
  });

  it("accepts dash-free values without flagging an error", () => {
    expect(knownCodeError(index, "J08C")).toBeNull();
    expect(knownCodeError(index, "A-01-A")).toBeNull();
  });

  it("still rejects codes that cannot exist", () => {
    expect(knownCodeError(index, "X-99-Z")).toBe(UNKNOWN_LOCATION_CODE_MESSAGE);
    expect(knownCodeError(index, "Z99")).toBe(UNKNOWN_LOCATION_CODE_MESSAGE);
  });
});
