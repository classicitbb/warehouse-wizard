import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import PptxGenJS from "pptxgenjs";
import { marked } from "marked";
import {
  AlignmentType,
  Document,
  ExternalHyperlink,
  Footer,
  HeadingLevel,
  Header,
  PageBreak,
  PageNumber,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableOfContents,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import { chromium } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const sourceDir = path.join(root, "docs", "training");
const outDir = path.join(sourceDir, "artifacts");
const assetDir = path.join(sourceDir, "assets");
const teamHuddleImage = path.join(assetDir, "warehouse-team-huddle.png");
const receivingImage = path.join(assetDir, "receiving-team-scan.png");
const managerConversationImage = path.join(assetDir, "manager-floor-conversation.png");
fs.mkdirSync(outDir, { recursive: true });

const C = {
  navy: "123247",
  navy2: "0B2434",
  teal: "0F9D96",
  teal2: "087B76",
  orange: "F47C20",
  yellow: "FFC928",
  ink: "16303D",
  gray: "667985",
  line: "D7E2E6",
  mist: "EFF7F7",
  sand: "FFF3DF",
  white: "FFFFFF",
  red: "C93C3C",
  green: "2F8F5B",
};

const slides = [
  {
    title: "Warehouse Wizard",
    subtitle: "Your warehouse experience, connected through one shared system",
    time: 1,
    type: "cover",
    notes: "Welcome the team as experienced warehouse people. Say: ‘You already know the work. Today we are connecting the decisions you make every day to where Warehouse Wizard records them.’ Confirm this is product version 1.27 and local safety practice remains the authority.",
  },
  {
    title: "By the end, the system should feel familiar",
    time: 2,
    type: "cards",
    cards: [
      ["YOUR WORK", "The pallet journey you already manage"],
      ["ONE SHARED MEMORY", "Scans and updates everyone can see"],
      ["GOOD JUDGMENT", "Pause when the floor and screen disagree"],
      ["CLEAR HANDOFFS", "The next person knows what happened"],
    ],
    footer: "Questions are welcome; configuration topics will be parked for the final follow-up.",
    notes: "Ask who receives, who releases work, who solves problems, and who closes the shift. Say this is a conversation built on their experience, not a test. The manual is the reference so nobody needs to memorize every screen.",
  },
  {
    title: "The system follows the same questions you already ask",
    time: 2,
    type: "rule",
    rule: "WHAT IS IT? → WHERE IS IT? → WHAT HAPPENED? → WHO NEEDS TO KNOW?",
    subrule: "The scan gives the team a shared answer without replacing the walk-around, count, or conversation.",
    notes: "Ask the room how they answer these questions today. Then connect each answer to pallet scan, location scan, action confirmation, and visible handoff. Typing the exact printed code is a valid fallback; guessing is not.",
  },
  {
    title: "The work stays familiar—the handoff becomes visible",
    time: 3,
    type: "relay",
    stages: [
      ["MANAGER", "Plan capacity\nRelease executable work"],
      ["CLERK", "Receive + label\nControl master data"],
      ["OPERATOR", "Scan-confirm\nMove one task at a time"],
      ["SUPERVISOR", "Resolve exceptions\nReview counts"],
      ["MANAGER", "Reconcile + close\nAssign every owner"],
    ],
    notes: "Walk left to right and ask who normally speaks to whom at each point. The system does not replace those conversations; it keeps the answer visible after the conversation ends or the shift changes.",
  },
  {
    title: "A good shift starts the way it always has",
    time: 4,
    type: "split",
    leftTitle: "MANAGER — 5 TO 10 MIN",
    left: ["Choose warehouse + Dashboard view", "Review open work and staffing", "Check holds, quarantine, space, RF alerts", "Assign owners; release finishable work"],
    rightTitle: "OPERATOR — 2 TO 5 MIN",
    right: ["Sign in; verify active warehouse", "Check scanner, network, battery, printer", "Confirm PPE + equipment", "Read priority; open assigned queue"],
    callout: "The system supports the walk-around: people, space, stock, equipment, and priority still have to agree.",
    notes: "Ask what their best shift-start routine looks like now. Map those checks to the Dashboard and notification bell. Red connectivity deserves attention before amber reorder information.",
  },
  {
    title: "Every pallet already has a story—the system keeps it together",
    time: 2,
    type: "flow",
    flow: ["RECEIVE", "LABEL", "PUT-AWAY", "VERIFY", "PICK", "STAGE / TRANSFER"],
    flowCaption: "Counts, moves, status controls, and audit protect the journey at every stage.",
    notes: "Invite someone to describe the story of a pallet from the gate to dispatch. Use that story for the rest of the presentation. One physical pallet should not become two system identities; a label reprint keeps the same story.",
  },
  {
    title: "Receiving: scan → commit → count → expiry",
    time: 5,
    type: "steps",
    image: "receiving-team-scan.png",
    steps: [
      ["1", "CONTEXT", "Warehouse · container · PO"],
      ["2", "PRODUCT", "Scan/search, then press the right-arrow"],
      ["3", "QUANTITY", "Total → qty/pallet → pallets"],
      ["4", "TRACE", "Expiry · lot · batch · packaging"],
      ["5", "RECEIVE", "Verify once · print labels · create Put-Away"],
    ],
    warning: "The physical count always wins. A learned suggestion never replaces the count.",
    notes: "Live demo if safe. Show the highlighted product commit arrow and Enter-to-advance sequence. Explain that the green container candidate is checked before use. End by matching each printed label to one physical pallet.",
  },
  {
    title: "Put-Away: two scans, every pallet, every time",
    time: 4,
    type: "scan",
    scans: [["01", "PALLET", "Who/what is moving?"], ["02", "EXACT LOCATION", "Where did it physically go?"]],
    bullets: ["A bay code opens the grid; it is not the final cell", "Check physical capacity, safety, and temperature", "Confirm once, then verify the task cleared"],
    stop: "STOP: inactive, full, blocked, unsafe, or temperature-incompatible cell.",
    notes: "Use a pallet label and both bay/exact location props. Ask which scan identifies the object and which identifies the destination. Mention Return to Receiving when the receipt itself needs correction.",
  },
  {
    title: "Inventory Search is the truth check",
    time: 3,
    type: "truth",
    center: "PALLET RECORD",
    orbit: ["Quantity", "Status", "Owner", "Lot / expiry", "Exact location", "Movement history"],
    footer: "Use it before substitution, correction, status change, transfer, or variance resolution.",
    notes: "Explain that dashboards are signals, not transaction detail. Held or quarantined stock can be excluded from availability by filters. Demonstrate a pallet detail/history if time allows.",
  },
  {
    title: "Manager gate: release only work the floor can finish",
    time: 4,
    type: "gate",
    gates: ["Correct warehouse + order", "Available eligible stock", "Whole-pallet plan", "Staging capacity", "Owner + due time"],
    result: "RELEASE PICK LIST",
    reject: "Shortfall or split required? Replan before release.",
    notes: "State the current design clearly: normal picks are whole-pallet. Order demand is not permission to split a pallet. The manager prevents failure by reviewing shortage and staging before release.",
  },
  {
    title: "Pick Execution: location first, pallet second",
    time: 3,
    type: "steps",
    steps: [
      ["1", "TRAVEL", "Read rack · aisle · bay · level"],
      ["2", "LOCATION", "Scan exact cell or select assigned bay cell"],
      ["3", "PALLET", "Verify condition + whole quantity; scan"],
      ["4", "CONFIRM", "Use the highlighted Confirm pick"],
      ["5", "STAGE", "Move to directed outbound lane"],
    ],
    warning: "One pallet = one task. Confirm the whole assigned pallet or stop.",
    notes: "Ask the operator what they do before touching another task: confirm the current pick. Explain the yellow confirmation signal after the correct pallet scan.",
  },
  {
    title: "When something looks wrong, pause before it becomes tomorrow’s problem",
    time: 5,
    type: "stop",
    stopSteps: ["KEEP THE PALLET SAFE", "CHECK PALLET · LOCATION · TASK", "LOOK UP THE LIVE RECORD", "AGREE THE NEXT ACTION", "CONTINUE ONCE THE STORY MATCHES"],
    examples: ["Short quantity", "Missing pallet", "Damage / contamination", "Unknown barcode", "Full or blocked cell", "Offline device"],
    notes: "Frame the pause as experienced judgment, never user failure. Ask: ‘What would make you stop this pallet today?’ Scenario: task expects 100, physical pallet has 80. The team keeps it safe, verifies, records the justified status, corrects the record, and replans.",
  },
  {
    title: "Move or Transfer? Let the warehouse boundary decide",
    time: 3,
    type: "compare",
    leftTitle: "LOCATION MOVE",
    left: ["Same warehouse", "Scan pallet + exact destination", "Preserves identity + movement history", "Cancel queued/in-progress move if plan changes"],
    rightTitle: "TRANSFER",
    right: ["Different warehouse", "Create → stage → driver sign-off", "In-transit → destination receive", "Immediate directed Put-Away"],
    callout: "Never strand transferred stock in a receiving lane while the system implies it is stored.",
    notes: "Use the simplest decision question: does the warehouse change? Explain the departure quality gate: sign-off only after physical departure. At destination, receipt is followed by Put-Away.",
  },
  {
    title: "Cycle Counts: count what you see, then learn from the variance",
    time: 2,
    type: "cycle",
    cycle: ["PLAN SCOPE", "BLIND PHYSICAL COUNT", "SUBMIT ONLINE", "SUPERVISOR REVIEW", "ROOT CAUSE + CONTROL"],
    footer: "A variance points upstream: receiving, put-away, movement, pick, transfer, label, or status.",
    notes: "Explain CCT work. Operators count blind and enter truth. Supervisors separate threshold variance from exceptions and use notes before approve/reject/return. Do not approve stale state after reconnect.",
  },
  {
    title: "Offline means freeze the commit — not invent a workaround",
    time: 4,
    type: "offline",
    offline: [
      ["SIGNAL LOST", "Keep the pallet in its current safe state"],
      ["DO NOT REPEAT", "No forced save, receive, move, pick, or approval"],
      ["RECONNECT", "Confirm backend connection is restored"],
      ["REFRESH + RECHECK", "Task · pallet · location · quantity · status"],
      ["POST ONCE", "Verify completion from live state"],
    ],
    notes: "Distinguish preserved local typing from a live commit. Acknowledge a critical RF alert only after reconnect, refresh, and floor safety verification. Never repeat a physical move under a second task number.",
  },
  {
    title: "Controlled status makes restricted stock visible",
    time: 3,
    type: "status",
    statuses: [
      ["HOLD", "Review needed; disposition unknown", C.yellow],
      ["QUARANTINE", "Quality / expiry / contamination / temperature", C.orange],
      ["DAMAGED", "Verified physical damage", C.red],
      ["MISSING", "Verified search/count supports it", C.navy],
      ["AVAILABLE", "Authorized and verified for normal work", C.green],
    ],
    footer: "Every change needs a reason. Add a System Log owner when follow-up is required.",
    notes: "Ask the room why Hold is safer than guessing Damaged or Missing. The status is not the narrative; the reason and System Log connect it to follow-up.",
  },
  {
    title: "The dashboard backs up the walk-around—it does not replace it",
    time: 3,
    type: "manager",
    image: "manager-floor-conversation.png",
    panels: [
      ["START", "Open work · people · space · RF"],
      ["MID-SHIFT", "Backlog · staging · holds · expiry"],
      ["END", "Floor vs queues · owners · safe handoff"],
    ],
    questions: ["Where is work accumulating?", "What is blocked?", "Who owns it?", "When is it due?"],
    notes: "Ask what the manager notices first while walking the floor. Show how Floor, Dock, and Office views keep those observations visible across the team. Dashboard tiles invite a closer look; they do not overrule the floor.",
  },
  {
    title: "Tabletop: the pallet is short and the device just reconnected",
    time: 4,
    type: "scenario",
    scenario: "Pick task expects 100. The pallet has 80. The operator scanned before RF dropped; the screen now reconnects.",
    prompts: ["What must the operator NOT do?", "What live facts must be refreshed?", "What status is justified now?", "Who owns correction and replanning?"],
    answer: "Stop → refresh live pick + pallet → recount/verify → Hold if disposition unknown → log + supervisor → correct stock → replan.",
    notes: "Give pairs 60 seconds, then debrief. Correct misconceptions: do not confirm 80, do not trust the old scan, do not choose Damaged/Missing without evidence, do not repeat the physical movement.",
  },
  {
    title: "Confidence comes from doing it once with your own examples",
    time: 2,
    type: "competency",
    columns: [
      ["OPERATOR", "Sign-in + warehouse\nPut-Away · Pick · Move · Count\nStop rule + offline recovery"],
      ["CLERK", "Receipt + labels\nMaster-data correction\nStatus with reason"],
      ["MANAGER", "Shift control\nExecutable release\nException + count review\nSafe handoff"],
    ],
    notes: "Avoid test language. Explain that each person should get a supported first run using familiar stock, locations, and exceptions. Record what was practiced and what needs another coached run.",
  },
  {
    title: "Your reference set after today",
    time: 1,
    type: "close",
    resources: ["In-app contextual Help + searchable Help Center", "WW-UM-001 User Manual (PDF, DOCX, Markdown)", "Role-based Standard Work Cards", "Training deck + facilitator notes"],
    close: "Your people know the warehouse. Warehouse Wizard keeps their decisions visible.",
    notes: "Close by thanking the room for the operational knowledge they contributed. Confirm the client owner for site-specific terms, coached practice, and approved distribution. Record their decisions instead of improvising policy.",
  },
];

function addSlideNumber(slide, idx, time) {
  slide.addText(`${idx + 1} / ${slides.length}`, { x: 11.7, y: 7.08, w: 1.15, h: 0.2, fontFace: "Aptos", fontSize: 8, color: C.gray, align: "right", margin: 0 });
  slide.addText(`${time} min`, { x: 0.48, y: 7.08, w: 0.7, h: 0.2, fontFace: "Aptos", fontSize: 8, color: C.gray, margin: 0 });
}

function addHeader(slide, title, idx, time, dark = false) {
  slide.background = { color: dark ? C.navy2 : C.white };
  slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 0.14, h: 7.5, fill: { color: C.teal }, line: { color: C.teal } });
  slide.addText(title, { x: 0.58, y: 0.38, w: 11.65, h: 0.55, fontFace: "Aptos Display", fontSize: 24, bold: true, color: dark ? C.white : C.navy, margin: 0, breakLine: false });
  slide.addShape(pptx.ShapeType.line, { x: 0.58, y: 1.04, w: 12.0, h: 0, line: { color: dark ? "315064" : C.line, width: 1 } });
  addSlideNumber(slide, idx, time);
}

