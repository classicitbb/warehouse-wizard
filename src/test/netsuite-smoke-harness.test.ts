import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  enqueueNetSuiteWebhookDelivery,
  netSuiteOutboundClaimArgs,
  type NetSuiteWebhookJobRepository,
} from "../../supabase/functions/_shared/netsuite-queue";

/**
 * A no-network smoke harness for the NetSuite adapter's safety boundaries.
 * It uses the same enqueue and claim-argument helpers as the edge functions,
 * but a memory-only Supabase-shaped repository. It creates no secrets, calls
 * no endpoint, and writes no sandbox or production data.
 */

type StoredJob = {
  id: string;
  connectionId: string;
  jobType: string;
  idempotencyKey: string;
  status: "queued";
};

class MemoryWebhookRepository implements NetSuiteWebhookJobRepository {
  readonly jobs: StoredJob[] = [];

  async insert(input: {
    connectionId: string;
    jobType: string;
    idempotencyKey: string;
    payload: Record<string, unknown>;
  }) {
    const existing = this.jobs.find(
      (job) => job.connectionId === input.connectionId && job.idempotencyKey === input.idempotencyKey,
    );
    if (existing) return { data: null, error: { code: "23505", message: "duplicate key" } };

    const job: StoredJob = {
      id: `job-${this.jobs.length + 1}`,
      connectionId: input.connectionId,
      jobType: input.jobType,
      idempotencyKey: input.idempotencyKey,
      status: "queued",
    };
    this.jobs.push(job);
    return { data: { id: job.id }, error: null };
  }

  async findByIdempotencyKey(input: { connectionId: string; idempotencyKey: string }) {
    const job = this.jobs.find(
      (candidate) => candidate.connectionId === input.connectionId && candidate.idempotencyKey === input.idempotencyKey,
    );
    return job ? { id: job.id } : null;
  }
}

const read = (file: string) =>
  readFileSync(path.resolve(process.cwd(), file), "utf8").replace(/\r\n/g, "\n");

const webhook = read("supabase/functions/netsuite-webhook/index.ts");
const worker = read("supabase/functions/process-netsuite-queue/index.ts");
const claimMigration = read("supabase/migrations/20260915180000_netsuite_queue_claim_and_retention.sql");

describe("NetSuite non-production smoke harness", () => {
  it("accepts an item delivery once and identifies its redelivery as the same job", async () => {
    const repository = new MemoryWebhookRepository();
    const item = {
      recordType: "item",
      externalId: "NS-SMOKE-ITEM-100",
      lastModified: "2026-09-21T09:30:00Z",
      payload: { id: "NS-SMOKE-ITEM-100", itemId: "WW-SMOKE-ITEM-100", displayName: "Smoke item" },
    };

    const first = await enqueueNetSuiteWebhookDelivery(repository, { connectionId: "sandbox-connection", body: item });
    const second = await enqueueNetSuiteWebhookDelivery(repository, { connectionId: "sandbox-connection", body: item });

    expect(first).toMatchObject({ jobId: "job-1", duplicate: false });
    expect(second).toMatchObject({ jobId: "job-1", duplicate: true });
    expect(repository.jobs).toHaveLength(1);
    expect(repository.jobs[0]).toMatchObject({ jobType: "item", status: "queued" });
    // The actual webhook delegates its unique-constraint path to this helper
    // before it can execute the item's product upsert.
    expect(webhook).toContain("enqueueNetSuiteWebhookDelivery");
    expect(webhook.indexOf("if (delivery.duplicate)")).toBeLessThan(
      webhook.indexOf("if (recordType === 'item')"),
    );
  });

  it("leaves an inbound purchase order queued for a future processor", async () => {
    const repository = new MemoryWebhookRepository();
    const delivery = await enqueueNetSuiteWebhookDelivery(repository, {
      connectionId: "sandbox-connection",
      body: {
        recordType: "purchase_order",
        externalId: "NS-SMOKE-PO-200",
        payload: { tranId: "NS-SMOKE-PO-200", lines: [{ item: { id: "1" }, quantity: 2 }] },
      },
    });

    expect(delivery.duplicate).toBe(false);
    expect(repository.jobs).toEqual([
      expect.objectContaining({ jobType: "purchase_order", status: "queued" }),
    ]);
    expect(webhook).toContain("if (recordType === 'item')");
    expect(webhook).toMatch(/purchase_order \| sales_order \| transfer_order \| fulfillment \| inventory[\s\S]*leave status='queued'/);
  });

  it("passes only inventory_adjustment to the worker's atomic claim RPC", () => {
    expect(netSuiteOutboundClaimArgs("sandbox-connection", 20)).toEqual({
      p_connection_id: "sandbox-connection",
      p_limit: 20,
      p_job_types: ["inventory_adjustment"],
    });
    expect(worker).toContain("netSuiteOutboundClaimArgs(connection.id, BATCH_SIZE)");
    expect(claimMigration).toContain("and job_type = any(p_job_types)");
    expect(claimMigration).toContain("for update skip locked");
  });
});
