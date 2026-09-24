# Warehouse Wizard × NetSuite — Integration Proposal

**A single-entry warehouse operation for Simplex Trading**

| | |
|---|---|
| **Document** | Scoping white paper and proposal |
| **Version** | 1.0 — for review |
| **Date** | 22 September 2026 |
| **Prepared by** | Russell Hunte, Classic IT (Warehouse Wizard) |
| **Basis** | Integration meeting of 21 September 2026 (Roget Williams, Wilson Reyes, Jan Roel, Russell Hunte), plus a documentation review of Oracle NetSuite's published help centre and an audit of the current Warehouse Wizard codebase |
| **Status** | Proposal. Nothing in this document has been built. Section 12 lists what must be answered before the estimates can be fixed |

---

## How to read this document

It is written for four readers. Each section is marked with who needs it. No programming knowledge is required anywhere in the main body; the one technical section is Appendix A and it is clearly signposted as optional.

| If you are… | Read these sections | Time |
|---|---|---|
| **Roget Williams (management / finance)** | 1, 2, 3, 7, 8, 10, 11, 12, 13 | ~20 min |
| **The CFO** | 1, 7, 8, 11, 13 | ~12 min |
| **Wilson Reyes (inventory systems analyst)** | 1, 2, 3, 4, 5, 6, 9, 12 | ~25 min |
| **Jan Roel (NetSuite developer)** | 1, 4, 5, 6, 10, 12, Appendix A | ~25 min |
| **Everyone** | Section 1 (Executive summary) and Section 12 (Open questions) | ~6 min |

Three labels are used throughout, and they mean exactly what they say:

- **Confirmed** — verified in Oracle's published NetSuite documentation, or observed directly in the Warehouse Wizard code, or demonstrated on screen during the meeting.
- **Expected** — standard NetSuite behaviour that is very likely true for Simplex, but has not yet been checked against *your* account's settings. Every one of these appears in Section 12 with an owner.
- **Unverified** — genuinely unknown. Treated as a risk and priced as a risk.

---

## 1. Executive summary

### 1.1 The problem

Today a delivery is received twice. Once into Warehouse Wizard by the warehouse team, and once into NetSuite by someone in the office. The same is true in reverse for outbound work. This is double handling, it is slow, and every duplicate entry is an opportunity for the two systems to disagree about what is actually in the building.

Roget put the objective plainly in the meeting: *"My aim is to try to eliminate duplicating processes… If there's a way that we could hit the two systems with one entry, that would be great."*

### 1.2 The decision reached

The meeting settled on the direction. Goods are received **once, in Warehouse Wizard, on the warehouse floor**, and Warehouse Wizard tells NetSuite what was received. NetSuite remains the system of record for stock, cost and financials. Warehouse Wizard becomes the hands-and-eyes of the warehouse feeding it.

Roget: *"The item receipt should really happen in Wizard and then NetSuite should read that this PO number was received and mark it as received in NetSuite."* Russell: *"I like that."* Wilson: *"Actually that was the ideal process for me."*

### 1.3 Is it possible?

**Yes — with one significant exception that must be resolved before work starts.**

Everything discussed can be built. Receiving against purchase orders and transfer orders uses standard, documented NetSuite integration points that require nothing to be installed in NetSuite. Sales order picking, returns and transfers likewise.

**The exception is inbound shipments** — the document Simplex uses for every imported container, and the one Wilson specifically asked for. NetSuite's standard integration can *read* an inbound shipment perfectly well, but it provides **no standard way to record a receipt against one**. Oracle documents that action only as something a script running inside NetSuite can do. This means a small piece of code must be written and deployed **inside NetSuite by Jan** — roughly two to four days of his time — before Warehouse Wizard can complete an inbound shipment receipt.

This is not a blocker. It is a known, bounded piece of work that simply has to be scheduled. But it was not identified during the meeting, and if it is not planned for, the single most important receiving path for Simplex would fail late in the project. It is the most important finding in this document. Full detail in Section 5.2.

### 1.4 What it costs

The full scope discussed is substantially larger than the original Warehouse Wizard engagement. Russell flagged this during the meeting: *"the scope is changing a bit… it's going to look like a serious rework of items which were originally discussed and then said it wasn't needed."*

The work divides into three phases that can be approved and funded independently.

| Phase | What it delivers | Estimated effort | Recommendation |
|---|---|---|---|
| **Phase 1 — Inbound** | One-entry receiving against purchase orders, inbound shipments and transfer orders. Pine and Lower Estate brought into Warehouse Wizard. Eliminates the double entry | **55 – 75 days** | **Approve now.** This is where the return is |
| **Phase 2 — Outbound** | Sales order picking driven from NetSuite, units of measure, partial pallets, picking-area visibility, scan verification, transfer despatch | **60 – 85 days** | Approve in principle, schedule after Phase 1 proves out |
| **Phase 3 — Extended** | Returns, replenishment, reconciliation reporting, the finance interim account | **35 – 50 days** | Review after Phase 2 |
| **Total** | | **150 – 210 days** | |

These are working-day estimates for development, testing and documentation. They exclude the contract rate, which finance should apply — see Section 7 for the full costing model, the assumptions behind these numbers, and what is deliberately excluded.

**Phase 1 alone delivers the stated objective.** Everything after it is improvement rather than repair.

### 1.5 Why build this rather than switch on NetSuite's own warehouse app

This is addressed properly in Section 8, because it deserves an honest answer rather than a sales one. In short:

Warehouse Wizard already does several things that NetSuite's warehouse module **cannot do at all**, and these are not opinions — they were confirmed by Wilson, Simplex's own NetSuite expert, during the meeting:

- **Pallet tracking.** NetSuite has no pallet record. Wilson: *"we do not have a pallet record within NetSuite."* Warehouse Wizard is built around pallets, with barcodes, dimensions, stacking, geometry and full traceability.
- **Replenishment triggered at bin level.** NetSuite's reorder point works on a location as a whole. Wilson: *"the restock or the reorder point we have, it will be based on the location as a whole, not in the bin."* So NetSuite cannot tell you that one picking aisle has run dry while the bulk racking is full. Warehouse Wizard can.
- **Visibility of stock in the picking area**, which is the specific gap Roget called *"a huge red flag."*

Against that, NetSuite's warehouse app carries per-user licensing and, as Jan raised in the meeting, integration volume in NetSuite consumes a metered resource that costs money to increase. The design proposed here deliberately avoids that cost. Section 8 covers this in detail.

