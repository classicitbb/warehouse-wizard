# Steel & Safety operational refresh

## Outcome
Make the selected warehouse workflows faster to read and harder to mis-operate, using the approved **Steel & Safety Operations** direction: dense queue-first screens, strong state rails, IBM Plex typography, and existing semantic safety colours.

## 1. Alternate pallet: verification goes straight to confirmation
- Keep the useful “Alternate pallet detected” notice and automatic checks.
- Remove the separate **Override source** step. A successful verification will arm the alternate pick immediately.
- Turn the single bottom action into **Confirm alternate pick**, focus it, and give it a short high-contrast pulse so it is unmistakably the next step.
- Keep quantity-variance wording visible before confirmation, along with **Use directed pallet instead** as the safe undo.
- Respect reduced-motion settings and preserve all existing server-side pallet, SKU, quantity, hold, location, audit, and shortfall checks.

## 2. Pick-list row readability
- Rebuild the selected task row around a strong left status rail and a clear reading order: product name, pack description/SKU, source pallet, target quantity, then status.
- Increase contrast and separate identifiers from descriptive text without adding fake NetSuite references.
- Preserve the existing double-click/double-tap rule and current task actions.

## 3. Transfers: future-ready for NetSuite
- Change the page from a permanently split form/list into a queue-first workspace with compact summary counts, search/filter controls, and a prominent **New transfer** action.
- Open transfer creation in a focused window while preserving the current transfer rules, pallet identity, dispatch sign-off, receipt, cancellation, and audit trail.
- Make each queue row clearly show transfer number, source → destination, pallet/quantity, workflow status, and timestamps.
- Reserve honest UI states for a future NetSuite transfer-order reference, synchronization state, retry/error detail, and reconciliation status. Do not fabricate values or implement synchronization in this pass.
- Reflect the confirmed integration model: NetSuite transfer orders will later drive dispatch/receipt, while Warehouse Wizard retains pallet-level execution.

## 4. Status: exception-first redesign
- Replace the long two-column layout with a compact scan/action area followed by a searchable controlled-stock queue.
- After a pallet lookup, present high-visibility status actions and require the existing reason before applying them.
- Make missing, damaged, quarantine, hold, and release states easier to distinguish; preserve the existing **Found** recovery flow and audit logging.
- Add a reserved integration-state area only when real source/reference data exists. Status posting remains future work because NetSuite Inventory Status availability is still an account-level open question.

## 5. Reports: more useful operational decisions
Use data already loaded by the reports layer to add useful, non-invented summaries:
- inventory and available quantity by warehouse
- occupied/free/full locations and capacity risk
- expiry risk bands and low-stock/reorder exposure
- active work and movement/exception counts
- cycle-count variance/DPMO
- dock and print health where records exist
- NetSuite queue health: pending, failed/dead-lettered, and recent successful jobs when real integration records exist

Keep the saved CSV reports, Warehouse Brain recommendations, and recent audit activity, but improve hierarchy and empty states.

## 6. Dashboard
- Remove **Fit to screen** and its unused state.
- Keep fullscreen, layout lock, mode tabs, and persisted tile behavior unchanged.

## Validation and release
- Add focused tests for automatic alternate arming, one-confirm behavior, and the confirmation pulse state.
- Test Pick Lists, Transfers, Status, Reports, and Dashboard at desktop and mobile widths.
- Run the project typecheck and relevant tests.
- Exercise the alternate flow through final readiness without moving live stock; final stock movement requires an approved test record in the isolated beta.
- Publish as the next release with matching release notes and Help updates for changed operator steps.

## Technical boundaries
- Frontend and presentation changes only for NetSuite readiness; no schema, queue, or connector behavior changes.
- Reuse current Button primitives and semantic tokens; the approved Steel & Safety direction is expressed through the existing theme roles rather than hardcoded component colours.
- No manual lot selection: allocation remains FEFO/FIFO on release.
