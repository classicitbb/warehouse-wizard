import { describe, it, expect, vi } from "vitest";
import { createRef } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { ProductSearch, type ProductSearchHandle, type ProductOption } from "@/components/product-search";

// cmdk observes its list size; jsdom has no ResizeObserver.
if (!(globalThis as any).ResizeObserver) {
  (globalThis as any).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

const options: ProductOption[] = [
  { id: "short", sku: "CF8", name: "Country Farm 8lb Rice", barcode: "CF8" },
  { id: "long", sku: "CF850", name: "Country Farm 850 Rice", barcode: "CF850" },
];

async function openPicker(onChange: (id: string) => void) {
  render(<ProductSearch value="" onChange={onChange} options={options} />);
  fireEvent.click(screen.getByRole("combobox"));
  return (await screen.findByPlaceholderText(/Type SKU, name, or scan barcode/i)) as HTMLInputElement;
}

describe("product search typing", () => {
  it("does not select a product while typing a code that matches a shorter barcode", async () => {
    const onChange = vi.fn();
    const input = await openPicker(onChange);

    fireEvent.change(input, { target: { value: "CF8" } });
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: "CF850" } });
    expect(onChange).not.toHaveBeenCalled();
    expect(input.value).toBe("CF850");
  });

  it("selects when a result is clicked", async () => {
    const onChange = vi.fn();
    const input = await openPicker(onChange);

    fireEvent.change(input, { target: { value: "CF850" } });
    fireEvent.click(await screen.findByText("Country Farm 850 Rice"));
    expect(onChange).toHaveBeenCalledWith("long");
  });

  it("still auto-selects a real scan of the short code", () => {
    const onChange = vi.fn();
    const ref = createRef<ProductSearchHandle>();
    render(<ProductSearch ref={ref} value="" onChange={onChange} options={options} />);

    expect(ref.current?.scanBarcode("CF8")).toBe(true);
    expect(onChange).toHaveBeenCalledWith("short");
  });

  it("keeps an unmatched scan in the search box instead of selecting", () => {
    const onChange = vi.fn();
    const ref = createRef<ProductSearchHandle>();
    render(<ProductSearch ref={ref} value="" onChange={onChange} options={options} />);

    expect(ref.current?.scanBarcode("NOPE-123")).toBe(false);
    expect(onChange).not.toHaveBeenCalled();
  });
});