The honest framing is not *"Warehouse Wizard is better than NetSuite."* It is: **NetSuite is the right system of record, and should stay that way. Warehouse Wizard is the right system for the warehouse floor, and can be shaped to Simplex's operation and vocabulary in ways NetSuite cannot.** The two together are stronger than either alone.

### 1.6 How it will be delivered safely

A complete copy of Warehouse Wizard — application and database — will run as a **beta sandbox** connected to the **NetSuite sandbox**. The live system keeps running untouched throughout. Nothing reaches production until Simplex has tested and signed off. Section 10 sets out the mechanics, including how the live system is upgraded and how to roll back.

### 1.7 What is needed from Simplex right now

Nothing large, but the project cannot be estimated precisely or started without them. Section 12 lists **22 open questions**. The five that block everything:

1. **The NetSuite security certificate must be uploaded.** The connection has been built and tested as far as it can go; it currently stops at NetSuite's door because the certificate has not been registered. *(Jan — this blocks every other item.)*
2. **Is "Advanced Shipping" switched on in NetSuite?** If it is off, every shipment Warehouse Wizard records would also automatically invoice the customer. *(Wilson — finance risk.)*
3. **Can Jan confirm how an inbound shipment receipt can be posted?** See Section 5.2.
4. **What should happen when the container holds 95 and the purchase order says 100?** Raised by Russell in the meeting and left unresolved. *(Roget / Wilson.)*
5. **Bins must be defined for Pine and Lower Estate, and mirrored into NetSuite.** Wilson: *"what we need is to create bins in NetSuite so we could replicate what is in Warehouse Wizard."* This is data entry, not development, but it gates Phase 1 testing.

---

## 2. What was decided in the meeting

*For: everyone. This section confirms that what was said has been captured correctly. Please correct anything that misrepresents your position.*

| # | Decision | Who drove it | Status |
|---|---|---|---|
| D1 | Receiving happens **in Warehouse Wizard**; NetSuite is updated from it. One entry, not two | Roget, agreed by Russell and Wilson | **Agreed** |
| D2 | Three inbound document types are in scope: **purchase order, inbound shipment, transfer order** | Wilson raised; Roget confirmed *"Yes, those three"* | **Agreed** |
| D3 | Warehouse Wizard **pulls** the document on demand. The operator enters or scans the number from the printed receiving report and the lines load | Russell; Jan supported it on cost grounds | **Agreed** |
| D4 | Jan will **add the purchase order number to the printed receiving report**, so there is something to scan | Jan volunteered | **Agreed** |
| D5 | Pallet labels are printed **at the container, in small batches per product** — not pre-printed | Russell, from prior experience with Kaiden | **Agreed** |
| D6 | **Cost and rate confirmation stays in NetSuite**, as a later task on the payables side. Warehouse Wizard does not touch pricing | Roget; Wilson confirmed rates are editable later | **Agreed** |
| D7 | Warehouse Wizard records **what was physically received**, and NetSuite holds the expectation | Russell | **Agreed** |
| D8 | Pine and Lower Estate must be **brought into Warehouse Wizard** with bins defined | Roget opened the meeting with this | **Agreed** |
| D9 | Bins will be **created in NetSuite to mirror Warehouse Wizard**, entered manually | Wilson | **Agreed** |
| D10 | Visibility of the picking area will be **switched back on** | Roget: *"I'm totally against it"* (being off) | **Agreed** |
| D11 | Two distinct kinds of pick are needed: **replenishment** (bulk to picking area) and **sales order** (itemised) | Russell | **Agreed in principle** |
| D12 | A **beta sandbox** copy will be built and connected to the NetSuite sandbox; production keeps running | Russell; Jan and Wilson both agreed | **Agreed** |

### Left open at the end of the meeting

| # | Question | Raised by | Now covered in |
|---|---|---|---|
| O1 | How to handle a quantity difference between expectation and delivery | Russell | §12, Q-R1 |
| O2 | Whether a pallet can be represented in NetSuite at all | Wilson / Jan | §6.3, §12 Q-J2 |
| O3 | Whether pallet numbers could serve as lot numbers | Russell | §6.3, §12 Q-W5 |
| O4 | Whether the finance interim account for picked stock is achievable | Roget | §6.4 |
| O5 | Whether picking aisles should become storage bins | Roget | §12, Q-R3 |
| O6 | How reorder points should drive purchase orders | Roget / Wilson | §6.5 |
| O7 | Unit of measure handling when an order does not make whole cases | Russell / Wilson | §6.2 |

---

## 3. Qualification of statements made

*For: everyone, but especially Roget and the CFO. This is the "check and double-check" section. Statements made in good faith during a live meeting have been tested against Oracle's documentation and the actual Warehouse Wizard code. Two did not survive unchanged.*

| Statement | Said by | Verdict | Basis |
|---|---|---|---|
| "An item receipt can't be created from scratch — it must come from a purchase order or inbound shipment" | Wilson, confirmed by Jan | **Correct** | Oracle's documentation confirms item receipts are created by transforming a source document |
| "We can create item receipts as long as we link it over with a PO" | Jan | **Correct** | Confirmed. This is a standard, documented integration point |
| "If we associate a purchase order with an inbound shipment, the item receipt can only be created via the inbound shipment" | Wilson | **Correct, and consequential** | This is exactly why the gap in §5.2 matters. It removes the fallback |
| "Receiving one inbound shipment creates one item receipt per purchase order on it" | Roget, demonstrated on screen | **Correct** | Matches Oracle's documentation |
| "An inbound shipment can carry multiple purchase orders" | Roget | **Correct** | Confirmed; the limit is 500 lines per shipment |
| "There is no pallet record within NetSuite" | Wilson | **Correct** | Confirmed. NetSuite has no pallet or licence-plate concept in its core product |
| "Lot-numbered items are a different item record — you can't just add lot tracking to an existing item" | Wilson | **Correct, and a significant constraint** | Confirmed. This makes the "pallet number as lot number" idea far more expensive than it first appears. See §6.3 |
| "In a wave there will be no GL posting — posting only happens at the item fulfilment" | Wilson | **Correct** | Confirmed. This is why Roget's interim account cannot be done the simple way. See §6.4 |
| "The reorder point is based on the location as a whole, not the bin" | Wilson | **Correct** | Confirmed. A genuine NetSuite limitation, and an opportunity for Warehouse Wizard |
| "Polling NetSuite every five minutes would be a performance and licensing issue" | Jan | **Correct, and the design has been changed to respect it** | NetSuite meters integration volume against an account-wide allowance that costs money to raise. The on-demand lookup design in D3 avoids it |
| "The picking-area functionality is pretty much all still there, it just needs to be hooked up" | **Russell** | **Optimistic — corrected** | The *data* is ready: pallets already carry available, reserved, held and damaged quantities. But the picking logic deliberately and explicitly takes whole pallets only, and this is written into the allocation rules rather than sitting behind a switch. Re-enabling it is a **moderate rework of roughly 6–10 days**, not a toggle. This is corrected in the estimates |
| "Warehouse Wizard is more robust and extendable than NetSuite" | **Russell / Classic IT** | **True in specific respects — must not be stated as a blanket claim** | Defensible and evidenced for pallet handling, bin-level replenishment, scan verification, picking-area visibility and configurability. **Not** defensible as a general statement: NetSuite holds inventory costing, the general ledger, procurement, and financial control that Warehouse Wizard does not have and should never attempt to replicate. Stated as a blanket claim to a CFO it would damage credibility. Section 8 makes the qualified version of the argument, which is stronger |
| "The upgrade will update all auto-sync databases and code to current code" | **Russell / Classic IT** | **Correct for code — dangerous if applied to data** | Code and database *structure* promote forward from beta to production. The beta database's *contents* must **never** be copied over production, because production will have accumulated real operational data during the beta period. Copying it back would destroy live records. See §10.4 |
| "We're fully paperless when it comes to purchase orders" | Roget | **Correct, with a useful exception** | A receiving report *is* printed just before the container is unstuffed. That printed sheet is the trigger for the whole receiving design in D3 and D4 |

