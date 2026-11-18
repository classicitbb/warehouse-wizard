import { auth, defineMcp } from "@lovable.dev/mcp-js";
import listWarehousesTool from "./tools/list-warehouses";
import searchProductsTool from "./tools/search-products";
import inventorySummaryTool from "./tools/inventory-summary";
import stockReportTool from "./tools/stock-report";

const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID ?? "project-ref-unset";

export default defineMcp({
  name: "warehouse-wizard-mcp",
  title: "Warehouse Wizard MCP",
  version: "0.1.0",
  instructions:
    "Read-only tools for the Warehouse Wizard WMS. Use `list_warehouses` to see warehouses, `search_products` to find a product by SKU/barcode/name, and `inventory_summary` to see on-hand quantities per warehouse/location for one product. For many SKUs at once (a whole warehouse, location or aisle, a status such as missing/damaged/hold, expiring stock, or a list of up to 500 SKUs) use `stock_report`: one call with paging, or group_by 'sku'/'sku_warehouse' for totals. All calls act as the signed-in user under the app's RLS policies.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [listWarehousesTool, searchProductsTool, inventorySummaryTool, stockReportTool],
});