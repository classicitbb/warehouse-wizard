# NetSuite Integration: Phase 1 Task List

Source: `outputs/Warehouse Wizard x NetSuite - Integration Proposal.pdf` (22 Sep 2026) and `... NetSuite Developer Brief.pdf` (24 Sep 2026). Phase 1 is one-entry receiving against purchase orders, inbound shipments and transfer orders, estimated at 60-96 working days.

Status legend: `[ ]` not started, `[~]` in progress or partly done, `[x]` done, `[!]` blocked.

Last updated: 2026-09-29, after the NetSuite dev's J2 update.

## Current state

**Built in this repo**
- OAuth 2.0 M2M client-assertion auth (`supabase/functions/_shared/netsuite-auth.ts`).
- Outbound inventory adjustment worker (`process-netsuite-queue`) with retry and dead-letter handling.
- `netsuite-webhook`, which parks inbound records in `integration_sync_jobs`. No processor exists for them yet.
- Item import via SuiteQL and warehouse-to-location mapping in Settings.

**Built on the NetSuite side (sandbox, status TESTING, not yet run on real data)**
- Inbound shipment RESTlet, script 2142, deploy 1, host `9738806-sb1.restlets.api.netsuite.com`.
- `POST` receives an inbound shipment. `GET ...&inboundShipmentId=<id>` reports the real field and sublist ids.
- Idempotency uses custom Item Receipt body field `custbody_spx_ww_external_ref`, not native `externalId`. A retry returns the existing ids with `alreadyProcessed: true`.
- The deployment is currently open to all internal roles for testing.

## Decisions and notes that affect the code

- The RESTlet is on a different host from `/services/rest/`. Store the RESTlet URL, script id and deploy id in the connection config.
- The integration record probably needs the **RESTlets** scope as well as REST Web Services. Confirm with the dev before the first call.
- The client must treat `alreadyProcessed: true` as success.
- The RESTlet response can carry several item receipt ids, one per PO. Store all of them.
- `receiveinboundshipment` is not in the REST metadata-catalog (404). Take its field names from the RESTlet `GET`, not the catalog.

## A. NetSuite-side (owner: NetSuite dev, unless noted)

| # | Task | Status | Notes |
|---|---|---|---|
| J1 | Upload the production M2M certificate and confirm Test connection passes | [ ] | Status unknown. Blocks everything on production. |
| J2 | Build the inbound shipment RESTlet | [~] | Built and deployed to sandbox. Awaiting a run on real data. |
| J3 | Give us the GL account (and subsidiary) for inventory adjustments | [ ] | The adjustment worker will not run without it. |
| J5 | Sandbox integration record and beta certificate | [ ] | Status unknown. The beta must use separate credentials. |
| J6 | Does receiving a PO directly off a shipment update the shipment, or is it refused? | [~] | In progress on the dev's side. |
| J10 | Confirm field names and line identifiers | [~] | Waiting on a run of the RESTlet `GET` against real data. |
| S1 | Create sandbox test data: inbound shipment with two POs, a lot-tracked item, a location with bins, plus a transfer order, a sales order and a return authorisation | [ ] | Needed before acceptance testing. |
| S2 | Scope the RESTlet deployment to the M2M role only | [!] | **We owe the dev the role name/id.** |
| S3 | Run the read-only discovery queries and share the results | [ ] | Listed in the Developer Brief. |
| S4 | Add the PO number to the printed receiving report (J7) | [ ] | The scan trigger for the whole receiving flow. |
| S5 | Create mirrored bins for Pine and Lower Estate, with Wilson | [ ] | Gates W5. |

## B. Our tasks

| # | Task | Status | Blocked by |
|---|---|---|---|
| **Us-1** | Send the dev the M2M integration role name/id | [ ] | Nothing. Do first. |
| **Us-2** | Confirm the integration record has the RESTlets scope | [ ] | Dev confirmation. |
| **Us-3** | Add RESTlet URL, script id and deploy id to the connection config | [ ] | Nothing. |
| **W1** | Bring Pine and Lower Estate in and audit single-warehouse assumptions (5-8 d) | [ ] | Nothing. |
| **W4** | Record the NetSuite source line number on each Warehouse Wizard line (2-4 d) | [x] | Saved as `netsuite` in each pallet draft's `receipts.notes` JSON (line key, line number, ordered, received, remaining) and restored when a draft is edited. The same `receipts` row becomes the completed receipt, so W3 reads it from there. No migration. |
| **W2** | On-demand lookup by document number for PO, inbound shipment and transfer order (10-15 d) | [~] | PO and transfer order lookup done end to end: `netsuite-lookup` function plus the Receiving screen (unit-tested, not yet run against NetSuite). Inbound shipment lookup built as **Receiving > View inbound** (`netsuite-inbound` function, browser dialog, multi-PO and multi-container prefill; unit and page tested, not yet run against NetSuite): see `docs/inbound-shipment-browser-design.md`. Remaining: deploy both functions to the beta, confirm the shipment's Container No field id and the shipment-line columns (design doc, Discovery), live check (J5, S1). |
| **W3a** | Post receipts: purchase order, via `purchaseOrder/{id}/!transform/itemReceipt` (part of 12-18 d) | [ ] | J5, S1. |
| **W3b** | Post receipts: transfer order, via `transferOrder/{id}/!transform/itemReceipt` | [ ] | J5, S1. Verify how the transform names the fulfilment. |
| **W3c** | Post receipts: inbound shipment, via the RESTlet. Send `externalRef`, treat `alreadyProcessed` as success, store all receipt ids. | [!] | J2 tested, J10. |
| **W3d** | Add `externalRef` idempotency to all receipt job payloads | [~] | Helpers done in `_shared/netsuite-receipt.ts` (deterministic `externalRef`, one idempotency key per posting, payload builder, response reader that treats `alreadyProcessed` as success and keeps all receipt ids). Not yet used: W3a-c must call them when they enqueue receipt jobs. |
| **W5** | Map Warehouse Wizard bins to NetSuite bins, with tooling to create them (4-7 d) | [!] | S5. |
| **W16** | Queue reliability: ordering, retries, monitoring, runbook (5-8 d) | [ ] | Nothing. Extend the existing worker. |
| **W15** | Beta sandbox environment, parallel running and cutover (6-10 d) | [~] | J5. See `docs/netsuite-beta-sandbox-runbook.md`. |

