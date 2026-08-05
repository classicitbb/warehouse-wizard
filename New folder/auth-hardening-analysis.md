# Warehouse Wizard — Auth Setup Review & Signup Hardening Theory

_Prepared 1 June 2026. Scope: how authentication works today, where the "offsite user" exposure is, and how to lock signup/login to an IP, Wi‑Fi, geofence, or device/biometric without slowing down a fast‑paced floor._

---

## 1. How auth works today (end to end)

**Stack.** Supabase Auth (GoTrue) + Postgres RLS. The browser talks to Supabase directly using the public anon key. There is no server in between.

**Client.** `src/integrations/supabase/client.ts` (auto‑generated) creates the client from `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`, with `persistSession` + `autoRefreshToken` in `localStorage`. `.env` holds those two values; `.env.example` documents them. The anon key is public by design — it ships in the JS bundle, so **any control that depends on "only our app can call Supabase" is not a real control.**

**Login UI** lives in `src/App.tsx` (`LoginPage`, `LoginBadgeScanner`, `PinKeypadDialog`). Two methods, remembered per device:

- **Badge scan** — camera `BarcodeDetector` reads a QR/badge, then a keypad `PinKeypadDialog` collects a PIN. The PIN is currently passed straight to `signInWithPassword` as the password (there's a `// TODO: Replace this password-backed challenge with the per-user PIN preference` — so today PIN _is_ the password).
- **User code / email** — short code (e.g. `ADMIN01`) or email + password. Short codes are resolved to an email by the `resolve_login_code` RPC before sign‑in.

**Sign‑in path** (`src/hooks/use-auth.tsx`): resolve code→email if needed, then `supabase.auth.signInWithPassword`. There is a **demo fallback** with six hardcoded users and the password `Warehouse123!`. It's gated off in production by a hostname check (`threeplmgmt.lovable.app` excluded) but stays on for dev, preview, and any `*.lovable.app` host.

**Signup path** (`LoginPage.signUpMutation`): `supabase.auth.signUp({ email, password, options.data: { full_name, phone } })`. On the DB side, trigger `on_auth_user_created → handle_new_user()` inserts a `profiles` row. Crucially `profiles.approved` **defaults to `false`**, so a new account exists but is inert.

**Gate after signup.** `RequireAuth` sends any session whose profile is missing or `approved=false` into `PendingAccessShell` — a stripped shell with only Help Center and a "Refresh authorization" button. An admin must flip `approved=true` (only admins can, enforced by a trigger that raises _"Only admins can change the approved status"_). RLS everywhere keys off `public.is_approved()`, and a profile self‑update policy blocks a user from flipping their own `approved`. Emails (confirm/recovery/invite) are rendered by the `auth-email-hook` edge function.

**Net:** the data layer is well‑defended. An unapproved account sees nothing. The approval wall, the RLS `is_approved()` gate, and the admin‑only approval trigger are the real security today.

---

## 2. The actual exposure

The thing you're calling "offsite penetration" is this: **the Supabase signup and login endpoints are reachable from anywhere on the internet, because they live on Supabase's servers and only need the public anon key.** Concretely:

1. **Open self‑serve signup.** `supabase/config.toml` has **no `[auth]` block**, so signup runs on Supabase defaults (enabled). Anyone who loads the page — or just reads the anon key from the bundle — can create accounts at will. They land as `pending`, but they're inside the auth system and can spam your approval queue.
2. **No network, geo, or device condition** anywhere in signup or login. Nothing checks _where_ the request comes from or _what device_ it's on.
3. **No rate limit / CAPTCHA** beyond Supabase's generic defaults → account‑spam and credential‑stuffing surface.
4. **Demo backdoor** (`Warehouse123!`) is protected only by a hostname regex. Any deploy on a host that doesn't match the exclusion (a new domain, a preview alias) re‑opens six known‑password admin/manager accounts.
5. **PIN is not a distinct factor** — it equals the password, so "badge + PIN" is really "badge maps to email + password."
6. **Side note / likely bug:** `resolve_login_code` had `anon` execute revoked (security_fixes migration), but it's called _before_ the user is authenticated. Code/badge login for a not‑yet‑signed‑in user may silently fail to resolve the email. Worth verifying.

Key architectural fact that shapes every fix below: **you cannot IP‑restrict the stock Supabase GoTrue endpoint.** So network/geo/device rules have to be enforced in a layer you control — an Edge Function, a WAF/proxy in front of a custom auth domain, or a Postgres auth hook — and the public signup endpoint has to be turned off so it can't be bypassed.

---

## 3. Hardening theory — four levers, by strength and floor‑friction

You named four candidate controls. Here's how each maps onto this stack, honestly rated for a fast‑paced warehouse.

### A. IP / Wi‑Fi allowlist — _strongest for a fixed site, lowest friction_
A warehouse is a fixed location with a known public egress IP (or a small set). Allowlisting that IP is the single highest‑value, lowest‑friction control here: staff on the building's network just work; everyone else is refused before credentials even matter.

How to enforce, given GoTrue can't be IP‑filtered directly:
- **Disable public signup** (`enable_signup = false`) and route account creation through a **custom `request-access` Edge Function** that (a) reads the caller IP from `x-forwarded-for`, (b) checks it against an allowlist table, (c) requires a rotating site code, then creates the pending profile. Off‑site requests are rejected at the door.
- **Gate login the same way** with a **Postgres Auth Hook** (`custom_access_token` / before‑token hook) or a post‑login Edge check that compares the request IP to the allowlist and refuses to finalize the session otherwise. Store the allowlist in a table so managers can edit it without a deploy.
- "Wi‑Fi" in practice = this same public‑IP allowlist (a Wi‑Fi SSID isn't visible to a web server). For true per‑network proof you'd need a managed device pushing a client cert / VPN — heavier, see D.

_Trade‑off:_ remote/4G workers and roaming laptops break unless their IP is also listed. Mobile data IPs rotate, so phones off Wi‑Fi need an exception path (e.g. allow if device is biometric‑bound — control C).

### B. Geofence — _good secondary signal, weak as a sole gate_
Capture `navigator.geolocation` at login and verify the point falls inside the warehouse polygon in the Edge Function before issuing access.

_Trade‑off:_ requires a browser permission prompt (friction), is **spoofable** from devtools, and is flaky indoors (GPS through a metal roof). Treat geofence as a **secondary/audit signal** layered on top of IP — log it, alert on mismatches — not as the primary wall.

### C. Device binding + biometric (Face / fingerprint / pattern) — _best per‑user factor, the real answer for "device auth"_
The native Android/iOS Face/fingerprint/pattern unlock is exposed to web apps through **WebAuthn / passkeys**. On first approved login from a device, register a WebAuthn credential bound to the profile (the private key never leaves the phone's secure enclave); subsequent logins require the platform authenticator — i.e. the user's Face ID, Touch ID, or Android biometric/pattern. This replaces the weak password‑backed PIN with a phishing‑resistant, device‑bound factor and is genuinely fast on a phone (one tap + face).

Implementation note: Supabase native MFA covers TOTP and phone, not yet first‑class WebAuthn, so passkeys would be implemented against a small Edge Function pair (`webauthn-register` / `webauthn-verify`) storing credential IDs per profile and feeding a verification result into an auth hook. A registered‑device table also gives you a clean **"approved device" allowlist**, which is the natural exception path for off‑Wi‑Fi phones in control A.

_Trade‑off:_ device loss / re‑imaging needs an admin re‑enroll path (you already have an admin user‑edit surface to hang that on). Shared‑kiosk scanners (one tablet, many pickers) don't fit per‑user biometrics — keep badge+PIN for those stations.

### D. Managed‑device / mTLS / VPN — _strongest, heaviest_
MDM‑pushed client certificates or an always‑on VPN make "only company devices on the company network" provable. Highest assurance, but real IT overhead and the slowest to roll out — overkill unless compliance demands it.

---

## 4. Recommended combination for a fast‑paced floor

Layer, don't pick one. The goal you stated — "complete and robust, but fast" — points to:

1. **Turn off open signup.** Set `enable_signup = false` and move account requests to an IP‑gated `request-access` Edge Function with a rotating site code. This alone removes the offsite‑signup vector entirely. _(Highest impact, lowest effort.)_
2. **IP allowlist as the primary network gate** (control A), managed from a table so supervisors maintain it. Building network = instant access; everything else is refused.
3. **WebAuthn device biometric as the per‑user factor** (control C), replacing the password‑backed PIN. Face/fingerprint/pattern, one tap, and it doubles as the "trusted device" exception for staff on mobile data.
4. **Geofence + IP mismatch as audit signals** (control B): log and alert, don't block on geo alone.
5. **Keep badge scan + a real, separate PIN** for shared scanner stations where biometrics don't fit — but make the PIN its own column/factor, not the account password (close the existing TODO).

Plus the immediate cleanups that don't need any of the above: remove or hard‑gate the `Warehouse123!` demo fallback so it can never run on a real host; add CAPTCHA + tighter rate limits on the request‑access path; and verify the `resolve_login_code` anon‑grant so code/badge login actually resolves pre‑auth.

### Effort vs. assurance, at a glance

| Control | Assurance | Floor friction | Effort | Verdict |
|---|---|---|---|---|
| Disable open signup + gated request‑access fn | High (kills offsite signup) | None | Low | **Do first** |
| IP / Wi‑Fi (public‑egress) allowlist | High at fixed site | None on‑site | Low–Med | **Primary gate** |
| WebAuthn device biometric (Face/print/pattern) | High, phishing‑resistant | Very low (one tap) | Med | **Per‑user factor** |
| Geofence | Low–Med (spoofable) | Med (permission prompt) | Med | Audit signal only |
| Managed device / mTLS / VPN | Very high | Low once deployed | High | Only if compliance demands |
| Real per‑user PIN (replace password‑PIN) | Med | Very low | Low | Do alongside |
| Remove demo backdoor + rate‑limit/CAPTCHA | — (removes risk) | None | Low | **Do first** |

---

## 5. Where each change lands in the repo

- **Disable signup / auth settings:** `supabase/config.toml` (`[auth] enable_signup = false`) and the hosted Auth dashboard. _Note: AGENTS.md says never change project‑level config.toml settings without approval — flag before editing._
- **New gated flows:** new functions under `supabase/functions/` (`request-access`, `webauthn-register`, `webauthn-verify`), following the existing `auth-email-hook` pattern.
- **Network/device gate at token issue:** a Postgres Auth Hook function in a new `supabase/migrations/` file + allowlist/device tables.
- **Login/PIN UI:** `LoginPage` / `PinKeypadDialog` in `src/App.tsx` — **frozen UI per AGENTS.md**; any visible change needs explicit user sign‑off and a changelog entry.
- **Demo backdoor removal & sign‑in logic:** `src/hooks/use-auth.tsx`.

> None of the above has been changed — this is analysis and a proposed plan only.
