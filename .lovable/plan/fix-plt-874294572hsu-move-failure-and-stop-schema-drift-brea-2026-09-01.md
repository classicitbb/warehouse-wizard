# Fix PLT-874294572HSU move failure and stop schema drift breaking moves

## What is actually happening

The pallet is healthy: `PLT-874294572HSU` is `available`, stored at `D-14-B`, has one active inventory balance, no freeze, and its put-away task `PTA-87452389OPCO` is completed. Nothing about the pallet blocks the move.

The failure is a query error. The error log for the two attempts tonight (03:06 and 03:23 UTC, moving to `STG-01-A` from the Inventory deep link) both carry the same Postgres error:

```text
42703: column locations.max_pallet_height_cm does not exist
```

The production `locations` table has `max_height` and `max_height_mm` only — `max_pallet_height_cm` was never created there, although the baseline schema declares it. The move's destination lookup asked for it, so the request failed before any inventory or pallet write. That is why nothing moved and the operator only saw a generic "Move failed" toast.

The source tree already contains the code fix (the move location projection no longer selects that column, plus a regression test), but production is still running the pre-fix bundle `1.28.10`, so the pallet still cannot be moved.

## The fix

1. **Publish the corrected build.** The projection fix in `src/features/moves/moves-core.ts` and its regression test are in place; production needs the new bundle.
2. **Close the schema drift.** Add an additive migration that adds `max_pallet_height_cm integer check (max_pallet_height_cm > 0)` to `public.locations` if missing, so production matches the declared baseline and no legacy reference (RPC, view, report, older cached bundle) can fail on it again.
3. **Prevent the whole class of error.** Add a test that reads the column lists used by the core read paths (moves, put-away, inventory) and asserts every column exists on the generated `Database` types for that table. The generated types come from the live database, so a select naming a column that production does not have fails in CI instead of on a handheld.
4. **Make the failure legible on the floor.** The move mutation currently surfaces a bare "Move failed" for a raw PostgREST object (logged as "Non-Error value thrown"). Format the thrown value through the existing `formatSupabaseError` path so the operator and the support ticket both show the real reason.
5. **Verify the move.** After publish, run the move `PLT-874294572HSU` -> `STG-01-A` and confirm the pallet row, the inventory balance, and the bin occupancy all land at the new location.

## Release

Version rolls `1.28.10` -> `1.29.0`: bump `package.json`, add the entry to `src/lib/release-history.ts` (Release Notes / What's New), and note the Location Moves fix in the Help Center move topic.

## Technical notes

- New migration `supabase/migrations/<ts>_locations_max_pallet_height_cm.sql`: `alter table public.locations add column if not exists max_pallet_height_cm integer check (max_pallet_height_cm > 0);` plus a comment. No grants needed (existing table).
- New test in `src/test/location-moves.test.ts` (or a small `src/test/schema-projection.test.ts`): parse the exported select strings and assert each column key exists in `Database["public"]["Tables"][table]["Row"]`.
- `src/features/moves/moves-page.tsx`: route mutation errors through `formatSupabaseError` before the toast, so non-`Error` PostgREST objects render their message.
