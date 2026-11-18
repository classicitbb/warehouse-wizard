import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "./_supabase";

// Bulk, read-only stock query. Replaces "search_products + one inventory_summary
// per SKU" with a single filtered call. RLS still applies (runs as the user).

const STATUSES = [
  "receiving", "available", "reserved", "picked", "staged", "in_transit",
  "hold", "quarantine", "damaged", "missing", "shipped",
] as const;

const PAGE = 1000; // PostgREST max rows per request
const MAX_SCAN = 50000; // safety cap when aggregating

const num = (v: unknown) => Number(v) || 0;

export default defineTool({
  name: "stock_report",
  title: "Bulk stock report",
  description:
    "Stock across many SKUs in one call. Filter by warehouse, location/aisle, status, expiry window or a list of SKUs. " +
    "group_by='none' returns balance rows with paging (offset/limit, has_more); 'sku' or 'sku_warehouse' returns totals " +
    "(quantity, available, reserved, held, damaged) aggregated over every matching row. Excludes shipped stock unless statuses includes 'shipped'.",
  inputSchema: {
    warehouse: z.string().trim().min(1).optional().describe("Warehouse code, e.g. 'WH1'."),
    location_prefix: z.string().trim().min(1).optional().describe("Location code prefix, e.g. 'A-01'."),
    aisle: z.string().trim().min(1).optional().describe("Exact aisle, e.g. 'A'."),
    statuses: z.array(z.enum(STATUSES)).min(1).optional().describe("Only these inventory statuses."),
    skus: z.array(z.string().trim().min(1)).min(1).max(500).optional().describe("Exact SKUs (up to 500)."),
    expiring_within_days: z.number().int().min(0).max(3650).optional().describe("Only stock expiring within N days (includes already expired)."),
    only_with_issues: z.boolean().optional().describe("Only rows with held or damaged quantity > 0, or status hold/quarantine/damaged/missing."),
    group_by: z.enum(["none", "sku", "sku_warehouse"]).optional().describe("Default 'none'."),
    offset: z.number().int().min(0).optional().describe("Row/group offset for paging (default 0)."),
    limit: z.number().int().min(1).max(1000).optional().describe("Rows/groups per page (default 200, max 1000)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (input, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    const sb = supabaseForUser(ctx);
    const groupBy = input.group_by ?? "none";
    const offset = input.offset ?? 0;
    const limit = input.limit ?? 200;

    // Inner-join only the relations we filter on, so unfiltered rows without a
    // location still appear.
    const locJoin = input.location_prefix || input.aisle ? "locations!inner" : "locations";
    const whJoin = input.warehouse ? "warehouses!inner" : "warehouses";
    const prodJoin = input.skus ? "products!inner" : "products";
    const select =
      `quantity, available_quantity, reserved_quantity, held_quantity, damaged_quantity, status, expiry_date, ` +
      `${prodJoin}(sku, name), ${whJoin}(code), ${locJoin}(code, aisle)`;

    const build = () => {
      let q = sb.from("inventory_balances").select(select, { count: groupBy === "none" ? "exact" : undefined });
      if (input.warehouse) q = q.eq("warehouses.code", input.warehouse);
      if (input.aisle) q = q.eq("locations.aisle", input.aisle);
      if (input.location_prefix) {
        const esc = input.location_prefix.replace(/[\\%_]/g, (c) => `\\${c}`);
        q = q.like("locations.code", `${esc}%`);
      }
      if (input.skus) q = q.in("products.sku", input.skus);
      if (input.statuses) q = q.in("status", input.statuses);
      else q = q.neq("status", "shipped");
      if (input.expiring_within_days !== undefined) {
        const d = new Date(Date.now() + input.expiring_within_days * 86400000).toISOString().slice(0, 10);
        q = q.not("expiry_date", "is", null).lte("expiry_date", d);
      }
      if (input.only_with_issues) {
        q = q.or("held_quantity.gt.0,damaged_quantity.gt.0,status.in.(hold,quarantine,damaged,missing)");
      }
      return q.order("id");
    };

    const toRow = (r: any) => ({
      sku: r.products?.sku ?? null,
      name: r.products?.name ?? null,
      warehouse: r.warehouses?.code ?? null,
      location: r.locations?.code ?? null,
      status: r.status,
      quantity: num(r.quantity),
      available: num(r.available_quantity),
      reserved: num(r.reserved_quantity),
      held: num(r.held_quantity),
      damaged: num(r.damaged_quantity),
      expiry_date: r.expiry_date,
    });

    let result: Record<string, unknown>;

    if (groupBy === "none") {
      const { data, error, count } = await build().range(offset, offset + limit - 1);
      if (error) return { content: [{ type: "text", text: error.message }], isError: true };
      const rows = (data ?? []).map(toRow);
      const total = count ?? rows.length;
      result = { total_rows: total, offset, returned: rows.length, has_more: offset + rows.length < total, rows };
    } else {
      const groups = new Map<string, any>();
      let scanned = 0;
      let truncated = false;
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await build().range(from, from + PAGE - 1);
        if (error) return { content: [{ type: "text", text: error.message }], isError: true };
        for (const raw of data ?? []) {
          const r = toRow(raw);
          const key = groupBy === "sku" ? `${r.sku}` : `${r.sku}|${r.warehouse}`;
          const g = groups.get(key) ?? {
            sku: r.sku, name: r.name, ...(groupBy === "sku_warehouse" ? { warehouse: r.warehouse } : {}),
            quantity: 0, available: 0, reserved: 0, held: 0, damaged: 0, balance_rows: 0,
          };
          g.quantity += r.quantity; g.available += r.available; g.reserved += r.reserved;
          g.held += r.held; g.damaged += r.damaged; g.balance_rows += 1;
          groups.set(key, g);
        }
        scanned += data?.length ?? 0;
        if (!data || data.length < PAGE) break;
        if (scanned >= MAX_SCAN) { truncated = true; break; }
      }
      const all = [...groups.values()].sort((a, b) => String(a.sku).localeCompare(String(b.sku)));
      const page = all.slice(offset, offset + limit);
      const totals = all.reduce(
        (t, g) => ({ quantity: t.quantity + g.quantity, available: t.available + g.available, reserved: t.reserved + g.reserved, held: t.held + g.held, damaged: t.damaged + g.damaged }),
        { quantity: 0, available: 0, reserved: 0, held: 0, damaged: 0 },
      );
      const missingSkus = input.skus ? input.skus.filter((s) => !all.some((g) => g.sku === s)) : undefined;
      result = {
        total_groups: all.length, offset, returned: page.length, has_more: offset + page.length < all.length,
        rows_scanned: scanned, truncated, totals, ...(missingSkus ? { skus_without_stock: missingSkus } : {}), groups: page,
      };
    }

    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      structuredContent: result,
    };
  },
});