function pill(slide, text, x, y, w, color = C.teal, textColor = C.white) {
  slide.addShape(pptx.ShapeType.roundRect, { x, y, w, h: 0.38, rectRadius: 0.08, fill: { color }, line: { color }, radius: 0.08 });
  slide.addText(text, { x: x + 0.06, y: y + 0.06, w: w - 0.12, h: 0.18, fontFace: "Aptos", fontSize: 9, bold: true, color: textColor, align: "center", margin: 0, charSpacing: 0.6 });
}

function bulletList(slide, items, x, y, w, h, color = C.ink, size = 17) {
  const runs = [];
  items.forEach((item, i) => {
    runs.push({ text: item, options: { bullet: { indent: size }, hanging: 4, breakLine: i < items.length - 1, paraSpaceAfterPt: 9 } });
  });
  slide.addText(runs, { x, y, w, h, fontFace: "Aptos", fontSize: size, color, margin: 0.08, valign: "mid", breakLine: false, fit: "shrink" });
}

function card(slide, title, body, x, y, w, h, accent = C.teal) {
  slide.addShape(pptx.ShapeType.roundRect, { x, y, w, h, rectRadius: 0.08, fill: { color: C.white }, line: { color: C.line, width: 1.2 }, shadow: { type: "outer", color: "9DAFB7", blur: 1, angle: 45, distance: 1, opacity: 0.14 } });
  slide.addShape(pptx.ShapeType.rect, { x, y, w: 0.08, h, fill: { color: accent }, line: { color: accent } });
  slide.addText(title, { x: x + 0.25, y: y + 0.22, w: w - 0.45, h: 0.28, fontFace: "Aptos", fontSize: 13, bold: true, color: accent, margin: 0, charSpacing: 0.8 });
  slide.addText(body, { x: x + 0.25, y: y + 0.7, w: w - 0.45, h: h - 0.9, fontFace: "Aptos", fontSize: 17, bold: true, color: C.ink, margin: 0, valign: "mid", fit: "shrink" });
}

