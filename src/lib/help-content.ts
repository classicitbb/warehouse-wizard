export type HelpSection = {
  title: string;
  content: string[];
};

export type SetupWizardStepDetail = {
  number: number;
  title: string;
  summary: string;
  details: string[];
};

export const setupWizardSteps: SetupWizardStepDetail[] = [
  {
    number: 1,
    title: "Define facilities",
    summary: "Create the warehouses the system will manage.",
    details: [
      "Enter a short uppercase code (for example WH1, WH2) that operators will see on labels and pick lists.",
      "Add the warehouse name, city, and country so reports and audit trails identify the facility correctly.",
      "Mark whether the facility has a cool zone so the wizard pre-creates a temperature-controlled zone in step 2.",
    ],
  },
  {
    number: 2,
    title: "Define zones inside each facility",
    summary: "Group locations by purpose and temperature class.",
    details: [
      "Create zones such as Receiving, Put-Away, Picking, Cool, Quarantine, or Bulk for each warehouse.",
      "Set the temperature class (ambient, cool, frozen) so directed put-away can match products to compatible zones.",
      "Mark zones that should not accept normal stock (for example Quarantine or Damaged) so suggestions skip them.",
    ],
  },
  {
    number: 3,
    title: "Generate bin locations for each zone",
    summary: "Decide how aisles, bays, levels, and depth positions are produced.",
    details: [
      "Pick the aisle count, bays per aisle, levels per bay, and depth (1\u20135) that match the physical racking.",
      "Confirm the location code pattern so labels match what is printed on the racks. Rack location scan strings use rack, bay, level, and position while warehouse and aisle remain structured context.",
      "Set capacity defaults (max weight, stack height) so the slot suggester respects the rack rating.",
    ],
  },
  {
    number: 4,
    title: "Review the final structure",
    summary: "Inspect the totals before anything is written to the database.",
    details: [
      "Verify warehouse, zone, location-template, and total-location counts in the review summary.",
      "Go back to any earlier step to fix mistakes \u2014 nothing is created until step 5 is run.",
      "On a brand-new tenant the wizard starts blank \u2014 every field is yours to fill in. When an existing warehouse is detected, current data is preloaded for review or extension.",
    ],
  },
  {
    number: 5,
    title: "Create the structure",
    summary: "Run the setup to create exactly the warehouses, zones, and bin locations you defined.",
    details: [
      "The wizard creates warehouses, zones, and every location row in a single transaction.",
      "Demo operational data (products, pallets, receipts, etc.) is no longer seeded by default \u2014 developers can opt in from the final step.",
      "On success the app navigates to Warehouses; you can re-run the wizard after a Reset All if the environment ever needs to be rebuilt.",
    ],
  },
];

export type HelpReference = {
  label: string;
  url: string;
  reason: string;
};

export type HelpArticle = {
  id: string;
  title: string;
  module: string;
  audience: string;
  keywords: string[];
  sections: HelpSection[];
  acronyms?: Record<string, string>;
  references?: HelpReference[];
};

export type RouteHelpDefinition = {
  id: string;
  title: string;
  summary: string;
  keyActions: string[];
  commonMistakes: string[];
  permissions: string;
  wikiArticleIds: string[];
};

