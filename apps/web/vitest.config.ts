import { defineConfig } from "vitest/config";

export default defineConfig({
  esbuild: {
    jsx: "automatic",
  },
  resolve: {
    alias: {
      "server-only": new URL("./test/server-only.ts", import.meta.url).pathname,
      "@": new URL(".", import.meta.url).pathname,
    },
  },
  test: {
    environment: "node",
  },
});