const pptx = new PptxGenJS();
pptx.layout = "LAYOUT_WIDE";
pptx.author = "Warehouse Wizard";
pptx.company = "Warehouse Wizard";
pptx.subject = "Client manager and operator training";
pptx.title = "Warehouse Wizard — Manager + Operator Training";
pptx.lang = "en-US";
pptx.theme = {
  headFontFace: "Aptos Display",
  bodyFontFace: "Aptos",
  lang: "en-US",
};
pptx.defineSlideMaster({
  title: "WW",
  background: { color: C.white },
  objects: [],
  slideNumber: { x: 12.5, y: 7.1, color: C.gray, fontFace: "Aptos", fontSize: 8 },
});

slides.forEach((s, idx) => {
  const slide = pptx.addSlide("WW");
  slide.addNotes(`Timing: ${s.time} minute(s)\n${s.notes}`);
  if (s.type === "cover") {
    slide.background = { color: C.navy2 };
    slide.addImage({ path: teamHuddleImage, x: 0, y: 0, w: 13.333, h: 7.5 });
    slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 13.333, h: 7.5, fill: { color: C.navy2, transparency: 34 }, line: { color: C.navy2, transparency: 100 } });
    slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 7.25, h: 7.5, fill: { color: C.navy2, transparency: 8 }, line: { color: C.navy2, transparency: 100 } });
    slide.addText("Manager + Operator\nTraining", { x: 0.8, y: 1.75, w: 6.5, h: 1.7, fontFace: "Aptos Display", fontSize: 42, bold: true, color: C.white, margin: 0, breakLine: false });
    slide.addText("Your warehouse experience, connected through one shared system", { x: 0.85, y: 3.75, w: 5.9, h: 0.75, fontFace: "Aptos", fontSize: 20, color: "BFE7E5", margin: 0, fit: "shrink" });
    pill(slide, "60 MINUTES", 0.85, 5.05, 1.45, C.orange);
    pill(slide, "PRODUCT 1.27", 2.5, 5.05, 1.55, C.teal);
    slide.addText("Client session • 10 August 2026", { x: 0.85, y: 6.42, w: 4.2, h: 0.3, fontFace: "Aptos", fontSize: 11, color: "94AFBA", margin: 0 });
    addSlideNumber(slide, idx, s.time);
    return;
  }

  addHeader(slide, s.title, idx, s.time, ["rule", "stop", "scenario", "close"].includes(s.type));
  if (s.type === "cards") {
    s.cards.forEach((c, i) => card(slide, c[0], c[1], 0.65 + (i % 2) * 6.15, 1.4 + Math.floor(i / 2) * 2.25, 5.65, 1.75, [C.teal, C.orange, C.navy, C.green][i]));
    slide.addText(s.footer, { x: 0.8, y: 6.28, w: 11.8, h: 0.45, fontFace: "Aptos", fontSize: 15, italic: true, color: C.gray, align: "center", margin: 0 });
  } else if (s.type === "rule") {
    pill(slide, "STANDARD WORK", 0.72, 1.45, 1.65, C.orange);
    slide.addText(s.rule, { x: 0.72, y: 2.25, w: 11.85, h: 1.05, fontFace: "Aptos Display", fontSize: 37, bold: true, color: C.white, align: "center", margin: 0, fit: "shrink" });
    slide.addShape(pptx.ShapeType.line, { x: 1.25, y: 3.65, w: 10.8, h: 0, line: { color: C.teal, width: 4, beginArrowType: "none", endArrowType: "triangle" } });
    slide.addText(s.subrule, { x: 1.25, y: 4.35, w: 10.8, h: 0.9, fontFace: "Aptos", fontSize: 22, bold: true, color: C.yellow, align: "center", margin: 0, fit: "shrink" });
  } else if (s.type === "relay") {
    s.stages.forEach((st, i) => {
      const x = 0.55 + i * 2.52;
      slide.addShape(pptx.ShapeType.roundRect, { x, y: 2.05, w: 2.18, h: 2.65, rectRadius: 0.06, fill: { color: i % 2 ? C.mist : C.white }, line: { color: i % 2 ? C.teal : C.line, width: 1.5 } });
      slide.addShape(pptx.ShapeType.ellipse, { x: x + 0.67, y: 1.58, w: 0.84, h: 0.84, fill: { color: i === 4 ? C.orange : C.teal }, line: { color: C.white, width: 2 } });
      slide.addText(String(i + 1), { x: x + 0.67, y: 1.82, w: 0.84, h: 0.25, fontSize: 17, bold: true, color: C.white, align: "center", margin: 0 });
      slide.addText(st[0], { x: x + 0.15, y: 2.6, w: 1.88, h: 0.32, fontSize: 13, bold: true, color: C.navy, align: "center", margin: 0 });
      slide.addText(st[1], { x: x + 0.2, y: 3.25, w: 1.78, h: 0.9, fontSize: 15, color: C.ink, align: "center", margin: 0, fit: "shrink" });
      if (i < 4) slide.addShape(pptx.ShapeType.chevron, { x: x + 2.12, y: 3.02, w: 0.42, h: 0.55, fill: { color: C.yellow }, line: { color: C.yellow } });
    });
    slide.addText("A task is not handed off until the physical state and system state match.", { x: 1.15, y: 5.45, w: 11.0, h: 0.55, fontSize: 20, bold: true, color: C.teal2, align: "center", margin: 0 });
  } else if (s.type === "split" || s.type === "compare") {
    card(slide, s.leftTitle, "", 0.65, 1.42, 5.75, 4.65, C.teal);
    card(slide, s.rightTitle, "", 6.92, 1.42, 5.75, 4.65, C.orange);
    bulletList(slide, s.left, 1.03, 2.25, 4.95, 3.15, C.ink, 17);
    bulletList(slide, s.right, 7.3, 2.25, 4.95, 3.15, C.ink, 17);
    slide.addShape(pptx.ShapeType.roundRect, { x: 1.1, y: 6.17, w: 11.1, h: 0.58, rectRadius: 0.04, fill: { color: C.sand }, line: { color: C.yellow } });
    slide.addText(s.callout, { x: 1.32, y: 6.35, w: 10.65, h: 0.2, fontSize: 13, bold: true, color: C.navy, align: "center", margin: 0, fit: "shrink" });
  } else if (s.type === "flow") {
    s.flow.forEach((f, i) => {
      const x = 0.55 + i * 2.1;
      slide.addShape(pptx.ShapeType.roundRect, { x, y: 2.15, w: 1.75, h: 1.6, rectRadius: 0.08, fill: { color: i % 2 ? C.mist : C.white }, line: { color: i === 5 ? C.orange : C.teal, width: 2 } });
      slide.addText(String(i + 1).padStart(2, "0"), { x: x + 0.12, y: 2.35, w: 0.5, h: 0.25, fontSize: 10, bold: true, color: C.gray, margin: 0 });
      slide.addText(f, { x: x + 0.15, y: 2.85, w: 1.45, h: 0.42, fontSize: 15, bold: true, color: C.navy, align: "center", margin: 0, fit: "shrink" });
      if (i < s.flow.length - 1) slide.addShape(pptx.ShapeType.chevron, { x: x + 1.76, y: 2.65, w: 0.35, h: 0.52, fill: { color: C.yellow }, line: { color: C.yellow } });
    });
    slide.addText(s.flowCaption, { x: 1.15, y: 4.55, w: 11.0, h: 0.6, fontSize: 21, bold: true, color: C.teal2, align: "center", margin: 0 });
  } else if (s.type === "steps") {
    if (s.image) {
      slide.addImage({ path: path.join(assetDir, s.image), x: 8.78, y: 1.35, w: 3.55, h: 2.05 });
      slide.addShape(pptx.ShapeType.roundRect, { x: 8.78, y: 1.35, w: 3.55, h: 2.05, rectRadius: 0.05, fill: { color: C.white, transparency: 100 }, line: { color: C.teal, width: 1.5 } });
    }
    s.steps.forEach((st, i) => {
      const y = 1.35 + i * 0.92;
      slide.addShape(pptx.ShapeType.ellipse, { x: 0.78, y, w: 0.62, h: 0.62, fill: { color: i === s.steps.length - 1 ? C.orange : C.teal }, line: { color: C.white, width: 1.5 } });
      slide.addText(st[0], { x: 0.78, y: y + 0.18, w: 0.62, h: 0.2, fontSize: 13, bold: true, color: C.white, align: "center", margin: 0 });
      slide.addText(st[1], { x: 1.62, y: y + 0.05, w: 2.15, h: 0.28, fontSize: 14, bold: true, color: C.teal2, margin: 0 });
      slide.addText(st[2], { x: 3.75, y: y + 0.02, w: s.image && i < 3 ? 4.7 : 8.3, h: 0.35, fontSize: 18, color: C.ink, margin: 0, fit: "shrink" });
      if (i < s.steps.length - 1) slide.addShape(pptx.ShapeType.line, { x: 1.09, y: y + 0.61, w: 0, h: 0.31, line: { color: C.line, width: 2 } });
    });
    slide.addShape(pptx.ShapeType.roundRect, { x: 1.45, y: 6.2, w: 10.55, h: 0.55, rectRadius: 0.04, fill: { color: C.sand }, line: { color: C.yellow } });
    slide.addText(s.warning, { x: 1.72, y: 6.36, w: 10.0, h: 0.22, fontSize: 14, bold: true, color: C.navy, align: "center", margin: 0, fit: "shrink" });
  } else if (s.type === "scan") {
    s.scans.forEach((sc, i) => {
      const x = 1.0 + i * 6.05;
      slide.addShape(pptx.ShapeType.roundRect, { x, y: 1.55, w: 5.3, h: 2.05, rectRadius: 0.08, fill: { color: i ? C.sand : C.mist }, line: { color: i ? C.orange : C.teal, width: 2.5 } });
      slide.addText(sc[0], { x: x + 0.25, y: 1.88, w: 0.8, h: 0.55, fontSize: 31, bold: true, color: i ? C.orange : C.teal, margin: 0 });
      slide.addText(sc[1], { x: x + 1.15, y: 1.86, w: 3.7, h: 0.35, fontSize: 19, bold: true, color: C.navy, margin: 0 });
      slide.addText(sc[2], { x: x + 1.15, y: 2.55, w: 3.7, h: 0.4, fontSize: 17, color: C.ink, margin: 0 });
    });
    bulletList(slide, s.bullets, 1.1, 4.05, 11.1, 1.55, C.ink, 17);
    slide.addText(s.stop, { x: 1.0, y: 6.25, w: 11.2, h: 0.35, fontSize: 16, bold: true, color: C.red, align: "center", margin: 0 });
  } else if (s.type === "truth") {
    slide.addShape(pptx.ShapeType.ellipse, { x: 5.15, y: 2.35, w: 3.05, h: 1.75, fill: { color: C.navy }, line: { color: C.teal, width: 3 } });
    slide.addText(s.center, { x: 5.4, y: 3.02, w: 2.55, h: 0.3, fontSize: 19, bold: true, color: C.white, align: "center", margin: 0 });
    const pts = [[1.0,1.65],[4.95,1.35],[9.35,1.65],[1.0,4.55],[4.95,4.9],[9.35,4.55]];
    s.orbit.forEach((o, i) => {
      const [x,y] = pts[i];
      slide.addShape(pptx.ShapeType.roundRect, { x, y, w: 3.0, h: 0.85, rectRadius: 0.05, fill: { color: i % 2 ? C.mist : C.white }, line: { color: C.line } });
      slide.addText(o, { x: x + 0.12, y: y + 0.28, w: 2.76, h: 0.22, fontSize: 15, bold: true, color: C.ink, align: "center", margin: 0 });
    });
    slide.addText(s.footer, { x: 1.0, y: 6.35, w: 11.3, h: 0.3, fontSize: 14, italic: true, color: C.teal2, align: "center", margin: 0 });
  } else if (s.type === "gate") {
    s.gates.forEach((g, i) => {
      const x = 0.55 + i * 2.18;
      slide.addShape(pptx.ShapeType.hexagon, { x, y: 1.65, w: 1.85, h: 1.65, fill: { color: i % 2 ? C.mist : C.white }, line: { color: C.teal, width: 1.5 } });
      slide.addText(g, { x: x + 0.22, y: 2.15, w: 1.4, h: 0.55, fontSize: 13, bold: true, color: C.navy, align: "center", margin: 0, fit: "shrink" });
    });
    slide.addShape(pptx.ShapeType.downArrow, { x: 5.82, y: 3.65, w: 1.65, h: 0.9, fill: { color: C.yellow }, line: { color: C.yellow } });
    slide.addShape(pptx.ShapeType.roundRect, { x: 3.8, y: 4.65, w: 5.75, h: 1.0, rectRadius: 0.08, fill: { color: C.green }, line: { color: C.green } });
    slide.addText(s.result, { x: 4.1, y: 4.98, w: 5.15, h: 0.32, fontSize: 22, bold: true, color: C.white, align: "center", margin: 0 });
    slide.addText(s.reject, { x: 2.2, y: 6.18, w: 8.95, h: 0.35, fontSize: 16, bold: true, color: C.red, align: "center", margin: 0 });
  } else if (s.type === "stop") {
    pill(slide, "ANDON / STOP THE LINE", 0.75, 1.25, 2.25, C.red);
    s.stopSteps.forEach((x, i) => {
      const y = 1.95 + i * 0.78;
      slide.addText(String(i + 1), { x: 0.9, y: y + 0.08, w: 0.45, h: 0.3, fontSize: 18, bold: true, color: C.yellow, align: "center", margin: 0 });
      slide.addText(x, { x: 1.5, y, w: 5.25, h: 0.42, fontSize: 18, bold: true, color: C.white, margin: 0, fit: "shrink" });
    });
    slide.addShape(pptx.ShapeType.roundRect, { x: 7.35, y: 1.45, w: 5.1, h: 4.95, rectRadius: 0.08, fill: { color: "17384A" }, line: { color: "315064" } });
    slide.addText("TRIGGERS", { x: 7.72, y: 1.85, w: 4.35, h: 0.35, fontSize: 15, bold: true, color: C.orange, charSpacing: 1.4, margin: 0 });
    bulletList(slide, s.examples, 7.75, 2.35, 4.15, 3.5, C.white, 17);
  } else if (s.type === "cycle") {
    s.cycle.forEach((x, i) => {
      const angle = (Math.PI * 2 * i / s.cycle.length) - Math.PI / 2;
      const cx = 6.45 + Math.cos(angle) * 3.9;
      const cy = 3.7 + Math.sin(angle) * 2.0;
      slide.addShape(pptx.ShapeType.roundRect, { x: cx - 1.25, y: cy - 0.42, w: 2.5, h: 0.84, rectRadius: 0.04, fill: { color: i === 3 ? C.sand : C.mist }, line: { color: i === 3 ? C.orange : C.teal, width: 1.5 } });
      slide.addText(x, { x: cx - 1.08, y: cy - 0.12, w: 2.16, h: 0.24, fontSize: 12, bold: true, color: C.navy, align: "center", margin: 0, fit: "shrink" });
    });
    slide.addShape(pptx.ShapeType.ellipse, { x: 5.25, y: 2.95, w: 2.4, h: 1.5, fill: { color: C.navy }, line: { color: C.yellow, width: 2 } });
    slide.addText("VARIANCE =\nUPSTREAM SIGNAL", { x: 5.48, y: 3.36, w: 1.94, h: 0.55, fontSize: 15, bold: true, color: C.white, align: "center", margin: 0, fit: "shrink" });
    slide.addText(s.footer, { x: 1.0, y: 6.32, w: 11.3, h: 0.3, fontSize: 14, italic: true, color: C.teal2, align: "center", margin: 0 });
  } else if (s.type === "offline") {
    s.offline.forEach((x, i) => {
      const y = 1.32 + i * 1.04;
      slide.addShape(pptx.ShapeType.roundRect, { x: 0.95, y, w: 11.35, h: 0.78, rectRadius: 0.04, fill: { color: i < 2 ? C.sand : C.mist }, line: { color: i < 2 ? C.orange : C.teal, width: 1.3 } });
      slide.addText(String(i + 1), { x: 1.2, y: y + 0.22, w: 0.45, h: 0.25, fontSize: 15, bold: true, color: i < 2 ? C.orange : C.teal, align: "center", margin: 0 });
      slide.addText(x[0], { x: 1.85, y: y + 0.18, w: 2.25, h: 0.25, fontSize: 14, bold: true, color: C.navy, margin: 0 });
      slide.addText(x[1], { x: 4.2, y: y + 0.16, w: 7.55, h: 0.3, fontSize: 16, color: C.ink, margin: 0, fit: "shrink" });
    });
  } else if (s.type === "status") {
    s.statuses.forEach((x, i) => {
      const y = 1.35 + i * 0.97;
      slide.addShape(pptx.ShapeType.roundRect, { x: 0.95, y, w: 2.3, h: 0.62, rectRadius: 0.05, fill: { color: x[2] }, line: { color: x[2] } });
      slide.addText(x[0], { x: 1.1, y: y + 0.19, w: 2.0, h: 0.22, fontSize: 13, bold: true, color: [C.yellow].includes(x[2]) ? C.navy : C.white, align: "center", margin: 0 });
      slide.addText(x[1], { x: 3.65, y: y + 0.14, w: 8.0, h: 0.3, fontSize: 18, color: C.ink, margin: 0 });
    });
    slide.addText(s.footer, { x: 1.0, y: 6.35, w: 11.3, h: 0.3, fontSize: 14, italic: true, color: C.teal2, align: "center", margin: 0 });
  } else if (s.type === "manager") {
    s.panels.forEach((p, i) => {
      const x = 0.65 + i * 4.2;
      if (s.image && i === 2) {
        slide.addImage({ path: path.join(assetDir, s.image), x, y: 1.45, w: 3.75, h: 2.25 });
        slide.addShape(pptx.ShapeType.roundRect, { x, y: 1.45, w: 3.75, h: 2.25, rectRadius: 0.06, fill: { color: C.navy, transparency: 42 }, line: { color: C.navy, width: 1.2 } });
        slide.addText(p[0], { x: x + 0.25, y: 1.68, w: 3.25, h: 0.28, fontSize: 13, bold: true, color: C.yellow, margin: 0 });
        slide.addText(p[1], { x: x + 0.25, y: 2.35, w: 3.25, h: 0.8, fontSize: 17, bold: true, color: C.white, margin: 0, valign: "mid", fit: "shrink" });
      } else card(slide, p[0], p[1], x, 1.45, 3.75, 2.25, [C.teal, C.orange, C.navy][i]);
    });
    slide.addText("THE FOUR QUESTIONS", { x: 0.85, y: 4.25, w: 2.35, h: 0.3, fontSize: 13, bold: true, color: C.teal2, margin: 0, charSpacing: 1.0 });
    s.questions.forEach((q, i) => pill(slide, q.toUpperCase(), 0.85 + (i % 2) * 6.0, 4.85 + Math.floor(i / 2) * 0.82, 5.45, i === 2 ? C.orange : C.navy));
  } else if (s.type === "scenario") {
    slide.addShape(pptx.ShapeType.roundRect, { x: 0.85, y: 1.35, w: 11.65, h: 1.25, rectRadius: 0.06, fill: { color: "17384A" }, line: { color: C.teal, width: 1.5 } });
    slide.addText(s.scenario, { x: 1.18, y: 1.74, w: 11.0, h: 0.48, fontSize: 21, bold: true, color: C.white, align: "center", margin: 0, fit: "shrink" });
    s.prompts.forEach((p, i) => card(slide, `QUESTION ${i + 1}`, p, 0.9 + (i % 2) * 6.05, 3.05 + Math.floor(i / 2) * 1.5, 5.55, 1.12, i === 2 ? C.orange : C.teal));
    slide.addText(s.answer, { x: 1.0, y: 6.35, w: 11.3, h: 0.3, fontSize: 13, bold: true, color: C.yellow, align: "center", margin: 0, fit: "shrink" });
  } else if (s.type === "competency") {
    s.columns.forEach((p, i) => card(slide, p[0], p[1], 0.65 + i * 4.2, 1.45, 3.75, 4.65, [C.teal, C.orange, C.navy][i]));
    slide.addText("Attendance is not competency — each person demonstrates normal work and at least one exception.", { x: 0.9, y: 6.35, w: 11.5, h: 0.3, fontSize: 14, bold: true, color: C.teal2, align: "center", margin: 0 });
  } else if (s.type === "close") {
    pill(slide, "TAKE-AWAY", 0.8, 1.3, 1.45, C.orange);
    s.resources.forEach((r, i) => {
      const y = 2.0 + i * 0.86;
      slide.addShape(pptx.ShapeType.ellipse, { x: 1.0, y, w: 0.5, h: 0.5, fill: { color: C.teal }, line: { color: C.teal } });
      slide.addText("✓", { x: 1.0, y: y + 0.1, w: 0.5, h: 0.22, fontSize: 15, bold: true, color: C.white, align: "center", margin: 0 });
      slide.addText(r, { x: 1.75, y: y + 0.08, w: 10.0, h: 0.3, fontSize: 20, color: C.white, margin: 0 });
    });
    slide.addText(s.close, { x: 1.0, y: 5.75, w: 11.3, h: 0.6, fontSize: 25, bold: true, color: C.yellow, align: "center", margin: 0 });
  }
});

