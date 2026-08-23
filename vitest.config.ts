import { defineConfig } from "vitest/config";

// Mirrors the upstream config: the `server-only` marker is a build-time RSC boundary
// with no meaning under Node, so it's stubbed out to let the renderer's pure logic be
// unit-tested directly.
export default defineConfig({
  test: {
    include: ["tests/unit/**/*.test.ts"],
    environment: "node",
  },
  resolve: {
    alias: {
      "server-only": new URL("./tests/unit/_server-only-stub.ts", import.meta.url).pathname,
    },
  },
});
