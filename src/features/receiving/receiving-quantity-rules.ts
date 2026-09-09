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
/**
 * Where the qty per pallet came from. "standard" outranks "learned": a pack
 * standard is *declared* by someone who may set master data, while a hint is
 * *observed* from prior pallets and launders yesterday's mistakes into today's
 * default.
 */
export type PerPalletSource = "standard" | "learned" | "entered" | "unknown";

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

// ── Pack-code conformance ────────────────────────────────────────────────────

export type PackConformance = "standard" | "short" | "overpack";

export interface PackReconciliation {
  /** Display form of the declared code, e.g. `12 × 7`. */
  code: string;
  packagesPerPallet: number;
  /** What the declared pack expects, in whatever unit `countedIn` names. */
  expected: number;
  actual: number;
  /** actual - expected. Negative is short. */
  difference: number;
  fullLayers: number;
  topCount: number;
  conformance: PackConformance;
  message: string;
  /**
   * A pack code counts **cases**; quantity_per_pallet counts **stock units**.
   * They coincide only when units_per_package is 1, so the comparison says
   * which unit it made.
   */
  countedIn: "units" | "packages";
}

/**
 * Compares a typed pack code against what is actually going on one pallet.
 *
 * Compared against `quantity_per_pallet`, not the shipment total: a pack code
 * describes one pallet.
 *
 * **This never blocks a receipt.** It contributes nothing to
 * `validateShipmentQuantities().blocking`. A short last pallet is normal — the
 * final pallet of a run almost always is. A blocked receipt gets worked around
 * invisibly; a recorded variance is data the fit test and slotting can use.
 */
export function reconcilePackToQuantity(input: {
  parsed: { packagesPerLayer: number; layersPerPallet: number } | null;
  unitsPerPackage: number | null | undefined;
  quantityPerPallet: number | string;
}): PackReconciliation | null {
  const parsed = input.parsed;
  if (!parsed) return null;

  const actual = parseQuantity(input.quantityPerPallet);
  if (!Number.isFinite(actual) || actual < 0) return null;

  const packagesPerPallet = parsed.packagesPerLayer * parsed.layersPerPallet;
  const perPackage = Number(input.unitsPerPackage);
  const countedIn: "units" | "packages" =
    Number.isFinite(perPackage) && perPackage > 0 ? "units" : "packages";
  const multiplier = countedIn === "units" ? perPackage : 1;
  const expected = packagesPerPallet * multiplier;

  // Layer arithmetic is always in cases, whichever unit the comparison used.
  const actualPackages = Math.floor(actual / multiplier);
  const fullLayers = Math.floor(actualPackages / parsed.packagesPerLayer);
  const topCount = actualPackages - fullLayers * parsed.packagesPerLayer;

  const difference = actual - expected;
  const code = `${parsed.packagesPerLayer} × ${parsed.layersPerPallet}`;
  const unitWord = countedIn === "units" ? "unit" : "case";

  let conformance: PackConformance = "standard";
  let message = `${code} · ${expected} ${unitWord}${expected === 1 ? "" : "s"} — matches this pallet.`;
  if (difference < 0) {
    conformance = "short";
    const top = topCount > 0 ? ` plus ${topCount} of ${parsed.packagesPerLayer} on top` : "";
    message =
      `${code} · short ${Math.abs(difference)} ${unitWord}${Math.abs(difference) === 1 ? "" : "s"} ` +
      `of ${expected} — ${fullLayers} full layer${fullLayers === 1 ? "" : "s"}${top}.`;
  } else if (difference > 0) {
    conformance = "overpack";
    message = `${code} · ${difference} ${unitWord}${difference === 1 ? "" : "s"} over the ${expected} this pack holds.`;
  }
  if (countedIn === "packages") {
    message += " Counted in cases — this SKU has no units-per-package set.";
  }

  return {
    code, packagesPerPallet, expected, actual, difference,
    fullLayers, topCount, conformance, message, countedIn,
  };
}
