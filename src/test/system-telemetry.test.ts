import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const authMocks = vi.hoisted(() => ({
  getSession: vi.fn(async () => ({ data: { session: { user: { id: "user-1" } } } })),
}));
const systemCoreMocks = vi.hoisted(() => ({
  writeSystemLog: vi.fn(async () => undefined),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { getSession: authMocks.getSession } },
}));

vi.mock("@/features/system/system-core", () => ({
  writeSystemLog: systemCoreMocks.writeSystemLog,
}));

import {
  isIgnoredConsoleError,
  logErrorTelemetry,
  logSystemTelemetry,
  serializeError,
} from "@/lib/system-telemetry";

/** `logSystemTelemetry` is fire-and-forget; let its promise chain settle. */
async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function lastEntry() {
  const calls = systemCoreMocks.writeSystemLog.mock.calls as unknown as unknown[][];
  return calls.at(-1)?.[0] as {
    log_type: string;
    severity: string;
    title: string;
    message?: string;
    source: string;
    details: Record<string, any>;
  };
}

beforeEach(() => {
  systemCoreMocks.writeSystemLog.mockClear();
  authMocks.getSession.mockClear();
  authMocks.getSession.mockResolvedValue({ data: { session: { user: { id: "user-1" } } } });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("console filtering", () => {
  it("ignores the development-only React Fragment warning emitted by lovable-tagger", () => {
    expect(isIgnoredConsoleError(
      "Warning: Invalid prop `%s` supplied to `React.Fragment`. React.Fragment can only have `key` and `children` props.%s",
    )).toBe(true);
  });

  it("ignores other known React dev noise", () => {
    expect(isIgnoredConsoleError("Function components cannot be given refs")).toBe(true);
  });

  it("continues to report operational console errors", () => {
    expect(isIgnoredConsoleError("Failed to load inventory balances")).toBe(false);
    expect(isIgnoredConsoleError(new Error("Failed to load inventory balances"))).toBe(false);
  });
});

describe("serializeError", () => {
  it("keeps the name, message and stack of a real Error", () => {
    const error = new Error("Location is full");
    const serialized = serializeError(error);
    expect(serialized.name).toBe("Error");
    expect(serialized.message).toBe("Location is full");
    expect(typeof serialized.stack).toBe("string");
  });

  it("describes a thrown string without pretending it is an Error", () => {
    const serialized = serializeError("just a string");
    expect(serialized.message).toBe("just a string");
    expect(serialized.name).toBe("string");
  });

  it("describes a thrown object", () => {
    const serialized = serializeError({ code: "23505" });
    expect(serialized.message).toBe("Non-Error value thrown");
    expect(serialized.value).toEqual({ code: "23505" });
  });

  it("carries the cause when one is attached", () => {
    const serialized = serializeError(new Error("outer", { cause: new Error("inner") }));
    expect((serialized.cause as Record<string, unknown>).message).toBe("inner");
  });
});

describe("logSystemTelemetry", () => {
  it("writes the entry with runtime context attached", async () => {
    logSystemTelemetry({
      log_type: "info",
      severity: "info",
      title: "Pallet stored",
      source: "putaway",
      details: { palletCode: "PLT-1" },
    });
    await settle();

    const entry = lastEntry();
    expect(entry.title).toBe("Pallet stored");
    expect(entry.details.palletCode).toBe("PLT-1");
    expect(entry.details.runtime.appVersion).toBe("test");
    expect(entry.details.runtime.pathname).toBe(window.location.pathname);
  });

  it("redacts anything that looks like a credential", async () => {
    // Mutation variables get logged verbatim by the query-client fallback, and
    // some of those carry a password or a badge PIN.
    logSystemTelemetry({
      log_type: "error",
      severity: "error",
      title: "Mutation failed",
      source: "react-query.mutation",
      details: {
        variables: { email: "a@b.com", password: "hunter2", badge_pin: "4821", full_name: "Sam" },
      },
    });
    await settle();

    const variables = lastEntry().details.variables;
    expect(variables.password).toBe("[redacted]");
    expect(variables.badge_pin).toBe("[redacted]");
    expect(variables.full_name).toBe("Sam");
  });

  it("does not attempt a write for a signed-out visitor", async () => {
    // Unauthenticated writes just 401 — the login screen would otherwise
    // generate a stream of them.
    authMocks.getSession.mockResolvedValue({ data: { session: null } } as never);
    logSystemTelemetry({ log_type: "info", severity: "info", title: "Anything", source: "test" });
    await settle();
    expect(systemCoreMocks.writeSystemLog).not.toHaveBeenCalled();
  });

  it("survives a failing write instead of raising an unhandled rejection", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    systemCoreMocks.writeSystemLog.mockRejectedValueOnce(new Error("log table unavailable"));

    expect(() =>
      logSystemTelemetry({ log_type: "info", severity: "info", title: "Anything", source: "test" }),
    ).not.toThrow();
    await settle();

    expect(consoleError).toHaveBeenCalledWith(
      "[system-telemetry] writeSystemLog failed:",
      expect.any(Error),
    );
  });

  it("truncates a very long string rather than storing it whole", async () => {
    logSystemTelemetry({
      log_type: "error",
      severity: "error",
      title: "Long detail",
      source: "test",
      details: { blob: "x".repeat(6000) },
    });
    await settle();

    const blob = String(lastEntry().details.blob);
    expect(blob.length).toBeLessThan(6000);
    expect(blob.endsWith("...[truncated]")).toBe(true);
  });

  it("does not hang on a circular details object", async () => {
    const circular: Record<string, unknown> = { name: "loop" };
    circular.self = circular;

    logSystemTelemetry({
      log_type: "error",
      severity: "error",
      title: "Circular",
      source: "test",
      details: { circular },
    });
    await settle();

    expect(lastEntry().details.circular.self).toBe("[circular]");
  });
});

describe("logErrorTelemetry", () => {
  it("records the error under the requested source and severity", async () => {
    logErrorTelemetry({
      error: new Error("Chunk load failed"),
      title: "React render error",
      source: "react-error-boundary.app",
      severity: "critical",
      details: { boundaryLevel: "app" },
    });
    await settle();

    const entry = lastEntry();
    expect(entry.log_type).toBe("error");
    expect(entry.severity).toBe("critical");
    expect(entry.message).toBe("Chunk load failed");
    expect(entry.details.error.message).toBe("Chunk load failed");
    expect(entry.details.boundaryLevel).toBe("app");
  });

  it("defaults to error severity", async () => {
    logErrorTelemetry({ error: new Error("boom"), title: "Something", source: "test" });
    await settle();
    expect(lastEntry().severity).toBe("error");
  });

  it("still produces a usable message for a non-Error throw", async () => {
    logErrorTelemetry({ error: "plain string failure", title: "Something", source: "test" });
    await settle();
    expect(lastEntry().message).toBe("plain string failure");
  });
});
