import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import PptxGenJS from "pptxgenjs";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "docs", "training", "artifacts");
const assetDir = path.join(root, "docs", "training", "assets");
const teamHuddleImage = path.join(assetDir, "warehouse-team-huddle.png");
fs.mkdirSync(outDir, { recursive: true });

const C = { navy: "123247", dark: "0B2434", teal: "0F9D96", teal2: "087B76", orange: "F47C20", yellow: "FFC928", ink: "16303D", gray: "667985", line: "D7E2E6", mist: "EFF7F7", sand: "FFF3DF", white: "FFFFFF", red: "C93C3C", green: "2F8F5B" };

const modules = [
  { id:"dashboard", title:"Dashboard", group:"ORIENTATION", time:2, users:"Managers · Supervisors · Clerks · Operators", purpose:"Start from live inbound, storage, outbound, capacity, and exception signals.", normal:["Select active warehouse and Floor, Dock, or Office view","Read open work and exceptions","Open the source module for live detail"], handoff:"Manager sets priority; operator opens the assigned queue.", avoid:"Do not use an aggregate tile as evidence for a pallet decision." },
  { id:"warehouses", title:"Warehouses", group:"STRUCTURE + MASTER DATA", time:1, users:"Admins · Warehouse Managers", purpose:"Define the top-level physical facilities used by all warehouse activity.", normal:["Create one stable unique facility code","Maintain identity, location context, status, and cool capability","Confirm the facility exists physically as configured"], handoff:"Build zones and locations before releasing work.", avoid:"Do not duplicate codes or disable a facility with dependent work." },
  { id:"clients", title:"Clients", group:"STRUCTURE + MASTER DATA", time:1, users:"Admins · Warehouse Managers", purpose:"Identify who owns 3PL stock and which commercial handling rules apply.", normal:["Maintain short stable client codes","Set ownership, expiry, and mixed-stock controls","Deactivate rather than delete historical context"], handoff:"Products and Receiving select the verified owner.", avoid:"Never receive stock under a guessed client." },
  { id:"zones", title:"Zones", group:"STRUCTURE + MASTER DATA", time:1, users:"Admins · Warehouse Managers", purpose:"Group space by workflow purpose and temperature class.", normal:["Separate Receiving, Picking, Dispatch, Quarantine, Bulk, Cool/Frozen uses","Set temperature and no-normal-stock flags","Verify zone purpose against the floor"], handoff:"Generate exact bin locations and labels.", avoid:"Do not mix staging, dispatch, and quarantine rules for convenience." },
  { id:"bin-locations", title:"Bin Locations", group:"STRUCTURE + MASTER DATA", time:1, users:"Admins · Warehouse Managers", purpose:"Define exact cells used for storage, picks, moves, counts, and capacity.", normal:["Maintain aisle, bay, level, position/depth, sequence, and capacity","Print exact-cell and bay labels","Keep active status and physical rack aligned"], handoff:"Operators consume the labels in execution modules.", avoid:"Never change a code without replacing the floor label." },
  { id:"products", title:"Products", group:"STRUCTURE + MASTER DATA", time:1, users:"Admins · Managers · Inventory Clerks", purpose:"Define SKU identity, owner, rotation, tracking, temperature, and handling.", normal:["Create/import verified SKU, name, owner, and barcode","Set FIFO/FEFO, lot/expiry, and temperature controls","Hide discontinued items; preserve history"], handoff:"Create the correct Packaging Profile before Receiving.", avoid:"No guessed SKUs, duplicate barcodes, or unknown rotation values." },
  { id:"packaging-profiles", title:"Packaging Profiles", group:"STRUCTURE + MASTER DATA", time:1, users:"Admins · Managers · Inventory Clerks", purpose:"Connect each/case/pallet units and barcodes to physical receiving quantities.", normal:["Configure pack sizes, dimensions, weights, and barcodes","Keep one appropriate default profile","Verify values against the physical pack"], handoff:"Receiving interprets scans and quantities from the profile.", avoid:"Multiple defaults or incorrect units-per-package create downstream defects." },
  { id:"receiving", title:"Receiving", group:"INBOUND + STORAGE", time:3, users:"Admins · Managers · Inventory Clerks", purpose:"Create receipt, pallet identity, traceability, labels, and Put-Away work.", normal:["Warehouse/container/PO → product scan + commit","Physical total → qty/pallet → pallets → expiry/lot","Verify once → receive → print labels → release Put-Away"], handoff:"Each labeled pallet has a Put-Away task or identifiable Saved Draft.", avoid:"Do not guess SKU/count, skip the commit arrow, or post offline." },
  { id:"putaway", title:"Put-Away", group:"INBOUND + STORAGE", time:2, users:"Admins · Managers · Clerks · Operators", purpose:"Store one identified pallet in one exact eligible cell and make it available.", normal:["Select task and scan pallet","Scan exact location or select exact bay cell","Verify safety/capacity/temperature → place → confirm once"], handoff:"Task clears and Inventory Search shows the stored location.", avoid:"A bay code is not final; never force a blocked or stale destination." },
  { id:"inventory-search", title:"Inventory Search", group:"INVENTORY CONTROL", time:2, users:"All approved operational roles", purpose:"Provide the live pallet truth: quantity, status, owner, lot, location, and history.", normal:["Search pallet, SKU, lot, warehouse, zone, or location","Open detail and movement history","Compare the record with the physical floor"], handoff:"Verified facts justify the next pick, move, transfer, status, or count action.", avoid:"Do not act from memory, paper, dashboard totals, or hidden filters." },
  { id:"pick-lists", title:"Pick Lists", group:"OUTBOUND", time:3, users:"Managers · Supervisors · Operators", purpose:"Plan, release, assign, and execute outbound whole-pallet work.", normal:["Manager verifies demand, stock, staging, owner, and due time","Release executable whole-pallet tasks","Operator scans assigned location + pallet → confirms → stages"], handoff:"Completed pallets move to the directed outbound lane.", avoid:"No short release, normal pallet split, or forced quantity mismatch." },
  { id:"transfers", title:"Transfers", group:"MOVEMENT + HANDOFF", time:2, users:"Managers · Clerks · Supervisors · Dispatch Drivers", purpose:"Move pallet identity across warehouse boundaries with signed handoffs.", normal:["Create and stage the verified pallet/route","Driver signs after physical departure","Destination receives and immediately triggers Put-Away"], handoff:"Destination Receiving and Put-Away finish the journey.", avoid:"Do not sign before departure or strand received stock in a lane." },
  { id:"location-moves", title:"Location Moves", group:"MOVEMENT + HANDOFF", time:1, users:"Managers · Clerks · Supervisors · Operators", purpose:"Relocate a pallet inside the same warehouse with full movement history.", normal:["Scan pallet and verify live state","Scan/type/Browse bays; select exact eligible cell","Move physically → confirm once → verify Inventory Search"], handoff:"Inventory now points to the exact destination.", avoid:"Different warehouse means Transfer, not Location Move." },
  { id:"cycle-counts", title:"Cycle Counts", group:"INVENTORY CONTROL", time:2, users:"Managers · Clerks · Supervisors · Operators", purpose:"Run blind physical counts and controlled variance review.", normal:["Manager scopes and assigns CCT work","Operator verifies location and submits the true physical count online","Supervisor reviews threshold variance, notes, and exceptions"], handoff:"Approved corrections update stock and produce root-cause work.", avoid:"Do not count the expected value or approve stale post-reconnect state." },
  { id:"statuses", title:"Statuses", group:"INVENTORY CONTROL", time:2, users:"Managers · Supervisors · Inventory Clerks", purpose:"Keep Available, Hold, Quarantine, Damaged, and Missing stock visible and controlled.", normal:["Verify pallet and physical condition","Choose only the justified status and enter a reason","Add System Log ownership when follow-up is required"], handoff:"Status controls availability and the next authorized action.", avoid:"Do not mark Damaged/Missing on assumption or release without verification." },
  { id:"reports", title:"Reports", group:"MANAGEMENT + ADMIN", time:1, users:"Admins · Managers · Supervisors · Clerks", purpose:"Show management snapshots for stock, occupancy, expiry, movement, and variance.", normal:["Review the relevant current report","Identify the material trend or bottleneck","Drill into the operational module or Inventory Search"], handoff:"Assign an action owner and verify later performance.", avoid:"Reports do not replace live transactional detail." },
  { id:"users-roles", title:"Users & Roles", group:"MANAGEMENT + ADMIN", time:1, users:"Admins", purpose:"Create, approve, authorize, badge/PIN-enable, disable, and audit access.", normal:["Create/approve the user","Assign least privilege and issue approved credentials","Test access; hide role or disable profile non-destructively"], handoff:"Reassign open work before access changes.", avoid:"No shared credentials, excessive roles, deletion, or mid-task disablement." },
  { id:"system-log", title:"System Log", group:"MANAGEMENT + ADMIN", time:1, users:"Admins · Warehouse Managers", purpose:"Track operational issues, RF alerts, support notes, ownership, and resolution.", normal:["Review evidence and severity","Assign the correct owner and investigate underlying records","Resolve only after the physical/system condition is corrected"], handoff:"Quality, client, IT, or warehouse follow-up reaches accountable closure.", avoid:"A log note does not replace the required inventory/status transaction." },
  { id:"email-log", title:"Email Log", group:"MANAGEMENT + ADMIN", time:1, users:"Admins", purpose:"Show outbound message attempts, recipients, templates, status, and errors.", normal:["Find the user/message attempt","Read recipient, template, delivery state, and error","Correct the cause; retry or escalate provider/DNS/suppression"], handoff:"Confirm delivery before telling the user it succeeded.", avoid:"Do not retry repeatedly without reading the failure." },
  { id:"settings", title:"Settings", group:"MANAGEMENT + ADMIN", time:1, users:"Admins · Warehouse Managers", purpose:"Group Warehouse Structure, Users & Roles, release guidance, setup, and controlled administration.", normal:["Open the relevant tab only","Make the narrow intended configuration change","Verify downstream labels, access, and operational behavior"], handoff:"Return to the affected module and prove normal work still works.", avoid:"No reset without a rebuild plan or structure change without labels." },
  { id:"help-center", title:"Help Center", group:"ORIENTATION", time:1, users:"All approved users", purpose:"Provide current contextual and searchable guidance across the system.", normal:["Open contextual Help from the current module","Review key actions, mistakes, and linked articles","Search by workflow, module, error, or operational term"], handoff:"Return only when the normal next action is clear; escalate dead ends.", avoid:"Do not rely on an outdated printout or one exact search phrase." },
  { id:"setup-wizard", title:"Setup Wizard", group:"STRUCTURE + MASTER DATA", time:1, users:"Admins · Warehouse Managers", purpose:"Create or extend facilities, zones, and generated bin locations from a reviewed design.", normal:["Define facilities → zones → location rules","Review totals and codes before creation","Create → print/install labels → verify Warehouse Structure"], handoff:"Prepare products/packaging, then release operational work.", avoid:"It is not a routine correction tool after go-live; never run without the physical plan." },
];