---

## 4. What is possible — the direct answers

*For: everyone. Each row answers a question that was actually asked, in the words it was asked in.*

| The question | Answer | Effort |
|---|---|---|
| Can Warehouse Wizard look up a purchase order and load its lines? | **Yes.** Standard, documented, nothing to install in NetSuite | Included in Phase 1 |
| Can Warehouse Wizard record the receipt so NetSuite marks the PO received? | **Yes.** Jan already confirmed the mechanism during the meeting | Included in Phase 1 |
| Can Warehouse Wizard look up an inbound shipment and load its lines, across several POs? | **Yes.** Standard and documented | Included in Phase 1 |
| Can Warehouse Wizard *complete the receipt* of an inbound shipment? | **Yes — but only with a small piece of code deployed inside NetSuite by Jan.** This is the one genuine gap. See §5.2 | Phase 1, plus 2–4 days of Jan's time |
| Can Warehouse Wizard receive a transfer order from another warehouse? | **Yes**, with one important rule: the receipt must match exactly what was shipped. See §5.3 | Included in Phase 1 |
| Can Warehouse Wizard drive picking from a NetSuite sales order? | **Yes** | Phase 2 |
| Can picking be scan-verified instead of visual? | **Yes.** Warehouse Wizard already has barcode, label and printing infrastructure. Products without barcodes get labels printed at receipt | Phase 2 |
| Can Warehouse Wizard handle an order for 20 items when stock is held in cases of six? | **Yes**, but this needs proper unit-of-measure support, which is a substantial piece of work. See §6.2 | Phase 2 |
| Can pallets be broken down and picked in part? | **Yes.** The data supports it now; the picking rules need rework | Phase 2 |
| Can we see what is sitting in the picking area? | **Yes.** This is the same piece of work | Phase 2 |
| Can Warehouse Wizard receive customer returns? | **Yes**, provided NetSuite's "Advanced Receiving" feature is switched on — which must be confirmed | Phase 3 |
| Can a pallet exist in NetSuite? | **Not as a pallet.** Three workarounds exist, all with real costs. See §6.3. **Recommendation: keep pallets in Warehouse Wizard only** | — |
| Can we post a GL entry when stock is picked, into an interim account? | **Not the way NetSuite does it natively** — NetSuite posts nothing until shipment. It can be done with a custom journal entry, but that is a finance decision, not a technical one. See §6.4 | Phase 3, optional |
| Can reorder points automatically raise purchase orders? | **Yes, and NetSuite should do this, not Warehouse Wizard.** But Warehouse Wizard can do something NetSuite cannot: trigger replenishment at bin level | Phase 3 |
| Can this all be tested without risking the live system? | **Yes.** See §10 | Phase 1 |

---

## 5. Receiving — the core of Phase 1

*For: Wilson, Jan, Roget.*

### 5.1 How it will work on the floor

