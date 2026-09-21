import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
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
type Inventory = { quantity: number | null; availability: string };
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
  readFileSync(path.resolve("artifacts/f3c/runtime/inventory-fixtures.json"), "utf8"),
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
  await mkdir(path.resolve("artifacts/f3c/browser"), { recursive: true });
  await writeFile(
    path.resolve(
      `artifacts/f3c/browser/${info.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.json`,
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
function control(group: string, change: string): Record<string, unknown> {
  return JSON.parse(
    execFileSync(
      "docker",
      [
        "exec",
        "qafilah-f2-runtime-app-1",
        "qafilah-entrypoint",
        "php",
        "/tmp/f3c-fixtures.php",
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
  await mkdir(path.resolve("artifacts/f3c/screenshots"), { recursive: true });
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
      path: path.resolve(`artifacts/f3c/screenshots/${surface}-${width}.png`),
      fullPage: true,
      caret: "initial",
    });
    scans.push({ width, violations: scan.violations });
  }
  await writeFile(
    path.resolve(`artifacts/f3c/screenshots/${surface}-axe.json`),
    JSON.stringify(scans, null, 2),
  );
  await page.setViewportSize({ width: 1440, height: 1100 });
}

test("real unconfigured zero positive and maximum quantity persist as absolute replacements", async ({
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
      (await direct(page, api(store, store.products.simple.id, false))).body.data.quantity,
    ).toBe(value);
  }
  expect(writes(page).map((entry) => entry.body)).toEqual([
    { quantity: 0 },
    { quantity: 12 },
    { quantity: 0 },
    { quantity: 2_000_000_000 },
  ]);
});

test("real invalid input strict JSON types unknown fields same-value and boundaries reject safely", async ({
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
    { quantity: null },
    { quantity: "1" },
    { quantity: 1.5 },
    { quantity: -1 },
    { quantity: 2_000_000_001 },
    { quantity: 1, store_id: 1 },
    { quantity: 1, tenant_id: store.id },
    { quantity: 1, product: store.products.simple.id },
    { quantity: 1, unexpected: true },
  ]) {
    const denied = await direct(page, api(store), "PATCH", body);
    expect(denied.status).toBe(422);
    expect(denied.body.data).toBeNull();
    expect(JSON.stringify(denied.body)).not.toMatch(/SQLSTATE|stack trace|vendor\//i);
  }
  expect((await direct(page, api(store), "PATCH", { quantity: 6 })).status).toBe(200);
  expect((await direct(page, api(store), "PATCH", { quantity: 6 })).status).toBe(422);
  expect((await direct(page, api(store))).body.data.quantity).toBe(6);
  let limited = false;
  for (let count = 0; count < 65; count++) {
    if ((await direct(page, api(store))).status === 429) {
      limited = true;
      break;
    }
  }
  expect(limited).toBe(true);
  const before = writes(page).length;
  await quantity(page).fill("7");
  const rateLimited = response(page, api(store), "PATCH");
  await submit(page).click();
  expect((await rateLimited).status()).toBe(429);
  await expect(inventoryPanel(page)).toContainText(/too many|wait|try again/i);
  expect(writes(page)).toHaveLength(before + 1);
});

test("real expired session reconciles boundedly after inventory dispatch without replay", async ({
  page,
  context,
}) => {
  const store = await prepare(page, "logout");
  const identityReadsBefore = traffic
    .get(page)!
    .filter((entry) => entry.path === "/api/v1/me").length;
  await context.clearCookies();
  await quantity(page).fill("7");
  await submit(page).click();
  await expect(page).toHaveURL(/\/login/);
  await expect(inventoryPanel(page)).toHaveCount(0);
  expect(writes(page).length).toBeLessThanOrEqual(1);
  for (const write of writes(page)) expect([401, 419]).toContain(write.status);
  expect(
    traffic.get(page)!.filter((entry) => entry.path === "/api/v1/me").length - identityReadsBefore,
  ).toBeLessThanOrEqual(2);
  expect(
    traffic.get(page)!.filter((entry) => entry.path === api(store) && entry.method === "PATCH")
      .length,
  ).toBeLessThanOrEqual(1);
});

test("real read-only merchant has no editor despite Owner Administrator role name", async ({
  page,
}) => {
  const store = fixtures.readonly.stores[0];
  await login(page, "readonly");
  await expect(inventoryPanel(page)).toContainText("In stock");
  await expect(quantity(page)).toHaveCount(0);
  await expect(submit(page)).toHaveCount(0);
  expect((await direct(page, api(store), "PATCH", { quantity: 8 })).status).toBe(403);
  await capture(page, "readonly");
});

test("real write-only grant cannot reveal Product or expose the inventory editor", async ({
  page,
}) => {
  const store = fixtures.writeonly.stores[0];
  await login(page, "writeonly");
  await expect(quantity(page)).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText(store.products.simple.name);
  expect((await direct(page, api(store))).status).toBe(403);
  expect(traffic.get(page)!.filter((entry) => entry.method === "PATCH")).toEqual([]);
});

for (const kind of ["archived", "variant"] as const) {
  test(`real ${kind} Product has no inventory editor and backend rejects mutation`, async ({
    page,
  }) => {
    const store = fixtures[kind].stores[0];
    await login(page, kind, route(store, store.products[kind].id));
    await expect(
      page.getByRole("heading", { name: store.products[kind].name, exact: true }),
    ).toBeVisible();
    await expect(submit(page)).toHaveCount(0);
    if (kind === "variant") {
      await expect(page.locator("body")).toContainText("Managed per variant");
      expect(traffic.get(page)!.filter((entry) => entry.path.endsWith("/inventory"))).toEqual([]);
      expect((await direct(page, api(store, store.products.variant.id))).status).toBe(422);
    }
    expect(
      (await direct(page, api(store, store.products[kind].id), "PATCH", { quantity: 8 })).status,
    ).toBe(422);
  });
}

test("real foreign unknown and malformed Products fail closed without inventory leakage", async ({
  page,
}) => {
  const store = await prepare(page, "foreign");
  const foreign = fixtures.readonly.stores[0].products.simple;
  for (const id of [foreign.id, "9f628f38-7562-4e70-bf9f-aa00ee119922", "not-a-uuid"]) {
    for (const method of ["GET", "PATCH"]) {
      const result = await direct(
        page,
        api(store, id),
        method,
        method === "PATCH" ? { quantity: 1 } : undefined,
      );
      expect(result.status).toBe(404);
      expect(result.body.data).toBeNull();
      expect(JSON.stringify(result.body)).not.toContain(foreign.name);
    }
  }
});

for (const [group, permission] of [
  ["revoke_read", "products.view"],
  ["revoke_write", "products.inventory.update"],
] as const) {
  test(`real same-session ${permission} revocation changes capability after authority refresh`, async ({
    page,
  }) => {
    const store = await prepare(page, group);
    control(group, permission);
    const refreshed = response(page, `/api/v1/stores/${store.id}/context`, "GET");
    await page.getByRole("button", { name: "Refresh access", exact: true }).click();
    expect((await refreshed).status()).toBe(200);
    await expect(quantity(page)).toHaveCount(0);
    if (permission === "products.view") expect((await direct(page, api(store))).status).toBe(403);
    else expect((await direct(page, api(store), "PATCH", { quantity: 8 })).status).toBe(403);
  });
}

for (const [group, change] of [
  ["store_loss", "store"],
  ["membership_loss", "membership"],
  ["identity_loss", "identity"],
] as const) {
  test(`real ${change} loss removes inventory authority`, async ({ page }) => {
    const store = await prepare(page, group);
    control(group, change);
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(quantity(page)).toHaveCount(0);
    await expect(page.locator("body")).not.toContainText(store.products.simple.name);
    expect([401, 403]).toContain((await direct(page, api(store))).status);
  });
}

async function hold(page: Page, endpoint: string, method: string) {
  let release!: () => void;
  let observed!: (data: Inventory) => void;
  let finished!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const received = new Promise<Inventory>((resolve) => {
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
      observed((await result.json()).data);
      await gate;
      await request.fulfill({ response: result }).catch(() => undefined);
    } finally {
      finished();
    }
  });
  return { release, received, done };
}

