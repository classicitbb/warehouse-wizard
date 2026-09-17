import { beforeAll, describe, expect, it } from "vitest";

import {
  buildNetSuiteInventoryAdjustment,
  mapNetSuiteItemToProduct,
  netsuiteAdjustmentExternalId,
  netsuiteHost,
} from "../../supabase/functions/_shared/netsuite";
import {
  fetchNetSuiteAccessToken,
  netsuiteTokenUrl,
} from "../../supabase/functions/_shared/netsuite-auth";

/**
 * Live NetSuite integration tests, driven by records a tester creates BY HAND
 * in a NetSuite sandbox: a sales order, a purchase order, an invoice billed
 * from that sales order, and an item receipt received against that purchase
 * order. The runbook is `docs/testing/netsuite-record-integration-tests.md`.
 *
 * Everything here is skipped unless the matching environment variables are set,
 * so `npm test` on a laptop or in CI stays green and offline. It deliberately
 * reuses the production modules — the same signing code, the same host
 * derivation, the same payload builder the edge functions run — so a pass means
 * the shipped code path works, not that a test reimplementation of it does.
 *
 * Point it at a SANDBOX. Section C writes `integration_sync_jobs` and
 * `integration_payload_logs` rows into whichever Supabase project
 * `WW_FUNCTIONS_URL` belongs to, and section E creates a real inventory
 * adjustment in NetSuite.
 *
 *   # NetSuite (sections A, B, E)
 *   NETSUITE_ACCOUNT_ID=1234567_SB1
 *   NETSUITE_CLIENT_ID=<integration record client id>
 *   NETSUITE_CERTIFICATE_ID=<certificate id NetSuite assigned on upload>
 *   NETSUITE_PRIVATE_KEY=<PKCS#8 PEM; \n escapes are expanded>
 *
 *   # the records you created by hand, by document number (section B)
 *   NS_TEST_SALES_ORDER=SO1042
 *   NS_TEST_PURCHASE_ORDER=PO2051
 *   NS_TEST_INVOICE=INV3007
 *   NS_TEST_ITEM_RECEIPT=RCPT4011
 *   NS_TEST_ITEM_SKU=WW-TEST-001
 *
 *   # Warehouse Wizard endpoints (sections C, D)
 *   WW_FUNCTIONS_URL=https://<project-ref>.supabase.co/functions/v1
 *   WW_WEBHOOK_SECRET=<netsuite_webhook_secret>
 *   WW_QUEUE_SECRET=<netsuite_queue_runner_secret>
 *
 *   # opt in to the writes
 *   WW_ALLOW_WRITES=1          # lets the item webhook upsert a product
 *   NETSUITE_ALLOW_WRITES=1    # lets section E post an inventory adjustment
 *   NS_TEST_LOCATION_ID=<NetSuite location internal id>
 *   NS_TEST_ADJUSTMENT_ACCOUNT_ID=<GL account internal id>
 *
 * This file is listed in tsconfig.app.json's `exclude`: it imports
 * `_shared/netsuite-auth.ts`, a Deno module whose WebCrypto calls do not
 * typecheck under the app's DOM lib. Vitest transforms it regardless, and
 * keeping it out of the program leaves the edge function's own types alone.
 */

const env = (name: string) => (process.env[name] ?? "").trim();

const accountId = env("NETSUITE_ACCOUNT_ID");
const clientId = env("NETSUITE_CLIENT_ID");
const certificateId = env("NETSUITE_CERTIFICATE_ID");
const privateKeyPem = env("NETSUITE_PRIVATE_KEY").replace(/\\n/g, "\n");

const functionsUrl = env("WW_FUNCTIONS_URL").replace(/\/$/, "");
const webhookSecret = env("WW_WEBHOOK_SECRET");
const queueSecret = env("WW_QUEUE_SECRET");