const pptxPath = path.join(outDir, "Warehouse-Wizard-Client-Training-60-Minutes.pptx");
await pptx.writeFile({ fileName: pptxPath });

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>\"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '\"': "&quot;" }[c]));
}

function slideHtml(s, idx) {
  const blocks = [];
  if (s.rule) blocks.push(`<div class="hero-rule">${escapeHtml(s.rule)}</div><div class="subrule">${escapeHtml(s.subrule)}</div>`);
  if (s.cards) blocks.push(`<div class="grid cards">${s.cards.map((x) => `<div class="card"><b>${escapeHtml(x[0])}</b><span>${escapeHtml(x[1])}</span></div>`).join("")}</div>`);
  if (s.stages) blocks.push(`<div class="row relay">${s.stages.map((x, i) => `<div class="stage"><i>${i + 1}</i><b>${escapeHtml(x[0])}</b><span>${escapeHtml(x[1]).replace(/\n/g,"<br>")}</span></div>`).join("<em>›</em>")}</div>`);
  if (s.left) blocks.push(`<div class="grid two"><div class="panel"><b>${escapeHtml(s.leftTitle)}</b><ul>${s.left.map(x=>`<li>${escapeHtml(x)}</li>`).join("")}</ul></div><div class="panel orange"><b>${escapeHtml(s.rightTitle)}</b><ul>${s.right.map(x=>`<li>${escapeHtml(x)}</li>`).join("")}</ul></div></div>${s.callout?`<div class="callout">${escapeHtml(s.callout)}</div>`:""}`);
  if (s.flow) blocks.push(`<div class="row flow">${s.flow.map((x,i)=>`<div><small>${String(i+1).padStart(2,"0")}</small><b>${escapeHtml(x)}</b></div>`).join("<em>›</em>")}</div><div class="footer-note">${escapeHtml(s.flowCaption)}</div>`);
  if (s.steps) {
    const stepList = `<div class="steps ${s.image ? "with-photo" : ""}">${s.steps.map((x,i)=>`<div class="${s.image && i < 3 ? "short" : ""}"><i>${escapeHtml(x[0])}</i><b>${escapeHtml(x[1])}</b><span>${escapeHtml(x[2])}</span></div>`).join("")}</div>`;
    blocks.push(`${s.image ? `<div class="step-photo"><img src="../assets/${escapeHtml(s.image)}">${stepList}</div>` : stepList}<div class="warning">${escapeHtml(s.warning)}</div>`);
  }
  if (s.scans) blocks.push(`<div class="grid two">${s.scans.map(x=>`<div class="scan"><strong>${escapeHtml(x[0])}</strong><b>${escapeHtml(x[1])}</b><span>${escapeHtml(x[2])}</span></div>`).join("")}</div><ul class="wide">${s.bullets.map(x=>`<li>${escapeHtml(x)}</li>`).join("")}</ul><div class="stopline">${escapeHtml(s.stop)}</div>`);
  if (s.center) blocks.push(`<div class="truth"><div class="core">${escapeHtml(s.center)}</div>${s.orbit.map(x=>`<span>${escapeHtml(x)}</span>`).join("")}</div><div class="footer-note">${escapeHtml(s.footer)}</div>`);
  if (s.gates) blocks.push(`<div class="row gates">${s.gates.map(x=>`<div>${escapeHtml(x)}</div>`).join("<em>›</em>")}</div><div class="result">${escapeHtml(s.result)}</div><div class="stopline">${escapeHtml(s.reject)}</div>`);
  if (s.stopSteps) blocks.push(`<div class="grid two"><ol class="stopsteps">${s.stopSteps.map(x=>`<li>${escapeHtml(x)}</li>`).join("")}</ol><div class="triggers"><b>TRIGGERS</b><ul>${s.examples.map(x=>`<li>${escapeHtml(x)}</li>`).join("")}</ul></div></div>`);
  if (s.cycle) blocks.push(`<div class="row cycle">${s.cycle.map(x=>`<div>${escapeHtml(x)}</div>`).join("<em>→</em>")}</div><div class="result">VARIANCE = UPSTREAM SIGNAL</div><div class="footer-note">${escapeHtml(s.footer)}</div>`);
  if (s.offline) blocks.push(`<div class="steps">${s.offline.map((x,i)=>`<div><i>${i+1}</i><b>${escapeHtml(x[0])}</b><span>${escapeHtml(x[1])}</span></div>`).join("")}</div>`);
  if (s.statuses) blocks.push(`<div class="status-list">${s.statuses.map(x=>`<div><b style="background:#${x[2]}">${escapeHtml(x[0])}</b><span>${escapeHtml(x[1])}</span></div>`).join("")}</div><div class="footer-note">${escapeHtml(s.footer)}</div>`);
  if (s.panels) blocks.push(`<div class="grid three">${s.panels.map((x,i)=>`<div class="card ${s.image && i===2 ? "photo-card" : ""}" ${s.image && i===2 ? `style="background-image:linear-gradient(rgba(18,50,71,.48),rgba(18,50,71,.48)),url('../assets/${escapeHtml(s.image)}')"` : ""}><b>${escapeHtml(x[0])}</b><span>${escapeHtml(x[1])}</span></div>`).join("")}</div><div class="questions">${s.questions.map(x=>`<b>${escapeHtml(x)}</b>`).join("")}</div>`);
  if (s.scenario) blocks.push(`<div class="scenario">${escapeHtml(s.scenario)}</div><div class="grid two">${s.prompts.map((x,i)=>`<div class="card"><b>QUESTION ${i+1}</b><span>${escapeHtml(x)}</span></div>`).join("")}</div><div class="answer">${escapeHtml(s.answer)}</div>`);
  if (s.columns) blocks.push(`<div class="grid three">${s.columns.map(x=>`<div class="panel"><b>${escapeHtml(x[0])}</b><p>${escapeHtml(x[1]).replace(/\n/g,"<br>")}</p></div>`).join("")}</div>`);
  if (s.resources) blocks.push(`<ul class="resources">${s.resources.map(x=>`<li>${escapeHtml(x)}</li>`).join("")}</ul><div class="hero-rule small">${escapeHtml(s.close)}</div>`);
  return `<section class="slide ${["cover","rule","stop","scenario","close"].includes(s.type)?"dark":""} ${s.type === "cover" ? "cover" : ""}"><header><span>${s.type === "cover" ? "" : "WAREHOUSE WIZARD"}</span><small>${s.time} min</small></header><h1>${escapeHtml(s.type === "cover" ? "Manager + Operator Training" : s.title)}</h1>${s.type==="cover"?`<h2>${escapeHtml(s.subtitle)}</h2>`:""}<main>${blocks.join("")}</main><footer>Product 1.27 <span>${idx+1} / ${slides.length}</span></footer></section>`;
}