for (const method of ["GET", "PATCH"] as const) {
  test(`real Store A to B delayed inventory ${method} cannot publish or replay in B`, async ({
    page,
  }) => {
    const group = `switch_${method.toLowerCase()}`;
    const [a, b] = fixtures[group].stores;
    const delayed = method === "GET" ? await hold(page, api(a), method) : undefined;
    await login(page, group);
    const operation = delayed ?? (await hold(page, api(a), method));
    try {
      if (method === "PATCH") {
        await quantity(page).fill("73");
        await submit(page).click();
      }
      await operation.received;
      await page.getByRole("button", { name: "Switch store", exact: true }).click();
      await page.getByRole("button", { name: `Open ${b.name}`, exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`/stores/${b.id}/products$`));
      await page.getByRole("link", { name: b.products.simple.name, exact: true }).click();
      await expect(inventoryPanel(page)).toContainText("37");
      operation.release();
      await operation.done;
      await expect(inventoryPanel(page)).toContainText("37");
      await expect(page.locator("body")).not.toContainText(a.products.simple.name);
      expect((await direct(page, api(b))).body.data.quantity).toBe(37);
      expect(writes(page)).toHaveLength(method === "PATCH" ? 1 : 0);
    } finally {
      operation.release();
    }
  });
}

for (const method of ["GET", "PATCH"] as const) {
  test(`real logout and new principal reject the old delayed inventory ${method}`, async ({
    page,
  }) => {
    const group = `principal_${method.toLowerCase()}`;
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
      await page.evaluate(() => Object.assign(window, { __inventorySameDocument: true }));
      await page.getByRole("button", { name: "Account menu", exact: true }).click();
      await page.getByRole("menuitem", { name: "Sign out", exact: true }).click();
      await expect(page).toHaveURL(/\/login/);
      await expect(page.locator("body")).not.toContainText(store.products.simple.name);
      await page
        .getByRole("textbox", { name: "Email address", exact: true })
        .fill(fixtures.readonly.email);
      await page.getByLabel(/^Password/).fill(fixtures.readonly.password);
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`/stores/${fixtures.readonly.stores[0].id}$`));
      await page.getByRole("link", { name: "Products", exact: true }).first().click();
      await page
        .getByRole("link", { name: fixtures.readonly.stores[0].products.simple.name, exact: true })
        .click();
      expect(
        await page.evaluate(
          () => (window as unknown as { __inventorySameDocument: boolean }).__inventorySameDocument,
        ),
      ).toBe(true);
      await expect(inventoryPanel(page)).toContainText("3");
      await expect(quantity(page)).toHaveCount(0);
      operation.release();
      await operation.done;
      await expect(inventoryPanel(page)).toContainText("3");
      await expect(page.locator("body")).not.toContainText(store.products.simple.name);
      await expect(inventoryPanel(page)).not.toContainText("Quantity saved.");
      await expect(quantity(page)).toHaveCount(0);
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
    const result = await request.fetch();
    expect(result.status()).toBe(200);
    details.set(page, { independentlyConfirmedBeforeResponseLoss: (await result.json()).data });
    if (mode === "abort") return request.abort("failed");
    return request.fulfill({
      response: result,
      status: mode === "server_error" ? 503 : 200,
      body: JSON.stringify(
        mode === "malformed"
          ? {
              success: true,
              data: { quantity: 5, availability: "out_of_stock" },
              meta: { request_id: "8b04d259-6f1a-4ff7-b665-e54fc28b8cd8" },
              message: null,
            }
          : {
              success: false,
              data: null,
              meta: { request_id: "8b04d259-6f1a-4ff7-b665-e54fc28b8cd8" },
              message: "SQLSTATE private internals",
              errors: {},
            },
      ),
    });
  });
  await quantity(page).fill("5");
  await submit(page).click();
  await expect(inventoryPanel(page)).toContainText(
    /couldn.t confirm|could not confirm|outcome.*unknown/i,
  );
  await expect(
    inventoryPanel(page).getByRole("button", { name: "Review current inventory", exact: true }),
  ).toBeVisible();
  expect(writes(page)).toHaveLength(1);
  await expect(page.locator("body")).not.toContainText("SQLSTATE");
  await page.unroute(origin + api(store));
  return store;
}

