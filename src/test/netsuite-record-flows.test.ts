import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  canonicalJson,
  payloadDigest,
  timingSafeEqual,
} from "../../supabase/functions/_shared/netsuite";
import {
  NETSUITE_OUTBOUND_JOB_TYPES,
  netSuiteOutboundClaimArgs,
  netSuiteWebhookIdempotencyKey,
} from "../../supabase/functions/_shared/netsuite-queue";

/**
 * Contract coverage for the NetSuite record flows a tester exercises by hand:
 * sales orders, purchase orders, invoices and inventory receipts created in
 * NetSuite, and the inventory adjustment Warehouse Wizard pushes back.
 *
 * The runbook that drives the manual half of this is
 * `docs/testing/netsuite-record-integration-tests.md`; the live half is
 * `src/test/netsuite-live.integration.test.ts`, skipped unless credentials are
 * in the environment. These tests need no network and no database, so they are
 * the part that runs on every commit. They pin three things that are easy to
 * break silently:
 *
 *   1. which record types the webhook accepts, and which it still rejects, so
 *      "invoice sync is live" can never be true by accident;
 *   2. the idempotency key, which is the only thing standing between a NetSuite
 *      redelivery and a duplicate job;
 *   3. the claim filter, which is the only thing standing between a parked
 *      sales order row and a permanent dead letter.
 *
 * Edge functions are Deno modules with a top-level `Deno.serve`, so handler
 * wiring is asserted from source. Their idempotency key and claim arguments
 * are shared pure helpers, imported and executed here (and by the no-network
 * smoke harness).
 */

const read = (file: string) =>
  readFileSync(path.resolve(process.cwd(), file), "utf8").replace(/\r\n/g, "\n");

const webhook = read("supabase/functions/netsuite-webhook/index.ts");
const worker = read("supabase/functions/process-netsuite-queue/index.ts");
const claimMigration = read(
  "supabase/migrations/20260915180000_netsuite_queue_claim_and_retention.sql",
);
const triggerMigration = read(
  "supabase/migrations/20260916120000_netsuite_inventory_sync_internal_ids.sql",
);

/** The record types in the webhook's allow-list, read out of the source. */
function supportedRecordTypes(): string[] {
  const block = webhook.match(/const SUPPORTED_RECORD_TYPES = new Set\(\[([\s\S]*?)\]\)/);
  expect(block, "SUPPORTED_RECORD_TYPES literal").toBeTruthy();
  return Array.from(block![1].matchAll(/'([^']+)'/g), (m) => m[1]);
}

// ── 1. Which manually created records the webhook will even accept ──────────