const routeHelpDefinitions: Record<string, RouteHelpDefinition> = {
  dashboard: {
    id: "dashboard",
    title: "Dashboard",
    summary: "Use the dashboard to monitor inbound, storage, and outbound activity at a glance.",
    keyActions: ["Review pallet counts and open work", "Spot hold/quarantine stock", "Watch occupancy trends"],
    commonMistakes: ["Using dashboard totals as a substitute for task execution detail", "Ignoring hold/quarantine trends before releasing work"],
    permissions: "Visible to admins, managers, clerks, and operators.",
    wikiArticleIds: ["enterprise-dashboard-modes", "warehouse-brain", "lean-standard-work", "reporting-basics"],
  },
  warehouses: {
    id: "warehouses",
    title: "Warehouses",
    summary: "Warehouses define the top-level facilities used by all stock, users, and operational flows.",
    keyActions: ["Create active facilities", "Mark facilities inactive instead of deleting them", "Review cool-zone capability before setup"],
    commonMistakes: ["Creating duplicate warehouse codes", "Hiding a warehouse before moving dependent records"],
    permissions: "Managed by admins and warehouse managers.",
    wikiArticleIds: ["warehouse-setup", "settings-reset"],
  },
  clients: {
    id: "clients",
    title: "Clients",
    summary: "Clients identify stock ownership, receiving rules, and 3PL operating controls.",
    keyActions: ["Create active client owners", "Review mixed-stock permissions", "Keep inactive clients visible for history"],
    commonMistakes: ["Receiving stock under the wrong owner", "Deleting client context needed for historical receipts"],
    permissions: "Managed by admins and warehouse managers.",
    wikiArticleIds: ["client-ownership", "product-mastery", "receiving-flow"],
  },
  zones: {
    id: "zones",
    title: "Zones",
    summary: "Zones define logical storage and workflow areas such as staging, dispatch, quarantine, and cool storage.",
    keyActions: ["Create temperature-aligned zones", "Mark staging/dispatch/quarantine flags correctly", "Hide obsolete zones instead of deleting them"],
    commonMistakes: ["Mixing dispatch and staging rules in one zone", "Using the wrong temperature class for cool-chain stock"],
    permissions: "Managed by admins and warehouse managers.",
    wikiArticleIds: ["zone-design", "warehouse-setup"],
  },
  locations: {
    id: "locations",
    title: "Bin Locations",
    summary: "Bin Locations are the physical slots used for directed put-away, picking, counting, and occupancy reporting.",
    keyActions: ["Generate rack/staging/quarantine locations", "Print beam labels and bay-code labels", "Set sequencing and capacity rules", "Hide retired locations rather than removing history"],
    commonMistakes: ["Assigning inactive locations to live work", "Changing a physical code without reprinting the rack label", "Using mixed-SKU settings that conflict with product handling rules"],
    permissions: "Managed by admins and warehouse managers.",
    wikiArticleIds: ["location-generation", "warehouse-setup"],
  },
  products: {
    id: "products",
    title: "Products",
    summary: "Products define SKU identity, ownership, rotation rules, and handling requirements.",
    keyActions: ["Create active SKUs", "Set tracking flags correctly", "Hide discontinued products instead of deleting them"],
    commonMistakes: ["Using the wrong rotation method", "Leaving temperature requirements inconsistent with storage zones"],
    permissions: "Managed by admins, managers, and inventory clerks.",
    wikiArticleIds: ["product-mastery", "receiving-flow"],
  },
  "packaging-profiles": {
    id: "packaging-profiles",
    title: "Packaging Profiles",
    summary: "Packaging profiles define each/case/pallet pack sizes, dimensions, and default receiving behavior.",
    keyActions: ["Create default pack profiles", "Align barcodes to physical packaging", "Hide obsolete profiles without losing audit history"],
    commonMistakes: ["Creating multiple defaults for one product", "Using wrong units-per-package during receiving"],
    permissions: "Managed by admins, managers, and inventory clerks.",
    wikiArticleIds: ["packaging-profiles", "receiving-flow"],
  },
  receiving: {
    id: "receiving",
    title: "Receiving",
    summary: "Receiving creates shipment drafts, pallet identity, lot context, and the downstream put-away workload while freezing live posts during disconnects.",
    keyActions: [
      "Start with container and PO, then scan or search product lines",
      "Use the container camera scanner to OCR printed ISO 6346 numbers and confirm the green candidate before insertion",
      "Hold the container face in frame if on-device reading fails — AI-assisted capture takes over automatically and still asks you to confirm",
      "Commit the selected product with the right-arrow button before entering quantities",
      "Enter total, quantity per pallet, pallet count, and expiry in sequence",
      "Reconnect and refresh live state before any save or receive after signal loss",
      "Print draft labels or send selected pallets to put-away",
    ],
    commonMistakes: [
      "Inserting a container number before the scanner shows a valid green ISO 6346 candidate",
      "Skipping the product commit arrow after scanning or selecting a SKU",
      "Letting learned quantity suggestions replace the physical count instead of confirming the pallet quantity",
      "Trying to save or receive while the device is offline instead of reconnecting first",
      "Receiving cool-chain items without proper profile or zone setup",
    ],
    permissions: "Used by admins, managers, and inventory clerks.",
    wikiArticleIds: ["receiving-flow", "label-printing"],
  },
  putaway: {
    id: "putaway",
    title: "Put-Away",
    summary: "Put-Away confirms pallet and location scans before stock becomes stored and available, and it re-validates live state after reconnects.",
    keyActions: ["Scan pallet", "Scan a full location or shortened bay code", "Select an available bay cell when prompted", "Reconnect and review live task/location state before confirming again after signal loss", "Complete directed put-away with audit logging"],
    commonMistakes: ["Scanning the wrong location", "Treating a bay code as a final location", "Trusting a pre-disconnect location without the reconnect recheck", "Trying to store cool stock in ambient locations"],
    permissions: "Used by admins, managers, clerks, and operators.",
    wikiArticleIds: ["putaway-flow", "location-generation"],
  },
  inventory: {
    id: "inventory",
    title: "Inventory Search",
    summary: "Inventory search shows pallet, lot, zone, and warehouse state for live stock decisions.",
    keyActions: ["Search by SKU, pallet, lot, or location", "Open detailed pallet movement history", "Validate stock before picks or transfers"],
    commonMistakes: ["Ignoring status filters", "Using stale assumptions instead of the live record"],
    permissions: "Used by all operational roles except hidden/pending users.",
    wikiArticleIds: ["inventory-search", "status-controls"],
  },
  "pick-lists": {
    id: "pick-lists",
    title: "Pick Lists",
    summary: "Pick lists release outbound work and group the whole-pallet pick tasks operators must execute.",
    keyActions: ["Release lists", "Review shortages", "Open execution detail for assigned work", "Use bay/location scans to visually confirm the pallet location"],
    commonMistakes: ["Releasing work before stock is available", "Treating order demand as permission to split a pallet", "Confirming the wrong rack cell after a bay scan"],
    permissions: "Managed by admins, managers, and operators.",
    wikiArticleIds: ["pick-flow", "operational-dead-ends", "inventory-search"],
  },
  transfers: {
    id: "transfers",
    title: "Transfers",
    summary: "Transfers preserve pallet identity and audit history while stock moves between facilities.",
    keyActions: ["Create transfer", "Dispatch", "Receive into destination and trigger put-away"],
    commonMistakes: ["Dispatching the wrong pallet", "Receiving stock before destination structure is ready"],
    permissions: "Used by admins, managers, clerks, and dispatch drivers for handoff visibility.",
    wikiArticleIds: ["transfer-flow"],
  },
  "location-moves": {
    id: "location-moves",
    title: "Location Moves",
    summary: "Location moves relocate stored pallets inside a warehouse while preserving pallet identity and audit history.",
    keyActions: [
      "Scan or enter the pallet barcode",
      "Scan, type, or Browse bays to pick the destination location",
      "Confirm the destination and complete the scan-confirmed move",
      "Cancel queued or in-progress moves from the task list when plans change",
    ],
    commonMistakes: [
      "Moving stock to a disabled, full, or temperature-incompatible location",
      "Using transfers when the pallet is staying in the same warehouse",
      "Confirming a bay code as a final location instead of selecting an exact bin from the bay grid",
    ],
    permissions: "Used by admins, managers, inventory clerks, and operators.",
    wikiArticleIds: ["location-move-flow", "warehouse-structure-tool", "inventory-search", "location-generation"],
  },
  "cycle-counts": {
    id: "cycle-counts",
    title: "Cycle Counts",
    summary: "Cycle counts generate count work and record variances against expected stock, with local entry preserved while live posts are frozen offline.",
    keyActions: ["Generate count sheets", "Submit counted quantities", "Reconnect and refresh live state before submit or approval after signal loss", "Investigate exceptions"],
    commonMistakes: ["Counting from memory instead of live location verification", "Ignoring variance thresholds", "Posting a count after reconnect without reloading the live assignment state"],
    permissions: "Used by admins, managers, clerks, and operators.",
    wikiArticleIds: ["cycle-counts"],
  },
  status: {
    id: "status",
    title: "Statuses",
    summary: "Status controls move stock into hold, quarantine, damaged, missing, or available with audit reasons.",
    keyActions: ["Apply controlled statuses", "Record a reason", "Review controlled stock"],
    commonMistakes: ["Changing status without reason detail", "Forgetting that controlled stock still affects decisions"],
    permissions: "Used by admins, managers, and inventory clerks.",
    wikiArticleIds: ["status-controls", "operational-dead-ends"],
  },
  reports: {
    id: "reports",
    title: "Reports",
    summary: "Reports give operational snapshots across stock, occupancy, counts, and recent audit events.",
    keyActions: ["Review stock by warehouse", "Check occupancy", "Monitor recent movements"],
    commonMistakes: ["Treating snapshots as substitutes for transactional detail", "Ignoring audit trends"],
    permissions: "Visible to admins, managers, and clerks.",
    wikiArticleIds: ["reporting-basics", "warehouse-brain", "enterprise-dashboard-modes"],
  },
  users: {
    id: "users",
    title: "Users & Roles",
    summary: "User management assigns role-based access, badge credentials, and non-destructive access removal.",
    keyActions: ["Add users as Admin or Dev", "Assign roles", "Issue badge codes and PINs", "Hide or restore role assignments", "Enable or disable profiles without deleting audit history"],
    commonMistakes: ["Removing the wrong role assignment", "Disabling a profile before reassigning operational work"],
    permissions: "Managed by admins.",
    wikiArticleIds: ["user-management"],
  },
  "system-log": {
    id: "system-log",
    title: "System Log",
    summary: "System logs record operational issues, admin notes, snapshots, RF disconnect alerts, and resolution status.",
    keyActions: ["Review recent log entries", "Acknowledge critical RF disconnect alerts with the typed challenge", "Resolve addressed issues", "Capture record-count snapshots"],
    commonMistakes: ["Resolving a log before the underlying issue is fixed", "Acknowledging a disconnect alert without verifying floor recovery", "Using logs as a substitute for transactional audit history"],
    permissions: "Visible to admins and warehouse managers.",
    wikiArticleIds: ["system-log-operations", "reporting-basics"],
  },
  "email-log": {
    id: "email-log",
    title: "Email Log",
    summary: "Email logs show outbound message attempts, delivery status, and failure details for support.",
    keyActions: ["Review failed messages", "Check recipient and template", "Escalate repeated delivery failures"],
    commonMistakes: ["Retrying without checking the error message", "Assuming an invitation was received without confirming delivery status"],
    permissions: "Visible to admins.",
    wikiArticleIds: ["email-log-operations", "user-management"],
  },
  settings: {
    id: "settings",
    title: "Settings",
    summary: "Settings houses environment guidance, the Warehouse Structure tool, user management, the setup wizard, and reset controls.",
    keyActions: [
      "Manage users, roles, badges, PINs, and the Role Matrix in the Users & Roles tab",
      "Open the Warehouse Structure tab for a live tree view of warehouses, zones, aisles, bays, and locations",
      "Launch the warehouse setup wizard or rebuild after a Reset All",
      "Run Reset All with the typed challenge when the environment must be rebuilt",
    ],
    commonMistakes: [
      "Running reset without understanding that warehouse/setup data will be rebuilt",
      "Skipping the wizard after reset",
      "Editing structure without re-printing physical rack/zone labels to match",
    ],
    permissions: "Visible to admins and warehouse managers. Reset is admin-only.",
    wikiArticleIds: ["settings-reset", "warehouse-setup", "warehouse-structure-tool", "user-management", "netsuite-integration", "label-printing"],
  },
  help: {
    id: "help",
    title: "Help Center",
    summary: "The Help Center is the searchable wiki for operators, supervisors, and administrators.",
    keyActions: ["Search articles", "Open module-specific guides", "Use linked context from the help sidebar"],
    commonMistakes: ["Searching too narrowly by exact title only", "Using an outdated process instead of the in-app wiki"],
    permissions: "Visible to all approved users.",
    wikiArticleIds: ["help-center", "operational-dead-ends", "warehouse-setup", "receiving-flow"],
  },
  "setup-wizard": {
    id: "setup-wizard",
    title: "Warehouse Setup Wizard",
    summary: "The wizard builds warehouse structure from blank forms; demo operational data is opt-in for developers only.",
    keyActions: ["Define warehouses", "Define zones", "Generate bin locations", "Review and create structure"],
    commonMistakes: ["Leaving warehouse codes inconsistent across steps", "Choosing location rules that do not match the actual zone purpose"],
    permissions: "Visible to admins and warehouse managers. Execution uses admin reset/setup controls.",
    wikiArticleIds: ["warehouse-setup", "settings-reset"],
  },
};

