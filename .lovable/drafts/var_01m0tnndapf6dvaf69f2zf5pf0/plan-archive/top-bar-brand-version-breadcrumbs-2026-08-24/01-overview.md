# Top bar: brand, version, breadcrumbs

The desktop top bar currently shows only the current page name plus a small version chip. It becomes a proper identity + location strip:

`[icon]  Warehouse Wizard 1.28.5   |   Dashboard`

- **Icon** — the pallet-cube app mark, small, links to the dashboard.
- **Title with version** — "Warehouse Wizard" followed by the running version number in the same line (version stays the developer "Edit with Lovable" link when a developer is signed in, plain text for everyone else).
- **Spacer** — a thin vertical divider between the brand block and the location trail.
- **Breadcrumbs** — where the user is: section, then page, then the record when one is open (for example `Put-Away > PTA-1043`). The last crumb is plain text; earlier crumbs are links.

The right side of the bar (warehouse switcher, Copilot, Help, alerts, profile) is unchanged. The reconnect spinner keeps its place beside the brand.
