# Warehouse Wizard

Warehouse Wizard is a production-oriented internal WMS app for a 3PL-style warehouse operation. It supports warehouse setup, product master data, receiving, directed putaway, pallet-level inventory search, picking, transfers, cycle counts, stock status control, enterprise dashboards, dock handoff, AI-assisted recommendations, reporting, CSV import/export, Zebra ZPL label output, Supabase Auth, and Supabase RLS.

## Stack

- React + TypeScript + Vite
- Tailwind + shadcn/ui
- React Router
- TanStack Query
- React Hook Form + Zod
- Supabase Auth, Postgres, Storage, Realtime-ready schema
- PWA via `vite-plugin-pwa`
- Vitest + React Testing Library

## Setup

1. Install dependencies:
   `npm install`
2. Copy `.env.example` to `.env` and fill in your Supabase values.
3. Run all SQL files in `supabase/migrations/` in timestamp order.
4. Run the seed in `supabase/seed.sql`.
5. Start the app:
   `npm run dev`

## Local Launcher

On Windows, double-click `Launch Warehouse Wizard.bat` from the project folder to build the site, start a local production preview, and open it in Chrome, Edge, or the default browser.

To create a desktop shortcut for that launcher, right-click `Create Desktop Shortcut.ps1` and run it with PowerShell. The app window shows `LOCAL` when opened from the launcher or another local/private address, and `ONLINE` when opened from a hosted domain.

## Supabase Notes

- The migrations create the required core tables, enums, helper functions, views, storage buckets, indexes, profile approval fields, and RLS policies.
- New auth users automatically get a `profiles` row through `handle_new_user()`.
- Roles are assigned through `roles` and `user_roles`; admins approve, edit, disable, and badge/code-enable users from `/users`.
- Storage buckets are created for `labels`, `imports`, and `attachments`.

## Seeded Test Users

All seeded users use password `Warehouse123!`. They can sign in by email, user code, or badge code.

This recovery PR intentionally keeps the enterprise WMS gap-review work and the later user-role/sign-off work together so deployments pick up the full warehouse flow: dashboard modes, NetSuite/ZPL foundations, CSV templates, badge login, editable users, transfer sign-off, role-specific navigation, and expanded help guidance.

| Role | Email | User code | Badge code |
| --- | --- | --- | --- |
| Developer | `russelljhunte@gmail.com` | `Falcon-Crate-92!Tundra` | — |
| Admin | `admin@warehousewizard.local` | `ADMIN01` | `BADGE-ADMIN01` |
| Warehouse Manager | `manager@warehousewizard.local` | `MGR01` | `BADGE-MGR01` |
| Inventory Clerk | `clerk@warehousewizard.local` | `CLK01` | `BADGE-CLK01` |
| Warehouse Operator | `operator@warehousewizard.local` | `OPR01` | `BADGE-OPR01` |
| Dispatch Driver | `driver@warehousewizard.local` | `DRV01` | `BADGE-DRV01` |
| Warehouse Supervisor | `supervisor@warehousewizard.local` | `SUP01` | `BADGE-SUP01` |

## Key Routes

- `/login`
- `/dashboard`
- `/warehouses`
- `/zones`
- `/locations`
- `/products`
- `/packaging-profiles`
- `/receiving`
- `/putaway-tasks`
- `/inventory-search`
- `/pick-lists`
- `/transfers`
- `/cycle-counts`
- `/status`
- `/reports`
- `/users`
- `/settings`
- `/help`
- `/setup-wizard`

## Operational Workflows

- Receiving creates receipts, receipt lines, lots, pallets, label records, inventory balances, and putaway tasks.
- Putaway confirms both pallet barcode and location barcode before stock becomes available.
- Inventory search reads from `inventory_search_view`.
- Pick list creation allocates from available inventory and creates pick tasks.
- Transfers preserve pallet identity, require driver departure sign-off before dispatch, and create follow-on tasks.
- Cycle counts generate count lines and write adjustment records for variances.
- Status changes write audit entries and stock adjustment records.
- The dashboard has Floor, Dock, and Office modes for operator start-of-shift work, staged delivery handoff, and management monitoring.
- Reports include saved-report style outputs, CSV export, lean/Six Sigma signals, and Warehouse Brain recommendations.
- Enterprise extension migrations add NetSuite-ready integration logs, external ID links, printer queues, report definitions, AI recommendations, QA, returns, staging, replenishment, and work-template tables.

## Enterprise Deliverables

- API contract: [docs/api-v1.md](./docs/api-v1.md)
- Admin and go-live guide: [docs/admin-guide.md](./docs/admin-guide.md)
- NetSuite-first integration model through `integration_connections`, `external_record_links`, `integration_sync_jobs`, payload logs, and dead letters.
- Zebra-first printing model through `label_templates`, `printer_stations`, and `print_jobs`.
- Warehouse Brain recommendation storage through `ai_recommendations`.
- Enterprise migrations are split into `20260507123000_enterprise_wms_extensions_part1_schema.sql`, `20260507123100_enterprise_wms_extensions_part2_policies_seed.sql`, and `20260507124500_user_badges_activity_transfer_signoff.sql` for easier Supabase SQL Editor execution.

## Commands

- `npm run dev`
- `npm run build`
- `npm run lint`
- `npm test`

## Verification

The current repository has been verified with:

- `npm run build`
- `npm run lint`
- `npm test`

## Admin Guide

See [docs/admin-guide.md](./docs/admin-guide.md) for the warehouse setup sequence and operator usage guidance.
