# Stricter pallet and location code entry

Two entry rules, enforced consistently across the scan surfaces. Typing is never blocked mid-keystroke — the field shows an inline error and the action button stays disabled until the value is valid.

## Rule 1 — Pallet barcode fields must start with `PLT-`

Applies to fields that identify a pallet and nothing else:

- Location Moves: new-move pallet field, and the pallet field on each queued move task
- Put-Away: "Scan or enter pallet number" dialog field, and the pallet field on each task card
- Pick Execution: directed pallet field and the alternate-pallet field
- Status Controls: the pallet field, relabelled to "Pallet barcode" (the raw record-ID path is dropped, per your answer)

Behaviour: input is trimmed and uppercased as today. If the value is non-empty and does not start with `PLT-`, the field shows "Pallet barcodes start with PLT-" and Confirm / Move / Apply is disabled. Empty stays neutral. All 285 pallets in the database use the `PLT-` prefix, so no existing stock is excluded.

Search boxes stay untouched (Inventory Search, Receiving draft search, Put-Away queue filter) — they intentionally match SKU, container, PO and location as well.

## Rule 2 — Bay and location fields must match a real code

Applies to the destination/location fields in Location Moves (new move + per-task) and Put-Away.

The value must be a prefix of, or exactly equal to, a code that actually exists — so `A`, `A-0`, `A-04`, `A-04-A` are all accepted while `A-99` or `X-01` are not. Both code shapes are accepted: the short rack code (`A-04-A`) and the full hierarchy code printed on labels (`WH3-A-1-04-L03-P1`), matching what move validation already resolves.

Behaviour: non-matching text shows "No bay or location matches this code" under the field and disables the action. A bay-shaped value (for example `A-04`) keeps its current behaviour of opening the bay selector rather than being treated as a final destination. Browse-bays and scanner input are unaffected because they always insert real codes.

## Technical notes

- New `src/lib/code-input.ts` with pure helpers: `normalizePalletBarcode`, `palletBarcodeError`, `buildKnownCodeIndex` (short codes, full hierarchy codes, and every bay/aisle prefix derived from them), and `knownCodeError`. Unit-tested in `src/test/code-input.test.ts`.
- New `useKnownLocationCodes()` hook (React Query, cached, keyed by warehouse where a page is warehouse-scoped) selecting `locations.code` with its zone and warehouse codes to build the index once per session.
- Wiring is per-page and additive: `moves-page.tsx`, `putaway-page.tsx`, the pick-execution panel in `App.tsx`, and `status-page.tsx` (plus its zod schema, which gains the `PLT-` rule). No changes to layout, tokens, or existing scan/beep/flash behaviour.
- Server-side guard: `moves-core.ts`, `putaway-core.ts` and `status-core.ts` reject a pallet argument that is not `PLT-`-prefixed with the same message, so offline replays and Copilot calls can't bypass the field rule.
