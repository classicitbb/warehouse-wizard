# NetSuite integration research — receiving, storage, returns, sales orders

Research compiled 2026-09-22 for extending the NetSuite adapter beyond `item` inbound and
`inventoryAdjustment` outbound. Scope: **purchase orders and importation (inbound shipments,
landed cost)**, **transfer orders**, **returns**, **locations / bins / inventory status**, and the
**sales order → fulfillment** process. Research only — no code or schema has changed.

**Confidence tags** used throughout:

- **[Doc]** — stated in Oracle's NetSuite help (sources at the end).
- **[Practice]** — widely used NetSuite behaviour or id that Oracle's public pages do not state
  outright. Treat as very likely, but confirm it with the live discovery pack in §11.
- **[Verify]** — unknown for this account. The live pack in §11 answers it.

**Live account access was not possible during this research.** No NetSuite browser session was
signed in, and the edge-function route needs an admin session plus the M2M certificate, which
`docs/agent/HANDOFF.md` still lists as not uploaded. §11 is a read-only SuiteQL/metadata pack to run
the moment Test connection goes green.

---

## 0. Key findings (read this first)

1. **Every warehouse action in scope maps to a REST "transform".** You POST to the source record's
   `!transform` endpoint; NetSuite copies the lines, applies your changes, and links the new record
   back to its source. [Doc]
   | Warehouse action | REST call |
   |---|---|
   | Receive a PO | `POST /record/v1/purchaseOrder/{id}/!transform/itemReceipt` |
   | Ship a transfer order (source side) | `POST /record/v1/transferOrder/{id}/!transform/itemFulfillment` |
   | Receive a transfer order (destination side) | `POST /record/v1/transferOrder/{id}/!transform/itemReceipt` |
   | Receive a customer return | `POST /record/v1/returnAuthorization/{id}/!transform/itemReceipt` |
   | Ship a sales order | `POST /record/v1/salesOrder/{id}/!transform/itemFulfillment` |
2. **You cannot *receive* an inbound shipment through REST.** The `inboundShipment` REST record
   supports create, read, update and delete, but not transform. [Doc] Receiving uses the separate
   SuiteScript record **`receiveinboundshipment`**, which Oracle documents only for SuiteScript.
   [Doc] So inbound-shipment receiving needs one of two approaches:
   - **(a) a small RESTlet** deployed in NetSuite that loads `receiveinboundshipment`, sets
     `quantitytobereceived` and inventory detail per line, then saves. This is recommended: it
     keeps the inbound shipment's own received quantities and status correct.
   - **(b) receive each underlying PO** with the PO → itemReceipt transform. This is simpler, but
     whether the receipt then updates the inbound shipment's received quantity is **[Verify]**. If
     it doesn't, the shipment would sit "In Transit" forever.
3. **Transfer-order receipts must match the fulfillment exactly**: same quantity, same lot and
   serial numbers, and dated no earlier than the shipment. [Doc] WW cannot "receive what arrived"
   freely. Short or over deliveries must be reconciled in NetSuite first, or received in full and
   then adjusted with `inventoryAdjustment`.
4. **NetSuite *locations* = WW *warehouses*; NetSuite *bins* = WW *locations*.** Oracle explicitly
   warns against modelling bins, shelves or docks as NetSuite locations. [Doc] The existing
   Location Mapping (warehouse → NetSuite location internal id) is correct. A second map is needed
   for **WW location → NetSuite bin**, but only if the NetSuite location has **Use Bins** turned on.
5. **Lot, serial, bin and inventory-status data travels in the `inventoryDetail` subrecord** on
   every line. This covers receipts, fulfillments, transfers and adjustments. [Doc] The current
   outbound adjustment omits it, so the first live post will fail for any lot-tracked, serialized
   or bin-managed item (already noted in `docs/agent/INTEGRATIONS.md`).
6. **The screenshot is NetSuite WMS (the SuiteApp mobile menu).** That means this account likely
   has **NetSuite WMS** installed, with its system rules, waves, pick tasks and putaway strategies.
   [Verify] WW is replacing that mobile front end, so the NetSuite WMS rules decide whether
   receipts post automatically or wait for "Post Item Receipt". They also decide whether outbound
   orders must be released in waves. See §7.4. The custom tile `NSWMS_POReceiving_1` is an
   account-specific customization. Ask what it does before replacing it.
7. **NetSuite has no push webhooks for REST.** WW learns about new or changed POs, TOs, RMAs and
   SOs in one of two ways:
   - a **User Event SuiteScript** posts to `netsuite-webhook` (the receiver already exists and
     parks these record types in the queue), or
   - WW **polls SuiteQL** on `lastmodifieddate`.

   Polling needs nothing deployed in NetSuite and is the lower-risk starting point.

---

## 1. Where the adapter is today

From `docs/agent/INTEGRATIONS.md` and `supabase/functions/*netsuite*`:

| Direction | Record | State |
|---|---|---|
| Inbound | `item` | Processed → `products` + `external_record_links` |
| Inbound | `purchase_order`, `sales_order`, `transfer_order`, `fulfillment`, `inventory` | Accepted by `netsuite-webhook`, logged, **parked `queued`** — no processor |
| Inbound | invoice, item receipt, RMA, inbound shipment | Rejected (not in `SUPPORTED_RECORD_TYPES`) |
| Outbound | `inventoryAdjustment` | Built and queued on putaway, but never accepted live (no token yet) |
| Both | Auth | OAuth 2.0 M2M, ES256 client assertion. Certificate generated; **not yet uploaded in NetSuite** |

Useful building blocks that already exist:

- the `integration_sync_jobs` job spine with atomic claim and job-type filtering
- idempotency through the record `externalId` plus an `eid:` lookup, which is reusable for every
  transform below
- a SuiteQL runner in `netsuite-connection`
- `external_record_links`

---

## 2. Account features that change the behaviour (discover these first)

