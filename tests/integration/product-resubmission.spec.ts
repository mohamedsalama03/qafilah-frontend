import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

type Operation = "publish" | "unpublish" | "archive" | "create" | "save";
type Product = { id: string; name: string; slug: string; status: string };
type Store = { id: string; name: string; products: { draft: Product; published: Product } };
type Fixture = { email: string; password: string; store: Store };
type Write = {
  method: string;
  path: string;
  at: number;
  responseAt?: number;
  status?: number;
  csrf: boolean;
  authorization: boolean;
};
const fixtures = JSON.parse(
  readFileSync(
    path.resolve("artifacts/f3b-remediation/runtime/resubmission-fixtures.json"),
    "utf8",
  ),
) as Record<string, Fixture>;
const backend = "http://localhost:3842";
const traffic = new WeakMap<Page, Write[]>();
const runtimeErrors = new WeakMap<Page, string[]>();
const boundaryEvidence = new WeakMap<Page, unknown>();

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  traffic.set(page, []);
  runtimeErrors.set(page, []);
  page.on("pageerror", (error) => runtimeErrors.get(page)!.push(error.message));
  page.on("request", (request) => {
    if (
      !request.url().startsWith(backend) ||
      !request.url().includes("/catalog/") ||
      !["POST", "PATCH", "PUT", "DELETE"].includes(request.method())
    )
      return;
    traffic.get(page)!.push({
      method: request.method(),
      path: new URL(request.url()).pathname,
      at: performance.now(),
      csrf: !!request.headers()["x-xsrf-token"],
      authorization: !!request.headers().authorization,
    });
  });
  page.on("response", (response) => {
    if (!response.url().startsWith(backend)) return;
    const item = traffic
      .get(page)!
      .findLast(
        (entry) =>
          entry.path === new URL(response.url()).pathname &&
          entry.method === response.request().method() &&
          entry.status === undefined,
      );
    if (item) {
      item.status = response.status();
      item.responseAt = performance.now();
    }
  });
});

test.afterEach(async ({ page }, info) => {
  await mkdir(path.resolve("artifacts/f3b-remediation/browser"), { recursive: true });
  await writeFile(
    path.resolve(
      `artifacts/f3b-remediation/browser/${info.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.json`,
    ),
    JSON.stringify(
      {
        writes: traffic.get(page),
        boundary: boundaryEvidence.get(page),
        runtimeErrors: runtimeErrors.get(page),
      },
      null,
      2,
    ),
  );
  expect(runtimeErrors.get(page)).toEqual([]);
  for (const write of traffic.get(page)!) {
    expect(write.csrf).toBe(true);
    expect(write.authorization).toBe(false);
    expect(write.method).toMatch(/^(POST|PATCH)$/);
  }
});

