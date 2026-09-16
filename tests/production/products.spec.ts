import { expect, test } from "@playwright/test";

test("production Product deep links fail closed without private catalog or fixtures", async ({
  page,
}) => {
  const store = "46ab2be4-ff91-4f69-a5c2-8c51fbd833b3";
  const product = "21a0f8af-104e-4a74-af38-eacb40cd1ed9";
  for (const route of [
    `/stores/${store}/products`,
    `/stores/${store}/products/${product}`,
    `/stores/${store}/products/new`,
    `/stores/${store}/products/${product}/edit`,
  ]) {
    const response = await page.goto(route);
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { name: "Sign in to your workspace" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Current store" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Products", exact: true })).toHaveCount(0);
    const html = await response!.text();
    expect(html).not.toMatch(
      /QAFILAH_F1_DEVELOPMENT_FIXTURE_ONLY|Atlas 01 Linen|Foreign Product Secret F3/,
    );
    expect(response!.headers()["cache-control"]).toContain("no-store");
    expect(response!.headers()["x-robots-tag"]).toContain("noindex");
    const storage = await page.evaluate(() => ({
      local: Object.keys(localStorage),
      session: Object.keys(sessionStorage),
    }));
    expect(storage).toEqual({ local: [], session: [] });
  }
});
