import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TreeCtx, TreeRowFlyout, TreeRowFlyoutItem, useTCtx, type TreeCtxValue } from "@/components/warehouse-tree/tree-context";

function ContextProbe({ act = false }: { act?: boolean }) {
  const context = useTCtx();
  if (act) {
    context.toggleNode("warehouse");
    context.selectTreeNode("warehouse");
    context.setDialog({ type: "add-warehouse" });
    context.navigate("/settings");
    context.viewContents({ node: "location" });
  }
  return <output>{context.activeTreeNodeKey ?? "detached"}</output>;
}

function makeContext(): TreeCtxValue {
  return {
    expandedNodes: new Set(), toggleNode: vi.fn(), activeTreeNodeKey: "warehouse",
    selectTreeNode: vi.fn(), setDialog: vi.fn(), warehouses: [], zones: [],
    navigate: vi.fn(), viewContents: vi.fn(),
    fillStats: { byWarehouse: new Map(), byZone: new Map(), byLocation: new Map() },
  };
}

describe("warehouse tree context recovery", () => {
  it("does not throw or run detached actions while the provider is unavailable", () => {
    expect(() => render(<ContextProbe act />)).not.toThrow();
  });

  it("suppresses detached flyout actions and restores live actions on reattachment", async () => {
    const context = makeContext();
    const action = vi.fn();
    const menu = vi.fn((close: () => void) => (
      <TreeRowFlyoutItem onSelect={() => { action(); close(); }}>Edit</TreeRowFlyoutItem>
    ));
    const row = <TreeRowFlyout nodeKey="warehouse" menu={menu}><span>Warehouse row</span></TreeRowFlyout>;
    const view = render(<TreeCtx.Provider value={null}>{row}<ContextProbe /></TreeCtx.Provider>);
    fireEvent.contextMenu(screen.getByText("Warehouse row"));
    expect(menu).not.toHaveBeenCalled();
    expect(action).not.toHaveBeenCalled();

    view.rerender(<TreeCtx.Provider value={context}>{row}<ContextProbe /></TreeCtx.Provider>);
    fireEvent.contextMenu(screen.getByText("Warehouse row"), { clientX: 100, clientY: 100 });
    await screen.findByRole("menuitem", { name: "Edit" });
    expect(context.selectTreeNode).toHaveBeenCalledWith("warehouse");
    fireEvent.click(screen.getByRole("menuitem", { name: "Edit" }));
    expect(action).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole("menuitem", { name: "Edit" })).not.toBeInTheDocument());
  });

  it("cancels pending row-open work when the row unmounts", () => {
    const cancel = vi.spyOn(window, "cancelAnimationFrame");
    const view = render(<TreeCtx.Provider value={makeContext()}>
      <TreeRowFlyout nodeKey="warehouse" menu={() => null}><span>Warehouse row</span></TreeRowFlyout>
    </TreeCtx.Provider>);
    fireEvent.contextMenu(screen.getByText("Warehouse row"));
    view.unmount();
    expect(cancel).toHaveBeenCalledTimes(1);
    cancel.mockRestore();
  });
});