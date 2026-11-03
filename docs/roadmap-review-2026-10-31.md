# Roadmap review (stashed 2026-10-31, not yet actioned)

Status: proposal only. Nothing implemented. Revisit after Slice E.

## Verdicts

| Item | Verdict | Note |
|---|---|---|
| 1.1 Pallet split on returned drafts | Ship | Guard that split qty sums to parent; cancelling one half must not orphan group. |
| 1.2 DB-atomic duplicate guard | Ship with supervisor override-with-reason | Hard block with no exit stalls the dock. |
| 1.3 Unrecorded-pallet quarantine | Ship as "Flag & hold" not hard block | Operator moves on; supervisor re-receives or scraps. |
| 2.1 Inbound Shipment / TO item receipts | Shipments yes, TOs defer | Reconciliation report must prove parity before suppressing adjustments. |
| 2.2 Item Fulfillment | Change: post on dock-confirmed/shipped, not staged | Supervisor "ready to post" review for first 2-4 weeks. |
| 2.3 Dead-letter dashboard | Ship first in Phase 2 | Retry idempotent; Dismiss requires reason. |
| 3.1 Scanner auto-submit | Mostly done (`scan-dwell.ts`) | Remaining: hardware wedge scanners; keep confirm on overrides. |
| 3.2 IndexedDB offline replay | Do not build | `offline-queue.ts` disabled replay on purpose. Use read-only offline mode + resume banner. See `offline-reconnect-conflict-resolution.md`. |
| 4.1 DB-side FEFO/FIFO + keyset paging | Ship | Measure P95 baseline first. |
| 4.2 Migration journal reconciliation | Ship carefully | Repair entries only; never delete migrations; rehearse in sandbox. |
| 4.3 Test harness update | Ship (quick win) | |

Resequence: 4.3 -> 1.1 -> 1.2+1.3 -> 2.3 -> 4.1 -> 2.1 (shipments) -> 2.2 -> 3.1 -> read-only offline mode.

## Help topics
- New articles: Pick faces, Replenishment (thin today), shared Edit Location dialog, overlay title bar, split pallets, quarantine flow, NetSuite sync queue, Slice E.
- "I'm stuck" format: message / meaning / next step tables; search matches exact error text.
- Contextual `?` per screen (hint-button.tsx, help-sidebar.tsx exist); role-aware; "what changed" card from release-history.ts.
- Test: every key in STARTER_MODULES must have a help article.

## Unblock workflows
Every block has a visible reason, an operator exit, and a supervisor exit (duplicate container, unknown pallet, bay full, short pick, frozen bin, failed sync, lost Wi-Fi, split mismatch). Add a stuck-task timer feeding a supervisor list.

## Module qualification gates (flag stays off until all pass; signed checklist in docs/testing/)
1. CI zero failures + fresh-DB and prod-copy migration test
2. Concurrency (double-click, parallel operators)
3. Permissions per role + RLS/tenant isolation
4. Failure injection (network drop, token expiry, record lock)
5. NetSuite reconciliation, zero variance
6. Scale: 20k+ pallets, P95 budgets
7. Real devices: scanners, tablets, printers
8. Operator UAT using only the help article
9. Seeded-mistake drill (wrong pallet/lot/bay)
10. Shadow/parallel run one week
11. Rehearsed rollback + help/release note published before flag flip