for (const committed of [true, false]) {
  test(`real unknown ${committed ? "committed" : "uncommitted"} PATCH reviews current state without inferring outcome and allows a new deliberate change`, async ({
    page,
  }) => {
    const store = await uncertain(page, committed ? "committed" : "uncommitted", committed);
    await capture(page, committed ? "unknown-committed" : "unknown-uncommitted");
    await fresh(page, store, true);
    await expect(inventoryPanel(page)).toContainText(
      "This does not confirm whether the earlier change was saved.",
    );
    await expect(inventoryPanel(page)).not.toContainText("Quantity saved.");
    expect((await direct(page, api(store))).body.data.quantity).toBe(committed ? 5 : 3);
    await expect(quantity(page)).toHaveValue(committed ? "5" : "3");
    expect(writes(page)).toHaveLength(1);
    await capture(page, committed ? "reviewed-committed" : "reviewed-uncommitted");
    await setQuantity(page, store, 9);
    expect(writes(page)).toHaveLength(2);
    expect((await direct(page, api(store))).body.data.quantity).toBe(9);
  });
}

test("real failed reconciliation retains unknown lock until both authoritative reads succeed", async ({
  page,
}) => {
  const store = await uncertain(page, "failed_review", false);
  await page.route(origin + api(store), async (request) => request.abort("failed"));
  await inventoryPanel(page)
    .getByRole("button", { name: "Review current inventory", exact: true })
    .click();
  await expect(
    inventoryPanel(page).getByRole("button", { name: "Review current inventory", exact: true }),
  ).toBeEnabled();
  await expect(inventoryPanel(page)).toContainText(
    "We couldn’t confirm whether the quantity was saved.",
  );
  await expect(quantity(page)).toHaveCount(0);
  expect(writes(page)).toHaveLength(1);
  await page.unroute(origin + api(store));
  await fresh(page, store, true);
  expect(writes(page)).toHaveLength(1);
});

