import { describe, it, expect } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
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
  it("caps the frame to the window height and keeps a trackless draggable scrollbar", () => {
    render(<TallDialog />);
    const content = document.querySelector("[data-dialog-viewport-fit='true']") as HTMLElement;
    expect(content).toBeTruthy();
    expect(content.className).toContain("max-h-[calc(100svh-2rem)]");
    expect(content.className).toContain("overflow-y-auto");
    expect(content.className).toContain("dialog-scrollbar");
  });

  it("pins the title row and the close/report controls", () => {
    render(<TallDialog />);
    const header = document.querySelector("[data-dialog-header='true']") as HTMLElement;
    const controls = document.querySelector("[data-dialog-controls='true']") as HTMLElement;
    expect(header.className).toContain("sticky");
    expect(header.className).toContain("top-0");
    expect(header.className).toContain("shrink-0");
    expect(header.className).not.toContain("-mt-6");
    expect(header.className).not.toContain("-top-6");
    expect(controls.className).toContain("fixed");
    expect(controls.className).toContain("right-0");
    expect(controls.className).toContain("top-0");
    const close = screen.getByRole("button", { name: /^close$/i });
    expect(close.className).toContain("right-0");
    expect(close.className).toContain("top-0");
    expect(close.className).toContain("rounded-none");
    expect(close.className).toContain("hover:bg-destructive");
    expect(close.className).toContain("active:bg-destructive/80");
    expect(close.className).not.toContain("focus:ring");
    expect(close.className).not.toContain("focus-visible:ring");
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
    expect(footer.className).toContain("bottom-0");
    expect(footer.className).toContain("shrink-0");
    expect(footer.className).not.toContain("-mb-6");
    expect(footer.className).not.toContain("-bottom-6");
    for (const label of ["Cancel", "Save & New", "Save & Receive"]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
  });

  it("keeps controls corner-anchored for every dialog layout used in the app", () => {
    const knownDialogLayouts = [
      "",
      "sm:max-w-xs",
      "sm:max-w-sm",
      "max-w-sm",
      "sm:max-w-md",
      "max-w-md",
      "sm:max-w-lg",
      "max-w-lg",
      "max-h-[86vh] sm:max-w-lg",
      "max-h-[90vh] overflow-y-auto sm:max-w-2xl",
      "max-h-[92vh] overflow-y-auto sm:max-w-lg",
      "max-h-[92vh] overflow-hidden sm:max-w-3xl",
      "max-h-[90vh] overflow-hidden sm:max-w-3xl",
      "p-4 sm:max-w-sm",
      "overflow-hidden p-0 shadow-lg",
      "flex max-h-[90vh] flex-col overflow-hidden p-0 sm:max-w-6xl",
      "flex flex-col w-[95vw] max-w-[95vw] h-[90vh] max-h-[90vh] p-0 gap-0",
      "h-[calc(100dvh-0.75rem)] max-h-[calc(100dvh-0.75rem)] w-[calc(100vw-0.75rem)] max-w-[calc(100vw-0.75rem)] overflow-hidden bg-card p-0",
      "max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden sm:max-w-3xl",
    ];

    for (const layout of knownDialogLayouts) {
      const result = render(
        <Dialog open>
          <DialogContent className={layout} aria-describedby={undefined}>
            <DialogHeader><DialogTitle>Known dialog</DialogTitle></DialogHeader>
            <DialogFooter><Button>Commit</Button></DialogFooter>
          </DialogContent>
        </Dialog>,
      );
      const close = screen.getByRole("button", { name: /^close$/i });
      const controls = result.container.ownerDocument.querySelector("[data-dialog-controls='true']") as HTMLElement;
      expect(controls.className).toContain("fixed");
      expect(close.className).toContain("right-0");
      expect(close.className).toContain("top-0");
      expect(close.className).toContain("hover:bg-destructive");
      expect(close.className).toContain("active:bg-destructive/80");
      cleanup();
    }
  });
});
