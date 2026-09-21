import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

type Product = { id: string; name: string };
type Store = {
  id: string;
  name: string;
  products: Record<"simple" | "archived" | "variant", Product>;
};
type Fixture = { email: string; password: string; stores: Store[] };
type Traffic = {
  method: string;
  path: string;
  body?: unknown;
  status?: number;
  csrf: boolean;
  bearer: boolean;
  at: number;
  responseAt?: number;
};
const fixtures = JSON.parse(
  readFileSync(path.resolve("artifacts/f3c-l1l2/runtime/inventory-fixtures.json"), "utf8"),
) as Record<string, Fixture>;
const origin = "http://localhost:3842";
const traffic = new WeakMap<Page, Traffic[]>();
const errors = new WeakMap<Page, string[]>();
const details = new WeakMap<Page, unknown>();
const inventoryPanel = (page: Page) => page.getByRole("region", { name: "Inventory", exact: true });
const quantity = (page: Page) =>
  inventoryPanel(page).getByRole("textbox", { name: "Quantity", exact: true });
const submit = (page: Page) =>
  inventoryPanel(page).getByRole("button", { name: "Set quantity", exact: true });
const writes = (page: Page) => traffic.get(page)!.filter((entry) => entry.method === "PATCH");
const api = (store: Store, product = store.products.simple.id, inventory = true) =>
  `/api/v1/stores/${store.id}/catalog/products/${product}${inventory ? "/inventory" : ""}`;
const route = (store: Store, product = store.products.simple.id) =>
  `/stores/${store.id}/products/${product}`;

test.beforeEach(async ({ page }) => {
  traffic.set(page, []);
  errors.set(page, []);
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  page.on("pageerror", (error) => errors.get(page)!.push(error.message));
  page.on("request", (request) => {
    if (!request.url().startsWith(origin)) return;
    traffic.get(page)!.push({
      method: request.method(),
      path: new URL(request.url()).pathname,
      ...(request.url().includes("/catalog/") && request.postData()
        ? { body: request.postDataJSON() }
        : {}),
      csrf: !!request.headers()["x-xsrf-token"],
      bearer: !!request.headers().authorization,
      at: performance.now(),
    });
  });
  page.on("response", (response) => {
    if (!response.url().startsWith(origin)) return;
    const entry = traffic
      .get(page)!
      .findLast(
        (item) =>
          item.path === new URL(response.url()).pathname &&
          item.method === response.request().method() &&
          item.status === undefined,
      );
    if (entry) {
      entry.status = response.status();
      entry.responseAt = performance.now();
    }
  });
});

test.afterEach(async ({ page }, info) => {
  await mkdir(path.resolve("artifacts/f3c-l1l2/browser"), { recursive: true });
  await writeFile(
    path.resolve(
      `artifacts/f3c-l1l2/browser/${info.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.json`,
    ),
    JSON.stringify(
      { requests: traffic.get(page), details: details.get(page), runtimeErrors: errors.get(page) },
      null,
      2,
    ),
  );
  expect(errors.get(page)).toEqual([]);
  expect(traffic.get(page)!.some((entry) => entry.bearer)).toBe(false);
  expect(
    traffic.get(page)!.some((entry) => /\/(pricing|media|variants|options)\b/.test(entry.path)),
  ).toBe(false);
  for (const entry of writes(page)) {
    expect(entry.csrf).toBe(true);
    expect(entry.path).toMatch(/\/products\/[^/]+\/inventory$/);
  }
});