const specialSlides = {
  cover:{ title:"Warehouse Wizard System Tour", subtitle:"Where the work your team already does lives in the system", time:1, notes:"Open by saying: ‘This is a tour, not a test. You already know the warehouse; we are simply finding where each familiar job lives in Warehouse Wizard.’" },
  outcomes:{ title:"This is a tour, not a test", time:2, cards:[["FAMILIAR WORK","Start with what happens on your floor"],["SHARED RECORD","See where the system remembers it"],["CLEAR OWNERSHIP","Know who normally works in each area"],["VISIBLE HANDOFF","See who receives the work next"]], notes:"Invite participants to describe their own terms and routines. Use those words first, then connect them to the system. Nobody needs to memorize all 22 modules." },
  map:{ title:"Four neighborhoods make the system easier to remember", time:3, groups:[["SEE THE DAY","Dashboard · Help Center"],["SET UP THE FLOOR","Warehouses · Clients · Zones · Locations · Products · Packaging · Setup"],["MOVE THE STOCK","Receiving · Put-Away · Inventory · Picks · Transfers · Moves · Counts · Status"],["KEEP THE TEAM INFORMED","Reports · Users · System Log · Email Log · Settings"]], notes:"Use ‘neighborhoods’ rather than a software map. Ask which group feels closest to each person’s day. Role access may hide modules that are not part of their work." },
  day:{ title:"A normal day moves through the system just as it moves across the floor", time:3, flow:["Agree priorities","Receive + label","Put away","Find + verify","Pick / move / transfer","Handle exceptions","Close the shift"], notes:"Ask the team to tell the story in their own words. Explain that every handoff preserves one pallet identity and Inventory Search helps everyone pick up the same story." },
  practice:{ title:"Which part of the system would you reach for?", time:2, prompts:["Same warehouse relocation? → Location Moves","Different facility? → Transfers","Unknown SKU? → Products + Packaging","Short pick pallet? → Inventory + Status + System Log","Unreadable label? → Verify, then reprint same identity","Rising quarantine? → Dashboard/Reports, then Status detail"], notes:"Let the room answer from experience. If the answer differs, ask why before showing the system path; there may be a valuable site-specific process to record." },
  close:{ title:"Your team knows the warehouse. The system keeps that knowledge visible.", time:2, resources:["System Tour — where familiar work lives","End-to-End deck — follow one pallet together","WW-UM-001 — detailed reference when needed","In-app Help Center — guidance beside the live task"], notes:"Thank the room for the operational knowledge they brought. Orientation shows where; confidence comes from a supported first run using their own stock and situations." },
};

