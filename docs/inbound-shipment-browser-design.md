# Inbound shipment browser: design for review

Status: **proposal, nothing built.** Sandbox repo only (`classicitbb/warehousewizard-sandbox`).
Written 2026-10-14. Builds on `docs/netsuite-phase1-tasks.md` (W2, W3c, W4) and
`docs/netsuite-receiving-returns-sales-research.md` §3.3.

**Confidence tags:** **[Code]** read in this repo, **[Doc]** stated in Oracle's NetSuite help or a
published SuiteQL example, **[Verify]** unknown for the Simplex account until the discovery queries in §9 run.

---

## 1. What we want

From the Receiving page an operator can:

1. browse NetSuite inbound shipments (containers),
2. search by shipment number, container number or purchase order number,
3. sort by date,
4. open a shipment and preview every PO on it and every item on each PO,
5. pick one and have the New Shipment dialog open with the container number, every PO number and every line already loaded, so all that is left is to adjust quantities, **Save** and **Receive**.

## 2. Recommendation in one paragraph

**No new page.** Add a **View inbound** button to the Receiving header, beside *Print drafts* and *New*.
It opens a full-height dialog (a sheet on phones) containing a searchable, sortable list of shipments
that expand to show POs and items. **Receive this shipment** closes the browser and opens the existing
New Shipment dialog, prefilled. The same browser is reachable from inside the New Shipment dialog
(a *Browse inbound* link next to the container field) so scanning a container and browsing are one flow.
Reading from NetSuite can be built now. **Posting** the receipt back to NetSuite is a separate piece (W3c)
that is still blocked, and this design does not depend on it.

## 3. What already exists [Code]

| Piece | Where | Relevance |
|---|---|---|
| On-demand PO / transfer order lookup by number | `supabase/functions/netsuite-lookup`, `_shared/netsuite-lookup.ts`, `src/features/receiving/netsuite-lookup*.ts`, `netsuite-lookup-panel.tsx` | Same shape of work. Inbound shipment lookup is the open part of W2 |
| Shared NetSuite client (session, `netsuiteSuiteQL`, `netsuiteGetRecord`) | `_shared/netsuite-client.ts` | Reuse as is. SuiteQL is capped at 100 rows per call here |
| Lines → shipment lines mapper, merge, variance | `netsuite-lookup-lines.ts` | Reuse. Needs a per-line PO (see §6) |
| Item mapping (NetSuite item id → local product) | `external_record_links` lookup inside `netsuite-lookup/index.ts` | Reuse so lines for un-imported items are flagged, not broken |
| Receipt idempotency helpers incl. `inbound_shipment` type | `_shared/netsuite-receipt.ts` | Ready for W3c, not used yet |
| New Shipment dialog | `receiving-page.tsx` ~L1178 | Header has Container, PO number, then lines |
| Receiving header actions | `receiving-page.tsx` ~L1113 | *Print drafts* and a *New* dropdown. Room for one more button |

What does **not** exist: any way to list or search NetSuite documents, any inbound shipment code in the app,
and any place to store more than one PO on a shipment.

## 4. NetSuite research

### 4.1 Records and fields

An inbound shipment is a container-level document that can carry lines from **many POs and vendors**. [Doc]

**Header** (`InboundShipment` in SuiteQL, `inboundshipment` in REST/SuiteScript): [Doc]

| Field | Use here |
|---|---|
| `id`, `shipmentnumber` | System number, shown to the user and searchable |
| `externaldocumentnumber` | "Identifying number as supplied by your shipping company". **Likely candidate for the container number** [Verify] |
| `vesselnumber`, `billoflading` | Other candidates for container / BL, and worth displaying |
| `shipmentstatus` | Filter. Only *In Transit* and *Partially Received* can be received |
| `expectedshippingdate`, `actualshippingdate`, `expecteddeliverydate`, `actualdeliverydate` | Sort and display. Expected delivery is the natural default sort |
| `shipmentmemo` | Display |

