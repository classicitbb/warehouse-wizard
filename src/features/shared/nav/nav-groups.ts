// nav-groups.ts — pure grouping for the sidebar. Entries with a `group` fold
// under one toggle-only row placed where the group's first entry sits.
import { NAV_GROUPS, type NavGroupKey } from "@/features/shared/core-types";

type Groupable = { to: string; group?: NavGroupKey };

export type NavRow<T extends Groupable> =
  | { kind: "item"; item: T }
  | { kind: "group"; key: NavGroupKey; label: string; children: T[] };

export function groupNavigation<T extends Groupable>(items: T[]): NavRow<T>[] {
  const rows: NavRow<T>[] = [];
  const seen = new Map<NavGroupKey, Extract<NavRow<T>, { kind: "group" }>>();
  for (const item of items) {
    if (!item.group) {
      rows.push({ kind: "item", item });
      continue;
    }
    let row = seen.get(item.group);
    if (!row) {
      row = { kind: "group", key: item.group, label: NAV_GROUPS[item.group].label, children: [] };
      seen.set(item.group, row);
      rows.push(row);
    }
    row.children.push(item);
  }
  return rows;
}

/** The group holding the current route, so the active page is never hidden. */
export function activeGroupKey(items: Groupable[], pathname: string): NavGroupKey | null {
  return items.find((item) => item.group && item.to === pathname)?.group ?? null;
}
