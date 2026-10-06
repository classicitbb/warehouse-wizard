# Alternate pallet pick: readability pass and end-to-end test

## Problems in the current panel (from the screenshot)
- The "Override source" button shows dark text on a dark button, so you can barely read it.
- The panel background is a muddy grey in dark mode, so the orange heading and helper text are hard to read.
- "Cancel alternate pallet" is pale text on a pale grey background.
- After you tap "Override source", there are two "Confirm pick" buttons (one in the panel, one at the bottom), which is confusing.
- The "Verify" button and the camera button sit next to each other with nothing to tell them apart.

## Changes (Pick Execution card only)
1. **Panel colours:** use the app's existing warning colours, so the panel reads clearly in both dark and light mode. No new colours.
2. **"Override source" button:** a solid amber button with dark text, so it's clearly the next step. When the quantity is different, the label becomes "Override & pick 40 (requested 50)".
3. **One confirm button:** remove the second "Confirm pick" inside the panel. Once the override is on, the panel shows "Override on — the directed pallet goes back into stock", and the bottom button turns amber and reads "Confirm alternate pick".
4. **Clearer labels:**
   - "Verify" becomes "Verify pallet".
   - "Cancel alternate pallet" becomes a readable outline button called "Use directed pallet instead".
   - The helper text gets shorter: "Scan or type the pallet. We check SKU, quantity, location and holds."
5. **Error message:** if the pallet can't be used, the reason shows inside the panel in red as well as in the pop-up message.

## End-to-end test
I'll drive the screen in a test browser and take screenshots of each step:
- scanning the directed pallet works the normal way
- scanning an alternate pallet opens the panel and shows the "detected" message
- the green "verified" message appears and the override can be armed
- the Verify button works without pressing Enter
- a pallet with the wrong SKU or a bad barcode shows a clear error
- the bottom button switches to "Confirm alternate pick"
- cancelling resets the panel

Confirming the pick would move real stock. So the test stops just before that final tap unless you say yes. If you say yes, it confirms the pick on task PKT-289652991GV3 using pallet PLT-82510732HMMF from J-02-B. I'll then check the audit trail, that the directed pallet is still in stock, and that the pick list closes.

## Release
Version 1.30.4, with release notes and the Help topic wording updated to match the new button names.

## Technical details
- File: `src/features/picking/pick-execution-page.tsx`. Replace the hardcoded `amber-*` classes on the alternate panel with the warning token from `index.css` and the existing Button variants, and remove the inner confirm button. The submit button's label and variant come from `alternateReady`, and `handleSubmit` already sends the override.
- Add `alternateError` state that `previewAlternate` sets when it fails.
- Update `src/lib/help-content.ts` (topic `pick-alternate-pallet`) and `src/lib/release-history.ts`, and bump the version in `package.json`.
