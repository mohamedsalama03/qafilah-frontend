import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/integration",
  testMatch: "variants.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  reporter: [["list"], ["json", { outputFile: "artifacts/f3d/variants-results.json" }]],
  use: {
    baseURL: "http://localhost:3002",
    trace: "off",
    video: "off",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium-laravel-variants", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "pnpm exec next dev --hostname localhost --port 3002",
    url: "http://localhost:3002/login",
    reuseExistingServer: false,
    timeout: 120_000,
    env: { NEXT_TELEMETRY_DISABLED: "1", NEXT_PUBLIC_API_ORIGIN: "http://localhost:3842" },
  },
});
