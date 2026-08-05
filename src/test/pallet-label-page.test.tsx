import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { buildPalletLabelPrintHtml, PalletLabelPage } from "@/components/pallet-label-page";

describe("PalletLabelPage", () => {
  it("prints a responsive 4x6 label that fits within the selected page box", async () => {
    const writtenHtml: string[] = [];
    const printWindow = {
      document: {
        write: vi.fn((html: string) => writtenHtml.push(html)),
        close: vi.fn(),
      },
    };
    const openSpy = vi.spyOn(window, "open").mockReturnValue(printWindow as unknown as Window);

    render(
      <PalletLabelPage
        barcode="PLT-38295352EVSW"
        productSku="LCFK-GC90F"
        productName="GREENWARE 9oz SQUAT CLEAR COLD CUP 50/PK 20PKS/CS"
        quantity={1000}
        expiryDate="2026-07-31"
        receiptReference="RCT-38295352EVSW"
        trigger={<button type="button">Open label</button>}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /open label/i }));
    fireEvent.click(await screen.findByRole("button", { name: /print label/i }));

    expect(openSpy).toHaveBeenCalled();
    const html = writtenHtml.join("");
    expect(html).toContain("@page { size: auto; margin: 0; }");
    expect(html).toContain("class=\"page-fit\"");
    expect(html).toContain("width: min(101.6mm, 100vw, calc(100vh * 2 / 3));");
    expect(html).toContain("height: min(152.4mm, 100vh, calc(100vw * 3 / 2));");
    expect(html).toContain("container-type: size;");
    expect(html).toContain("Receipt RCT-38295352EVSW");
    expect(html).toContain("Warehouse Wizard");
    expect(html).toContain(`v${__APP_VERSION__}`);
    expect(html).not.toContain("Pallet barcode");
    expect(html).not.toContain("Temperature");
  });

  it("builds the same responsive print shell without opening the browser print window", () => {
    const html = buildPalletLabelPrintHtml({
      barcode: "PLT-38295352EVSW",
      productSku: "LCFK-GC90F",
      productName: "GREENWARE 9oz SQUAT CLEAR COLD CUP 50/PK 20PKS/CS",
      quantity: 1000,
      expiryDate: "2026-07-31",
      receiptReference: "RCT-38295352EVSW",
    });

    expect(html).toContain("@page { size: auto; margin: 0; }");
    expect(html).toContain("container-type: size;");
    expect(html).toContain("width: min(101.6mm, 100vw, calc(100vh * 2 / 3));");
    expect(html).toContain("height: min(152.4mm, 100vh, calc(100vw * 3 / 2));");
  });
});
