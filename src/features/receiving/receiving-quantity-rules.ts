/**
 * receiving-quantity-rules.ts
 *
 * The arithmetic behind a receiving SKU line, and what to say when it does not
 * add up. Used by both entry modes on the Receiving screen — New Shipment and
 * New Pallet — so a pallet split is judged the same way whichever door it came
 * in through.
 *
 * Two failures were silent before and are not any more:
 *
 *   Missing learned qty — a SKU with no learned units-per-pallet leaves the
 *   field on its default of 1. Typing a total of 500 then quietly produced 500
 *   pallets of 1. The line now says the qty per pallet is not known yet and
 *   holds the pallet count until the operator supplies one.
 *
 *   Inconsistent split — pallets × qty per pallet can exceed what was received
 *   (a qty per pallet larger than the total, or a pallet count typed upwards).
 *   The old remainder clamped at zero, so the over-allocation never showed.
 *
 * Pure arithmetic and wording: no React, no Supabase, no side effects.
 */

/** Just enough of a shipment line to do the sums. */
export type ShipmentQuantityLine = {
  total_quantity: number | string;
  quantity_per_pallet: number | string;
  pallet_count: number | string;
  remainder_action?: string;
};

export type ShipmentQuantityFacts = {
  /** NaN when the field is blank or not a number. */
  total: number;
  perPallet: number;
  palletCount: number;
  /** Units the pallets account for. */
  allocated: number;
  /** Units left over once the whole pallets are built. Never negative. */
  remainder: number;
  /** Units the pallets claim beyond what was received. Never negative. */
  overAllocated: number;
};

export type ShipmentQuantityIssues = {
  /** Inline message under Total received, "" when it is fine. */
  total: string;
  /** Inline message under Qty per pallet. */
  perPallet: string;
  /** Inline message under Pallets. */
  palletCount: string;
  /** The first message that stops the line being saved, "" when it is fine. */
  blocking: string;
  /** Only offer the leftover-quantity choice once the numbers make sense. */
  showRemainder: boolean;
  facts: ShipmentQuantityFacts;
};

/** Blank is missing, not zero — the two need different wording. */
function parseQuantity(value: number | string | null | undefined): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : Number.NaN;
  const text = String(value ?? "").trim();
  if (text === "") return Number.NaN;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

export function shipmentQuantityFacts(line: ShipmentQuantityLine): ShipmentQuantityFacts {
  const total = parseQuantity(line.total_quantity);
  const perPallet = parseQuantity(line.quantity_per_pallet);
  const palletCount = parseQuantity(line.pallet_count);
  const allocated =
    Number.isNaN(perPallet) || Number.isNaN(palletCount) ? Number.NaN : perPallet * palletCount;
  const difference = Number.isNaN(total) || Number.isNaN(allocated) ? Number.NaN : total - allocated;

  return {
    total,
    perPallet,
    palletCount,
    allocated,
    remainder: Number.isNaN(difference) ? 0 : Math.max(0, difference),
    overAllocated: Number.isNaN(difference) ? 0 : Math.max(0, -difference),
  };
}

function plural(count: number, word: string) {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

/**
 * Whether the qty per pallet is a real number for this SKU — learned from prior
 * receipts, typed by the operator, or carried in from a saved draft — as
 * opposed to the untouched default.
 */
export type PerPalletSource = "learned" | "entered" | "unknown";

export function validateShipmentQuantities(input: {
  line: ShipmentQuantityLine;
  perPalletSource: PerPalletSource;
  /** SKU of the selected product, for the "nothing learned yet" message. */
  productLabel?: string | null;
}): ShipmentQuantityIssues {
  const facts = shipmentQuantityFacts(input.line);
  const { total, perPallet, palletCount, allocated } = facts;
  const issues = { total: "", perPallet: "", palletCount: "" };

  if (Number.isNaN(total)) {
    issues.total = "Enter the total received.";
  } else if (total <= 0) {
    issues.total = "Total received must be at least 1.";
  }

  if (Number.isNaN(perPallet)) {
    issues.perPallet = "Enter how many units go on one pallet.";
  } else if (perPallet <= 0) {
    issues.perPallet = "Qty per pallet must be at least 1.";
  } else if (input.perPalletSource === "unknown" && !Number.isNaN(total) && total > perPallet) {
    // Nothing learned for this SKU and nothing typed, so the default of 1 would
    // turn the total into one pallet per unit. Ask instead of guessing.
    const sku = input.productLabel?.trim();
    issues.perPallet = `No learned qty per pallet${sku ? ` for ${sku}` : ""} yet — enter how many units go on one pallet.`;
  }

  if (Number.isNaN(palletCount)) {
    issues.palletCount = "Enter how many pallets.";
  } else if (palletCount <= 0) {
    issues.palletCount = "Pallets must be at least 1.";
  } else if (!Number.isInteger(palletCount)) {
    issues.palletCount = "Pallets must be a whole number.";
  } else if (facts.overAllocated > 0 && !issues.perPallet && !issues.total) {
    issues.palletCount =
      `${plural(palletCount, "pallet")} of ${perPallet} allocates ${allocated} units, ` +
      `${facts.overAllocated} more than the ${total} received. ` +
      "Lower the pallet count or the qty per pallet.";
  }

  const blocking = issues.total || issues.perPallet || issues.palletCount;
  return {
    ...issues,
    blocking,
    showRemainder: !blocking && facts.remainder > 0,
    facts,
  };
}

/**
 * Whether a change to Total received should redistribute the line. It should
 * whenever the qty per pallet means something — that is what keeps the pallet
 * count live as the total is retyped — and it should not while the qty per
 * pallet is still an unconfirmed default, because a count derived from that is
 * a made-up number the operator has to undo.
 */
export function shouldRedistributeOnTotal(input: {
  nextTotal: string;
  perPalletSource: PerPalletSource;
}): "total" | undefined {
  if (input.nextTotal.trim() === "") return undefined;
  return input.perPalletSource === "unknown" ? undefined : "total";
}