export const helpArticles: HelpArticle[] = [
  {
    id: "help-center",
    title: "Using the Help Center",
    module: "help",
    audience: "All operators",
    keywords: ["help", "wiki", "search", "articles", "documentation"],
    sections: [
      { title: "Overview", content: ["The Help Center is the searchable documentation hub for the warehouse system.", "Use the sidebar on any page for quick context, then open the full wiki when you need deeper instructions."] },
      { title: "Search Tips", content: ["Search by module name, workflow name, or operational term such as receiving, transfer, cycle count, or quarantine.", "Results match titles, keywords, and article content."] },
    ],
  },
  {
    id: "warehouse-setup",
    title: "Warehouse Setup Wizard",
    module: "setup-wizard",
    audience: "Admins and warehouse managers",
    keywords: ["wizard", "setup", "warehouse", "zones", "bin locations", "seed"],
    sections: [
      { title: "When to Use It", content: ["Use the wizard during a new implementation or after a full environment reset.", "On a fresh tenant every form starts blank \u2014 the wizard never invents warehouses, zones, or locations.", "When an existing warehouse environment is detected, current structure is preloaded so new facilities or storage areas can be layered in for review."] },
      { title: "Step Sequence", content: ["Step 1 defines facilities.", "Step 2 defines zones inside each facility.", "Step 3 defines how locations are generated for each zone.", "Step 4 reviews the final structure.", "Step 5 creates the structure (demo operational data is opt-in for developers)."] },
    ],
  },
  {
    id: "settings-reset",
    title: "Reset All and Rebuild",
    module: "settings",
    audience: "Admins",
    keywords: ["reset", "settings", "rebuild", "seed", "wipe", "start over"],
    sections: [
      { title: "What Reset Does", content: ["Reset All clears warehouse setup and operational data while preserving users, approvals, and role assignments.", "Warehouse-scoped references are cleared so the environment can be rebuilt safely."] },
      { title: "After Reset", content: ["The next step is to launch the setup wizard and rebuild the warehouse structure.", "Starter operational data can be seeded automatically so the system is usable immediately."] },
    ],
  },
  {
    id: "user-management",
    title: "Users, Roles, Badges, and Access Removal",
    module: "users",
    audience: "Admins",
    keywords: ["users", "roles", "remove access", "disable profile", "restore", "badge", "user code", "activity"],
    sections: [
      { title: "Admin Control Model", content: ["Users are not self-authorizing. Public Request Access is disabled; Admin and Dev users create accounts, approve profiles, assign roles, issue short user codes, and may issue scannable badge codes for warehouse tablets.", "The user code is shorter than an email address because operators wearing gloves or working at a dock need fewer keystrokes. Passwords are still required so a lost badge is not enough to sign in."] },
      { title: "Trusted Badge Sign-In", content: ["Badge sign-in is a shortcut only after a user has completed a normal password login on that mobile or tablet device. It is disabled on desktop and expires after 30 days.", "The server checks the active user, badge/PIN hash, trusted device ID, active trust record, expiry, client IP, and non-desktop client before creating a session. Failed checks fall back to normal sign-in without revealing which check failed."] },
      { title: "Role Assignment", content: ["Assign the smallest role that lets the person complete their standard work. Operators see execution queues; clerks see receiving, counts, product data, and inventory; drivers see transfer handoff; admins keep full access.", "Role assignments should be hidden or restored, not deleted outright, so access history is preserved."] },
      { title: "Profile Control", content: ["Disable a profile when the person should not sign in. Hide a role assignment when the person remains active but should lose one area of access.", "Every profile or role change is written to activities so supervisors can answer who changed access, when, and why."] },
    ],
    acronyms: {
      SSO: "Single sign-on. Badge/code login behaves like SSO for the floor but remains built into the WMS.",
      WMS: "Warehouse management system.",
    },
  },
  {
    id: "client-ownership",
    title: "Client Ownership and 3PL Rules",
    module: "clients",
    audience: "Admins and warehouse managers",
    keywords: ["clients", "3pl", "owner", "mixed stock", "ownership", "receiving rules"],
    sections: [
      { title: "Purpose", content: ["Client records identify who owns the stock and which handling rules apply during receiving, storage, picking, and reporting.", "Keep client codes short and stable because they appear in searches, labels, exports, and audit trails."] },
      { title: "Controls", content: ["Mixed-stock and expiry requirements should match the commercial operating agreement.", "Deactivate obsolete clients instead of deleting them so historical receipts, pallets, and reports still explain who owned the goods."] },
    ],
    acronyms: {
      "3PL": "Third-party logistics provider.",
      SLA: "Service-level agreement.",
    },
  },
  {
    id: "receiving-flow",
    title: "Receiving Workflow",
    module: "receiving",
    audience: "Clerks and supervisors",
    keywords: ["receiving", "receipt", "pallet", "lot", "expiry", "put-away", "ocr", "container scanner", "iso 6346", "commit arrow", "quantity suggestion", "calendar"],
    sections: [
      { title: "Core Flow", content: ["Receiving creates shipment drafts, lot context, pallet identity, and the downstream put-away task.", "The New Shipment form is ordered for scanner work: warehouse context, container number, PO number, product, quantities, expiry, then optional lot, batch, and packaging details."] },
      { title: "Container Scanner", content: ["Use Scan container number when the printed container number is visible. The camera reads text, assembles the best ISO 6346 candidate, checks the check digit, and turns the candidate green only when it is valid.", "Confirm the green candidate to insert it. After insertion, focus moves to PO number so the operator can continue the receiving flow without touching the warehouse selector."] },
      { title: "AI-Assisted Container Capture", content: ["When on-device text recognition cannot read the container face after a couple of passes, the scanner sends a single photo of the current frame for AI reading and shows Reading container with AI.", "Frame the whole container face square-on, with the painted number inside the guide and as little glare as possible. Dirty, angled, or low-contrast doors are exactly what this pass is for.", "Any number the AI returns is re-checked against the ISO 6346 check digit on the server, so an unreadable or invented code is rejected and never offered.", "Nothing is written automatically: the code appears as a green candidate and only enters the container field when you press Use.", "If the device is offline or the AI is unavailable, the scanner keeps doing on-device reading and manual entry stays available."] },
      { title: "Product Commit Step", content: ["Scan product or search by SKU/name to select the product. Selection alone does not move into quantities.", "After a product is selected, the right-arrow commit button is highlighted and focused. Confirm it to lock the chosen product for that line and move to Total received."] },
      { title: "Quantity and Expiry Entry", content: ["Quantity fields allow blank and partial typing, so multi-digit numbers should be typed normally and committed with Enter.", "Total received Enter recalculates pallet count and moves to Qty per pallet. Qty per pallet Enter recalculates pallet count and moves to Pallets. Pallets Enter opens the expiry calendar.", "When the product has prior receiving observations, Qty per pallet may be suggested from learned history. Treat it as a time saver, not a substitute for the physical count."] },
      { title: "Connectivity Safety", content: ["If the device goes offline, keep typing or scanning locally but do not expect Save, Save & Receive, or Print & Receive to post. Live receiving commits are frozen until the connection returns.", "After reconnect, refresh live state, review the draft list and current shipment form, then save or receive again from the live screen."] },
      { title: "Critical Checks", content: ["Confirm warehouse, container, PO, product, quantity, pallet count, and lot/expiry values before saving or receiving.", "Cool-chain items must align with cool-zone storage, and products that require expiry tracking should use the calendar picker before labels are printed."] },
    ],
  },
  {
    id: "putaway-flow",
    title: "Directed Put-Away",
    module: "putaway",
    audience: "Operators and supervisors",
    keywords: ["put-away", "scan", "location", "temperature", "store"],
    sections: [
      { title: "How It Works", content: ["Put-Away is complete only after the pallet barcode and location barcode are both confirmed.", "A full location code fills the confirmation field directly. A shortened bay code opens the bay selector so the operator can tap the exact available slot.", "Successful confirmation moves stock into stored and available status."] },
      { title: "Reconnect Safety", content: ["If signal drops, the current task position stays on the device, but the confirmation itself is frozen until connectivity returns.", "When the device reconnects, the screen refreshes live task, pallet, and location state. Be ready to reselect a location or restart the task if the live warehouse record no longer matches what was on screen before the disconnect."] },
      { title: "Common Exceptions", content: ["A location that is inactive, full, or temperature-incompatible will block the move.", "Scan mismatches should be corrected before retrying."] },
    ],
  },
  {
    id: "inventory-search",
    title: "Inventory Search and Detail",
    module: "inventory",
    audience: "All operations users",
    keywords: ["inventory", "search", "detail", "pallet", "lot", "history"],
    sections: [
      { title: "Search Usage", content: ["Search inventory to locate stock by SKU, pallet, lot, warehouse, or location.", "Open the detail page to inspect quantity, status, lot context, and recent movements."] },
    ],
  },
  {
    id: "pick-flow",
    title: "Pick Lists and Execution",
    module: "pick-lists",
    audience: "Managers and operators",
    keywords: ["pick", "pick list", "execution", "short", "outbound", "whole pallet", "partial pick", "bay code"],
    sections: [
      { title: "Release to Execution", content: ["Managers create pick lists and the system generates tasks from available palletized inventory.", "For now, pick tasks are whole-pallet tasks. If demand is 50 and the available pallet has 100, the task is created for 100 because partial picks are disabled."] },
      { title: "Location and Pallet Scans", content: ["Pick Execution tells the operator where to go using rack, aisle, bay, level, and the short rack position code.", "Scanning a bay code opens the bay grid and highlights the assigned location. Scanning the exact location code fills the field directly.", "After the pallet barcode is scanned, the Confirm pick button flashes yellow. Confirm the task before doing anything else on that pick."] },
      { title: "Connectivity Safety", content: ["If the device goes offline mid-pick, keep the scanned fields on the device but do not force the confirmation. Live pick commits are frozen until reconnect.", "After signal returns, refresh the live pick state and confirm again from the current task instead of trusting the pre-disconnect screen."] },
      { title: "Shorts and Exceptions", content: ["If the pallet is missing, damaged, inaccessible, or does not physically match the system quantity, stop the pick and notify a supervisor instead of forcing the confirmation.", "Use Inventory Search and Status Controls to inspect or restrict the pallet. Use System Log for support-visible notes when the issue needs follow-up.", "A dedicated Pick Exception Resolver is planned so a supervisor can choose hold, damage, waste, defect, or escalation directly from the pick task."] },
    ],
  },
  {
    id: "operational-dead-ends",
    title: "What to Do If Warehouse Work Gets Stuck",
    module: "help",
    audience: "Operators, supervisors, and managers",
    keywords: [
      "what to do if",
      "dead end",
      "stuck",
      "blocked",
      "short pick",
      "partial pick",
      "damage",
      "waste",
      "defect",
      "hold",
      "scanner",
      "wrong location",
      "missing pallet",
      "quantity mismatch",
      "exception",
    ],
    sections: [
      {
        title: "Operator Rule",
        content: [
          "If the system blocks a workflow, do not work around the scan or type a value just to move forward. Stop, keep the stock where it is, and verify the physical pallet, location label, selected warehouse, and task number.",
          "If the stock is damaged, opened, leaking, wet, expired, missing, inaccessible, or not in the expected quantity, notify a supervisor before the pallet is moved into the next step.",
        ],
      },
      {
        title: "If a Pallet Barcode Does Not Scan",
        content: [
          "Try the printed text under the QR/barcode, then search Inventory by pallet code or product. If the pallet record is found, reprint the pallet label before continuing.",
          "If no record is found, do not receive, move, pick, or ship it under a guessed code. Treat it as an unidentified pallet and ask a supervisor to investigate Receiving, Inventory Search, and System Log.",
        ],
      },
      {
        title: "If a Bay or Location Code Does Not Scan",
        content: [
          "Type the visible short code exactly as printed, then use Browse bays or the bay selector when available. Reprint the location or bay label if the printed code is damaged or stale.",
          "If the code does not exist in the selected warehouse, confirm the warehouse selector first. The warehouse is part of the working context even though it is no longer stored in normal rack location scan strings.",
        ],
      },
      {
        title: "If the Pallet Is Not Where the Task Says",
        content: [
          "Search Inventory by pallet barcode and check the last known location and movement history. For an eligible same-SKU, same-quantity pallet in the current warehouse, scan it through Pick Execution, review the source reassignment, then explicitly override and confirm the pick.",
          "If the pallet is physically found somewhere else, use Location Moves or Status Controls as appropriate before returning to pick execution.",
        ],
      },
      {
        title: "If the Quantity on the Pallet Looks Wrong",
        content: [
          "Whole-pallet picks must be confirmed for the full assigned pallet quantity. If the system expects 100 but only 80 or 90 are physically present, do not confirm the normal pick.",
          "Current system action: stop the pick, search the pallet in Inventory, place it on hold or another controlled status when authorized, and record a System Log note for follow-up.",
          "Planned gap closure: Pick Execution should offer hold, debit as damage, debit as waste, debit as defect, or escalate without debit, then write the stock adjustment, audit event, and system log automatically.",
        ],
      },
      {
        title: "If Stock Is Damaged, Expired, Wet, Opened, or Contaminated",
        content: [
          "Move the pallet only if it is safe and authorized. Otherwise leave it secured, mark it visually on the floor, and call a supervisor.",
          "Use Status Controls to put the pallet on hold, quarantine, damaged, or missing with a reason. Use System Log when the issue needs support, quality, customer, or manager follow-up.",
        ],
      },
      {
        title: "If a Location Is Physically Full or Blocked",
        content: [
          "Do not put away, move, or pick into a blocked cell just because the system shows capacity. Use the bay selector to choose an available cell when the workflow supports it.",
          "If the system and floor disagree, stop and have a supervisor use Inventory Search, Location Moves, or Cycle Counts to correct the location state before more work is released there.",
        ],
      },
      {
        title: "If the Product Barcode Is Unknown",
        content: [
          "Search by SKU, product name, alternate label text, or pallet. If the product still cannot be identified, do not add it to a pick list or receive it against a guessed SKU.",
          "Ask a clerk or manager to correct the product master data, barcode, packaging profile, or client ownership before releasing warehouse work.",
        ],
      },
      {
        title: "If the Scanner, Camera, or Network Fails",
        content: [
          "Use direct typing when the scanner cannot read a code. Normal text entry should always work without clipboard access.",
          "If the network blocks posting, keep the pallet in its current physical state and treat the device as frozen for live commits until signal returns.",
          "After reconnect, refresh live state, verify the task again, and then post once. Do not repeat the physical move under a second task number or trust a stale pre-disconnect screen.",
        ],
      },
      {
        title: "Current System Design To-Do for Operators",
        content: [
          "Use scan-confirmed workflows for normal Receiving, Put-Away, Location Moves, Pick Execution, Transfers, Status Controls, and Cycle Counts.",
          "When the physical floor disagrees with the system, stop the transaction, verify in Inventory Search, apply a controlled status when authorized, and use System Log for the exception narrative.",
          "For whole-pallet picking, do not enter or confirm a smaller picked quantity in the normal pick flow. Treat the issue as an exception until a supervisor resolves the inventory state.",
        ],
      },
      {
        title: "System Flow Gaps To Resolve",
        content: [
          "Pick Execution needs a dedicated exception resolver for short whole-pallet picks, with actions for hold, damage, waste, defect, and supervisor escalation.",
          "The resolver should create stock adjustments, update pallet and inventory quantities/statuses, write audit events, write System Log entries, and leave the pick task in a clear exception state.",
          "The UI should anticipate this before the operator is trapped: when a scanned pallet cannot be confirmed as the full expected quantity, show the exception choices instead of only rejecting the partial quantity.",
        ],
      },
    ],
  },
  {
    id: "transfer-flow",
    title: "Warehouse Transfers",
    module: "transfers",
    audience: "Managers, clerks, and dispatch staff",
    keywords: ["transfer", "dispatch", "receive", "inter-warehouse", "intra-warehouse", "in transit", "driver signoff"],
    sections: [
      { title: "Transfer Stages", content: ["Transfers move a pallet from source warehouse, to in-transit, then to receiving at the destination. The source record, destination record, pallet identity, and lot identity stay connected.", "Destination receipt should be followed by directed put-away so inventory does not sit invisible in a receiving lane."] },
      { title: "Driver Departure Sign-Off", content: ["Before dispatch, the driver scans their badge or enters their user code. This creates a signed handoff that stock has physically departed.", "This control prevents the waste loop where the system says a pallet is in transit while the pallet is still in staging, loaded on the wrong vehicle, or awaiting paperwork."] },
      { title: "Lean Reasoning", content: ["Treat transfer departure as a quality gate: scan pallet, validate route, sign off driver, then move to in-transit. The extra seconds prevent motion, waiting, searching, and correction work later.", "If a transfer is blocked, stop the flow visibly instead of dispatching a bad load. That is an Andon-style escalation while the problem is still cheap to fix."] },
    ],
    acronyms: {
      FEFO: "First Expired, First Out.",
      FIFO: "First In, First Out.",
      Andon: "A lean visual control that signals a problem and prompts rapid response.",
    },
  },
  {
    id: "location-move-flow",
    title: "Location Moves",
    module: "location-moves",
    audience: "Operators and supervisors",
    keywords: ["location move", "move task", "relocate", "pallet move", "same warehouse", "scan"],
    sections: [
      { title: "When to Use It", content: ["Use Location Moves when a pallet stays in the same warehouse but needs a new bin, staging area, or picking area.", "Use Transfers only when the stock changes warehouse or requires dispatch/receiving handoff."] },
      { title: "Scan Control", content: ["The pallet barcode confirms identity and the destination location confirms where the stock physically moved.", "If the location is blocked, disabled, full, or physically wrong, stop and correct the destination before posting the move."] },
    ],
  },
  {
    id: "cycle-counts",
    title: "Cycle Counts",
    module: "cycle-counts",
    audience: "Clerks, operators, and supervisors",
    keywords: ["cycle count", "variance", "count sheet", "stock check"],
    sections: [
      { title: "Counting Rules", content: ["Cycle counts can target a location, zone, SKU, or spot check. High-value, high-risk, and high-velocity stock should be counted more often than slow, stable stock.", "Entered quantities update stock and create adjustment records when variances exist. Variance is evidence of a broken handoff somewhere in receiving, put-away, picking, transfer, or status control."] },
      { title: "Connectivity Safety", content: ["If signal drops during blind entry or supervisor review, keep the typed quantities and reasons on the device but do not submit, approve, reject, or close counts offline.", "After reconnect, refresh live cycle-count state first, then submit or approve from the current assignment so the post uses the latest freeze and variance status."] },
      { title: "Six Sigma View", content: ["DPMO is a defect-per-million-opportunities signal. In WMS terms, a defect can be a wrong location, wrong quantity, missing pallet, or wrong status.", "Use DMAIC thinking: define the defect, measure where it happens, analyze the cause, improve the process, and control it with scans, roles, labels, and standard work."] },
    ],
    acronyms: {
      DPMO: "Defects per million opportunities.",
      DMAIC: "Define, Measure, Analyze, Improve, Control.",
      SKU: "Stock keeping unit.",
    },
    references: [
      { label: "ASCM Supply Chain Dictionary", url: "https://learn.ascm.org/sfc/servlet.shepherd/document/download/069R3000006PlDHIA0?operationContext=S1", reason: "Useful for standard inventory and cycle-count terminology." },
    ],
  },
  {
    id: "status-controls",
    title: "Status Controls",
    module: "status",
    audience: "Clerks and supervisors",
    keywords: ["status", "hold", "quarantine", "damaged", "missing", "available", "waste", "defect"],
    sections: [
      { title: "Purpose", content: ["Status controls keep restricted stock visible and auditable.", "Every status change requires a reason because it affects downstream operations."] },
      { title: "What to Do If Stock Cannot Move", content: ["Use hold when stock needs supervisor review but the final disposition is not known.", "Use quarantine when quality, expiry, contamination, temperature, or customer controls require isolation.", "Use damaged or missing only when the physical condition or count has been verified enough to support that status."] },
      { title: "Pick Exception Gap", content: ["Today, short whole-pallet pick problems should be stopped and handled through Inventory Search, Status Controls, and System Log.", "The planned Pick Exception Resolver should let supervisors debit damage, waste, or defect quantities directly from Pick Execution while preserving adjustment and audit history."] },
    ],
  },
  {
    id: "label-printing",
    title: "Label Printing and Reprints",
    module: "receiving",
    audience: "Clerks and supervisors",
    keywords: ["labels", "printing", "barcode", "qr", "reprint", "pallet label", "location label", "bay label", "zone label"],
    sections: [
      { title: "When Labels Matter", content: ["Labels connect the physical pallet, location, zone, or warehouse sign to the system record operators scan.", "Print labels immediately after receiving or master-data setup so the next workflow does not depend on hand-written identifiers."] },
      { title: "Location and Bay Labels", content: ["Per-row rack location labels use the short location code such as A-05-L05 for a single-position bay-level, or A-05-L05-P1/P2 when two side-by-side positions exist.", "Bay code labels remove the level and position so scanning the bay opens the bay grid. Bay and zone aisle sheets print on Avery 99 x 93 mm labels."] },
      { title: "Reprint Rules", content: ["Reprint when a barcode is damaged, unreadable, or missing; do not create a new pallet or location just to replace a label.", "If a location code is intentionally changed, reprint the physical label before sending operators to that rack."] },
    ],
  },
  {
    id: "reporting-basics",
    title: "Reports and Operational Snapshots",
    module: "reports",
    audience: "Supervisors and managers",
    keywords: ["reports", "dashboard", "occupancy", "audit", "stock by warehouse"],
    sections: [
      { title: "Using Reports", content: ["Reports show current conditions and recent activity, not a replacement for reviewing live tasks.", "Use reports to spot bottlenecks, occupancy pressure, and controlled stock."] },
    ],
  },
  {
    id: "zone-design",
    title: "Zone Design Principles",
    module: "zones",
    audience: "Admins and warehouse managers",
    keywords: ["zones", "dispatch", "staging", "quarantine", "cool", "design"],
    sections: [
      { title: "Best Practice", content: ["Keep staging, dispatch, quarantine, and storage use cases distinct.", "Assign temperature classes based on physical handling realities, not convenience."] },
    ],
  },
  {
    id: "location-generation",
    title: "Generating Bin Locations",
    module: "locations",
    audience: "Admins and warehouse managers",
    keywords: ["bin locations", "generation", "aisles", "bays", "levels", "capacity"],
    sections: [
      { title: "Templates", content: ["Location templates generate consistent codes and capacities across a zone. Codes should be readable in the aisle and sortable in the system.", "Rack location scan strings now store rack, bay, level, and position only. Warehouse, zone, and aisle remain structured fields used for filtering, bay selection, and warehouse layout."] },
      { title: "Rack and Bay Codes", content: ["Rack labels identify the exact rack cell using codes such as A-05-L05 for a single-position bay-level. P1/P2 is only included when a bay-level has two side-by-side positions. The pick instruction still says the aisle in plain language when aisle helps the operator orient on the floor.", "Bay labels remove the level and position so scanning the bay code opens a selector for every active location in that bay. The selector still uses aisle, bay, level, depth, capacity, and status fields."] },
      { title: "Import Template", content: ["Use the CSV template for bulk location creation when you already know the warehouse and zone IDs. Required fields prevent partial locations from entering directed work.", "Sequence fields should reflect walking and travel paths. Good sequencing removes motion waste by guiding put-away and picking through a sensible route."] },
    ],
    acronyms: {
      CSV: "Comma-separated values file.",
      ID: "Unique database identifier.",
      WIP: "Work in process.",
    },
  },
  {
    id: "product-mastery",
    title: "Product and Master Data Setup",
    module: "products",
    audience: "Clerks and supervisors",
    keywords: ["products", "sku", "master data", "rotation", "temperature"],
    sections: [
      { title: "Critical Fields", content: ["The most important product controls are owner, rotation method, temperature requirement, and tracking flags. These fields drive receiving checks, put-away location eligibility, pick rotation, labels, and reports.", "Discontinued products should be hidden rather than deleted so historical receipts, picks, counts, and transfers still explain themselves."] },
      { title: "Import Template", content: ["Use the CSV template before importing products. Fill required identifiers first: SKU, name, client owner, temperature requirement, rotation method, and active flag.", "Do not import unknown temperature or rotation values. Bad master data creates waste immediately because every downstream scan asks the system to enforce the wrong rule."] },
    ],
    acronyms: {
      SKU: "Stock keeping unit.",
      CSV: "Comma-separated values file.",
      FEFO: "First Expired, First Out.",
      FIFO: "First In, First Out.",
    },
  },
  {
    id: "packaging-profiles",
    title: "Packaging Profiles",
    module: "packaging-profiles",
    audience: "Clerks and supervisors",
    keywords: ["packaging", "profiles", "each", "case", "pallet", "barcode"],
    sections: [
      { title: "Purpose", content: ["Packaging profiles connect the physical unit of measure to receiving and handling behavior.", "Keep one default profile for each commonly received pack style."] },
    ],
  },
  {
    id: "enterprise-dashboard-modes",
    title: "Enterprise Dashboard Modes",
    module: "dashboard",
    audience: "Operators, supervisors, and managers",
    keywords: ["floor mode", "dock handoff", "office dashboard", "dumbwaiter", "andon", "widgets"],
    sections: [
      { title: "Floor Mode", content: ["Use Floor mode at shift start on tablets or shared workstations.", "The large workflow cards point operators to scan-confirmed put-away, picking, exception, and setup work."] },
      { title: "Dock Handoff", content: ["Dock mode is the dumbwaiter-style board for staged outbound goods.", "Loads are grouped by ready, called, loading, blocked, and loaded so delivery handoff starts from a clear status lane."] },
      { title: "Office Monitoring", content: ["Office mode is for managers watching fill level, inventory turn signals, expiration risk, DPMO, setup readiness, and Warehouse Brain recommendations."] },
    ],
  },
  {
    id: "zebra-printing",
    title: "Zebra ZPL Printing Setup",
    module: "receiving",
    audience: "Admins and inventory clerks",
    keywords: ["zebra", "zpl", "labels", "printer station", "barcode", "reprint"],
    sections: [
      { title: "Printer Model", content: ["Enterprise printing is ZPL-first. Printer stations, templates, print jobs, and failures are tracked so labels can be reprinted with an audit trail.", "Browser printing remains useful for office fallback but should not be the primary warehouse station path."] },
      { title: "Label Standards", content: ["Use Code 128-compatible pallet, location, carton, pick list, transfer, and count sheet labels. For customer-facing logistics labels, GS1-128 is the common standards path.", "Keep barcode values short, unique, and aligned with NetSuite item/location identifiers where possible. Warehouse labels should scan quickly and print reliably before they try to carry every possible data point."] },
    ],
    acronyms: {
      ZPL: "Zebra Programming Language.",
      GS1: "Global standards organization for supply chain identifiers and barcodes.",
      SSCC: "Serial Shipping Container Code.",
    },
    references: [
      { label: "GS1 Barcode Standards", url: "https://www.gs1.org/standards/barcodes", reason: "Primary source for barcode symbologies and GS1 standards." },
      { label: "GS1 Logistic Label Guideline", url: "https://www.gs1.org/standards/gs1-logistic-label-guideline/1-3", reason: "Reference for logistics labels, GS1-128 usage, and scanner expectations." },
    ],
  },
  {
    id: "netsuite-integration",
    title: "NetSuite Integration Setup",
    module: "settings",
    audience: "Admins and IT",
    keywords: ["netsuite", "api", "integration", "sync", "webhook", "external id"],
    sections: [
      { title: "First Adapter", content: ["NetSuite is the first-class ERP adapter for item, purchase order, item receipt, sales order, transfer order, fulfillment, and inventory adjustment sync.", "All sync jobs should use idempotency keys and preserve raw payload logs for support."] },
      { title: "Operational Safety", content: ["Use external record links to avoid duplicate products, orders, receipts, and adjustments.", "Repeated failures should move into dead letters with a clear reason and resolution owner."] },
    ],
  },
  {
    id: "warehouse-brain",
    title: "Warehouse Brain Recommendations",
    module: "reports",
    audience: "Managers and supervisors",
    keywords: ["ai", "warehouse brain", "recommendations", "alerts", "low stock", "expiration", "low turn"],
    sections: [
      { title: "What It Watches", content: ["The Warehouse Brain reviews live inventory, open work, holds, quarantine, expiration dates, cycle-count variance, dock status, and role context.", "Recommendations must explain the reason and next action so humans stay in control."] },
      { title: "Daily Review", content: ["Review recommendations at shift start, before wave release, and during end-of-day management checks.", "Accept, dismiss, or resolve recommendations with reason codes once the backing database workflow is enabled."] },
    ],
  },
  {
    id: "lean-standard-work",
    title: "Lean Warehouse Standard Work",
    module: "dashboard",
    audience: "Managers and supervisors",
    keywords: ["lean", "5s", "standard work", "waste", "andon", "kaizen", "six sigma"],
    sections: [
      { title: "Why It Matters", content: ["The WMS should make the correct action the easiest action. Scan prompts, role-specific screens, templates, sign-offs, and activity logs exist to remove ambiguity, not to add bureaucracy.", "Standard work means every shift receives, puts away, picks, transfers, counts, and changes status the same controlled way unless a supervisor deliberately changes the process."] },
      { title: "Waste Removal", content: ["The biggest warehouse wastes are searching, walking, waiting, re-keying, rechecking, correcting, and explaining what happened after the fact.", "Role-specific UI reduces over-processing. CSV templates reduce defects at import. Badge/code login reduces time at shared devices. Driver sign-off prevents invisible transport errors."] },
      { title: "5S Connection", content: ["5S becomes real when locations are named, labels scan, blocked stock is visible, and each person has clear responsibility for sustaining the process.", "Use dashboard exceptions as a daily 5S audit signal: blocked locations, quarantine buildup, missing stock, and repeated scan failures indicate where standard work is slipping."] },
    ],
    acronyms: {
      "5S": "Sort, Set in order, Shine, Standardize, Sustain.",
      WMS: "Warehouse management system.",
      UI: "User interface.",
    },
    references: [
      { label: "EPA Lean 5S Overview", url: "https://www.epa.gov/sustainability/lean-thinking-and-methods-5s", reason: "Clear public reference for 5S, workplace organization, waste, and standard work." },
    ],
  },
  {
    id: "system-log-operations",
    title: "System Log Operations",
    module: "system-log",
    audience: "Admins and warehouse managers",
    keywords: ["system log", "audit", "resolve", "snapshot", "severity", "operations"],
    sections: [
      { title: "Use Case", content: ["The System Log is for support notes, operational exceptions, and admin-visible events that need ownership or follow-up.", "Record-count snapshots are useful after setup, reset, import, or support activity because they provide a quick environment health checkpoint."] },
      { title: "Critical RF Disconnect Alerts", content: ["When a floor device drops offline, the system writes a critical RF disconnect log and shows supervisors, managers, admins, and developers a red acknowledgment toast.", "The toast requires the typed challenge ACK before dismissal. Use that step only after the operator has reconnected, refreshed live state, and verified the floor work is safe to continue."] },
      { title: "Resolution", content: ["Resolve a log entry only after the real issue has been handled.", "Use severity to keep attention on problems that can block work, corrupt data, or hide operational exceptions."] },
    ],
  },
  {
    id: "email-log-operations",
    title: "Email Log Operations",
    module: "email-log",
    audience: "Admins",
    keywords: ["email", "delivery", "delivery status", "invite", "failure", "template", "recipient", "queue"],
    sections: [
      { title: "What It Shows", content: ["The Email Log shows outbound message attempts by template, recipient, status, time, and error detail.", "Use it to verify invitations, password recovery messages, and other system-generated emails before escalating to users or IT."] },
      { title: "Failure Handling", content: ["Check the recipient address, template, and error message before retrying or asking the user to check their mailbox.", "Repeated failures usually indicate provider configuration, DNS, suppression, or invalid address issues."] },
    ],
  },
  {
    id: "warehouse-structure-tool",
    title: "Warehouse Structure Tool",
    module: "settings",
    audience: "Admins, managers, and supervisors",
    keywords: ["warehouse structure", "tree", "hierarchy", "zones", "aisles", "bays", "locations", "browser"],
    sections: [
      {
        title: "What It Is",
        content: [
          "The Warehouse Structure tool is a live tree view of the physical hierarchy: Warehouse > Zone > Aisle > Bay > Level > Depth.",
          "It is available as a tab from operational pages (Dashboard, Receiving, Put-Away, Inventory, Moves, Pick Lists, Transfers, Cycle Counts, Resources) and from Settings.",
        ],
      },
      {
        title: "When to Use It",
        content: [
          "Use it to verify that warehouses, zones, aisles, bays, and bin locations match the floor before printing labels or starting directed work.",
          "Use it during onboarding so new supervisors can see the full naming convention without opening each resource table.",
          "Use it to confirm capacity and occupancy expectations before approving a setup wizard run or a bulk import.",
        ],
      },
      {
        title: "Best Practice",
        content: [
          "Expand a single zone at a time so the structure stays readable on tablets.",
          "If a node looks wrong, edit it in the matching resource table (Warehouses, Zones, Locations) rather than re-running the setup wizard.",
          "Re-print the affected beam/bay/zone labels whenever a code changes so scanners stay in sync with the tree.",
        ],
      },
    ],
  },
];

