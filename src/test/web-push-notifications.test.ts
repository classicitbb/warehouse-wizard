import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Backend coverage for the push-notification migration and edge functions.
 *
 * There is no database in CI, so these assert against the source text - the
 * same approach migration.test.ts and operator-feedback.test.ts already take.
 * They are aimed at the decisions that are easy to undo by accident, not at
 * restating the schema.
 */

const migration = readFileSync(
  path.resolve(process.cwd(), "supabase/migrations/20260915120000_web_push_notifications.sql"),
  "utf8",
);
const pushNotify = readFileSync(
  path.resolve(process.cwd(), "supabase/functions/push-notify/index.ts"),
  "utf8",
);
const pushSender = readFileSync(
  path.resolve(process.cwd(), "supabase/functions/push-notify/push.ts"),
  "utf8",
);
const notificationEmail = readFileSync(
  path.resolve(process.cwd(), "supabase/functions/send-notification-email/index.ts"),
  "utf8",
);
const config = readFileSync(path.resolve(process.cwd(), "supabase/config.toml"), "utf8");

describe("web push migration", () => {
  it("creates the three tables with RLS enabled", () => {
    for (const table of [
      "push_subscriptions",
      "notification_events",
      "user_notification_preferences",
    ]) {
      expect(migration).toContain(`create table if not exists public.${table}`);
      expect(migration).toContain(`alter table public.${table} enable row level security`);
      expect(migration).toContain(`grant all on public.${table} to service_role`);
    }
  });

  it("keeps notification_events read-only for clients", () => {
    // Rows come from the triggers and the dispatcher only. An insert or update
    // policy here would let any signed-in client forge a notification.
    expect(migration).toContain('create policy "notification events readable"');
    expect(migration).toContain("grant select on public.notification_events to authenticated");
    expect(migration).not.toContain("grant insert on public.notification_events to authenticated");
    expect(migration).not.toContain("grant update on public.notification_events to authenticated");
  });

  it("scopes subscriptions and preferences to their owner", () => {
    expect(migration).toContain('create policy "push subscriptions self"');
    expect(migration).toContain('create policy "notification preferences self"');
    const selfScoped = migration.match(/using \(user_id = auth\.uid\(\)\)/g) ?? [];
    expect(selfScoped.length).toBeGreaterThanOrEqual(2);
  });

  it("never lets a notification break a warehouse commit", () => {
    // putaway_tasks rows are inserted inside the receiving RPCs. Both triggers
    // must swallow their own errors rather than raise.
    const handlers = migration.match(/exception when others then/g) ?? [];
    expect(handlers.length).toBeGreaterThanOrEqual(2);
    expect(migration).toContain("public.write_system_log");
  });

  it("guards the batch group_key against stale receipts", () => {
    // Without the one-hour guard, a correction that requeues a months-old
    // pallet joins that receipt's already-dispatched group and is swallowed.
    expect(migration).toContain("putaway:draft:");
    expect(migration).toContain("putaway:receipt:");
    expect(migration).toContain("putaway:wh:");
    const guards = migration.match(/now\(\) - r\.created_at < interval '1 hour'/g) ?? [];
    expect(guards.length).toBe(2);
  });

  it("skips the run_warehouse_setup seed rows", () => {
    // Seeds are PKL-<CODE>-01 / PTA-<CODE>-01; real numbers carry one hyphen.
    expect(migration).toContain("new.pick_list_number not like '%-%-%'");
    expect(migration).toContain("new.task_number not like '%-%-%'");
  });

  it("only notifies for actionable put-away work", () => {
    expect(migration).toContain("new.status in ('queued', 'assigned')");
  });

  it("claims a dispatch group atomically", () => {
    // This compare-and-set is the only thing stopping every online tablet from
    // sending the same notification when they all sweep at once.
    expect(migration).toContain("create or replace function public.claim_notification_dispatch");
    expect(migration).toContain("push_claimed_at = now()");
    expect(migration).toContain("e.push_claimed_at < now() - make_interval(secs => in_claim_ttl_seconds)");
    expect(migration).toContain("e.push_dispatched_at is null");
  });

  it("defers a group that is still committing", () => {
    expect(migration).toContain("in_debounce_seconds integer default 4");
    expect(migration).toContain("v_newest > now() - make_interval(secs => in_debounce_seconds)");
  });

  it("keeps the dispatch RPCs off the client", () => {
    for (const fn of [
      "claim_notification_dispatch(uuid, integer, integer)",
      "complete_notification_dispatch(uuid[], text, text)",
      "pending_notification_dispatch(integer, integer)",
    ]) {
      expect(migration).toContain(`revoke execute on function public.${fn} from public, anon, authenticated`);
      expect(migration).toContain(`grant execute on function public.${fn} to service_role`);
    }
  });
});

describe("push-notify edge function", () => {
  it("prunes only on a permanently gone endpoint", () => {
    // 400 is a bad-VAPID config error. Pruning on it would delete every
    // subscription the first time a key was set wrong.
    expect(pushSender).toContain("status === 404 || status === 410");
    expect(pushSender).not.toContain("status === 400 ||");
  });

  it("bounds fan-out concurrency and tolerates one dead endpoint", () => {
    expect(pushSender).toContain("Promise.allSettled");
    expect(pushSender).toContain("chunkSize");
  });

  it("treats 429 as back-off rather than failure", () => {
    expect(pushNotify).toContain("result.status === 429");
  });

  it("never reports a notification failure as an operation failure", () => {
    expect(pushNotify).toContain("return json({ error: message, sent: 0 }, 200)");
  });

  it("resolves the subscriber from their own JWT", () => {
    expect(pushNotify).toContain("auth.getClaims(token)");
    expect(pushNotify).toContain("claimsData?.claims?.sub");
  });
});

describe("pick ticket email", () => {
  it("honours both the soft toggle and the hard unsubscribe", () => {
    // suppressed_emails is our own table, so the delivery provider never learns
    // about link-unsubscribes. Filtering locally is what makes the link work.
    expect(notificationEmail).toContain("email_pick_list");
    expect(notificationEmail).toContain("suppressed_emails");
  });

  it("finally passes an unsubscribe url to shell()", () => {
    expect(notificationEmail).toContain("unsubscribeUrl");
    expect(notificationEmail).toContain("shell(input.title, input.bodyHtml, input.unsubscribeUrl ?? null)");
    expect(notificationEmail).toContain("get_or_create_unsubscribe_token");
  });

  it("routes the new kind", () => {
    expect(notificationEmail).toContain("body.kind === 'pick_list_created'");
  });
});

describe("edge function registration", () => {
  it("registers push-notify behind a JWT and unsubscribe without one", () => {
    // The unsubscribe link is opened from a mail client by someone who is not
    // signed in, and is often prefetched by the provider.
    expect(config).toContain("[functions.push-notify]");
    expect(config).toMatch(/\[functions\.push-notify\]\s*\n\s*verify_jwt = true/);
    expect(config).toContain("[functions.email-unsubscribe]");
    expect(config).toMatch(/\[functions\.email-unsubscribe\]\s*\n\s*verify_jwt = false/);
  });
});
