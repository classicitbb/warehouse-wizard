import { useState, type CSSProperties, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { RELEASE_HISTORY } from "@/lib/release-history";
import { useTenantPath } from "@/hooks/use-tenant-path";
import { FAQS, FEATURES, MOCK_NAV, MOCK_ROWS, SCREENS, TESTIMONIALS, TONES, type MockRow } from "./landing-data";

/** Where "Request a demo" submissions are emailed. Leave empty until a real inbox is chosen. */
const DEMO_REQUEST_EMAIL = "";

const VERSION = String(__APP_VERSION__);

// Design styles are kept as CSS strings and converted once (cached) to React style objects.
const cache = new Map<string, CSSProperties>();
function sx(css: string): CSSProperties {
  let out = cache.get(css);
  if (out) return out;
  out = {};
  for (const decl of css.split(";")) {
    const i = decl.indexOf(":");
    if (i < 0) continue;
    const prop = decl.slice(0, i).trim().replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
    if (prop) (out as Record<string, string>)[prop] = decl.slice(i + 1).trim();
  }
  cache.set(css, out);
  return out;
}

const MONO = "font-family:'IBM Plex Mono',monospace;";
const EYEBROW = `${MONO} font-size:12px; font-weight:600; letter-spacing:0.08em; text-transform:uppercase; color:hsl(174 62% 55%); margin-bottom:10px;`;
const H2 = "margin:0; font-size:34px; font-weight:700; letter-spacing:-0.01em;";
const CARD = "background:hsl(215 25% 12%); border:1px solid hsl(215 18% 32%); border-radius:12px; padding:24px; display:flex; flex-direction:column; gap:12px;";
const MUTED = "hsl(215 12% 62%)";

const CSS = `
.lw, .lw * { box-sizing: border-box; }
.lw a { color: hsl(174 62% 47%); text-decoration: none; }
.lw a:hover { color: hsl(174 62% 60%); }
.lw [id] { scroll-margin-top: 70px; }
.lw input::placeholder { color: hsl(215 12% 50%); }
.lw input:focus { outline: none; box-shadow: 0 0 0 2px hsl(174 62% 47%); }
.lw .h-nav:hover { color: hsl(210 20% 90%) !important; }
.lw .h-bd45:hover { border-color: hsl(215 18% 45%) !important; }
.lw .h-bd48:hover { border-color: hsl(215 18% 48%) !important; }
.lw .h-teal:hover { background: hsl(174 62% 52%) !important; }
.lw .h-dark:hover { background: hsl(215 28% 14%) !important; }
`;

function Badge({ tone, children }: { tone: MockRow["tone"]; children: string }) {
  const [bg, fg] = TONES[tone];
  return <span style={{ ...sx("border-radius:9999px; padding:2px 8px; font-size:9px; font-weight:600; white-space:nowrap; flex-shrink:0;"), background: bg, color: fg }}>{children}</span>;
}

function formatDate(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[m - 1] ?? ""} ${d}, ${y}`;
}

function DemoModal({ onClose }: { onClose: () => void }) {
  const [state, setState] = useState<"form" | "sent" | "unavailable">("form");

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!DEMO_REQUEST_EMAIL) {
      setState("unavailable");
      return;
    }
    const f = new FormData(e.currentTarget);
    const body = `Name: ${f.get("name")}\nEmail: ${f.get("email")}\nCompany: ${f.get("company")}`;
    window.location.href = `mailto:${DEMO_REQUEST_EMAIL}?subject=${encodeURIComponent("Warehouse Wizard demo request")}&body=${encodeURIComponent(body)}`;
    setState("sent");
  };

  const label = sx("display:block; font-size:12px; font-weight:500; color:hsl(215 12% 66%); margin-bottom:6px;");
  const input = sx("width:100%; height:40px; padding:0 12px; border-radius:6px; background:hsl(215 28% 19%); border:1px solid hsl(215 18% 26%); color:hsl(210 20% 90%); font-family:inherit; font-size:14px;");

  return (
    <div onClick={onClose} style={sx("position:fixed; inset:0; background:rgba(10,14,22,0.66); display:flex; align-items:center; justify-content:center; z-index:100; padding:20px;")}>
      <div role="dialog" aria-modal="true" aria-label="Request a demo" onClick={(e) => e.stopPropagation()} style={sx("width:100%; max-width:420px; background:hsl(215 25% 12%); border:1px solid hsl(215 18% 32%); border-radius:14px; padding:32px; box-shadow:0 30px 70px -25px rgba(0,0,0,0.6); position:relative;")}>
        <button type="button" aria-label="Close" onClick={onClose} style={sx("position:absolute; top:16px; right:16px; width:28px; height:28px; border-radius:6px; background:none; border:1px solid hsl(215 18% 32%); color:hsl(215 12% 62%); cursor:pointer; font-size:13px;")}>✕</button>
        {state === "form" || state === "unavailable" ? (
          <div>
            <h3 style={sx("margin:0 0 6px; font-size:20px; font-weight:700;")}>Request a demo</h3>
            <p style={sx(`margin:0 0 24px; font-size:13px; color:${MUTED};`)}>Tell us about your operation and we'll set up time.</p>
            <form onSubmit={submit} style={sx("display:flex; flex-direction:column; gap:14px;")}>
              <div><label style={label}>Full name</label><input name="name" type="text" required placeholder="Jordan Rivera" style={input} /></div>
              <div><label style={label}>Work email</label><input name="email" type="email" required placeholder="you@company.com" style={input} /></div>
              <div><label style={label}>Company</label><input name="company" type="text" required placeholder="Company name" style={input} /></div>
              {state === "unavailable" && (
                <p role="status" style={sx("margin:0; font-size:12px; color:hsl(38 92% 62%);")}>Demo requests aren't connected yet, so nothing was sent.</p>
              )}
              <button type="submit" className="h-teal" style={sx("width:100%; height:42px; border-radius:6px; background:hsl(174 62% 47%); color:hsl(215 28% 9%); border:none; font-family:inherit; font-size:14px; font-weight:600; cursor:pointer; margin-top:4px;")}>Request demo</button>
            </form>
          </div>
        ) : (
          <div style={sx("text-align:center; padding:12px 0;")}>
            <div style={sx("width:44px; height:44px; border-radius:50%; background:hsl(152 60% 45% / 0.16); color:hsl(152 60% 55%); display:flex; align-items:center; justify-content:center; font-size:20px; margin:0 auto 16px;")}>✓</div>
            <h3 style={sx("margin:0 0 6px; font-size:18px; font-weight:700;")}>Your email app is opening</h3>
            <p style={sx(`margin:0; font-size:13px; color:${MUTED};`)}>Send the pre-filled message and we'll be in touch.</p>
          </div>
        )}
      </div>
    </div>
  );
}

export function LandingPage() {
  const navigate = useNavigate();
  const { toPath } = useTenantPath();
  const [demoOpen, setDemoOpen] = useState(false);
  const [openFaq, setOpenFaq] = useState<number | null>(0);

  const openLogin = () => navigate(toPath("/login"));
  const openDemo = () => setDemoOpen(true);
  const releases = RELEASE_HISTORY.slice(0, 3);

  return (
    <div className="lw" style={sx("background:hsl(215 28% 19%); color:hsl(210 20% 90%); font-family:'IBM Plex Sans',sans-serif; min-height:100vh; overflow-x:hidden;")}>
      <style>{CSS}</style>

      {/* Top bar */}
      <div style={sx("position:sticky; top:0; z-index:40; background:hsl(215 28% 17% / 0.92); backdrop-filter:blur(10px); border-bottom:1px solid hsl(215 18% 32%); padding:12px 40px; display:flex; align-items:center; justify-content:space-between; gap:24px; flex-wrap:wrap;")}>
        <div style={sx("display:flex; align-items:center; gap:10px;")}>
          <img src="/logo-mark.svg" width={30} height={30} alt="Warehouse Wizard" />
          <span style={sx("font-weight:700; font-size:15px; letter-spacing:-0.01em;")}>Warehouse Wizard</span>
        </div>
        <nav style={sx("display:flex; align-items:center; gap:24px; font-size:13px; color:hsl(215 12% 58%); flex-wrap:wrap; white-space:nowrap;")}>
          {[["#features", "Features"], ["#product", "Product"], ["#whats-new", "What's new"], ["#faq", "FAQ"]].map(([href, text]) => (
            <a key={href} href={href} className="h-nav" style={sx("color:inherit;")}>{text}</a>
          ))}
        </nav>
        <div style={sx("display:flex; align-items:center; gap:10px;")}>
          <button type="button" onClick={openLogin} className="h-bd45" style={sx("height:38px; padding:0 16px; white-space:nowrap; border-radius:8px; background:hsl(215 20% 18%); color:hsl(210 20% 90%); border:1px solid hsl(215 18% 32%); font-family:inherit; font-size:13px; font-weight:500; cursor:pointer;")}>Sign in</button>
          <button type="button" onClick={openDemo} className="h-teal" style={sx("height:38px; padding:0 18px; white-space:nowrap; border-radius:8px; background:hsl(174 62% 47%); color:hsl(215 28% 9%); border:none; font-family:inherit; font-size:13px; font-weight:600; cursor:pointer;")}>Request a demo</button>
        </div>
      </div>

      {/* Hero */}
      <div style={sx("max-width:1280px; margin:0 auto; padding:88px 40px 80px; display:flex; gap:56px; align-items:center; flex-wrap:wrap;")}>
        <div style={sx("flex:1; min-width:340px;")}>
          <a href="#whats-new" style={sx(`display:inline-flex; align-items:center; gap:8px; padding:5px 12px; border-radius:9999px; background:hsl(174 62% 47% / 0.12); border:1px solid hsl(174 62% 47% / 0.35); color:hsl(174 62% 58%); ${MONO} font-size:11px; font-weight:600; letter-spacing:0.04em; white-space:nowrap; margin-bottom:22px;`)}>v1.33 · NetSuite integration now live →</a>
          <h1 style={sx("margin:0 0 20px; font-size:52px; line-height:1.08; font-weight:700; letter-spacing:-0.02em; text-wrap:pretty;")}>Orders leave the warehouse complete and correct.</h1>
          <p style={sx(`margin:0 0 32px; font-size:18px; line-height:1.6; color:hsl(215 12% 62%); max-width:500px; text-wrap:pretty;`)}>Scan-first operations, role-gated workflows, and a complete audit trail — from container at the dock door to verified pick, with a Copilot that investigates problems alongside your team.</p>
          <div style={sx("display:flex; align-items:center; gap:14px; flex-wrap:wrap; margin-bottom:24px;")}>
            <button type="button" onClick={openDemo} className="h-teal" style={sx("height:48px; padding:0 28px; border-radius:8px; background:hsl(174 62% 47%); color:hsl(215 28% 9%); border:none; font-family:inherit; font-size:15px; font-weight:600; cursor:pointer;")}>Request a demo</button>
            <button type="button" onClick={openLogin} className="h-bd48" style={sx("height:48px; padding:0 28px; border-radius:8px; background:transparent; color:hsl(210 20% 90%); border:1px solid hsl(215 18% 32%); font-family:inherit; font-size:15px; font-weight:600; cursor:pointer;")}>Sign in to your workspace</button>
          </div>
          <div style={sx(`${MONO} font-size:12px; color:hsl(215 12% 55%); letter-spacing:0.02em; line-height:1.7;`)}>QR + Zebra ZPL labels · ISO 6346 container scan · NetSuite · Microsoft sign-in · PWA on any tablet</div>
        </div>

        {/* Command Center mock */}
        <div aria-hidden="true" style={sx("flex:1; min-width:340px; display:flex; justify-content:center;")}>
          <div style={sx("width:100%; max-width:580px; border-radius:14px; overflow:hidden; border:1px solid hsl(215 18% 32%); background:hsl(215 25% 12%); box-shadow:0 30px 70px -25px rgba(0,0,0,0.55);")}>
            <div style={sx("height:34px; background:hsl(215 20% 18%); border-bottom:1px solid hsl(215 18% 32%); display:flex; align-items:center; gap:6px; padding:0 12px;")}>
              {[0, 1, 2].map((i) => <span key={i} style={sx("width:7px; height:7px; border-radius:50%; background:hsl(215 12% 40%);")} />)}
              <span style={sx(`margin-left:8px; ${MONO} font-size:10px; color:hsl(215 12% 55%);`)}>acme.warehousewizard.app/dashboard</span>
            </div>
            <div style={sx("display:flex; height:360px;")}>
              <div style={sx("width:140px; flex-shrink:0; background:hsl(217 71% 38%); border-right:1px solid hsl(217 55% 28%); padding:10px; display:flex; flex-direction:column; gap:3px;")}>
                <div style={sx("display:flex; align-items:center; gap:6px; padding-bottom:9px; margin-bottom:6px; border-bottom:1px solid hsl(217 55% 28%);")}>
                  <img src="/logo-mark.svg" width={18} height={18} alt="" />
                  <span style={sx("color:hsl(210 40% 98%); font-weight:700; font-size:10px; white-space:nowrap;")}>WW Wizard</span>
                </div>
                {MOCK_NAV.map((n) => (
                  <div key={n.label} style={{ ...sx("display:flex; align-items:center; gap:7px; padding:5px 8px; border-radius:5px; font-size:10px; font-weight:500; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;"), color: n.active ? "hsl(217 71% 30%)" : "hsl(210 40% 98%)", background: n.active ? "hsl(0 0% 100%)" : "transparent" }}>
                    <span style={sx("width:12px; text-align:center; opacity:0.9;")}>{n.icon}</span>{n.label}
                  </div>
                ))}
                <div style={sx(`margin-top:auto; ${MONO} font-size:9px; color:hsl(210 40% 98% / 0.75);`)}>v{VERSION} · ONLINE</div>
              </div>
              <div style={sx("flex:1; min-width:0; background:hsl(215 28% 19%); padding:14px; display:flex; flex-direction:column; gap:10px; overflow:hidden;")}>
                <div style={sx("display:flex; align-items:center; justify-content:space-between; gap:8px;")}>
                  <span style={sx("font-size:13px; font-weight:600;")}>Command Center</span>
                  <div style={sx("display:flex; gap:2px; padding:2px; border-radius:6px; background:hsl(215 25% 12%); border:1px solid hsl(215 18% 32%);")}>
                    <span style={sx("font-size:9px; font-weight:600; padding:3px 8px; border-radius:4px; background:hsl(174 62% 47%); color:hsl(215 28% 9%);")}>Floor</span>
                    <span style={sx("font-size:9px; font-weight:500; padding:3px 8px; color:hsl(215 12% 58%);")}>Dock</span>
                    <span style={sx("font-size:9px; font-weight:500; padding:3px 8px; color:hsl(215 12% 58%);")}>Office</span>
                  </div>
                </div>
                <div style={sx("display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:8px;")}>
                  {[["Available pallets", "1,284", ""], ["Open counts", "3", ""], ["On hold", "7", "color:hsl(38 92% 60%);"]].map(([label, value, extra]) => (
                    <div key={label} style={sx("background:hsl(215 25% 12%); border:1px solid hsl(215 18% 32%); border-radius:8px; padding:9px;")}>
                      <div style={sx(`${MONO} font-size:9px; letter-spacing:0.06em; text-transform:uppercase; color:hsl(215 12% 55%);`)}>{label}</div>
                      <div style={sx(`font-size:16px; font-weight:700; margin-top:3px; ${extra}`)}>{value}</div>
                    </div>
                  ))}
                </div>
                <div style={sx("background:hsl(215 25% 12%); border:1px solid hsl(215 18% 32%); border-radius:8px; padding:9px 10px;")}>
                  <div style={sx(`display:flex; justify-content:space-between; font-size:10px; color:${MUTED}; margin-bottom:6px;`)}><span>Storage capacity · pallet space</span><span>82%</span></div>
                  <div style={sx("height:6px; border-radius:9999px; background:hsl(215 20% 18%); overflow:hidden;")}><div style={sx("height:100%; width:82%; background:hsl(174 62% 47%);")} /></div>
                </div>
                <div style={sx("border:1px solid hsl(215 18% 32%); border-radius:8px; background:hsl(215 25% 12%); overflow:hidden;")}>
                  <div style={sx(`padding:6px 10px; border-bottom:1px solid hsl(215 18% 32%); ${MONO} font-size:9px; letter-spacing:0.06em; text-transform:uppercase; color:hsl(215 12% 55%);`)}>Inbound · NetSuite containers</div>
                  {MOCK_ROWS.map((r) => (
                    <div key={r.code} style={sx("display:flex; align-items:center; justify-content:space-between; gap:8px; padding:7px 10px; border-bottom:1px solid hsl(215 18% 32% / 0.6); font-size:10px;")}>
                      <span style={sx(`${MONO} color:hsl(215 12% 66%); white-space:nowrap;`)}>{r.code}</span>
                      <span style={sx("font-weight:500; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; min-width:0;")}>{r.desc}</span>
                      <Badge tone={r.tone}>{r.status}</Badge>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Features */}
      <section id="features" style={sx("max-width:1280px; margin:0 auto; padding:60px 40px 80px;")}>
        <div style={sx("text-align:center; max-width:620px; margin:0 auto 48px;")}>
          <div style={sx(EYEBROW)}>Features</div>
          <h2 style={sx(`${H2} margin-bottom:12px;`)}>Every floor workflow, one system</h2>
          <p style={sx(`margin:0; font-size:16px; color:${MUTED}; line-height:1.6;`)}>Each step confirms the scan before stock moves — and every block shows a reason and a way out.</p>
        </div>
        <div style={sx("display:grid; grid-template-columns:repeat(auto-fit,minmax(300px,1fr)); gap:20px;")}>
          {FEATURES.map((f) => (
            <div key={f.title} style={sx(CARD)}>
              <div style={sx("width:40px; height:40px; border-radius:8px; background:hsl(174 62% 47% / 0.14); color:hsl(174 62% 55%); display:flex; align-items:center; justify-content:center; font-size:18px;")}>{f.icon}</div>
              <div style={sx("font-size:16px; font-weight:600;")}>{f.title}</div>
              <div style={sx(`font-size:14px; color:${MUTED}; line-height:1.55;`)}>{f.desc}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Product */}
      <section id="product" style={sx("max-width:1280px; margin:0 auto; padding:0 40px 90px;")}>
        <div style={sx("text-align:center; max-width:600px; margin:0 auto 44px;")}>
          <div style={sx(EYEBROW)}>Product</div>
          <h2 style={sx(H2)}>See it the way your team does</h2>
        </div>
        <div style={sx("display:grid; grid-template-columns:repeat(auto-fit,minmax(300px,1fr)); gap:24px;")}>
          {SCREENS.map((s) => (
            <div key={s.label}>
              <div style={sx("border-radius:12px; overflow:hidden; border:1px solid hsl(215 18% 32%); background:hsl(215 25% 12%); box-shadow:0 16px 40px -20px rgba(0,0,0,0.5);")}>
                <div style={sx("padding:10px 14px; border-bottom:1px solid hsl(215 18% 32%); display:flex; align-items:center; gap:8px; background:hsl(215 20% 18%);")}>
                  <span style={sx("font-size:13px;")}>{s.icon}</span>
                  <span style={sx("font-size:12px; font-weight:600;")}>{s.label}</span>
                </div>
                <div style={sx("padding:16px; min-height:170px;")}>
                  {s.rows.map((r) => (
                    <div key={r.code + r.desc} style={sx("display:flex; align-items:center; justify-content:space-between; gap:8px; padding:7px 0; border-bottom:1px solid hsl(215 18% 32% / 0.5); font-size:11px;")}>
                      <span style={sx(`${MONO} color:hsl(215 12% 66%);`)}>{r.code}</span>
                      <span>{r.desc}</span>
                      <Badge tone={r.tone}>{r.status}</Badge>
                    </div>
                  ))}
                </div>
              </div>
              <div style={sx(`margin-top:14px; font-size:13px; color:${MUTED}; line-height:1.5;`)}>{s.caption}</div>
            </div>
          ))}
        </div>
      </section>

      {/* What's new — live from release history */}
      <section id="whats-new" style={sx("background:hsl(215 25% 12%); border-top:1px solid hsl(215 18% 32%); border-bottom:1px solid hsl(215 18% 32%);")}>
        <div style={sx("max-width:1280px; margin:0 auto; padding:80px 40px;")}>
          <div style={sx("display:flex; align-items:flex-end; justify-content:space-between; gap:20px; flex-wrap:wrap; margin-bottom:36px;")}>
            <div>
              <div style={sx(`${EYEBROW} color:hsl(38 92% 58%);`)}>What's new</div>
              <h2 style={sx(H2)}>Shipping every week</h2>
            </div>
            <span style={sx(`font-size:14px; color:${MUTED}; max-width:380px; line-height:1.55;`)}>Updates install themselves the moment a device wakes — never mid-scan.</span>
          </div>
          <div style={sx("display:grid; grid-template-columns:repeat(auto-fit,minmax(280px,1fr)); gap:20px;")}>
            {releases.map((rel) => (
              <div key={rel.version} style={sx("background:hsl(215 28% 19%); border:1px solid hsl(215 18% 32%); border-radius:12px; padding:22px; display:flex; flex-direction:column; gap:12px;")}>
                <div style={sx("display:flex; align-items:center; justify-content:space-between;")}>
                  <span style={sx(`${MONO} font-size:13px; font-weight:600; color:hsl(174 62% 58%);`)}>v{rel.version}</span>
                  <span style={sx(`${MONO} font-size:11px; color:hsl(215 12% 58%);`)}>{formatDate(rel.date)}</span>
                </div>
                <ul style={sx(`margin:0; padding-left:18px; display:flex; flex-direction:column; gap:8px; font-size:13px; color:${MUTED}; line-height:1.55;`)}>
                  {rel.changes.slice(0, 2).map((c) => <li key={c}>{c}</li>)}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Testimonials (placeholder copy from the design) */}
      <section id="testimonials" style={sx("max-width:1280px; margin:0 auto; padding:80px 40px 40px;")}>
        <div style={sx("text-align:center; max-width:600px; margin:0 auto 44px;")}>
          <div style={sx(EYEBROW)}>Trusted on the floor</div>
          <h2 style={sx(H2)}>What warehouse teams say</h2>
        </div>
        <div style={sx("display:grid; grid-template-columns:repeat(auto-fit,minmax(280px,1fr)); gap:20px;")}>
          {TESTIMONIALS.map((t) => (
            <div key={t.initials} style={sx(`${CARD} gap:16px;`)}>
              <div style={sx("font-size:15px; line-height:1.6;")}>“{t.quote}”</div>
              <div style={sx("display:flex; align-items:center; gap:10px; margin-top:auto;")}>
                <div style={sx("width:34px; height:34px; border-radius:50%; background:hsl(174 62% 47% / 0.18); color:hsl(174 62% 55%); display:flex; align-items:center; justify-content:center; font-size:12px; font-weight:700;")}>{t.initials}</div>
                <div>
                  <div style={sx("font-size:13px; font-weight:600;")}>{t.name}</div>
                  <div style={sx(`${MONO} font-size:11px; color:hsl(215 12% 58%);`)}>{t.company}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" style={sx("max-width:800px; margin:0 auto; padding:60px 40px 80px;")}>
        <div style={sx("text-align:center; margin-bottom:36px;")}>
          <div style={sx(EYEBROW)}>FAQ</div>
          <h2 style={sx(H2)}>Common questions</h2>
        </div>
        {FAQS.map((item, i) => {
          const open = openFaq === i;
          return (
            <div key={item.q} style={sx("border-bottom:1px solid hsl(215 18% 32%); padding:18px 0;")}>
              <button type="button" aria-expanded={open} onClick={() => setOpenFaq(open ? null : i)} style={sx("width:100%; display:flex; align-items:center; justify-content:space-between; gap:16px; background:none; border:none; color:hsl(210 20% 90%); font-family:inherit; font-size:16px; font-weight:600; text-align:left; cursor:pointer; padding:0;")}>
                {item.q}
                <span style={sx("color:hsl(215 12% 58%); font-size:14px;")}>{open ? "▴" : "▾"}</span>
              </button>
              {open && <p style={sx(`margin:12px 0 0; font-size:14px; line-height:1.65; color:${MUTED};`)}>{item.a}</p>}
            </div>
          );
        })}
      </section>

      {/* CTA */}
      <div style={sx("background:hsl(174 62% 47%); padding:56px 40px; text-align:center;")}>
        <h3 style={sx("margin:0 0 10px; font-size:26px; font-weight:700; color:hsl(215 28% 9%);")}>Ready to see it on your floor?</h3>
        <p style={sx("margin:0 0 24px; font-size:15px; color:hsl(215 28% 12%);")}>Walk a container from dock door to put-away with your own SKUs in a live session.</p>
        <button type="button" onClick={openDemo} className="h-dark" style={sx("height:46px; padding:0 28px; border-radius:8px; background:hsl(215 28% 9%); color:hsl(210 20% 90%); border:none; font-family:inherit; font-size:15px; font-weight:600; cursor:pointer;")}>Request a demo</button>
      </div>

      {/* Footer */}
      <footer style={sx("max-width:1280px; margin:0 auto; padding:56px 40px 32px;")}>
        <div style={sx("display:grid; grid-template-columns:repeat(auto-fit,minmax(180px,1fr)); gap:40px; margin-bottom:40px;")}>
          <div>
            <div style={sx("display:flex; align-items:center; gap:10px; margin-bottom:12px;")}>
              <img src="/logo-mark.svg" width={28} height={28} alt="" />
              <span style={sx("font-weight:700; font-size:14px;")}>Warehouse Wizard</span>
            </div>
            <p style={sx("margin:0; font-size:13px; color:hsl(215 12% 58%); line-height:1.6; max-width:260px;")}>Enterprise warehouse management for 3PL and in-house operations.</p>
          </div>
          <div style={sx("display:flex; flex-direction:column; gap:10px; font-size:13px;")}>
            <div style={sx("font-weight:600; margin-bottom:4px;")}>Product</div>
            {[["#features", "Features"], ["#whats-new", "What's new"], ["#faq", "FAQ"]].map(([href, text]) => <a key={href} href={href} style={sx(`color:${MUTED};`)}>{text}</a>)}
          </div>
          <div style={sx("display:flex; flex-direction:column; gap:10px; font-size:13px;")}>
            <div style={sx("font-weight:600; margin-bottom:4px;")}>Company</div>
            <span style={sx(`color:${MUTED};`)}>About [placeholder]</span>
            <span style={sx(`color:${MUTED};`)}>Contact [placeholder]</span>
          </div>
          <div style={sx("display:flex; flex-direction:column; gap:10px; font-size:13px;")}>
            <div style={sx("font-weight:600; margin-bottom:4px;")}>Legal</div>
            <span style={sx(`color:${MUTED};`)}>Privacy [placeholder]</span>
            <span style={sx(`color:${MUTED};`)}>License agreement [placeholder]</span>
          </div>
        </div>
        <div style={sx("border-top:1px solid hsl(215 18% 32%); padding-top:22px; display:flex; justify-content:space-between; flex-wrap:wrap; gap:10px; font-size:12px; color:hsl(215 12% 58%);")}>
          <span>© 2026 Warehouse Wizard Enterprise WMS</span>
          <span style={sx(MONO)}>warehousewizard.app · v{VERSION}</span>
        </div>
      </footer>

      {demoOpen && <DemoModal onClose={() => setDemoOpen(false)} />}
    </div>
  );
}

export default LandingPage;