const deckCss = `
@page{size:13.333in 7.5in;margin:0}*{box-sizing:border-box}body{margin:0;background:#cad6da;font-family:Aptos,Arial,sans-serif;color:#16303d}.slide{width:13.333in;height:7.5in;page-break-after:always;background:white;position:relative;padding:.4in .58in .35in .72in;border-left:.14in solid #0f9d96;overflow:hidden}.slide.dark{background:#0b2434;color:white}.slide.cover{background:linear-gradient(90deg,rgba(11,36,52,.96) 0%,rgba(11,36,52,.84) 48%,rgba(11,36,52,.34) 100%),url('../assets/warehouse-team-huddle.png') center/cover no-repeat}.slide.cover h1,.slide.cover h2{max-width:6.3in}.slide header{display:flex;justify-content:space-between;color:#0f9d96;font-size:10pt;letter-spacing:1.7px;font-weight:700}.slide.dark header{color:#ffc928}.slide h1{font-size:28pt;margin:.22in 0 .25in;color:#123247;line-height:1.05}.slide.dark h1{color:white;font-size:34pt}.slide h2{font-size:20pt;color:#bfe7e5;margin:.55in 0}.slide main{height:5.45in;display:flex;flex-direction:column;justify-content:center}.slide footer{position:absolute;bottom:.15in;left:.75in;right:.38in;font-size:8pt;color:#667985;display:flex;justify-content:space-between}.grid{display:grid;gap:.22in}.two{grid-template-columns:1fr 1fr}.three{grid-template-columns:repeat(3,1fr)}.cards{grid-template-columns:1fr 1fr}.card,.panel{border:1px solid #d7e2e6;border-left:7px solid #0f9d96;border-radius:10px;padding:.22in;background:#fff;min-height:1.3in;box-shadow:0 4px 9px #12324715}.dark .card{background:#17384a;border-color:#315064}.card b,.panel>b{display:block;color:#0f9d96;font-size:12pt;letter-spacing:1px;margin-bottom:.15in}.card span,.panel p{font-size:18pt;font-weight:650}.panel ul,.wide{font-size:17pt;line-height:1.45}.orange{border-left-color:#f47c20}.orange>b{color:#f47c20}.callout,.warning{background:#fff3df;border:1px solid #ffc928;border-radius:7px;padding:.12in;text-align:center;font-weight:700;color:#123247;margin-top:.2in}.hero-rule{font-size:35pt;font-weight:800;text-align:center;color:white;letter-spacing:1px}.hero-rule.small{font-size:25pt;color:#ffc928;margin-top:.4in}.subrule,.footer-note{font-size:20pt;font-weight:700;text-align:center;color:#0f9d96;margin-top:.45in}.row{display:flex;align-items:center;justify-content:center;gap:.12in}.relay .stage,.flow div,.gates div,.cycle div{border:2px solid #0f9d96;border-radius:10px;background:#eff7f7;padding:.18in;text-align:center;color:#123247;min-width:1.7in}.relay .stage{height:2.1in}.relay i{display:block;background:#0f9d96;color:white;border-radius:50%;width:.4in;height:.4in;padding-top:.09in;margin:-.4in auto .18in}.relay b,.relay span{display:block;margin:.15in 0}.row em{font-size:26pt;color:#ffc928;font-style:normal}.flow b,.flow small{display:block}.steps{display:grid;gap:.12in}.steps>div{display:grid;grid-template-columns:.55in 1.9in 1fr;align-items:center;border:1px solid #d7e2e6;border-radius:8px;padding:.11in .17in}.steps i{background:#0f9d96;color:white;width:.42in;height:.42in;border-radius:50%;text-align:center;padding-top:.09in;font-style:normal;font-weight:700}.steps b{color:#087b76}.steps span{font-size:17pt}.step-photo{position:relative}.step-photo img{position:absolute;right:0;top:0;width:3.55in;height:2.05in;object-fit:cover;border:2px solid #0f9d96;border-radius:9px;z-index:2}.steps.with-photo .short{grid-template-columns:.55in 1.9in 4.45in;padding-right:.12in}.photo-card{background-size:cover;background-position:center;color:white;border-left-color:#ffc928}.photo-card b{color:#ffc928}.photo-card span{color:white}.scan{border:2px solid #0f9d96;border-radius:10px;padding:.28in;display:grid;grid-template-columns:.9in 1fr;min-height:1.55in}.scan strong{font-size:31pt;color:#0f9d96;grid-row:1/3}.scan b{font-size:19pt}.stopline{color:#c93c3c;text-align:center;font-size:16pt;font-weight:800;margin-top:.2in}.truth{display:grid;grid-template-columns:repeat(3,1fr);gap:.25in;align-items:center}.truth span{border:1px solid #d7e2e6;border-radius:8px;padding:.16in;text-align:center;font-weight:700;font-size:16pt}.truth .core{grid-column:2;grid-row:1/3;background:#123247;color:white;border:3px solid #0f9d96;border-radius:50%;height:1.5in;padding-top:.55in;text-align:center;font-weight:800}.gates div{min-width:1.9in}.result{background:#2f8f5b;color:white;border-radius:8px;padding:.18in;text-align:center;font-weight:800;font-size:21pt;margin:.3in auto;width:5.4in}.stopsteps{font-size:17pt;line-height:1.65}.triggers{border:1px solid #315064;background:#17384a;border-radius:10px;padding:.25in;color:white}.triggers b{color:#f47c20}.triggers ul{font-size:17pt;line-height:1.45}.cycle{flex-wrap:wrap}.status-list{display:grid;gap:.14in}.status-list div{display:grid;grid-template-columns:2.2in 1fr;align-items:center;gap:.3in}.status-list b{padding:.15in;border-radius:8px;text-align:center;color:white}.status-list span{font-size:18pt}.questions{display:grid;grid-template-columns:1fr 1fr;gap:.15in;margin-top:.4in}.questions b{background:#123247;color:white;border-radius:20px;padding:.14in;text-align:center}.scenario{background:#17384a;color:white;border:2px solid #0f9d96;border-radius:10px;padding:.24in;font-size:21pt;font-weight:700;text-align:center;margin-bottom:.2in}.answer{color:#ffc928;font-weight:800;text-align:center;margin-top:.2in}.resources{font-size:20pt;line-height:1.75}.resources li::marker{color:#0f9d96}
`;
const deckHtml = `<!doctype html><html><head><meta charset="utf-8"><style>${deckCss}</style></head><body>${slides.map(slideHtml).join("")}</body></html>`;
const deckHtmlPath = path.join(outDir, "Warehouse-Wizard-Client-Training-60-Minutes.html");
fs.writeFileSync(deckHtmlPath, deckHtml);