function api(store: Store, product?: Product, action?: string) {
  return `/api/v1/stores/${store.id}/catalog/products${product ? `/${product.id}` : ""}${action ? `/${action}` : ""}`;
}
function route(store: Store, product?: Product, edit = false) {
  return `/stores/${store.id}/products${product ? `/${product.id}` : ""}${edit ? "/edit" : ""}`;
}
function writes(page: Page) {
  return traffic.get(page)!;
}
async function login(page: Page, group: string, destination: string) {
  const fixture = fixtures[group];
  await page.goto(`/login?returnTo=${encodeURIComponent(destination)}`);
  await page.getByRole("textbox", { name: "Email address", exact: true }).fill(fixture.email);
  await page.getByLabel(/^Password/).fill(fixture.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(
    new RegExp(destination.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$"),
  );
  await expect(page.getByRole("region", { name: "Current store", exact: true })).toHaveAttribute(
    "data-store-uuid",
    fixture.store.id,
  );
}
async function fields(page: Page, group: string) {
  await page.getByRole("textbox", { name: "Product name", exact: true }).fill(`Created ${group}`);
  await page
    .getByRole("textbox", { name: "Slug", exact: true })
    .fill(`created-${group.replaceAll("_", "-")}`);
  await page
    .getByRole("textbox", { name: "Description", exact: true })
    .fill("A synthetic double-click product.");
}
async function readProduct(page: Page, store: Store, productId: string) {
  const result = await page.evaluate(
    async (url) => {
      const response = await fetch(url, {
        credentials: "include",
        headers: { Accept: "application/json" },
      });
      return { status: response.status, body: await response.json() };
    },
    backend + api(store) + "/" + productId,
  );
  expect(result.status).toBe(200);
  return result.body.data as Product;
}
function responseFor(page: Page, endpoint: string, method: string) {
  return page.waitForResponse(
    (response) => response.url() === backend + endpoint && response.request().method() === method,
  );
}
async function captureConfirmed(page: Page, surface: string) {
  await mkdir(path.resolve("artifacts/f3b-remediation/screenshots"), { recursive: true });
  const scans = [];
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1100 });
    const scan = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(scan.violations).toEqual([]);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflow).toBe(false);
    scans.push({ width, violations: scan.violations, overflow });
    await page.screenshot({
      path: path.resolve(`artifacts/f3b-remediation/screenshots/${surface}-${width}.png`),
      fullPage: true,
    });
  }
  await writeFile(
    path.resolve(`artifacts/f3b-remediation/screenshots/${surface}-axe.json`),
    JSON.stringify(scans, null, 2),
  );
  await page.setViewportSize({ width: 1440, height: 1100 });
}
async function prepare(page: Page, group: string, operation: Operation) {
  const store = fixtures[group].store;
  const product = operation === "unpublish" ? store.products.published : store.products.draft;
  await login(
    page,
    group,
    operation === "create" ? route(store) + "/new" : route(store, product, operation === "save"),
  );
  if (operation === "create") await fields(page, group);
  if (operation === "save")
    await page.getByRole("textbox", { name: "Product name", exact: true }).fill(`Saved ${group}`);
  if (operation === "archive") {
    await page.getByRole("button", { name: "Archive product", exact: true }).click();
    await expect(
      page.getByRole("alertdialog", { name: "Archive product", exact: true }),
    ).toBeVisible();
  }
  const label = {
    create: "Create product",
    save: "Save changes",
    publish: "Publish",
    unpublish: "Unpublish",
    archive: "Archive product",
  }[operation];
  const button =
    operation === "archive"
      ? page.getByRole("alertdialog").getByRole("button", { name: label, exact: true })
      : page.getByRole("button", { name: label, exact: true });
  await button.scrollIntoViewIfNeeded();
  const bounds = await button.boundingBox();
  expect(bounds).not.toBeNull();
  return {
    store,
    product,
    button,
    point: { x: bounds!.x + bounds!.width / 2, y: bounds!.y + bounds!.height / 2 },
    endpoint: api(
      store,
      operation === "create" ? undefined : product,
      ["publish", "unpublish", "archive"].includes(operation) ? operation : undefined,
    ),
    method: operation === "save" ? "PATCH" : "POST",
  };
}

for (const operation of ["publish", "unpublish", "create", "save", "archive"] as const) {
  for (const interval of [0, 50, 120, 200, 300, 450]) {
    test(`real natural ${operation} double-click at ${interval}ms sends one mutation across confirmed responses`, async ({
      page,
    }) => {
      const group = `${operation}_${interval}`;
      const prepared = await prepare(page, group, operation);
      const resultPromise = responseFor(page, prepared.endpoint, prepared.method);
      let responseObserved = false;
      void resultPromise.then(() => {
        responseObserved = true;
      });
      const firstClickAt = performance.now();
      await page.mouse.click(prepared.point.x, prepared.point.y, { clickCount: 1 });
      if (interval) await page.waitForTimeout(interval); // Input cadence challenge, never an application lock.
      const secondClickAt = performance.now();
      const responseBeforeSecondClick = responseObserved;
      await page.mouse.click(prepared.point.x, prepared.point.y, { clickCount: 2 });
      const response = await resultPromise;
      expect(response.status()).toBe(operation === "create" ? 201 : 200);
      const result = await response.json();
      await expect.poll(() => writes(page).length).toBe(1);
      const authoritative = await readProduct(page, prepared.store, result.data.id);
      const expectedStatus =
        operation === "publish" ? "published" : operation === "archive" ? "archived" : "draft";
      expect(authoritative.status).toBe(expectedStatus);
      expect(writes(page)).toHaveLength(1);
      if (operation === "publish")
        expect(writes(page).filter((entry) => entry.path.endsWith("/unpublish"))).toHaveLength(0);
      if (operation === "unpublish")
        expect(writes(page).filter((entry) => entry.path.endsWith("/publish"))).toHaveLength(0);
      await expect(page.locator("body")).not.toContainText(
        /slug.*(?:taken|already)|does not change any field/i,
      );
      boundaryEvidence.set(page, {
        operation,
        requestedIntervalMs: interval,
        observedClickIntervalMs: secondClickAt - firstClickAt,
        responseBeforeSecondClick,
        authoritativeStatus: authoritative.status,
        productId: authoritative.id,
      });
      if (interval === 450) expect(responseBeforeSecondClick).toBe(true);
    });
  }
}

