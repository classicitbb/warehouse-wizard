# Full-width top bar, sidebar below it

Today the desktop top bar lives inside the content column, so the sidebar sits beside it and runs the full height of the window. The identity strip (icon + "Warehouse Wizard 1.28.5") is duplicated in the sidebar head.

The change:

- The top bar spans the entire viewport width, above everything else.
- The sidebar starts directly under the top bar and runs down the left side of the content only, so its background (including the teal collapsed state) stops at the header line.
- The sidebar's own logo tile and "Warehouse Wizard" label are removed — **Dashboard** becomes the first item, right under the header.
- Everything in the top bar (brand, version, breadcrumbs, warehouse switcher, Copilot, Help, alerts, profile) and every nav item stays the same otherwise.
