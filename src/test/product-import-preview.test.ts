import { describe, expect, it, vi } from "vitest";

const supabaseMock = vi.hoisted(() => ({
  from: vi.fn((table: string) => ({
    select: vi.fn(async () => {
      if (table === "clients") return { data: [], error: null };
      if (table === "products") return { data: [], error: null };
      return { data: [], error: null };
    }),
  })),
  storage: {
    from: vi.fn(() => ({
      upload: vi.fn(async () => ({ data: null, error: null })),
    })),
  },
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: supabaseMock,
  isSupabaseConfigured: true,
}));

import { parseCsvForResource } from "@/features/reports/reports-core";
import { RESOURCE_DEFINITIONS } from "@/features/shared/core-types";

describe("product import preview", () => {
  it("allows client owner to be confirmed after import", async () => {
    const csv = [
      "sku,barcode,name,description,client_owner_id",
      "CUP-12,CUP-12,Greenware 12oz clear cold cup,Greenware 12oz clear cold cup,",
    ].join("\n");
    const file = new File([csv], "products.csv", { type: "text/csv" });

    const preview = await parseCsvForResource(RESOURCE_DEFINITIONS.products, file);

    expect(preview.summary).toEqual({ total: 1, valid: 1, invalid: 0 });
    expect(preview.rows[0].normalized).toMatchObject({
      sku: "CUP-12",
      barcode: "CUP-12",
      client_owner_id: null,
      temperature_requirement: "ambient",
      rotation_method: "fifo",
    });
    expect(preview.rows[0].warnings).toContain("client_owner_id: left blank — assign after import");
  });

  it("leaves unresolved client owner values blank instead of blocking import", async () => {
    const csv = [
      "sku,barcode,name,client_owner_id",
      "FLOUR-1,FLOUR-1,Bread flour,Foo",
    ].join("\n");
    const file = new File([csv], "products.csv", { type: "text/csv" });

    const preview = await parseCsvForResource(RESOURCE_DEFINITIONS.products, file);

    expect(preview.summary.valid).toBe(1);
    expect(preview.rows[0].normalized?.client_owner_id).toBeNull();
    expect(preview.rows[0].warnings).toContain('client_owner_id: "Foo" not found — left blank, assign after import');
  });
});
