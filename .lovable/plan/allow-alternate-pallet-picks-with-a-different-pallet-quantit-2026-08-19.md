# Allow alternate-pallet picks with a different pallet quantity

Today the "Pick a different matching pallet" flow refuses any pallet whose full quantity does not exactly equal the task's requested quantity. Operators need to substitute a same-SKU pallet that holds more or less, with a clear warning and an audit trail.

## Behaviour after the change

1. Operator scans an alternate pallet. Verification still enforces: same SKU, same warehouse, available status, not frozen, not directed to another active pick task.
2. If the alternate pallet's quantity differs from the requested quantity, the preview no longer fails. It shows both numbers side by side with an amber "quantity differs" warning (over or short), and the override button reads e.g. "Override & pick 40 (requested 60)".
3. Confirming picks the alternate pallet's full quantity — more or less than requested. The task closes as completed with an automatic note recording the operator's action, the substituted pallet, and the variance. The originally directed pallet is left untouched and stays available.
4. If the picked quantity is short of the request, a follow-up prompt asks the operator:
   - "Pick another pallet for the remaining N" — creates a new pick task on the same order line for the shortfall, sourced by the existing FEFO/FIFO rotation rules, and it appears in the same pick list.
   - "Leave as is" — the line closes short and the note records the remaining shortfall.
5. Any picker/operator who can confirm picks can perform this override. Every override writes an audit event.

The existing "pallet already debited" anomaly path (directed pallet, not enough stock) is unchanged.

## Technical changes

New additive migration:

- `preview_pick_source_override` — drop the hard equality check on quantity. Keep status/warehouse/SKU/freeze/assignment checks. Return extra fields: `scanned_available_quantity`, `quantity_variance` (boolean), `variance_delta` (scanned minus requested).
- `confirm_pick_task` — add `in_allow_source_quantity_variance boolean default false`. When a source override is confirmed and this flag is set, accept a scanned pallet whose available quantity differs from `requested_quantity`, set `effective_quantity` to the scanned pallet's full available quantity, keep task status `completed`, and write `short_reason` as an operator-action note (substituted pallet barcode, picked vs requested). Relax the `in_confirmed_quantity` equality guard so it accepts the scanned pallet quantity in this path. Return `shortfall` in the JSON result. Audit metadata gains `quantity_variance`, `scanned_quantity`, `shortfall`.
- New `create_pick_shortfall_task(in_task_id uuid, in_quantity numeric)` security-definer function: inserts a new `pick_tasks` row on the same pick list and order line for the shortfall, selecting the next available pallet by the product's rotation method (FEFO/FIFO), excluding frozen locations and pallets already directed to active tasks; marked `exception` with a short reason when no stock is available. Grants for `authenticated`, warehouse access checked via `can_access_warehouse`.

Client (`src/features/picking/picking-core.ts`):

- Extend `PickSourcePreview` with the new fields; add `allowSourceQuantityVariance` parameter to `confirmPickTask`; add `createPickShortfallTask` wrapper.

Client UI (`src/App.tsx`, pick task card):

- Preview panel: show requested vs found quantity, amber warning copy when they differ, override button labelled with the actual quantity.
- Confirm call passes the scanned pallet quantity and the variance flag.
- On success with a shortfall, show a prompt (dialog) with "Pick another pallet for remaining N" and "Leave as is"; the first calls `createPickShortfallTask` and refreshes the pick list.

Tests: add cases in `src/test/pick-tasks.test.ts` covering the variance flag in the confirm payload and the shortfall follow-up call.