**Lines** (`InboundShipmentItem`): [Doc, via Tim Dietrich's published query]

| Column | Meaning |
|---|---|
| `inboundshipment` | Join to the header `id` |
| `purchaseordertransaction` | The PO. Join to `Transaction.id` for `tranid` and vendor |
| `shipmentitemtransaction` | The PO line. Join to `TransactionLine.uniquekey` (the PO line's `lineuniquekey`) for the item |
| `quantityexpected`, `expectedrate`, `unit`, `shipmentitemdescription`, `receivinglocation` | Display |
| received quantity column | Exists in the REST record (received and billed quantities). SuiteQL column name **[Verify]** |

### 4.2 Constraints that shape the design

- **Receiving cannot be done over REST.** It needs SuiteScript's `receiveinboundshipment`, which the sandbox
  RESTlet (script 2142) wraps. Receiving creates **one item receipt per PO**. [Doc]
- **A PO that sits on an inbound shipment can only be received through the shipment.** [Doc, confirmed in the
  meeting, whitepaper §5.2] The browser must therefore show those POs as "on shipment X" and the existing
  *Look up purchase order* button must not offer to receive them on their own. Open item J6 covers the exception.
- **Limits:** 500 lines per shipment. Assembly items and item groups are unsupported for inventory detail. [Doc]
- **Feature must be on.** The `InboundShipment` tables exist only with Inbound Shipment Management enabled.
  The sandbox RESTlet was built, so it is on at least there. [Doc]
- **Account concurrency is shared** (J4), so the browser is **user-initiated only**: no polling, no background
  refresh. Search on Enter or after a short pause, not on every keystroke.

### 4.3 Queries

Shipment list, one row per shipment, with search and sort pushed to SuiteQL:

```sql
SELECT s.id, s.shipmentnumber, s.externaldocumentnumber, s.billoflading, s.vesselnumber,
       BUILTIN.DF(s.shipmentstatus) AS statusname, s.shipmentstatus AS statuscode,
       s.expecteddeliverydate, s.actualshippingdate,
       (SELECT COUNT(DISTINCT i.purchaseordertransaction) FROM inboundshipmentitem i WHERE i.inboundshipment = s.id) AS pocount
FROM inboundshipment s
WHERE s.shipmentstatus IN ('inTransit', 'partiallyReceived')        -- [Verify] exact values
  AND ( UPPER(s.shipmentnumber) LIKE ? OR UPPER(s.externaldocumentnumber) LIKE ?
        OR UPPER(s.billoflading) LIKE ? OR s.id IN (
          SELECT i.inboundshipment FROM inboundshipmentitem i
          JOIN transaction po ON po.id = i.purchaseordertransaction
          WHERE UPPER(po.tranid) LIKE ?) )
ORDER BY s.expecteddeliverydate DESC NULLS LAST, s.id DESC
```

Detail for one shipment (the preview and the prefill use the same call):

```sql
SELECT i.id AS shipmentlineid, po.id AS poid, po.tranid AS ponumber, BUILTIN.DF(po.entity) AS vendor,
       pl.uniquekey AS linekey, pl.linesequencenumber AS linenumber, pl.item AS itemid,
       BUILTIN.DF(pl.item) AS itemname, i.quantityexpected, BUILTIN.DF(i.unit) AS unit,
       BUILTIN.DF(i.receivinglocation) AS location
FROM inboundshipmentitem i
JOIN transaction po ON po.id = i.purchaseordertransaction
JOIN transactionline pl ON pl.uniquekey = i.shipmentitemtransaction
WHERE i.inboundshipment = ?
ORDER BY po.tranid, pl.linesequencenumber
```

The existing client sends the query text without bound parameters. Keep the current approach
(validate the input against a strict pattern, escape quotes) as `_shared/netsuite-lookup.ts` already does,
rather than introducing a second style.

## 5. UX and navigation

### 5.1 Where it lives

```
Receiving
├─ [Print drafts] [View inbound] [New ▾]        ← one new button
├─ search drafts / draft list                    (unchanged)
└─ dialogs
   ├─ Inbound browser   (new)  ← View inbound, or "Browse inbound" in New Shipment
   └─ New Shipment      (existing, now accepts a whole inbound shipment)
```

No route, no sidebar entry, no new page. It is a dialog because the operator always arrives from Receiving and
returns to Receiving, and a dialog keeps their unsaved draft state (the page already snapshots dialog state).

### 5.2 Inbound browser

- **Top:** one search box that matches shipment number, container / external document number, bill of
  lading, or PO number, plus a scan button (reuse the container scan from the New Shipment dialog).
  A small hint under it names what was matched ("matched PO 4521 on shipment ISH-0098").
- **Filters:** status chips, *In transit* and *Partially received* on by default, *Received* and *All* off.
- **Sort:** expected delivery date (default, soonest first), shipment number, status. Ascending/descending toggle.
- **List:** one card per shipment: number, container / external document number, status badge, expected
  delivery date, "3 POs · 42 lines · 1,860 units". Cards load 25 at a time (*Load more*).
- **Preview:** expanding a card (or selecting it, on a phone) shows POs as groups, each with vendor and its
  lines: item, description, expected, already received, unit. Lines whose item is not imported into Warehouse
  Wizard are marked and will be skipped on load, exactly like the PO lookup does today.
- **Badge:** if a draft group already exists for this container in Warehouse Wizard, the card says
  "Draft in progress" and the button becomes *Open drafts* instead of creating a duplicate.
- **Action:** **Receive this shipment** (primary), disabled offline with the same message the lookup uses.
- **Empty and error states:** "No inbound shipments match", "NetSuite is busy, try again" (the 429 case),
  "NetSuite is not connected" (the existing `unavailable` result).

### 5.3 The prefilled New Shipment dialog

- Container number = the shipment's container value (see §8 on where that lives). It still passes through the
  ISO 6346 check; if the value is not a valid container number the field is filled but flagged, as today.
- The single *PO number* field becomes **read-only chips** when the shipment has several POs ("PO 4521 · PO 4533 · PO 4540").
- Lines are grouped by PO. Each line keeps its existing card and shows its PO and NetSuite line note
  ("PO 4521 · NetSuite line 3 · ordered 600 · already received 0 · expecting 600").
- Quantity defaults to what NetSuite still expects, as the PO lookup does. The operator edits to what is on the floor.
- Short or over quantities are flagged by the existing variance note.
- **Save** creates the draft pallets. **Receive** keeps its current meaning (confirm labels, hand to put-away).

### 5.4 Why not the alternatives

| Option | Verdict |
|---|---|
| New "Inbound" page | Rejected. Adds navigation, and the operator would bounce between two pages for one task |
| Only a bigger lookup box in the New Shipment dialog | Too small for previewing several POs. Kept as the second entry point instead |
| A combined PO + shipment lookup panel | Confusing: a PO on a shipment cannot be received alone |

## 6. Data and code changes

Follows the repo rule to keep features segmented by page: everything below sits in `src/features/receiving/`
and `supabase/functions/`, with no changes to unrelated pages.

### 6.1 New files

| File | Purpose | Approx. size |
|---|---|---|
| `supabase/functions/_shared/netsuite-inbound.ts` | Pure: input validation, the two SuiteQL builders, row → `InboundShipment` / `InboundShipmentDetail` mapping. No imports, so Vitest runs it | ~200 lines |
| `supabase/functions/netsuite-inbound/index.ts` | Edge function: `{ action: 'list' \| 'detail', ... }`. Same auth and `receiving` edit permission check as `netsuite-lookup`. Adds `localProductId` the same way | ~150 lines |
| `src/features/receiving/netsuite-inbound.ts` | Browser client and types, mirrors `netsuite-lookup.ts` | ~120 lines |
| `src/features/receiving/inbound-browser-dialog.tsx` | The dialog: search, filters, list, preview | ~300 lines |
| `src/features/receiving/inbound-shipment-lines.ts` | Pure: detail → shipment lines plus PO list (extends the logic in `netsuite-lookup-lines.ts`) | ~100 lines |
| `src/test/netsuite-inbound.test.ts`, `src/test/inbound-shipment-lines.test.ts` | Unit tests | |

### 6.2 Changes to existing files

| File | Change |
|---|---|
| `receiving-page.tsx` | *View inbound* button, dialog state, `loadInboundShipment()` that fills the form. It is already 1,470 lines, so the new logic stays in the files above and the page gets only wiring |
| `receiving-form-state.tsx` | `NetSuiteLineRef` gains `poNumber` and `poId`. The form gains `inbound_shipment: { id, number } \| null` |
| `receiving-core.ts` | `ShipmentDraftLineInput` gains `po_number`. `saveShipmentDrafts` uses the **line's** PO for each row's `po_number` (falls back to the form PO), and writes `inboundShipmentId` into `notes.netsuite` |
| `netsuite-lookup-panel.tsx` | When the PO number belongs to a shipment, say so and point to the browser instead of loading the lines |
| `netsuite-lookup-lines.ts` | Export the shared line-mapping helper so both paths use one implementation |
| `docs/netsuite-phase1-tasks.md` | Mark W2 inbound shipment lookup in progress, add a note for this feature |

### 6.3 The important model change: one PO per shipment today

Today a shipment form has one `po_number`, and every pallet draft row gets that same value [Code:
`saveShipmentDrafts`]. An inbound shipment has many POs, so a PO must be carried **per line**.
There is **no database migration**: `receipts.po_number` already exists on each pallet row, and the NetSuite
line reference already lives in the `notes` JSON (W4). Each pallet row simply receives its own line's PO.
Everything that reads `po_number` today (search, print drafts, labels) keeps working, because each row still
has exactly one PO. Search by PO will find the container through any of its POs, which is what an operator wants.

For posting later (W3c), the receipt job needs: the inbound shipment id, and per line the PO line key and quantity.
Both are stored by this change, so W3c does not need the screen reworked.

## 7. Receiving and posting back to NetSuite

- Reading is independent of posting. The browser and prefill work with the RESTlet untested.
- **Save and Receive in Warehouse Wizard** keep today's meaning (draft pallets, then label confirmation).
  Nothing is sent to NetSuite from this feature.
- **Posting (W3c)** later reads `inboundShipmentId` plus the line keys from the drafts and calls the RESTlet
  with `externalRef`, using the helpers already in `_shared/netsuite-receipt.ts`.
- **Partial receipts:** the browser shows NetSuite's received quantity, so a half-received container
  comes back with only what remains and the prefill defaults to the remaining quantity.
- **Blocked on others:** the RESTlet run on real data (J2, J10), and the answer to J6.

## 8. Open questions and risks

| # | Question | Why it matters | Answer from |
|---|---|---|---|
| 1 | **Where is the container number stored?** `externaldocumentnumber`, `vesselnumber`, `billoflading`, or a custom field | Search by container and the prefill both depend on it. If it is a custom field the queries change | Discovery query A below |
| 2 | Exact `shipmentstatus` values and the received-quantity column on `InboundShipmentItem` | Status filter and "already received" | Discovery queries A and B |
| 3 | Does the M2M role have *View* on Inbound Shipment, and the Transactions / Lists permissions the joins need? | A permissions error looks like "no shipments" | Admin / first live call |
| 4 | Do Simplex shipments mix vendors and currencies (allowed by NetSuite)? | Only display, but the preview groups by PO and shows vendor | Data |
| 5 | Does a PO on a shipment ever get received directly (J6)? | Decides whether the PO lookup warns or blocks | NetSuite dev |
| 6 | How many open shipments are there? | Sizes paging. Tens means a plain list, thousands means search-first | Discovery query C |
| 7 | Receiving location on the shipment vs the warehouse the operator selected | The dialog should warn on a mismatch, using the existing Location Mapping | Data + Location Mapping |
| 8 | Inventory detail (lot, serial, bin, status) on shipments needs a NetSuite-Support-enabled setting | Affects W3c, not this read feature | NetSuite dev |

**Risks:** SuiteQL column names are from a public example and the Oracle record reference, not from this
account, so the first live run may need small query fixes. The pure mapper isolates that to one file.
The edge function must be deployed to the beta project before any of this can be tried (Lovable-managed,
so that is done from the Lovable side, not from here).

## 9. Discovery queries (read-only, run once Test connection is green)

```sql
-- A. columns, statuses and the container question
SELECT * FROM inboundshipment FETCH FIRST 5 ROWS ONLY
SELECT DISTINCT shipmentstatus, BUILTIN.DF(shipmentstatus) FROM inboundshipment
-- B. line columns, including received quantity
SELECT * FROM inboundshipmentitem FETCH FIRST 5 ROWS ONLY
-- C. volume
SELECT BUILTIN.DF(shipmentstatus) AS status, COUNT(*) FROM inboundshipment GROUP BY BUILTIN.DF(shipmentstatus)
```

Also confirm with the NetSuite developer (Jan): what the team writes in `externaldocumentnumber` today, and
whether the container number is in a custom field.

## 10. Test plan

- **Unit (Vitest, no network):** query builders reject odd input and escape quotes; row mapping with
  missing columns; PO grouping; items not imported are skipped with a reason; duplicate loads do not
  double lines; per-line PO reaches each pallet row; drafts written before this change still open.
- **Component:** the browser's empty, loading, error and unavailable states; search term → request; sort and filter toggles.
- **Manual in the sandbox with seed data (S1):** a shipment with two POs and a lot-tracked item: search by
  shipment, container and PO; preview; prefill; save; confirm drafts carry the right PO each.
- `npm run typecheck` (not `tsc --noEmit`, which checks nothing here) and the existing test suite.

## 11. Rough effort and order

| Step | Content | Estimate |
|---|---|---|
| 1 | Discovery queries answered (§9). Gate for the rest | Waiting on NetSuite access |
| 2 | `netsuite-inbound` shared module, edge function, client, tests | 2 d |
| 3 | Browser dialog and header button | 2–3 d |
| 4 | Multi-PO prefill, per-line PO on drafts, lookup-panel warning, tests | 2 d |
| 5 | Live check against sandbox data (S1) and fixes | 1–2 d |

About **7–9 working days**, roughly half of W2's remaining budget (10–15 d for all of W2). It does not
include W3c posting.

## 12. Decisions needed before building

1. Confirm **View inbound button + dialog**, no new page.
2. Confirm the **default filter** (In transit and Partially received) is right, and that received shipments are out of the list by default.
3. Confirm that **Save and Receive keep their current meaning** and nothing posts to NetSuite from this feature.
4. Which NetSuite field holds the container number (§8 item 1), or approval to build against `externaldocumentnumber` and fix after the first live run.
5. Whether a shipment that already has drafts should **block** a second prefill or only warn.

### Decided (2026-10-14)

1. **Container field (corrected by Simplex, replaces the earlier guess):** the container number is a custom **Container No**
   field on the inbound shipment, not `externaldocumentnumber`. It can hold **several containers in one value**
   ("SMLU7872173, SMLU3120938"). A shipment can have one or more containers, and a container can carry several POs.
   Search matches shipment number, Container No, PO number, and (as fallbacks) carrier reference, bill of lading and vessel number.
   The field's script id is account-specific, so the edge function reads it from the record's columns (first custom column
   with "container" in its id, excluding size/status/type/etc.) or from `inbound_container_field` on the NetSuite connection config
   (set that to pin it). If NetSuite rejects the field the list still loads without it and the browser says container numbers are missing.
2. **Default filter:** In transit and Partially received. Received shipments are hidden unless the filter is changed.
3. **Existing drafts block a second prefill.** The shipment card says "Drafts in progress" and offers *Show drafts* instead of *Receive this shipment*.
   A shipment counts as drafted when any draft carries its NetSuite shipment id, or has the same container number.
4. Save and Receive keep their current meaning; nothing posts to NetSuite from this feature.

### Multi-container shipments (added after Simplex's correction)

NetSuite ties **PO lines to the shipment**, not to a container. Unless the shipment lines carry a custom container
column (unconfirmed, see discovery below), Warehouse Wizard cannot know which PO lines are in which container.
So for a shipment with N containers:

- the card lists the containers and offers **one Receive button per container** ("Receive SMLU3120938");
- receiving one loads **every PO line on the shipment** with the chosen container in the form, and the dialog says so:
  the operator sets each quantity to what is in that container;
- drafts are blocked **per container**, not per shipment: finishing container A does not block container B. For a
  single-container shipment the shipment id alone still blocks (decision 3);
- until posting (W3c) exists, NetSuite's received quantities do not move, so container B loads the same expected
  quantities again and the operator must trim them. After W3c posts container A, B loads only what remains.

### Implementation notes (added while building)

- Built: `_shared/netsuite-inbound.ts` (queries, container-field discovery, row mapping), `netsuite-inbound` edge function,
  `src/features/receiving/` `netsuite-inbound.ts`, `inbound-shipment-lines.ts`, `inbound-shipment-card.tsx`,
  `inbound-browser-dialog.tsx`, plus wiring in `receiving-page.tsx` and a PO-on-shipment warning in `netsuite-lookup-panel.tsx`.
  No migration. Not yet deployed to the beta project, and not yet run against NetSuite.
- Discovery to run first against NetSuite: `SELECT * FROM inboundshipment FETCH FIRST 1 ROWS ONLY` (find the Container No
  column id) and `SELECT * FROM inboundshipmentitem FETCH FIRST 1 ROWS ONLY` (is there a container column on lines, and the
  received-quantity column name).
- If shipment lines **do** carry a container, a follow-up can load only that container's lines.

- Received quantities per shipment line come from a best-effort second query. If NetSuite rejects the column,
  the browser says received quantities are unavailable for partially received shipments rather than guessing.
- The PO lookup panel asks `netsuite-inbound` whether the PO sits on an open shipment (action `for_po`). If so it
  points to the browser instead of loading the PO's lines.
