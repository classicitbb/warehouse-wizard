import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const supabaseMocks = vi.hoisted(() => ({
  rpc: vi.fn(async () => ({ data: null, error: null }) as { data: unknown; error: unknown }),
  getSession: vi.fn(async () => ({ data: { session: { user: { id: "user-1" } } } })),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: supabaseMocks.rpc,
    auth: { getSession: supabaseMocks.getSession },
  },
}));

import {
  describeHabitsForCopilot,
  flushActionEvents,
  lastFailedAction,
  localHabitSummary,
  normalizeRoute,
  recentActions,
  recordAction,
  redactActionMetadata,
  resetHabitTracking,
  summarizeActions,
  type ActionEvent,
} from "@/lib/habit-tracking";

function event(partial: Partial<ActionEvent> & { action: string }): ActionEvent {
  return {
    route: "/receiving",
    target: null,
    outcome: "ok",
    durationMs: null,
    metadata: {},
    warehouseId: null,
    occurredAt: "2026-08-20T09:00:00.000Z",
    ...partial,
  };
}

beforeEach(() => {
  resetHabitTracking();
  supabaseMocks.rpc.mockClear();
  supabaseMocks.rpc.mockResolvedValue({ data: null, error: null });
  supabaseMocks.getSession.mockResolvedValue({ data: { session: { user: { id: "user-1" } } } });
});

afterEach(() => {
  resetHabitTracking();
  vi.useRealTimers();
});

describe("normalizeRoute", () => {
  it("collapses uuids so every detail view is not its own screen", () => {
    expect(normalizeRoute("/inventory/9f3c1a2b-4d5e-6f70-8a9b-0c1d2e3f4a5b")).toBe("/inventory/:id");
  });

  it("collapses numeric ids too", () => {
    expect(normalizeRoute("/pick-lists/4821")).toBe("/pick-lists/:id");
  });

  it("leaves ordinary paths and route words alone", () => {
    expect(normalizeRoute("/putaway-tasks")).toBe("/putaway-tasks");
    expect(normalizeRoute("/settings/users")).toBe("/settings/users");
  });

  it("falls back to root for an empty path", () => {
    expect(normalizeRoute("")).toBe("/");
  });
});

describe("redactActionMetadata", () => {
  it("redacts anything that looks like a credential or personal detail", () => {
    const result = redactActionMetadata({
      password: "hunter2",
      badgePin: "4821",
      apiToken: "abc",
      email: "operator@example.com",
      palletCode: "PLT-1",
    });
    expect(result.password).toBe("[redacted]");
    expect(result.badgePin).toBe("[redacted]");
    expect(result.apiToken).toBe("[redacted]");
    expect(result.email).toBe("[redacted]");
    expect(result.palletCode).toBe("PLT-1");
  });

  it("caps long strings rather than storing free text wholesale", () => {
    const result = redactActionMetadata({ note: "x".repeat(500) });
    expect(String(result.note).length).toBeLessThanOrEqual(161);
    expect(String(result.note).endsWith("…")).toBe(true);
  });

  it("summarises arrays and nested objects instead of walking them", () => {
    const result = redactActionMetadata({ ids: [1, 2, 3], nested: { deep: true } });
    expect(result.ids).toBe(3);
    expect(result.nested).toBe("[object]");
  });

  it("returns an empty object for a non-object", () => {
    expect(redactActionMetadata(null)).toEqual({});
    expect(redactActionMetadata("string")).toEqual({});
    expect(redactActionMetadata([1, 2])).toEqual({});
  });
});

describe("recordAction", () => {
  it("keeps breadcrumbs in order and normalises the route", () => {
    recordAction({ action: "route.view", route: "/inventory/9f3c1a2b-4d5e-6f70-8a9b-0c1d2e3f4a5b" });
    recordAction({ action: "putaway.confirm", route: "/putaway-tasks" });

    const trail = recentActions();
    expect(trail.map((entry) => entry.action)).toEqual(["route.view", "putaway.confirm"]);
    expect(trail[0].route).toBe("/inventory/:id");
  });

  it("ignores a blank action rather than storing junk", () => {
    expect(recordAction({ action: "   " })).toBeNull();
    expect(recentActions()).toHaveLength(0);
  });

  it("never throws, even when given hostile input", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => recordAction({ action: "weird", metadata: circular })).not.toThrow();
    expect(recentActions()).toHaveLength(1);
  });

  it("clamps a negative or non-finite duration", () => {
    const recorded = recordAction({ action: "scan", durationMs: -50 });
    expect(recorded?.durationMs).toBe(0);
    expect(recordAction({ action: "scan", durationMs: Number.NaN })?.durationMs).toBeNull();
  });

  it("finds the most recent failure, which is what a report is usually about", () => {
    recordAction({ action: "putaway.confirm", outcome: "error" });
    recordAction({ action: "route.view" });
    recordAction({ action: "receiving.save", outcome: "error" });
    recordAction({ action: "route.view" });

    expect(lastFailedAction()?.action).toBe("receiving.save");
  });

  it("returns null when nothing has failed", () => {
    recordAction({ action: "route.view" });
    expect(lastFailedAction()).toBeNull();
  });

  it("keeps only the most recent breadcrumbs", () => {
    for (let index = 0; index < 80; index++) recordAction({ action: `action-${index}` });
    const trail = recentActions(200);
    expect(trail.length).toBe(60);
    expect(trail[trail.length - 1].action).toBe("action-79");
  });
});

