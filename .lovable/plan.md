# Dash-free code entry + user-synced module preferences

## 1. Type `A01A`, get `A-04-A` (bay/location autocomplete)

Operators can type bay/location codes without the hyphens. As soon as what they typed matches a real code with the dashes removed, the field rewrites itself to the proper dashed code.

Behaviour:

- Typing is never blocked. The field accepts letters and digits with or without dashes.
- On each keystroke the value is compared against known codes both as typed and with all dashes stripped. Example: `A01A` matches `A-04-A`? No — it matches `A-01-A`, so the field snaps to `A-01-A`.
- Autocorrect fires only when the dash-free value resolves to exactly one known code or code prefix, so it can never silently pick the wrong bay. While `A0` still matches several codes, the raw text is left alone and no error is shown.
- The existing "No bay or location matches this code" error only appears when neither the typed form nor the dash-free form can lead to a real code.
- Bay-shaped values keep today's behaviour (opening the bay selector), scanner input is unaffected because scanners already insert canonical codes, and no alarms fire while typing (unchanged from the recent fix).

Applies to the same fields already validated: Location Moves (new move + each queued task) and Put-Away (dialog + task cards).

## 2. Module visibility and favourites follow the user

Today the pinned favourites are saved to the account, but the module on/off switches are only stored on the device — so a user signing in on a different scanner or PC sees a different set of modules.

Change: both the module enable/disable state and the favourites are stored on the user's account, so signing in anywhere restores the same workspace. Device storage stays as an instant-load cache and offline fallback; the account copy wins once it loads. Resetting to starter modules writes the reset to the account too.

## Technical notes

- `src/lib/code-input.ts`: add `stripCodeSeparators`, and `resolveKnownCode(index, value)` returning `{ value, corrected }` — dash-free match resolved against a second dash-free index built in `buildKnownCodeIndex` (map of stripped code/prefix -> canonical code, only unique matches kept). `knownCodeError` accepts a value whose stripped form matches a known stripped prefix.
- Unit tests in `src/test/code-input.test.ts` for: unique dash-free match corrects, ambiguous prefix left untouched, unknown code still errors, already-dashed input unchanged.
- Wire `resolveKnownCode` into the location `onChange` handlers in `src/features/moves/moves-page.tsx` and `src/features/putaway/putaway-page.tsx` (replacing the plain uppercase/trim set), keeping validation calls and the `announce: false` silent-typing behaviour.
- Migration: add `module_flags jsonb not null default '{}'::jsonb` to `public.user_mobile_toolbar_preferences` (existing RLS/self-access policies and grants already cover it).
- `src/lib/mobile-toolbar-preferences.ts`: load/save `module_flags` alongside `module_keys` in one upsert.
- `src/hooks/use-feature-flags.ts`: hydrate `flags` from the account on sign-in (falling back to localStorage), and persist flags on `setModule` / `resetToStarter` the same way toolbar modules already are.
- No layout, token, or copy changes.
