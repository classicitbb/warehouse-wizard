# Warehouse Wizard Admin Guide

## Initial Setup

1. Run the Supabase migration in `supabase/migrations/20260402093000_init_wms.sql`.
2. Run `supabase/seed.sql` for a starter warehouse network, clients, products, and packaging profiles.
3. Create or invite users in Supabase Auth.
4. Have each user sign in once so their `profiles` row is created automatically.
5. Open the `Users` page, approve the user, assign one or more roles, and issue a short user code plus optional badge code.

## Master Data Sequence

1. Confirm both warehouses on the `Warehouses` page.
2. Create or adjust `Zones`.
3. Load `Locations` by form entry or CSV import. Use the in-app template button before importing.
4. Create `Products`. Use the in-app template button before importing.
5. Create `Packaging Profiles`.

## Operator Flow

1. `Receiving`: create the receipt, pallet, lot, and putaway task.
2. `Putaway Tasks`: scan pallet barcode, scan location barcode, confirm storage.
3. `Pick Lists`: managers release work, operators execute tasks from the pick execution route.
4. `Transfers`: create transfer request, scan/enter the driver's code for departure sign-off, dispatch, receive, then complete destination putaway.
5. `Cycle Counts`: generate count sheets and submit counted quantities.
6. `Statuses`: move pallets into hold, quarantine, damaged, available, or missing with an audit reason.

## Important Rules

- Cool-chain stock must go to cool locations only.
- Stock is not stored until pallet barcode and location barcode are both confirmed.
- Picking is FEFO for expirable SKUs and FIFO for non-expirable SKUs.
- Status changes and movements are written to `audit_events`.
- Sign-ins, user edits, role changes, and transfer departure sign-offs are written to `audit_events`.
- Users are authorized through Supabase RLS, not just hidden navigation.

## Enterprise Go-Live Checklist

1. Open `Dashboard` and choose `Floor` for operator starting points, `Dock` for staged outbound handoff, or `Office` for management monitoring.
2. Configure Zebra printer stations and keep ZPL templates in `label_templates`.
3. Configure NetSuite as the first integration connection and map items, locations, orders, receipts, fulfillments, and inventory adjustments.
4. Use `Reports` to export expiration risk, low stock, low turn, dock performance, and Six Sigma variance CSVs.
5. Review `Warehouse Brain` recommendations at the start and end of each shift.
6. Track QA holds, returns, replenishment, staging loads, and dock appointments through the enterprise extension tables.

## Lean and Six Sigma Controls

- Use the Floor dashboard as the daily Andon board for blocked work, hold/quarantine stock, and active scan queues.
- Use low-stock widgets as Kanban replenishment signals.
- Use cycle-count variance, DPMO, root cause, and corrective action fields for DMAIC reviews.
- Keep failed receipts, QA holds, returns, and print failures auditable instead of correcting them off-system.

## API and Integration Notes

See `docs/api-v1.md` for the versioned API contract, NetSuite adapter defaults, webhook expectations, and label generation behavior.

## Enterprise Migration Order

Run the enterprise migrations in separate SQL Editor executions:

1. `supabase/migrations/20260507123000_enterprise_wms_extensions_part1_schema.sql`
2. `supabase/migrations/20260507123100_enterprise_wms_extensions_part2_policies_seed.sql`
3. `supabase/migrations/20260507124500_user_badges_activity_transfer_signoff.sql`

Part 1 creates types, tables, and indexes. Part 2 enables RLS, creates policies, and inserts default report and ZPL label definitions. The final migration adds user codes, badge codes, activity event types, and transfer departure sign-off fields.
