# Task: Harden Warehouse Wizard signup/login (network + device-bound access)

You are working in the **Warehouse Wizard** repo (Vite + React + TypeScript, Supabase Auth + Postgres RLS). This is an implementation brief. Read the context, respect the constraints, then execute the phases in order. Do **not** do everything at once — Phase 0 and Phase 1 are independently shippable; stop and report after each phase.

---

## Context: how auth works today (verified)

- **Stack:** browser talks directly to Supabase Auth (GoTrue) with the public anon key. No backend in between. The anon key ships in the JS bundle, so "only our app can call Supabase" is NOT a real control.
- **Client:** `src/integrations/supabase/client.ts` (auto-generated, do not hand-edit) builds the client from `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY`. Session persisted in `localStorage`.
- **Login UI:** `src/App.tsx` → `LoginPage`, `LoginBadgeScanner`, `PinKeypadDialog`. Two methods: (1) badge QR scan → keypad PIN; (2) user code (e.g. `ADMIN01`) or email + password. Method is remembered per device.
- **Sign-in logic:** `src/hooks/use-auth.tsx`. Resolves short codes to email via `resolve_login_code` RPC, then `signInWithPassword`. Contains a **demo fallback** (6 hardcoded users, password `Warehouse123!`) gated only by a hostname regex.
- **Signup:** `LoginPage.signUpMutation` calls `supabase.auth.signUp(...)`. DB trigger `on_auth_user_created → handle_new_user()` (in `supabase/migrations/20260511000000_consolidated_wms_schema.sql`) inserts a `profiles` row with `approved=false` (default).
- **Approval gate:** `RequireAuth` (in `src/App.tsx`) routes any profile with `approved=false` to `PendingAccessShell` (Help Center only). Only admins can flip `approved` (enforced by a trigger). All data tables are RLS-gated on `public.is_approved()`. **This layer is solid — do not weaken it.**
- **Auth emails:** rendered by edge function `supabase/functions/auth-email-hook/`. A second function `process-email-queue` exists. Pattern to copy for new functions.

## The problem we're solving

The Supabase signup/login endpoints are reachable from anywhere on the internet (public anon key). `supabase/config.toml` has **no `[auth]` block**, so open signup runs on defaults. We want to restrict account creation and login to the warehouse's network / approved devices, without slowing down a fast-paced floor.

**Architectural constraint (important):** you CANNOT IP-filter the stock GoTrue endpoint. Network/geo/device rules must be enforced in a layer we control (Edge Function or Postgres Auth Hook), AND open signup must be disabled so the rules can't be bypassed.

## Hard constraints (read `AGENTS.md` first)

- `src/App.tsx` login UI (`LoginPage`, `PinKeypadDialog`, `LoginBadgeScanner`) is a **FROZEN surface**. Do not change rendered DOM/copy without explicit user approval. You MAY fix wiring/handlers behind existing UI. If a phase needs a visible UI change, **stop and ask the user**, then add a one-line entry to the `AGENTS.md` change log.
- `supabase/config.toml`: function-specific blocks are fine; **project-level/`[auth]` settings need user approval** before editing. The `enable_signup=false` change (Phase 1) is also set in the hosted Supabase dashboard — flag it, don't assume.
- `supabase/migrations/**`: **additive only.** Never edit an existing migration file; create a new timestamped file.
- `src/integrations/supabase/client.ts` and `types.ts`: auto-generated, never hand-edit. Regenerate types via the Supabase CLI/MCP after schema changes.
- Run `bunx tsc --noEmit` and the test suite (`src/test/**`, vitest) before declaring any phase done.

---

## Phase 0 — Immediate cleanups (no new infra, ship first)

These remove live risk and don't depend on later phases.

1. **Neutralize the demo backdoor.** In `src/hooks/use-auth.tsx`, the `demoEnabled` flag currently stays true for dev/preview/`*.lovable.app`. Change it so the `Warehouse123!` fallback can NEVER run on a production host. Safest: gate behind an explicit `import.meta.env.VITE_ENABLE_DEMO === "true"` only, and remove the hostname-regex branch. Confirm with user whether any non-prod workflow still relies on demo logins before deleting.
2. **Verify `resolve_login_code` works pre-auth.** Migration `20260518230000_security_fixes.sql` revoked `anon` execute on `resolve_login_code`, but it's called *before* the user authenticates (in `use-auth.tsx signIn`). Reproduce a code/badge login from a signed-out state. If it fails, add an additive migration restoring a safe, rate-limited anon grant (or move resolution server-side into the Phase 1 function). Don't expose email enumeration — return only on exact code/badge match (it already does).
3. **Separate PIN from password.** Today the badge "PIN" is passed as the account password (see the `// TODO` in `LoginPage.submitBadgePin`). Add a dedicated `pin_hash` to `profiles` (additive migration) and a `verify_user_pin(user_id, pin)` security-definer RPC. Wire badge login to verify the PIN factor server-side. **UI is frozen** — keep the existing keypad DOM identical; only change what the submit handler calls. If unavoidable UI change, stop and ask.

**Acceptance:** demo creds rejected on prod host; signed-out code/badge login resolves; badge PIN no longer equals the password. Types regenerated, `tsc` + tests green.

---

## Phase 1 — Close open signup, add IP/site-code gated request-access (primary fix)

Goal: the public signup endpoint is off; the only way to create a pending account is through a function we control that checks network + a rotating site code.

