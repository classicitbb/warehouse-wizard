## Technical notes

All edits are in `src/features/shared/app-shell.tsx`.

- Shell grid (currently `lg:landscape:grid-rows-1` with two columns): becomes `grid-rows-[auto_minmax(0,1fr)]` in landscape too, with the desktop top bar as a `col-span-full` row-1 element and `aside` + `main` on row 2. The collapsed-width column variant (`64px`) is unchanged.
- The desktop top bar block (currently the first child of `<main>`) moves out of `<main>` and becomes a sibling `<header>` above `<aside>`, keeping its classes (`hidden ... lg:landscape:flex`, `border-b`, `bg-background/95`, `backdrop-blur`) plus `col-span-full`.
- `renderNavigation`: delete the logo/title block (the `!compactTop` branch with the black tile and "Warehouse Wizard" span); the nav list becomes the first child. Keep the collapse toggle footer.
- The sidebar wrapper keeps `bg-sidebar` / `bg-teal-500` when collapsed; because the column now starts on row 2, the fill naturally stops at the header border. `h-full` stays so it fills the remaining height.
- Mobile / portrait header is untouched.
- `src/test/app-shell.test.tsx` asserts `WW` appears and checks the body scroll container — verify both still hold after the move; the removed sidebar title is not asserted separately, but re-run the suite.
- Version bump and release notes on publish, per project convention.
