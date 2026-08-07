# v1.27 — Unified alert bell, AI container scanning, release docs

## 1. One notification bell

Today the header renders two separate bells: offline/RF supervisor alerts and reorder alerts (desktop and mobile both). Merge them into a single bell:

- One `NotificationBell` in `app-shell.tsx` that takes both sources and shows a combined unread count.
- Popover groups items under headings — "Connectivity" (offline supervisor alerts) and "Reorder alerts" — each keeping its current row content and empty-state wording.
- The reorder group only renders for users who currently qualify (`canReceiveReorderNotifications`); the bell itself always renders.
- Badge count = offline alerts + active reorder alerts; the bell takes an urgent tone when any connectivity alert is present.
- Existing local OS notifications (`use-reorder-alert-notifications`) stay untouched.

## 2. AI-assisted container scanner

Current flow: camera frame -> region crops -> Tesseract OCR -> ISO 6346 regex/check-digit validation. It struggles on angled, dirty, or low-contrast container faces.

Add an AI vision path that runs when local OCR does not yield a check-digit-valid code:

- New edge function `container-vision`: receives a JPEG frame (base64), calls Lovable AI (Gemini vision) with a strict prompt to return only the ISO 6346 container number visible on the container face, plus a confidence.
- The server re-validates the returned code with the same ISO 6346 check-digit rule before responding; invalid results come back as "not found" so the model can never inject a bogus number.
- Client (`barcode-scan-button.tsx`, container mode only): after a couple of failed local OCR passes, capture the current frame and call the function, then retry periodically while the scanner stays open. Status text shows "Reading container with AI…".
- The result flows into the existing pending-scan confirm UI ("Verify true" / **Use**), so the operator still confirms before it is inserted into the Receiving container field — no silent writes.
- Degrades cleanly: if the function errors, is rate-limited, or the device is offline, the scanner keeps doing local OCR exactly as today.
- Successful AI reads feed the same scanner-learning/telemetry hooks already used for OCR successes.

## 3. Version 1.27 + docs

- Bump `package.json` to `1.27` (drives `__APP_VERSION__` everywhere).
- Add a v1.27 entry at the top of `RELEASE_HISTORY` in `src/App.tsx` — this drives both the login "What's new" dialog and the version-history dialog — and mirror it in the Settings release list in `admin-page.tsx`.
- Help Center (`src/lib/help-content.ts`): update the Receiving module topic with AI-assisted container capture steps (how to frame the container face, when AI kicks in, confirm-before-insert), and update the shell/notifications guidance to describe the single bell.
- Append a change-log line to `AGENTS.md` for the v1.27 UI baseline shift.

## Technical notes

- Files touched: `src/features/shared/app-shell.tsx`, `src/components/barcode-scan-button.tsx`, `src/features/receiving/receiving-page.tsx` (wiring only), `supabase/functions/container-vision/index.ts` (new), `supabase/config.toml`, `src/App.tsx`, `src/features/admin/admin-page.tsx`, `src/lib/help-content.ts`, `package.json`, `AGENTS.md`.
- No schema changes. The edge function is stateless and no image is persisted.
- Existing tests in `src/test/barcode-scan-button.test.tsx` stay valid (AI path mocked/off by default); add a case for the AI fallback returning a check-digit-valid code and one for it returning garbage that is rejected.