1. **Disable open signup.** Add `[auth] enable_signup = false` to `supabase/config.toml` AND set it in the hosted dashboard. **Get user approval first** (project-level config per AGENTS.md).
2. **New tables (additive migration):**
   - `auth_ip_allowlist(id, cidr inet/text, label, active bool, created_by, created_at)` — the warehouse's public egress IP(s)/ranges.
   - `auth_site_code(code_hash, rotated_at, rotated_by)` — a short rotating code managers hand to new staff.
   - `access_requests(...)` if not already present — to hold pending requests with captured IP + timestamp for audit.
3. **New Edge Function `supabase/functions/request-access/`** (copy structure from `auth-email-hook`):
   - Read caller IP from `x-forwarded-for` (first hop) / `cf-connecting-ip`.
   - Reject if IP not within any active `auth_ip_allowlist` row.
   - Require a valid current site code (compare against `auth_site_code`).
   - On pass: create the auth user (service-role client) + pending profile (`approved=false`), or insert an `access_requests` row for an admin to convert. Keep the existing approval wall intact.
   - Rate-limit per IP; add a CAPTCHA token check (hCaptcha/Turnstile) — see Phase 3.
4. **Point the UI's "request access" path at the new function** instead of `supabase.auth.signUp`. The signup form (`signUpMutation` in `LoginPage`) currently calls `supabase.auth.signUp` directly — **frozen UI**, so changing the network call behind the existing form is allowed, but confirm the form copy ("Request access. An admin will approve...") still matches behavior. If new fields (site code) are needed on-screen, **stop and ask the user** — that's a visible change.

**Acceptance:** `supabase.auth.signUp` from outside the allowlisted IP (or without a valid site code) fails; from inside, a pending account is created and still requires admin approval. No regression to the approval/RLS layer.

---

## Phase 2 — Bind login to network + approved device

Goal: even a valid credential can't start a session off-network on an unknown device.

1. **Network gate at token issue.** Implement a **Postgres Auth Hook** (Supabase "Custom Access Token" / before-token hook) OR a post-login Edge check that compares the request IP to `auth_ip_allowlist` and refuses to finalize the session if off-network — UNLESS the device is an approved bound device (step 2). Store allowlist server-side; managers edit via a table-backed admin screen (new, non-frozen surface).
2. **WebAuthn device binding + biometric (Face/fingerprint/pattern).** Native mobile biometrics reach the web via **WebAuthn/passkeys** (private key stays in the device secure enclave).
   - New tables: `webauthn_credentials(user_id, credential_id, public_key, sign_count, device_label, created_at, last_used_at)`.
   - New Edge Functions: `webauthn-register` and `webauthn-verify` (use a maintained server lib, e.g. `@simplewebauthn/server` via npm specifier in Deno).
   - On first approved login from a device: register a credential. Subsequent logins require the platform authenticator (Face ID / Touch ID / Android biometric or pattern).
   - A registered credential also serves as the **trusted-device exception** for staff on mobile data (rotating IPs) in step 1.
   - Provide an **admin re-enroll / revoke** path for lost/reimaged devices (hang off the existing admin user-edit surface).
   - **Shared scanner kiosks** (one tablet, many pickers) can't use per-user biometrics — keep badge + PIN (Phase 0.3) for those stations.
3. Any new login-screen affordance (e.g. "Set up Face ID") is a **visible change to frozen UI → stop and ask the user** before building it; propose the minimal addition and a changelog entry.

**Acceptance:** off-network login from an unbound device is refused; on-network OR bound-device login succeeds; biometric prompt appears on a registered phone; admin can revoke a device.

---

## Phase 3 — Defense-in-depth & audit (do alongside 1–2)

- **Rate limits + CAPTCHA** on `request-access` and login (hCaptcha/Cloudflare Turnstile). Tighten Supabase auth rate limits in the dashboard.
- **Geofence as audit signal only.** Optionally capture `navigator.geolocation` at login and log whether it falls in the warehouse polygon. Do NOT block on geo alone (spoofable, flaky indoors). Alert managers on IP/geo mismatch.
- **Logging:** record IP, device id, geo result, and outcome for every signup/login attempt into an audit table for review.

---

## Suggested order / dependencies

```
Phase 0  (independent, ship first)
   └─> Phase 1  (needs Phase 0.2 if resolution moves server-side)
          └─> Phase 2  (reuses Phase 1 allowlist tables + functions)
Phase 3  runs in parallel with 1 and 2
```

## Before you start — confirm with the user

1. The warehouse's **public egress IP(s)** — required for the allowlist; without them Phase 1/2 can't be configured.
2. Approval to set **`enable_signup=false`** in `config.toml` + dashboard (project-level per AGENTS.md).
3. Whether any current workflow relies on the **demo logins** before removing them (Phase 0.1).
4. Whether **remote/4G workers** exist who must log in off the building network (drives how aggressive the IP gate vs. device-binding exception should be).
5. Any **visible login-screen change** (site code field, "Set up Face ID" button) needs explicit sign-off + an `AGENTS.md` change-log entry — surface these as they arise rather than editing frozen UI unilaterally.

## Definition of done (whole effort)

Open internet signup is impossible; account creation requires on-network + site code + admin approval; login off-network requires an approved biometric-bound device; demo backdoor gone; PIN is a real separate factor; everything additive (no edited migrations, no hand-edited generated files); `bunx tsc --noEmit` and vitest green; frozen UI unchanged except where the user explicitly approved.
