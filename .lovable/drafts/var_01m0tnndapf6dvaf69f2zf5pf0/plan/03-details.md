## Mobile / portrait

The compact header already shows the mark and title; it gains the version appended to the title and, below it on a second line, a single-crumb trail of the current page. No other change there.

## Technical notes

- All edits are in `src/features/shared/app-shell.tsx`, in the desktop top-bar block and the mobile header block. No new dependencies.
- Brand block: existing `/logo.png` tile at `h-6 w-6`, `appTitle` text, and `v{__APP_VERSION__}` kept as the developer Lovable link / plain chip logic that exists today, followed by a `border-l border-border` divider.
- Breadcrumbs: a small local `Breadcrumbs` helper deriving crumbs from `pathname` against the existing `NAVIGATION` items — section group label (already present on nav entries) plus the item label, with an optional trailing crumb passed through when a page has a record open. Uses shadcn `breadcrumb` primitives if present in `src/components/ui`, otherwise plain spans/links with the existing muted tokens; crumbs route through `toPath()`.
- Truncation: brand block is `shrink-0`, the trail truncates from the left with `min-w-0 truncate` so the right cluster never collapses.
- Tokens only — `text-foreground`, `text-muted-foreground`, `border-border`; no new colors, no layout/height change to the bar.
- `src/test/app-shell.test.tsx` currently asserts the compact title is `WW`; the assertion is updated to accept the title plus version and a new case checks the breadcrumb trail renders for the active route.
- Version bump and release notes on publish, per project convention.
