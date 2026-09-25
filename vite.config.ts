import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { VitePWA } from "vite-plugin-pwa";
import { componentTagger } from "lovable-tagger";
import pkg from "./package.json" with { type: "json" };
import { mcpPlugin } from "@lovable.dev/mcp-js/stacks/supabase/vite";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  cacheDir: "/tmp/vite-cache",
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  server: {
    host: "::",
    port: Number(process.env.PORT) || 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [
    react(),
    // The code generator currently emits non-portable absolute imports on Windows.
    process.platform !== "win32" && mcpPlugin(),
    VitePWA({
      registerType: "prompt",
      // injectManifest rather than the default generateSW: the app needs its
      // own `push` / `notificationclick` handlers for warehouse alerts, and
      // generateSW has no way to express them. The worker source is src/sw.ts;
      // vite-plugin-pwa resolves a .ts source to an sw.js output, so /sw.js
      // stays the registered path that index.html and the TWA expect.
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.ts",
      includeAssets: ["favicon.ico", "robots.txt", "icon.svg", "icon-maskable.svg"],
      injectManifest: {
        // Headroom over workbox's 2MB default. The largest chunk is ~850KB
        // today, but a file above the limit is dropped from the precache with
        // only a build warning — a silent offline regression.
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
      },
      // `workbox.navigateFallbackDenylist` has no injectManifest equivalent —
      // InjectManifestOptions omits every generateSW-only key — so that
      // denylist is reimplemented on the NavigationRoute in src/sw.ts.
      devOptions: {
        // Without this there is no service worker under `vite dev` at all,
        // so push handlers could only ever be exercised from a prod build.
        enabled: true,
        type: "module",
        navigateFallback: "index.html",
        suppressWarnings: true,
      },
      manifest: {
        name: "Warehouse Wizard WMS",
        short_name: "WarehouseWizard",
        description: "Internal warehouse management for receiving, putaway, picking, and transfers.",
        theme_color: "#1a2932",
        background_color: "#0f171e",
        display: "standalone",
        start_url: "/",
        icons: [
          {
            src: "/icon.svg",
            sizes: "512x512",
            type: "image/svg+xml",
            purpose: "any",
          },
          {
            src: "/icon-maskable.svg",
            sizes: "512x512",
            type: "image/svg+xml",
            purpose: "maskable",
          },
        ],
      },
    }),
    mode === "development" && componentTagger(),
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@hookform/resolvers/zod": path.resolve(__dirname, "./node_modules/@hookform/resolvers/zod/dist/zod.js"),
    },
    dedupe: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime", "@tanstack/react-query", "@tanstack/query-core"],
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (
            id.includes("node_modules/@supabase/supabase-js") ||
            id.includes("node_modules/@tanstack/react-query") ||
            id.includes("node_modules/react") ||
            id.includes("node_modules/react-dom") ||
            id.includes("node_modules/react-router-dom")
          ) {
            return "vendor";
          }
        },
      },
    },
  },
}));
