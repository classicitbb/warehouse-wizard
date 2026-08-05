# UI Consistency Audit - 2026-05-29

Scope: static audit only. No frozen UI surfaces were changed.

## Summary

- The app generally follows the existing shadcn primitives and token system.
- Most workflow screens share the same shell, card, table, dialog, and form patterns.
- The main consistency risks are historical inline utility drift in frozen UI files, especially login-specific colors, print-label hard-coded colors, and a few one-off sizing/radius choices.

## Findings

- `src/App.tsx`: Login and pending-access surfaces use several explicit color utilities such as `bg-slate-950`, `bg-slate-500`, and a radial-gradient utility alongside tokenized classes. These are frozen, but they are the most visible token-consistency outliers.
- `src/components/wms-ui.tsx`: The sidebar collapse state includes a direct `bg-teal-500` override while the rest of the shell mostly uses sidebar tokens. This should be normalized only with explicit UI approval.
- `src/components/*label-page.tsx` and print helpers in `src/components/wms-ui.tsx`: Label/print output intentionally uses hard-coded black, white, gray, and temperature accent colors. This is acceptable for physical labels, but it should remain isolated from app chrome styling.
- `src/components/wms-ui.tsx`: Some status and feedback treatments use direct Tailwind semantic colors (`amber`, `green`, `teal`) instead of the `success`, `warning`, and `info` tokens. A future approved polish pass could centralize these variants.
- `src/components/wms-ui.tsx`: Large multi-purpose components still mix dense dashboard cards, resource tables, dialogs, and mobile shell layout in one file. This is now lazy-loaded, but future UI work would be easier and safer after page-level extraction.

## Recommended Follow-Up

- Keep the UI freeze in force and only normalize visual inconsistencies when a specific surface is user-approved.
- If approved later, start with token cleanup in Login and Sidebar because those are first-viewport and high-reuse surfaces.
- For future performance passes, extract `wms-ui.tsx` into page modules so route-level code splitting can become truly per-route rather than one authenticated app chunk.
