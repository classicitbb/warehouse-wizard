# NetSuite Integration: Phase 1 Task List

Source: `outputs/Warehouse Wizard x NetSuite - Integration Proposal.pdf` (22 Sep 2026) and `... NetSuite Developer Brief.pdf` (24 Sep 2026). Phase 1 is one-entry receiving against purchase orders, inbound shipments and transfer orders, estimated at 60-96 working days.

Status legend: `[ ]` not started, `[~]` in progress or partly done, `[x]` done, `[!]` blocked.

Last updated: 2026-10-21, after the NetSuite dev's reply of the same week (RESTlet released, test data supplied). Version 1.32.0.

## Current state

**Built in this repo**
- OAuth 2.0 M2M client-assertion auth (`supabase/functions/_shared/netsuite-auth.ts`).
- Outbound inventory adjustment worker (`process-netsuite-queue`) with retry and dead-letter handling.
- `netsuite-webhook`, which parks inbound records in `integration_sync_jobs`. No processor exists for them yet.
- Item import via SuiteQL and warehouse-to-location mapping in Settings.

**Built on the NetSuite side (sandbox, deployed and Released, not yet run by us)**
- Inbound shipment RESTlet, script 2142, deploy 1, host `9738806-sb1.restlets.api.netsuite.com`. The text ids `customscript_spx_ww_inb_receipt_rl` / `customdeploy_spx_ww_inb_receipt_rl` work in the URL in place of the numeric ones, which are sandbox-specific. Production host is `9738806.restlets.api.netsuite.com`.
- `POST` receives an inbound shipment. `GET ...&inboundShipmentId=<id>` reports the real field and sublist ids. `inboundShipmentId` is the shipment's **internal id**, not the document number (IS052 is 52). The GET is read-only.
- Idempotency uses custom Item Receipt body field `custbody_spx_ww_external_ref`, not native `externalId`. A retry returns the existing ids with `alreadyProcessed: true`.
- The deployment is open to all internal roles for now. The sandbox M2M certificate maps to Administrator (`-3`). A dedicated integration role comes before production.
- The integration record has the RESTlets scope ticked alongside REST Web Services.

**Our token scope (found 2026-10-21):** the client assertion asked for `rest_webservices` only. A RESTlet call needs `restlets` in the assertion as well, so `openNetSuiteSession(admin, ['restlets'])` now requests it. REST calls still request `rest_webservices` only.

**Sandbox test data (supplied by the dev):** inbound shipment IS052 (internal id 52) carrying PO76 and PO233; lot-tracked item TC5226Y; location with bins LOC-01 Lower Estate; transfer order TO05; sales order SO1948; return authorisation RMA07. **Tell the dev before posting any receipt against IS052**, so we do not both consume it.

## Decisions and notes that affect the code

- The RESTlet is on a different host from `/services/rest/`. Store the RESTlet URL, script id and deploy id in the connection config.
- The integration record probably needs the **RESTlets** scope as well as REST Web Services. Confirm with the dev before the first call.
- The client must treat `alreadyProcessed: true` as success.
- The RESTlet response can carry several item receipt ids, one per PO. Store all of them.
- `receiveinboundshipment` is not in the REST metadata-catalog (404). Take its field names from the RESTlet `GET`, not the catalog.

## A. NetSuite-side (owner: NetSuite dev, unless noted)

| # | Task | Status | Notes |
|---|---|---|---|
| J1 | Upload the production M2M certificate and confirm Test connection passes | [ ] | **Not done.** The certificate and passing Test connection the dev mentioned earlier were on the sandbox. He will upload the production one closer to go-live. |
| J2 | Build the inbound shipment RESTlet | [x] | Deployed to sandbox and Released. We still have to run the GET (J10). |
| J3 | Give us the GL account (and subsidiary) for inventory adjustments | [x] | Sandbox: set and in use (three adjustments posted 2026-10-10). Production account still to come. |
| J5 | Sandbox integration record and beta certificate | [x] | Sandbox M2M auth works and Test connection passes (account `9738806-sb1`). |
| J6 | Does receiving a PO directly off a shipment update the shipment, or is it refused? | [~] | Dev is testing on a separate PO so IS052 stays clean. Not yet answered. |
| J10 | Confirm field names and line identifiers | [x] | Run 2026-10-21 via `netsuite-discovery`. Confirmed, with two differences from the dev's note: see **J10 findings** below. Lookup parser tightened; output saved as fixtures in `src/test/fixtures/netsuite/` and pinned by `netsuite-field-contract.test.ts`. Still open: status letter codes, restock field on RMA receipt lines, inventory detail casing on the receipt transform. |
| S1 | Create sandbox test data: inbound shipment with two POs, a lot-tracked item, a location with bins, plus a transfer order, a sales order and a return authorisation | [x] | Supplied: see the sandbox test data above. |
| S2 | Scope the RESTlet deployment to the M2M role only | [!] | Waiting on the dev. Sandbox runs as Administrator (`-3`) with the deployment open to all internal roles. Before production he creates a dedicated role with only the permissions in our brief, scopes the deployment to it, and sends us its name and id. |
| S3 | Run the read-only discovery queries and share the results | [ ] | Listed in the Developer Brief. The dev's last reply did not mention them: chase. |
| S4 | Add the PO number to the printed receiving report (J7) | [ ] | The scan trigger for the whole receiving flow. |
| S5 | Create mirrored bins for Pine and Lower Estate, with Wilson | [ ] | Gates W5. |