const slides = [specialSlides.cover, specialSlides.outcomes, specialSlides.map, ...modules, specialSlides.day, specialSlides.practice, specialSlides.close];
const totalMinutes = slides.reduce((sum, slide) => sum + slide.time, 0);
if (totalMinutes !== 45) throw new Error(`System overview must total 45 minutes; got ${totalMinutes}.`);

const pptx = new PptxGenJS();
pptx.layout = "LAYOUT_WIDE";
pptx.author = "Warehouse Wizard";
pptx.company = "Warehouse Wizard";
pptx.subject = "Module-by-module system overview training";
pptx.title = "Warehouse Wizard System Overview";
pptx.lang = "en-US";
pptx.theme = { headFontFace: "Aptos Display", bodyFontFace: "Aptos", lang: "en-US" };

function header(slide, title, i, time, group) {
  slide.background = { color: C.white };
  slide.addShape(pptx.ShapeType.rect, { x:0, y:0, w:.14, h:7.5, fill:{color:C.teal}, line:{color:C.teal} });
  slide.addText(title, { x:.62, y:.42, w:10.9, h:.48, fontFace:"Aptos Display", fontSize:25, bold:true, color:C.navy, margin:0, fit:"shrink" });
  slide.addText(`${time} min`, { x:11.7, y:.48, w:.85, h:.25, fontSize:9, bold:true, color:C.teal2, align:"right", margin:0 });
  if (group) slide.addText(group, { x:.64, y:1.05, w:4.4, h:.24, fontSize:10, bold:true, color:C.orange, charSpacing:1.3, margin:0 });
  slide.addText(`Product 1.27`, { x:.62, y:7.08, w:1.2, h:.2, fontSize:8, color:C.gray, margin:0 });
  slide.addText(`${i+1} / ${slides.length}`, { x:11.8, y:7.08, w:.8, h:.2, fontSize:8, color:C.gray, align:"right", margin:0 });
}

