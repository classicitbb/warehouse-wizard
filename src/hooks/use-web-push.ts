/**
 * Warehouse notifications on the client: subscribe, ring, sweep.
 *
 * Three jobs, deliberately in one hook because they share the seen-event set:
 *
 * 1. Keep this device subscribed to Web Push. Idempotent, and re-run on mount
 *    because the version purge in src/main.tsx and the forced update in
 *    src/lib/release-policy.ts both unregister the service worker, which
 *    destroys the subscription.
 *
 * 2. Ring when a pick ticket is released. Two paths converge here: the service
 *    worker posts WW_PUSH the moment a push lands (~1s), and a poll of
 *    notification_events catches anything missed (<=30s) - the poll is what
 *    covers users who denied push but have the app open. Both funnel through
 *    the same dedupe, so a ring never doubles.
 *
 * 3. Sweep undispatched events. The client that created the work normally
 *    invokes the dispatcher itself; this covers the tab that died in between.
 *    Safe to run from every device at once because the claim inside
 *    claim_notification_dispatch is a compare-and-set.
 *
 * Like useReorderAlertNotifications, the hook is completely inert when
 * `enabled` is false: no query, no listener, no sound. src/test/setup.ts hard
 * blocks network calls, so an ungated hook would fail the app-shell test.
 */

import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { isFloorAudioPrimed } from "@/lib/audio-unlock";
import { ensurePushSubscription } from "@/lib/push-subscription";
import { playPickTicketRing } from "@/lib/floor-feedback";

const SEEN_EVENTS_STORAGE_KEY = "warehouseWizard.notifications.seenEventIds";
const MAX_SEEN_EVENTS = 200;

export type NotificationEventRow = {
  id: string;
  kind: "pick_list_created" | "putaway_task_created";
  group_key: string | null;
  payload: Record<string, unknown> | null;
  created_at: string;
  push_dispatched_at: string | null;
};

function readSeenIds(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(SEEN_EVENTS_STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : []);
  } catch {
    return new Set();
  }
}

function writeSeenIds(ids: Set<string>) {
  if (typeof window === "undefined") return;
  try {
    // Trimmed from the front: this set only exists to stop a repeat ring, so
    // old ids are worthless and an unbounded array would grow forever.
    const trimmed = Array.from(ids).slice(-MAX_SEEN_EVENTS);
    window.localStorage.setItem(SEEN_EVENTS_STORAGE_KEY, JSON.stringify(trimmed));
  } catch {
    // Storage unavailable - worst case a ring repeats after a reload.
  }
}

/**
 * Ask the server to send. Retries once when the dispatcher defers.
 *
 * A put-away batch commits as N separate transactions, so the dispatcher
 * waits out a short quiet period before counting the group - the first
 * invoke almost always comes back deferred. Without the retry the batch would
 * sit until the 60s sweeper noticed it.
 */
async function invokeDispatch(eventId: string, allowRetry = true) {
  try {
    const { data } = await supabase.functions.invoke("push-notify", {
      body: { action: "dispatch", eventId },
    });
    if (allowRetry && (data as { deferred?: boolean } | null)?.deferred) {
      window.setTimeout(() => void invokeDispatch(eventId, false), 5_000);
    }
  } catch (error) {
    console.warn("Could not dispatch the warehouse notification", error);
  }
}

/** The newest event this user can see that has not gone out yet. */
async function findPendingEvent(match: { entityTable?: string; entityId?: string; kind?: string }) {
  let query = (supabase.from as never as (t: string) => any)("notification_events")
    .select("id")
    .is("push_dispatched_at", null)
    .order("created_at", { ascending: false })
    .limit(1);
  if (match.entityTable) query = query.eq("entity_table", match.entityTable);
  if (match.entityId) query = query.eq("entity_id", match.entityId);
  if (match.kind) query = query.eq("kind", match.kind);
  const { data, error } = await query.maybeSingle();
  if (error) return null;
  return (data?.id as string | undefined) ?? null;
}

/**
 * Look up the event a just-created entity produced, then dispatch it.
 *
 * The trigger writes notification_events after the INSERT, so the caller knows
 * the pick list / putaway task id but not the event id.
 */
