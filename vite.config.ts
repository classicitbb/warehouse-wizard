import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { VitePWA } from "vite-plugin-pwa";
import { componentTagger } from "lovable-tagger";
import pkg from "./package.json" with { type: "json" };
import { mcpPlugin } from "@lovable.dev/mcp-js/stacks/supabase/vite";

// Copilot-only rendering libraries: Shiki grammars/themes, Mermaid and its graph
// layout stack, and the screenshot capturer. They were ~14 MB of the ~17 MB
// precache, so every install and every deploy re-downloaded them onto handsets
// that never open the Copilot. Copilot needs the network anyway, so its lazy
// chunks are left out of the precache and fetched on demand like any asset.
const COPILOT_ONLY_PACKAGE =
  /^(shiki|@shikijs\/[^/]+|mermaid|@mermaid-js\/[^/]+|cytoscape[^/]*|layout-base|cose-base|dagre[^/]*|@upsetjs\/[^/]+|katex|html2canvas-pro)$/;
const copilotOnlyChunks = new Set<string>();

function packageOf(id: string) {
  const p = id.split(path.sep).join("/").split("?")[0];
  const i = p.lastIndexOf("node_modules/");
  if (i < 0) return null;
  const parts = p.slice(i + "node_modules/".length).split("/");
  return parts.slice(0, parts[0].startsWith("@") ? 2 : 1).join("/");
}

/** Records lazy chunks whose code is mostly a Copilot-only package; the precache manifest drops them. */
const copilotChunkCollector = {
  name: "ww-copilot-chunk-collector",
  generateBundle(_options, bundle) {
    copilotOnlyChunks.clear();
    for (const chunk of Object.values(bundle)) {
      if (chunk.type !== "chunk" || chunk.isEntry) continue;
      const bytesByPackage = new Map<string | null, number>();
      for (const [id, mod] of Object.entries(chunk.modules)) {
        const pkg = packageOf(id);
        bytesByPackage.set(pkg, (bytesByPackage.get(pkg) ?? 0) + mod.renderedLength);
      }
      const [dominant] = [...bytesByPackage].sort((a, b) => b[1] - a[1])[0] ?? [null];
      if (dominant && COPILOT_ONLY_PACKAGE.test(dominant)) copilotOnlyChunks.add(chunk.fileName);
    }
  },
} satisfies Plugin;

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
    // Emits /version.json so a running tab can ask "is there a newer build?" on
    // first touch, without waiting on the service worker. See src/lib/version-check.ts.
    {
      name: "ww-version-manifest",
      generateBundle() {
        this.emitFile({ type: "asset", fileName: "version.json", source: JSON.stringify({ version: pkg.version }) });
      },
    } satisfies Plugin,
    copilotChunkCollector,
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
        manifestTransforms: [
          (entries) => ({ manifest: entries.filter((entry) => !copilotOnlyChunks.has(entry.url)), warnings: [] }),
        ],
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
      "@hookform/resolvers/zod": path.resolve(__dirname, "./node_modules/@hookform/resolvers/zod/dist/zod.mjs"),
    },
    dedupe: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime", "@tanstack/react-query", "@tanstack/query-core"],
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          // Match whole package directories. A bare "node_modules/react" prefix
          // also caught react-day-picker, react-grid-layout, react-markdown's
          // stack and react-dom/server, forcing ~400 kB of page-only code into
          // the chunk every scanner downloads before the first screen.
          if (id.includes("node_modules/react-dom/server")) return undefined;
          if (
            /node_modules\/(@supabase\/[^/]+|@tanstack\/(react-query|query-core)|react|react-dom|scheduler|react-router|react-router-dom)\//.test(
              id,
            )
          ) {
            return "vendor";
          }
        },
      },
    },
  },
}));