const routeMatchers: Array<{ match: (pathname: string) => boolean; helpId: string }> = [
  { match: (pathname) => pathname === "/dashboard", helpId: "dashboard" },
  { match: (pathname) => pathname === "/clients", helpId: "clients" },
  { match: (pathname) => pathname === "/warehouses", helpId: "warehouses" },
  { match: (pathname) => pathname === "/zones", helpId: "zones" },
  { match: (pathname) => pathname === "/locations", helpId: "locations" },
  { match: (pathname) => pathname === "/products", helpId: "products" },
  { match: (pathname) => pathname === "/packaging-profiles", helpId: "packaging-profiles" },
  { match: (pathname) => pathname === "/receiving", helpId: "receiving" },
  { match: (pathname) => pathname === "/putaway-tasks", helpId: "putaway" },
  { match: (pathname) => pathname === "/inventory-search" || pathname.startsWith("/inventory/"), helpId: "inventory" },
  { match: (pathname) => pathname === "/pick-lists" || pathname.startsWith("/pick-lists/"), helpId: "pick-lists" },
  { match: (pathname) => pathname === "/transfers", helpId: "transfers" },
  { match: (pathname) => pathname === "/location-moves", helpId: "location-moves" },
  { match: (pathname) => pathname === "/cycle-counts", helpId: "cycle-counts" },
  { match: (pathname) => pathname === "/status", helpId: "status" },
  { match: (pathname) => pathname === "/reports", helpId: "reports" },
  { match: (pathname) => pathname === "/users", helpId: "users" },
  { match: (pathname) => pathname === "/system-log", helpId: "system-log" },
  { match: (pathname) => pathname === "/email-log", helpId: "email-log" },
  { match: (pathname) => pathname === "/settings", helpId: "settings" },
  { match: (pathname) => pathname === "/help", helpId: "help" },
  { match: (pathname) => pathname === "/setup-wizard", helpId: "setup-wizard" },
];

export function getRouteHelp(pathname: string) {
  const matched = routeMatchers.find((route) => route.match(pathname));
  return matched ? routeHelpDefinitions[matched.helpId] : routeHelpDefinitions.dashboard;
}

export function getArticleById(articleId: string) {
  return helpArticles.find((article) => article.id === articleId);
}

export function getAllRouteHelpDefinitions() {
  return Object.values(routeHelpDefinitions);
}

export function searchHelpArticles(query: string) {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) {
    return helpArticles;
  }

  return helpArticles.filter((article) => {
    const haystack = [
      article.title,
      article.module,
      article.audience,
      ...article.keywords,
      ...article.sections.flatMap((section) => [section.title, ...section.content]),
    ]
      .join(" ")
      .toLowerCase();

    return haystack.includes(trimmed);
  });
}
