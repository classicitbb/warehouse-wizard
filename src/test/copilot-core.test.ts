import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const supabaseMocks = vi.hoisted(() => ({
  invoke: vi.fn(async () => ({ data: { answer: "ok", trace: [] }, error: null }) as any),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke: supabaseMocks.invoke } },
}));

import {
  askCopilot,
  buildProcedureContext,
  describeErrorForReport,
  isCopilotPreviewHost,
  onCopilotReportRequest,
  requestCopilotReport,
  setCopilotPreviewOverride,
} from "@/features/copilot/copilot-core";
import { recordAction, resetHabitTracking } from "@/lib/habit-tracking";

/** The mock is declared with no arguments, so read the call args positionally. */
function invokeBody(index = 0): any {
  const args = supabaseMocks.invoke.mock.calls[index] as unknown as [string, { body: any }];
  return args[1].body;
}

beforeEach(() => {
  supabaseMocks.invoke.mockReset();
  supabaseMocks.invoke.mockResolvedValue({ data: { answer: "ok", trace: [] }, error: null });
  resetHabitTracking();
  window.localStorage.clear();
});

afterEach(() => {
  resetHabitTracking();
});

describe("askCopilot", () => {
  it("sends the screen, the question and the grounding procedures", async () => {
    await askCopilot({ question: "what is open?", pathname: "/putaway-tasks", history: [] });

    const body = invokeBody(0);
    expect(body.message).toBe("what is open?");
    expect(body.context.screen).toBe("/putaway-tasks");
    expect(body.context.appVersion).toBe("test");
    expect(Array.isArray(body.procedures)).toBe(true);
  });

  it("attaches the operator's recent actions and habits as report evidence", async () => {
    recordAction({ action: "putaway.confirm", route: "/putaway-tasks", outcome: "error" });
    await askCopilot({ question: "it will not confirm", pathname: "/putaway-tasks", history: [] });

    const context = invokeBody(0).context;
    expect(context.breadcrumbs).toHaveLength(1);
    expect(context.breadcrumbs[0].action).toBe("putaway.confirm");
    expect(context.habits.frictionPoints[0].action).toBe("putaway.confirm");
  });

  it("returns the answer and trace on success", async () => {
    supabaseMocks.invoke.mockResolvedValue({
      data: { answer: "3 pallets", trace: [{ tool: "search_inventory", input: {}, outcome: "ok", rows: 3 }] },
      error: null,
    });

    const result = await askCopilot({ question: "stock?", pathname: "/inventory", history: [] });
    expect(result.answer).toBe("3 pallets");
    expect(result.trace[0].tool).toBe("search_inventory");
  });

  it("surfaces the server's own message rather than a generic transport error", async () => {
    // A 429 from the gateway carries useful wording; "Edge Function returned a
    // non-2xx status code" does not.
    supabaseMocks.invoke.mockResolvedValue({
      data: null,
      error: Object.assign(new Error("Edge Function returned a non-2xx status code"), {
        context: { text: async () => JSON.stringify({ error: "The copilot is rate limited right now." }) },
      }),
    });

    await expect(
      askCopilot({ question: "stock?", pathname: "/inventory", history: [] }),
    ).rejects.toThrow("The copilot is rate limited right now.");
  });

  it("keeps the transport message when the body is not readable JSON", async () => {
    supabaseMocks.invoke.mockResolvedValue({
      data: null,
      error: Object.assign(new Error("Failed to send a request"), {
        context: { text: async () => "<html>502</html>" },
      }),
    });

    await expect(
      askCopilot({ question: "stock?", pathname: "/inventory", history: [] }),
    ).rejects.toThrow("Failed to send a request");
  });

  it("treats an error field in a 200 payload as a failure", async () => {
    supabaseMocks.invoke.mockResolvedValue({ data: { error: "Ask a question first" }, error: null });

    await expect(
      askCopilot({ question: "x", pathname: "/inventory", history: [] }),
    ).rejects.toThrow("Ask a question first");
  });

  it("tolerates a payload with no answer", async () => {
    supabaseMocks.invoke.mockResolvedValue({ data: {}, error: null });
    const result = await askCopilot({ question: "x", pathname: "/inventory", history: [] });
    expect(result).toEqual({ answer: "", trace: [], context: undefined });
  });
});

describe("buildProcedureContext", () => {
  it("always includes the current screen's overview", () => {
    const procedures = buildProcedureContext("/putaway-tasks", "");
    expect(procedures.length).toBeGreaterThan(0);
    expect(procedures[0].title).toContain("screen overview");
  });

  it("caps how much help text is shipped with a question", () => {
    const procedures = buildProcedureContext("/putaway-tasks", "pallet location receiving pick count");
    expect(procedures.length).toBeLessThanOrEqual(8);
    for (const procedure of procedures) {
      expect(procedure.text.length).toBeLessThanOrEqual(2500);
    }
  });

  it("does not repeat the same article twice", () => {
    const ids = buildProcedureContext("/receiving", "receiving").map((procedure) => procedure.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("report requests", () => {
  it("delivers a request to a listening panel", () => {
    const handler = vi.fn();
    const unsubscribe = onCopilotReportRequest(handler);

    requestCopilotReport({ message: "It will not scan", route: "/putaway-tasks" });

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ message: "It will not scan", route: "/putaway-tasks" }),
    );
    unsubscribe();
  });

  it("stops delivering once unsubscribed", () => {
    const handler = vi.fn();
    onCopilotReportRequest(handler)();
    requestCopilotReport({ message: "anything" });
    expect(handler).not.toHaveBeenCalled();
  });

  it("ignores a request with no message", () => {
    const handler = vi.fn();
    const unsubscribe = onCopilotReportRequest(handler);
    requestCopilotReport({ message: "" });
    expect(handler).not.toHaveBeenCalled();
    unsubscribe();
  });

  it("opens a report with the screen and the message the operator actually saw", () => {
    const opener = describeErrorForReport(new Error("Location A-08-C is full"), "/putaway-tasks");
    expect(opener).toContain("/putaway-tasks");
    expect(opener).toContain("Location A-08-C is full");
    expect(opener).toContain("report it");
  });

  it("describes a non-Error failure without leaking [object Object]", () => {
    expect(describeErrorForReport({ code: 500 }, "/receiving")).toContain("an unexpected error");
  });
});

describe("preview gating", () => {
  it("stays hidden on the published hosts until it is signed off", () => {
    // jsdom serves localhost, which is not a published host.
    expect(isCopilotPreviewHost()).toBe(true);
  });

  it("honours an explicit opt-in and can be turned back off", () => {
    setCopilotPreviewOverride(true);
    expect(window.localStorage.getItem("wms.copilot.preview")).toBe("on");
    setCopilotPreviewOverride(false);
    expect(window.localStorage.getItem("wms.copilot.preview")).toBeNull();
  });
});
