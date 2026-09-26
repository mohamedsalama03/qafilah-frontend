import { defineConfig, devices } from "@playwright/test";

if (
  !process.env.F3G_API_ORIGIN ||
  !process.env.F3G_FIXTURES ||
  !process.env.F3G_BACKEND_AUTHORITY
) {
  throw new Error("Supply the isolated API origin, private fixtures, and exact backend authority.");
}

export default defineConfig({
  testDir: "./tests/compatibility",
  testMatch: "store-currency.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  reporter: "list",
  use: {
    ...devices["Desktop Chrome"],
    baseURL: "http://localhost:3002",
    trace: "off",
    video: "off",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "pnpm exec next dev --hostname localhost --port 3002",
    url: "http://localhost:3002/login",
    reuseExistingServer: false,
    timeout: 120_000,
    env: { NEXT_TELEMETRY_DISABLED: "1", NEXT_PUBLIC_API_ORIGIN: process.env.F3G_API_ORIGIN },
  },
});
