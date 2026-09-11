import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

// The `server-only` and `client-only` packages throw on import to fail a bundle
// that crosses the wrong boundary. Next.js still enforces that at build time;
// the test runner only needs them to resolve, so server modules (services, SQL
// helpers, the AI gateway, pipelines) can be unit tested directly.
const emptyModule = fileURLToPath(new URL("./tests/stubs/empty-module.ts", import.meta.url));

export default defineConfig({
  plugins: [tsconfigPaths(), react()],
  resolve: {
    alias: {
      "server-only": emptyModule,
      "client-only": emptyModule,
    },
  },
  test: {
    environment: "jsdom",
    globals: false,
    setupFiles: ["./tests/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}", "tests/unit/**/*.test.{ts,tsx}"],
    exclude: ["tests/e2e/**", "node_modules/**"],
    css: false,
  },
});
