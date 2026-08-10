# Warehouse Wizard Client Training — Facilitator Guide

**Session length:** 60 minutes  
**Audience:** warehouse managers, supervisors, inventory clerks, operators, and key client stakeholders  
**Product baseline:** Warehouse Wizard 1.27  
**Companion manual:** WW-UM-001

> **Draft addendum notice:** everything above this line through "After the session" is the original, unedited facilitator guide. The "Optional IT/Admin add-on" section near the end is new, drafted during a training-materials review to give facilitators something concrete when an ERP or infrastructure owner is in the room. It has not been through sign-off — treat it as a proposal. See `docs/training/claude/Improvement-Notes.md` for the full review.

## Session promise

By the end of the hour, participants can explain the normal pallet journey, name the confirmation required at each handoff, recognize when to stop, and identify who owns the recovery action.

## Audience approach

These participants know warehouse operations through experience. Treat their current practice as the starting point, not as something to correct from a classroom.

- Begin each topic with: **“How do you handle this today?”**
- Then say: **“Warehouse Wizard records that same decision here.”**
- Use their words first—receiving lane, bay, short pallet, paperwork, load, hold—then introduce a system term only when it helps everyone share one meaning.
- Invite real examples and ask where the system should make a handoff easier or more visible.
- Demonstrate with a physical pallet/label whenever possible; avoid long feature lists.
- Treat a pause or exception as good warehouse judgment, not user failure.

Avoid phrases such as “basic inventory knowledge,” “untrained users,” “the correct way,” or “the system knows better.” Prefer “shared record,” “visible handoff,” “what the floor is telling us,” and “what the team already checks.”

## Before the client arrives

- Replace client/site placeholders in the manual and standard-work cards.
- Confirm the training tenant, active warehouse, and role accounts.
- Prepare one labeled training pallet, one exact location label, one bay label, and one product label.
- Seed or identify one receivable product with a packaging profile, lot/expiry behavior, and compatible location.
- Prepare one released whole-pallet pick task and one count task.
- Confirm scanner, camera, printer, network, display, and backup internet.
- Open the presentation locally and keep the PDF copy available as a fallback.
- Do not demonstrate Reset All, permanent deletion, or live access changes in the client environment.

## Recommended live demo path

Use one continuous story so participants see the handoffs:

1. Manager opens Dashboard and names priorities/exceptions.
2. Clerk receives one training pallet and prints its label.
3. Operator scans pallet and location in Put-Away.
4. Trainer verifies the result in Inventory Search.
5. Manager releases a whole-pallet pick.
6. Operator scans location and pallet, then confirms the pick.
7. Trainer presents a short/damaged-pallet exception without forcing it.
8. Supervisor demonstrates Inventory Search, Hold/Quarantine, and System Log ownership.

If the live tenant is not safe to change, narrate the same sequence from the deck and use the floor labels as props.

## Time plan

| Minutes | Topic | Teaching method |
|---:|---|---|
| 0–5 | Purpose, outcomes, one operating rule | Slides 1–3 |
| 5–12 | Role relay and shift start | Slides 4–5 |
| 12–30 | End-to-end flow, Receiving, Put-Away, Inventory Search | Slides 6–10 + live demo |
| 30–43 | Pick planning/execution, exceptions, moves/transfers | Slides 11–14 |
| 43–51 | Counts, offline recovery, status control | Slides 15–17 |
| 51–57 | Manager control and tabletop scenario | Slides 18–19 |
| 57–60 | Commitments, manual, next steps | Slide 20 |

## Facilitation rules

- Ask “What physical fact are we confirming?” at every workflow.
- Ask “Who owns the next action?” whenever an exception appears.
- Separate normal workflow from exception handling; do not blend them.
- Say “whole-pallet” every time picking is discussed.
- Reinforce that typing is a supported fallback, but guessing is not.
- Reinforce that offline work may preserve local entry, but live commits wait for reconnect and refresh.
- Park configuration/integration questions that do not affect Monday’s operating model.

## Questions to ask the client

1. Who owns start-of-shift work release at each facility?
2. What variance threshold requires supervisor review?
3. Where is physically controlled stock placed for Hold and Quarantine?
4. Who may override a location rule, and what reason is required?
5. What is the escalation contact and response expectation for an offline device?
6. Which printer is primary, and where are replacement labels kept?
7. Who approves a product, packaging, or location-master correction?
8. What evidence is required before Damaged or Missing status is applied?

## Success check before closing

Ask one operator and one manager to answer:

- What two scans finish Put-Away?
- What do you do if the pallet count is short during a whole-pallet pick?
- When do you use Location Moves instead of Transfers?
- What is the first action after the device reconnects?
- Where do you verify the live pallet record?

Expected answers: pallet plus exact location; stop and escalate/control the pallet; same warehouse versus different warehouse; refresh and re-check live state; Inventory Search.

## Optional IT/Admin add-on (10–15 minutes, draft)

The core 60-minute session is deliberately floor-first — Section "Facilitation rules" already says to park configuration/integration questions that don't affect Monday's operating model. Use this add-on separately (before/after the main session, or as its own short meeting) only when an ERP owner, IT stakeholder, or printer/infrastructure owner is in the room and has asked about integration.

Cover, at a level appropriate to a non-engineer:

1. **NetSuite sync** — items, purchase orders, receipts, sales orders, transfer orders, fulfillments, and inventory adjustments sync with idempotency keys and raw payload logs, so retried webhooks don't create duplicates. Failed syncs land in a dead-letter queue with an owner, not silently.
2. **Label infrastructure** — Zebra/ZPL is the primary path for floor printer stations, with full template/print-job/reprint audit trail; browser printing is office fallback only. Customer-facing logistics labels may need GS1-128/SSCC rather than the internal Code 128 pallet/location labels.
3. **Warehouse Brain** — a recommendation engine, not an automation. It watches inventory, holds, quarantine, expiry, variance, and dock status, and every recommendation requires a human accept/dismiss/resolve with a reason.

Two added client questions for this track:

9. Who owns NetSuite mapping decisions (items, locations, order types) and who is notified when a sync lands in the dead-letter queue?
10. Do any outbound shipments require GS1-128/SSCC labels, and who currently prints those today?

## After the session

- Record attendees and competency gaps.
- Capture site decisions and replace placeholders.
- Issue the approved manual PDF and role-specific SOP cards.
- Schedule hands-on sign-off by role.
- Update in-app Help and the manual together when the approved workflow changes.
