import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { LandingPage } from "@/features/landing/landing-page";

const showPage = () => render(<MemoryRouter><LandingPage /></MemoryRouter>);

describe("landing page", () => {
  it("provides real destinations without placeholder endorsements", () => {
    showPage();
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login");
    expect(screen.getByRole("link", { name: "russell@classicvisions.net" })).toHaveAttribute("href", "mailto:russell@classicvisions.net");
    expect(screen.queryByText(/placeholder/i)).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "From dock door to verified pick" })).toBeInTheDocument();
  });

  it("opens a labelled demo form and restores focus to the invoking button", async () => {
    showPage();
    const trigger = screen.getAllByRole("button", { name: "Request a demo" })[1];
    trigger.focus();
    fireEvent.click(trigger);
    expect(screen.getByRole("dialog", { name: "Request a demo" })).toBeInTheDocument();
    expect(screen.getByLabelText("Full name")).toHaveAttribute("autocomplete", "name");
    expect(screen.getByLabelText("Work email")).toHaveAttribute("type", "email");
    expect(screen.getByLabelText("Company")).toHaveAttribute("autocomplete", "organization");
    expect(screen.getByRole("button", { name: "Prepare demo email" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close demo request" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("connects FAQ questions to their expandable answers", () => {
    showPage();
    const question = screen.getByRole("button", { name: /Does it connect to NetSuite/ });
    fireEvent.click(question);
    expect(question).toHaveAttribute("aria-expanded", "true");
    expect(document.getElementById(question.getAttribute("aria-controls")!)).toHaveTextContent(/NetSuite/);
  });
});