async function holdDetailNavigation(page: Page, store: Store) {
  let release!: () => void;
  let held!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const encountered = new Promise<void>((resolve) => {
    held = resolve;
  });
  await page.route(
    (url) =>
      url.origin === "http://localhost:3000" &&
      new RegExp(`^/stores/${store.id}/products/[a-f0-9-]+$`).test(url.pathname) &&
      !url.pathname.endsWith("/new"),
    async (request) => {
      held();
      await gate;
      await request.continue().catch(() => undefined);
    },
  );
  return { release, encountered };
}

for (const operation of ["create", "save"] as const) {
  test(`real ${operation} second Enter after confirmed response cannot resubmit during delayed navigation`, async ({
    page,
  }) => {
    const group = `boundary_${operation}`;
    const prepared = await prepare(page, group, operation);
    const navigation = await holdDetailNavigation(page, prepared.store);
    try {
      const response = responseFor(page, prepared.endpoint, prepared.method);
      await prepared.button.focus();
      await page.keyboard.press("Enter");
      const received = await response;
      expect(received.status()).toBe(operation === "create" ? 201 : 200);
      await navigation.encountered;
      await page.keyboard.press("Enter");
      expect(writes(page)).toHaveLength(1);
      await expect(
        page.getByRole("button", {
          name: operation === "create" ? "Create product" : "Save changes",
          exact: true,
        }),
      ).toHaveCount(0);
      await captureConfirmed(page, `${operation}-confirmed`);
      navigation.release();
      const product = (await received.json()).data;
      await expect(page).toHaveURL(new RegExp(`/products/${product.id}$`));
      expect((await readProduct(page, prepared.store, product.id)).name).toBe(product.name);
      await expect(page.locator("body")).not.toContainText(
        /slug.*(?:taken|already)|does not change any field/i,
      );
      expect(writes(page)).toHaveLength(1);
      boundaryEvidence.set(page, {
        operation,
        responseBeforeSecondEnter: true,
        navigationHeld: true,
        dispatched: 1,
      });
    } finally {
      navigation.release();
    }
  });
}

for (const operation of ["create", "save"] as const) {
  test(`real ${operation} fresh action supersedes an older held success navigation`, async ({
    page,
  }) => {
    const group = `fresh_boundary_${operation}`;
    const prepared = await prepare(page, group, operation);
    const navigation = await holdDetailNavigation(page, prepared.store);
    try {
      const response = responseFor(page, prepared.endpoint, prepared.method);
      await prepared.button.click();
      expect((await response).status()).toBe(operation === "create" ? 201 : 200);
      await navigation.encountered;
      await page
        .getByRole("button", {
          name: operation === "create" ? "Create another product" : "Start a new edit",
          exact: true,
        })
        .click();
      const name = page.getByRole("textbox", { name: "Product name", exact: true });
      if (operation === "create") await expect(name).toHaveValue("");
      else await expect(name).toHaveValue(`Saved ${group}`);
      await name.fill("Fresh user input survives old navigation");
      navigation.release();
      await page.waitForLoadState("networkidle");
      await expect(page).toHaveURL(
        new RegExp(
          operation === "create" ? "/products/new$" : `/products/${prepared.product.id}/edit$`,
        ),
      );
      await expect(name).toHaveValue("Fresh user input survives old navigation");
      expect(writes(page)).toHaveLength(1);
      boundaryEvidence.set(page, {
        operation,
        realResponseConfirmed: true,
        priorNavigationHeld: true,
        explicitFreshAction: true,
        newInputPreservedAfterRelease: true,
      });
    } finally {
      navigation.release();
    }
  });
}