const testSalesOrder = env("NS_TEST_SALES_ORDER");
const testPurchaseOrder = env("NS_TEST_PURCHASE_ORDER");
const testInvoice = env("NS_TEST_INVOICE");
const testItemReceipt = env("NS_TEST_ITEM_RECEIPT");
const testItemSku = env("NS_TEST_ITEM_SKU");

const hasNetSuite = Boolean(accountId && clientId && certificateId && privateKeyPem);
const hasWebhook = Boolean(functionsUrl && webhookSecret);
const isSandbox = /[-_]SB\d*$/i.test(accountId);
const allowNetSuiteWrites = env("NETSUITE_ALLOW_WRITES") === "1" && isSandbox;
const allowWwWrites = env("WW_ALLOW_WRITES") === "1";

/** NetSuite transaction type codes, as stored in `transaction.type`. */
const TRANSACTION_TYPE = {
  salesOrder: "SalesOrd",
  purchaseOrder: "PurchOrd",
  invoice: "CustInvc",
  itemReceipt: "ItemRcpt",
} as const;

/** Escape a value for a SuiteQL string literal. */
const sql = (value: string) => value.replace(/'/g, "''");

let token = "";

type SuiteQlRow = Record<string, string | number | null>;

async function suiteql(q: string, limit = 100): Promise<SuiteQlRow[]> {
  const res = await fetch(
    `https://${netsuiteHost(accountId)}/services/rest/query/v1/suiteql?limit=${limit}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Prefer: "transient",
      },
      body: JSON.stringify({ q }),
    },
  );
  const text = await res.text();
  if (!res.ok) throw new Error(`SuiteQL ${res.status}: ${text.slice(0, 400)}\nquery: ${q}`);
  return (JSON.parse(text) as { items?: SuiteQlRow[] }).items ?? [];
}

/** The transaction header for a document number, or null. */
async function findTransaction(tranId: string, type: string): Promise<SuiteQlRow | null> {
  const rows = await suiteql(
    `SELECT id, tranid, type, trandate, entity, status, createdfrom, foreigntotal
       FROM transaction
      WHERE tranid = '${sql(tranId)}' AND type = '${sql(type)}'`,
  );
  return rows[0] ?? null;
}

/** Item lines of a transaction, excluding the summary and tax lines. */
async function transactionLines(transactionId: string | number): Promise<SuiteQlRow[]> {
  return suiteql(
    `SELECT tl.item, tl.quantity, tl.rate, tl.location, tl.linesequencenumber
       FROM transactionline tl
      WHERE tl.transaction = ${Number(transactionId)}
        AND tl.mainline = 'F'
        AND tl.taxline = 'F'
        AND tl.item IS NOT NULL
      ORDER BY tl.linesequencenumber`,
  );
}

beforeAll(async () => {
  if (!hasNetSuite) return;
  const result = await fetchNetSuiteAccessToken({ accountId, clientId, certificateId, privateKeyPem });
  if (!result.ok) throw new Error(`NetSuite token exchange failed: ${result.error}`);
  token = result.token;
}, 60_000);

// ── A. Authentication and transport ─────────────────────────────────────────

describe.skipIf(!hasNetSuite)("A. NetSuite API reachability", () => {
  it("A1 issues an access token from a signed client assertion", () => {
    // beforeAll throws with NetSuite's own error text if this fails, which is
    // where an unregistered certificate or a missing M2M grant shows up.
    expect(token.length).toBeGreaterThan(20);
  });

  it("A2 derives the REST host and token URL from the account id", () => {
    expect(netsuiteHost(accountId)).toBe(
      `${accountId.toLowerCase().replace(/_/g, "-")}.suitetalk.api.netsuite.com`,
    );
    expect(netsuiteTokenUrl(accountId)).toContain("/services/rest/auth/oauth2/v1/token");
  });

  it("A3 is pointed at a sandbox, not a production account", () => {
    // A failure here is a warning worth heeding before running sections C-E.
    expect(isSandbox, `NETSUITE_ACCOUNT_ID ${accountId} does not look like a sandbox`).toBe(true);
  });

  it("A4 answers a SuiteQL query against the item table", async () => {
    const rows = await suiteql("SELECT COUNT(*) AS item_count FROM item");
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].item_count)).toBeGreaterThanOrEqual(0);
  });
});

// ── B. The records created by hand in NetSuite ──────────────────────────────

describe.skipIf(!hasNetSuite)("B. Manually created NetSuite records", () => {
  it.skipIf(!testItemSku)("B1 finds the test item and maps it to a product row", async () => {
    const rows = await suiteql(
      `SELECT id, itemid, displayname, upccode, isinactive
         FROM item WHERE itemid = '${sql(testItemSku)}'`,
    );
    expect(rows, `no NetSuite item with itemid ${testItemSku}`).toHaveLength(1);
    const row = rows[0];

    const mapped = mapNetSuiteItemToProduct({
      id: String(row.id),
      itemId: String(row.itemid),
      displayName: row.displayname ? String(row.displayname) : undefined,
      upcCode: row.upccode ? String(row.upccode) : undefined,
      isInactive: row.isinactive === "T",
    });

    expect(mapped.sku).toBe(testItemSku);
    expect(mapped.external_id).toBe(String(row.id));
    expect(mapped.name.length).toBeGreaterThan(0);
    expect(mapped.active).toBe(true);
    expect(["ambient", "cool", "frozen"]).toContain(mapped.temperature_requirement);
    expect(["fifo", "fefo", "lifo"]).toContain(mapped.rotation_method);
  });

  it.skipIf(!testSalesOrder)("B2 reads back the sales order with at least one priced line", async () => {
    const header = await findTransaction(testSalesOrder, TRANSACTION_TYPE.salesOrder);
    expect(header, `no sales order with tranid ${testSalesOrder}`).not.toBeNull();
    expect(header!.entity, "sales order has no customer").toBeTruthy();

    const lines = await transactionLines(header!.id!);
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      // NetSuite stores sales order quantities as negative on some line types;
      // what matters is that the magnitude is non-zero and an item is set.
      expect(Math.abs(Number(line.quantity))).toBeGreaterThan(0);
      expect(line.item).toBeTruthy();
    }
  });

  it.skipIf(!testPurchaseOrder)("B3 reads back the purchase order with a vendor and lines", async () => {
    const header = await findTransaction(testPurchaseOrder, TRANSACTION_TYPE.purchaseOrder);
    expect(header, `no purchase order with tranid ${testPurchaseOrder}`).not.toBeNull();
    expect(header!.entity, "purchase order has no vendor").toBeTruthy();

    const lines = await transactionLines(header!.id!);
    expect(lines.length).toBeGreaterThan(0);
    expect(Math.abs(Number(lines[0].quantity))).toBeGreaterThan(0);
  });

  it.skipIf(!testInvoice)("B4 reads back the invoice and ties it to its sales order", async () => {
    const header = await findTransaction(testInvoice, TRANSACTION_TYPE.invoice);
    expect(header, `no invoice with tranid ${testInvoice}`).not.toBeNull();
    expect(Math.abs(Number(header!.foreigntotal ?? 0))).toBeGreaterThan(0);

    if (testSalesOrder) {
      const salesOrder = await findTransaction(testSalesOrder, TRANSACTION_TYPE.salesOrder);
      // Only meaningful when the invoice was billed from the sales order, which
      // is how the runbook says to create it (NS-04 -> NS-05).
      expect(
        String(header!.createdfrom ?? ""),
        "invoice is not linked to the test sales order - was it billed from it?",
      ).toBe(String(salesOrder!.id));
    }
  });

  it.skipIf(!testItemReceipt)("B5 reads back the item receipt and ties it to its purchase order", async () => {
    const header = await findTransaction(testItemReceipt, TRANSACTION_TYPE.itemReceipt);
    expect(header, `no item receipt with tranid ${testItemReceipt}`).not.toBeNull();

    const lines = await transactionLines(header!.id!);
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line.location, "receipt line has no location - WW maps location to warehouse").toBeTruthy();
    }

    if (testPurchaseOrder) {
      const purchaseOrder = await findTransaction(testPurchaseOrder, TRANSACTION_TYPE.purchaseOrder);
      expect(
        String(header!.createdfrom ?? ""),
        "item receipt is not linked to the test purchase order",
      ).toBe(String(purchaseOrder!.id));

      // The receipt must not introduce items the PO never ordered: this is the
      // PO -> receipt chain that WW's receiving screen mirrors.
      const poItems = new Set(
        (await transactionLines(purchaseOrder!.id!)).map((l) => String(l.item)),
      );
      for (const line of lines) {
        expect(poItems, `receipt line item ${line.item} is not on the PO`).toContain(String(line.item));
      }
    }
  });
});

// ── C. Inbound: what Warehouse Wizard does with each record type ────────────

type WebhookBody = {
  recordType: string;
  externalId: string;
  action?: string;
  lastModified?: string;
  payload?: Record<string, unknown>;
};

async function postWebhook(body: WebhookBody, secret = webhookSecret) {
  const res = await fetch(`${functionsUrl}/netsuite-webhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Webhook-Secret": secret },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, json };
}

describe.skipIf(!hasWebhook)("C. Inbound webhook per record type", () => {
  // A fresh document number per run keeps each case's idempotency key distinct
  // without depending on test order.
  const stamp = Date.now();

  it("C1 parks a sales order as a queued job and reports processed=false", async () => {
    const { status, json } = await postWebhook({
      recordType: "sales_order",
      externalId: `SO-APITEST-${stamp}`,
      action: "create",
      lastModified: "2026-09-17T10:00:00Z",
      payload: {
        tranId: `SO-APITEST-${stamp}`,
        entity: { id: "1", name: "API test customer" },
        lines: [{ item: { id: "1" }, quantity: 5, rate: 9.99 }],
      },
    });
    expect(status).toBe(200);
    expect(json).toMatchObject({ received: true, recordType: "sales_order", processed: false });
    expect(json.jobId, "no sync job was recorded for the sales order").toBeTruthy();
  });

  it("C2 treats a redelivery of the same sales order as a duplicate", async () => {
    const body: WebhookBody = {
      recordType: "sales_order",
      externalId: `SO-APITEST-DUP-${stamp}`,
      lastModified: "2026-09-17T10:00:00Z",
      payload: { tranId: `SO-APITEST-DUP-${stamp}` },
    };
    const first = await postWebhook(body);
    const second = await postWebhook(body);
    expect(first.status).toBe(200);
    expect(first.json.duplicate).toBeUndefined();
    expect(second.status).toBe(200);
    expect(second.json).toMatchObject({ duplicate: true });
    expect(second.json.jobId).toBe(first.json.jobId);
  });

  it("C3 dedupes a redelivery with no lastModified, by body digest", async () => {
    const body: WebhookBody = {
      recordType: "purchase_order",
      externalId: `PO-APITEST-${stamp}`,
      payload: { tranId: `PO-APITEST-${stamp}`, lines: [{ item: { id: "1" }, quantity: 2 }] },
    };
    const first = await postWebhook(body);
    const second = await postWebhook(body);
    expect(first.status).toBe(200);
    expect(second.json).toMatchObject({ duplicate: true, jobId: first.json.jobId });
  });

  it("C4 re-queues the same purchase order when lastModified moves on", async () => {
    const base = { recordType: "purchase_order", externalId: `PO-APITEST-EDIT-${stamp}` };
    const first = await postWebhook({ ...base, lastModified: "2026-09-17T10:00:00Z" });
    const second = await postWebhook({ ...base, lastModified: "2026-09-17T11:30:00Z" });
    expect(second.json.duplicate).toBeUndefined();
    expect(second.json.jobId).not.toBe(first.json.jobId);
  });

  it("C5 rejects an invoice: no invoice flow exists yet", async () => {
    const { status, json } = await postWebhook({
      recordType: "invoice",
      externalId: `INV-APITEST-${stamp}`,
      payload: { tranId: `INV-APITEST-${stamp}`, total: 149.5 },
    });
    expect(status).toBe(400);
    expect(String(json.error)).toContain("Unsupported recordType");
  });

  it("C6 rejects an item receipt: receiving is entered in WW, not mirrored from NetSuite", async () => {
    for (const recordType of ["item_receipt", "inventory_receipt"]) {
      const { status, json } = await postWebhook({
        recordType,
        externalId: `RCPT-APITEST-${stamp}`,
        payload: { tranId: `RCPT-APITEST-${stamp}` },
      });
      expect(status, recordType).toBe(400);
      expect(String(json.error), recordType).toContain("Unsupported recordType");
    }
  });

  it("C7 accepts the inventory and fulfillment record types and parks them too", async () => {
    for (const recordType of ["inventory", "fulfillment", "transfer_order"]) {
      const { status, json } = await postWebhook({
        recordType,
        externalId: `${recordType.toUpperCase()}-APITEST-${stamp}`,
        lastModified: "2026-09-17T10:00:00Z",
        payload: { note: "parked for a processor that does not exist yet" },
      });
      expect(status, recordType).toBe(200);
      expect(json, recordType).toMatchObject({ received: true, processed: false });
    }
  });

  it("C8 refuses a wrong secret, a missing secret and a GET", async () => {
    expect((await postWebhook({ recordType: "item", externalId: "x" }, "not-the-secret")).status).toBe(401);
    expect((await postWebhook({ recordType: "item", externalId: "x" }, "")).status).toBe(401);
    const get = await fetch(`${functionsUrl}/netsuite-webhook`, { method: "GET" });
    expect(get.status).toBe(405);
  });

  it("C9 refuses a body with no externalId", async () => {
    const { status, json } = await postWebhook({ recordType: "sales_order", externalId: "" });
    expect(status).toBe(400);
    expect(String(json.error)).toContain("externalId is required");
  });

  it.skipIf(!allowWwWrites || !testItemSku || !hasNetSuite)(
    "C10 imports the manually created item into products",
    async () => {
      const rows = await suiteql(
        `SELECT id, itemid, displayname, upccode FROM item WHERE itemid = '${sql(testItemSku)}'`,
      );
      expect(rows).toHaveLength(1);
      const { status, json } = await postWebhook({
        recordType: "item",
        externalId: String(rows[0].id),
        lastModified: `apitest-${stamp}`,
        payload: {
          id: String(rows[0].id),
          itemId: String(rows[0].itemid),
          displayName: rows[0].displayname ? String(rows[0].displayname) : undefined,
          upcCode: rows[0].upccode ? String(rows[0].upccode) : undefined,
        },
      });
      expect(status).toBe(200);
      expect(json).toMatchObject({ received: true, recordType: "item", processed: true });
    },
  );
});

// ── D. Outbound queue drain ─────────────────────────────────────────────────

describe.skipIf(!functionsUrl || !queueSecret)("D. Outbound queue drain", () => {
  async function drain(secret: string) {
    const res = await fetch(`${functionsUrl}/process-netsuite-queue`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Queue-Secret": secret },
    });
    return { status: res.status, json: (await res.json().catch(() => ({}))) as Record<string, unknown> };
  }

  it("D1 refuses a caller with no credential at all", async () => {
    const res = await fetch(`${functionsUrl}/process-netsuite-queue`, { method: "POST" });
    expect(res.status).toBe(401);
  });

  it("D2 refuses a wrong runner secret", async () => {
    expect((await drain("not-the-secret")).status).toBe(403);
  });

  it("D3 drains without dead-lettering the parked order rows", async () => {
    const { status, json } = await drain(queueSecret);
    expect(status).toBe(200);
    if (json.skipped) {
      // A legitimate outcome: no connection, incomplete credentials, or no
      // adjustment account configured yet. Named so the reason is visible.
      expect(["no_netsuite_connection", "credentials_incomplete", "adjustment_account_not_configured"])
        .toContain(String(json.reason));
      return;
    }
    expect(json).toHaveProperty("processed");
    // The sales orders and purchase orders section C parked are still queued:
    // the claim filter must never hand them to the outbound worker.
    expect(json.deadLettered, `jobs were dead-lettered: ${JSON.stringify(json)}`).toBe(0);
  }, 120_000);
});

// ── E. Outbound: a real inventory adjustment in the sandbox ─────────────────

describe.skipIf(!hasNetSuite || !allowNetSuiteWrites)("E. Outbound inventory adjustment", () => {
  const locationId = env("NS_TEST_LOCATION_ID");
  const adjustmentAccountId = env("NS_TEST_ADJUSTMENT_ACCOUNT_ID");
  const subsidiaryId = env("NS_TEST_SUBSIDIARY_ID");
  const ready = Boolean(locationId && adjustmentAccountId && testItemSku);

  const recordUrl = () =>
    `https://${netsuiteHost(accountId)}/services/rest/record/v1/inventoryAdjustment`;

  async function postAdjustment(body: Record<string, unknown>) {
    const res = await fetch(recordUrl(), {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return { status: res.status, location: res.headers.get("Location"), text: await res.text() };
  }

  it.skipIf(!ready)("E1 posts an adjustment and returns a record URL", async () => {
    const itemRows = await suiteql(
      `SELECT id FROM item WHERE itemid = '${sql(testItemSku)}'`,
    );
    expect(itemRows).toHaveLength(1);

    const externalId = netsuiteAdjustmentExternalId(`apitest-${Date.now()}`);
    const body = buildNetSuiteInventoryAdjustment({
      externalId,
      adjustmentAccountId,
      subsidiaryId: subsidiaryId || null,
      itemId: String(itemRows[0].id),
      locationId,
      quantityDelta: 1,
      memo: "Warehouse Wizard API integration test",
    });
    expect(Object.keys(body).sort()).toEqual(
      subsidiaryId
        ? ["account", "externalId", "inventory", "memo", "subsidiary"]
        : ["account", "externalId", "inventory", "memo"],
    );

    const created = await postAdjustment(body as unknown as Record<string, unknown>);
    expect(created.status, created.text.slice(0, 400)).toBeLessThan(300);
    expect(created.location, "no Location header on the created adjustment").toBeTruthy();

    // The idempotency net: NetSuite keeps externalId unique per record type, so
    // a retry cannot create a second adjustment, and the worker's eid: lookup
    // finds the first.
    const retry = await postAdjustment(body as unknown as Record<string, unknown>);
    expect(retry.status).toBeGreaterThanOrEqual(400);

    const lookup = await fetch(`${recordUrl()}/eid:${externalId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(lookup.status).toBe(200);
    const record = (await lookup.json()) as { id?: string | number };
    expect(String(record.id)).toBe(String(created.location!.split("/").pop()));

    // Leave the sandbox's stock as it was found.
    const reversal = await postAdjustment({
      ...(buildNetSuiteInventoryAdjustment({
        externalId: `${externalId}-reversal`,
        adjustmentAccountId,
        subsidiaryId: subsidiaryId || null,
        itemId: String(itemRows[0].id),
        locationId,
        quantityDelta: -1,
        memo: "Warehouse Wizard API integration test (reversal)",
      }) as unknown as Record<string, unknown>),
    });
    expect(reversal.status, `reversal failed - sandbox stock left +1: ${reversal.text.slice(0, 300)}`)
      .toBeLessThan(300);
  }, 120_000);

  it("E2 names what is missing when the write prerequisites are incomplete", () => {
    expect(
      ready,
      "set NS_TEST_ITEM_SKU, NS_TEST_LOCATION_ID and NS_TEST_ADJUSTMENT_ACCOUNT_ID to run E1",
    ).toBe(true);
  });
});
