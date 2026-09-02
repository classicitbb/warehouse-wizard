import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { __resetActiveWorkForTests, beginActiveWork } from "@/lib/active-work";
import { DEFAULT_RELEASE_POLICY, type ReleasePolicy } from "@/lib/release-policy";

const policyState = vi.hoisted(() => ({ outdated: true }));

const releaseMocks = vi.hoisted(() => ({ applyForcedUpdate: vi.fn(async () => true) }));

vi.mock("@/lib/release-policy", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/release-policy")>();
  return {
    ...actual,
    // The real comparison is unit-tested separately; here the build under test
    // is always "test", so outdated-ness is driven by the fixture.
    isBuildOutdated: () => policyState.outdated,
    applyForcedUpdate: releaseMocks.applyForcedUpdate,
  };
});

const { ForcedUpdateBanner } = await import("@/components/forced-update-banner");

function policy(overrides: Partial<ReleasePolicy> = {}): ReleasePolicy {
  return { ...DEFAULT_RELEASE_POLICY, minRequiredVersion: "1.29.3", ...overrides };
}

describe("ForcedUpdateBanner", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    window.localStorage.clear();
    window.sessionStorage.clear();
    __resetActiveWorkForTests();
    releaseMocks.applyForcedUpdate.mockClear();
    policyState.outdated = true;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("stays out of the way when the build satisfies the policy", () => {
    policyState.outdated = false;
    render(<ForcedUpdateBanner policy={policy()} />);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("counts down and shows the admin's message", () => {
    render(<ForcedUpdateBanner policy={policy({ graceMinutes: 10, message: "Hot fix: pallet moves" })} />);
    expect(screen.getByRole("alert")).toHaveTextContent("New version required — reloading in 10:00");
    expect(screen.getByText("Hot fix: pallet moves")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(61_000);
    });
    expect(screen.getByRole("alert")).toHaveTextContent("reloading in 8:59");
  });

  it("reloads once the grace period expires", () => {
    render(<ForcedUpdateBanner policy={policy({ graceMinutes: 1 })} />);
    expect(releaseMocks.applyForcedUpdate).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(61_000);
    });
    expect(releaseMocks.applyForcedUpdate).toHaveBeenCalledWith("1.29.3");
  });

  it("waits for an in-progress scan/confirm flow before reloading", () => {
    const release = beginActiveWork();
    render(<ForcedUpdateBanner policy={policy({ graceMinutes: 1 })} />);

    act(() => {
      vi.advanceTimersByTime(61_000);
    });
    expect(releaseMocks.applyForcedUpdate).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("as soon as you finish this task");

    release();
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(releaseMocks.applyForcedUpdate).toHaveBeenCalledWith("1.29.3");
  });

  it("gives up rather than looping when reloads do not land on the new build", () => {
    window.localStorage.setItem(
      "warehouseWizard.forcedUpdate.attempts",
      JSON.stringify({ version: "1.29.3", count: 2 }),
    );
    render(<ForcedUpdateBanner policy={policy({ graceMinutes: 1 })} />);

    act(() => {
      vi.advanceTimersByTime(120_000);
    });
    expect(releaseMocks.applyForcedUpdate).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("could not be applied");
  });
});