export async function dispatchNotificationForEntity(entityTable: string, entityId: string) {
  try {
    const eventId = await findPendingEvent({ entityTable, entityId });
    if (eventId) await invokeDispatch(eventId);
  } catch (error) {
    console.warn("Could not resolve the warehouse notification event", error);
  }
}

/**
 * Dispatch the newest pending event of a kind.
 *
 * For put-away the caller has task NUMBERS, not ids - and it does not matter:
 * the dispatcher claims the whole group_key, so any member of the batch
 * dispatches all of it.
 */
export async function dispatchLatestNotification(kind: NotificationEventRow["kind"]) {
  try {
    const eventId = await findPendingEvent({ kind });
    if (eventId) await invokeDispatch(eventId);
  } catch (error) {
    console.warn("Could not resolve the warehouse notification event", error);
  }
}

export function useWebPushNotifications(enabled: boolean, options?: { pickListRing?: boolean }) {
  const seenRef = useRef<Set<string> | null>(null);
  if (seenRef.current === null) seenRef.current = readSeenIds();

  const ringEnabled = options?.pickListRing !== false;

  // 1. Keep this device subscribed.
  useEffect(() => {
    if (!enabled) return;
    void ensurePushSubscription();
  }, [enabled]);

  // 2a. Fast path: the service worker tells us a push just landed.
  useEffect(() => {
    if (!enabled || typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;

    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type?: string; payload?: { eventId?: string; kind?: string } } | null;
      if (data?.type !== "WW_PUSH") return;
      const eventId = data.payload?.eventId;
      const kind = data.payload?.kind;
      if (!eventId || kind !== "pick_list_created") return;

      const seen = seenRef.current ?? new Set<string>();
      if (seen.has(eventId)) return;
      seen.add(eventId);
      seenRef.current = seen;
      writeSeenIds(seen);

      // A service worker has no AudioContext, so this message is the only way
      // the chime can play at all. If the context was never primed by a
      // gesture the OS notification stands on its own.
      if (ringEnabled && isFloorAudioPrimed()) playPickTicketRing();
    };

    navigator.serviceWorker.addEventListener("message", onMessage);
    return () => navigator.serviceWorker.removeEventListener("message", onMessage);
  }, [enabled, ringEnabled]);

  // 2b. Fallback path: poll recent events. Covers a user who denied push but
  // has the app open, and any push that never arrived.
  const { data: events = [] } = useQuery<NotificationEventRow[]>({
    queryKey: ["notification-events", "recent"],
    enabled,
    queryFn: async () => {
      const { data, error } = await (supabase.from as never as (t: string) => any)("notification_events")
        .select("id, kind, group_key, payload, created_at, push_dispatched_at")
        .gte("created_at", new Date(Date.now() - 60 * 60 * 1000).toISOString())
        .order("created_at", { ascending: false })
        .limit(30);
      if (error) throw error;
      return (data ?? []) as NotificationEventRow[];
    },
    refetchInterval: 30_000,
    meta: { suppressGlobalError: true },
  });

  useEffect(() => {
    if (!enabled || events.length === 0) return;
    const seen = seenRef.current ?? new Set<string>();

    // On a cold start every recent event is unseen; ringing through an hour of
    // backlog would be an alarm, not a notification. Seed silently instead and
    // only ring for events that arrive while this session is running.
    const firstRun = seen.size === 0;
    let changed = false;

    for (const event of events) {
      if (seen.has(event.id)) continue;
      seen.add(event.id);
      changed = true;
      if (firstRun) continue;
      if (event.kind !== "pick_list_created") continue;
      if (ringEnabled && isFloorAudioPrimed()) playPickTicketRing();
    }

    if (changed) {
      seenRef.current = seen;
      writeSeenIds(seen);
    }
  }, [enabled, events, ringEnabled]);

  // 3. Sweeper for events whose creating tab never got to invoke the sender.
  useQuery({
    queryKey: ["notification-events", "sweep"],
    enabled,
    queryFn: async () => {
      const { data } = await supabase.functions.invoke("push-notify", { body: { action: "sweep" } });
      return data ?? null;
    },
    refetchInterval: 60_000,
    meta: { suppressGlobalError: true },
  });

  return { events };
}
