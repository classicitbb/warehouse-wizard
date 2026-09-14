import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

function TallDialog() {
  return (
    <Dialog open>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create shipment</DialogTitle>
        </DialogHeader>
        <div>
          {Array.from({ length: 60 }).map((_, index) => (
            <p key={index}>Line {index + 1}</p>
          ))}
        </div>
        <DialogFooter>
          <Button>Cancel</Button>
          <Button>Save &amp; New</Button>
          <Button>Save &amp; Receive</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

describe("dialog viewport fit", () => {
  it("caps the frame to the window height and scrolls its content", () => {
    render(<TallDialog />);
    const content = document.querySelector("[data-dialog-viewport-fit='true']") as HTMLElement;
    expect(content).toBeTruthy();
    expect(content.className).toContain("max-h-[calc(100svh-2rem)]");
    expect(content.className).toContain("overflow-y-auto");
  });

  it("pins the title row and the close/report controls", () => {
    render(<TallDialog />);
    const header = document.querySelector("[data-dialog-header='true']") as HTMLElement;
    const controls = document.querySelector("[data-dialog-controls='true']") as HTMLElement;
    expect(header.className).toContain("sticky");
    expect(header.className).toContain("shrink-0");
    expect(controls.className).toContain("sticky");
    expect(screen.getByText("Create shipment")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /close/i })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Report a problem or send feedback/i }),
    ).toBeInTheDocument();
  });

  it("pins the commit controls at the bottom", () => {
    render(<TallDialog />);
    const footer = document.querySelector("[data-dialog-footer='true']") as HTMLElement;
    expect(footer.className).toContain("sticky");
    expect(footer.className).toContain("shrink-0");
    for (const label of ["Cancel", "Save & New", "Save & Receive"]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
  });
});
