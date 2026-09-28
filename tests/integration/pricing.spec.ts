import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";

type Product = { id: string; name: string; variants: Record<string, string> };
type Store = {
  id: string;
  name: string;
  currency: "LYD" | "USD" | "EUR" | null;
  products: Record<string, Product>;
};
const fixtures = JSON.parse(
  readFileSync("artifacts/f3g/runtime/pricing-fixtures.json", "utf8"),
) as Record<string, { email: string; password: string; stores: Store[] }>;
const origin = process.env.F3G_API_ORIGIN ?? "http://localhost:3842";
const grants = [
  "products.view",
  "products.price.update",
  "products.variants.view",
  "products.variants.price.update",
];
const panel = (page: Page) => page.getByRole("region", { name: "Pricing", exact: true });
const amount = (page: Page) => panel(page).getByRole("textbox", { name: /Price \(/ });
const productApi = (s: Store, p = s.products.simple) =>
  `/api/v1/stores/${s.id}/catalog/products/${p.id}`;
const api = (s: Store, variant = false) =>
  productApi(s, variant ? s.products.variant : s.products.simple) +
  (variant ? `/variants/${s.products.variant.variants.first}` : "") +
  "/pricing";
const route = (s: Store, p = s.products.simple, v?: string) =>
  `/stores/${s.id}/products/${p.id}` + (v ? `/variants/${v}` : "");
const requests = new WeakMap<
  Page,
  Array<{ method: string; path: string; body: unknown; csrf: boolean }>
>();
test.beforeEach(async ({ page }) => {
  requests.set(page, []);
  page.on("request", (r) => {
    if (r.url().startsWith(origin) && r.url().endsWith("/pricing"))
      requests.get(page)!.push({
        method: r.method(),
        path: new URL(r.url()).pathname,
        body: r.postDataJSON(),
        csrf: !!r.headers()["x-xsrf-token"],
      });
  });
});
test.afterEach(async ({ page }, info) => {
  mkdirSync("artifacts/f3g/browser", { recursive: true });
  writeFileSync(
    `artifacts/f3g/browser/${info.title.replace(/[^a-z0-9]+/gi, "-")}.json`,
    JSON.stringify(requests.get(page), null, 2),
  );
  for (const r of requests.get(page)!.filter((r) => r.method === "PATCH")) {
    expect(r.csrf).toBe(true);
  }
});
async function login(page: Page, group: string, variant = false) {
  const f = fixtures[group],
    s = f.stores[0];
  const target = variant
    ? route(s, s.products.variant, s.products.variant.variants.first)
    : route(s);
  await page.goto(`/login?returnTo=${encodeURIComponent(target)}`);
  await page.getByRole("textbox", { name: "Email address", exact: true }).fill(f.email);
  await page.getByLabel(/^Password/).fill(f.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(target + "$"));
  return s;
}
async function direct(
  page: Page,
  endpoint: string,
  method = "GET",
  body?: Record<string, unknown>,
) {
  return page.evaluate(
    async ({ url, method, body }) => {
      const token = document.cookie
        .split("; ")
        .find((c) => c.startsWith("XSRF-TOKEN="))
        ?.slice(11);
      const r = await fetch(url, {
        method,
        credentials: "include",
        headers: {
          Accept: "application/json",
          ...(body
            ? {
                "Content-Type": "application/json",
                "X-XSRF-TOKEN": decodeURIComponent(token ?? ""),
              }
            : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      return { status: r.status, body: await r.json() };
    },
    { url: origin + endpoint, method, body },
  );
}
async function save(page: Page, s: Store, text: string, minor: number, variant = false) {
  await amount(page).fill(text);
  const response = page.waitForResponse(
    (r) => r.url() === origin + api(s, variant) && r.request().method() === "PATCH",
  );
  await panel(page)
    .getByRole("button", { name: /^(Set|Change) price$/ })
    .click();
  const r = await response;
  expect(r.status()).toBe(200);
  expect(r.request().postDataJSON()).toEqual({ amount: minor });
  await expect(panel(page)).toContainText("Price saved.");
}
async function review(page: Page) {
  await panel(page).getByRole("button", { name: "Review current price", exact: true }).click();
  await expect(amount(page)).toBeEnabled();
  await expect(amount(page)).toHaveValue("");
}
function permissions(group: string, values: string[]) {
  execFileSync(
    "docker",
    [
      "exec",
      "qafilah-f3g-pricing-candidate-app-1",
      "qafilah-entrypoint",
      "php",
      "/tmp/f3g-pricing-fixtures.php",
      group,
      values.join(","),
    ],
    { stdio: "pipe", windowsHide: true },
  );
}

for (const currency of ["LYD", "USD", "EUR"] as const)
  test(`${currency} non-owner first-price Product and Variant setup/update`, async ({ page }) => {
    const s = await login(page, currency);
    await expect(panel(page)).toContainText("Not configured");
    const text = currency === "LYD" ? "12.345" : "123.45";
    await save(page, s, text, 12345);
    await review(page);
    await save(page, s, currency === "LYD" ? "0.001" : "0.01", 1);
    await page.goto(route(s, s.products.variant, s.products.variant.variants.first));
    await expect(panel(page)).toContainText("Not configured");
    await save(page, s, text, 12345, true);
    await review(page);
    await save(page, s, currency === "LYD" ? "999999999.999" : "9999999999.99", 999999999999, true);
    expect((await direct(page, productApi(s))).body.data.status).toBe("draft");
    expect((await direct(page, productApi(s, s.products.variant))).body.data.price).toEqual({
      amount: 999999999999,
      currency,
    });
    expect((await direct(page, `/api/v1/stores/${s.id}`)).status).toBe(404);
  });
test("null currency blocks setup without a fallback", async ({ page }) => {
  const s = await login(page, "null");
  await expect(panel(page)).toContainText("Store currency is not configured or unavailable");
  await expect(amount(page)).toHaveCount(0);
  expect((await direct(page, api(s), "PATCH", { amount: 1 })).status).toBe(422);
  await page.goto(route(s, s.products.variant, s.products.variant.variants.first));
  await expect(amount(page)).toHaveCount(0);
  expect((await direct(page, api(s, true), "PATCH", { amount: 1 })).status).toBe(422);
});
test("strict text conversion, min/max and same-value validation", async ({ page }) => {
  const s = await login(page, "validation");
  await expect(amount(page)).toBeEnabled();
  for (const text of ["0", "-1", "1e3", "1.0001", "99999999999999999999", "1,23"]) {
    await amount(page).fill(text);
    await panel(page).getByRole("button", { name: "Set price", exact: true }).click();
    await expect(amount(page)).toBeFocused();
  }
  expect(requests.get(page)!.filter((r) => r.method === "PATCH")).toHaveLength(0);
  for (const variant of [false, true])
    for (const amount of [0, -1, 1000000000000, 1.5])
      expect((await direct(page, api(s, variant), "PATCH", { amount })).status).toBe(422);
  expect((await direct(page, api(s), "PATCH", { amount: "1" })).status).toBe(422);
  expect((await direct(page, api(s), "PATCH", { amount: 1, currency: "LYD" })).status).toBe(422);
  await save(page, s, "999999999.999", 999999999999);
  await review(page);
  await save(page, s, "0.001", 1);
  await review(page);
  await amount(page).fill("0.001");
  await panel(page).getByRole("button", { name: "Change price", exact: true }).click();
  await expect(amount(page)).toBeFocused();
  await expect(panel(page)).toContainText(/does not change|Check the highlighted/);
  expect((await direct(page, api(s, true), "PATCH", { amount: 1 })).status).toBe(200);
  expect((await direct(page, api(s, true), "PATCH", { amount: 1 })).status).toBe(422);
});
test("active Variant minimum ignores inactive prices and inventory; no parent editor", async ({
  page,
}) => {
  const s = await login(page, "projection", true),
    p = s.products.variant,
    base = productApi(s, p);
  for (const [id, amount] of [
    [p.variants.first, 2500],
    [p.variants.second, 3000],
    [p.variants.inactive, 1],
  ] as const)
    expect((await direct(page, `${base}/variants/${id}/pricing`, "PATCH", { amount })).status).toBe(
      200,
    );
  expect(
    (await direct(page, `${base}/variants/${p.variants.first}/inventory`, "PATCH", { quantity: 0 }))
      .status,
  ).toBe(200);
  expect((await direct(page, base)).body.data.price.amount).toBe(2500);
  expect(
    (await direct(page, `${base}/variants/${p.variants.first}`, "PATCH", { status: "inactive" }))
      .status,
  ).toBe(200);
  expect((await direct(page, base)).body.data.price.amount).toBe(3000);
  await page.goto(route(s, p));
  await expect(panel(page)).toHaveCount(0);
  expect((await direct(page, `${base}/pricing`, "PATCH", { amount: 1 })).status).toBe(422);
  await page.goto(route(s, p, p.variants.inactive));
  await amount(page).fill("0.002");
  await panel(page).getByRole("button", { name: "Change price", exact: true }).click();
  await expect(panel(page)).toContainText("Price saved.");
  expect((await direct(page, base)).body.data.price.amount).toBe(3000);
});
test("archived and foreign/wrong-parent resources fail safely", async ({ page }) => {
  const s = await login(page, "foreign"),
    foreign = fixtures.foreign.stores[1];
  const wrong = `${productApi(s, s.products.other_variant)}/variants/${s.products.variant.variants.first}/pricing`;
  for (const path of [wrong, `${productApi(s, foreign.products.simple)}/pricing`])
    for (const method of ["GET", "PATCH"])
      expect(
        (await direct(page, path, method, method === "PATCH" ? { amount: 1 } : undefined)).status,
      ).toBe(404);
  const archived = productApi(s, s.products.archived) + "/pricing";
  expect((await direct(page, archived)).status).toBe(200);
  expect((await direct(page, archived, "PATCH", { amount: 1 })).status).toBe(422);
  await page.goto(route(s, s.products.archived));
  await expect(panel(page)).toContainText("Archived product prices cannot be changed");
  await expect(amount(page)).toHaveCount(0);
});
test("independent permissions and write-only frontend boundary", async ({ page }) => {
  const s = await login(page, "permissions");
  let next = 100;
  for (const mask of [
    [],
    [grants[0]],
    [grants[1]],
    [grants[2]],
    [grants[3]],
    [grants[0], grants[1]],
    [grants[0], grants[2]],
    [grants[0], grants[2], grants[3]],
    grants,
  ]) {
    permissions("permissions", mask);
    for (const variant of [false, true]) {
      expect((await direct(page, api(s, variant))).status).toBe(
        mask.includes(variant ? grants[2] : grants[0]) ? 200 : 403,
      );
      expect((await direct(page, api(s, variant), "PATCH", { amount: next++ })).status).toBe(
        mask.includes(variant ? grants[3] : grants[1]) ? 200 : 403,
      );
    }
    await page.goto(route(s));
    if (mask.includes(grants[0])) await expect(panel(page)).toBeVisible();
    else await expect(panel(page)).toHaveCount(0);
    await expect(amount(page)).toHaveCount(
      mask.includes(grants[0]) && mask.includes(grants[1]) ? 1 : 0,
    );
  }
});
for (const variant of [false, true])
  for (const committed of [false, true])
    test(`unknown ${committed ? "committed" : "uncommitted"} ${variant ? "Variant" : "Product"} never replays`, async ({
      page,
    }) => {
      const group = `${committed ? "committed" : "uncommitted"}_${variant ? "variant" : "product"}`;
      const s = await login(page, group, variant);
      let patches = 0;
      await page.route(origin + api(s, variant), async (r) => {
        if (r.request().method() !== "PATCH") return r.continue();
        patches++;
        if (committed) await r.fetch();
        await r.abort("connectionfailed");
      });
      await amount(page).fill("1.234");
      await panel(page).getByRole("button", { name: "Set price", exact: true }).click();
      await expect(panel(page)).toContainText("couldn’t confirm whether the price was saved");
      expect(patches).toBe(1);
      await page.unroute(origin + api(s, variant));
      await review(page);
      await expect(panel(page)).toContainText(
        "does not confirm whether the earlier change was saved",
      );
      expect(patches).toBe(1);
      expect((await direct(page, api(s, variant))).body.data.price).toEqual(
        committed ? { amount: 1234, currency: "LYD" } : null,
      );
      await save(page, s, "2.345", 2345, variant);
    });
test("failed review retains lock and read revocation never invents authority", async ({ page }) => {
  const s = await login(page, "revoked", true),
    endpoint = origin + api(s, true);
  let writes = 0;
  await page.route(endpoint, async (r) => {
    if (r.request().method() === "PATCH") {
      writes++;
      await r.fetch();
      return r.abort("connectionfailed");
    }
    return r.continue();
  });
  await amount(page).fill("1.000");
  await panel(page).getByRole("button", { name: "Set price", exact: true }).click();
  await expect(panel(page)).toContainText("couldn’t confirm");
  await page.unroute(endpoint);
  await page.route(endpoint, (r) =>
    r.request().method() === "GET" ? r.abort("connectionfailed") : r.continue(),
  );
  await panel(page).getByRole("button", { name: "Review current price" }).click();
  await expect(panel(page)).toContainText("couldn’t confirm");
  await expect(amount(page)).toHaveCount(0);
  await page.unroute(endpoint);
  permissions("revoked", [grants[0], grants[3]]);
  await panel(page).getByRole("button", { name: "Review current price" }).click();
  await expect(amount(page)).toHaveCount(0);
  permissions("revoked", grants);
  await page.getByRole("button", { name: "Refresh access", exact: true }).click();
  await expect(panel(page)).toContainText("couldn’t confirm");
  await review(page);
  await expect(panel(page)).toContainText("does not confirm whether the earlier change was saved");
  expect(writes).toBe(1);
});
test("double submit and response-boundary resubmission produce one PATCH", async ({ page }) => {
  const s = await login(page, "double");
  let writes = 0;
  await page.route(origin + api(s), async (r) => {
    if (r.request().method() === "PATCH") writes++;
    return r.continue();
  });
  await amount(page).fill("1.000");
  await panel(page)
    .getByRole("form", { name: "Set price" })
    .evaluate((form) => {
      const f = form as HTMLFormElement;
      f.requestSubmit();
      f.requestSubmit();
      setTimeout(() => f.requestSubmit(), 300);
    });
  await expect(panel(page)).toContainText("Price saved.");
  await expect.poll(() => writes).toBe(1);
  await expect(amount(page)).toHaveCount(0);
});
test("confirmed price remains confirmed after parent projection refresh fails", async ({
  page,
}) => {
  const s = await login(page, "refresh", true);
  await expect(amount(page)).toBeEnabled();
  await page.route(origin + productApi(s, s.products.variant), (r) => r.abort("connectionfailed"));
  await save(page, s, "1.000", 1000, true);
  await expect(panel(page)).toContainText("price was saved");
  await expect(panel(page)).not.toContainText("couldn’t confirm whether");
  await expect(amount(page)).toHaveCount(0);
});
test("responsive keyboard pricing has no axe violations or currency persistence", async ({
  page,
}) => {
  await login(page, "responsive");
  await expect(amount(page)).toBeEnabled();
  mkdirSync("artifacts/f3g/screenshots", { recursive: true });
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1100 });
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      .toBe(true);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.screenshot({
      path: `artifacts/f3g/screenshots/pricing-${width}.png`,
      fullPage: true,
    });
  }
  await amount(page).fill("0");
  await amount(page).press("Enter");
  await expect(amount(page)).toBeFocused();
  expect(requests.get(page)!.filter((r) => r.method === "PATCH")).toHaveLength(0);
  expect(
    await page.evaluate(() => ({
      local: Object.keys(localStorage),
      session: Object.keys(sessionStorage),
    })),
  ).toEqual({ local: [], session: [] });
});

async function navigate(page: Page, s: Store, p: Product, v?: string) {
  await page.getByRole("link", { name: "Products", exact: true }).first().click();
  await page.getByRole("link", { name: p.name, exact: true }).click();
  if (v) {
    await page.getByRole("link", { name: "Manage variants", exact: true }).click();
    await page.locator(`a[href="${route(s, p, v)}"]`).click();
  }
  await expect(panel(page)).toBeVisible();
}
for (const boundary of ["Store", "Product", "Variant", "principal", "authority"] as const)
  for (const method of ["GET", "PATCH"] as const)
    test(`late pricing ${method} cannot publish across ${boundary}`, async ({ page }) => {
      const group = `race_${boundary.toLowerCase()}_${method.toLowerCase()}`;
      permissions(group, grants);
      const s = fixtures[group].stores[0],
        endpoint = api(s, true);
      let release!: () => void, received!: () => void, finished!: () => void;
      const gate = new Promise<void>((r) => (release = r)),
        seen = new Promise<void>((r) => (received = r)),
        done = new Promise<void>((r) => (finished = r));
      const hold = () =>
        page.route(origin + endpoint, async (r) => {
          if (r.request().method() !== method) return r.continue();
          try {
            const result = await r.fetch();
            expect(result.status()).toBe(200);
            received();
            await gate;
            await r.fulfill({ response: result }).catch(() => undefined);
          } finally {
            finished();
          }
        });
      if (method === "GET") await hold();
      await login(page, group, true);
      if (method === "PATCH") {
        await expect(amount(page)).toBeEnabled();
        await hold();
        await amount(page).fill(
          `${10 + ["Store", "Product", "Variant", "principal", "authority"].indexOf(boundary)}.123`,
        );
        await panel(page)
          .getByRole("button", { name: /^(Set|Change) price$/ })
          .click();
      }
      try {
        await seen;
        await page.evaluate(() => Object.assign(window, { __pricingDocument: true }));
        let target = s,
          p = s.products.other_variant,
          v = p.variants.first;
        if (boundary === "Variant") {
          p = s.products.variant;
          v = p.variants.second;
        }
        if (boundary === "Store") {
          target = fixtures[group].stores[1];
          p = target.products.variant;
          v = p.variants.first;
          await page.getByRole("button", { name: "Switch store", exact: true }).click();
          await page.getByRole("button", { name: `Open ${target.name}`, exact: true }).click();
        }
        if (boundary === "principal") {
          target = fixtures.responsive.stores[0];
          p = target.products.variant;
          v = p.variants.first;
          await page.getByRole("button", { name: "Account menu", exact: true }).click();
          await page.getByRole("menuitem", { name: "Sign out", exact: true }).click();
          await expect(page).toHaveURL(/\/login/);
          await page
            .getByRole("textbox", { name: "Email address", exact: true })
            .fill(fixtures.responsive.email);
          await page.getByLabel(/^Password/).fill(fixtures.responsive.password);
          await page.getByRole("button", { name: "Sign in", exact: true }).click();
          await expect(page).toHaveURL(new RegExp(`/stores/${target.id}$`));
        }
        if (boundary === "authority") {
          permissions(group, [grants[0], grants[2]]);
          await page.getByRole("button", { name: "Refresh access", exact: true }).click();
          await expect(amount(page)).toHaveCount(0);
        } else {
          await navigate(page, target, p, v);
          await expect(panel(page)).toContainText("Not configured");
          await expect(amount(page)).toHaveValue("");
        }
        release();
        await done;
        await expect(panel(page)).not.toContainText("Price saved.");
        if (boundary !== "authority") await expect(panel(page)).toContainText("Not configured");
        expect(
          await page.evaluate(
            () => (window as unknown as { __pricingDocument: boolean }).__pricingDocument,
          ),
        ).toBe(true);
        expect(requests.get(page)!.filter((r) => r.method === "PATCH")).toHaveLength(
          method === "PATCH" ? 1 : 0,
        );
      } finally {
        release();
        permissions(group, grants);
      }
    });
