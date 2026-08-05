# Fix the broken preview after the TanStack Start migration

## What I found so far

- The app itself is fine in the sandbox: the dev server returns HTTP 200 and renders the real Warehouse Wizard HTML at `/`, with no errors in the Vite log.
- A full TypeScript check passes with zero errors.
- The preview host (`id-preview--...lovable.app`) answers, but bounces to the Lovable auth bridge instead of your app, and the pasted link carries an expired one-time token.

Dev mode being healthy while the preview is dead points at the **production/preview build step**, which is a different pipeline (server bundle for the edge Worker) from `vite dev`. That build has not been verified since the migration. This is the leading suspect, not yet confirmed — confirming it is step 1.

## Plan

1. **Reproduce the real failure**
   - Run the production build (`bun run build`) and read the full output.
   - If it fails, the error text names the cause directly (usually a Node-only dependency, a server/client import leak, or a prerender-time call that needs auth).

2. **Fix by failure class**
   - *Build error*: repair the offending import boundary or swap the Node-only package for a Worker-safe path. Server-only modules must not be reachable from route/client graphs.
   - *Prerender 401/500*: any protected server function called from a public route loader gets moved into the component (`useServerFn` + `useQuery`), per the auth-gate rule.
   - *Builds clean*: then the problem is deployment/serving, not code — I'll verify with an SSR probe over the built output and report exactly where it breaks instead of changing app code.

3. **Verify before handing back**
   - Serve the production build locally and probe the key routes (`/`, `/login`, `/dashboard`, and a couple of `_authed` shell routes) for non-500 responses.
   - Load the built app in a headless browser and confirm the login screen renders with a clean console.

4. **Publish**
   - Once the build is green and verified, publish so the preview and `warehousewizard.app` pick up the working bundle.

## Scope

Diagnosis and build-fix only. No UI redesign, no feature changes, no schema changes. Any file touched will be limited to what the build error points at.
