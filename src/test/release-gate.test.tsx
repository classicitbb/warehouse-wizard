import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { __resetActiveWorkForTests } from "@/lib/active-work";
import { __resetActivitySnapshotForTests, markActivity, readActivityAtLoad } from "@/lib/daily-refresh";
import { DEFAULT_RELEASE_POLICY, type ReleasePolicy } from "@/lib/release-policy";

const policyState = vi.hoisted(() => ({ policy: null as ReleasePolicy | null }));
const authMocks = vi.hoisted(() => ({ signOut: vi.fn(async () => undefined) }));
const releaseMocks = vi.hoisted(() => ({ sendClientHeartbeat: vi.fn(async () => undefined) }));

vi.mock("@/lib/release-policy", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/release-policy")>();
  return {
    ...actual,
    useReleasePolicy: () => ({
      policy: policyState.policy ?? actual.DEFAULT_RELEASE_POLICY,
      loaded: true,
      refresh: async () => {},
    }),
    sendClientHeartbeat: releaseMocks.sendClientHeartbeat,
  };
});

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({
    session: { access_token: "token" },
    profile: { user_code: "OP01", full_name: "Operator One" },
    signOut: authMocks.signOut,
  }),
}));

// The banner has its own test file; here it would only add noise.
vi.mock("@/components/forced-update-banner", () => ({ ForcedUpdateBanner: () => null }));

const { ReleaseGate } = await import("@/components/release-gate");

function setPolicy(overrides: Partial<ReleasePolicy>) {
  policyState.policy = { ...DEFAULT_RELEASE_POLICY, ...overrides };
}

describe("ReleaseGate", () => {
  beforeEach(() => {
    window.localStorage.clear();
    __resetActiveWorkForTests();
    __resetActivitySnapshotForTests();
    authMocks.signOut.mockClear();
    releaseMocks.sendClientHeartbeat.mockClear();
    setPolicy({});
  });

  it("reports the running build so the fleet count is answerable", () => {
    render(<ReleaseGate />);
    expect(releaseMocks.sendClientHeartbeat).toHaveBeenCalledWith("test", "OP01");
  });

  it("signs out a device that sat idle across the nightly cutoff", () => {
    markActivity(Date.now() - 48 * 60 * 60_000);

    // Reproduce the real load order: app start pins the pre-session snapshot,
    // and only then does this session record its own activity. Reading the live
    // stamp instead of the snapshot is what previously made the whole nightly
    // sign-out unreachable.
    readActivityAtLoad();
    markActivity(Date.now());

    setPolicy({ nightlySignoutEnabled: true, dailyRefreshHour: 4 });
    render(<ReleaseGate />);
    expect(authMocks.signOut).toHaveBeenCalledTimes(1);
  });

  it("leaves a device that has been used since the cutoff signed in", () => {
    markActivity(Date.now() - 60_000);
    setPolicy({ nightlySignoutEnabled: true, dailyRefreshHour: 4 });
    render(<ReleaseGate />);
    expect(authMocks.signOut).not.toHaveBeenCalled();
  });

  it("never signs out while the toggle is off", () => {
    markActivity(Date.now() - 48 * 60 * 60_000);
    readActivityAtLoad();
    setPolicy({ nightlySignoutEnabled: false });
    render(<ReleaseGate />);
    expect(authMocks.signOut).not.toHaveBeenCalled();
  });
});