test("real intervening commerce deduction after committed uncertain set shows four and never replays five", async ({
  page,
}) => {
  const store = await uncertain(page, "intervening", true);
  expect(control("intervening", "deduct_one")).toEqual({ quantity: 4 });
  await fresh(page, store, true);
  await expect(inventoryPanel(page)).toContainText("4");
  await expect(quantity(page)).not.toHaveValue("5");
  expect((await direct(page, api(store))).body.data.quantity).toBe(4);
  expect(writes(page)).toHaveLength(1);
  await setQuantity(page, store, 6);
  expect(writes(page).map((entry) => entry.body)).toEqual([{ quantity: 5 }, { quantity: 6 }]);
});

for (const mode of ["malformed", "server_error"] as const) {
  test(`real committed mutation with ${mode} response stays unknown without replay`, async ({
    page,
  }) => {
    const store = await uncertain(page, mode, true, mode);
    await fresh(page, store, true);
    expect((await direct(page, api(store))).body.data.quantity).toBe(5);
    expect(writes(page)).toHaveLength(1);
  });
}

test("real confirmed success stays confirmed when a subsequent Product refresh fails", async ({
  page,
}) => {
  const store = await prepare(page, "refresh_failure");
  await page.route(origin + api(store, store.products.simple.id, false), async (request) =>
    request.abort("failed"),
  );
  await setQuantity(page, store, 8);
  await expect(
    inventoryPanel(page).getByRole("button", { name: "Review current inventory", exact: true }),
  ).toHaveCount(0);
  expect((await direct(page, api(store))).body.data.quantity).toBe(8);
  expect(writes(page)).toHaveLength(1);
});

