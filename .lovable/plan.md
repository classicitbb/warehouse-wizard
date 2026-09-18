# Improve color-scheme clarity

## Goal
Make the current Warehouse Wizard UI easier to read while preserving the established dark "Command Center" theme. The work focuses on the shared design tokens that drive every page, with a before/after check on `/receiving` (the page the user is on).

## Current issue
The dark palette uses very low-contrast secondary colors:
- `muted-foreground` is `215 12% 50%` — many labels and helper text sit below WCAG contrast on dark surfaces.
- `border` is `215 18% 32%` — table/divider edges are barely visible.
- `card`/`background` are extremely close (`12%` vs `19%` lightness) — cards do not lift off the page.
- Primary cyan and accent amber can appear dim against dark backgrounds.

These combine to make tables, form boundaries, and scan prompts harder to read than they should be.

## Proposed changes

### 1. Contrast-first token update in `src/index.css`
Adjust only the HSL values of the existing semantic tokens (no new tokens, no hardcoded colors):
- Increase `foreground` lightness from `90%` to `96%`.
- Increase `muted-foreground` lightness from `50%` to `70%`.
- Lighten `card` surface from `12%` to `16%` and keep `background` at `19%` so cards separate from the page.
- Increase `border` lightness from `32%` to `45%` so dividers and input borders are visible.
- Lighten `input` surface from `26%` to `30%` to make text fields easier to locate.
- Brighten `primary` slightly (from `47%` to `52%` lightness) and `accent` similarly so CTAs and scan halos stand out.
- Desaturate/lighten `sidebar-background` slightly so the bright blue does not compete with page content.

### 2. Component-level spot checks
After the token change, verify the following are still rendering through the tokens and not with hardcoded overrides. Fix any hardcoded low-contrast classes found in these areas:
- Receiving table rows and zebra striping.
- Scan prompt halo and input focus rings.
- Form labels / helper text using `muted-foreground`.
- Sidebar text and active item state.
- Buttons / badges using `primary`, `accent`, `secondary`.

No broad component rewrites — only contrast/class corrections.

### 3. Validation
- Run `npm run typecheck` to ensure no TypeScript regressions.
- Capture a Playwright screenshot of `/receiving` to confirm the new contrast is visibly clearer.

### 4. Versioning on publish
If the change is published, bump `package.json` and `RELEASE_HISTORY` in `src/App.tsx` with a short release note.

## Out of scope
- Switching to a full light theme.
- Adding a theme toggle.
- Changing fonts, layout, spacing, or branding colors beyond contrast/brightness tuning.
- Redesigning any page or workflow.

## Acceptance criteria
- The Receiving page, sidebar, and tables are visibly clearer without changing the overall dark theme.
- All changes are made through existing semantic tokens in `src/index.css` and `tailwind.config.ts`.
- No build/type errors are introduced.