NetSuite's record shapes and statuses change depending on which features are enabled. Every one of
these needs an answer before building. §11 shows how to detect each one.

| Feature / preference | Why it matters to WW |
|---|---|
| **Multi-Location Inventory** + Locations | Needed for item receipt, transfer order and bins per location [Doc] |
| **Advanced Receiving** | ON: receiving and billing are separate steps, and the PO/RMA statuses gain "Pending Bill" and "Pending Refund" states. OFF: receipt and bill are coupled [Doc] |
| **Advanced Shipping** | ON: fulfillment is independent of invoicing. OFF: creating an item fulfillment also creates the invoice [Doc]. Getting this wrong means WW would bill customers |
| **Pick, Pack and Ship** | Fulfillments carry `shipStatus` Picked → Packed → Shipped. On-hand only drops at Shipped [Doc] |
| **Bin Management** / **Advanced Bin / Numbered Inventory Mgmt** | Whether bins exist, and whether any item may go in any bin (Advanced) or only item-associated bins (Basic) [Doc] |
| **Use Bins** (per location) | Only locations with this flag need bin numbers on lines [Doc] |
| **Inventory Status** | Requires Advanced Bin. Every inventory line carries a status such as Good or Damaged [Doc] |
| **Lot Numbered / Serialized Inventory** | Lines need `inventoryAssignment` with lot or serial numbers |
| **Inbound Shipment Management** | Enables `inboundShipment`. **Inventory Detail on Inbound Shipment** (switched on by NetSuite Support) is needed for lot, serial, bin or status items on shipments [Doc] |
| **Return Authorizations**, **Vendor Return Authorizations** | Enable the RMA and VRMA records [Doc] |
| **Fulfillment Request** | An optional step between SO and fulfillment [Doc] |
| **Landed Cost** / "Landed Cost Allocation per Line" | Whether receipts carry duty and freight allocation [Doc] |
| **Allow Overage on Item Receipts** (Accounting Prefs → Order Mgmt) | Whether a receipt may exceed the PO quantity remaining [Doc] |
| **Use Item Cost as Transfer Cost** (per TO, defaults from prefs) | When ON, each fulfillment must be received separately [Doc] |
| **Default Transfer Order Incoterms** / In-Transit Ownership | Decides who owns stock in transit [Doc] |
| **NetSuite WMS SuiteApp** + its system rules | "Manually post item receipts?", "Stage received items before putting away?", "Enable Receive All", "Enable Restock option for returns" [Doc] |
| **OneWorld** | Subsidiary on every transaction; intercompany transfer orders |
| **SuiteTax** | REST does not support legacy tax fields. This matters only if WW ever creates priced records [Doc] |

---

## 3. Purchase orders and importation of goods

### 3.1 Purchase order record

- REST id `purchaseOrder`, fully supported. [Doc]
- Header fields WW needs:
  - `tranId` (document number)
  - `entity` (vendor)
  - `subsidiary`
  - `location` (receiving location)
  - `dueDate` / expected receipt date
  - `status`
  - `currency`
  - `memo`
  - `incoterm` (if used)
  - `lastModifiedDate`
- Line fields (`item.items[]`):
  - `line` — the order line number used by transforms
  - `lineUniqueKey` / `lineuniquekey` — needed by inbound shipments
  - `item`
  - `quantity`
  - `quantityReceived`
  - `quantityBilled`
  - `location` (per-line location can override the header)
  - `units`
  - `expectedReceiptDate`
  - `isClosed`
  - `inventoryDetail`, when the vendor pre-advises lots

  Exact field casing is **[Verify]** through the account's metadata catalog (§11).

**Statuses** [Doc]. Display names come from Oracle. Letter codes are [Practice]; confirm them with
§11 query Q6.

| Code | Advanced Receiving ON | Receivable? |
|---|---|---|
| `PurchOrd:A` | Pending Supervisor Approval | no |
| `PurchOrd:C` | Rejected by Supervisor | no |
| `PurchOrd:B` | Pending Receipt | **yes** |
| `PurchOrd:D` | Partially Received | **yes** |
| `PurchOrd:E` | Pending Billing/Partially Received | **yes** |
| `PurchOrd:F` | Pending Bill (fully received) | no (unless overage allowed) |
| `PurchOrd:G` | Fully Billed | no |
| `PurchOrd:H` | Closed | no |

With Advanced Receiving OFF, the list shrinks to Pending Approval, Rejected, Pending Receipt,
Partially Received, Received and Closed. [Doc]

### 3.2 Receiving a PO → Item Receipt

```
POST /services/rest/record/v1/purchaseOrder/{poId}/!transform/itemReceipt
{
  "externalId": "ww-receipt-<receipt id>",
  "tranDate": "2026-09-22",
  "memo": "WW receipt RCV-0001",
  "item": {
    "items": [
      {
        "orderLine": 1,               // PO line to receive
        "itemReceive": true,          // false = leave this line unreceived
        "quantity": 4,
        "location": { "id": "6" },
        "inventoryDetail": {
          "inventoryAssignment": {
            "items": [
              { "receiptInventoryNumber": "LOT-A1",   // lot/serial being CREATED
                "binNumber": { "id": "20" },
                "inventoryStatus": { "id": "1" },
                "expirationDate": "2027-09-01",
                "quantity": 4 }
            ]
          }
        }
      }
    ]
  }
}
```

- Oracle's own item receipt example uses `line` plus `inventorydetail.inventoryassignment` with
  `receiptInventoryNumber`, `inventorystatus`, `binnumber` and `quantity`. [Doc] The SO-fulfillment
  example uses `orderLine`, plus `itemreceive: false` to leave a line out. [Doc] Line
  identification on item receipt transforms needs a **[Verify]** against a real PO. Test both
  `orderLine` and `line`, and always GET `/purchaseOrder/{id}/item` first. Line numbers are **not
  sequential** (1, 4, 7…). [Doc]