const manualPath = path.join(sourceDir, "Warehouse-Wizard-User-Manual.md");
const manualMd = fs.readFileSync(manualPath, "utf8");
const manualPrintableMd = manualMd.replace(/^---[\s\S]*?---\s*/, "").replace(/\s+\{#[^}]+\}(?=\s*$)/gm, "");
const manualBody = marked.parse(manualPrintableMd, { gfm: true });
const manualCss = `@page{size:Letter;margin:.7in .68in .7in .72in}*{box-sizing:border-box}body{font-family:Aptos,Arial,sans-serif;color:#16303d;font-size:10.5pt;line-height:1.38;margin:0}h1{font-size:30pt;color:#123247;border-bottom:5px solid #0f9d96;padding-bottom:12px;margin-top:0}h2{font-size:20pt;color:#123247;border-bottom:1px solid #d7e2e6;padding-bottom:5px;break-after:avoid-page;margin-top:24px}h3{font-size:14pt;color:#087b76;break-after:avoid-page;margin-top:18px}p,li{orphans:3;widows:3}blockquote{border-left:5px solid #f47c20;background:#fff3df;margin:14px 0;padding:9px 13px;color:#123247}table{border-collapse:collapse;width:100%;font-size:9pt;margin:12px 0;break-inside:auto}tr{break-inside:avoid}th{background:#123247;color:white;text-align:left}th,td{border:1px solid #cbd9de;padding:6px;vertical-align:top}code{background:#eff7f7;color:#087b76;padding:1px 3px;border-radius:3px}a{color:#087b76}hr{border:0;border-top:1px solid #d7e2e6}.cover{height:9in;display:flex;flex-direction:column;justify-content:center;page-break-after:always;background:#0b2434;color:white;margin:-.7in -.68in -.7in -.72in;padding:1in}.cover h1{color:white;border-color:#ffc928}.cover .eyebrow{color:#ffc928;letter-spacing:2px;font-weight:700}.cover .meta{color:#bfe7e5;font-size:14pt}`;
const manualHtml = `<!doctype html><html><head><meta charset="utf-8"><style>${manualCss}</style></head><body><div class="cover"><div class="eyebrow">WAREHOUSE WIZARD</div><h1>User Manual</h1><p class="meta">End-to-end operating guide • Product 1.27 • WW-UM-001 • Revision 1.0</p><p>Managers • Supervisors • Clerks • Operators • Dispatch • Admins</p></div>${manualBody}</body></html>`;
const manualHtmlPath = path.join(outDir, "Warehouse-Wizard-User-Manual.html");
fs.writeFileSync(manualHtmlPath, manualHtml);

function tokenText(t) {
  if (!t) return "";
  if (typeof t === "string") return t;
  if (t.text) return t.text.replace(/<[^>]+>/g, "");
  if (t.tokens) return t.tokens.map(tokenText).join("");
  return "";
}

function inlineRuns(tokens = []) {
  const runs = [];
  for (const t of tokens) {
    if (t.type === "strong") runs.push(new TextRun({ text: tokenText(t), bold: true }));
    else if (t.type === "em") runs.push(new TextRun({ text: tokenText(t), italics: true }));
    else if (t.type === "codespan") runs.push(new TextRun({ text: t.text, font: "Aptos Mono", color: C.teal2, shading: { fill: C.mist } }));
    else if (t.type === "link") runs.push(new ExternalHyperlink({ link: t.href, children: [new TextRun({ text: tokenText(t), color: C.teal2, underline: {} })] }));
    else if (t.type === "br") runs.push(new TextRun({ break: 1 }));
    else if (t.type === "escape" || t.type === "text") runs.push(new TextRun({ text: t.text ?? tokenText(t) }));
    else if (t.tokens) runs.push(...inlineRuns(t.tokens));
  }
  return runs.length ? runs : [new TextRun("")];
}

function tableFromToken(token) {
  const rows = [];
  rows.push(new TableRow({ tableHeader: true, children: token.header.map((cell) => new TableCell({ shading: { fill: C.navy }, children: [new Paragraph({ children: [new TextRun({ text: tokenText(cell), bold: true, color: C.white })] })] })) }));
  token.rows.forEach((row) => rows.push(new TableRow({ children: row.map((cell) => new TableCell({ children: [new Paragraph({ children: inlineRuns(cell.tokens ?? []) })] })) })));
  return new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows });
}

