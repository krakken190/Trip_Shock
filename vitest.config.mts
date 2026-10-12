import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    include: ["tests/unit/**/*.test.ts", "tests/live/**/*.test.ts"],
    environment: "node",
    env: { TRIPSHOCK_DB: ":memory:", TRIPSHOCK_PROVIDER: "mock" },
  },
});