- **Lines not listed** in the transform body keep the defaults NetSuite copies from the PO, which
  normally means "receive the full remaining quantity". Always send every open line, and send
  `itemReceive: false` for lines not being received. [Practice]
- **Partial receipts** are normal. Each one creates its own item receipt, and the PO moves to
  Partially Received. [Doc]
- **Over-receipt** is rejected unless *Allow Overage on Item Receipts* is on. [Doc]
- **Lot/serial:** use `receiptInventoryNumber` on receipts (it creates the number). Outbound
  transactions reference an existing `inventoryNumber` by id. `expirationDate` goes on the
  assignment line for lot items. [Practice]
- **Bins:** send `binNumber` only when the location has Use Bins. With Basic Bin Management, the bin
  must already be associated with the item. [Doc]
- **Inventory status:** required per assignment line when Inventory Status is on. [Doc]
- **Idempotency:** reuse the existing pattern. Set `externalId`, and on timeout GET
  `itemReceipt/eid:<externalId>`. [Practice, same mechanism as `inventoryAdjustment`]
- The created receipt's id comes back in the `Location` response header with status `204`. [Doc]

### 3.3 Importation: Inbound Shipment Management (ISM)

The "Inbound Shipment" tile covers containers and imports that group lines from **many POs,
possibly from many vendors and currencies**. [Doc]

**Record** `inboundShipment` (REST supports create, read, update, delete and search. It cannot be
copied or transformed). [Doc]