1. The container arrives. The receiving report is printed from NetSuite as it is today — now carrying the purchase order number as well (Jan's change, D4).
2. The operator opens Receiving in Warehouse Wizard and scans or types the inbound shipment number, or the purchase order number for a local purchase.
3. Warehouse Wizard fetches the document from NetSuite live and displays every line: product, quantity expected, and which purchase order it belongs to.
4. The operator confirms the lines against the printed sheet.
5. As the container is unstuffed, the operator records what is actually received, product by product, and prints pallet labels in small batches as they go (D5).
6. Lot numbers and expiry dates are captured where the product requires them.
7. Pallets are put away to bins.
8. Warehouse Wizard tells NetSuite what was received. NetSuite creates the item receipts — one per purchase order on the shipment — and updates the stock.
9. Rates and landed costs are confirmed later in NetSuite by the payables team (D6).

Two document types follow the same path with a different starting point: **local purchases** go straight from purchase order to receipt, and **transfer orders** from another Simplex warehouse are received the same way with the rules in §5.3.

### 5.2 The inbound shipment gap — the most important finding

**What was assumed in the meeting.** That because an item receipt can be created from a purchase order through the standard integration, the same would be true for an inbound shipment. Jan confirmed the purchase order path during the call and the discussion moved on.

**What the documentation actually says.** NetSuite's standard integration treats "inbound shipment" and "receiving an inbound shipment" as two different things. The shipment itself can be created, read, updated and deleted through the standard integration — so Warehouse Wizard can look it up and load its lines without difficulty. But the **act of receiving** it uses a separate internal NetSuite record that Oracle documents only for scripts running inside NetSuite. There is no standard external equivalent.

**Why the obvious workaround does not work.** The natural fallback is to ignore the inbound shipment and receive each underlying purchase order instead. Wilson closed that door during the meeting without realising it: *"if we associate purchase order with inbound shipment, the item receipt will no longer be created via purchase order… we could only receive it via inbound shipment."*

**Why this matters commercially.** Every imported container at Simplex uses an inbound shipment. If this is discovered during build rather than now, it surfaces late, at the worst possible moment, and the primary receiving path does not work.

**The fix.** Jan writes and deploys a small, purpose-built service inside NetSuite that accepts the received quantities from Warehouse Wizard and performs the receipt using NetSuite's internal mechanism. It is well-trodden work for a NetSuite developer and does not require any NetSuite feature Simplex does not already have.

- **Owner:** Jan Roel
- **Estimated effort:** 2–4 days of NetSuite development
- **Schedule:** must be complete before Phase 1 acceptance testing
- **Interim:** Phase 1 can begin and progress on the purchase order and transfer order paths while this is built

**Action:** Jan to confirm this analysis. The specific detail he needs is in Appendix A. If Jan finds a standard route that this review missed, that is a welcome result and removes a risk — but the project must not be planned on the assumption that he will.

### 5.3 Transfer orders — one rule that changes the process

Receiving stock from another Simplex warehouse works, with a constraint that Oracle states plainly: **the receipt must match the despatch exactly.** The same quantity, the same lot and serial numbers, and it cannot be dated before the goods shipped.

This means Warehouse Wizard **cannot** simply record "we expected 50, we got 48" on a transfer receipt. The options are:

1. Receive all 50, then post a separate stock adjustment for the 2 — clean, keeps NetSuite accurate, leaves a clear audit trail. **Recommended.**
2. Stop and have NetSuite's despatch record corrected first — accurate but slow, and it blocks the warehouse.

This needs a policy decision from Roget and Wilson. It is question Q-R1 in Section 12, and it is the same decision as the container short-delivery question Russell raised.

### 5.4 Quantity differences — the unresolved question

Russell raised this in the meeting and it was never settled: *"if only 95 are received into the warehouse and NetSuite says 100, we have to figure out how we plan to resolve that."*

There are three coherent policies. Simplex must pick one — the software can implement any of them, but not all three at once.

| Policy | What happens | Best when |
|---|---|---|
| **Receive what arrived** | Warehouse Wizard records 95. NetSuite shows 95 received, 5 still outstanding on the order | Short shipments are usually genuine and the balance may still arrive |
| **Receive and flag** | Warehouse Wizard records 95 and raises an exception for the buyer to close or chase | Differences need commercial follow-up with the supplier |
| **Receive and adjust** | Warehouse Wizard records 95 and closes the line, writing off the difference | Short deliveries are final and the paperwork should not stay open |

**Recommendation: "Receive and flag."** It keeps the warehouse moving, keeps NetSuite truthful, and puts the commercial decision with the person who should make it. It is also the only one of the three that gives Roget the error visibility he asked for elsewhere in the meeting.

A related question: should Warehouse Wizard allow receiving **more** than ordered? NetSuite blocks this unless a specific preference is switched on. Wilson needs to confirm the current setting (Q-W7).

---

## 6. The harder questions

*For: Wilson, Jan and Roget. These are the items where the meeting reached the edge of what was known.*

### 6.1 Bringing Pine and Lower Estate in

Warehouse Wizard currently runs one warehouse. Its design already supports many, so this is not a rebuild — but it does require every part of the system to be audited for assumptions that only one warehouse exists, and it requires real data work from Simplex: naming the warehouses, defining the zones, and defining every bin.

Wilson confirmed the NetSuite side already has locations for Pine and Lower Estate, but that bins must be created manually to mirror Warehouse Wizard. That mirroring is what allows stock to be tracked to a precise position in Warehouse Wizard while NetSuite holds the location-level total.

**The important principle:** a NetSuite *location* is a warehouse. A NetSuite *bin* is a position within it. Oracle warns explicitly against creating NetSuite locations to represent areas inside a warehouse — it breaks stock costing and reporting. The mapping Jan has already configured follows the correct pattern.

### 6.2 Units of measure — the biggest surprise in the meeting

Wilson raised something that had not been in scope: NetSuite holds products in multiple units. A bale contains six bags. An order can be placed in bales or in bags. The unit used on the order determines what comes out of stock.

Russell's reaction was candid: *"I honestly hadn't foreseen that. Well, due to what Kaiden had said about not doing sales order picking inside of Wizard we had not foreseen having to be able to create a product either by eaches or by cases."*

Warehouse Wizard today has a packaging concept — it knows how many units are in a package and the package's dimensions — but it does not carry NetSuite's full unit hierarchy, and picking currently works in whole pallets, so the question has never arisen.

For sales order picking to work correctly this must be built properly. It affects receiving, picking, stock display, labels and reports. The awkward case is the one Russell described: an order for a quantity that does not make up whole cases. The system must switch to the smaller unit and make that visible to the operator rather than silently rounding.

**This is a major piece of work and a prerequisite for sales order picking.** It cannot be skipped or approximated — getting it wrong means shipping the wrong quantities.

### 6.3 Pallets in NetSuite — recommendation: do not try

Wilson confirmed NetSuite has no pallet record. Three options were discussed:

| Option | Assessment |
|---|---|
| **A. Keep pallets in Warehouse Wizard only.** NetSuite receives quantities per product per location; Warehouse Wizard holds the pallet detail | **Recommended.** No NetSuite change, no risk, no cost. Simplex keeps full pallet traceability where it is actually used — on the floor. This is precisely the division of labour that makes the two systems work together |
| **B. Use the pallet number as a lot number** (Russell's suggestion) | **Expensive, and only viable for some products.** Wilson identified the blocker: lot-tracked items are a *different kind of item record* in NetSuite. Existing products cannot simply have lot tracking switched on — the records must be recreated, with all the history and configuration that implies. Worth doing **only** for products that genuinely need expiry tracking, and that decision belongs with Roget |
| **C. Create a custom pallet record in NetSuite** (Jan's suggestion) | **Possible but of limited value.** It would be informational only — it would not affect NetSuite's stock figures. It adds a second place to maintain pallet data without adding control. Not recommended unless a specific reporting need emerges |

**Recommendation: Option A, with Option B applied selectively to expiry-tracked products only.** Wilson and Roget flagged this needs a separate discussion — that discussion should happen, but the default should be A.

### 6.4 The finance interim account — an honest answer

Roget asked for a GL entry when stock is picked, moving it out of inventory into an interim account, so finance can see in-process stock and catch errors: *"if I at any moment see a value in that account, I know that something's going wrong in the process."*

**The honest answer: NetSuite will not do this natively.** Wilson confirmed it — NetSuite posts nothing to the ledger until the item fulfilment. Moving stock into a staging area, whether by a wave or a bin transfer, has no financial effect at all.

There are two ways to get what Roget wants:

1. **Operational visibility without a GL entry.** Warehouse Wizard reports exactly what is in the picking area, by product, quantity and value, live. This gives Roget the *management information* he described and costs very little, because it falls out of the picking-area work in Phase 2. It does not give him a ledger balance.
2. **A genuine GL entry.** Warehouse Wizard posts a journal entry into an interim account when stock is picked, and reverses it on fulfilment. This is achievable, but it means an external system writing to the general ledger, which needs the CFO's explicit approval, careful reversal handling, and period-end discipline.

**Recommendation: build option 1 in Phase 2 as a by-product of the picking work, then decide on option 2 once Roget has seen whether the report alone answers the need.** Roget said *"I'm not accepting it can't at the moment"* — he is right that it can be done. It is worth being clear that it is a finance governance decision rather than a technical limitation.

### 6.5 Reorder points and automatic purchase orders

Roget raised this at the very start: there is no minimum/maximum reordering today, and he wants it.

Wilson confirmed NetSuite already has this and can generate purchase orders from it — but **only at location level, not bin level**.

**Recommendation — split it:**

- **Purchase ordering stays in NetSuite.** It is a procurement and finance function, it already exists, and duplicating it would be wrong.
- **Bin-level replenishment goes in Warehouse Wizard.** This is the thing NetSuite genuinely cannot do: noticing that a picking aisle has run dry while the bulk racking above it is full, and raising a task to move stock down. Warehouse Wizard already has the foundations for this.

This split plays to each system's strength and is one of the clearest illustrations of the argument in Section 8.

---

## 7. What it costs

*For: the CFO and Roget.*

### 7.1 How to read the estimates

Effort is given in **working days** of development, including testing and documentation. The contract day rate is not included — finance should apply the agreed rate.

Three size bands are used, and they are defined so the classification can be checked rather than taken on trust:

| Band | Definition | Typical |
|---|---|---|
| **Minor** | Contained within one screen or one rule. Low risk | 1–3 days |
| **Moderate** | Touches several screens or an existing behaviour that must be reworked | 4–10 days |
| **Major** | A new capability, or a change that runs across the whole system | 11+ days |

### 7.2 The work packages

| # | Work package | Band | Low | High | Phase |
|---|---|---|---|---|---|
| W1 | Bring Pine and Lower Estate into Warehouse Wizard; audit single-warehouse assumptions | Moderate | 5 | 8 | 1 |
| W2 | Look up purchase orders, inbound shipments and transfer orders from NetSuite on demand | **Major** | 10 | 15 | 1 |
| W3 | Post receipts back to NetSuite across all three document paths | **Major** | 12 | 18 | 1 |
| W4 | Record which NetSuite order line each Warehouse Wizard line came from | Minor–Moderate | 2 | 4 | 1 |
| W5 | Map Warehouse Wizard bins to NetSuite bins, with tooling to create them | Moderate | 4 | 7 | 1 |
| W16 | Integration reliability: queueing, ordering, retries, monitoring, operations runbook | Moderate | 5 | 8 | 1 |
| W15 | Beta sandbox environment, parallel running and cutover | Moderate | 6 | 10 | 1 |
| | *Jan's NetSuite-side work for inbound shipment receiving* | *Moderate* | *2* | *4* | *1* |
| | **Phase 1 subtotal (Warehouse Wizard)** | | **44** | **70** | |
| W6 | Units of measure throughout | **Major** | 12 | 18 | 2 |
| W7 | Partial pallets and picking-area visibility (rework) | Moderate | 6 | 10 | 2 |
| W8 | Sales order picking driven from NetSuite, and despatch back to it | **Major** | 15 | 22 | 2 |
| W11 | Transfer order despatch and receipt between warehouses | Moderate | 6 | 10 | 2 |
| W12 | Scan-verified picking, and labels for products without barcodes | Moderate | 5 | 8 | 2 |
| | **Phase 2 subtotal** | | **44** | **68** | |
| W9 | Bin-level replenishment tasks | Moderate | 6 | 10 | 3 |
| W10 | Returns: customer returns from NetSuite, and internal return-to-stock | Moderate–Major | 8 | 12 | 3 |
| W14 | Nightly reconciliation and exception reporting between the two systems | Moderate | 5 | 8 | 3 |
| W13 | Finance interim account (optional — see §6.4) | Moderate | 5 | 8 | 3 |
| | **Phase 3 subtotal** | | **24** | **38** | |
| | **Development subtotal** | | **112** | **176** | |
| | Project management, user acceptance testing support, training materials (≈20%) | | 22 | 35 | |
| | Contingency (≈15%, against the open questions in §12) | | 17 | 26 | |
| | **Total** | | **151** | **237** | |

### 7.3 Cost model

```
Total cost  =  Total days  ×  agreed day rate
```

| Scenario | Days | Cost at your agreed rate |
|---|---|---|
| **Phase 1 only** — solves the double-entry problem | 60 – 96 | _____ |
| **Phases 1 + 2** — adds full outbound operation | 118 – 188 | _____ |
| **All three phases** | 151 – 237 | _____ |

*(Phase totals include a proportional share of project management and contingency.)*

### 7.4 What is deliberately excluded

So there are no surprises later, none of the following are in the numbers above:

- **Jan's NetSuite development time** (shown separately, roughly 2–4 days for the inbound shipment service, plus his time on the receiving report change, bin creation and sandbox support).
- **Simplex data entry** — defining zones and bins for Pine and Lower Estate, and creating the mirrored bins in NetSuite. This is significant clerical effort and should be resourced.
- **Any NetSuite licence changes**, should Simplex need additional integration capacity. The design is built to avoid this, but it is Simplex's cost if it arises.
- **Recreating item records as lot-tracked**, should Simplex choose that route (§6.3).
- **Hardware** — scanners, label printers, tablets for Pine and Lower Estate.
- **Ongoing support and hosting**, which stay under the existing arrangement.

### 7.5 The return

The case for Phase 1 does not rest on software features. It rests on three things:

1. **Elimination of duplicate entry.** Every container received today is keyed twice. Phase 1 removes the second keying entirely.
2. **Elimination of the reconciliation problem.** Two independent sets of numbers currently have to be made to agree. After Phase 1 there is one entry feeding both, plus an automated report that flags any drift.
3. **Removal of a stock-accuracy risk that is currently invisible.** Roget's *"huge red flag"* about the picking area is a real exposure, and it is not measurable today.

Simplex is better placed than Classic IT to put a figure on the hours currently spent on duplicate entry and reconciliation. That figure, against the Phase 1 cost, is the payback calculation.

---

## 8. Warehouse Wizard alongside NetSuite — the honest case

*For: the CFO and Roget. Wilson suggested this comparison directly in the meeting: "if it will help, just compare Wizard with WMS."*

### 8.1 The framing that matters

The question is not *"which system is better."* NetSuite is the system of record and must stay that way — it holds stock valuation, the general ledger, procurement, purchasing and financial control, and nothing proposed here changes that or should.

The real question is: **what runs the warehouse floor?** And there, three facts confirmed by Simplex's own NetSuite expert during the meeting decide it.

### 8.2 Three things NetSuite's warehouse module cannot do

| Capability | NetSuite | Warehouse Wizard | Source |
|---|---|---|---|
| **Track pallets** | No pallet record exists | Built around pallets: barcoded, with dimensions, stacking rules, geometry, reuse history and full traceability | Wilson, in the meeting |
| **Replenish at bin level** | Reorder points work on a location as a whole. It cannot see that a picking aisle is empty | Can trigger replenishment from a specific bin | Wilson, in the meeting |
| **Show what is in the picking area** | Nothing moves in the ledger until shipment; the staging step is invisible financially | Can report live contents and value of the picking area | Wilson, in the meeting; Roget's "huge red flag" |

These are not marketing claims. Each was stated by Wilson and each is corroborated by Oracle's own documentation.

### 8.3 Cost shape

| | NetSuite's warehouse module | Warehouse Wizard |
|---|---|---|
| **Licensing** | Per user, recurring, rises as the warehouse team grows | Already owned. No per-user warehouse licence |
| **Integration capacity** | Heavy use consumes a metered allowance; more capacity costs more — exactly Jan's concern | The on-demand design deliberately minimises this |
| **Changes** | Configuration within what Oracle provides; anything beyond needs custom development inside NetSuite | Changes go where Simplex needs them, including terminology |
| **Cost profile** | Recurring operating cost | One-off capital build on an asset already owned |

### 8.4 The extendability argument, stated properly

This is the point worth making to the CFO, and it should be made precisely rather than broadly.

NetSuite is configured; Warehouse Wizard is built. That difference has a concrete consequence: **Warehouse Wizard can be shaped to how Simplex actually works and to the words Simplex actually uses.**

The meeting produced a perfect illustration. Russell raised that another client calls the picking aisle a *"supermarket aisle"* — and immediately qualified it: *"I wouldn't want to introduce supermarket unless other people are happy with it."* That is the right instinct, and it is a choice that exists only because the system can be shaped. In NetSuite, a wave is a wave and a bin is a bin.

The same applies structurally. Roget's interim account, bin-level replenishment, pallet-level traceability, scan verification against Simplex's own labels — these are all things Warehouse Wizard can be extended to do because it is Simplex's software. In NetSuite they are either impossible or they become custom development inside a platform where custom development is expensive and constrained.

**The proper claim is therefore:** Warehouse Wizard is not a replacement for NetSuite and is not better than it. It is a warehouse execution system that is more adaptable than NetSuite's warehouse module, in the specific ways Simplex's operation needs, at a lower and less recurring cost — and it makes NetSuite more valuable by feeding it better data, faster, with less manual effort.

That claim is defensible in front of a CFO. A broader one is not.

---

## 9. What Simplex must prepare

*For: Wilson and Roget. None of this is development work, but Phase 1 cannot be tested without it.*

| # | Task | Owner | Blocks |
|---|---|---|---|
| P1 | Upload the security certificate in NetSuite to complete the connection | **Jan** | **Everything** |
| P2 | Name and structure the Pine and Lower Estate warehouses: zones, aisles, bins | **Wilson / Roget** | W1, W5 |
| P3 | Create matching bins in NetSuite | **Wilson / Jan** | W5 |
| P4 | Confirm the NetSuite feature settings listed in §12 | **Wilson** | Scope and estimates |
| P5 | Provide sandbox access and a separate connection for the beta | **Jan** | W15 |
| P6 | Add the purchase order number to the printed receiving report | **Jan** | D4 |
| P7 | Decide the short-delivery policy (§5.4) | **Roget / Wilson** | W3 |
| P8 | Decide whether picking aisles become storage bins (§12 Q-R3) | **Roget** | Phase 2 design |
| P9 | Identify which products genuinely need expiry and lot tracking | **Roget / Wilson** | §6.3 |
| P10 | Nominate who signs off user acceptance testing | **Roget** | Cutover |

---

## 10. Beta sandbox and the upgrade path

*For: Roget, the CFO and Jan. This section exists to answer one question: can this be done without putting the live warehouse at risk? The answer is yes, and this is how.*

### 10.1 The principle

**The live system is never the place where new work is proved.** A complete, separate copy runs alongside it. Simplex tests on the copy. Only when Simplex signs off does anything reach the live system, and even then it can be reversed.

### 10.2 What gets copied

| Component | Beta | Live during the beta |
|---|---|---|
| Application | Full copy at its own address | Untouched, running normally |
| Database | Separate database, its own data | Untouched, real operational data |
| NetSuite connection | Points at the **NetSuite sandbox** | Points at live NetSuite, as today |
| Credentials | Separate set — beta cannot reach live NetSuite | Unchanged |
| Users | Test accounts | Unchanged |

**The critical safeguard:** the beta is given credentials that only work against the NetSuite *sandbox*. Even a serious error in beta cannot create a document in live NetSuite. This is not a procedural promise — it is enforced by the credentials themselves.

### 10.3 The stages

1. **Build the copy.** Application and database cloned, connected to the NetSuite sandbox with Jan.
2. **Develop and test.** Work packages built and tested against sandbox data. Simplex can watch progress at any point.
3. **Acceptance testing.** Wilson and the warehouse team run real scenarios — a real container, a real short delivery, a real transfer — against the sandbox. Nothing touches live.
4. **Sign-off.** Simplex confirms each work package. Anything that fails goes back to stage 2.
5. **Cutover.** Structural changes applied to the live database, then the application updated. Planned for a quiet period, typically outside operating hours.
6. **Watch.** The first live container is received with the team present and reconciliation checked immediately.

### 10.4 The upgrade — an important qualification

The intent as expressed was that the upgrade *"will update all auto-sync databases and code to current code."* That is right for code, and it needs one correction for data.

**Correct:** the application code and the database *structure* move forward from beta to live. That is exactly how it should work, and the process is already established in this project.

**Must not happen:** the beta database's *contents* must never be copied over the live database. During the weeks the beta runs, the live system will be receiving real containers and recording real stock. Overwriting it with beta data would destroy that. The rule is:

> **Structure and code move forward. Data stays where it lives.**

The beta database is disposable. The live database is the only real one, and it is only ever *altered* — never *replaced*.

Where existing live data needs reshaping to fit new structure — for example adding the NetSuite line references from W4 to records that already exist — that is a controlled, reversible, tested migration, rehearsed on a copy of live data before it is run for real.

### 10.5 Rollback

Every cutover has a documented way back, decided before it starts: what would trigger a rollback, who decides, and how long it takes. Structural changes are written so they can be reversed. The live database is backed up immediately before any change.

### 10.6 Where the detail lives

The mechanics of all this — environments, branching, migration order, credentials, seeding, deployment sequence — are operational detail that would not help a CFO and would clutter this document.

**Recommendation, as asked:** that detail belongs in a **separate technical runbook**, not here. It has been written as a companion document, `docs/netsuite-beta-sandbox-runbook.md`, so that whoever performs the work — including automated tooling — has an unambiguous procedure. This white paper carries the strategy and the safeguards; the runbook carries the steps.

---

## 11. Risks

*For: Roget and the CFO.*

| Risk | Impact | Likelihood | Management |
|---|---|---|---|
| **Inbound shipment receiving needs NetSuite-side code** (§5.2) | Primary receiving path fails | **Confirmed** — it is a known requirement, not a possibility | Assigned to Jan, 2–4 days, scheduled before Phase 1 acceptance |
| **"Advanced Shipping" is off in NetSuite** | Every despatch Warehouse Wizard records would auto-invoice the customer | Unknown | **Must be confirmed before Phase 2 is designed.** Q-W2 |
| **Certificate not uploaded** | Nothing can proceed | Live now | Q-J1. One administrative action in NetSuite |
| **Bin data entry underestimated** | Phase 1 testing delayed | Moderate | Size it early (P2, P3); it is clerical work that can start immediately |
| **Units of measure more complex than described** | Phase 2 estimate rises | Moderate | Wilson to supply real examples early (Q-W6) |
| **Short-delivery policy unresolved** | Rework of the receiving screens | Moderate | Decide before W3 starts (P7) |
| **Integration capacity limits hit** | NetSuite throttles; possible licence cost | Low, by design | On-demand lookup, low concurrency, monitored. Q-J6 |
| **Scope grows again** | Cost and timeline drift | Moderate | Phase gates; each phase approved separately |
| **NetSuite's warehouse module conflicts with Warehouse Wizard at the same location** | Orders picked twice | Unknown | Q-W12. One system owns picking per location |
| **Lot-tracked item conversion** | Significant hidden data work | Moderate if Option B chosen | Recommendation is to avoid it (§6.3) |

---

## 12. Open questions

*For: Jan, Wilson and Roget. These are the questions the meeting raised but did not close, plus those this review has added. Each has an owner. The ones marked **blocking** prevent work starting or prevent the estimate from being fixed.*

### For Jan Roel — NetSuite development

| # | Question | Why it matters |
|---|---|---|
| **Q-J1** | **Can the security certificate be uploaded and the connection completed?** | **BLOCKING — everything.** The connection is built and has been tested as far as NetSuite's door. It is one administrative action in NetSuite |
| **Q-J2** | **Can you confirm the inbound shipment receiving analysis in §5.2, and take the NetSuite-side service?** | **BLOCKING Phase 1 acceptance.** The most important open item in this document |
| Q-J3 | Which general ledger account should stock adjustments post to? And the subsidiary, if applicable | Already outstanding; blocks any stock correction reaching NetSuite |
| Q-J4 | What integration capacity does the account have, and how much is already used? | Governs how hard the integration may run, and whether a licence cost arises |
| Q-J5 | Can you provide sandbox access and a **separate** connection and certificate for the beta? | Beta must not be able to reach live NetSuite |
| Q-J6 | If Warehouse Wizard receives against purchase orders rather than the inbound shipment, does the shipment's received quantity update? | Determines whether a fallback exists for Q-J2 |
| Q-J7 | You offered to add the purchase order number to the printed receiving report — can that be scheduled? | The whole receiving flow depends on there being something to scan |
| Q-J8 | You offered to test whether a pallet can be represented in NetSuite — what did you find? | §6.3. The recommendation is not to, but your finding should be recorded |
| Q-J9 | If NetSuite's warehouse module is installed, can a despatch be recorded directly at one of its locations without going through a wave? | Determines whether Warehouse Wizard and NetSuite's module can coexist |
| Q-J10 | Can you confirm the exact field names for the receiving and despatch messages against the sandbox? | Prevents a class of avoidable failures during build |

### For Wilson Reyes — inventory and NetSuite configuration

| # | Question | Why it matters |
|---|---|---|
| **Q-W1** | **Is "Advanced Receiving" switched on?** | Determines the purchase order statuses, and whether customer returns can be received separately at all |
| **Q-W2** | **Is "Advanced Shipping" switched on?** | **Financial risk.** If off, every despatch Warehouse Wizard records also invoices the customer |
| Q-W3 | You said Simplex uses only Pick and Ship, not Pack — can you confirm? | Determines how many steps Warehouse Wizard reports back |
| Q-W4 | Are "Advanced Bin Management" and "Inventory Status" switched on? | Governs whether bin and status information can be sent at all |
| Q-W5 | Which products are lot or serial tracked today, and how many would need converting for expiry tracking? | §6.3. You flagged that conversion means recreating item records — the size of that matters |
| Q-W6 | Can you supply real examples of multi-level units of measure — the rice bale/bag case and two or three others? | §6.2. This is the largest Phase 2 estimate and real examples will sharpen it |
| Q-W7 | Is "Allow Overage on Item Receipts" switched on? | Decides whether the warehouse may receive more than was ordered |
| Q-W8 | What should happen when 95 arrive against an order for 100? | §5.4. Unresolved from the meeting. Recommendation: receive and flag |
| Q-W9 | For customer returns, who decides restock versus write-off — the warehouse or finance? | Determines whether that choice appears on the warehouse screen |
| Q-W10 | Do transfers between Pine, Lower Estate and the new warehouse use in-transit ownership, and is "Use Item Cost as Transfer Cost" set? | Changes how transfer receipts must be matched |
| Q-W11 | Should automatic purchase order generation from reorder points stay in NetSuite? | §6.5. Recommendation: yes |
| Q-W12 | **Is NetSuite's warehouse module actually licensed and in use at any location?** | If it is, one system must own picking at each location, or orders get picked twice |

### For Roget Williams — policy and commercial

| # | Question | Why it matters |
|---|---|---|
| **Q-R1** | **Confirm the short-delivery policy** (§5.4) | Shapes the receiving screens. Recommendation: receive and flag |
| Q-R2 | Is the interim GL account a firm requirement, or would a live picking-area report satisfy it? (§6.4) | Decides whether W13 is in scope. Recommendation: see the report first |
| Q-R3 | Should the picking aisles become storage bins, with a dedicated staging area by the doors? | You raised this as a pushback. It changes the Phase 2 design and should be settled before Phase 2 |
| Q-R4 | Which products genuinely need expiry tracking? | §6.3. Wilson has flagged that this carries real cost |
| Q-R5 | Which phases are approved, and in what order? | Section 7 |
| Q-R6 | Who signs off user acceptance testing, and who authorises cutover? | Section 10 |

---

## 13. Recommendation

1. **Answer the five blocking questions** — Q-J1, Q-J2, Q-W1, Q-W2 and Q-R1. None requires development. They can be closed in a single follow-up meeting.
2. **Approve Phase 1.** It solves the problem that prompted this work, it is the smallest useful increment, and it proves the connection under real conditions before anything larger is committed.
3. **Start the data preparation now** — P2 and P3 in Section 9. Defining bins for Pine and Lower Estate is clerical work that does not depend on any software being finished, and it is the most likely thing to delay Phase 1 if left late.
4. **Schedule Jan's NetSuite-side work early**, not late. It is small, but Phase 1 cannot be accepted without it.
5. **Approve Phase 2 in principle, and revisit after Phase 1 goes live.** Phase 1 will teach Simplex things about the integration that will make the Phase 2 estimates better.
6. **Defer Phase 3.** Returns, replenishment and the interim account are all genuinely valuable, and none is urgent.

---

## Appendix A — Technical notes for the NetSuite developer

*For: Jan Roel only. Everyone else can stop here — nothing in this appendix changes anything in the main document.*

### A.1 Integration points

All of the following are standard NetSuite REST record endpoints unless noted.

| Warehouse action | Mechanism |
|---|---|
| Receive a purchase order | Transform the purchase order to an item receipt (`purchaseOrder/{id}/!transform/itemReceipt`) — the route Jan confirmed in the meeting |
| Receive a transfer order | Transform the transfer order to an item receipt |
| Despatch a transfer order | Transform the transfer order to an item fulfilment |
| Despatch a sales order | Transform the sales order to an item fulfilment |
| Receive a customer return | Transform the return authorisation to an item receipt |
| **Receive an inbound shipment** | **No transform exists.** Oracle documents the `receiveinboundshipment` record for SuiteScript only. This is the gap in §5.2 |
| Read any of the above | Standard record GET, plus SuiteQL for list and search |

### A.2 The inbound shipment service

Suggested contract for the RESTlet:

- **In:** the inbound shipment internal id; a list of lines, each with the shipment line key, quantity received, receiving location, and any lot, serial, bin or status detail; plus a Warehouse Wizard reference for idempotency.
- **Out:** the internal ids of the item receipts NetSuite created (one per purchase order).
- **Mechanism:** load `receiveinboundshipment` by the shipment id, set `quantitytobereceived` on the relevant `receiveitems` lines, apply inventory detail, save.
- **Idempotency:** the Warehouse Wizard reference should be stored on the created records so a retry after a timeout can be detected rather than duplicated. Warehouse Wizard already uses this pattern for stock adjustments.

### A.3 Points to verify against the sandbox

- Line identification on item receipt transforms — whether `orderLine` or `line` is expected. Always read the source document's lines first; **line numbers are not sequential**.
- Inbound shipment lines reference the purchase order's **line unique key**, not the item's internal id.
- Field names and casing for inventory detail on each record — best taken from the account's own metadata rather than from documentation.
- Whether a transfer order receipt can nominate which fulfilment it belongs to through the standard endpoint, or whether that also needs a script.
- Status letter codes for each transaction type in this account.

### A.4 Existing Warehouse Wizard integration behaviour

- Authentication is machine-to-machine with a signed assertion; the certificate is generated and awaiting upload (Q-J1).
- There is an existing job queue with atomic claiming, retry, dead-lettering and payload logging. New document types extend it rather than replacing it.
- Duplicate protection uses a Warehouse Wizard reference written onto the NetSuite record, with a lookup by that reference after a failure or timeout. This pattern extends to every new document type.
- Inbound messages from NetSuite are already accepted and parked for purchase orders, sales orders, transfer orders and fulfilments. The receivers do not exist yet — this proposal builds them.
- The background drain runs on a schedule outside the database, because this database has no facility to call out directly.

### A.5 Reference

Full documentation research, including verified source links for every claim, is in `docs/netsuite-receiving-returns-sales-research.md`. Section 11 of that document contains a read-only discovery pack — queries that can be run against the account to answer many of the questions in §12 automatically, once Q-J1 is closed.

---

## Appendix B — Glossary

*For: any reader who wants to check a term.*

| Term | Meaning |
|---|---|
| **Purchase order** | The order placed on a supplier. Created in NetSuite |
| **Inbound shipment** | A NetSuite document representing a physical shipment — typically a container — which can carry lines from several purchase orders |
| **Item receipt** | The NetSuite document that records goods arriving and increases stock |
| **Item fulfilment** | The NetSuite document that records goods leaving and decreases stock |
| **Transfer order** | A movement of stock between two Simplex warehouses |
| **Return authorisation (RMA)** | Authorisation for a customer to return goods |
| **Location** *(NetSuite)* | A warehouse. Pine, Lower Estate and the new warehouse are each a location |
| **Bin** *(NetSuite)* | A position inside a warehouse. Equivalent to a location in Warehouse Wizard |
| **Lot number** | A batch identifier, usually with an expiry date, tracked by NetSuite for products configured for it |
| **Wave** | NetSuite's mechanism for releasing orders to its own warehouse app. Not used in this proposal |
| **Advanced Receiving** | A NetSuite setting that separates receiving goods from paying for them |
| **Advanced Shipping** | A NetSuite setting that separates shipping goods from invoicing for them |
| **Transform** | NetSuite's term for creating one document from another — a receipt from a purchase order, for example |
| **Sandbox** | A complete copy of a system used for testing, where mistakes are harmless |
| **Cutover** | The moment tested changes are applied to the live system |

---

*Prepared by Russell Hunte, Classic IT, 22 September 2026. Every factual claim about NetSuite behaviour in this document is either sourced from Oracle's published documentation, stated by Wilson Reyes or Jan Roel in the meeting of 21 September 2026, or explicitly marked as unverified. Claims that could not be verified are listed in Section 12 with an owner, and the cost estimates carry contingency for them.*