function card(slide, label, text, x, y, w, h, accent=C.teal) {
  slide.addShape(pptx.ShapeType.roundRect, { x,y,w,h,rectRadius:.06,fill:{color:C.white},line:{color:C.line,width:1.2},shadow:{type:"outer",color:"9DAFB7",blur:1,angle:45,distance:1,opacity:.12} });
  slide.addShape(pptx.ShapeType.rect, { x,y,w:.08,h,fill:{color:accent},line:{color:accent} });
  slide.addText(label, { x:x+.25,y:y+.2,w:w-.45,h:.28,fontSize:12,bold:true,color:accent,charSpacing:.8,margin:0 });
  slide.addText(text, { x:x+.25,y:y+.68,w:w-.45,h:h-.87,fontSize:17,bold:true,color:C.ink,margin:0,valign:"mid",fit:"shrink" });
}

slides.forEach((s,i) => {
  const slide=pptx.addSlide();
  slide.addNotes(`Timing: ${s.time} minute(s)\n${s.notes || `Ask how the team handles this work today. Then show ${s.title} as the place where that familiar decision is recorded, who normally uses it, what happens next, and when an experienced person would pause.`}`);
  if (s===specialSlides.cover) {
    slide.background={color:C.dark};
    slide.addImage({path:teamHuddleImage,x:0,y:0,w:13.333,h:7.5});
    slide.addShape(pptx.ShapeType.rect,{x:0,y:0,w:13.333,h:7.5,fill:{color:C.dark,transparency:38},line:{color:C.dark,transparency:100}});
    slide.addShape(pptx.ShapeType.rect,{x:0,y:0,w:7.4,h:7.5,fill:{color:C.dark,transparency:8},line:{color:C.dark,transparency:100}});
    slide.addText("WAREHOUSE WIZARD",{x:.85,y:1.0,w:4,h:.35,fontSize:14,bold:true,color:C.yellow,charSpacing:2.2,margin:0});
    slide.addText("System Tour",{x:.82,y:1.72,w:6.2,h:.75,fontSize:43,bold:true,color:C.white,margin:0});
    slide.addText("Where the work your team already does lives in Warehouse Wizard",{x:.85,y:3.1,w:5.9,h:.8,fontSize:21,color:"BFE7E5",margin:0,fit:"shrink"});
    slide.addShape(pptx.ShapeType.roundRect,{x:.85,y:4.65,w:2.2,h:.5,rectRadius:.06,fill:{color:C.orange},line:{color:C.orange}});
    slide.addText("45 MINUTES",{x:1.02,y:4.81,w:1.85,h:.2,fontSize:12,bold:true,color:C.white,align:"center",margin:0});
    slide.addText(`1 / ${slides.length}`,{x:11.7,y:7.05,w:.9,h:.2,fontSize:8,color:C.gray,align:"right",margin:0});
    return;
  }
  header(slide,s.title,i,s.time,s.group);
  if (s.cards) s.cards.forEach((c,n)=>card(slide,c[0],c[1],.7+(n%2)*6.08,1.55+Math.floor(n/2)*2.35,5.55,1.85,[C.teal,C.orange,C.navy,C.green][n]));
  else if (s.groups) s.groups.forEach((g,n)=>card(slide,g[0],g[1],.7+(n%2)*6.08,1.55+Math.floor(n/2)*2.35,5.55,1.85,[C.teal,C.orange,C.navy,C.green][n]));
  else if (s.purpose) {
    slide.addShape(pptx.ShapeType.roundRect,{x:.72,y:1.48,w:11.85,h:1.0,rectRadius:.05,fill:{color:C.mist},line:{color:C.teal,width:1.2}});
    slide.addText("WHAT LIVES HERE",{x:1.0,y:1.76,w:1.4,h:.25,fontSize:11,bold:true,color:C.teal2,charSpacing:1,margin:0});
    slide.addText(s.purpose,{x:2.65,y:1.68,w:9.45,h:.42,fontSize:20,bold:true,color:C.navy,margin:0,fit:"shrink"});
    slide.addText("WHO USUALLY WORKS HERE",{x:.86,y:2.82,w:2.3,h:.25,fontSize:11,bold:true,color:C.orange,charSpacing:.8,margin:0});
    slide.addText(s.users,{x:3.35,y:2.78,w:8.55,h:.32,fontSize:16,bold:true,color:C.ink,margin:0,fit:"shrink"});
    slide.addText("A NORMAL VISIT LOOKS LIKE",{x:.86,y:3.42,w:2.5,h:.25,fontSize:11,bold:true,color:C.teal2,charSpacing:.8,margin:0});
    s.normal.forEach((x,n)=>{const y=3.9+n*.72;slide.addShape(pptx.ShapeType.ellipse,{x:1.0,y,w:.42,h:.42,fill:{color:n===2?C.orange:C.teal},line:{color:C.white,width:1}});slide.addText(String(n+1),{x:1.0,y:y+.1,w:.42,h:.18,fontSize:11,bold:true,color:C.white,align:"center",margin:0});slide.addText(x,{x:1.65,y:y+.03,w:10.2,h:.3,fontSize:17,color:C.ink,margin:0,fit:"shrink"});});
    slide.addShape(pptx.ShapeType.roundRect,{x:.78,y:6.15,w:5.68,h:.62,rectRadius:.04,fill:{color:C.mist},line:{color:C.line}});
    slide.addText(`WHAT HAPPENS NEXT  ${s.handoff}`,{x:1.0,y:6.34,w:5.25,h:.24,fontSize:11.5,bold:true,color:C.teal2,margin:0,fit:"shrink"});
    slide.addShape(pptx.ShapeType.roundRect,{x:6.72,y:6.15,w:5.68,h:.62,rectRadius:.04,fill:{color:C.sand},line:{color:C.yellow}});
    slide.addText(`WATCH-OUT  ${s.avoid}`,{x:6.94,y:6.34,w:5.25,h:.24,fontSize:11.5,bold:true,color:C.red,margin:0,fit:"shrink"});
  } else if (s.flow) {
    s.flow.forEach((x,n)=>{const px=.48+n*1.82;slide.addShape(pptx.ShapeType.roundRect,{x:px,y:2.15,w:1.5,h:1.6,rectRadius:.05,fill:{color:n%2?C.mist:C.white},line:{color:n===s.flow.length-1?C.orange:C.teal,width:1.6}});slide.addText(String(n+1).padStart(2,"0"),{x:px+.12,y:2.35,w:.4,h:.2,fontSize:9,bold:true,color:C.gray,margin:0});slide.addText(x,{x:px+.15,y:2.78,w:1.2,h:.55,fontSize:13,bold:true,color:C.navy,align:"center",margin:0,fit:"shrink"});if(n<s.flow.length-1)slide.addShape(pptx.ShapeType.chevron,{x:px+1.51,y:2.68,w:.31,h:.46,fill:{color:C.yellow},line:{color:C.yellow}});});
    slide.addText("One pallet identity · clear handoff · live verification before the next consequential action",{x:1.0,y:4.75,w:11.3,h:.55,fontSize:20,bold:true,color:C.teal2,align:"center",margin:0});
  } else if (s.prompts) {
    s.prompts.forEach((x,n)=>card(slide,`DECISION ${n+1}`,x,.72+(n%2)*6.05,1.45+Math.floor(n/2)*1.72,5.55,1.3,n===3?C.orange:C.teal));
  } else if (s.resources) {
    s.resources.forEach((x,n)=>{const y=1.7+n*.95;slide.addShape(pptx.ShapeType.ellipse,{x:1.1,y,w:.48,h:.48,fill:{color:C.teal},line:{color:C.teal}});slide.addText("✓",{x:1.1,y:y+.1,w:.48,h:.2,fontSize:14,bold:true,color:C.white,align:"center",margin:0});slide.addText(x,{x:1.85,y:y+.05,w:9.7,h:.35,fontSize:20,color:C.ink,margin:0});});
    slide.addShape(pptx.ShapeType.roundRect,{x:1.0,y:5.9,w:11.2,h:.72,rectRadius:.06,fill:{color:C.navy},line:{color:C.navy}});
    slide.addText("The work is familiar. The system makes the handoff easier to see.",{x:1.35,y:6.14,w:10.5,h:.25,fontSize:18,bold:true,color:C.yellow,align:"center",margin:0});
  }
});

