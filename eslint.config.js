import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "dist",
      // Bundled output written by @lovable.dev/mcp-js via the Vite plugin on
      // every build. It carries a "do not edit" banner and is regenerated from
      // src/lib/mcp/**, so lint it there — not here. Linting the bundle was the
      // sole source of the repository's ESLint errors (no-var, no-empty).
      "supabase/functions/mcp/index.ts",
    ],
  },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      // Keep legacy boundary data visible without blocking the repository gate;
      // replace these incrementally with domain types as each module is touched.
      "@typescript-eslint/no-explicit-any": "warn",
      // Warn (not error) so the gate stays actionable without blocking builds;
      // `_`-prefixed names are the agreed opt-out for intentionally unused bindings.
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
    },
  },
);