test("real late edit review cannot override newer Overview navigation", async ({ page }) => {
  const prepared = await prepare(page, "leave_during_review", "save");
  const navigation = await holdDetailNavigation(page, prepared.store);
  let releaseReview!: () => void;
  let reviewSeen!: () => void;
  const reviewGate = new Promise<void>((resolve) => {
    releaseReview = resolve;
  });
  const reviewEncountered = new Promise<void>((resolve) => {
    reviewSeen = resolve;
  });
  try {
    const response = responseFor(page, prepared.endpoint, "PATCH");
    await prepared.button.click();
    expect((await response).status()).toBe(200);
    await navigation.encountered;
    await page.route(backend + api(prepared.store, prepared.product), async (request) => {
      if (request.request().method() !== "GET") return request.continue();
      const result = await request.fetch();
      expect(result.status()).toBe(200);
      reviewSeen();
      await reviewGate;
      await request.fulfill({ response: result }).catch(() => undefined);
    });
    await page.getByRole("button", { name: "Start a new edit", exact: true }).click();
    await reviewEncountered;
    await page.getByRole("link", { name: "Overview", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/stores/${prepared.store.id}$`));
    releaseReview();
    navigation.release();
    await page.waitForLoadState("networkidle");
    await expect(page).toHaveURL(new RegExp(`/stores/${prepared.store.id}$`));
    await expect(page.getByRole("textbox", { name: "Product name", exact: true })).toHaveCount(0);
    expect(writes(page)).toHaveLength(1);
    boundaryEvidence.set(page, {
      initialNavigationHeld: true,
      authoritativeReviewResponseHeld: true,
      newerOverviewNavigationPreserved: true,
    });
  } finally {
    releaseReview();
    navigation.release();
  }
});

test("real later deliberate lifecycle review allows one new opposite operation", async ({
  page,
}) => {
  const prepared = await prepare(page, "future_lifecycle", "publish");
  let response = responseFor(page, prepared.endpoint, "POST");
  await prepared.button.click();
  expect((await response).status()).toBe(200);
  await expect(page.getByRole("button", { name: "Unpublish", exact: true })).toHaveCount(0);
  await captureConfirmed(page, "publish-confirmed");
  const read = responseFor(page, api(prepared.store, prepared.product), "GET");
  await page.getByRole("button", { name: "Review product actions", exact: true }).focus();
  await page.keyboard.press("Enter");
  expect((await read).status()).toBe(200);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document.activeElement?.tagName === "DIV" &&
          (document.activeElement as HTMLElement).tabIndex === -1 &&
          document.activeElement.textContent?.includes("Unpublish"),
      ),
    )
    .toBe(true);
  response = responseFor(page, api(prepared.store, prepared.product, "unpublish"), "POST");
  await page.getByRole("button", { name: "Unpublish", exact: true }).click();
  expect((await response).status()).toBe(200);
  expect((await readProduct(page, prepared.store, prepared.product.id)).status).toBe("draft");
  expect(writes(page)).toHaveLength(2);
});

test("real later deliberate new edit permits a fresh sparse PATCH after confirmed Save", async ({
  page,
}) => {
  const prepared = await prepare(page, "future_save", "save");
  let response = responseFor(page, prepared.endpoint, "PATCH");
  await prepared.button.click();
  expect((await response).status()).toBe(200);
  await expect(page).toHaveURL(new RegExp(`/products/${prepared.product.id}$`));
  await page.getByRole("link", { name: "Edit", exact: true }).click();
  await page.getByRole("button", { name: "Start a new edit", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Description", exact: true })
    .fill("Later deliberate edit.");
  response = responseFor(page, prepared.endpoint, "PATCH");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  const received = await response;
  expect(received.status()).toBe(200);
  expect(received.request().postDataJSON()).toEqual({ description: "Later deliberate edit." });
  expect(writes(page)).toHaveLength(2);
});

test("real edit after lifecycle review uses an external writer's latest Product without reverting its name", async ({
  page,
}) => {
  const prepared = await prepare(page, "external_update", "publish");
  const publish = responseFor(page, prepared.endpoint, "POST");
  await prepared.button.click();
  expect((await publish).status()).toBe(200);
  const reviewed = responseFor(page, api(prepared.store, prepared.product), "GET");
  await page.getByRole("button", { name: "Review product actions", exact: true }).click();
  expect((await reviewed).status()).toBe(200);
  await page.getByRole("link", { name: "Overview", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/stores/${prepared.store.id}$`));
  const xsrf = (await page.context().cookies(backend)).find(
    (cookie) => cookie.name === "XSRF-TOKEN",
  );
  expect(xsrf).toBeDefined();
  const external = await page.request.patch(backend + api(prepared.store, prepared.product), {
    headers: {
      Accept: "application/json",
      Origin: "http://localhost:3000",
      Referer: "http://localhost:3000/",
      "X-XSRF-TOKEN": decodeURIComponent(xsrf!.value),
    },
    data: { name: "External writer latest Product B" },
  });
  expect(external.status()).toBe(200);
  await page.getByRole("link", { name: "Products", exact: true }).first().click();
  await page.getByRole("link", { name: "External writer latest Product B", exact: true }).click();
  const fresh = responseFor(page, api(prepared.store, prepared.product), "GET");
  await page.getByRole("button", { name: "Refresh product", exact: true }).click();
  const freshResponse = await fresh;
  expect(freshResponse.status()).toBe(200);
  expect((await freshResponse.json()).data.name).toBe("External writer latest Product B");
  await expect(
    page.getByRole("heading", { name: "External writer latest Product B", exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Edit", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Product name", exact: true })).toHaveValue(
    "External writer latest Product B",
  );
  await page
    .getByRole("textbox", { name: "Description", exact: true })
    .fill("A different field changed after external update.");
  const save = responseFor(page, api(prepared.store, prepared.product), "PATCH");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  const received = await save;
  expect(received.status()).toBe(200);
  expect(received.request().postDataJSON()).toEqual({
    description: "A different field changed after external update.",
  });
  expect((await received.json()).data.name).toBe("External writer latest Product B");
  expect((await readProduct(page, prepared.store, prepared.product.id)).name).toBe(
    "External writer latest Product B",
  );
  expect(writes(page)).toHaveLength(2);
  boundaryEvidence.set(page, {
    separateHttpClientWrites: 1,
    externalWriteStatus: external.status(),
    uiWrites: 2,
    latestNamePreserved: true,
    sparsePatchPreserved: true,
  });
});

test("real Create another deliberately resets to a blank independent creation slot", async ({
  page,
}) => {
  const store = fixtures.future_create.store;
  await login(page, "future_create", route(store) + "/new");
  await fields(page, "future_create");
  let response = responseFor(page, api(store), "POST");
  await page.getByRole("button", { name: "Create product", exact: true }).click();
  expect((await response).status()).toBe(201);
  await expect(page.getByRole("heading", { name: "Product created", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Create another product", exact: true }).click();
  for (const label of ["Product name", "Slug", "Description"])
    await expect(page.getByRole("textbox", { name: label, exact: true })).toHaveValue("");
  await fields(page, "future_create_second");
  response = responseFor(page, api(store), "POST");
  await page.getByRole("button", { name: "Create product", exact: true }).click();
  expect((await response).status()).toBe(201);
  expect(writes(page)).toHaveLength(2);
});
