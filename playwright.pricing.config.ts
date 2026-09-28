import { defineConfig } from "@playwright/test";
import integration from "./playwright.integration.config";

export default defineConfig({
  ...integration,
  testMatch: "pricing.spec.ts",
  reporter: [
    ["list"],
    ["json", { outputFile: process.env.F3G_REPORT ?? "artifacts/f3g/laravel-results.json" }],
  ],
  use: {
    ...integration.use,
    baseURL: process.env.F3G_FRONTEND_URL ?? "http://localhost:3000",
    // Only the disposable local TLS edge uses a self-signed certificate.
    ignoreHTTPSErrors: process.env.F3G_FRONTEND_URL === "https://localhost:3002",
  },
  webServer: process.env.F3G_FRONTEND_URL ? undefined : integration.webServer,
});