## C. Business decisions

| # | Decision | Owner | Blocks |
|---|---|---|---|
| P7 | Short-delivery policy: the container holds 95, the PO says 100 | Roget / Wilson | W3 receiving screens |
| P4 | Confirm NetSuite feature switches, for example Advanced Shipping and Advanced Receiving | Wilson | Scope and estimates |
| P2 | Name and structure the Pine and Lower Estate zones, aisles and bins | Wilson / Roget | W1, W5 |
| P9 | Which products need expiry and lot tracking | Roget / Wilson | Cutover |
| P10 | Who signs off acceptance testing | Roget | Acceptance |

## Suggested order

1. **Now, unblocked:** Us-1, Us-2, Us-3, W1, W4, W3d, W16.
2. **Next:** W2 lookup, then W3a and W3b, tested against the sandbox once J5 and S1 are done.
3. **When the dev finishes testing:** W3c and J10, then S2 to lock down the RESTlet.
4. **Then:** W5 once the bins exist, acceptance testing, sign-off, cutover.

## Verify in the sandbox (from the Developer Brief)

- Line identification on transforms: `orderLine` versus `line`, per record type.
- The inbound shipment line key is the PO line's `lineuniquekey`.
- Transfer order receipts with several fulfilments: can the REST transform name the fulfilment?
- Inventory detail field casing per record, from the metadata catalog (not for `receiveinboundshipment`).
- Status letter codes for PurchOrd, TrnfrOrd, RtnAuth, SalesOrd and ItemShip.
- Restock field id on RMA item receipt lines.
- Coexistence with NetSuite's warehouse module at shared locations.

## W2 lookup: implementation notes

- Function `netsuite-lookup` takes `{ documentType: 'purchase_order' | 'transfer_order', documentNumber }`. It finds the record by exact `tranid` with SuiteQL, then GETs it with `expandSubResources=true`. It is user-initiated only, so it adds no polling load.
- It is gated by the Role Matrix `receiving` feature (edit), via `has_feature_permission`.
- Lines come back with the source line number and `lineuniquekey` as NetSuite sent them, plus `quantityRemaining` (a transfer order line is capped at what has shipped). Lines whose item is not yet imported have `localProductId: null`.
- If two records share a number the function returns `ambiguous` with candidates instead of guessing.
- Pure logic is in `supabase/functions/_shared/netsuite-lookup.ts`, the shared client in `_shared/netsuite-client.ts`, the browser client in `src/features/receiving/netsuite-lookup.ts`.
- **Unverified against the account (J10):** the REST field names on the PO and transfer order line sublists (`line`, `lineUniqueKey`, `quantityReceived`, `quantityFulfilled`, `isClosed`, `units`). The normaliser accepts several spellings. Tighten it after the first sandbox run.
- **Open:** does a PO that sits on an inbound shipment show up here as receivable? Per J6 it can only be received through the shipment, so the lookup should flag it once J6 is answered.
- `netsuite-connection` still has its own credential and SuiteQL helpers. Move it onto `_shared/netsuite-client.ts` once W2 is accepted.

## W2 lookup: Receiving screen

- New Shipment dialog: under **PO number**, a "Look up purchase order/transfer order in NetSuite" button (shown for receipt type PO or Transfer, hidden when editing a draft, disabled offline or with no number).
- A found document shows status, vendor and each line as ordered, received and remaining. **Load lines into shipment** creates one shipment line per line that can still be received, with total set to what NetSuite expects and left as a single pallet for the operator to split.
- Lines are skipped, with the reason shown, when nothing is left to receive or the item has not been imported. Looking a document up twice replaces its lines rather than duplicating them.
- Each loaded line shows its NetSuite line, ordered, already received and expecting, and flags "short by n" or "over by n" as the operator edits the total. This is display only until the short-delivery policy (P7) is decided.
- **Persisted (W4):** the NetSuite line reference is saved with each pallet draft and restored on edit. One NetSuite line split over several pallets produces several drafts that share the same line key; W3 should sum them per line.
- Files: `netsuite-lookup-panel.tsx`, `netsuite-lookup-lines.ts`, `netsuite-lookup.ts` in `src/features/receiving/`; wiring in `receiving-page.tsx` and `shipment-line-card.tsx`.
