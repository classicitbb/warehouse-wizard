import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const supabaseMocks = vi.hoisted(() => ({
  invoke: vi.fn(async () => ({ data: { answer: "ok", trace: [] }, error: null }) as any),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke: supabaseMocks.invoke } },
}));

import {
  buildProcedureContext,
  copilotMessageText,
  copilotMessageTrace,
  copilotRequestBody,
  describeErrorForReport,
  isCopilotPreviewHost,
  onCopilotReportRequest,
  requestCopilotReport,
  setCopilotPreviewOverride,
} from "@/features/copilot/copilot-core";
import { recordAction, resetHabitTracking } from "@/lib/habit-tracking";

beforeEach(() => {
  supabaseMocks.invoke.mockReset();
  supabaseMocks.invoke.mockResolvedValue({ data: { answer: "ok", trace: [] }, error: null });
  resetHabitTracking();
  window.localStorage.clear();
});

afterEach(() => {
  resetHabitTracking();
});

describe("streaming Copilot request", () => {
  it("sends the screen, the question and the grounding procedures", async () => {
    const body = copilotRequestBody({ question: "what is open?", pathname: "/putaway-tasks" });
    expect(body.context.screen).toBe("/putaway-tasks");
    expect(body.context.appVersion).toBe("test");
    expect(Array.isArray(body.procedures)).toBe(true);
  });

  it("attaches the operator's recent actions and habits as report evidence", async () => {
    recordAction({ action: "putaway.confirm", route: "/putaway-tasks", outcome: "error" });
    const context = copilotRequestBody({ question: "it will not confirm", pathname: "/putaway-tasks" }).context;
    expect(context.breadcrumbs).toHaveLength(1);
    expect(context.breadcrumbs[0].action).toBe("putaway.confirm");
    expect(context.habits.frictionPoints[0].action).toBe("putaway.confirm");
  });

  it("reads streamed message text and tool evidence", () => {
    const message = {
      id: "a1",
      role: "assistant" as const,
      parts: [
        { type: "text" as const, text: "3 pallets" },
        { type: "dynamic-tool" as const, toolName: "search_inventory", toolCallId: "t1", state: "output-available" as const, input: {}, output: { count: 3 } },
      ],
    };
    expect(copilotMessageText(message)).toBe("3 pallets");
    expect(copilotMessageTrace(message)[0]).toMatchObject({ tool: "search_inventory", rows: 3 });
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
