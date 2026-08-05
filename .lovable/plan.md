# Fix the 403 that fires on desktop sign-in

## What's actually happening

The preview is loading fine — the app is running and reporting a real runtime error from the login flow.

Confirmed by reading the code:

- `src/features/app/app-pages.tsx:825` — after a successful password sign-in, the login mutation always calls `refreshUserDeviceTrust(getOrCreateDeviceId())`.
- `src/features/admin/admin-core.ts:272-280` — that function invokes the `trust-device` edge function and passes `isDesktop: isDesktopClient()`.
- `supabase/functions/trust-device/index.ts:47-48` — the function deliberately rejects desktop callers: `return json({ error: 'Trusted device shortcut is unavailable' }, 403)`.

So on any desktop browser the app calls an endpoint that is designed to refuse it, the thrown error aborts the rest of the sign-in mutation (`recordUserSignIn` never runs), and the user gets a red error toast.

Elsewhere the app already knows this: the badge/trusted-device shortcut is gated behind `!isDesktopClient()` in three places (lines 760, 764, 904). Only this one call site is missing the guard.

## The fix

1. **Guard the call** — in `refreshUserDeviceTrust` (`admin-core.ts`), return early when `isDesktopClient()` is true. Desktop clients never get the trusted-device shortcut, so there is nothing to register.

2. **Make it non-fatal** — device-trust registration is a convenience, not part of authentication. Wrap the call at the login site so a failure is logged but never blocks sign-in or the `recordUserSignIn` audit entry that follows it.

3. **Leave the edge function alone** — the 403 is intentional policy, not a bug. The client should stop calling it, rather than the server being loosened.

## Verification

- Sign in on desktop and confirm: no error toast, session established, sign-in recorded.
- Confirm the mobile/badge path is untouched — it goes through `badge-login`, not this call.

## Scope

Two small edits in existing client code. No UI, schema, or edge-function changes.
