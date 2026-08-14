import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "dsh-plugin-koishi/protocol": fileURLToPath(
        new URL(
          "./packages/dsh-plugin-koishi/src/protocol.ts",
          import.meta.url,
        ),
      ),
      "dsh-plugin-koishi": fileURLToPath(
        new URL("./packages/dsh-plugin-koishi/src/index.ts", import.meta.url),
      ),
      "koishi-plugin-dsh-bridge": fileURLToPath(
        new URL(
          "./packages/koishi-plugin-dsh-bridge/src/index.ts",
          import.meta.url,
        ),
      ),
    },
  },
  test: {
    include: ["packages/**/*.test.ts", "tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      include: ["packages/*/src/**/*.ts"],
      exclude: ["packages/*/src/index.ts"],
      thresholds: {
        statements: 85,
        branches: 80,
        functions: 85,
        lines: 85,
      },
    },
  },
});
