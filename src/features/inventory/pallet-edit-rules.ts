// Rules for when a stored pallet may be edited from Inventory.
//
// Editing is a staging-area job: the correction flow may print a replacement
// label and re-direct the pallet, so it only runs from Put-Away Staging
// (STG-01-A) and the receiving staging spots — never from a rack location.

export const PUTAWAY_STAGING_LOCATION_CODE = "STG-01-A";

export const STAGING_EDIT_HINT =
  `A pallet can only be edited from Put-Away Staging (${PUTAWAY_STAGING_LOCATION_CODE}). Move it there first.`;

export type PalletEditBlockInput = {
  hasPallet: boolean;
  balanceCorrectionState?: "pending" | "superseded" | null;
  palletCorrectionState?: "pending" | "superseded" | null;
  balanceStatus?: string | null;
  reservedQuantity?: number | null;
  availableQuantity?: number | null;
  locationCode?: string | null;
  locationType?: string | null;
};

/**
 * Why a pallet cannot be edited from Inventory, or "" when the edit can open.
 * A pending edit is resumable rather than blocked — reopening it picks the
 * same draft back up instead of reserving a second pallet number.
 */
export function palletEditBlockedReason(input: PalletEditBlockInput): string {
  if (!input.hasPallet) return "This inventory record has no pallet.";
  if (input.balanceCorrectionState === "superseded" || input.palletCorrectionState === "superseded") {
    return "This pallet has been superseded by a correction.";
  }
  if (input.balanceCorrectionState === "pending" || input.palletCorrectionState === "pending") return "";
  if (input.balanceStatus === "receiving" || input.balanceStatus === "putaway") {
    if (!input.locationCode) return "Only a stored pallet can be corrected from Inventory.";
  }
  const statusNotEditable =
    input.balanceStatus !== "available" &&
    !((input.balanceStatus === "receiving" || input.balanceStatus === "putaway") && Number(input.availableQuantity ?? 0) === 0);
  if (statusNotEditable || Number(input.reservedQuantity ?? 0) > 0) {
    return "Clear reserved or allocated stock before correcting this pallet.";
  }
  if (!input.locationCode) return "Only a stored pallet can be corrected from Inventory.";

  if (input.locationType !== "staging") return STAGING_EDIT_HINT;
  return "";
}

/** True when the pallet is stored but not in staging — the case where the UI
 *  shows the staging hint and a Location Moves shortcut. */
export function palletOutsideStaging(input: { locationCode?: string | null; locationType?: string | null }): boolean {
  return Boolean(input.locationCode) && input.locationType !== "staging";
}
