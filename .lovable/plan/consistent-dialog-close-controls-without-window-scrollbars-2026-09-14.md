# Consistent dialog close controls without window scrollbars

## What will change

- Replace the padding-dependent close-control rail in the shared dialog window with one corner-anchored control group.
- Place the **X flush in the dialog’s top-right corner** for every dialog size and layout, including dialogs that remove default padding.
- Keep the report/life-buoy button immediately to the left of the X without allowing either control to move when dialog content scrolls.
- Remove the X button’s border/ring/outline and all hover styling. Its red surface will remain unchanged on hover and shift shade only while pressed/clicked.
- Preserve the X button’s accessible name and keyboard activation.

## Scrolling behavior

- Keep tall dialog content usable within the visible screen height, but hide the scrollbar drawn on the dialog window itself.
- Preserve wheel, touch, trackpad, keyboard, and clickable-thumb scrolling; keep the thumb visible and remove only the scrollbar track background.
- Keep title and commit controls visible while the middle content moves, without adding a second nested scrollbar.
- Remove or neutralize dialog-specific overflow rules that override the shared behavior where they cause duplicate or visible window scrollbars.

## Tests and verification

- Update the shared dialog tests to verify the X is corner-anchored and independent of dialog padding.
- Verify the X has no hover, focus-ring, rounded-outline, or border styling and has a pressed-state shade only.
- Verify tall dialogs remain height-bounded and scrollable with no visible scrollbar styling.
- Test all known dialogs, including the screenshot examples: New Shipment, Scan pallet for Put-Away, and Edit User.
- Check desktop and a short mobile/tablet viewport to confirm the controls do not move, overlap titles, or clip.
- Run the focused dialog tests, full typecheck, and confirm the preview build remains clean.

## Technical notes

- Primary change: `src/components/ui/dialog.tsx`.
- Add a small semantic scrollbar-hiding utility in `src/index.css` only if existing utility classes cannot cover Firefox and WebKit consistently.
- Update `src/test/dialog-viewport-fit.test.tsx`; add narrow integration coverage only where a representative dialog needs it.
- No data, permissions, or backend changes.
