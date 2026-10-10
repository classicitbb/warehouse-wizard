import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { __resetActiveWorkForTests, beginActiveWork } from "@/lib/active-work";

const mocks = vi.hoisted(() => ({
  fetchDeployedVersion: vi.fn<() => Promise<string | null>>(),
  applyForcedUpdate: vi.fn(async () => true),
  attempts: 0,
}));

vi.mock("@/lib/version-check", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/version-check")>();
  return { ...actual, fetchDeployedVersion: mocks.fetchDeployedVersion };
});

vi.mock("@/lib/release-policy", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/release-policy")>();
  return {
    ...actual,
    applyForcedUpdate: mocks.applyForcedUpdate,
    readForcedReloadAttempts: () => mocks.attempts,
  };
});

const { FirstTouchUpdateGate } = await import("@/components/first-touch-update-gate");

/** Flush the probe's promise chain without advancing fake timers. */
async function settle() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

function setOnline(value: boolean) {
  Object.defineProperty(navigator, "onLine", { configurable: true, value });
}

describe("FirstTouchUpdateGate", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    __resetActiveWorkForTests();
    mocks.fetchDeployedVersion.mockReset();
    mocks.applyForcedUpdate.mockReset();
    mocks.applyForcedUpdate.mockResolvedValue(true);
    mocks.attempts = 0;
    setOnline(true);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders nothing when the running build is current", async () => {
    mocks.fetchDeployedVersion.mockResolvedValue("1.30.6");
    const { container } = render(<FirstTouchUpdateGate runningVersion="1.30.6" />);
    await settle();
    expect(container).toBeEmptyDOMElement();
    expect(mocks.applyForcedUpdate).not.toHaveBeenCalled();
  });

  it("renders nothing, and changes nothing, when the host cannot be asked", async () => {
    mocks.fetchDeployedVersion.mockResolvedValue(null);
    const { container } = render(<FirstTouchUpdateGate runningVersion="1.30.6" />);
    await settle();
    expect(container).toBeEmptyDOMElement();
    expect(mocks.applyForcedUpdate).not.toHaveBeenCalled();
  });

  it("blocks the screen with an updating notice and applies when behind", async () => {
    mocks.fetchDeployedVersion.mockResolvedValue("1.30.7");
    render(<FirstTouchUpdateGate runningVersion="1.30.6" />);
    await settle();
    expect(screen.getByRole("alertdialog")).toHaveTextContent("Warehouse Wizard has been updated");
    expect(screen.getByRole("alertdialog")).toHaveTextContent("v1.30.7");
    expect(screen.getByRole("alertdialog")).toHaveTextContent("v1.30.6");
    expect(mocks.applyForcedUpdate).toHaveBeenCalledTimes(1);
    expect(mocks.applyForcedUpdate).toHaveBeenCalledWith("1.30.7");
  });

  it("defers, without blocking, while a scan/confirm flow is open — then applies once it ends", async () => {
    const endWork = beginActiveWork();
    mocks.fetchDeployedVersion.mockResolvedValue("1.30.7");
    render(<FirstTouchUpdateGate runningVersion="1.30.6" />);
    await settle();

    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(screen.getByRole("alert")).toHaveTextContent("applies as soon as you finish this task");
    expect(mocks.applyForcedUpdate).not.toHaveBeenCalled();

    endWork();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    await settle();
    expect(mocks.applyForcedUpdate).toHaveBeenCalledWith("1.30.7");
  });

  it("never purges while offline", async () => {
    setOnline(false);
    mocks.fetchDeployedVersion.mockResolvedValue("1.30.7");
    render(<FirstTouchUpdateGate runningVersion="1.30.6" />);
    await settle();
    // Offline, the probe is not even attempted — and nothing is purged.
    expect(mocks.fetchDeployedVersion).not.toHaveBeenCalled();
    expect(mocks.applyForcedUpdate).not.toHaveBeenCalled();
  });

  it("stops and reports instead of looping when reloads keep failing to move the device forward", async () => {
    mocks.attempts = 2;
    mocks.fetchDeployedVersion.mockResolvedValue("1.30.7");
    render(<FirstTouchUpdateGate runningVersion="1.30.6" />);
    await settle();
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(screen.getByRole("alert")).toHaveTextContent("could not be applied");
    expect(mocks.applyForcedUpdate).not.toHaveBeenCalled();
  });

  it("drops the blocking overlay and reports if a guard refuses the update", async () => {
    mocks.applyForcedUpdate.mockResolvedValue(false);
    mocks.fetchDeployedVersion.mockResolvedValue("1.30.7");
    render(<FirstTouchUpdateGate runningVersion="1.30.6" />);
    await settle();
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(screen.getByRole("alert")).toHaveTextContent("could not be applied");
  });
});