for (const interval of [0, 50, 120, 300, 450]) {
  test(`real inventory double-click at ${interval}ms dispatches once across response boundaries`, async ({
    page,
  }) => {
    const store = await prepare(page, `double_${interval}`);
    await quantity(page).fill("8");
    const button = submit(page);
    await button.scrollIntoViewIfNeeded();
    const box = (await button.boundingBox())!;
    const target = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    let confirmed = false;
    const received = response(page, api(store), "PATCH");
    void received.then(() => {
      confirmed = true;
    });
    await page.mouse.click(target.x, target.y, { clickCount: 1 });
    if (interval) await page.waitForTimeout(interval); // Challenged input cadence, never a runtime lock.
    const responseBeforeSecondClick = confirmed;
    await page.mouse.click(target.x, target.y, { clickCount: 2 });
    expect((await received).status()).toBe(200);
    expect((await direct(page, api(store))).body.data.quantity).toBe(8);
    expect(writes(page)).toHaveLength(1);
    details.set(page, { interval, responseBeforeSecondClick });
    if (interval === 450) expect(responseBeforeSecondClick).toBe(true);
  });
}

test("real Enter and requestSubmit after response cannot replay the consumed operation", async ({
  page,
}) => {
  const store = await prepare(page, "enter");
  await quantity(page).fill("8");
  await quantity(page).evaluate((input) => {
    Object.assign(window, { __inventoryOldForm: input.closest("form") });
  });
  const result = response(page, api(store), "PATCH");
  await quantity(page).press("Enter");
  expect((await result).status()).toBe(200);
  await page.keyboard.press("Enter");
  await page.evaluate(() =>
    (
      window as unknown as { __inventoryOldForm: HTMLFormElement }
    ).__inventoryOldForm.requestSubmit(),
  );
  expect((await direct(page, api(store))).body.data.quantity).toBe(8);
  expect(writes(page)).toHaveLength(1);
});

test("real consumed unknown operation survives component navigation remount", async ({ page }) => {
  const store = await uncertain(page, "remount", false);
  await page.getByRole("link", { name: "Products", exact: true }).first().click();
  await page.getByRole("link", { name: store.products.simple.name, exact: true }).click();
  await expect(
    inventoryPanel(page).getByRole("button", { name: "Review current inventory", exact: true }),
  ).toBeVisible();
  expect(writes(page)).toHaveLength(1);
});

test("real audit failure rolls back stock and a later confirmed HTTP write persists", async ({
  page,
}) => {
  const store = await prepare(page, "transaction");
  const proof = control("transaction", "audit_rollback");
  expect(proof).toEqual({ auditFailureReached: true, before: 3, after: 3 });
  expect((await direct(page, api(store))).body.data.quantity).toBe(3);
  await setQuantity(page, store, 7);
  expect((await direct(page, api(store))).body.data.quantity).toBe(7);
  details.set(page, proof);
});

test("real inventory responsive keyboard pending success and review states have representative axe coverage", async ({
  page,
}) => {
  const store = await prepare(page, "responsive");
  await capture(page, "unconfigured", [1440, 1280, 1024, 768, 390]);
  await quantity(page).fill("0");
  const delayed = await hold(page, api(store), "PATCH");
  try {
    await submit(page).focus();
    await page.keyboard.press("Enter");
    await delayed.received;
    await capture(page, "pending");
    delayed.release();
    await delayed.done;
    await expect(inventoryPanel(page)).toContainText("Out of stock");
    await capture(page, "success-zero");
    await page.unroute(origin + api(store));
    await fresh(page, store);
    await expect(quantity(page)).toHaveValue("0");
    await setQuantity(page, store, 16);
    await expect(inventoryPanel(page)).toContainText("In stock");
    await capture(page, "success-positive");
  } finally {
    delayed.release();
  }
});
