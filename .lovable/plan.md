# Fix putaway error: missing AI hints table

## What's happening

After confirming a put-away, the app tries to record a learning signal into the `ai_product_hints` table. That table does not exist in the live database (confirmed by querying the schema — only `ai_recommendations` exists), so every put-away logs a `PGRST205` console error. The put-away itself still completes; only the AI learning write fails.

The table was defined in an older migration file that was never applied to this database.

## Fix

1. Add a new migration that creates `public.ai_product_hints` exactly as the app expects: product/warehouse/hint_type rows with value JSON, sample count, confidence, timestamps, unique index per (product, warehouse, hint_type), updated_at trigger.
2. Include the table grants for signed-in users and service role, then enable row level security with read/insert/update policies for approved signed-in users. No anonymous access.
3. Verify by re-running the put-away flow signals: confirm the table is present and a hint row is written, with no console error.

## Notes

No UI changes. The AI-assist writes stay fire-and-forget, so if anything else fails later, put-away still completes normally.