describe("summarizeActions", () => {
  const events = [
    event({ action: "route.view", route: "/receiving" }),
    event({ action: "route.view", route: "/receiving" }),
    event({ action: "route.view", route: "/putaway-tasks" }),
    event({ action: "putaway.confirm", route: "/putaway-tasks", outcome: "error" }),
    event({ action: "putaway.confirm", route: "/putaway-tasks", outcome: "error" }),
    event({ action: "putaway.confirm", route: "/putaway-tasks", outcome: "ok" }),
    event({ action: "receiving.save", route: "/receiving", outcome: "error", occurredAt: "2026-08-20T17:30:00.000Z" }),
  ];

  it("ranks the screens the operator actually lives on", () => {
    const summary = summarizeActions(events);
    expect(summary.sampleSize).toBe(7);
    expect(summary.topRoutes[0]).toEqual({ route: "/putaway-tasks", count: 4 });
    expect(summary.topRoutes[1]).toEqual({ route: "/receiving", count: 3 });
  });

  it("ranks actions by how often they are used", () => {
    const summary = summarizeActions(events);
    expect(summary.topActions[0]).toEqual({ action: "putaway.confirm", count: 3 });
  });

  it("surfaces where this operator repeatedly hits trouble", () => {
    const summary = summarizeActions(events);
    const worst = summary.frictionPoints[0];
    expect(worst.action).toBe("putaway.confirm");
    expect(worst.route).toBe("/putaway-tasks");
    expect(worst.errors).toBe(2);
    expect(worst.attempts).toBe(3);
    expect(worst.errorRate).toBeCloseTo(0.667, 3);
  });

  it("leaves clean actions out of the friction list", () => {
    const summary = summarizeActions(events);
    expect(summary.frictionPoints.some((point) => point.action === "route.view")).toBe(false);
  });

  it("counts activity by hour", () => {
    const summary = summarizeActions(events);
    expect(summary.activeHours[0]).toEqual({ hour: 9, count: 6 });
    expect(summary.activeHours).toContainEqual({ hour: 17, count: 1 });
  });

  it("returns an empty summary for no events", () => {
    const summary = summarizeActions([]);
    expect(summary).toEqual({
      sampleSize: 0,
      topRoutes: [],
      topActions: [],
      frictionPoints: [],
      activeHours: [],
    });
  });

  it("matches the local buffer summary", () => {
    recordAction({ action: "putaway.confirm", route: "/putaway-tasks", outcome: "error" });
    const summary = localHabitSummary();
    expect(summary.sampleSize).toBe(1);
    expect(summary.frictionPoints[0].action).toBe("putaway.confirm");
  });
});

describe("describeHabitsForCopilot", () => {
  it("says nothing when there is nothing to say", () => {
    expect(describeHabitsForCopilot(summarizeActions([]))).toBe("");
  });

  it("names the screens, actions and repeated trouble", () => {
    const note = describeHabitsForCopilot(
      summarizeActions([
        event({ action: "putaway.confirm", route: "/putaway-tasks", outcome: "error" }),
        event({ action: "putaway.confirm", route: "/putaway-tasks", outcome: "ok" }),
      ]),
    );
    expect(note).toContain("Most-used screens: /putaway-tasks (2)");
    expect(note).toContain("Most-used actions: putaway.confirm (2)");
    expect(note).toContain("Repeated trouble: putaway.confirm on /putaway-tasks — 1/2 failed");
  });
});

describe("flushActionEvents", () => {
  it("sends buffered events to the ingest RPC and clears the queue", async () => {
    recordAction({ action: "route.view", route: "/receiving", warehouseId: "wh-1" });
    const sent = await flushActionEvents();

    expect(sent).toBe(1);
    expect(supabaseMocks.rpc).toHaveBeenCalledWith(
      "record_user_action_events",
      expect.objectContaining({
        in_events: [
          expect.objectContaining({
            action: "route.view",
            route: "/receiving",
            warehouse_id: "wh-1",
            outcome: "ok",
          }),
        ],
      }),
    );

    supabaseMocks.rpc.mockClear();
    expect(await flushActionEvents()).toBe(0);
    expect(supabaseMocks.rpc).not.toHaveBeenCalled();
  });

  it("drops events rather than queueing them when nobody is signed in", async () => {
    supabaseMocks.getSession.mockResolvedValue({ data: { session: null } } as never);
    recordAction({ action: "route.view" });
    expect(await flushActionEvents()).toBe(0);
    expect(supabaseMocks.rpc).not.toHaveBeenCalled();
  });

  it("puts the batch back when the call fails, so a dropped connection loses nothing", async () => {
    supabaseMocks.rpc.mockResolvedValue({ data: null, error: { code: "08006", message: "connection lost" } });
    recordAction({ action: "route.view" });

    expect(await flushActionEvents()).toBe(0);

    supabaseMocks.rpc.mockResolvedValue({ data: null, error: null });
    expect(await flushActionEvents()).toBe(1);
  });

  it("stops trying for the session when the RPC is not deployed", async () => {
    supabaseMocks.rpc.mockResolvedValue({
      data: null,
      error: { code: "PGRST202", message: "function does not exist" },
    });
    recordAction({ action: "route.view" });
    expect(await flushActionEvents()).toBe(0);

    supabaseMocks.rpc.mockClear();
    recordAction({ action: "route.view" });
    expect(await flushActionEvents()).toBe(0);
    expect(supabaseMocks.rpc).not.toHaveBeenCalled();

    // Breadcrumbs still work — only the server ingest is off.
    expect(recentActions()).toHaveLength(2);
  });

  it("does not lose a breadcrumb when the network throws", async () => {
    supabaseMocks.rpc.mockRejectedValue(new Error("offline"));
    recordAction({ action: "route.view" });
    expect(await flushActionEvents()).toBe(0);
    expect(recentActions()).toHaveLength(1);
  });
});