## B. Our tasks

| # | Task | Status | Blocked by |
|---|---|---|---|
| **Us-1** | Send the dev the M2M integration role name/id | [x] | Closed. The dev named the role himself: Administrator (`-3`) in sandbox, dedicated role before production. |
| **Us-2** | Confirm the integration record has the RESTlets scope | [x] | Confirmed by the dev. The token request now asks for `restlets` too (see above). |
| **Us-3** | Add RESTlet URL, script id and deploy id to the connection config | [x] | Settings > Integrations > NetSuite has Script ID and Deploy ID fields (config keys `restlet_script_id`, `restlet_deploy_id`). Blank uses the agreed text ids. The host is derived from the account id (`_shared/netsuite-restlet.ts`). |
| **W1** | Bring Pine and Lower Estate in and audit single-warehouse assumptions (5-8 d) | [ ] | Nothing. |
| **W4** | Record the NetSuite source line number on each Warehouse Wizard line (2-4 d) | [x] | Saved as `netsuite` in each pallet draft's `receipts.notes` JSON (line key, line number, ordered, received, remaining) and restored when a draft is edited. The same `receipts` row becomes the completed receipt, so W3 reads it from there. No migration. |
| **W2** | On-demand lookup by document number for PO, inbound shipment and transfer order (10-15 d) | [~] | PO and transfer order lookup done end to end: `netsuite-lookup` function plus the Receiving screen (unit-tested, not yet run against NetSuite). Inbound shipment lookup built as **Receiving > View inbound** (`netsuite-inbound` function, browser dialog, multi-PO and multi-container prefill; unit and page tested, not yet run against NetSuite): see `docs/inbound-shipment-browser-design.md`. Remaining: deploy both functions to the beta, confirm the shipment's Container No field id and the shipment-line columns (design doc, Discovery), live check (J5, S1). |
| **W3a** | Post receipts: purchase order, via `purchaseOrder/{id}/!transform/itemReceipt` (part of 12-18 d) | [ ] | J10 (receipt line field `orderLine`). Test on a standalone PO, not one on IS052. J6 decides whether a PO on a shipment may be received this way at all. |
| **W3b** | Post receipts: transfer order, via `transferOrder/{id}/!transform/itemReceipt` | [ ] | TO05 to test with. The dev is testing whether the REST transform can name the fulfilment. If it cannot, TO receipts go through the RESTlet too. Build the single-fulfilment case first. |
| **W3c** | Post receipts: inbound shipment, via the RESTlet. Send `externalRef`, treat `alreadyProcessed` as success, store all receipt ids. | [ ] | J10: run the RESTlet GET for shipment 52 first. Tell the dev before the first receipt against IS052. |
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

1. **Now:** run `netsuite-discovery` (RESTlet GET for shipment 52, then the metadata catalog) and record the output as test fixtures (J10). Tighten the lookup parser to the verified names. Chase S3 with the dev.
2. **Next:** W3a and W3b against standalone sandbox POs and TO05, then W3c against IS052 once the dev has been told. Short-delivery policy (P7) is needed before the receiving screens.
3. **Waiting on the dev:** J6 (PO on a shipment), the TO fulfilment question, the dedicated role (S2), and the production certificate (J1).
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
- **Verified against the account (J10, 2026-10-21):** the normaliser reads only the confirmed names. `line`, `quantity`, `quantityReceived`, `quantityFulfilled` (transfer order), `isClosed` and `units` (an id, returned as `unitId`) on both records. The REST record returns no line key on either, so the lookup builds `<internal id>:<line>`. Status code is `orderStatus.id`. A PO line's location is `targetLocation`. Run live against PO76 and TO05 on 2026-10-21 (internal ids 2751 and 16317); the raw records are the fixture `record-po76-and-to05.json`.
- **Open:** does a PO that sits on an inbound shipment show up here as receivable? Per J6 it can only be received through the shipment, so the lookup should flag it once J6 is answered.
- `netsuite-connection` still has its own credential and SuiteQL helpers. Move it onto `_shared/netsuite-client.ts` once W2 is accepted.

## W2 lookup: Receiving screen

