# UI baseline history

Moved unchanged from root AGENTS.md; consult before changing a historically approved surface.


- `2026-05-09` — UI freeze established at commit `015b6f43`.
- `2026-05-11` — Command Center/header explicitly updated with themed loading, pallet dials, desktop fit behavior, and manager warehouse switcher.
- `2026-05-24` — User-approved updates to Putaway task pallet confirmation, return-to-Receiving draft prompt, and Inventory Detail barcode/label preview.
- `2026-05-24` — User-approved updates to inventory, putaway, and pick list search; navigation order; mobile toolbar; responsive table editing; and login fit.
- `2026-05-25` — User-approved update to Inventory Search warehouse scope field for live warehouse, zone, aisle, and location matching with scanner support.
- `2026-05-25` — User-approved update to Pallet Label preview and print layout to fill Letter/A4-style sheets and always show all field labels.
- `2026-05-25` — User-approved update to Login password visibility control and version/new-features popups.
- `2026-05-25` — User-approved update to Login logo tile background to match the dark login side.
- `2026-05-25` — User-approved update to Putaway task confirmation fields for aligned desktop layout and explicit location confirmation label.
- `2026-05-25` — User-approved update to Putaway location confirmation label to omit the suggested location value.
- `2026-05-25` — User-approved update to Inventory Search filter bar responsive wrapping to prevent control collisions.
- `2026-05-25` — User-approved update to group Warehouses, Zones, Locations, and Products resource actions under a gear menu.
- `2026-05-25` — User-approved update to Inventory Search scrolling so only table rows scroll.
- `2026-05-25` — User-approved correction to Inventory Search route shell so the page header and filters remain fixed while results scroll.
- `2026-05-25` — User-approved correction to Inventory Search results table with fixed column headings and row-only scrolling.
- `2026-05-25` — User-approved correction to Inventory Search results table to use one aligned sticky-header table with vertical and horizontal row scrolling.
- `2026-05-25` — User-approved update to require double-click or double-tap before opening editable/detail table rows site-wide.
- `2026-05-25` — User-approved update to Location code creation so saved codes include warehouse, zone, and location hierarchy.
- `2026-05-25` — User-approved update to Location labels to show full hierarchy codes and use QR for complex codes.
- `2026-05-25` — User-approved fix for Location edit saves and migration to normalize existing location hierarchy codes.
- `2026-05-25` — User-approved update to publish version 1.1.2 release notes and What's New copy.
- `2026-05-25` — User-approved update to Help Center contextual module topics for clients, location moves, system log, email log, and route coverage.
- `2026-05-25` — User-approved update to Receiving page scrolling and Saved Drafts search with barcode scanner support.
- `2026-05-25` — User-approved update to Pick List create defaults, order scanner, product/quantity controls, and active list count.
- `2026-05-25` — User-approved update to Putaway task header fixed scrolling and more vibrant confirmation feedback with ding.
- `2026-05-25` — User-approved fix to keep completed/cancelled Putaway tasks out of the active Putaway queue.
- `2026-05-25` — User-approved update to Pallet Label preview and print background plus larger barcode value placement.
- `2026-05-25` — User-approved update to Command Center live, non-duplicated dashboard metrics, click-through metric sources, responsive scrolling, and data-backed Warehouse Intelligence.
- `2026-05-28` — User-approved removal of the Users shortcut from the sidebar navigation.
- `2026-05-28` — User-approved update to make all Command Center tiles draggable and resizable across Floor, Dock, and Office views.
- `2026-05-28` — User-approved update to merge Command Center summary and mode tiles into one persisted user layout surface per view.
- `2026-05-28` — User-approved update to publish version 1.1.3 release notes and What's New copy.
- `2026-05-28` — User-approved update to Login self-serve access with badge scan, PIN challenge, user code sign-in, and password reset.
- `2026-05-28` — User-approved update to pending user access so requested accounts enter a limited shell with Help Center and authorization refresh.
- `2026-05-28` — User-approved update to Settings tabs so Users & Roles is first for admins and the tab row wraps responsively.
- `2026-05-28` — User-approved update to move Role Matrix from main Settings tabs into the Users & Roles tab group.
- `2026-05-28` — User-approved update to add placeholder Reset password and gated Print badge actions to Settings user edit.
- `2026-05-28` — User-approved update to Login badge scanner flow with scanner-area restart, scanned-code display, keypad PIN popup, and per-device method memory.
- `2026-05-28` — User-approved update to Settings user edit for direct password/PIN updates, badge QR printing, and single-warehouse defaulting.
- `2026-05-28` — User-approved update to Location Moves direct scan completion and queued/in-progress move cancellation.
- `2026-05-29` — User-approved updates: auto-switch to Lists tab after releasing a pick list, sidebar width fits text with 50% taller nav items, mobile navigation slides in from the top, separator between Location Moves and Warehouses, and persistence of user/badge codes and badge PIN in Edit User.
- `2026-05-29` — User-approved v1.7 batch: QR codes replace barcodes on all labels (pallet/location/zone/warehouse); Inventory Search re-enabled horizontal scrolling with nowrap columns; Products table shows read-only total Qty next to name; desktop sidebar mounts only in landscape with squishy press feedback; Help is pinned as the last sidebar item; Edit Location notes/max-height field-name mismatch fixed; version bumped to 1.7.0 with new release notes. Bulk label sheets for locations/zones planned for the next pass.
- `2026-05-29` — User-approved v1.1.7 follow-up: version corrected to 1.1.7; Inventory Search table now scrolls horizontally and vertically (min-w-0 on TableFrame and card flex parents); bulk label sheet printing for Locations and Zones via new LabelSheetPrintDialog (Letter/A4, Avery-style grids, start cell, margin) wired into the gear menu using current filter results; full-screen Access Requests dialog for admins/managers/supervisors with "Go to Users" CTA. Help content rewrite still pending.
- `2026-05-29` — User-approved Reset All overhaul: requires typed `RESET ALL` challenge, lists implications, and now also removes all non-developer profiles, user_roles, and auth users. Added per-row "Delete permanently" (Trash) action on warehouses/zones/locations/products/clients for admins/developers — guarded by typed `DELETE` challenge and server-side child-reference check that lists blocking tables when blocked.
- `2026-05-29` — User-approved Setup Wizard audit: wizard now starts from a fully blank payload (no Barbados warehouses, no STG/DSP/QTN/AMB/COOL zones, no location-rule defaults). "Add warehouse / zone / location template" buttons insert truly blank rows. When an existing warehouse environment is detected, the wizard preloads warehouses, zones, and derived location rules for review/extension. Step 5 no longer seeds demo operational data by default — developers can opt in via a switch.

- `2026-08-19` — User-approved v1.28 release: alternate-pallet pick quantity override with shortfall follow-up task, Inventory Search Load more + abbreviated column labels, supervisor access to Edit & return to Receiving, pallet correction cancel restore, Location Moves product-field and receiving-status fixes, receiving container fields, Copilot token-refresh auth fix, denser table padding with vertical dividers, preview reload fix, react-router 7.18 upgrade, and revoked anonymous execute on privileged pick functions.
- `2026-08-22` — User-approved v1.28.4 brand-icon update: new isometric pallet cube icon set (SVG, maskable, PNG, ICO) deployed across favicon, PWA, email, and TWA assets with dark/light compatibility.

Append new entries here only when the user explicitly asks to record a UI
baseline shift.