function markdownToDocChildren(md) {
  const tokens = marked.lexer(md.replace(/^---[\s\S]*?---\s*/, "").replace(/\s+\{#[^}]+\}(?=\s*$)/gm, ""), { gfm: true });
  const out = [];
  let orderedListCounter = 0;
  const walk = (list) => {
    for (const t of list) {
      if (t.type === "heading") {
        const heading = ({1:HeadingLevel.TITLE,2:HeadingLevel.HEADING_1,3:HeadingLevel.HEADING_2,4:HeadingLevel.HEADING_3})[t.depth] ?? HeadingLevel.HEADING_4;
        out.push(new Paragraph({ heading, children: inlineRuns(t.tokens) }));
      } else if (t.type === "paragraph") out.push(new Paragraph({ spacing: { after: 120 }, children: inlineRuns(t.tokens) }));
      else if (t.type === "blockquote") {
        const text = t.tokens.map(tokenText).join(" ");
        out.push(new Paragraph({ indent: { left: 360 }, border: { left: { color: C.orange, size: 18, space: 8 } }, shading: { fill: C.sand }, children: [new TextRun({ text, italics: true })] }));
      } else if (t.type === "list") {
        orderedListCounter += 1;
        t.items.forEach((item) => out.push(new Paragraph({ numbering: t.ordered ? { reference: "numbering", level: 0, instance: orderedListCounter } : undefined, bullet: t.ordered ? undefined : { level: 0 }, children: inlineRuns(item.tokens?.[0]?.tokens ?? [{ type: "text", text: tokenText(item) }]) })));
      } else if (t.type === "table") out.push(tableFromToken(t));
      else if (t.type === "space") continue;
      else if (t.type === "hr") out.push(new Paragraph({ border: { bottom: { color: C.line, size: 6, space: 6 } } }));
      else if (t.tokens) walk(t.tokens);
    }
  };
  walk(tokens);
  return out;
}

const doc = new Document({
  creator: "Warehouse Wizard",
  title: "Warehouse Wizard User Manual",
  description: "End-to-end operating guide for Warehouse Wizard 1.27",
  styles: { default: { document: { run: { font: "Aptos", size: 21, color: C.ink }, paragraph: { spacing: { after: 80 } } } } },
  numbering: { config: [{ reference: "numbering", levels: [{ level: 0, format: "decimal", text: "%1.", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 360, hanging: 180 } } } }] }] },
  sections: [{
    properties: { page: { margin: { top: 720, right: 720, bottom: 720, left: 720 } } },
    headers: { default: new Header({ children: [new Paragraph({ children: [new TextRun({ text: "WAREHOUSE WIZARD  •  USER MANUAL  •  PRODUCT 1.27", bold: true, color: C.teal2, size: 16 })] })] }) },
    footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: "WW-UM-001  •  Revision 1.0  •  Page ", color: C.gray, size: 16 }), new TextRun({ children: [PageNumber.CURRENT], color: C.gray, size: 16 })] })] }) },
    children: [
      new Paragraph({ spacing: { before: 2400, after: 240 }, children: [new TextRun({ text: "WAREHOUSE WIZARD", bold: true, color: C.teal2, size: 28, characterSpacing: 80 })] }),
      new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun({ text: "User Manual", bold: true, color: C.navy, size: 58 })] }),
      new Paragraph({ spacing: { before: 220, after: 220 }, children: [new TextRun({ text: "End-to-end operating guide for managers and operators", size: 30, color: C.gray })] }),
      new Paragraph({ children: [new TextRun({ text: "Product 1.27  •  WW-UM-001  •  Revision 1.0  •  Effective 10 August 2026", bold: true, color: C.orange })] }),
      new Paragraph({ children: [new PageBreak()] }),
      new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("Contents")] }),
      new TableOfContents("Table of Contents", { hyperlink: true, headingStyleRange: "1-3" }),
      new Paragraph({ children: [new PageBreak()] }),
      ...markdownToDocChildren(manualMd).slice(1),
    ],
  }],
});
fs.writeFileSync(path.join(outDir, "Warehouse-Wizard-User-Manual.docx"), await Packer.toBuffer(doc));

