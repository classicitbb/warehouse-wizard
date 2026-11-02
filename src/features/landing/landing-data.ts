// Static marketing content for the public /landing page.
// "What's new" is NOT here — it is read live from RELEASE_HISTORY.

export type Tone = "ok" | "warn" | "info" | "bad";

export const TONES: Record<Tone, [bg: string, fg: string]> = {
  ok: ["hsl(152 60% 45% / 0.16)", "hsl(152 60% 58%)"],
  warn: ["hsl(38 92% 55% / 0.16)", "hsl(38 92% 62%)"],
  info: ["hsl(200 80% 55% / 0.16)", "hsl(200 80% 66%)"],
  bad: ["hsl(0 72% 55% / 0.16)", "hsl(0 72% 66%)"],
};

export type MockRow = { code: string; desc: string; status: string; tone: Tone };

export const FAQS = [
  { q: "How do I sign in to my organization?", a: "Select Sign in, use your approved email or user code (or Microsoft), then choose the organization you want to open. Badge sign-in is available on trusted mobile and tablet devices." },
  { q: "How do new users get access?", a: "Accounts are admin-managed. Admins and developers add users and assign roles in Settings > Users & Roles — there is no public sign-up." },
  { q: "Does it connect to NetSuite?", a: "Yes. Connect in Settings > Integrations to look up purchase and transfer orders in Receiving, browse open inbound containers, import items, and monitor sync jobs. NetSuite features stay hidden until the connection is switched on." },
  { q: "What happens if a device loses Wi-Fi?", a: "Live put-away, pick, receiving, and count commits freeze the moment a device goes offline instead of replaying stale work later. Your place in the task is kept and resumes on reconnect." },
  { q: "Which scanners and printers are supported?", a: "Camera scanning on any phone or tablet, plus hardware scanners. Labels print as QR or Zebra ZPL for pallets, locations, zones, and Avery label sheets." },
  { q: "What does the Copilot do?", a: "Warehouse Copilot answers questions in plain language, investigates moves, transfers, counts and audit history within your access rules, and can file a problem report with a screenshot attached." },
];

export const FEATURES = [
  { icon: "▤", title: "Receiving", desc: "Scanner-first entry from container to PO to product. ISO 6346 container reads are check-digit validated, with AI assist when the face is hard to read." },
  { icon: "⇪", title: "Directed Put-Away", desc: "Pallet and location barcodes must match before stock goes live. Returns always issue a new pallet number." },
  { icon: "✓", title: "Pick Execution", desc: "Whole-pallet enforcement, alternate same-SKU pallet verification, and short-pick follow-up tasks." },
  { icon: "⟲", title: "Cycle Counts", desc: "Blind counting, inventory freezes, and supervisor review that separates variances from exceptions." },
  { icon: "⇄", title: "Location Moves & Transfers", desc: "Move pallets between bays with live occupancy checks; transfers keep pallet identity and require driver sign-off." },
  { icon: "▦", title: "Command Center", desc: "Floor, Dock, and Office boards with resizable tiles for capacity, open counts, holds, and inbound containers." },
  { icon: "⧉", title: "NetSuite integration", desc: "Load PO and transfer-order lines, receive inbound shipments, import items, and watch sync health in Settings." },
  { icon: "✦", title: "Warehouse Copilot", desc: "Streaming, evidence-led answers that investigate real warehouse history and hand off repair briefs to developers." },
  { icon: "◫", title: "Pallet Pak Designer", desc: "Build pack standards per product — cases per pallet, height, and footprint — from a typed code like 12x7." },
];

// Placeholder quotes from the design. Replace with real customer quotes before promoting.
export const TESTIMONIALS = [
  { quote: "Put-away errors dropped close to zero once pallet and location barcodes had to match before confirming.", name: "Warehouse Manager", initials: "WM", company: "[ placeholder — mid-size 3PL ]" },
  { quote: "Counts that took a full day now flag only the exceptions. Supervisors review those and move on.", name: "Inventory Supervisor", initials: "IS", company: "[ placeholder — regional distributor ]" },
  { quote: "Containers come straight from NetSuite onto the dock screen. Nobody re-keys a PO anymore.", name: "Receiving Lead", initials: "RL", company: "[ placeholder — fulfillment network ]" },
];

export const MOCK_NAV = [
  { icon: "▦", label: "Command Center", active: true },
  { icon: "▤", label: "Receiving" },
  { icon: "⇪", label: "Put-Away" },
  { icon: "⌕", label: "Inventory" },
  { icon: "✓", label: "Pick Lists" },
  { icon: "⇄", label: "Location Moves" },
  { icon: "⟲", label: "Cycle Counts" },
  { icon: "◈", label: "Reports" },
];

export const MOCK_ROWS: MockRow[] = [
  { code: "MSCU 482193-0", desc: "ETA today", status: "Dock 3", tone: "warn" },
  { code: "TGHU 771045-2", desc: "ETA Nov 4", status: "Open", tone: "info" },
  { code: "CMAU 309811-6", desc: "Received", status: "Put-Away", tone: "ok" },
];

export const SCREENS: { icon: string; label: string; caption: string; rows: MockRow[] }[] = [
  { icon: "▤", label: "Receiving", caption: "Look up a NetSuite PO or browse inbound containers, then scan through each line.", rows: [
    { code: "PO-10482", desc: "4 lines · Acme", status: "Loaded", tone: "ok" },
    { code: "TO-2219", desc: "Transfer · WH2", status: "Pending", tone: "info" },
    { code: "PLT-2201", desc: "12x7 · 84 cs", status: "Draft", tone: "warn" },
  ] },
  { icon: "✓", label: "Pick Execution", caption: "Verified alternate pallets go straight to one Confirm alternate pick button.", rows: [
    { code: "A-11-1", desc: "SKU-4021 · 40", status: "Picked", tone: "ok" },
    { code: "B-04-2", desc: "Alt pallet verified", status: "Confirm", tone: "warn" },
    { code: "C-02-4", desc: "SKU-1180 · 12", status: "Queued", tone: "info" },
  ] },
  { icon: "⟲", label: "Cycle Counts · Review", caption: "Over-threshold variances need a supervisor note before approval.", rows: [
    { code: "CCT-0142", desc: "B-04-2 · −2", status: "Review", tone: "bad" },
    { code: "CCT-0142", desc: "A-11-1 · 0", status: "Match", tone: "ok" },
    { code: "CCT-0141", desc: "Zone C · frozen", status: "Counting", tone: "warn" },
  ] },
];