async function login(page: Page, group: string, target = route(fixtures[group].stores[0])) {
  await page.goto(`/login?returnTo=${encodeURIComponent(target)}`);
  await page
    .getByRole("textbox", { name: "Email address", exact: true })
    .fill(fixtures[group].email);
  await page.getByLabel(/^Password/).fill(fixtures[group].password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(target.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$"));
}
async function prepare(page: Page, group: string) {
  const store = fixtures[group].stores[0];
  await login(page, group);
  await expect(quantity(page)).toBeVisible();
  return store;
}
function response(page: Page, endpoint: string, method: string) {
  return page.waitForResponse(
    (item) => item.url() === origin + endpoint && item.request().method() === method,
  );
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
        .find((cookie) => cookie.startsWith("XSRF-TOKEN="))
        ?.slice(11);
      const result = await fetch(url, {
        method,
        credentials: "include",
        headers: {
          Accept: "application/json",
          ...(method === "PATCH"
            ? {
                "Content-Type": "application/json",
                "X-XSRF-TOKEN": decodeURIComponent(token ?? ""),
              }
            : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      return { status: result.status, body: await result.json() };
    },
    { url: origin + endpoint, method, body },
  );
}
async function setQuantity(page: Page, store: Store, value: number) {
  await quantity(page).fill(String(value));
  const received = response(page, api(store), "PATCH");
  await submit(page).click();
  const result = await received;
  expect(result.status()).toBe(200);
  expect(result.request().postDataJSON()).toEqual({ quantity: value });
  expect((await result.json()).data).toEqual({
    quantity: value,
    availability: value === 0 ? "out_of_stock" : "in_stock",
  });
  await expect(inventoryPanel(page)).toContainText(
    /quantity.*(?:set|updated|saved)|inventory.*(?:updated|saved)/i,
  );
  return result;
}
async function fresh(page: Page, store: Store, unknown = false) {
  const inventory = response(page, api(store), "GET");
  const product = response(page, api(store, store.products.simple.id, false), "GET");
  await inventoryPanel(page)
    .getByRole("button", {
      name: unknown ? "Review current inventory" : "Change quantity",
      exact: true,
    })
    .click();
  expect((await inventory).status()).toBe(200);
  expect((await product).status()).toBe(200);
  await expect(quantity(page)).toBeEnabled();
}
async function capture(page: Page, surface: string, widths = [1440, 390]) {
  await mkdir(path.resolve("artifacts/f3c-l1l2/screenshots"), { recursive: true });
  const scans = [];
  for (const width of widths) {
    await page.setViewportSize({ width, height: 1100 });
    const scan = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(scan.violations).toEqual([]);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      ),
    ).toBe(false);
    await page.screenshot({
      path: path.resolve(`artifacts/f3c-l1l2/screenshots/${surface}-${width}.png`),
      fullPage: true,
      caret: "initial",
    });
    scans.push({ width, violations: scan.violations });
  }
  await writeFile(
    path.resolve(`artifacts/f3c-l1l2/screenshots/${surface}-axe.json`),
    JSON.stringify(scans, null, 2),
  );
  await page.setViewportSize({ width: 1440, height: 1100 });
}

const refreshWarning =
  "The quantity was saved, but the latest product details could not be confirmed yet.";

async function settledFocus(page: Page) {
  // Cross two actual paint opportunities after the visible result; this allows
  // child and parent passive effects to run without an arbitrary sleep.
  return page.evaluate(async () => {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    return {
      tag: document.activeElement?.tagName,
      id: document.activeElement?.id,
      text: document.activeElement?.textContent,
    };
  });
}

async function assertQuantityErrorFocus(page: Page) {
  await expect(quantity(page)).toHaveAttribute("aria-invalid", "true");
  await expect(inventoryPanel(page)).toContainText(
    "The Product inventory update does not change the quantity.",
  );
  const finalFocus = await settledFocus(page);
  expect(finalFocus).toMatchObject({ tag: "INPUT", id: "inventory-quantity" });
  await expect(quantity(page)).toBeFocused();
  const described = await quantity(page).getAttribute("aria-describedby");
  expect(described).toContain("inventory-quantity-error");
  await expect(page.locator("#inventory-quantity-error")).toContainText(
    "does not change the quantity",
  );
  await expect(inventoryPanel(page).getByRole("alert")).toBeVisible();
  details.set(page, { finalFocus, described, automaticReplay: 0 });
}

for (const outcome of ["pending", "success", "failure"] as const) {
  test(`real confirmed inventory PATCH with Product refresh ${outcome} preserves truthful success`, async ({
    page,
  }) => {
    const store = await prepare(page, `feedback_${outcome}`);
    let release!: () => void;
    let entered!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    await page.route(origin + api(store, store.products.simple.id, false), async (request) => {
      const actual = await request.fetch();
      expect(actual.status()).toBe(200);
      entered();
      await held;
      if (outcome === "failure") await request.abort("failed");
      else await request.fulfill({ response: actual });
    });
    await setQuantity(page, store, 8);
    await started;
    await settledFocus(page);
    await expect(inventoryPanel(page).getByRole("status")).toHaveText("Quantity saved.");
    await expect(inventoryPanel(page)).not.toContainText(refreshWarning);
    await expect(inventoryPanel(page)).not.toContainText("couldn’t confirm whether");
    if (outcome === "pending") await capture(page, "confirmed-pending");
    const refreshed =
      outcome !== "failure"
        ? response(page, api(store, store.products.simple.id, false), "GET")
        : undefined;
    release();
    if (refreshed) expect((await refreshed).status()).toBe(200);
    if (outcome === "failure") await expect(inventoryPanel(page)).toContainText(refreshWarning);
    else await expect(inventoryPanel(page)).not.toContainText(refreshWarning);
    await expect(inventoryPanel(page).getByRole("status")).toHaveText("Quantity saved.");
    expect((await direct(page, api(store))).body.data.quantity).toBe(8);
    expect(writes(page)).toHaveLength(1);
    if (outcome !== "pending") await capture(page, `confirmed-${outcome}`);
    details.set(page, { refresh: outcome, confirmedQuantity: 8, automaticReplay: 0 });
  });
}

test("real initial Product loading retains Product loading UX without inventory feedback", async ({
  page,
}) => {
  const store = fixtures.feedback_initial.stores[0];
  let release!: () => void;
  let entered!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  await page.route(origin + api(store, store.products.simple.id, false), async (request) => {
    const actual = await request.fetch();
    entered();
    await held;
    await request.fulfill({ response: actual });
  });
  await login(page, "feedback_initial");
  await started;
  await expect(page.getByText("Loading product…", { exact: true })).toBeVisible();
  await expect(inventoryPanel(page)).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText(refreshWarning);
  release();
  await expect(quantity(page)).toBeEnabled();
  expect(writes(page)).toHaveLength(0);
});

test("real fresh quantity 422 and client validation retain keyboard field focus", async ({
  page,
}) => {
  const store = await prepare(page, "feedback_fresh");
  await quantity(page).fill("-1");
  await quantity(page).press("Enter");
  await expect(quantity(page)).toHaveAttribute("aria-invalid", "true");
  expect(await settledFocus(page)).toMatchObject({ tag: "INPUT", id: "inventory-quantity" });
  expect(writes(page)).toHaveLength(0);
  await quantity(page).fill("3");
  const rejected = response(page, api(store), "PATCH");
  await quantity(page).press("Tab");
  await expect(submit(page)).toBeFocused();
  await page.keyboard.press("Enter");
  expect((await rejected).status()).toBe(422);
  await assertQuantityErrorFocus(page);
  expect(writes(page)).toHaveLength(1);
  await capture(page, "fresh-quantity-422");
});

test("real post-reconciliation quantity 422 leaves final focus on quantity after all effects", async ({
  page,
}) => {
  const store = await prepare(page, "feedback_review");
  await page.route(origin + api(store), async (request) => {
    if (request.request().method() !== "PATCH") return request.continue();
    expect((await request.fetch()).status()).toBe(200);
    await request.abort("failed");
  });
  await quantity(page).fill("5");
  await submit(page).click();
  await expect(inventoryPanel(page)).toContainText(
    "We couldn’t confirm whether the quantity was saved.",
  );
  await page.unroute(origin + api(store));
  await fresh(page, store, true);
  await expect(quantity(page)).toHaveValue("5");
  await expect(inventoryPanel(page)).toContainText(
    "This does not confirm whether the earlier change was saved.",
  );
  expect(writes(page)).toHaveLength(1);
  const rejected = response(page, api(store), "PATCH");
  await quantity(page).focus();
  await quantity(page).press("Enter");
  expect((await rejected).status()).toBe(422);
  await assertQuantityErrorFocus(page);
  expect(writes(page)).toHaveLength(2);
  expect(writes(page).map((entry) => entry.body)).toEqual([{ quantity: 5 }, { quantity: 5 }]);
  expect((await direct(page, api(store))).body.data.quantity).toBe(5);
  await capture(page, "post-review-quantity-422");
  await expect(quantity(page)).toBeFocused();
});

test("real non-field 429 after review keeps useful generic feedback focus without field error", async ({
  page,
}) => {
  const store = await prepare(page, "feedback_generic");
  await setQuantity(page, store, 2);
  await fresh(page, store);
  let limited = false;
  for (let count = 0; count < 65; count++) {
    if ((await direct(page, api(store))).status === 429) {
      limited = true;
      break;
    }
  }
  expect(limited).toBe(true);
  await quantity(page).fill("7");
  const rejected = response(page, api(store), "PATCH");
  await submit(page).click();
  expect((await rejected).status()).toBe(429);
  await expect(inventoryPanel(page).getByRole("alert")).toContainText("Too many requests");
  await expect(quantity(page)).not.toHaveAttribute("aria-invalid", "true");
  const finalFocus = await settledFocus(page);
  expect(finalFocus.tag).toBe("DIV");
  expect(finalFocus.text).toContain("Too many requests");
  expect(writes(page)).toHaveLength(2);
  details.set(page, { finalFocus, automaticReplay: 0 });
  await capture(page, "generic-nonfield-429");
});
