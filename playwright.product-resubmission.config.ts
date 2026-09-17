import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/integration",
  testMatch: "product-resubmission.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  reporter: [
    ["list"],
    ["json", { outputFile: "artifacts/f3b-remediation/resubmission-results.json" }],
  ],
  use: {
    baseURL: "http://localhost:3000",
    trace: "off",
    video: "off",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "chromium-product-resubmission-laravel", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: {
    command: "pnpm exec next dev --hostname localhost --port 3000",
    url: "http://localhost:3000/login",
    reuseExistingServer: false,
    timeout: 120_000,
    env: { NEXT_TELEMETRY_DISABLED: "1", NEXT_PUBLIC_API_ORIGIN: "http://localhost:3842" },
  },
});
