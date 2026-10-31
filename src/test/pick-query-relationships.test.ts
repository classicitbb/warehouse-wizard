import { describe, expect, it, vi } from "vitest";

const select = vi.hoisted(() => vi.fn());

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({ select }),
  },
}));

import { listPickLists } from "@/lib/wms-core";

describe("pick-list relationship embeds", () => {
  it("selects the directed pallet relationship explicitly when pick tasks retain an original pallet", async () => {
    const query: any = {
      is: () => query,
      order: () => query,
      then: (resolve: (value: unknown) => unknown) => resolve({ data: [], error: null }),
    };
    select.mockReturnValue(query);

    await listPickLists();

    expect(select).toHaveBeenCalledWith(expect.stringContaining("pallets!pick_tasks_pallet_id_fkey("));
  });
});
