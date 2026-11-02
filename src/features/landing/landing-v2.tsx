import { useEffect, useRef, useState, type MouseEvent } from "react";
import { Link, useLocation } from "react-router-dom";
import * as Dialog from "@radix-ui/react-dialog";
import { ArrowDown, ArrowRight, ArrowUp, Box, Check, CheckCheck, Cloud, Layers3, LockKeyhole, Network, ScanLine, Sparkles, Warehouse } from "lucide-react";
import { useTenantPath } from "@/hooks/use-tenant-path";
import { DemoModal } from "./demo-request";
import { ADAPTATIONS, V2_FAQS } from "./landing-v2-data";
import "./landing-v2.css";

const BENEFITS = [
  { Icon: ScanLine, title: "Easy to follow", copy: "Scan, confirm and move on. Keep decisions clear at the point of work." },
  { Icon: Cloud, title: "Fast, cloud-based access", copy: "Open the workspace on a phone, tablet or desktop. Manage software updates centrally." },
  { Icon: LockKeyhole, title: "Access with accountability", copy: "Authenticated users, assigned roles and warehouse-level controls keep access tied to responsibility." },
  { Icon: Layers3, title: "Ready for your next change", copy: "Adjust locations, capacity and pack standards as the business evolves. Scope new flows and integrations when you need them." },
];

