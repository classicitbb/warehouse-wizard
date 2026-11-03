/** Public marketing site. The sign-in screen links here so tiles resolve to explainers. */
export const MARKETING_URL = "https://warehousewizard.app";

/** Anchors that exist as sections on the marketing site. */
export type MarketingAnchor = "pallet-tracking" | "pick-putaway" | "cycle-counts" | "multi-warehouse";

export function marketingUrl(anchor?: MarketingAnchor): string {
  return anchor ? `${MARKETING_URL}/#${anchor}` : MARKETING_URL;
}
