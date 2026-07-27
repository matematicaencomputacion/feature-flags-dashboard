import { defineConfig, devices } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const e2eRoot = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(e2eRoot, "..");
const dbFile = resolve(e2eRoot, ".tmp/feature-flags.db");

mkdirSync(dirname(dbFile), { recursive: true });

/** DB temporal de la suite — no toca `data/feature-flags.db` de desarrollo. */
const DATABASE_URL = `file:${dbFile}`;

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI
    ? [["github"], ["html", { open: "never" }]]
    : [["list"], ["html", { open: "never" }]],
  use: {
    // localhost (no 127.0.0.1): coincide con CORS/default de Next y evita
    // bloqueos de allowedDevOrigins en el HMR del dev server.
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
    ...devices["Desktop Chrome"],
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: [
    {
      name: "api",
      command:
        "pnpm db:migrate && pnpm db:seed && pnpm --filter @ff/api exec tsx src/index.ts",
      cwd: repoRoot,
      url: "http://localhost:8787/health",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        ...process.env,
        DATABASE_URL,
        PORT: "8787",
      },
    },
    {
      name: "web",
      command: "pnpm --filter @ff/web run dev",
      cwd: repoRoot,
      url: "http://localhost:3000",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        ...process.env,
        NEXT_PUBLIC_API_URL: "http://localhost:8787",
      },
    },
  ],
});
