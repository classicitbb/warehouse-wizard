import { describe, it, expect, vi } from "vitest";
import { createRef } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ProductSearch, type ProductSearchHandle, type ProductOption } from "@/components/product-search";

const options: ProductOption[] = [
  { id: "short", sku: "CF8", name: "Country Farm 8lb Rice", barcode: "CF8" },
  { id: "long", sku: "CF850", name: "Country Farm 850 Rice", barcode: "CF850" },
];

describe("product search typing", () => {
  it("does not select a product while typing a code that matches a shorter barcode", async () => {
    const onChange = vi.fn();
    render(<ProductSearch value="" onChange={onChange} options={options} />);

    await userEvent.click(screen.getByRole("combobox"));
    const input = await screen.findByPlaceholderText(/Type SKU, name, or scan barcode/i);
    await userEvent.type(input, "CF8");
    expect(onChange).not.toHaveBeenCalled();

    await userEvent.type(input, "50");
    expect(onChange).not.toHaveBeenCalled();
    expect((input as HTMLInputElement).value).toBe("CF850");
  });

  it("selects when a result is clicked", async () => {
    const onChange = vi.fn();
    render(<ProductSearch value="" onChange={onChange} options={options} />);

    await userEvent.click(screen.getByRole("combobox"));
    const input = await screen.findByPlaceholderText(/Type SKU, name, or scan barcode/i);
    await userEvent.type(input, "CF850");
    await userEvent.click(screen.getByText("Country Farm 850 Rice"));
    expect(onChange).toHaveBeenCalledWith("long");
  });

  it("selects the highlighted result on Enter", async () => {
    const onChange = vi.fn();
    render(<ProductSearch value="" onChange={onChange} options={options} />);

    await userEvent.click(screen.getByRole("combobox"));
    const input = await screen.findByPlaceholderText(/Type SKU, name, or scan barcode/i);
    await userEvent.type(input, "CF850");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith("long");
  });

  it("still auto-selects a real scan of the short code", () => {
    const onChange = vi.fn();
    const ref = createRef<ProductSearchHandle>();
    render(<ProductSearch ref={ref} value="" onChange={onChange} options={options} />);

    expect(ref.current?.scanBarcode("CF8")).toBe(true);
    expect(onChange).toHaveBeenCalledWith("short");
  });
});