export default function LandingV2() {
  const { toPath } = useTenantPath();
  const { hash } = useLocation();
  useEffect(() => {
    if (!hash) { window.scrollTo(0, 0); return; }
    const target = document.getElementById(hash.slice(1));
    if (target instanceof HTMLDetailsElement) target.open = true;
    target?.scrollIntoView({ block: "start" });
  }, [hash]);
  const [demoOpen, setDemoOpen] = useState(false);
  const [active, setActive] = useState(1);
  const invoker = useRef<HTMLButtonElement | null>(null);
  const openDemo = (event: MouseEvent<HTMLButtonElement>) => { invoker.current = event.currentTarget; setDemoOpen(true); };
  const setup = ADAPTATIONS[active];
  return <Dialog.Root open={demoOpen} onOpenChange={setDemoOpen}>
    <div className="ww-v2" id="v2-top">
      <a className="v2-skip" href="#v2-main">Skip to content</a>
      <header className="v2-header">
        <div className="v2-header-inner">
          <a className="v2-brand" href="#v2-top"><img src="/logo-mark.svg" width="32" height="32" alt="" />Warehouse Wizard</a>
          <nav aria-label="Main navigation"><a href="#confidence">Why it matters</a><a href="#adaptable">Your operation</a><a href="#connected">Connections</a></nav>
          <div className="v2-header-actions"><Link to={toPath("/login")}>Sign in</Link><button className="v2-button v2-button-small" onClick={openDemo}>Request a demo</button></div>
        </div>
      </header>
      <main id="v2-main" tabIndex={-1}>
        <section className="v2-hero v2-wrap" aria-labelledby="v2-title">
          <div className="v2-hero-copy">
            <p className="v2-intro"><span />Inventory confidence. Built around you.</p>
            <h1 id="v2-title">Your system says it’s in stock.<br />Is it?</h1>
            <p className="v2-lead">Stop letting uncertain inventory make promises your warehouse can’t keep.</p>
            <p className="v2-hero-description">Connect your ERP or accounting system to what actually happens on the floor. Warehouse Wizard adapts to your stock, your spaces and your people—so you can focus on selling and buying with confidence.</p>
            <div className="v2-actions"><button className="v2-button" onClick={openDemo}>Request a demo <ArrowRight size={18} aria-hidden="true" /></button><a className="v2-text-link" href="#adaptable">See how it fits <ArrowDown size={16} aria-hidden="true" /></a></div>
            <p className="v2-quiet">Your existing system. A more confident warehouse.</p>
          </div>
          <div className="v2-inventory-scene" role="img" aria-label="Illustration: business systems connected to a warehouse where each receipt, location and pick is verified. Illustrative workflow, not live data.">
            <div className="v2-scene-header"><span><span className="v2-dot" />From records to reality</span><span>Illustrative workflow</span></div>
            <div className="v2-system-row"><div><Layers3 size={22} aria-hidden="true" /><span>Your ERP<br /><small>Sales · purchasing · accounts</small></span></div><span className="v2-connect-line" /><span className="v2-api-label">API</span></div>
            <div className="v2-wizard-node"><img src="/logo-mark.svg" width="38" height="38" alt="" /><div>Warehouse Wizard<small>The connection to your warehouse floor</small></div><CheckCheck size={24} aria-hidden="true" /></div>
            <div className="v2-warehouse-map">
              <div className="v2-map-title"><Warehouse size={18} aria-hidden="true" /><strong>Your warehouse. Your layout.</strong></div>
              <div className="v2-storage"><div className="v2-dock"><ScanLine size={22} aria-hidden="true" /><span>Receive</span></div><div className="v2-racks">{['A','B','C'].map(row=><div key={row}><span>{row}</span>{[1,2,3,4].map(bay=><i key={bay}><Box size={18} aria-hidden="true" /></i>)}</div>)}</div><div className="v2-dock"><CheckCheck size={22} aria-hidden="true" /><span>Dispatch</span></div></div>
              <div className="v2-verified"><span><Check size={14} aria-hidden="true" />Receipt checked</span><span><Check size={14} aria-hidden="true" />Location confirmed</span><span><Check size={14} aria-hidden="true" />Pick verified</span></div>
            </div>
            <div className="v2-scene-foot"><LockKeyhole size={14} aria-hidden="true" /><span>Guided actions. Accountable movements.</span></div>
          </div>
        </section>
        <div className="v2-promise-strip"><div className="v2-wrap"><span><Network size={18} aria-hidden="true" />ERP & accounting adaptable</span><span><Warehouse size={18} aria-hidden="true" />One warehouse or many</span><span><Cloud size={18} aria-hidden="true" />Cloud hosted</span><span><Sparkles size={18} aria-hidden="true" />MCP-ready reporting</span></div></div>
        <section id="confidence" className="v2-confidence v2-wrap">
          <div><p className="v2-kicker">The cost of “probably”</p><h2>Every uncertain number<br />becomes someone’s problem.</h2><p>A sale you can’t fulfil. Stock you buy twice. Time spent hunting for something that should be right there.</p></div>
          <div className="v2-questions">{[['“We have it.”', 'But can your team find it?'], ['“We ordered enough.”', 'But was the stock figure right?'], ['“It should balance.”', 'But who can explain the difference?']].map(([claim, question])=><div key={claim}><h3>{claim}</h3><p>{question}</p></div>)}</div>
        </section>
        <section id="adaptable" className="v2-adapt-section">
          <div className="v2-wrap v2-adapt-grid">
            <div><p className="v2-kicker">Fits the business you run</p><h2>Your warehouse doesn’t<br />have to fit a template.</h2><p>Adapt the system to your operation, from the size of a storage bay to the way stock moves between sites.</p><div className="v2-tabs" role="tablist" aria-label="Ways Warehouse Wizard adapts">{ADAPTATIONS.map((item,i)=><button key={item.title} role="tab" id={`adapt-tab-${i}`} aria-controls="adapt-panel" aria-selected={active===i} tabIndex={active===i?0:-1} onClick={()=>setActive(i)} onKeyDown={event=>{if(['ArrowRight','ArrowLeft','Home','End'].includes(event.key)){event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?2:(active+(event.key==='ArrowRight'?1:2))%3;setActive(next);document.getElementById(`adapt-tab-${next}`)?.focus();}}}>{item.title}</button>)}</div><div id="adapt-panel" role="tabpanel" aria-labelledby={`adapt-tab-${active}`} tabIndex={0}><h3>{setup.title}, on your terms.</h3><p>{setup.copy}</p><ul className="v2-tags">{setup.tags.map(tag=><li key={tag}><Check size={14} aria-hidden="true" />{tag}</li>)}</ul></div></div>
            <div className="v2-setup-visual" aria-live="polite"><div className="v2-setup-top"><span>Built around your operation</span><span className="v2-sample">Example setup</span></div><div className="v2-setup-center">{active===0?<><Box size={42} strokeWidth={1.3} aria-hidden="true" /><h3>Each. Case. Pallet.</h3><p>Your products, in the units your team uses.</p><div className="v2-unit-flow"><span>Product</span><ArrowRight aria-hidden="true" /><span>Pack</span><ArrowRight aria-hidden="true" /><span>Storage</span></div></>:active===1?<><Warehouse size={42} strokeWidth={1.3} aria-hidden="true" /><h3>A place for everything.</h3><p>Connect the whole footprint of your operation.</p><div className="v2-site-list">{['Main warehouse','Overflow storage','Distribution site'].map((site,i)=><div key={site}><span><Warehouse size={17} aria-hidden="true" />{site}</span><small>{['Racks & bays','Bulk zones','Pick & dispatch'][i]}</small></div>)}</div></>:<><ScanLine size={42} strokeWidth={1.3} aria-hidden="true" /><h3>The next step is clear.</h3><p>Guide the work from arrival to departure.</p><ol className="v2-flow-list">{['Receive & verify','Store & confirm','Pick & dispatch'].map(step=><li key={step}><Check size={16} aria-hidden="true" />{step}</li>)}</ol></>}</div></div>
          </div>
        </section>
        <section id="connected" className="v2-connected v2-wrap">
          <div className="v2-section-head"><p className="v2-kicker">A warehouse adapter for your business</p><h2>Keep the systems you know.<br />Connect the part they can’t see.</h2><p>Your ERP knows the transaction. Your warehouse knows the movement. Bring them together through an API integration built around your business.</p></div>
          <div className="v2-connection-diagram"><div><Layers3 size={30} aria-hidden="true" /><h3>Your business systems</h3><p>ERP · accounting · inventory</p></div><span className="v2-diagram-arrow" aria-hidden="true">↔</span><div className="v2-connection-core"><img src="/logo-mark.svg" width="42" height="42" alt="" /><h3>Warehouse Wizard</h3><p>Receive. Store. Move. Verify.</p></div><span className="v2-diagram-arrow" aria-hidden="true">↔</span><div><Sparkles size={30} aria-hidden="true" /><h3>Your AI tools</h3><p>Inventory reporting through MCP</p></div></div>
          <div className="v2-connection-details"><div><h3>API integration, shaped to fit.</h3><p>Connect to ERP and accounting systems with suitable APIs. We map the records, movement rules and sync flow to your setup. Each integration is scoped and tested.</p></div><div><h3>Ask your inventory a better question.</h3><p>Use a compatible AI assistant through MCP to find products, see warehouses and summarize stock by location. Read-only tools work within the signed-in user’s access.</p></div></div>
        </section>
        <section className="v2-ease"><div className="v2-wrap"><div><p className="v2-kicker">Less system. More business.</p><h2>Let the workflow do the prompting.</h2><p>Established warehouse practices guide each receipt, put-away and pick. Your team sees what to do next, and where an exception needs attention.</p></div><div className="v2-benefits">{BENEFITS.map(({Icon,title,copy})=><div key={title}><Icon size={22} aria-hidden="true" /><h3>{title}</h3><p>{copy}</p></div>)}</div></div></section>
        <section className="v2-faq v2-wrap" id="v2-faq"><div><p className="v2-kicker">A few practical answers</p><h2>Built to fit.<br />Clear from the start.</h2></div><div>{V2_FAQS.map(item=><details key={item.q} id={item.id}><summary>{item.q}<span aria-hidden="true">+</span></summary><p>{item.a}</p></details>)}</div></section>
        <section className="v2-final"><div className="v2-wrap"><div><p>Sell with confidence. Buy with clarity.</p><h2>Know what’s there.<br />Get on with business.</h2></div><div><button className="v2-button v2-button-white" onClick={openDemo}>Request a demo <ArrowRight size={18} aria-hidden="true" /></button><p>Bring your system. We’ll talk through the fit.</p></div></div></section>
      </main>
      <footer className="v2-footer v2-wrap"><div className="v2-footer-top"><div><a className="v2-brand" href="#v2-top"><img src="/logo-mark.svg" width="30" height="30" alt="" />Warehouse Wizard</a><p>Inventory confidence.<br />Connected to the way you work.</p></div><div><strong>Explore</strong><a href="#adaptable">Your operation</a><a href="#connected">Integrations & AI</a><Link to="/landing">Original landing page</Link></div><div><strong>Legal</strong><Link to="/legal/privacy">Privacy policy</Link><Link to="/legal/terms">Terms and conditions</Link><Link to="/legal/licence">End user licence agreement</Link><small>Drafts for review</small></div><div><strong>Let’s talk</strong><a href="mailto:russell@classicvisions.net">russell@classicvisions.net</a><Link to={toPath("/login")}>Sign in to your workspace</Link></div></div><div className="v2-footer-bottom"><span>© {new Date().getFullYear()} Classic Visions · Barbados</span><a href="#v2-top">Back to top ↑</a></div></footer>
      <a className="ww-back-top" href="#v2-top"><ArrowUp size={14} aria-hidden="true" />Back to top</a>
    </div>
    <DemoModal key={demoOpen?"open":"closed"} light returnFocus={()=>invoker.current?.focus()} />
  </Dialog.Root>;
}
