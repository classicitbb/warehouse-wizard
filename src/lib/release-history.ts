export type ReleaseNote = {
  version: string;
  date: string;
  /** Headline items shown as "What's new" for the release. */
  changes: string[];
  /** Fixes shipped alongside the features in the same release. */
  fixes?: string[];
};

export const RELEASE_HISTORY: ReleaseNote[] = [
  {
    version: "1.28.9",
    date: "August 2026",
    changes: [
      "Long lists now load as you scroll: Inventory Search, Locations, Products, Zones, Warehouses, Clients, Reports, System Log, and Email Log all pull the next 50 rows automatically as you approach the bottom, with a Load 50 more button as a manual fallback",
      "Rows already on screen stay put while the next page loads, so scrolling never jumps back to an empty table",
      "Settings > Environment: scanner tuning is configurable on the device — scan dwell time and a post-scan cooldown that blocks accidental duplicate submissions of the same code",
      "Audio and alert controls moved into Settings > Notifications, beside build alerts and notification permissions",
      "Scanning now reads codes only inside the square target: a code seen elsewhere in frame glows green but is not captured until it is inside the reticle",
      "Location Moves has a Cancel Move button that returns you to the inventory product you were viewing when the move started",
      "Settings > About now lists every release under the current version, with features and fixes separated",
    ],
    fixes: [
      "Scanner captures a recognised code instantly again — the one-second dwell requirement was removed",
      "Pallet edits that were left mid-flight can be resumed or cancelled: Cancel now releases the pallet instead of leaving it stuck in correction",
      "Date pickers keep a fixed six-row grid, so switching between months no longer resizes the popup",
      "Expiry dates cleared from all Greenware stock, which does not expire",
    ],
  },
  {
    version: "1.28.8",
    date: "August 2026",
    changes: [
      "Dropped connections now heal themselves: the app retries every few seconds, refreshes your session, and reloads live data in place — no forced page reload, signed in or not",
      "All loading indicators are now one calm monochrome spinner",
      "Warehouse tree fill levels now cover every rack: bay, location, and capacity stats no longer stop after the first 1,000 bins (Rack J and beyond were showing blank)",
      "Typing in the Put-Away task search keeps the cursor in the search box instead of jumping to the first pallet field",
      "New Settings > Notifications tab: per-device build alerts, a permission prompt, a test notification, and unblock instructions if notifications were denied",
      "After an update, a What's New popup shows the release summary once per version — never during an active scan or confirm flow",
      "Tapping the version number opens Settings > About",
    ],
  },
  {
    version: "1.28.7",
    date: "August 2026",
    changes: [
      "Scanner targets are now square for pallet and bay codes, and portrait-shaped for container doors, so the reticle matches what you are aiming at",
      "Scans now require a 1-second dwell: a code must hold steady in the reticle before it is accepted, so a passing glimpse of a neighbouring label never inserts itself",
      "Pallet edits from Inventory are now staging-only: outside Put-Away Staging (STG-01-A) the Edit pallet button is disabled with a hint and a Go to Location Moves shortcut that pre-fills the pallet and bay",
      "Opening the pallet edit dialog no longer changes the pallet: the correction draft is only created when you commit to Save, and Cancel now just closes the dialog untouched",
    ],
  },
  {
    version: "1.28.6",
    date: "August 2026",
    changes: [
      "Bay and location fields autocomplete the separators: type A01A and the field corrects itself to A-01-A as soon as the code is recognised",
      "Separators are only inserted when every matching code agrees, and backspacing still removes them, so typed entry never fights the operator",
      "Module visibility switches now save to your account alongside pinned favourites, so the same workspace follows you to any device you sign in on",
    ],
  },
  {

    version: "1.28.5",
    date: "August 2026",
    changes: [
      "Cycle Counts: warehouse managers can cancel draft, frozen, counting, review, or approved counts with a required audit reason",
      "Cycle-count cancellation now stops assigned work, clears active line claims, and releases inventory freezes in one database transaction",
      "Closed, already-cancelled, and archived counts remain immutable; adjustments posted before cancellation remain in inventory history",
    ],
  },
  {
    version: "1.28.4",
    date: "August 2026",
    changes: [
      "New sitewide brand icon: an isometric pallet cube that works on dark and light backgrounds, from favicon to PWA home-screen icons and email headers",
      "Icon set ships as SVG master, maskable variants, and multi-size PNG/ICO so it stays sharp on phones, desktops, and warehouse tablets",
      "Preview/host hard-reloads are now handled as a soft data refresh, so the app no longer breaks out of the Lovable preview proxy",
      "Error boundary chunk failures in preview no longer force a full page reload",
    ],
  },
  {
    version: "1.28.3",
    date: "August 2026",
    changes: [
      "Bay grid: any location showing pallets now has a check button — it reports stock records with no physical pallet behind them and clears them on confirm",
      "Cleared records are marked missing rather than deleted, so Status > Missing pallets remains the undo path",
      "If a bay looks empty but the check finds nothing wrong, the operator can hand it to the copilot in one tap",
      "Occupancy is recalculated after every move, put-away, and pick so bay counts never lag behind the floor",
    ],
  },
  {

    version: "1.28.2",
    date: "August 2026",
    changes: [
      "Inventory Detail: stored pallets are edited in place from Inventory instead of being pushed over to Receiving, and a pending edit reopens where it was left",
      "Pallet edit: an edit can be blank — Save as draft returns the pallet to Receiving > Drafts with or without changes",
      "Pallet edit: Cancel restores the pallet exactly as it was, leaving only an audit record of the attempted edit",
      "Pallet numbers: a pallet keeps its number unless a committed edit needs a new label or the pallet is returned to Drafts",
      "Status: a missing pallet found with no location can be sent straight to Put-Away under its own number, or saved as a draft for re-labelling",
      "Status: pallets superseded by a correction no longer linger in Controlled stock",
    ],
  },
  {
    version: "1.28.1",
    date: "August 2026",
    changes: [
      "Warehouse Structure: right-clicking a rack, bay, level, or location now offers View Contents, opening Inventory Search scoped to everything stored under that node",
      "Inventory Search: a scoped view shows which rack, bay, level, or location it is filtered to and can be cleared in one click",
    ],
  },
  {
    version: "1.28",
    date: "August 2026",
    changes: [
      "Pick Execution: alternate-pallet verification now accepts a same-SKU pallet with a different quantity, warning with both numbers before the override is confirmed",
      "Pick Execution: a short pick now prompts the operator to raise a follow-up task for the remaining quantity or leave the line as is",
      "Inventory Search: results no longer hide rows behind an unreachable Load more, and long column names are abbreviated with tooltips for narrower columns",
      "Inventory Detail: Edit & return to Receiving is now available to supervisors and above, and cancelling a pallet correction restores the pallet to its original location",
      "Location Moves: pallet placement no longer fails on product temperature and height lookups, and receiving-status pallets can be moved",
      "Receiving: container number and related shipment fields are stored correctly again, and adding or editing products saves without column errors",
      "Copilot: sessions no longer drop to Not authenticated after a token refresh",
      "Tables: tighter column padding with fine vertical dividers for denser operational lists",
      "Platform: preview reload loop fixed, react-router upgraded to 7.18 for security fixes, and anonymous execution revoked on privileged pick database functions",
    ],
  },
  {
    version: "1.27",
    date: "August 2026",
    changes: [
      "Notifications: RF connectivity notices and reorder alerts now share one header bell, with grouped sections and a single combined count",
      "Receiving: the container scanner is AI-assisted — when on-device text recognition cannot read the container face, a photo is analysed by AI and the ISO 6346 number is offered for confirmation",
      "Container scanning: every AI or OCR read is still check-digit validated and must be confirmed before it is inserted into the container number field",
      "Help Center: Receiving and notification topics updated for AI-assisted container capture and the unified alert bell",
    ],
  },
  {
    version: "1.26",
    date: "July 2026",
    changes: [
      "Warehouse Structure: the page frame now stays fixed while only the warehouse tree scrolls, keeping Settings, tabs, search, and Collapse all in view",
      "Warehouse Structure: Reorder Settings now opens from each warehouse action menu, keeping forecasting configuration beside the warehouse hierarchy",
      "Reorder Forecasting: existing demand look-back, safety lead time, alert threshold, and notification controls are preserved in the new popup",
    ],
  },
  {
    version: "1.25",
    date: "July 2026",
    changes: [
      "Cycle Counts: supervisor review now separates over-threshold variances from count exceptions, with required notes before approving, rejecting, accepting, or returning a line to blind entry",
      "Cycle Counts: count numbers now use the CCT sequence format, cancelled counts can be archived, and count lists distinguish review, approved, cancelled, and archived work",
      "Inventory freezes: cycle-count close, cancel, and review paths now preserve freeze relationships and release held stock consistently after count decisions",
      "Dashboard resilience: older databases without dashboard preference tables now load with safe defaults instead of breaking the Command Center",
      "Users & Roles: Developer role assignments now remember the original grantor, and only that developer can remove the Developer role later",
      "Account safety: users can no longer disable their own account; the edit control and database trigger both enforce the guardrail",
    ],
  },
  {
    version: "1.24",
    date: "July 2026",
    changes: [
      "Floor connectivity safety: live put-away, pick, receiving, and cycle-count commits now freeze immediately when a device goes offline instead of replaying stale work later",
      "Task resume: put-away, pick execution, receiving entry, and cycle-count text entry now keep the operator's local position on the device through reconnects",
      "Put-Away: reconnect now refreshes live task, pallet, and location state and can force a safe reselect or task reset when the warehouse record has changed",
      "System Log: critical RF disconnect entries now raise a dismissible red supervisor toast that requires typing ACK before acknowledgement",
      "Offline queue safety: legacy buffered commit items are moved to dead-letter review instead of being auto-posted back into live warehouse state",
    ],
  },
  {
    version: "1.23",
    date: "June 2026",
    changes: [
      "Location Labels: printed and previewed location labels now show only the local rack-bay-level code, while warehouse, zone, aisle, bay, level, type, and temperature remain available as label context",
      "Bin Locations: single-position rack labels omit the unnecessary P1 suffix; P1/P2 remains available only when a bay-level has multiple side-by-side positions",
      "Settings: creation workflows were QA checked in external Chrome with direct typed input rather than clipboard-based browser filling",
    ],
  },
  {
    version: "1.22",
    date: "June 2026",
    changes: [
      "Receiving: New Shipment now follows a scanner-first vertical entry flow from container, to PO, to product, quantities, expiry, and optional lot details",
      "Receiving: container camera scanning can read printed container text, validate ISO 6346 check digits, show a green confirmed candidate, and insert it into the form",
      "Receiving: product scans select the SKU, then focus a highlighted right-arrow commit button before moving to Total received",
      "Receiving: quantity fields preserve manual typing, support Enter-to-advance, and can suggest learned quantity-per-pallet values after prior receipts",
      "Receiving: expiry selection now uses a larger app calendar picker for clearer mobile date entry",
      "Build: switched Vite from the SWC React plugin to @vitejs/plugin-react after the scanner update",
    ],
  },
  {
    version: "1.21",
    date: "June 2026",
    changes: [
      "Pick Execution: whole-pallet picks are enforced so operators confirm the assigned pallet quantity instead of entering partial quantities",
      "Pick Execution: rack instructions now use short four-part location codes with the warehouse context removed from the scanned/displayed location string",
      "Pick Lists: scanner-first create mode lets operators add product lines by scanning products repeatedly before editing quantities, client, order, and release details",
      "Pick Execution: the confirm button flashes yellow after the pallet scan and locks the scan fields until the operator confirms or the backend returns an error",
      "Help Center: added operator what-to-do guidance and a documented gap list for dead ends that still need live exception resolution",
    ],
  },
  {
    version: "1.2.0",
    date: "June 2026",
    changes: [
      "Location Moves: Browse bays button next to the location scanner opens the bay selector (with a warehouse picker when more than one facility is active)",
      "Location Moves: scanned pallet barcodes and location codes are trimmed/normalised before lookup so valid pallets are no longer reported as missing",
      "Warehouse Structure tool: dedicated Settings tab and Help topic explaining the live tree view of warehouses, zones, aisles, bays, and locations",
      "Help Center: per-module topics refreshed to cover browse-bay flows, label sheets, badge sign-in, access controls, and the Warehouse Structure tool",
      "Promoted from 1.1.8 beta: shortened bay codes open the bay selector in Put-Away and Pick; Bin Locations column order; Avery 99x38 location label sheets; Avery 99x93 bay/zone aisle sheets; trusted-device badge PIN limited to mobile/tablet; public Request Access removed in favour of admin-managed accounts",
    ],
  },
  {
    version: "1.1.7",
    date: "May 2026",
    changes: [
      "Labels: pallet/location/zone/warehouse codes print as QR for faster, more reliable scans",
      "Inventory Search: horizontal and vertical scrolling restored so every column is reachable",
      "Products: total on-hand quantity shown beside each product name (read-only)",
      "Navigation: desktop sidebar only mounts in landscape; portrait/tablets use the top slide-in nav. Help is always the last item",
      "Sidebar: squishy press feedback on nav buttons and tighter responsive width before the scrollbar kicks in",
      "Bin Locations: Edit Location now saves notes and max-height correctly (field-name mismatch fixed)",
      "Bin Locations & Zones: bulk label sheets — filter the table, then Print labels sheet (paper size, grid presets, start cell)",
      "Access requests: admins, supervisors, and managers see a full-screen prompt when pending users are awaiting approval, with a one-click jump to Users & Roles",
    ],
  },
  {
    version: "1.1.3",
    date: "May 2026",
    changes: [
      "Command Center: all Floor, Dock, and Office tiles are draggable and resizable",
      "Command Center: summary metrics and workflow tiles now share one dynamic layout surface per view",
      "Command Center: tile size and position preferences are remembered per signed-in user when available",
      "Navigation: Users shortcut removed from the sidebar while admin user management remains in Settings",
      "Dashboard: pallet dials, workflow queues, Warehouse Intelligence, Dock lanes, Office widgets, and Warehouse Brain use the same tile controls",
    ],
  },
  {
    version: "1.1.2",
    date: "May 2026",
    changes: [
      "Inventory Search: fixed header and filter shell with row-only result scrolling",
      "Inventory Search: warehouse scope matching now includes live warehouse, zone, aisle, and location codes",
      "Locations: generated and migrated codes now preserve warehouse, zone, and location hierarchy",
      "Location Labels: full hierarchy codes with QR output for complex location codes",
      "Put-Away: clearer location confirmation fields and aligned desktop task confirmation",
      "Tables: editable and detail rows now require double-click or double-tap before opening",
    ],
  },
  {
    version: "1.1.1",
    date: "May 2026",
    changes: [
      "Inventory Search: barcode-aware searching and warehouse scope filtering",
      "Put-Away: pallet confirmation, draft return prompts, and saved draft guidance",
      "Pick Lists: searchable pick list contents with scan support",
      "Inventory Detail: pallet barcode and full-page pallet label preview",
      "Mobile: configurable bottom toolbar and responsive table scrolling",
    ],
  },
  {
    version: "1.1.0",
    date: "May 2026",
    changes: [
      "Inline row editing with double-click and table action buttons",
      "Sticky table headers and horizontal overflow scrolling",
      "Back buttons on Inventory Detail and Pick Execution pages",
      "Settings About tab with version history and feature register",
    ],
  },
  {
    version: "1.0.0",
    date: "May 2026",
    changes: [
      "Warehouse, zone, location, client, product, and packaging master data",
      "Receiving, directed putaway, inventory search, pick lists, and transfers",
      "Dashboard, reporting, role-based access, barcode labels, and audit trail",
    ],
  },
];
