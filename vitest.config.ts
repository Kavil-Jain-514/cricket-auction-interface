import { defineConfig } from "vitest/config";

// Convex functions run in an edge-like runtime, so convex-test needs the
// edge-runtime environment. `server.deps.inline` is required so convex-test is
// transformed by Vite rather than loaded from node_modules as-is.
export default defineConfig({
  test: {
    environment: "edge-runtime",
    server: { deps: { inline: ["convex-test"] } },
    include: ["convex/**/*.test.ts", "lib/**/*.test.ts"],
  },
});