const headingMatches = [...manualMd.matchAll(/^##\s+(\d+\.)?\s*(.+?)(?:\s+\{#([^}]+)\})?\s*$/gm)];
const manualIndex = headingMatches.map((m, i) => {
  const start = m.index;
  const end = i + 1 < headingMatches.length ? headingMatches[i + 1].index : manualMd.length;
  const id = m[3] || `manual-${String(i + 1).padStart(2, "0")}-${m[2].toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
  return { id, title: m[2], productVersion: "1.27", revision: "1.0", source: "WW-UM-001", content: manualMd.slice(start, end).trim() };
});
fs.writeFileSync(path.join(outDir, "Warehouse-Wizard-User-Manual-AI-Index.json"), JSON.stringify({ documentId: "WW-UM-001", productVersion: "1.27", revision: "1.0", chunks: manualIndex }, null, 2));

const quickHtml = `<!doctype html><html><head><meta charset="utf-8"><style>@page{size:Letter;margin:.4in}*{box-sizing:border-box}body{font-family:Aptos,Arial;color:#16303d;margin:0}.page{height:10.2in;page-break-after:always;border-top:9px solid #0f9d96;padding:.25in;position:relative}.head{display:flex;justify-content:space-between;align-items:end}.head h1{font-size:25pt;color:#123247;margin:0}.badge{background:#f47c20;color:white;padding:6px 10px;border-radius:20px;font-weight:bold}.rule{background:#0b2434;color:white;border-radius:10px;padding:16px;text-align:center;font-size:19pt;font-weight:800;margin:16px 0}.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.box{border:1px solid #d7e2e6;border-left:6px solid #0f9d96;border-radius:8px;padding:10px}.box h2{font-size:13pt;color:#087b76;margin:0 0 6px}.box ol,.box ul{margin:5px 0;padding-left:20px;font-size:10pt}.stop{border-left-color:#c93c3c;background:#fff3df}.stop h2{color:#c93c3c}table{width:100%;border-collapse:collapse;font-size:9pt}th{background:#123247;color:white}td,th{border:1px solid #d7e2e6;padding:5px}.foot{position:absolute;bottom:.08in;left:.25in;font-size:8pt;color:#667985}</style></head><body><section class="page"><div class="head"><h1>Warehouse Wizard — Floor Quick Reference</h1><span class="badge">Product 1.27</span></div><div class="rule">IDENTIFY → SCAN → CONFIRM → COMMIT ONCE</div><div class="grid"><div class="box"><h2>RECEIVING</h2><ol><li>Warehouse · container · PO</li><li>Scan/search product; press commit arrow</li><li>Total → qty/pallet → pallets</li><li>Expiry · lot · packaging</li><li>Verify, receive once, print labels</li></ol></div><div class="box"><h2>PUT-AWAY</h2><ol><li>Select task; scan pallet</li><li>Scan exact location or select bay cell</li><li>Check space, safety, temperature</li><li>Place pallet; confirm once</li><li>Verify task cleared</li></ol></div><div class="box"><h2>WHOLE-PALLET PICK</h2><ol><li>Travel to assigned cell</li><li>Scan exact location / bay selection</li><li>Verify condition + full quantity</li><li>Scan pallet; confirm highlighted action</li><li>Stage in directed lane</li></ol></div><div class="box"><h2>MOVE / TRANSFER / COUNT</h2><ul><li>Same warehouse = Location Move</li><li>Different warehouse = Transfer + driver sign-off</li><li>Count what you see; submit online</li><li>Use Inventory Search as the truth check</li></ul></div><div class="box stop"><h2>STOP / ANDON</h2><ul><li>Short or missing pallet</li><li>Damage, contamination, expiry</li><li>Unknown barcode</li><li>Full, blocked, unsafe, wrong-temperature cell</li><li>Floor and system disagree</li><li>Device offline</li></ul></div><div class="box stop"><h2>FIVE-STEP RESPONSE</h2><ol><li>Stop; keep stock safe</li><li>Identify pallet, location, task</li><li>Verify in Inventory Search</li><li>Control status + notify supervisor</li><li>Resume once after correction</li></ol></div></div><div class="foot">WW-UM-001 • Normal work: scan-confirm. Exception: stop-verify-control-escalate.</div></section><section class="page"><div class="head"><h1>Manager Shift Control</h1><span class="badge">Quick Reference</span></div><div class="grid" style="margin-top:18px"><div class="box"><h2>START OF SHIFT</h2><ol><li>Choose warehouse + Dashboard view</li><li>Review work, people, space, RF</li><li>Check holds, quarantine, expiry, reorder</li><li>Assign owners</li><li>Release finishable work only</li></ol></div><div class="box"><h2>END OF SHIFT</h2><ol><li>Reconcile floor with open queues</li><li>Clear/own receiving and staging backlog</li><li>Review controlled stock + count variance</li><li>Assign unresolved logs</li><li>Leave a safe, explicit handoff</li></ol></div></div><h2 style="color:#123247">Supervisor response matrix</h2><table><tr><th>Condition</th><th>Normal controlled response</th></tr><tr><td>Unreadable pallet/location label</td><td>Verify live identity/structure; reprint the same code.</td></tr><tr><td>Wrong bin</td><td>Verify history; use a controlled Location Move.</td></tr><tr><td>Short quantity</td><td>Recount; Hold if disposition unknown; investigate and replan.</td></tr><tr><td>Damage/contamination/expiry</td><td>Secure; apply justified status with reason; log owner.</td></tr><tr><td>Unknown SKU/barcode</td><td>Correct product/packaging master data before work.</td></tr><tr><td>Offline device</td><td>Freeze commit; reconnect; refresh and re-check; post once.</td></tr></table><div class="rule" style="margin-top:18px">WHERE IS WORK ACCUMULATING? · WHAT IS BLOCKED? · WHO OWNS IT? · WHEN IS IT DUE?</div><div class="box"><h2>STATUS CHOICE</h2><ul><li><b>Hold:</b> review needed, disposition unknown.</li><li><b>Quarantine:</b> quality/expiry/contamination/temperature/customer isolation.</li><li><b>Damaged / Missing:</b> use only after facts support it.</li><li><b>Available:</b> return only after authorized verification.</li></ul></div><div class="foot">Full detail: Warehouse-Wizard-User-Manual.pdf • In-app Help: Operational Dead-Ends</div></section></body></html>`;
const quickHtmlPath = path.join(outDir, "Warehouse-Wizard-Quick-Reference.html");
fs.writeFileSync(quickHtmlPath, quickHtml);

const installedBrowser = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
].find((candidate) => fs.existsSync(candidate));
const browser = await chromium.launch({ headless: true, executablePath: installedBrowser });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
await page.goto(`file:///${deckHtmlPath.replace(/\\/g, "/")}`, { waitUntil: "load" });
await page.pdf({ path: path.join(outDir, "Warehouse-Wizard-Client-Training-60-Minutes.pdf"), width: "13.333in", height: "7.5in", printBackground: true, margin: { top: 0, right: 0, bottom: 0, left: 0 } });
await page.goto(`file:///${manualHtmlPath.replace(/\\/g, "/")}`, { waitUntil: "load" });
await page.pdf({ path: path.join(outDir, "Warehouse-Wizard-User-Manual.pdf"), format: "Letter", printBackground: true, displayHeaderFooter: false, margin: { top: 0, right: 0, bottom: 0, left: 0 } });
await page.goto(`file:///${quickHtmlPath.replace(/\\/g, "/")}`, { waitUntil: "load" });
await page.pdf({ path: path.join(outDir, "Warehouse-Wizard-Quick-Reference.pdf"), format: "Letter", printBackground: true, margin: { top: 0, right: 0, bottom: 0, left: 0 } });
await browser.close();

const manifest = {
  generatedAt: new Date().toISOString(),
  productVersion: "1.27",
  totalPresentationMinutes: slides.reduce((sum, s) => sum + s.time, 0),
  slideCount: slides.length,
  manualSections: manualIndex.length,
  files: fs.readdirSync(outDir).sort(),
};
fs.writeFileSync(path.join(outDir, "training-materials-manifest.json"), JSON.stringify(manifest, null, 2));
console.log(JSON.stringify(manifest, null, 2));
