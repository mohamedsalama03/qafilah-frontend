import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

type Product = {
  id: string;
  name: string;
  variants: Record<"first" | "second" | "inactive", string>;
};
type Store = {
  id: string;
  name: string;
  products: Record<"main" | "other" | "archived" | "simple", Product>;
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
  readFileSync(path.resolve("artifacts/f3e/runtime/variant-inventory-fixtures.json"), "utf8"),
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
const productApi = (store: Store, product = store.products.main) =>
  `/api/v1/stores/${store.id}/catalog/products/${product.id}`;
const api = (store: Store, product = store.products.main, variant = product.variants.first) =>
  `${productApi(store, product)}/variants/${variant}/inventory`;
const route = (store: Store, product = store.products.main, variant = product.variants.first) =>
  `/stores/${store.id}/products/${product.id}/variants/${variant}`;
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
  await mkdir(path.resolve("artifacts/f3e/browser"), { recursive: true });
  await writeFile(
    path.resolve(
      `artifacts/f3e/browser/${info.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.json`,
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
    traffic
      .get(page)!
      .some(
        (entry) =>
          /\/(pricing|media)\b/.test(entry.path) &&
          !(
            entry.method === "GET" &&
            /\/products\/[^/]+(?:\/variants\/[^/]+)?\/media$/.test(entry.path)
          ),
      ),
  ).toBe(false);
  for (const entry of writes(page)) {
    expect(entry.csrf).toBe(true);
    expect(entry.path).toMatch(/\/products\/[^/]+\/variants\/[^/]+\/inventory$/);
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
function control(group: string, change: string): Record<string, unknown> {
  return JSON.parse(
    execFileSync(
      "docker",
      [
        "exec",
        "qafilah-f2-runtime-app-1",
        "qafilah-entrypoint",
        "php",
        "/tmp/f3e-fixtures.php",
        group,
        change,
      ],
      { encoding: "utf8", timeout: 30_000, stdio: ["ignore", "pipe", "pipe"] },
    ),
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
  await expect(inventoryPanel(page)).toContainText("Quantity saved.");
  return result;
}
async function fresh(page: Page, store: Store, unknown = false) {
  const inventory = response(page, api(store), "GET");
  const product = response(page, productApi(store), "GET");
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
  await mkdir(path.resolve("artifacts/f3e/screenshots"), { recursive: true });
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
      path: path.resolve(`artifacts/f3e/screenshots/${surface}-${width}.png`),
      fullPage: true,
      caret: "initial",
    });
    scans.push({ width, violations: scan.violations });
  }
  await writeFile(
    path.resolve(`artifacts/f3e/screenshots/${surface}-axe.json`),
    JSON.stringify(scans, null, 2),
  );
  await page.setViewportSize({ width: 1440, height: 1100 });
}

test("real Variant unconfigured zero positive and maximum quantities are absolute replacements", async ({
  page,
}) => {
  const store = await prepare(page, "states");
  await expect(inventoryPanel(page)).toContainText("Not configured");
  expect((await direct(page, api(store))).body.data).toEqual({
    quantity: null,
    availability: "unavailable",
  });
  for (const value of [0, 12, 0, 2_000_000_000]) {
    if (writes(page).length) await fresh(page, store);
    await setQuantity(page, store, value);
    expect((await direct(page, api(store))).body.data.quantity).toBe(value);
    expect(
      (await direct(page, `${productApi(store)}/variants/${store.products.main.variants.first}`))
        .body.data.quantity,
    ).toBe(value);
    expect((await direct(page, productApi(store))).body.data.quantity).toBeNull();
    expect((await direct(page, productApi(store, store.products.simple))).body.data.quantity).toBe(
      19,
    );
  }
  expect(writes(page).map((entry) => entry.body)).toEqual([
    { quantity: 0 },
    { quantity: 12 },
    { quantity: 0 },
    { quantity: 2_000_000_000 },
  ]);
});

test("real Variant validation rejects invalid bounds unknown fields and no-op but accepts coercible integer strings", async ({
  page,
}) => {
  const store = await prepare(page, "validation");
  for (const value of ["", "-1", "1.5", "2000000001", "1e3"]) {
    await quantity(page).fill(value);
    await submit(page).click();
    await expect(quantity(page)).toHaveAttribute("aria-invalid", "true");
    await expect(quantity(page)).toBeFocused();
  }
  expect(writes(page)).toHaveLength(0);
  await capture(page, "validation");
  for (const body of [
    {},
    { quantity: null },
    { quantity: 1.5 },
    { quantity: -1 },
    { quantity: 2_000_000_001 },
    { quantity: 1, tenant_id: store.id },
    { quantity: 1, delta: 1 },
  ]) {
    const result = await direct(page, api(store), "PATCH", body);
    expect(result.status).toBe(422);
    expect(result.body.data).toBeNull();
    expect(JSON.stringify(result.body)).not.toMatch(/SQLSTATE|stack trace|vendor\//i);
  }
  const coercible = await direct(page, api(store), "PATCH", { quantity: "6" });
  expect(coercible.status).toBe(200);
  expect(coercible.body.data).toEqual({ quantity: 6, availability: "in_stock" });
  const unchanged = await direct(page, api(store), "PATCH", { quantity: 6 });
  expect(unchanged.status).toBe(422);
  expect(unchanged.body.errors.quantity).toBeTruthy();
  await quantity(page).fill("6");
  const rejected = response(page, api(store), "PATCH");
  await submit(page).click();
  expect((await rejected).status()).toBe(422);
  await expect(quantity(page)).toHaveAttribute("aria-invalid", "true");
  await expect(quantity(page)).toBeFocused();
  await expect(inventoryPanel(page)).not.toContainText("Quantity saved.");
});

for (const grant of ["none", "read", "write", "both"] as const) {
  test(`real independent Variant inventory ${grant} permissions ignore unrelated grants and role names`, async ({
    page,
  }) => {
    const group = `permissions_${grant}`;
    const store = fixtures[group].stores[0];
    await login(page, group);
    const canRead = grant === "read" || grant === "both";
    const canWrite = grant === "write" || grant === "both";
    expect((await direct(page, api(store))).status).toBe(canRead ? 200 : 403);
    expect((await direct(page, api(store), "PATCH", { quantity: 8 })).status).toBe(
      canWrite ? 200 : 403,
    );
    if (canRead) {
      await expect(inventoryPanel(page)).toBeVisible();
      await expect(quantity(page)).toHaveCount(canWrite ? 1 : 0);
      if (!canWrite) await capture(page, "read-only");
    } else await expect(inventoryPanel(page)).toHaveCount(0);
  });
}

test("real Product context permission remains required even with Variant inventory grants", async ({
  page,
}) => {
  await login(page, "no_product");
  await expect(inventoryPanel(page)).toHaveCount(0);
  await expect(quantity(page)).toHaveCount(0);
  expect(traffic.get(page)!.filter((entry) => /\/inventory$/.test(entry.path))).toHaveLength(0);
});

test("real inactive Variant permits inventory while archived parent remains readable and rejects writes", async ({
  page,
}) => {
  const store = fixtures.inactive.stores[0];
  const product = store.products.main;
  await login(page, "inactive", route(store, product, product.variants.inactive));
  await expect(quantity(page)).toBeEnabled();
  await quantity(page).fill("7");
  const received = response(page, api(store, product, product.variants.inactive), "PATCH");
  await submit(page).click();
  expect((await received).status()).toBe(200);
  expect((await direct(page, api(store, product, product.variants.inactive))).body.data).toEqual({
    quantity: 7,
    availability: "in_stock",
  });
  const archived = store.products.archived;
  expect((await direct(page, api(store, archived))).status).toBe(200);
  const rejected = await direct(page, api(store, archived), "PATCH", { quantity: 9 });
  expect(rejected.status).toBe(422);
  expect(rejected.body.errors.product).toBeTruthy();
});

test("real archived Variant detail hides editing while retaining inventory read", async ({
  page,
}) => {
  const store = fixtures.archived.stores[0];
  await login(page, "archived", route(store, store.products.archived));
  await expect(inventoryPanel(page)).toBeVisible();
  await expect(quantity(page)).toHaveCount(0);
  expect(writes(page)).toHaveLength(0);
});

test("real wrong-parent foreign Store Product and Variant access fails safely", async ({
  page,
}) => {
  const [store, otherStore] = fixtures.foreign.stores;
  await login(page, "foreign");
  const outsider = fixtures.permissions_both.stores[0];
  const paths = [
    api(store, store.products.other, store.products.main.variants.first),
    api(store, otherStore.products.main),
    api(store, store.products.main, otherStore.products.main.variants.first),
    api(otherStore, store.products.main),
    api(outsider),
    api(store, store.products.main, "f812a554-2994-4ec3-8d79-22460231c601"),
  ];
  for (const endpoint of paths)
    for (const method of ["GET", "PATCH"]) {
      const result = await direct(
        page,
        endpoint,
        method,
        method === "PATCH" ? { quantity: 91 } : undefined,
      );
      expect(result.status).toBe(404);
      expect(result.body.data).toBeNull();
      expect(JSON.stringify(result.body)).not.toMatch(/SQLSTATE|stack trace|vendor\//i);
    }
  expect((await direct(page, api(otherStore))).body.data.quantity).toBe(37);
});

test("real parent availability uses configured active Variants only and parent quantity always remains null", async ({
  page,
}) => {
  const store = fixtures.aggregation.stores[0];
  await login(page, "aggregation");
  const product = store.products.main;
  const parent = async (availability: string) => {
    const result = await direct(page, productApi(store));
    expect(result.status).toBe(200);
    expect(result.body.data).toMatchObject({ quantity: null, availability, price: null });
  };
  await parent("unavailable");
  expect(
    (await direct(page, api(store, product, product.variants.inactive), "PATCH", { quantity: 90 }))
      .status,
  ).toBe(200);
  await parent("unavailable");
  expect((await direct(page, api(store), "PATCH", { quantity: 0 })).status).toBe(200);
  await parent("out_of_stock");
  expect(
    (await direct(page, api(store, product, product.variants.second), "PATCH", { quantity: 0 }))
      .status,
  ).toBe(200);
  await parent("out_of_stock");
  expect((await direct(page, api(store), "PATCH", { quantity: 4 })).status).toBe(200);
  await parent("in_stock");
  const individual = (await direct(page, `${productApi(store)}/variants/${product.variants.first}`))
    .body.data;
  expect(individual).toMatchObject({
    quantity: 4,
    availability: "in_stock",
    price: null,
    status: "active",
  });
  const list = (await direct(page, `${productApi(store)}/variants`)).body.data;
  expect(
    list.find((variant: { id: string }) => variant.id === product.variants.inactive),
  ).toMatchObject({ quantity: 90, availability: "in_stock", status: "inactive" });
  expect((await direct(page, api(store), "PATCH", { quantity: 0 })).status).toBe(200);
  await parent("out_of_stock");
  expect((await direct(page, productApi(store, store.products.simple))).body.data.quantity).toBe(
    19,
  );
});

async function hold(page: Page, endpoint: string, method: string) {
  let release!: () => void;
  let observed!: () => void;
  let finished!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const received = new Promise<void>((resolve) => {
    observed = resolve;
  });
  const done = new Promise<void>((resolve) => {
    finished = resolve;
  });
  await page.route(origin + endpoint, async (request) => {
    if (request.request().method() !== method) return request.continue();
    try {
      const result = await request.fetch();
      expect(result.status()).toBe(200);
      observed();
      await gate;
      await request.fulfill({ response: result }).catch(() => undefined);
    } finally {
      finished();
    }
  });
  return { release, received, done };
}

async function navigate(
  page: Page,
  store: Store,
  product = store.products.main,
  variant = product.variants.first,
) {
  await page.getByRole("link", { name: "Products", exact: true }).first().click();
  await page.getByRole("link", { name: product.name, exact: true }).click();
  await page.getByRole("link", { name: "Manage variants", exact: true }).click();
  await page.locator(`a[href="${route(store, product, variant)}"]`).click();
  await expect(inventoryPanel(page)).toBeVisible();
}

for (const boundary of ["switch", "product", "variant", "principal"] as const)
  for (const method of ["GET", "PATCH"] as const) {
    test(`real late Variant inventory ${method} is excluded across ${boundary} boundary`, async ({
      page,
    }) => {
      const group = `${boundary}_${method.toLowerCase()}`;
      const store = fixtures[group].stores[0];
      const delayed = method === "GET" ? await hold(page, api(store), method) : undefined;
      await login(page, group);
      const operation = delayed ?? (await hold(page, api(store), method));
      try {
        if (method === "PATCH") {
          await quantity(page).fill("73");
          await submit(page).click();
        }
        await operation.received;
        await page.evaluate(() => Object.assign(window, { __variantInventoryDocument: true }));
        let destination = store;
        let product = store.products.other;
        let variant = product.variants.first;
        if (boundary === "variant") {
          product = store.products.main;
          variant = product.variants.second;
        }
        if (boundary === "switch") {
          destination = fixtures[group].stores[1];
          product = destination.products.main;
          variant = product.variants.first;
          await page.getByRole("button", { name: "Switch store", exact: true }).click();
          await page.getByRole("button", { name: `Open ${destination.name}`, exact: true }).click();
        }
        if (boundary === "principal") {
          destination = fixtures.permissions_read.stores[0];
          product = destination.products.main;
          variant = product.variants.first;
          await page.getByRole("button", { name: "Account menu", exact: true }).click();
          await page.getByRole("menuitem", { name: "Sign out", exact: true }).click();
          await expect(page).toHaveURL(/\/login/);
          await page
            .getByRole("textbox", { name: "Email address", exact: true })
            .fill(fixtures.permissions_read.email);
          await page.getByLabel(/^Password/).fill(fixtures.permissions_read.password);
          await page.getByRole("button", { name: "Sign in", exact: true }).click();
          await expect(page).toHaveURL(new RegExp(`/stores/${destination.id}$`));
        }
        await navigate(page, destination, product, variant);
        const expected = boundary === "principal" ? 3 : 37;
        await expect(inventoryPanel(page)).toContainText(String(expected));
        operation.release();
        await operation.done;
        await expect(inventoryPanel(page)).toContainText(String(expected));
        if (boundary !== "principal") await expect(quantity(page)).toHaveValue(String(expected));
        await expect(inventoryPanel(page)).not.toContainText("73");
        await expect(inventoryPanel(page)).not.toContainText("Quantity saved.");
        expect((await direct(page, api(destination, product, variant))).body.data.quantity).toBe(
          expected,
        );
        expect(
          await page.evaluate(
            () =>
              (window as unknown as { __variantInventoryDocument: boolean })
                .__variantInventoryDocument,
          ),
        ).toBe(true);
        expect(writes(page)).toHaveLength(method === "PATCH" ? 1 : 0);
      } finally {
        operation.release();
      }
    });
  }

async function uncertain(
  page: Page,
  group: string,
  committed: boolean,
  mode: "abort" | "malformed" | "server_error" = "abort",
) {
  const store = await prepare(page, group);
  await page.route(origin + api(store), async (request) => {
    if (request.request().method() !== "PATCH") return request.continue();
    if (!committed) return request.abort("failed");
    const actual = await request.fetch();
    expect(actual.status()).toBe(200);
    details.set(page, { independentlyConfirmedBeforeResponseLoss: (await actual.json()).data });
    if (mode === "abort") return request.abort("failed");
    const envelope = await actual.json();
    await request.fulfill({
      response: actual,
      status: mode === "server_error" ? 503 : 200,
      body: JSON.stringify(
        mode === "malformed"
          ? { ...envelope, data: { quantity: 5, availability: "out_of_stock" } }
          : {
              ...envelope,
              success: false,
              data: null,
              message: "SQLSTATE private internals",
              errors: {},
            },
      ),
    });
  });
  await quantity(page).fill("5");
  await submit(page).click();
  await expect(inventoryPanel(page)).toContainText(
    "We couldn’t confirm whether the quantity was saved.",
  );
  await expect(
    inventoryPanel(page).getByRole("button", { name: "Review current inventory", exact: true }),
  ).toBeVisible();
  await expect(page.locator("body")).not.toContainText("SQLSTATE");
  expect(writes(page)).toHaveLength(1);
  await page.unroute(origin + api(store));
  return store;
}

for (const committed of [true, false]) {
  test(`real ${committed ? "committed" : "uncommitted"} uncertain Variant PATCH observes current state without claiming causation or replay`, async ({
    page,
  }) => {
    const store = await uncertain(page, committed ? "committed" : "uncommitted", committed);
    await capture(page, committed ? "unknown-committed" : "unknown-uncommitted");
    await fresh(page, store, true);
    await expect(inventoryPanel(page)).toContainText(
      "This does not confirm whether the earlier change was saved.",
    );
    await expect(inventoryPanel(page)).not.toContainText("Quantity saved.");
    await expect(quantity(page)).toHaveValue(committed ? "5" : "3");
    expect(writes(page)).toHaveLength(1);
    await setQuantity(page, store, 9);
    expect(writes(page).map((entry) => entry.body)).toEqual([{ quantity: 5 }, { quantity: 9 }]);
  });
}

test("real failed reconciliation keeps Variant unknown locked until inventory and identity reads succeed", async ({
  page,
}) => {
  const store = await uncertain(page, "failed_review", false);
  const variant = `${productApi(store)}/variants/${store.products.main.variants.first}`;
  await page.route(origin + variant, async (request) => request.abort("failed"));
  await inventoryPanel(page)
    .getByRole("button", { name: "Review current inventory", exact: true })
    .click();
  await expect(
    inventoryPanel(page).getByRole("button", { name: "Review current inventory", exact: true }),
  ).toBeEnabled();
  await expect(quantity(page)).toHaveCount(0);
  await expect(inventoryPanel(page)).toContainText(
    "We couldn’t confirm whether the quantity was saved.",
  );
  expect(writes(page)).toHaveLength(1);
  await page.unroute(origin + variant);
  await fresh(page, store, true);
  expect(writes(page)).toHaveLength(1);
});

test("real intervening commerce deduction after lost Variant response never replays stale absolute intent", async ({
  page,
}) => {
  const store = await uncertain(page, "intervening", true);
  expect(control("intervening", "deduct_one")).toEqual({ quantity: 4 });
  await fresh(page, store, true);
  await expect(quantity(page)).toHaveValue("4");
  expect(writes(page)).toHaveLength(1);
  await setQuantity(page, store, 6);
  expect(writes(page).map((entry) => entry.body)).toEqual([{ quantity: 5 }, { quantity: 6 }]);
});

for (const mode of ["malformed", "server_error"] as const)
  test(`real committed Variant mutation with ${mode} response stays uncertain`, async ({
    page,
  }) => {
    const store = await uncertain(page, mode, true, mode);
    await fresh(page, store, true);
    expect((await direct(page, api(store))).body.data.quantity).toBe(5);
    expect(writes(page)).toHaveLength(1);
  });

test("real confirmed Variant save remains successful when Product projection refresh fails", async ({
  page,
}) => {
  const store = await prepare(page, "refresh_failure");
  await page.route(origin + productApi(store), async (request) => request.abort("failed"));
  await setQuantity(page, store, 8);
  await expect(inventoryPanel(page)).toContainText("Quantity saved.");
  await expect(inventoryPanel(page)).not.toContainText(
    "We couldn’t confirm whether the quantity was saved.",
  );
  await expect(inventoryPanel(page)).toContainText(
    "The quantity was saved, but the latest product and variant details could not be confirmed yet.",
  );
  expect(writes(page)).toHaveLength(1);
  await page.unroute(origin + productApi(store));
  await fresh(page, store);
  expect((await direct(page, api(store))).body.data.quantity).toBe(8);
});

for (const interval of [0, 50, 120, 300, 450])
  test(`real Variant duplicate submit at ${interval}ms dispatches once`, async ({ page }) => {
    const store = await prepare(page, `double_${interval}`);
    await quantity(page).fill("8");
    await quantity(page).evaluate((input, delay) => {
      const form = input.closest("form")!;
      form.requestSubmit();
      window.setTimeout(() => form.requestSubmit(), delay);
    }, interval);
    await expect(inventoryPanel(page)).toContainText("Quantity saved.");
    await page.waitForTimeout(interval + 100);
    expect(writes(page)).toHaveLength(1);
    expect((await direct(page, api(store))).body.data.quantity).toBe(8);
  });

test("real repeated Enter cannot replay a consumed Variant inventory operation", async ({
  page,
}) => {
  const store = await prepare(page, "enter");
  await quantity(page).fill("8");
  await quantity(page).press("Enter");
  await page.keyboard.press("Enter");
  await expect(inventoryPanel(page)).toContainText("Quantity saved.");
  await page.keyboard.press("Enter");
  expect(writes(page)).toHaveLength(1);
  expect((await direct(page, api(store))).body.data.quantity).toBe(8);
});

test("real uncertain Variant inventory survives navigation remount without replay", async ({
  page,
}) => {
  const store = await uncertain(page, "remount", false);
  await navigate(page, store);
  await expect(
    inventoryPanel(page).getByRole("button", { name: "Review current inventory", exact: true }),
  ).toBeVisible();
  await expect(quantity(page)).toHaveCount(0);
  expect(writes(page)).toHaveLength(1);
  await fresh(page, store, true);
  expect(writes(page)).toHaveLength(1);
});

test("real unknown Variant PATCH remains locked after Store A to B to A", async ({ page }) => {
  const store = await uncertain(page, "switch_unknown", true);
  const other = fixtures.switch_unknown.stores[1];
  await page.getByRole("button", { name: "Switch store", exact: true }).click();
  await page.getByRole("button", { name: `Open ${other.name}`, exact: true }).click();
  await navigate(page, other);
  await expect(quantity(page)).toHaveValue("37");
  await page.getByRole("button", { name: "Switch store", exact: true }).click();
  await page.getByRole("button", { name: `Open ${store.name}`, exact: true }).click();
  await navigate(page, store);
  await expect(
    inventoryPanel(page).getByRole("button", { name: "Review current inventory", exact: true }),
  ).toBeVisible();
  await expect(quantity(page)).toHaveCount(0);
  expect(writes(page)).toHaveLength(1);
  await fresh(page, store, true);
  await expect(quantity(page)).toHaveValue("5");
  await expect(inventoryPanel(page)).toContainText(
    "This does not confirm whether the earlier change was saved.",
  );
  expect(writes(page)).toHaveLength(1);
});

test("real unknown Variant PATCH remains locked across refreshed authority revision", async ({
  page,
}) => {
  const store = await uncertain(page, "authority_unknown", true);
  const context = page.waitForResponse(
    (result) =>
      result.url().includes(`/stores/${store.id}/context`) && result.request().method() === "GET",
  );
  await page.getByRole("button", { name: "Refresh access", exact: true }).click();
  expect((await context).status()).toBe(200);
  await expect(
    inventoryPanel(page).getByRole("button", { name: "Review current inventory", exact: true }),
  ).toBeVisible();
  await expect(quantity(page)).toHaveCount(0);
  expect(writes(page)).toHaveLength(1);
  await fresh(page, store, true);
  await expect(quantity(page)).toHaveValue("5");
  expect(writes(page)).toHaveLength(1);
});

for (const [group, permission] of [
  ["revoke_read", "products.variants.view"],
  ["revoke_write", "products.variants.inventory.update"],
])
  test(`real revoked ${permission} preserves independent Laravel grant behavior and renews frontend authority`, async ({
    page,
  }) => {
    const store = await prepare(page, group);
    control(group, permission);
    await quantity(page).fill("9");
    const denied = response(page, api(store), "PATCH");
    await submit(page).click();
    // The exact write grant is independent: loss of read is enforced by renewed frontend scope.
    expect((await denied).status()).toBe(permission.endsWith("inventory.update") ? 403 : 200);
    if (permission.endsWith("inventory.update")) await expect(quantity(page)).toHaveCount(0);
    else await expect(inventoryPanel(page)).toHaveCount(0);
    expect(writes(page)).toHaveLength(1);
  });

test("real Variant Audit failure rolls back stock then confirmed HTTP write persists", async ({
  page,
}) => {
  const store = await prepare(page, "transaction");
  const proof = control("transaction", "audit_rollback");
  expect(proof).toEqual({ auditFailureReached: true, before: 3, after: 3 });
  expect((await direct(page, api(store))).body.data.quantity).toBe(3);
  await setQuantity(page, store, 7);
  details.set(page, proof);
});

test("real Variant inventory responsive keyboard pending success and reviewed states pass focused axe scans", async ({
  page,
}) => {
  const store = await prepare(page, "responsive");
  await capture(page, "unconfigured", [1440, 1280, 1024, 768, 390]);
  await quantity(page).fill("0");
  const operation = await hold(page, api(store), "PATCH");
  try {
    await submit(page).focus();
    await page.keyboard.press("Enter");
    await operation.received;
    await capture(page, "pending");
    operation.release();
    await operation.done;
    await expect(inventoryPanel(page)).toContainText("Out of stock");
    await capture(page, "success-zero");
    await page.unroute(origin + api(store));
    await fresh(page, store);
    await capture(page, "reviewed-zero");
    expect(writes(page)).toHaveLength(1);
  } finally {
    operation.release();
  }
});
