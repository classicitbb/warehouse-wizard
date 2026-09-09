import { fireEvent, render, screen } from "@testing-library/react";
import { useForm } from "react-hook-form";
import { describe, expect, it, vi } from "vitest";

import { PACK_SECTION_FIELDS, PackStandardFormSection } from "@/features/shared/pack-standard-form";

function Harness({ onValues, initial }: { onValues: (v: Record<string, unknown>) => void; initial?: Record<string, unknown> }) {
  const form = useForm<Record<string, unknown>>({
    defaultValues: {
      packages_per_layer: "", layers_per_pallet: "", package_height_mm: "", height: "",
      package_length_mm: "", length: "", package_width_mm: "", width: "",
      pallet_base_height_mm: 145, slip_sheet_height_mm: 0, layer_pattern: "block",
      pallet_footprint_length_mm: 1200, pallet_footprint_width_mm: 1000,
      max_stack_pallets: 1, quantity_tolerance: 0, is_pallet_standard: false, build_notes: "",
      ...initial,
    },
  });
  onValues(form.getValues());
  return (
    <>
      <PackStandardFormSection form={form} />
      <button type="button" onClick={() => onValues(form.getValues())}>read values</button>
    </>
  );
}

function setField(label: RegExp, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
  fireEvent.click(screen.getByRole("button", { name: "read values" }));
}

describe("PackStandardFormSection — the cm/mm pairing", () => {
  it("writes the centimetre twin whenever a millimetre dimension changes", () => {
    // mm alone leaves the legacy cm columns stale, and the sync trigger would
    // then overwrite our mm from that stale cm on the next update.
    const onValues = vi.fn();
    render(<Harness onValues={onValues} />);
    setField(/package height \(mm\)/i, "225");
    const latest = onValues.mock.calls.at(-1)![0];
    expect(latest.package_height_mm).toBe(225);
    expect(latest.height).toBe(22.5);
  });

  it("pairs length and width the same way", () => {
    const onValues = vi.fn();
    render(<Harness onValues={onValues} />);
    setField(/package length \(mm\)/i, "400");
    expect(onValues.mock.calls.at(-1)![0].length).toBe(40);
    setField(/package width \(mm\)/i, "300");
    expect(onValues.mock.calls.at(-1)![0].width).toBe(30);
  });

  it("clears both halves together", () => {
    const onValues = vi.fn();
    render(<Harness onValues={onValues} initial={{ package_height_mm: 225, height: 22.5 }} />);
    setField(/package height \(mm\)/i, "");
    const latest = onValues.mock.calls.at(-1)![0];
    expect(latest.package_height_mm).toBeNull();
    expect(latest.height).toBeNull();
  });
});

describe("PackStandardFormSection — the silent null trap", () => {
  it("restores the deck height default rather than leaving it blank", () => {
    // A null pallet_base_height_mm makes the generated standard_height_mm null,
    // and a missing height is treated as "no evidence of a problem".
    const onValues = vi.fn();
    render(<Harness onValues={onValues} />);
    setField(/deck height \(mm\)/i, "");
    expect(onValues.mock.calls.at(-1)![0].pallet_base_height_mm).toBe(145);
  });

  it("restores the slip sheet default rather than leaving it blank", () => {
    const onValues = vi.fn();
    render(<Harness onValues={onValues} initial={{ slip_sheet_height_mm: 12 }} />);
    setField(/slip sheet \(mm\)/i, "");
    expect(onValues.mock.calls.at(-1)![0].slip_sheet_height_mm).toBe(0);
  });
});

describe("PackStandardFormSection — the two requested fields", () => {
  it("renders packages per layer and layers per pallet, and names the pack code", () => {
    const onValues = vi.fn();
    render(<Harness onValues={onValues} initial={{ packages_per_layer: 12, layers_per_pallet: 7 }} />);
    expect(screen.getByLabelText(/packages per layer/i)).toHaveValue(12);
    expect(screen.getByLabelText(/layers per pallet/i)).toHaveValue(7);
    // The summary is what tells an operator 12 x 7 means 84 on the pallet.
    expect(screen.getByText(/12 × 7 · 84 cases per pallet/i)).toBeInTheDocument();
  });

  it("describes each number in the floor's own vocabulary", () => {
    render(<Harness onValues={vi.fn()} initial={{ packages_per_layer: 12, layers_per_pallet: 7 }} />);
    expect(screen.getByText("The 12 in 12 × 7.")).toBeInTheDocument();
    expect(screen.getByText("The 7 in 12 × 7.")).toBeInTheDocument();
  });
});

describe("PACK_SECTION_FIELDS", () => {
  it("claims every column the section renders", () => {
    for (const name of [
      "packages_per_layer", "layers_per_pallet", "layer_pattern", "layer_columns",
      "package_length_mm", "package_width_mm", "package_height_mm",
      "pallet_footprint_length_mm", "pallet_footprint_width_mm",
      "pallet_base_height_mm", "slip_sheet_height_mm", "pallet_tare_kg",
      "max_stack_pallets", "quantity_tolerance", "is_pallet_standard", "build_notes",
    ]) {
      expect(PACK_SECTION_FIELDS.has(name)).toBe(true);
    }
  });

  it("leaves the legacy centimetre columns to the generic form loop", () => {
    // They stay visible as ordinary fields; the section only mirrors into them.
    for (const name of ["length", "width", "height", "weight", "profile_name", "units_per_package"]) {
      expect(PACK_SECTION_FIELDS.has(name)).toBe(false);
    }
  });
});
