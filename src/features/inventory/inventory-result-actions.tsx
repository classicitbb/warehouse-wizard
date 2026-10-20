import type { ReactElement } from "react";
import { MoreHorizontal } from "lucide-react";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from "@/components/ui/context-menu";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";

type Actions = { onView: () => void; onAdd: () => void; onSelect: () => void; canView: boolean; canAdd: boolean };
export function InventoryResultContext({ children, onOpen, ...actions }: Actions & { children: ReactElement; onOpen: () => void }) {
  return <ContextMenu onOpenChange={(open) => { if (open) onOpen(); }}>
    <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
    <ContextMenuContent>
      <ContextMenuItem disabled={!actions.canView} onSelect={actions.onView}>View item</ContextMenuItem>
      <ContextMenuItem disabled={!actions.canAdd} onSelect={actions.onAdd}>Add to pick list</ContextMenuItem>
      <ContextMenuItem disabled={!actions.canAdd} onSelect={actions.onSelect}>Select</ContextMenuItem>
    </ContextMenuContent>
  </ContextMenu>;
}

export function InventoryResultActions({ palletCode, ...actions }: Actions & { palletCode: string }) {
  return <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <Button type="button" variant="ghost" size="icon" className="h-6 w-6" aria-label={`Actions for ${palletCode}`} title="Actions">
        <MoreHorizontal aria-hidden="true" />
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent>
      <DropdownMenuItem disabled={!actions.canView} onSelect={actions.onView}>View item</DropdownMenuItem>
      <DropdownMenuItem disabled={!actions.canAdd} onSelect={actions.onAdd}>Add to pick list</DropdownMenuItem>
      <DropdownMenuItem disabled={!actions.canAdd} onSelect={actions.onSelect}>Select</DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>;
}
