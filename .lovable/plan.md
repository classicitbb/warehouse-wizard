# Fix "column reference pallet_id is ambiguous" in receiving confirmation

## What is happening

Pressing "Labels printed" on a receiving draft fails with Postgres error 42702:
`column reference "pallet_id" is ambiguous`. Nothing is received, and the draft stays in the list.

## Confirmed cause

The live database function `confirm_receiving_draft_labels_printed` declares its result as
`RETURNS TABLE(pallet_id uuid, pallet_barcode text, putaway_task_id uuid, putaway_task_number text)`.
Those output names become PL/pgSQL variables inside the function body. The body then runs queries such as:

```text
select * into balance_row from public.inventory_balances where pallet_id = v_pallet_id;
select * into existing_task from public.putaway_tasks where pallet_id = v_pallet_id ...;
select * into pallet_row from public.pallets where pallet_code = v_barcode or pallet_barcode = v_barcode;
```

Here `pallet_id` and `pallet_barcode` match both the output variable and the real table column, so
Postgres refuses to run the statement and the whole confirmation aborts.

## The fix

New migration that recreates the function unchanged in behaviour, with the name collision removed:

- Rename the result columns to non-colliding names (`out_pallet_id`, `out_pallet_barcode`,
  `out_putaway_task_id`, `out_putaway_task_number`), keeping the same column order and types so the
  existing client call site keeps working. Alternatively qualify every column reference; renaming the
  outputs is the safer, complete fix.
- Add `#variable_conflict use_column` as a second line of defence.
- No behaviour change: same permission checks, same lot/pallet reuse rules, same put-away task creation.

## Audit the sibling functions

The same pattern (a `RETURNS TABLE` column named after a real table column) exists in other functions,
so each is checked and given the same treatment where a bare column reference is present:

- `recover_missing_pallet_to_putaway`
- `recover_missing_pallet_to_draft`
- `complete_inventory_pallet_correction`
- `complete_inventory_pallet_correction_in_place`
- `begin_inventory_pallet_correction`
- `return_putaway_to_receiving_draft`
- `save_inventory_pallet_correction_as_draft`

## Client-side updates

`src/features/receiving/receiving-core.ts` reads `pallet_id` / `pallet_barcode` /
`putaway_task_id` / `putaway_task_number` from the RPC result — updated to the renamed keys, along with
any other call sites touched by the audit above.

## Prevent regressions

- Add a database-level check to `src/test/migration.test.ts` style guard rails: a test that scans
  migration SQL for `RETURNS TABLE(` output names that collide with the columns used in the body, or
  requires `#variable_conflict use_column` in functions that return table columns.
- Manually exercise: save a receiving draft, press "Labels printed", confirm a pallet plus a PTA task
  appear, and confirm a queued (older) draft can also be received and cancelled.
