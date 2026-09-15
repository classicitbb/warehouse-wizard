import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Behavioural coverage for the two client-side rules that are easy to get
 * wrong and impossible to notice until push silently stops working on the
 * floor: the VAPID key cache, and the key-rotation retry.
 */

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke: mocks.invoke } },
}));

type FakeSubscription = {
  endpoint: string;
  toJSON: () => { endpoint: string; keys: { p256dh: string; auth: string } };
  unsubscribe: () => Promise<boolean>;
};

function makeSubscription(endpoint: string): FakeSubscription {
  return {
    endpoint,
    toJSON: () => ({ endpoint, keys: { p256dh: "p256dh-key", auth: "auth-key" } }),
    unsubscribe: vi.fn(async () => true),
  };
}

let getSubscription: ReturnType<typeof vi.fn>;
let subscribe: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  vi.resetModules();
  mocks.invoke.mockReset();
  window.localStorage.clear();

  getSubscription = vi.fn(async () => null);
  subscribe = vi.fn(async () => makeSubscription("https://push.example/new"));

  Object.defineProperty(window, "Notification", {
    configurable: true,
    writable: true,
    value: { permission: "granted" },
  });
  Object.defineProperty(window, "PushManager", { configurable: true, writable: true, value: function () {} });
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    writable: true,
    value: {
      ready: Promise.resolve({ pushManager: { getSubscription, subscribe } }),
    },
  });
  // ensurePushSubscription drains a rotation handover through the Cache API.
  Object.defineProperty(window, "caches", {
    configurable: true,
    writable: true,
    value: { open: vi.fn(async () => ({ match: vi.fn(async () => undefined), delete: vi.fn(async () => true) })) },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("fetchVapidPublicKey", () => {
  it("caches the key so every mount does not hit the edge function", async () => {
    mocks.invoke.mockResolvedValue({ data: { publicKey: "BKey123" }, error: null });
    const { fetchVapidPublicKey } = await import("@/lib/push-subscription");

    expect(await fetchVapidPublicKey()).toBe("BKey123");
    expect(await fetchVapidPublicKey()).toBe("BKey123");
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
  });

  it("re-fetches once the cached key is older than a day", async () => {
    window.localStorage.setItem(
      "warehouseWizard.push.vapidPublicKey",
      JSON.stringify({ publicKey: "BStale", fetchedAt: Date.now() - 25 * 60 * 60 * 1000 }),
    );
    mocks.invoke.mockResolvedValue({ data: { publicKey: "BFresh" }, error: null });
    const { fetchVapidPublicKey } = await import("@/lib/push-subscription");

    expect(await fetchVapidPublicKey()).toBe("BFresh");
  });

  it("returns null rather than throwing when the key is not configured", async () => {
    mocks.invoke.mockResolvedValue({ data: { publicKey: null }, error: null });
    const { fetchVapidPublicKey } = await import("@/lib/push-subscription");
    expect(await fetchVapidPublicKey()).toBeNull();
  });
});

describe("ensurePushSubscription", () => {
  it("does nothing until permission is granted", async () => {
    (window as unknown as { Notification: { permission: string } }).Notification.permission = "default";
    const { ensurePushSubscription } = await import("@/lib/push-subscription");

    expect(await ensurePushSubscription()).toBe(false);
    expect(subscribe).not.toHaveBeenCalled();
  });

  it("re-registers an existing subscription instead of replacing it", async () => {
    // Called on every app boot, including after the version purge unregisters
    // the worker - it must stay idempotent.
    getSubscription.mockResolvedValue(makeSubscription("https://push.example/existing"));
    mocks.invoke.mockResolvedValue({ data: { saved: true }, error: null });
    const { ensurePushSubscription } = await import("@/lib/push-subscription");

    expect(await ensurePushSubscription()).toBe(true);
    expect(subscribe).not.toHaveBeenCalled();
    const subscribeCall = mocks.invoke.mock.calls.find((call) => call[1]?.body?.action === "subscribe");
    expect(subscribeCall?.[1].body.subscription.endpoint).toBe("https://push.example/existing");
  });

  it("subscribes fresh when the worker has none", async () => {
    mocks.invoke.mockImplementation(async (_fn: string, opts: { body: { action: string } }) =>
      opts.body.action === "config"
        ? { data: { publicKey: "BKey123" }, error: null }
        : { data: { saved: true }, error: null },
    );
    const { ensurePushSubscription } = await import("@/lib/push-subscription");

    expect(await ensurePushSubscription()).toBe(true);
    expect(subscribe).toHaveBeenCalledWith(
      expect.objectContaining({ userVisibleOnly: true, applicationServerKey: expect.any(Uint8Array) }),
    );
  });

  it("recovers from a rotated VAPID key instead of staying broken", async () => {
    // InvalidStateError is the browser saying "you already hold a subscription
    // under a different applicationServerKey". Without the retry a key
    // rotation bricks push on every device that was already subscribed.
    const stale = makeSubscription("https://push.example/stale");
    getSubscription.mockResolvedValueOnce(null).mockResolvedValueOnce(stale);

    const invalidState = Object.assign(new Error("already subscribed"), { name: "InvalidStateError" });
    subscribe
      .mockRejectedValueOnce(invalidState)
      .mockResolvedValueOnce(makeSubscription("https://push.example/rotated"));

    window.localStorage.setItem(
      "warehouseWizard.push.vapidPublicKey",
      JSON.stringify({ publicKey: "BOldKey", fetchedAt: Date.now() }),
    );
    mocks.invoke.mockImplementation(async (_fn: string, opts: { body: { action: string } }) =>
      opts.body.action === "config"
        ? { data: { publicKey: "BRotatedKey" }, error: null }
        : { data: { ok: true }, error: null },
    );

    const { ensurePushSubscription } = await import("@/lib/push-subscription");
    expect(await ensurePushSubscription()).toBe(true);

    expect(stale.unsubscribe).toHaveBeenCalled();
    const unsubscribeCall = mocks.invoke.mock.calls.find((call) => call[1]?.body?.action === "unsubscribe");
    expect(unsubscribeCall?.[1].body.endpoint).toBe("https://push.example/stale");
    expect(subscribe).toHaveBeenCalledTimes(2);
  });

  it("reports failure rather than throwing when the browser refuses", async () => {
    subscribe.mockRejectedValue(new Error("push service unavailable"));
    mocks.invoke.mockResolvedValue({ data: { publicKey: "BKey123" }, error: null });
    const { ensurePushSubscription } = await import("@/lib/push-subscription");

    expect(await ensurePushSubscription()).toBe(false);
  });
});
