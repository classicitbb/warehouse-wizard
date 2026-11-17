import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const call = vi.fn();

vi.mock("@/lib/platform-support", () => {
  class PlatformSupportError extends Error {
    constructor(message: string, public status: number) {
      super(message);
    }
  }
  return { callPlatformSupport: (...args: unknown[]) => call(...args), PlatformSupportError };
});

import { PlatformSupportError } from "@/lib/platform-support";
import { listPlatformLogs, queuePlatformLog } from "@/features/system/system-log-platform";

describe("system-log-platform", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    call.mockReset();
  });
  afterEach(() => vi.useRealTimers());

  it("batches queued entries into one platform write", async () => {
    call.mockResolvedValue({ ids: [] });
    await queuePlatformLog({ log_type: "error", severity: "error", title: "a" });
    await queuePlatformLog({ log_type: "info", severity: "info", title: "b" });
    expect(call).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2_100);
    expect(call).toHaveBeenCalledTimes(1);
    const [action, args] = call.mock.calls[0];
    expect(action).toBe("logs.write");
    expect((args as { entries: Array<{ title: string }> }).entries.map((e) => e.title)).toEqual(["a", "b"]);
  });

  it("shapes rows like the old system_logs rows", async () => {
    call.mockResolvedValue({ logs: [{ id: "1", tenant_user_id: "u1", tenant_user_email: "a@b.c" }] });
    const rows = await listPlatformLogs({ limit: 5 });
    expect(rows[0]).toMatchObject({ id: "1", created_by: "u1", profiles: { email: "a@b.c" } });
  });

  it("returns no rows to roles that cannot read the log", async () => {
    call.mockRejectedValue(new PlatformSupportError("Your role cannot do that.", 403));
    await expect(listPlatformLogs({ severity: "critical" })).resolves.toEqual([]);
  });
});
