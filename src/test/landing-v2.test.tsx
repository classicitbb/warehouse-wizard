import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import LandingV2 from "@/features/landing/landing-v2";
import LandingLegal from "@/features/landing/landing-legal";

beforeEach(() => { vi.spyOn(window, "scrollTo").mockImplementation(() => {}); Element.prototype.scrollIntoView = vi.fn(); });

const showPage = () => render(<MemoryRouter><LandingV2 /></MemoryRouter>);

describe("landing V2", () => {
  it("emphasizes inventory confidence and provides legal and top destinations", () => {
    showPage();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Your system says it’s in stock.");
    expect(screen.queryByText(/latest product updates/i)).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Privacy policy" })).toHaveAttribute("href", "/legal/privacy");
    expect(screen.getByRole("link", { name: "Terms and conditions" })).toHaveAttribute("href", "/legal/terms");
    expect(screen.getByRole("link", { name: "End user licence agreement" })).toHaveAttribute("href", "/legal/licence");
    expect(screen.getAllByRole("link", { name: /Back to top/ })[0]).toHaveAttribute("href", "#v2-top");
  });
  it("supports keyboard exploration of stock, spaces and flow", () => {
    showPage();
    const spaces = screen.getByRole("tab", { name: "Your spaces" });
    expect(spaces).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(spaces, { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "Your flow" })).toHaveFocus();
    expect(screen.getByRole("tabpanel")).toHaveTextContent("Your flow, on your terms.");
    fireEvent.click(screen.getByRole("tab", { name: "Your stock" }));
    expect(screen.getByRole("tabpanel")).toHaveTextContent("Products, pack sizes");
  });
  it.each(["pallet-tracking", "pick-putaway", "cycle-counts", "multi-warehouse"])("opens the matching explainer for #%s", (anchor) => {
    render(<MemoryRouter initialEntries={[`/landing-v2#${anchor}`]}><LandingV2 /></MemoryRouter>);
    const explainer = document.getElementById(anchor) as HTMLDetailsElement;
    expect(explainer.open).toBe(true);
    expect(explainer.scrollIntoView).toHaveBeenCalledWith({ block: "start" });
  });
  it("explains the scope of API and MCP compatibility", () => {
    showPage();
    expect(screen.getByText(/Each integration is scoped and tested/)).toBeInTheDocument();
    expect(screen.getByText(/Read-only tools work within/)).toBeInTheDocument();
  });
});

describe("legal review drafts", () => {
  it.each([["privacy", "Privacy policy"], ["terms", "Terms and conditions"], ["licence", "End user licence agreement"]])("renders the %s document with its status and operator", (path, title) => {
    render(<MemoryRouter initialEntries={[`/legal/${path}`]}><Routes><Route path="/legal/:document" element={<LandingLegal />} /></Routes></MemoryRouter>);
    expect(screen.getByRole("heading", { level: 1, name: title })).toBeInTheDocument();
    expect(screen.getByText(/Not yet effective/)).toBeInTheDocument();
    expect(screen.getAllByText(/Classic Visions/).length).toBeGreaterThan(0);
    expect(screen.getByRole("heading", { name: "Before this draft becomes effective" })).toBeInTheDocument();
  });
});
