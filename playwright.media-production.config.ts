import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/integration",
  testMatch: "media-production.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 180_000,
  reporter: [["list"], ["json", { outputFile: "artifacts/f3f/media-production-results.json" }]],
  use: {
    baseURL: "https://localhost:3002",
    ignoreHTTPSErrors: true,
    actionTimeout: 15_000,
    trace: "off",
    video: "off",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium-production-media", use: { ...devices["Desktop Chrome"] } }],
});
