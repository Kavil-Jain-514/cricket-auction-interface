import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Convex functions run in an edge-like runtime, so convex-test needs the
// edge-runtime environment. `server.deps.inline` is required so convex-test is
// transformed by Vite rather than loaded from node_modules as-is.
// Component render tests opt into Node per file (`@vitest-environment node`)
// and import through the same `@/` alias as tsconfig.
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL(".", import.meta.url)) },
  },
  test: {
    environment: "edge-runtime",
    server: { deps: { inline: ["convex-test"] } },
    include: [
      "convex/**/*.test.ts",
      "lib/**/*.test.ts",
      "components/**/*.test.tsx",
    ],
  },
});
