import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {},
}));

vi.mock("@/features/system/system-core", () => ({
  writeSystemLog: vi.fn(),
}));

import { isIgnoredConsoleError } from "@/lib/system-telemetry";

describe("system telemetry console filtering", () => {
  it("ignores the development-only React Fragment warning emitted by lovable-tagger", () => {
    expect(isIgnoredConsoleError(
      "Warning: Invalid prop `%s` supplied to `React.Fragment`. React.Fragment can only have `key` and `children` props.%s",
    )).toBe(true);
  });

  it("continues to report operational console errors", () => {
    expect(isIgnoredConsoleError("Failed to load inventory balances")).toBe(false);
    expect(isIgnoredConsoleError(new Error("Failed to load inventory balances"))).toBe(false);
  });
});