- New Shipment dialog: under **PO number**, a "Look up purchase order/transfer order in NetSuite" button (shown for receipt type PO or Transfer, hidden when editing a draft, disabled offline or with no number).
- A found document shows status, vendor and each line as ordered, received and remaining. **Load lines into shipment** creates one shipment line per line that can still be received, with total set to what NetSuite expects and left as a single pallet for the operator to split.
- Lines are skipped, with the reason shown, when nothing is left to receive or the item has not been imported. Looking a document up twice replaces its lines rather than duplicating them.
- Each loaded line shows its NetSuite line, ordered, already received and expecting, and flags "short by n" or "over by n" as the operator edits the total. This is display only until the short-delivery policy (P7) is decided.
- **Persisted (W4):** the NetSuite line reference is saved with each pallet draft and restored on edit. One NetSuite line split over several pallets produces several drafts that share the same line key; W3 should sum them per line.
- Files: `netsuite-lookup-panel.tsx`, `netsuite-lookup-lines.ts`, `netsuite-lookup.ts` in `src/features/receiving/`; wiring in `receiving-page.tsx` and `shipment-line-card.tsx`.

## J10 findings (sandbox 9738806-sb1, 2026-10-21)

- **`line` versus `orderLine`:** the dev's understanding holds. Source orders identify a line by `line`. Item receipt and item fulfilment lines carry `orderLine` (the source order's line) and `orderDoc` (the source order). `orderLine` also exists on PO, SO and RMA lines but is not the identifier; the parser never reads it.
- **Line keys (correction to the dev's note):** the catalog lists `uniqueKey` (integer) on a purchase order line and `lineUniqueKey` (string) on sales order and return authorisation lines, and nothing on a transfer order line. **The REST record returns none of them**: PO76's line (live lookup, 2026-10-21) has no key. Lines are identified by `line` alone. The lookup builds `<internal id>:<line>` as its own key. The inbound shipment RESTlet does expose `uniquekey` and `origline`.
- **Receipt line (`itemReceipt.item`):** `line`, `orderLine`, `orderDoc`, `itemReceive` (boolean, to include or skip the line), `quantity`, `quantityRemaining`, `location`, `binNumbers`, `inventoryDetail`.
- **PO on an inbound shipment (J6):** PO76's line shows `quantityOnShipments: 15040`, equal to its quantity, and it is on IS052. The lookup now returns `quantityOnShipments`; the receiving screen can flag a PO line where it is above zero once the dev confirms whether direct receipt is refused.
- **Status:** `orderStatus.id` is the letter code (`B` on both PO76 and TO05). A PO's `status.id` is its label ("Pending Receipt"). A transfer order has no `status`, only `orderStatus`. Letter codes are per record type (B is Pending Receipt on a PO, Pending Fulfillment on a TO); the rest of the status list is still to collect.
- **Units:** `units` is the units-of-measure internal id as a string ("575" on PO76, "93" on TO05), not a name. The lookup returns it as `unitId`; names come from the synced units (`netsuite-units`).
- **Line location:** a PO line carries `targetLocation`; a TO line has none, so the header location applies.
- **TO05 is not receivable yet:** `quantityFulfilled` is 0 and the status is Pending Fulfillment. It needs an item fulfilment in the sandbox before a receipt can be tested. Ask the dev.
- **Inbound shipment RESTlet GET for IS052** (`restlet-inbound-shipment-52.json`): record `receiveinboundshipment`, sublist `receiveitems`, 36 lines across the two POs. Line fields include `uniquekey`, `origline`, `purchaseorder`, `item`, `quantity`, `quantityremaining`, `quantityreceived`, `quantitytobereceived`, `receiveitem`, `unit`, `unitid`, `receivinglocation`, `inventorydetailreq`, `inventorydetailset`, `isnumbered`, `isserial`. Body fields include `trandate`, `receivinglocation`, `postingperiod`, `inboundshipmentnumber`, `externalid`, `vendor`, `incoterm`. Inventory detail is a subrecord (`inventorydetail`), not a line field.
- **Gotcha:** a RESTlet GET without `Content-Type: application/json` fails with `400 INVALID_RETURN_DATA_FORMAT ("You should return text")` when the script returns an object. `netsuiteRestletGet` sends it. The POST must too.
- **Token scope:** the RESTlet call needs `restlets` in the client assertion, not only the scope ticked on the integration record.

## Discovery function (J10)

- Function `netsuite-discovery` (admin or developer only, read-only). It makes GET calls and the record types it can read are a fixed list (`_shared/netsuite-discovery.ts`).
- `{ "action": "restlet_get", "inboundShipmentId": "52" }` calls the inbound shipment RESTlet with the `restlets` scope and returns its field report.
- `{ "action": "catalog" }` returns field and sublist ids per record (`purchaseOrder`, `transferOrder`, `salesOrder`, `returnAuthorization`, `itemReceipt`, `itemFulfillment`) from the metadata catalog. Add `"raw": true` for the full schema, or `"records": [...]` to pick some.
- `{ "action": "record", "record": "purchaseOrder", "internalId": "2751" }` returns one record as the REST API returns it, to see what a field really holds. The catalog lists fields the record does not always return.
- It needs a signed-in admin or developer session. A call made without one returns 401 before reaching NetSuite.
