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

  it("pins the title bar, with the help and close controls in the title row", () => {
    render(<TallDialog />);
    const header = document.querySelector("[data-dialog-header='true']") as HTMLElement;
    expect(header.className).toContain("sticky");
    expect(header.className).toContain("top-0");
    expect(header.className).toContain("shrink-0");
    expect(header.className).not.toContain("-mt-6");
    expect(header.className).not.toContain("-top-6");
    // One fixed layout: title block left, controls pill right, in the header row.
    const controls = header.querySelector("[data-overlay-controls='true']") as HTMLElement;
    expect(controls).toBeTruthy();
    expect(header.lastElementChild?.contains(controls)).toBe(true);
    expect(document.querySelector("[data-overlay-controls-floating='true']")).toBeNull();
    const close = screen.getByRole("button", { name: /^close$/i });
    expect(controls.contains(close)).toBe(true);
    expect(close.className).toContain("bg-destructive");
    expect(close.className).toContain("active:bg-destructive/80");
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

  it("floats the controls in the corner when a dialog has no visible header", () => {
    render(
      <Dialog open>
        <DialogContent aria-describedby={undefined}>
          <DialogHeader className="sr-only"><DialogTitle>Hidden title</DialogTitle></DialogHeader>
          <p>Body</p>
        </DialogContent>
      </Dialog>,
    );
    const floating = document.querySelector("[data-overlay-controls-floating='true']") as HTMLElement;
    expect(floating).toBeTruthy();
    expect(floating.className).toContain("fixed");
    expect(floating.className).toContain("right-3");
    expect(floating.contains(screen.getByRole("button", { name: /^close$/i }))).toBe(true);
  });

  it("puts the controls in the title row for every dialog layout used in the app", () => {
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
      const header = result.container.ownerDocument.querySelector("[data-dialog-header='true']") as HTMLElement;
      expect(header.contains(close)).toBe(true);
      expect(close.className).toContain("bg-destructive");
      expect(close.className).toContain("active:bg-destructive/80");
      cleanup();
    }
  });
});
