import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

// Explicit local fixture entry point. Never uses credentials or the app auth provider.
export default defineConfig({
  root: __dirname,
  plugins: [react()],
  define: { __APP_VERSION__: JSON.stringify("local-fixture") },
  resolve: { alias: [
    { find: "@/integrations/supabase/client", replacement: path.resolve(__dirname, "mock-client.ts") },
    { find: "@/hooks/use-auth", replacement: path.resolve(__dirname, "mock-auth.ts") },
    { find: "@/lib/wms-core", replacement: path.resolve(__dirname, "mock-core.ts") },
    { find: "@/features/picking/inventory-pick-core", replacement: path.resolve(__dirname, "mock-pick.ts") },
    { find: "@", replacement: path.resolve(__dirname, "../../..") },
  ] },
  server: { host: "127.0.0.1", port: 8089, strictPort: true, fs: { allow: [path.resolve(__dirname, "../../../..")] } },
});