| Area | Fields |
|---|---|
| Header | `shipmentNumber`, `externalDocumentNumber` (carrier or supplier reference), `shipmentStatus`, `expectedShippingDate`, `actualShippingDate`, `expectedDeliveryDate`, `actualDeliveryDate`, `shipmentMemo`, vessel number/IMO, bill of lading number [Doc] |
| `items` sublist | `purchaseOrder`, `shipmentItem` (**= the PO line's `lineuniquekey`, not the item id**), `receivingLocation`, `quantityExpected`, `expectedRate`, plus received and billed quantities and related transactions [Doc] |
| Landed Cost subtab | cost category, amount, currency, effective date, allocation method (quantity, value or weight). Can only be created while the shipment is in edit mode [Doc] |
| Limits | 500 lines per shipment. POs from Centralized Purchasing can't be added. Assembly items and item groups are not supported for inventory detail [Doc] |

**Status flow** [Doc]:

```
To Be Shipped ──(actual ship date)──► In Transit ──► Partially Received ──► Received ──► Closed
                                       │
                                       ├─ Take Ownership (bulkownershiptransfer) — GL "External Inventory In Transit"
                                       └─ Bill (needs "Bill in Advance of Receipt")
```

Only **In Transit** and **Partially Received** shipments can be received. [Doc] WW should list
only those.

**Receiving** [Doc]:

- In the UI, Receive → choose the posting period → tick lines → receiving location → inventory
  detail (lot, serial, bin, status) → Submit. NetSuite then bulk-creates **one item receipt per PO**
  as a background process (Process Status page).
- In SuiteScript, use the `receiveinboundshipment` record loaded by the shipment id. Its sublist
  `receiveitems` has `quantitytobereceived`. Oracle's example is SuiteScript 1.0:
  ```js
  var r = nlapiLoadRecord('receiveinboundshipment', inboundShipmentId);
  r.selectLineItem('receiveitems', 2);
  r.setCurrentLineItemValue('receiveitems', 'quantitytobereceived', 1);
  r.commitLineItem('receiveitems');
  nlapiSubmitRecord(r);
  ```
  The 2.x equivalent is `record.load({ type: 'receiveinboundshipment', id, isDynamic: true })`.
  **Recommended RESTlet contract:**
  `POST { inboundShipmentId, lines:[{ shipmentLineKey, qty, location, inventoryAssignment[] }], externalRef }`
  → `{ itemReceiptIds[] }`.
- The total inventory detail quantity cannot exceed the expected quantity. Identical items from
  different POs must be received as separate lines. [Doc]

**What WW needs to store per inbound shipment:**

- the shipment id and number
- the carrier/external document number (a scannable reference on the container paperwork)
- expected delivery date, which feeds `dock_appointments`
- per line: the PO id, the PO `lineuniquekey`, item, expected quantity and receiving location

### 3.4 Landed cost (duty, freight, insurance)

- Landed cost is recorded on the **item receipt** (or the bill when Advanced Receiving is off)
  through a cost allocation method (Weight, Quantity or Value) and one amount per landed cost
  category, each with a source of This Transaction, Other Transaction, or Other Transaction
  excluding tax. [Doc]
- Only items with **Track Landed Cost** get an allocation. **Weight** allocation needs item weights,
  otherwise NetSuite raises an error. [Doc]
- With Advanced Receiving, allocation must happen on the receipt, not the bill. [Doc]
- ISM lets landed cost live on the inbound shipment and allocate across its receipts. [Doc]
- **Recommendation:** WW should **not** own landed cost. Finance enters it on the shipment or
  receipt in NetSuite. WW only has to avoid clearing it. It never sends landed cost fields, and it
  never PATCHes receipts after creating them. The WW receipt's measured weights could feed
  weight-based allocation later.

### 3.5 In-transit ownership and incoterms

- **DAP**: the source owns the goods until receipt. **EXW**: the destination owns them from
  shipment, and the GL moves to an in-transit account. [Doc]
- For ISM, "Take Ownership" (`bulkownershiptransfer`) posts to *External Inventory In Transit*
  before receipt. [Doc]
- This is financial. WW does not need to act on it. It only needs to show the incoterm and the
  "owned but not received" state on the dashboard.

### 3.6 NetSuite WMS receiving rules WW is replacing

- **"Manually post item receipts?"** — when ON, NetSuite WMS records received and put-away tasks
  on the NS WMS subtab without posting a receipt. A supervisor later runs *Post Item Receipt*
  (the tile in the screenshot), which posts **one receipt covering everything received since the
  last post**. [Doc]
- **"Stage received items before putting away?"** — receipt goes into a staging bin, and putaway
  is a separate bin transfer. [Doc]
- WW equivalent: receive into a staging `location`, then putaway. That maps to *either*:
  - receipt into the staging bin plus a `binTransfer` at putaway, or
  - posting the receipt only at putaway, directly into the final bin. This matches WW's existing
    "post on `receiving → available`" trigger.

  **Decision needed** (§12).

---

## 4. Transfer orders

**Record** `transferOrder`. It needs the Locations and Multi-Location Inventory features. [Doc]

| Area | Fields |
|---|---|
| Header | `location` (source), `transferLocation` (destination), `subsidiary`, `orderStatus`, `incoTerm`, `useItemCostAsTransferCost`, `firmed`, `shipDate`, `memo` [Doc for location, transferLocation, incoTerm, orderStatus] |
| Lines | `line`, `item`, `quantity`, `quantityFulfilled`, `quantityReceived`, `rate` (transfer price), `isClosed`, `inventoryDetail` [Doc sample] |

**Statuses** [Doc names; codes Practice]:

| Code | Status | What it means |
|---|---|---|
| `TrnfrOrd:A` | Pending Approval | Nothing committed yet |
| `TrnfrOrd:C` | Rejected | Not approved and cancelled |
| `TrnfrOrd:B` | Pending Fulfillment | Approved and committed. **Ship side can act** |
| `TrnfrOrd:D` | Partially Fulfilled | Ship side can act |
| `TrnfrOrd:E` | Pending Receipt/Partially Fulfilled | Both sides can act |
| `TrnfrOrd:F` | Pending Receipt | In transit. **Receive side can act** |
| `TrnfrOrd:G` | Received | Complete |
| `TrnfrOrd:H` | Closed | Closed |

**Two-step process** [Doc]:

1. **Ship at the source warehouse:**
   `POST /transferOrder/{id}/!transform/itemFulfillment` with lines, quantities, and the source
   bin/lot/serial in `inventoryDetail`. The value moves from Inventory Asset to Inventory In
   Transit. The on-hand quantity is still counted at the source until received. [Doc]
2. **Receive at the destination:**
   `POST /transferOrder/{id}/!transform/itemReceipt` with destination bins and statuses.

Rules [Doc]:

- The receipt quantity **must equal** the fulfillment quantity. It can't exceed the TO quantity or
  be dated before the ship date. Lot/serial numbers and quantities **cannot change** on receipt.
- When several fulfillments exist, each receipt must reference **its** fulfillment. In the UI you
  pick the fulfillment from a list. Through the API, the transform returns or accepts an
  `itemFulfillment` reference. Confirm how REST takes it (**[Verify]**). If REST cannot choose the
  fulfillment, wrap the call in a RESTlet: `record.transform` with
  `defaultValues: { itemfulfillment: <id> }` [Practice].
- With *Use Item Cost as Transfer Cost*, separate fulfillments must be received separately. [Doc]
- Intercompany transfer orders (OneWorld) are a separate record type, with receipt at the
  destination subsidiary. [Doc]

**WW impact:**

- The "Receive Transfer Order" screen should **pre-fill from the fulfillment**, not from the TO.
  Expected lots and serials come from that fulfillment's inventory detail.
- Discrepancies (short, damaged) cannot be expressed on the receipt. Receive in full, then post an
  `inventoryAdjustment`, or an inventory status change to "Damaged".
- WW's `transfers` table (inter-warehouse, with dispatch sign-off) is the natural home. It needs a
  NetSuite TO id, per-line `line` numbers, and the fulfillment id(s) once shipped.

---

## 5. Returns

### 5.1 Customer returns (RMA)

**Record** `returnAuthorization`. It is non-posting, needs the Return Authorizations feature, and
can be created from a sales order, invoice or cash sale. [Doc]

**Statuses with Advanced Receiving ON** [Doc names; codes Practice]:

| Code | Status | What it means |
|---|---|---|
| `RtnAuth:A` | Pending Approval | |
| `RtnAuth:B` | Pending Receipt | **WW can receive** |
| `RtnAuth:D` | Partially Received | **WW can receive** |
| `RtnAuth:E` | Pending Refund/Partially Received | **WW can receive** |
| `RtnAuth:F` | Pending Refund | Fully received; finance credits |
| `RtnAuth:G` | Refunded | |
| `RtnAuth:C` | Cancelled | |
| `RtnAuth:H` | Closed | |

With Advanced Receiving **OFF**, there is no separate receipt. Receipt and refund happen together
on the credit memo or cash refund. [Doc] In that case WW could not post a receipt on its own. That
makes this a hard prerequisite to check.

**Receiving** [Doc]:
`POST /returnAuthorization/{id}/!transform/itemReceipt` (item receipt lists RMA as a supported
source).

- Each line needs a **location** (required with Multi-Location Inventory). [Doc]
- Each line has a **Restock** flag. [Doc]
  - Restock ✓: quantity and value go back into inventory.
  - Restock ✗: the item is written off to expense and never enters stock.

  The REST field id is probably `restock` (**[Verify]**).
- The NetSuite WMS rule "Enable Restock option for returns" lets the operator choose Yes/No on
  mobile. [Doc]
- With Inventory Status on, returned goods can be received straight into a non-available status
  (e.g. "Quarantine"/"Damaged") instead of written off. That is usually the better fit for WW's
  `quality_inspections` flow. [Doc + recommendation]
- The credit memo or refund (`creditMemo` / `cashRefund` transforms off the RMA) is **finance's
  step, not WW's**. [Doc]

**WW mapping:** `return_authorizations` exists but has **no lines**, no source order and no NetSuite
id. It needs `return_authorization_lines` (NetSuite line, item, expected quantity, received
quantity, restock/disposition, lot/serial) and a NetSuite RMA id link. `quality_disposition` maps
to restock (true/false) and/or the target inventory status.

### 5.2 Vendor returns (RTV)

**Record** `vendorReturnAuthorization` (VRMA). Workflow: create → approve → **ship
(itemFulfillment)** → vendor credit. [Doc]

- WW's part is picking and shipping it back:
  `POST /vendorReturnAuthorization/{id}/!transform/itemFulfillment`, whose lines consume stock from
  bins and lots.
- REST availability of the VRMA and its transform is **[Verify]**. It did not appear in the
  REST supported-records summary retrieved for this research.
- NetSuite WMS stages vendor-return picks through outbound staging bins, the same as sales orders.
  [Doc]

---

## 6. Storage and locations

### 6.1 The mapping

| NetSuite | WW | Notes |
|---|---|---|
| **Subsidiary** | (none) | OneWorld only. Each location belongs to one subsidiary [Doc] |
| **Location** (`location`) | `warehouses` | Already mapped via Settings → NetSuite Location Mapping. Supports hierarchy (`parent`) [Doc] |
| **WMS Zone** (NetSuite WMS) | `zones` | Used in NetSuite WMS putaway and pick strategies. About 1 zone per 4,000 bins recommended [Doc] |
| **Bin** (`bin`) | `locations` | Fields: `binNumber` (unique, required), `location` (can't change after save), `memo`, `isInactive` [Doc]. NetSuite WMS adds zone, bin type and sequence [Doc, field ids Verify] |
| **Bin type** (NetSuite WMS) | `location_type` / `zones.is_staging` | Inbound Staging, Outbound Staging, Storage, Picking, WIP [Doc] |
| **Inventory Number** (`inventoryNumber`) | `inventory_lots` | Lot or serial number per item, with expiration date |
| **Inventory Status** (`inventoryStatus`) | `inventory_balances.status` + held/damaged quantities | Each status has a *Make Inventory Available* flag [Doc] |
| (no equivalent) | `pallets` / LPN | NetSuite core has no pallet or LPN concept. Pallets stay WW-internal |

Key location flags [Doc]:

- `locationType` — Store, Warehouse or Undefined
- `makeInventoryAvailable` — whether stock here can be committed to orders
- `useBins`
- `isInactive`
- `subsidiary`
- time zone
- address, used on packing and ship documents

**Do not** create a NetSuite location for a WW zone or dock. Oracle warns it breaks fulfillment,
FIFO/LIFO costing and reporting. [Doc]

### 6.2 Bin management modes [Doc]

| | Basic Bin Management | Advanced Bin / Numbered Inventory Mgmt |
|---|---|---|
| Item ↔ bin association | **Required** before use | Optional. Any bin for any item |
| Lot/serial in bins | Not supported | Supported |
| Per-location on/off | No | Yes (`Use Bins` on the location) |
| Inventory Status | Not available | Available |
| Preferred bin | Per item per location | Per item per location. Used first if it has enough quantity |

Take the transaction lines from the NetSuite bin-enabled location. In Advanced mode, every
inventory line at a Use Bins location needs a `binNumber` in `inventoryAssignment`, even for
untracked items. That includes receipt, fulfillment, adjustment and transfer lines. [Doc/Practice]

### 6.3 Inventory movement records WW will post

| WW action | NetSuite record (REST id) | Notes |
|---|---|---|
| Putaway / bin-to-bin move, same location | **Bin Transfer** (`binTransfer`) | Needed only when the receipt went to a staging bin and NetSuite must know the final bin [Doc: supported in REST] |
| Warehouse-to-warehouse move with no approval or transit | **Inventory Transfer** (`inventoryTransfer`) | One-step, immediate. Use a transfer order when in-transit tracking is needed [Doc] |
| Quarantine, damage, release | **Inventory Status Change** (`inventoryStatusChange`) | Fields: `location`, `previousStatus`, `revisedStatus`, plus an inventory sublist [Doc]. REST availability **[Verify]** |
| Count variance, write-off | **Inventory Adjustment** (`inventoryAdjustment`) | Already built. Needs `inventoryDetail` for bins, lots and statuses |
| Cycle count | **Inventory Count** (`inventoryCount`) | Supported in REST [Doc]. Alternative to adjustments for counts |
| Initial load | **Bin Putaway Worksheet** (`binWorksheet`) | Supported in REST [Doc] |

### 6.4 Reconciling on-hand

- The item record shows quantities per bin and per inventory number, to 5 decimal places.
  Transactions carry 8 decimal places. For exact figures, Oracle points to the **Inventory Balance**
  search. [Doc]
- In SuiteQL, the equivalent is the `InventoryBalance` table: item, location, binnumber,
  inventorynumber, inventorystatus, quantityonhand, quantityavailable. Table and column names are
  **[Verify]** in the Records Catalog. A nightly SuiteQL snapshot compared with
  `inventory_balances` gives a drift report.

---

## 7. Sales order process

### 7.1 Sales order record

REST id `salesOrder`. [Doc]

- WW needs:
  - `tranId`, `entity` (customer), `location`, `shipDate`
  - `shipMethod`, `shipAddress` / `shippingAddress` subrecord
  - `status`, `orderStatus`, `memo`, `otherRefNum` (customer PO)
- Line fields:
  - `line`, `item`, `quantity`
  - `quantityCommitted`, `quantityFulfilled`, `quantityBackOrdered`
  - `location`, `isClosed`
  - `commitInventory`, `createPo` (drop-ship or special order lines, which WW must **skip**)
  - `inventoryDetail` (when a specific lot has been committed)

**Statuses with Advanced Shipping** [Doc names; codes Practice]. All statuses are system-set and
cannot be edited. [Doc]

| Code | Status | WW can pick? |
|---|---|---|
| `SalesOrd:A` | Pending Approval | no |
| `SalesOrd:B` | Pending Fulfillment | **yes** |
| `SalesOrd:D` | Partially Fulfilled | **yes** |
| `SalesOrd:E` | Pending Billing/Partially Fulfilled | **yes** |
| `SalesOrd:F` | Pending Billing | no (fully shipped) |
| `SalesOrd:G` | Billed | no |
| `SalesOrd:C` | Cancelled (terminal) | no |
| `SalesOrd:H` | Closed | no |

Only **approved** orders in Pending Fulfillment or Partially Fulfilled can be released to the
warehouse. [Doc] **Commitment matters:** lines with `quantityCommitted` < `quantity` are
backordered. WW should only pick committed quantity, unless the business wants WW to allocate.

### 7.2 Fulfilling → Item Fulfillment

```
POST /services/rest/record/v1/salesOrder/{soId}/!transform/itemFulfillment
{
  "externalId": "ww-fulfillment-<pick list id>",
  "shipStatus": { "id": "C" },            // A Picked · B Packed · C Shipped (Pick-Pack-Ship on)
  "item": { "items": [
    { "orderLine": 1, "location": 6, "itemReceive": true, "quantity": 3,
      "inventoryDetail": { "inventoryAssignment": { "items": [
        { "issueInventoryNumber": { "id": "<inventoryNumber id>" },   // existing lot/serial
          "binNumber": { "id": "20" }, "inventoryStatus": { "id": "1" }, "quantity": 3 } ] } } },
    { "orderLine": 4, "location": 6, "itemReceive": false }
  ] }
}
```

- The request shape (`orderLine`, `location`, `quantity`, `itemreceive: false`) is Oracle's
  example. [Doc] Line numbers are not sequential, so GET `/salesOrder/{id}/item` first. [Doc]
- Oracle also notes that the transform needs an **inventory location** in the body. [Doc]
- `issueInventoryNumber` and the `shipStatus` letter codes are [Practice]. Status names come from
  [Doc].
- **Pick, Pack and Ship** [Doc]:
  - Picked, Packed and Shipped are statuses of the *fulfillment*.
  - Picking reduces *available* quantity. Only **Shipped** reduces *on-hand* and posts COGS.
  - Fulfillments can be picked in one period and shipped in another.
  - The feature cannot be switched off while any fulfillment is Picked or Packed.
- **Without Advanced Shipping**, saving the fulfillment **also creates the invoice**. [Doc] WW must
  know which mode the account uses before sending a single fulfillment.
- Packages sublist (tracking numbers, weights) and carrier fields go on the fulfillment when
  status is Packed or Shipped. [Doc]
- Recommended WW flow:
  1. Create the fulfillment at **Picked** when the pick list completes. This reserves the stock in
     NetSuite and stops double-picking.
  2. PATCH it to **Packed** at pack.
  3. PATCH it to **Shipped** when the `staging_loads` load departs.

  Alternatively, create it once at Shipped, which is simpler but gives NetSuite no visibility
  until then.

### 7.3 Optional: Fulfillment Request

- Enabled by the Fulfillment Request feature.
- Created by transforming a sales order into `fulfillmentRequest`.
- Carries its own status (`tranStatus`) and exceptions (e.g. short-pick reasons).
- Used for store pickup and distributed order management.

[Doc] If this account uses it, WW should work from fulfillment requests rather than raw SOs.
**[Verify]**

### 7.4 Conflict with NetSuite WMS outbound

- NetSuite WMS releases orders in **waves** (`wave` transaction) and creates **pick tasks**
  (`picktask`). The item fulfillment is created automatically when picking completes (per order,
  per line or per wave). [Doc]
- If WW takes over picking at a NetSuite WMS location, **pick one owner per location**. Either
  switch off NetSuite WMS processing there, or have WW create fulfillments directly and never
  release waves. Otherwise the same order can be picked twice.
- Whether a direct REST fulfillment is allowed on a NetSuite WMS-enabled location is **[Verify]**.
- Vendor returns and transfer-order shipping follow the same outbound path in NetSuite WMS. [Doc]

---

## 8. Integration mechanics

### 8.1 Reading work from NetSuite (inbound)

| Option | How | Pros / cons |
|---|---|---|
| **SuiteQL polling** (recommended first) | Every 1–5 min, query `transaction` where type is in the set and `lastmodifieddate > :cursor`, then GET the records that changed | No NetSuite deployment. Uses the existing token and queue. Latency equals the poll interval |
| **User Event → webhook** | An `afterSubmit` SuiteScript on PO, TO, RMA, SO and inbound shipment POSTs to `netsuite-webhook` with `X-Webhook-Secret` | Near real time. Needs a SuiteScript deployment and a secret in NetSuite. The webhook already parks these types |
| **Saved search / RESTlet pull** | A RESTlet returns open work per location | Suits complex joins. Needs deployment |

SuiteQL through REST [Doc]:

- `POST /services/rest/query/v1/suiteql`
- header `Prefer: transient`
- bound `?` parameters
- `limit`/`offset` paging
- **at most 100,000 results per query**
- response fields `count`, `offset`, `totalResults`, `items`, `links`

### 8.2 Writing to NetSuite (outbound)

- Every write is a transform or a create. Reuse the existing `externalId` idempotency plus the
  `eid:` recovery for every new job type:
  - `item_receipt_po`
  - `item_receipt_to`
  - `item_receipt_rma`
  - `item_fulfillment_so`
  - `item_fulfillment_to`
  - `bin_transfer`
  - `inventory_status_change`
  - `inbound_shipment_receive` (RESTlet)
- **Order matters.** A TO receipt can't precede its fulfillment, and a putaway bin transfer can't
  precede its receipt. The queue needs a per-document dependency, or processing must be
  serialized per source document.
- **Concurrency:** REST, SOAP and RESTlet calls share one account-wide concurrency pool, sized by
  service tier plus 10 per SuiteCloud Plus licence. You can see it under Setup → Integration →
  Integration Management → Integration Governance. [Doc] Keep the worker's parallelism low, and
  retry `429`s with backoff.
- **Posting period:** receipts and fulfillments post to the period of `tranDate`. When the period
  is closed or locked, the write fails. Surface that as a clear dead letter rather than retrying.
  [Practice]
- **Role permissions** for the M2M role: create/edit on Item Receipt, Item Fulfillment,
  Bin Transfer, Inventory Status Change and Inventory Adjustment. View on Purchase Order, Transfer
  Order, Return Authorization, Sales Order, Inbound Shipment, Locations, Bins and Inventory Status.
  Plus REST Web Services and SuiteAnalytics Workbook (for SuiteQL).

### 8.3 Line identity (important for the schema)

Every NetSuite write-back references the **source line**, not the item:

- item receipt / fulfillment → `orderLine` / `line`
- inbound shipment → the PO `lineuniquekey`

WW's `receipt_lines`, `order_lines` and `transfer_lines` currently have **no column** for this.
Without one, a PO with the same item on two lines (e.g. two prices or two delivery dates) cannot be
received correctly. Store `external_line_id` (line number) and `external_line_key` (lineuniquekey)
on every line that came from NetSuite.

---

## 9. Status and type codes (for SuiteQL filters)

`transaction.type` [Practice]:

| Code | Record |
|---|---|
| `PurchOrd` | Purchase order |
| `ItemRcpt` | Item receipt |
| `TrnfrOrd` | Transfer order |
| `ItemShip` | Item fulfillment |
| `RtnAuth` | Return authorization |
| `VendAuth` | Vendor return authorization |
| `SalesOrd` | Sales order |
| `InvAdjst` | Inventory adjustment |
| `InvTrnfr` | Inventory transfer |
| `BinTrnfr` | Bin transfer |

`transaction.status` values have the form `<type>:<letter>`. See §3.1, §4, §5.1 and §7.1.
Item fulfillment `shipStatus`: A Picked, B Packed, C Shipped. **Confirm every code with query Q6 in
§11 before hard-coding any of them.**

---

## 10. Mapping to the WW schema, and gaps

| Need | Existing WW table | Gap |
|---|---|---|
| PO / inbound shipment / TO / RMA as receivable documents | `receipts` (`receipt_type` po, transfer, return, manual, other) + `receipt_lines` | No `inbound_shipment` type. No NetSuite document id or line key. No expected lot/serial. `receipt_lines` has no location or bin |
| Receipt → NetSuite item receipt | `integration_sync_jobs` | New job types, plus per-document ordering |
| Staging vs final bin | `zones.is_staging`, `putaway_tasks` | Decide the posting moment (§3.6) |
| NetSuite bin ↔ WW location | `external_record_links` (generic) | Map rows with `local_table='locations'`, `external_record_type='bin'`. Only needed for Use Bins locations |
| Inventory status | `inventory_status` enum + held/damaged quantities | Map WW states to NetSuite inventory status ids in Settings |
| Lots / serials | `inventory_lots` | Link to NetSuite `inventoryNumber` ids for outbound issue lines. No serial-number table |
| RMA lines | `return_authorizations` (header only) | Add lines, source SO/invoice, restock/disposition per line |
| Transfer orders | `transfers`, `transfer_lines` | NetSuite TO id, line numbers, fulfillment id(s) |
| Sales orders → fulfillment | `orders`, `order_lines`, `pick_lists`, `pick_tasks`, `staging_loads` | NetSuite SO id, line numbers, committed quantity, ship method/address, fulfillment id + ship status |
| Vendor returns | none | New outbound order type (`orders.order_type` = 'vendor_return'?) |

---

## 11. Live discovery pack (read-only)

Run through `netsuite-connection`'s SuiteQL runner, or the live test harness, once Test connection
passes. All of these are reads.

**Q0 — which records the account exposes** (shows ISM, returns, VRMA, fulfillment request,
inventory status change, and so on):

```
GET /services/rest/record/v1/metadata-catalog/
GET /services/rest/record/v1/metadata-catalog/itemreceipt      (Accept: application/swagger+json)
GET /services/rest/record/v1/metadata-catalog/inboundshipment
GET /services/rest/record/v1/metadata-catalog/returnauthorization
GET /services/rest/record/v1/metadata-catalog/vendorreturnauthorization
```

The per-record swagger gives the exact field ids and casing flagged [Verify] above, e.g. `restock`,
`orderLine`, `issueInventoryNumber`, and `itemFulfillment` on the item receipt.

**Q1 — locations and bin usage:**

```sql
SELECT id, name, BUILTIN.DF(subsidiary) AS subsidiary, BUILTIN.DF(locationtype) AS type,
       usebins, makeinventoryavailable, isinactive, BUILTIN.DF(parent) AS parent
FROM location ORDER BY name
```

**Q2 — bins per location:**

```sql
SELECT BUILTIN.DF(location) AS location, COUNT(*) AS bins,
       SUM(CASE WHEN isinactive = 'T' THEN 1 ELSE 0 END) AS inactive
FROM bin GROUP BY BUILTIN.DF(location)
```

Follow up with `SELECT * FROM bin FETCH FIRST 5 ROWS ONLY` to see the NetSuite WMS columns (zone,
bin type, sequence).

**Q3 — inventory statuses:**

```sql
SELECT id, name, inventoryavailable, isinactive FROM inventorystatus
```

A table-not-found error means the Inventory Status feature is off.

**Q4 — item tracking mix** (shows whether lot, serial or bin handling is needed at all):

```sql
SELECT itemtype, islotitem, isserialitem, usebins, COUNT(*) AS n
FROM item WHERE isinactive = 'F' GROUP BY itemtype, islotitem, isserialitem, usebins
```

**Q5 — open work volume by document type** (sizes the polling and the UI):

```sql
SELECT type, BUILTIN.DF(status) AS status, status AS code, COUNT(*) AS n
FROM transaction
WHERE type IN ('PurchOrd','TrnfrOrd','RtnAuth','VendAuth','SalesOrd')
GROUP BY type, BUILTIN.DF(status), status ORDER BY type, code
```

**Q6 — confirms the status letter codes.** Run Q5, then also:

```sql
SELECT DISTINCT type, status, BUILTIN.DF(status) FROM transaction
WHERE type IN ('ItemShip','ItemRcpt')
```

**Q7 — inbound shipments in flight:**

```sql
SELECT id, shipmentnumber, externaldocumentnumber, BUILTIN.DF(shipmentstatus) AS status,
       expecteddeliverydate FROM inboundshipment ORDER BY expecteddeliverydate DESC
```

A table-not-found error means Inbound Shipment Management is off.

**Q8 — a real PO's lines, for the transform line-id test:**

```sql
SELECT t.tranid, tl.linesequencenumber, tl.uniquekey, BUILTIN.DF(tl.item) AS item,
       tl.quantity, tl.quantityshiprecv, BUILTIN.DF(tl.location) AS location, tl.isclosed
FROM transaction t JOIN transactionline tl ON tl.transaction = t.id
WHERE t.tranid = ? AND tl.mainline = 'F' AND tl.taxline = 'F'
```

**Q9 — NetSuite WMS footprint:**

```sql
SELECT COUNT(*) FROM wave
```

and

```sql
SELECT COUNT(*) FROM picktask
```

A table-not-found error means NetSuite WMS processing is not in use. Also check whether
`usewarehousemanagement` or a similar column exists on `location` [Verify].

**Q10 — on-hand by bin, for reconciliation design:**

```sql
SELECT BUILTIN.DF(item) item, BUILTIN.DF(location) loc, BUILTIN.DF(binnumber) bin,
       BUILTIN.DF(inventorynumber) lot, BUILTIN.DF(status) status, quantityonhand, quantityavailable
FROM inventorybalance FETCH FIRST 50 ROWS ONLY
```

Enabled features and preferences (Advanced Receiving, Advanced Shipping, Pick-Pack-Ship, Allow
Overage, NetSuite WMS system rules) cannot be read through SuiteQL. Get them from an admin, or from
a one-line RESTlet using `runtime.isFeatureInEffect`.

---

## 12. Decisions for the business before building

1. **Posting moment for receipts:** at dock receipt (into a staging bin, then a bin transfer at
   putaway), or at putaway (one receipt straight into the final bin)? The existing putaway trigger
   suggests the second.
2. **Inbound shipments:** deploy a small RESTlet for true shipment receiving (recommended), or
   receive the underlying POs only?
3. **Transfer-order discrepancies:** receive in full then adjust, or block until NetSuite fixes the
   fulfillment?
4. **Returns disposition:** restock ✗ (write-off), or receive into a "Damaged" or "Quarantine"
   inventory status for inspection?
5. **Outbound owner per location:** WW or NetSuite WMS waves. They can't both pick the same
   location.
6. **Fulfillment granularity:** create the fulfillment at Picked and update it through Packed and
   Shipped, or create it once at Shipped?
7. **Advanced Shipping ON?** If it's OFF, every WW fulfillment creates an invoice. Finance must sign
   off.
8. **What `NSWMS_POReceiving_1` does** — a custom receiving flow WW must reproduce or retire.
9. **Vendor returns (RTV):** in scope for WW picking now or later?
10. **Inbound trigger:** SuiteQL polling first, or deploy User Event scripts now?

---

## Sources (Oracle NetSuite Help Center)

- [REST Web Services Supported Records](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/chapter_1558962745.html)
- [Item Receipt (REST)](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_0817102411.html)
- [Item Fulfillment (REST)](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_161425629582.html)
- [Use Case For Fulfilling Your Sales Order](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_159795518068.html)
- [Transfer Order (REST)](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_0817021034.html)
- [Receiving Transfer Orders](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N2312912.html)
- [Transfer Order statuses / Fulfilling Transfer Orders](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N2312176.html)
- [In-Transit Ownership](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_4813066512.html)
- [Inbound Shipment (REST)](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/article_7165449964.html)
- [Inbound Shipment (SuiteScript record)](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_1490344833.html)
- [Inbound Shipment — Scripting, Customization, and Integration](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_1490822210.html)
- [Using Inbound Shipment Management](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_1490823161.html)
- [Receiving Inbound Shipment Orders (NetSuite WMS)](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_158212308061.html)
- [Manually Posting Item Receipts (NetSuite WMS)](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_155993562169.html)
- [Viewing the Status of a Purchase Order](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N2408514.html)
- [Entering Landed Cost on a Transaction](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N2418831.html)
- [Landed Cost Allocation per Line](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_3728979515.html)
- [Setting Tolerance Limits / Allow Overage](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N1388149.html)
- [Return Authorization (record)](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N3688557.html)
- [Receiving a Customer Return](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N1307628.html)
- [Customer Return Authorization Status](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N1310133.html)
- [Vendor Return Authorization (record)](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N3696445.html)
- [Creating Locations](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N263263.html)
- [Advanced Bin / Numbered Inventory Management](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N2271791.html)
- [Creating Bin Records](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N2274082.html)
- [Putaway Strategies (NetSuite WMS)](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_1541436052.html)
- [Tracking Inventory Balances By Status](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_1515699529.html)
- [Inventory Status Change](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_1515701680.html)
- [Viewing the Status of Sales Orders](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N1220604.html)
- [Fulfilling Orders Using Pick, Pack, and Ship](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N1230473.html)
- [Fulfillment Request (REST)](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/article_0403093259.html)
- [Fulfilling Released Orders (NetSuite WMS waves and pick tasks)](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_1541442945.html)
- [Executing SuiteQL Queries Through REST](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_157909186990.html)
- [Web Services and RESTlet Concurrency Governance](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_1500275531.html)