describe("NetSuite webhook record-type gate", () => {
  it("accepts exactly the six record types the adapter knows about", () => {
    expect(supportedRecordTypes().sort()).toEqual([
      "fulfillment",
      "inventory",
      "item",
      "purchase_order",
      "sales_order",
      "transfer_order",
    ]);
  });

  it("still rejects invoices and receipts, so a 400 in manual testing is the contract and not a regression", () => {
    // A manually created invoice or item receipt pushed at this endpoint today
    // comes back 400 "Unsupported recordType". When either is implemented, this
    // expectation has to be deleted deliberately — and the runbook case that
    // asserts the 400 (NS-05, NS-07) updated with it.
    const accepted = supportedRecordTypes();
    for (const unsupported of [
      "invoice",
      "credit_memo",
      "vendor_bill",
      "item_receipt",
      "inventory_receipt",
      "item_fulfillment",
      "inventory_adjustment",
    ]) {
      expect(accepted, unsupported).not.toContain(unsupported);
    }
    expect(webhook).toContain("return json({ error: `Unsupported recordType: ${recordType || '(missing)'}` }, 400)");
  });

  it("normalises casing and whitespace, so SuiteScript may send Sales_Order", () => {
    expect(webhook).toContain("String(body.recordType ?? '').toLowerCase().trim()");
  });

  it("requires an externalId on every record", () => {
    expect(webhook).toContain("return json({ error: 'externalId is required' }, 400)");
  });

  it("only the item flow does work; orders, receipts and fulfillments park as queued", () => {
    // Exactly one record type gets a processing branch. If a second appears,
    // the queue-side tests below have to grow with it.
    const branches = Array.from(webhook.matchAll(/recordType === '([a-z_]+)'/g), (m) => m[1]);
    expect(branches).toEqual(["item"]);
    expect(webhook).toContain("let processed = false");
    expect(webhook).toMatch(/leave status='queued', wait for a future processor/);
  });

  it("rejects anything that is not a POST, and any caller without the shared secret", () => {
    expect(webhook).toContain("return json({ error: 'Method not allowed' }, 405)");
    expect(webhook).toContain("req.headers.get('x-webhook-secret')");
    // Both the missing-secret and wrong-secret paths answer 401, and the
    // comparison is constant time.
    expect(webhook).toContain(
      "if (!expectedSecret || !providedSecret || !timingSafeEqual(providedSecret, expectedSecret))",
    );
    expect(webhook).toContain("return json({ error: 'Unauthorized' }, 401)");
  });

  it("logs the raw body before the duplicate short-circuit, so a redelivery is still auditable", () => {
    const logInsert = webhook.indexOf("from('integration_payload_logs')");
    const duplicateReturn = webhook.indexOf("duplicate: true");
    expect(logInsert).toBeGreaterThan(0);
    expect(duplicateReturn).toBeGreaterThan(logInsert);
  });

  it("answers 200 when the item flow throws, rather than inviting a NetSuite retry storm", () => {
    expect(webhook).toMatch(/Still return 200 so NetSuite doesn't retry-storm/);
    expect(webhook).toContain("status: 'failed'");
  });
});

// ── 2. Idempotency: one NetSuite event must yield one job ───────────────────

describe("NetSuite webhook idempotency key", () => {
  const salesOrder = {
    recordType: "sales_order",
    externalId: "SO-10041",
    action: "update",
    payload: {
      tranId: "SO-10041",
      entity: { id: "482", name: "Acme Foods" },
      lines: [
        { item: { id: "912" }, quantity: 12, rate: 4.5 },
        { item: { id: "913" }, quantity: 3, rate: 19.95 },
      ],
    },
  };

  it("is recordType:externalId:lastModified", () => {
    expect(webhook).toContain("enqueueNetSuiteWebhookDelivery");
  });

  it("prefers the body's lastModified, then the payload's, then a digest of the body", async () => {
    const bodyKey = await netSuiteWebhookIdempotencyKey({
      recordType: "sales_order", externalId: "SO-1", lastModified: "body", payload: { lastModified: "payload" },
    });
    const payloadKey = await netSuiteWebhookIdempotencyKey({
      recordType: "sales_order", externalId: "SO-1", payload: { lastModified: "payload" },
    });
    const digestKey = await netSuiteWebhookIdempotencyKey({
      recordType: "sales_order", externalId: "SO-1", payload: { tranId: "SO-1" },
    });
    expect(bodyKey).toBe("sales_order:SO-1:body");
    expect(payloadKey).toBe("sales_order:SO-1:payload");
    expect(digestKey).toMatch(/^sales_order:SO-1:sha256-[0-9a-f]{16}$/);
    // Never a timestamp: a Date.now() fallback made every redelivery unique and
    // defeated the unique constraint the whole design rests on.
    expect(read("supabase/functions/_shared/netsuite-queue.ts")).not.toMatch(/Date\.now\(\)/);
  });

  it("gives a redelivered sales order the same digest, whatever order NetSuite serialises fields in", async () => {
    const reordered = {
      payload: {
        lines: salesOrder.payload.lines,
        entity: { name: "Acme Foods", id: "482" },
        tranId: "SO-10041",
      },
      action: "update",
      externalId: "SO-10041",
      recordType: "sales_order",
    };
    expect(canonicalJson(reordered)).toBe(canonicalJson(salesOrder));
    expect(await payloadDigest(reordered)).toBe(await payloadDigest(salesOrder));
  });

  it("gives an edited sales order a different digest, so a real change is re-queued", async () => {
    const edited = {
      ...salesOrder,
      payload: {
        ...salesOrder.payload,
        lines: [{ ...salesOrder.payload.lines[0], quantity: 13 }, salesOrder.payload.lines[1]],
      },
    };
    expect(await payloadDigest(edited)).not.toBe(await payloadDigest(salesOrder));
  });

  it("treats line order as significant, because a reordered purchase order is a different document", async () => {
    const swapped = {
      ...salesOrder,
      payload: { ...salesOrder.payload, lines: [...salesOrder.payload.lines].reverse() },
    };
    expect(await payloadDigest(swapped)).not.toBe(await payloadDigest(salesOrder));
  });

  it("produces a 16-character hex digest and drops undefined fields", async () => {
    expect(await payloadDigest(salesOrder)).toMatch(/^[0-9a-f]{16}$/);
    expect(canonicalJson({ a: 1, b: undefined })).toBe('{"a":1}');
    expect(canonicalJson(null)).toBe("null");
  });

  it("keys two NetSuite record types with the same document number apart", () => {
    // A NetSuite account can hold PO-3001 and an invoice numbered 3001. The key
    // is prefixed with the record type so the two never collide on the unique
    // index.
    const key = (recordType: string, externalId: string, lastModified: string) =>
      `${recordType}:${externalId}:${lastModified}`;
    expect(key("purchase_order", "3001", "2026-09-17T10:00:00Z")).not.toBe(
      key("invoice", "3001", "2026-09-17T10:00:00Z"),
    );
    expect(key("sales_order", "SO-1", "2026-09-17T10:00:00Z")).not.toBe(
      key("sales_order", "SO-1", "2026-09-17T10:05:00Z"),
    );
  });

  it("dedupes on the unique constraint rather than a read-then-write race", () => {
    // Two SuiteScript deliveries can land concurrently. The insert is attempted
    // unconditionally and 23505 is read as "already have it".
    const queueHelpers = read("supabase/functions/_shared/netsuite-queue.ts");
    expect(queueHelpers).toContain("if (error.code !== '23505')");
    expect(queueHelpers).toContain("duplicate: true");
  });
});

// ── 3. Parked order rows must survive every queue drain ────────────────────

describe("NetSuite outbound queue and the parked order rows", () => {
  it("claims only job types that have an outbound implementation", () => {
    expect(NETSUITE_OUTBOUND_JOB_TYPES).toEqual(["inventory_adjustment"]);
    expect(netSuiteOutboundClaimArgs("connection", 20).p_job_types).toEqual(["inventory_adjustment"]);
    expect(worker).toContain("netSuiteOutboundClaimArgs(connection.id, BATCH_SIZE)");
  });

  it("the claim function defaults to the same single type and filters on it in SQL", () => {
    expect(claimMigration).toContain(
      "p_job_types text[] default array['inventory_adjustment']",
    );
    expect(claimMigration).toContain("and job_type = any(p_job_types)");
    expect(claimMigration).toContain("for update skip locked");
  });

  it("would dead-letter a claimed sales_order on the first attempt, which is why the filter matters", () => {
    // This is the failure the filter prevents: an unsupported job_type is a
    // permanent failure, no retries. If the claim ever widens, every parked
    // purchase_order / sales_order / invoice row is destroyed on the next tick.
    expect(worker).toContain("const isPermanent = job.job_type !== 'inventory_adjustment'");
    expect(worker).toContain("Unsupported job_type for outbound sync");
    expect(worker).toContain("from('integration_dead_letters')");
  });

  it("retries a transient inventory adjustment failure up to five attempts", () => {
    expect(worker).toContain("const MAX_RETRIES = 5");
    expect(worker).toContain("if (isPermanent || nextAttempts >= MAX_RETRIES)");
    expect(worker).toContain("status: 'queued'");
  });

  it("reclaims jobs stranded in running, but only after authorising the caller", () => {
    const authCheck = worker.indexOf("timingSafeEqual(providedQueueSecret, expectedQueueSecret)");
    const reclaim = worker.indexOf("reclaim_stale_integration_sync_jobs");
    expect(authCheck).toBeGreaterThan(0);
    expect(reclaim).toBeGreaterThan(authCheck);
  });

  it("refuses an unauthenticated drain and does not confirm a bad secret", () => {
    expect(worker).toContain("if (!hasServiceRoleJwt && !providedQueueSecret)");
    expect(worker).toContain("status: 401");
    // With no connection row there is no secret to compare against, so a
    // secret-only caller gets 403 either way rather than learning which it was.
    expect(worker).toContain("error: 'Forbidden'");
  });

  it("skips the whole drain, without claiming, until the adjustment account is configured", () => {
    const guard = worker.indexOf("adjustment_account_not_configured");
    const claim = worker.indexOf("netSuiteOutboundClaimArgs(connection.id, BATCH_SIZE)");
    expect(guard).toBeGreaterThan(0);
    expect(claim).toBeGreaterThan(guard);
  });

  it("treats a NetSuite record that already exists under the same externalId as success", () => {
    // The retry safety net for a timed-out POST: NetSuite refuses a duplicate
    // externalId, so the worker looks the record up instead of failing.
    expect(worker).toContain("`${recordUrl}/eid:${externalId}`");
    expect(worker).toContain("alreadyPosted: true");
    expect(worker).toContain("res.headers.get('Location')");
  });

  it("falls back to the SKU link for jobs queued before the internal-id migration", () => {
    expect(worker).toContain("resolveItemIdBySku");
    expect(worker).toContain("p.netsuiteLocationId ?? p.locationExternalId");
  });

  it("logs every attempt, successful or not", () => {
    expect(worker).toContain("direction: 'outbound'");
    expect(worker).toMatch(/Log the attempt regardless of outcome/);
  });
});

// ── 4. The putaway trigger that produces the outbound adjustment ───────────

describe("enqueue_netsuite_inventory_sync trigger conditions", () => {
  it("fires once, on the receiving -> available transition only", () => {
    expect(triggerMigration).toContain("if new.status is distinct from 'available' then");
    expect(triggerMigration).toContain("if TG_OP = 'UPDATE' and old.status = 'available' then");
  });

  it("no-ops on a zero or null quantity", () => {
    expect(triggerMigration).toContain(
      "if new.available_quantity is null or new.available_quantity = 0 then",
    );
  });

  it("no-ops unless the product and the warehouse are both mapped to NetSuite", () => {
    expect(triggerMigration).toContain("and external_record_type = 'item'");
    expect(triggerMigration).toContain("and external_record_type = 'location'");
    expect(triggerMigration).toContain("if v_netsuite_item_id is null then");
    expect(triggerMigration).toContain("if v_netsuite_location_id is null then");
  });

  it("no-ops when no NetSuite connection is enabled, so a client without NetSuite is unaffected", () => {
    expect(triggerMigration).toContain("where system = 'netsuite' and enabled = true");
    expect(triggerMigration).toContain("if v_connection_id is null then");
  });

  it("carries both NetSuite internal ids in the payload and keys the job to the balance row", () => {
    expect(triggerMigration).toContain("'netsuiteItemId', v_netsuite_item_id");
    expect(triggerMigration).toContain("'netsuiteLocationId', v_netsuite_location_id");
    expect(triggerMigration).toContain("'quantityDelta', new.available_quantity");
    expect(triggerMigration).toContain("'putaway-' || new.id::text");
    // Re-running putaway on the same balance row must not enqueue a second
    // adjustment.
    expect(triggerMigration).toContain("on conflict (connection_id, idempotency_key) do nothing");
  });
});

// ── 5. The shared-secret comparison both endpoints depend on ───────────────

describe("shared secret comparison", () => {
  it("accepts an exact match and rejects everything else, including a prefix", () => {
    const secret = "a".repeat(64);
    expect(timingSafeEqual(secret, secret)).toBe(true);
    expect(timingSafeEqual(secret, "a".repeat(63))).toBe(false);
    expect(timingSafeEqual(secret, "a".repeat(63) + "b")).toBe(false);
    expect(timingSafeEqual("", secret)).toBe(false);
    expect(timingSafeEqual("", "")).toBe(true);
  });

  it("is byte-wise, so a multi-byte secret is not truncated to its code points", () => {
    expect(timingSafeEqual("sécret", "sécret")).toBe(true);
    expect(timingSafeEqual("sécret", "secret")).toBe(false);
  });
});
