# Two fixes: SKU typing and dialogs that fit the screen

## 1. Typing a SKU must not pick a product on its own

Confirmed cause: the product picker watches what you type and instantly selects a
product whose **barcode exactly matches the typed text**. There is a real product
with barcode `CF8`, so the moment an operator types `CF8` on the way to `CF850`
the picker grabs Country Farm 8lb Rice, closes the list, and jumps focus to the
next control. The same trap exists for every short barcode in the catalogue
(`85`, `J1`, `M8`, `70`, `35`, and many 3-character codes) — so this affects far
more than one SKU.

Change:
- Manual typing never selects anything. A product is chosen only when the
  operator clicks/taps a result or presses Enter on the highlighted result.
- Real scans still auto-select. Scans arrive through the scan button / scanner
  handle, which stays exact-match and instant; typed keystrokes no longer do.
- If a scan finds no match, the typed value stays in the search box with the list
  open, as today.

Applies everywhere the shared picker is used: Create Shipment / receiving lines,
pallet and pack screens, picking, inventory, moves, resources, dashboard.

## 2. Dialogs must always fit the window height

Today's dialog shell is centred with no height limit, so on short windows
(laptops, landscape phones/tablets) tall forms overflow: the title and the
close/report controls can sit above the top of the screen and Save/Cancel below
the bottom.

Change to the shared dialog shell:
- Cap dialog height to the visible window height (with a small margin) and let
  the middle content area scroll.
- Title row and the close / report-problem controls stay pinned at the top and
  always fully visible.
- Footer commit controls (Cancel, Save & New, Save & Receive, etc.) stay pinned
  at the bottom and always fully visible, never clipped.
- Long content squashes/scrolls inside instead of pushing the frame off-screen.

This is a shell-level change, so every existing dialog inherits it without
per-screen rework.

## 3. Tests

New test file covering the guarantees:
- Typing a value that exactly equals a short barcode does **not** change the
  selection; clicking a result and pressing Enter do.
- A scan of that same code still selects instantly.
- Dialog shell renders with viewport-bounded height, a scrollable body, and
  non-shrinking header/footer regions, verified at short viewport heights
  (e.g. 500px and 360px) for a tall form: title, close, report and all footer
  buttons remain within the visible area.

Focused run of the new tests plus the receiving, pack-standard, pallet-edit and
dialog-related suites, then typecheck.

## Technical notes

- `src/components/product-search.tsx`: drop the `useEffect` that matches `query`
  against `options[].barcode`; keep `scanBarcode()` on the imperative handle as
  the only auto-select path.
- `src/components/ui/dialog.tsx`: `DialogContent` base classes become a
  `max-h-[calc(100svh-2rem)]` flex column with `overflow-hidden`; `DialogHeader`
  and `DialogFooter` get `shrink-0`, and a scrollable body wrapper
  (`min-h-0 overflow-y-auto`) holds the remaining children. Existing per-dialog
  `max-h`/`overflow` overrides still win via `cn`.
- New `src/test/dialog-viewport-fit.test.tsx` and additions to a
  product-search test file; no schema or backend changes.

No version bump proposed here — say the word if you want this published as a
release.