const pptxPath=path.join(outDir,"Warehouse-Wizard-System-Overview-Training.pptx");
await pptx.writeFile({fileName:pptxPath});

function esc(v){return String(v??"").replace(/[&<>\"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'\"':"&quot;"}[c]));}
function moduleHtml(m,i){return `<section class="slide"><header><span>${esc(m.group)}</span><small>${m.time} min</small></header><h1>${esc(m.title)}</h1><div class="purpose"><b>WHAT LIVES HERE</b><span>${esc(m.purpose)}</span></div><div class="users"><b>WHO USUALLY WORKS HERE</b> ${esc(m.users)}</div><h2>A NORMAL VISIT LOOKS LIKE</h2><ol>${m.normal.map(x=>`<li>${esc(x)}</li>`).join("")}</ol><div class="bottom"><div><b>WHAT HAPPENS NEXT</b>${esc(m.handoff)}</div><div class="avoid"><b>WATCH-OUT</b>${esc(m.avoid)}</div></div><footer>Product 1.27 <span>${i+1} / ${slides.length}</span></footer></section>`;}
function specialHtml(s,i){let body="";if(s.cards)body=`<div class="grid">${s.cards.map(x=>`<div class="card"><b>${esc(x[0])}</b><span>${esc(x[1])}</span></div>`).join("")}</div>`;if(s.groups)body=`<div class="grid">${s.groups.map(x=>`<div class="card"><b>${esc(x[0])}</b><span>${esc(x[1])}</span></div>`).join("")}</div>`;if(s.flow)body=`<div class="flow">${s.flow.map((x,n)=>`<div><small>${n+1}</small><b>${esc(x)}</b></div>`).join("<em>›</em>")}</div><div class="tagline">One pallet identity · clear handoff · live verification</div>`;if(s.prompts)body=`<div class="grid three">${s.prompts.map((x,n)=>`<div class="card"><b>DECISION ${n+1}</b><span>${esc(x)}</span></div>`).join("")}</div>`;if(s.resources)body=`<ul class="resources">${s.resources.map(x=>`<li>${esc(x)}</li>`).join("")}</ul><div class="tagline">Orientation tells you where. Competency proves you can do the work.</div>`;return `<section class="slide ${s===specialSlides.cover?"cover":""}"><header><span>WAREHOUSE WIZARD</span><small>${s.time} min</small></header><h1>${esc(s.title)}</h1>${s.subtitle?`<h3>${esc(s.subtitle)}</h3>`:""}${body}<footer>Product 1.27 <span>${i+1} / ${slides.length}</span></footer></section>`;}
const css=`@page{size:13.333in 7.5in;margin:0}*{box-sizing:border-box}body{margin:0;background:#cad6da;font-family:Aptos,Arial;color:#16303d}.slide{width:13.333in;height:7.5in;page-break-after:always;background:white;position:relative;padding:.4in .58in .35in .72in;border-left:.14in solid #0f9d96;overflow:hidden}.slide header{display:flex;justify-content:space-between;font-size:10pt;color:#087b76;font-weight:700;letter-spacing:1.5px}.slide h1{font-size:29pt;color:#123247;margin:.22in 0 .25in}.slide footer{position:absolute;left:.72in;right:.35in;bottom:.15in;font-size:8pt;color:#667985;display:flex;justify-content:space-between}.cover{background:linear-gradient(90deg,rgba(11,36,52,.96) 0%,rgba(11,36,52,.82) 50%,rgba(11,36,52,.3) 100%),url('../assets/warehouse-team-huddle.png') center/cover no-repeat;color:white}.cover h1{color:white;font-size:44pt;margin-top:1.1in;max-width:6.5in}.cover h3{font-size:22pt;color:#bfe7e5;max-width:6.2in}.purpose{background:#eff7f7;border:1px solid #0f9d96;border-radius:9px;padding:.2in;display:grid;grid-template-columns:1.45in 1fr;align-items:center}.purpose b,.users b,h2{color:#087b76;font-size:11pt;letter-spacing:1px}.purpose span{font-size:19pt;font-weight:700}.users{font-size:16pt;margin:.25in 0}.slide h2{font-size:11pt;margin:.2in 0 .1in}.slide ol{font-size:17pt;line-height:1.45;margin:.05in 0 .15in}.bottom{display:grid;grid-template-columns:1fr 1fr;gap:.22in}.bottom div{border:1px solid #d7e2e6;background:#eff7f7;border-radius:8px;padding:.14in;font-size:11pt;font-weight:700;color:#087b76}.bottom b{display:block;font-size:9pt;letter-spacing:1px;margin-bottom:4px}.bottom .avoid{background:#fff3df;color:#c93c3c}.grid{display:grid;grid-template-columns:1fr 1fr;gap:.22in;margin-top:.7in}.grid.three{grid-template-columns:1fr 1fr}.card{border:1px solid #d7e2e6;border-left:7px solid #0f9d96;border-radius:10px;padding:.22in;min-height:1.35in;box-shadow:0 4px 9px #12324715}.card b{display:block;color:#087b76;font-size:12pt;letter-spacing:1px;margin-bottom:.15in}.card span{font-size:17pt;font-weight:700}.flow{display:flex;align-items:center;gap:.1in;margin-top:1.2in}.flow div{border:2px solid #0f9d96;border-radius:9px;padding:.15in;text-align:center;min-width:1.5in;height:1.4in}.flow small,.flow b{display:block}.flow b{margin-top:.25in}.flow em{font-size:25pt;color:#ffc928;font-style:normal}.tagline{background:#123247;color:#ffc928;border-radius:9px;padding:.18in;text-align:center;font-size:19pt;font-weight:800;margin-top:.55in}.resources{font-size:20pt;line-height:1.75;margin-top:.8in}.resources li::marker{color:#0f9d96}`;
const html=`<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>${slides.map((s,i)=>s.purpose?moduleHtml(s,i):specialHtml(s,i)).join("")}</body></html>`;
const htmlPath=path.join(outDir,"Warehouse-Wizard-System-Overview-Training.html");
fs.writeFileSync(htmlPath,html);

const browserPath=["C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe","C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe","C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe"].find(fs.existsSync);
const browser=await chromium.launch({headless:true,executablePath:browserPath});
const page=await browser.newPage({viewport:{width:1280,height:720}});
await page.goto(`file:///${htmlPath.replace(/\\/g,"/")}`,{waitUntil:"load"});
await page.pdf({path:path.join(outDir,"Warehouse-Wizard-System-Overview-Training.pdf"),width:"13.333in",height:"7.5in",printBackground:true,margin:{top:0,right:0,bottom:0,left:0}});
await browser.close();

fs.writeFileSync(path.join(outDir,"Warehouse-Wizard-System-Overview-AI-Index.json"),JSON.stringify({documentId:"WW-SO-001",productVersion:"1.27",totalMinutes,modules:modules.map(m=>({id:`module-${m.id}`,...m}))},null,2));
console.log(JSON.stringify({slideCount:slides.length,moduleCount:modules.length,totalMinutes,files:[path.basename(pptxPath),path.basename(htmlPath),"Warehouse-Wizard-System-Overview-Training.pdf","Warehouse-Wizard-System-Overview-AI-Index.json"]},null,2));
