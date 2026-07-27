import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    // Cada archivo toca su propia SQLite; sin paralelismo entre archivos.
    fileParallelism: false,
  },
});
