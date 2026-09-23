import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

type Group =
  | "create_simple"
  | "create_only"
  | "create_variant"
  | "validation"
  | "categories"
  | "edit"
  | "lifecycle"
  | "denied"
  | "revocation_create"
  | "revocation_update"
  | "revocation_publish"
  | "foreign"
  | "switch"
  | "logout"
  | "identity"
  | "unknown_create"
  | "unknown_update"
  | "unknown_lifecycle"
  | "double_create"
  | "double_update"
  | "responsive"
  | "unsaved"
  | "no_categories";
type Product = {
  id: string;
  name: string;
  slug: string;
  status: "draft" | "published" | "archived";
};
type Category = { id: string; name: string };
type Store = {
  id: string;
  name: string;
  products: Record<"draft" | "published" | "archived", Product>;
  categories: Category[];
};
type Merchant = { email: string; password: string; stores: Store[] };
type Fixtures = Record<Group, Merchant> & {
  foreignResource: {
    store: { id: string; name: string };
    product: { id: string; name: string };
    category: Category;
  };
};
const fixtures = JSON.parse(
  readFileSync(path.resolve("artifacts/f3b/runtime/management-fixtures.json"), "utf8"),
) as Fixtures;
const origin = "http://localhost:3842";
type Traffic = {
  method: string;
  path: string;
  status?: number;
  csrf: boolean;
  authorization: boolean;
  bodyKeys: string[];
};
const requests = new WeakMap<Page, Traffic[]>();
const errors = new WeakMap<Page, string[]>();

async function evidence(name: string, value: unknown) {
  await mkdir(path.resolve("artifacts/f3b/browser"), { recursive: true });
  await writeFile(
    path.resolve(`artifacts/f3b/browser/${name}.json`),
    JSON.stringify(value, null, 2),
  );
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  requests.set(page, []);
  errors.set(page, []);
  page.on("pageerror", (error) => errors.get(page)!.push(error.message));
  page.on("console", (message) => {
    if (
      /hydration|did not match|invalid hook|refused to.*script|content security policy/i.test(
        message.text(),
      )
    )
      errors.get(page)!.push(message.text());
  });
  page.on("request", (request) => {
    if (!request.url().startsWith(origin)) return;
    const url = new URL(request.url());
    let bodyKeys: string[] = [];
    if (url.pathname.includes("/catalog/") && request.postData())
      bodyKeys = Object.keys(request.postDataJSON() ?? {});
    requests.get(page)!.push({
      method: request.method(),
      path: url.pathname + url.search,
      csrf: !!request.headers()["x-xsrf-token"],
      authorization: !!request.headers().authorization,
      bodyKeys,
    });
  });
  page.on("response", (response) => {
    if (!response.url().startsWith(origin)) return;
    const url = new URL(response.url());
    const item = requests
      .get(page)!
      .findLast(
        (entry) =>
          entry.path === url.pathname + url.search &&
          entry.method === response.request().method() &&
          entry.status === undefined,
      );
    if (item) item.status = response.status();
  });
});

test.afterEach(async ({ page }, info) => {
  await evidence(info.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase(), {
    requests: requests.get(page),
    runtimeErrors: errors.get(page),
  });
  expect(errors.get(page)).toEqual([]);
  expect(requests.get(page)!.some((request) => request.authorization)).toBe(false);
  expect(
    requests
      .get(page)!
      .some(
        (request) =>
          /\/storefront\/|\/platform\/|\/(pricing|inventory|variants|media|options|attributes|collections)(?:\/|\?|$)/.test(
            request.path,
          ) &&
          !(
            request.method === "GET" &&
            /^\/api\/v1\/stores\/[a-f0-9-]+\/catalog\/products\/[a-f0-9-]+\/(inventory|media)$/.test(
              request.path,
            )
          ),
      ),
  ).toBe(false);
  for (const request of writes(page)) {
    expect(request.csrf).toBe(true);
    expect(request.method).toMatch(/^(POST|PATCH)$/);
    expect(request.path).toMatch(
      /^\/api\/v1\/stores\/[a-f0-9-]+\/catalog\/products(?:\/[a-f0-9-]+(?:\/(?:publish|unpublish|archive))?)?$/,
    );
    expect(
      request.bodyKeys.filter((key) =>
        [
          "status",
          "published_at",
          "price",
          "quantity",
          "store_id",
          "tenant_id",
          "sku",
          "barcode",
          "media",
          "variants",
        ].includes(key),
      ),
    ).toEqual([]);
  }
});

function writes(page: Page, method?: string, endpoint?: string) {
  return requests
    .get(page)!
    .filter(
      (entry) =>
        entry.path.includes("/catalog/") &&
        entry.method !== "GET" &&
        entry.method !== "OPTIONS" &&
        (!method || entry.method === method) &&
        (!endpoint || entry.path === endpoint),
    );
}
function apiPath(store: Store, product?: string, transition?: string) {
  return `/api/v1/stores/${store.id}/catalog/products${product ? `/${product}` : ""}${transition ? `/${transition}` : ""}`;
}
function routePath(store: Store, product?: string, edit = false) {
  return `/stores/${store.id}/products${product ? `/${product}` : ""}${edit ? "/edit" : ""}`;
}
function mutationResponse(
  page: Page,
  store: Store,
  method: string,
  product?: string,
  transition?: string,
) {
  return page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === apiPath(store, product, transition) &&
      response.request().method() === method,
  );
}
async function login(page: Page, group: Group, destination?: string) {
  const fixture = fixtures[group];
  const target = destination ?? routePath(fixture.stores[0]);
  await page.goto(`/login?returnTo=${encodeURIComponent(target)}`);
  await page.getByRole("textbox", { name: "Email address", exact: true }).fill(fixture.email);
  await page.getByLabel(/^Password/).fill(fixture.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(target.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$"));
  await expect(page.getByRole("region", { name: "Current store", exact: true })).toHaveAttribute(
    "data-store-uuid",
    fixture.stores[0].id,
  );
}
async function fillCreate(page: Page, name: string, slug: string) {
  await page.getByRole("textbox", { name: "Product name", exact: true }).fill(name);
  await page.getByRole("textbox", { name: "Slug", exact: true }).fill(slug);
  await page
    .getByRole("textbox", { name: "Description", exact: true })
    .fill(
      "Synthetic description.\n<script>window.__f3bMarkup = true</script>\nLiteral <b>text</b>.",
    );
}
async function detail(page: Page, name: string) {
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
}
async function edit(page: Page, store: Store, product: Product) {
  await page.goto(routePath(store, product.id, true));
  await expect(page.getByRole("textbox", { name: "Product name", exact: true })).toHaveValue(
    product.name,
  );
}
async function save(page: Page, store: Store, product: Product) {
  const response = mutationResponse(page, store, "PATCH", product.id);
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  const result = await response;
  expect(result.status()).toBe(200);
  const body = await result.json();
  await detail(page, body.data.name);
  return { body, input: result.request().postDataJSON() };
}
async function archive(page: Page) {
  await page.getByRole("button", { name: "Archive product", exact: true }).click();
  const dialog = page.getByRole("alertdialog", { name: "Archive product", exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("There is currently no way to restore it.");
  await dialog.getByRole("button", { name: "Archive product", exact: true }).click();
}
function acceptUnsaved(page: Page) {
  page.once("dialog", async (dialog) => {
    expect(dialog.message()).toMatch(/unsaved product changes|product change is being sent/i);
    await dialog.accept();
  });
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
        ?.slice("XSRF-TOKEN=".length);
      const response = await fetch(url, {
        method,
        credentials: "include",
        headers: {
          Accept: "application/json",
          ...(method !== "GET"
            ? {
                "Content-Type": "application/json",
                "X-XSRF-TOKEN": decodeURIComponent(token ?? ""),
              }
            : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      return { status: response.status, body: await response.json() };
    },
    { url: origin + endpoint, method, body },
  );
}
function change(group: Group, permission: string) {
  const result = execFileSync(
    "wsl",
    [
      "-d",
      "Ubuntu",
      "--",
      "docker",
      "exec",
      "qafilah-f2-runtime-app-1",
      "qafilah-entrypoint",
      "php",
      "/tmp/f3b-fixtures.php",
      group,
      permission,
    ],
    { encoding: "utf8", timeout: 30_000, stdio: ["ignore", "pipe", "pipe"] },
  );
  expect(JSON.parse(result)).toEqual({ changed: permission, group });
}
async function refreshAccess(page: Page, store: Store) {
  const response = page.waitForResponse(`${origin}/api/v1/stores/${store.id}/context`);
  await page.getByRole("button", { name: "Refresh access", exact: true }).click();
  expect((await response).status()).toBe(200);
}
async function delayMutation(page: Page, endpoint: string, method: string) {
  let release!: () => void;
  let resolveCommitted!: (body: { data: Product }) => void;
  let resolveFinished!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const committed = new Promise<{ data: Product }>((resolve) => {
    resolveCommitted = resolve;
  });
  const finished = new Promise<void>((resolve) => {
    resolveFinished = resolve;
  });
  await page.route(origin + endpoint, async (route) => {
    if (route.request().method() !== method) return route.continue();
    try {
      const response = await route.fetch();
      expect(response.status()).toBeGreaterThanOrEqual(200);
      expect(response.status()).toBeLessThan(300);
      resolveCommitted(await response.json());
      await gate;
      await route.fulfill({ response }).catch(() => undefined);
    } finally {
      resolveFinished();
    }
  });
  return { release, committed, finished };
}

test("real simple creation assigns Categories and reconciles the previously cached list", async ({
  page,
}) => {
  const store = fixtures.create_simple.stores[0];
  await login(page, "create_simple");
  await expect(
    page.getByRole("link", { name: store.products.draft.name, exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Create product", exact: true }).click();
  await fillCreate(page, "Created Linen Product", "created-linen-product");
  await page.getByLabel("SEO title", { exact: true }).fill("Created SEO title");
  await page.getByLabel("SEO description", { exact: true }).fill("Created SEO description");
  await page.getByRole("checkbox", { name: store.categories[0].name, exact: true }).check();
  const response = mutationResponse(page, store, "POST");
  await page.getByRole("button", { name: "Create product", exact: true }).click();
  const result = await response;
  expect(result.status()).toBe(201);
  const created = await result.json();
  expect(created.data).toMatchObject({
    name: "Created Linen Product",
    status: "draft",
    type: "simple",
    published_at: null,
    requires_shipping: true,
    price: null,
    quantity: null,
  });
  expect(created.data.categories.map((category: Category) => category.id)).toEqual([
    store.categories[0].id,
  ]);
  await detail(page, created.data.name);
  await expect(page.locator("body")).toContainText("Literal <b>text</b>.");
  expect(await page.evaluate(() => "__f3bMarkup" in window)).toBe(false);
  await page.getByRole("link", { name: "Products", exact: true }).first().click();
  await expect(page.getByRole("link", { name: created.data.name, exact: true })).toBeVisible();
  expect(writes(page, "POST", apiPath(store))).toHaveLength(1);
});

test("real Variant-type creation is draft and does not invent Variant configuration", async ({
  page,
}) => {
  const store = fixtures.create_variant.stores[0];
  await login(page, "create_variant", `${routePath(store)}/new`);
  await fillCreate(page, "Created Variant Product", "created-variant-product");
  await page.getByLabel("Product type", { exact: true }).selectOption("variant");
  await page.getByLabel("Requires shipping", { exact: true }).uncheck();
  await expect(page.locator("body")).toContainText(
    /variant.*(?:outside|later|not available)|outside this phase/i,
  );
  const response = mutationResponse(page, store, "POST");
  await page.getByRole("button", { name: "Create product", exact: true }).click();
  const result = await response;
  expect(result.status()).toBe(201);
  const body = await result.json();
  expect(body.data).toMatchObject({
    type: "variant",
    status: "draft",
    requires_shipping: false,
    published_at: null,
    price: null,
    quantity: null,
  });
  await detail(page, body.data.name);
  await expect(
    page.getByRole("button", { name: /add variant|configure variants|add option/i }),
  ).toHaveCount(0);
});

test("real duplicate-slug422 maps a field error and invalid local input receives focus", async ({
  page,
}) => {
  const store = fixtures.validation.stores[0];
  await login(page, "validation", `${routePath(store)}/new`);
  await page.getByRole("textbox", { name: "Product name", exact: true }).fill("A");
  await page.getByRole("button", { name: "Create product", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Product name", exact: true })).toBeFocused();
  expect(writes(page)).toHaveLength(0);
  await fillCreate(page, "Duplicate Slug Attempt", store.products.draft.slug);
  const response = mutationResponse(page, store, "POST");
  await page.getByRole("button", { name: "Create product", exact: true }).click();
  expect((await response).status()).toBe(422);
  await expect(page.getByRole("textbox", { name: "Slug", exact: true })).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  await expect(page.getByRole("textbox", { name: "Slug", exact: true })).toBeFocused();
  await expect(page.getByRole("textbox", { name: "Product name", exact: true })).toHaveValue(
    "Duplicate Slug Attempt",
  );
  await expect(page.locator("body")).not.toContainText(/SQLSTATE|Stack trace|vendor\//);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test("real edit sends changed fields only and clears nullable SEO without type conversion", async ({
  page,
}) => {
  const store = fixtures.edit.stores[0];
  const product = store.products.draft;
  await login(page, "edit", routePath(store, product.id, true));
  await expect(page.getByLabel("Product type", { exact: true })).toHaveCount(0);
  await page
    .getByRole("textbox", { name: "Product name", exact: true })
    .fill("Updated Product Name");
  const updated = await save(page, store, product);
  expect(updated.input).toEqual({ name: "Updated Product Name" });
  expect(updated.body.data).toMatchObject({
    type: "simple",
    seo_title: "Original SEO title",
    seo_description: "Original SEO description",
  });
  await edit(page, store, { ...product, name: "Updated Product Name" });
  await page.getByLabel("SEO title", { exact: true }).fill("");
  await page.getByLabel("SEO description", { exact: true }).fill("");
  await page.getByLabel("Requires shipping", { exact: true }).uncheck();
  const cleared = await save(page, store, product);
  expect(cleared.input).toEqual({
    seo_title: null,
    seo_description: null,
    requires_shipping: false,
  });
  expect(cleared.body.data).toMatchObject({
    name: "Updated Product Name",
    seo_title: null,
    seo_description: null,
    requires_shipping: false,
  });
  await page.goto(routePath(store));
  await expect(page.getByRole("link", { name: "Updated Product Name", exact: true })).toBeVisible();
});

test("real Category update replaces and removes the whole assignment set", async ({ page }) => {
  const store = fixtures.categories.stores[0];
  const product = store.products.draft;
  await login(page, "categories", routePath(store, product.id, true));
  await page.getByRole("checkbox", { name: store.categories[0].name, exact: true }).uncheck();
  await page.getByRole("checkbox", { name: store.categories[1].name, exact: true }).check();
  const replaced = await save(page, store, product);
  expect(replaced.input).toEqual({ category_ids: [store.categories[1].id] });
  expect(replaced.body.data.categories.map((category: Category) => category.id)).toEqual([
    store.categories[1].id,
  ]);
  await edit(page, store, product);
  await page.getByRole("checkbox", { name: store.categories[1].name, exact: true }).uncheck();
  const removed = await save(page, store, product);
  expect(removed.input).toEqual({ category_ids: [] });
  expect(removed.body.data.categories).toEqual([]);
});

test("real publish unpublish archive use dedicated actions and invalid repeated transitions422", async ({
  page,
}) => {
  const store = fixtures.lifecycle.stores[0];
  const product = store.products.draft;
  await login(page, "lifecycle", routePath(store, product.id));
  await detail(page, product.name);
  expect((await direct(page, apiPath(store, product.id, "unpublish"), "POST")).status).toBe(422);
  const publish = mutationResponse(page, store, "POST", product.id, "publish");
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  expect((await (await publish).json()).data.status).toBe("published");
  await page.getByRole("button", { name: "Review product actions", exact: true }).click();
  await expect(page.getByRole("button", { name: "Unpublish", exact: true })).toBeVisible();
  expect((await direct(page, apiPath(store, product.id, "publish"), "POST")).status).toBe(422);
  const unpublish = mutationResponse(page, store, "POST", product.id, "unpublish");
  await page.getByRole("button", { name: "Unpublish", exact: true }).click();
  expect((await (await unpublish).json()).data).toMatchObject({
    status: "draft",
    published_at: null,
  });
  const archived = mutationResponse(page, store, "POST", product.id, "archive");
  await page.getByRole("button", { name: "Review product actions", exact: true }).click();
  await archive(page);
  expect((await (await archived).json()).data.status).toBe("archived");
  await expect(page.locator("body")).toContainText(/archived/i);
  await expect(
    page.getByRole("button", { name: /^(Publish|Unpublish|Archive product|Restore|Delete)$/ }),
  ).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Edit", exact: true })).toHaveCount(0);
  expect((await direct(page, apiPath(store, product.id, "archive"), "POST")).status).toBe(422);
  await page.goto(routePath(store, product.id, true));
  await expect(page.getByRole("textbox", { name: "Product name", exact: true })).toHaveCount(0);
  await expect(page.locator("body")).toContainText(/archived/i);
});

test("real missing mutation grants hide actions despite an Owner Administrator label and backend403wins", async ({
  page,
}) => {
  const store = fixtures.denied.stores[0];
  const product = store.products.draft;
  await login(page, "denied", routePath(store, product.id));
  await detail(page, product.name);
  await expect(page.getByRole("link", { name: /^(Create product|Edit)$/ })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: /^(Publish|Unpublish|Archive product)$/ }),
  ).toHaveCount(0);
  for (const [endpoint, method, body] of [
    [apiPath(store), "POST", { name: "Denied", slug: "denied-product", description: "Denied" }],
    [apiPath(store, product.id), "PATCH", { name: "Denied" }],
    [apiPath(store, product.id, "publish"), "POST", undefined],
    [apiPath(store, product.id, "archive"), "POST", undefined],
  ] as const) {
    expect((await direct(page, endpoint, method, body)).status).toBe(403);
  }
  await page.goto(`${routePath(store)}/new`);
  await expect(page.getByRole("textbox", { name: "Product name", exact: true })).toHaveCount(0);
  await expect(page.locator("body")).toContainText(/access|permission/i);
});

for (const capability of ["create", "update", "publish"] as const) {
  test(`real same-session products.${capability} removal hides its actions and direct writes return403`, async ({
    page,
  }) => {
    const group = `revocation_${capability}` as Group;
    const store = fixtures[group].stores[0];
    const product = store.products.draft;
    await login(
      page,
      group,
      capability === "create" ? routePath(store) : routePath(store, product.id),
    );
    const action =
      capability === "publish"
        ? page.getByRole("button", { name: "Publish", exact: true })
        : page.getByRole("link", {
            name: capability === "create" ? "Create product" : "Edit",
            exact: true,
          });
    await expect(action).toBeVisible();
    change(group, `products.${capability}`);
    await refreshAccess(page, store);
    await expect(action).toHaveCount(0);
    if (capability === "update")
      await expect(page.getByRole("button", { name: "Archive product", exact: true })).toHaveCount(
        0,
      );
    const denied =
      capability === "create"
        ? await direct(page, apiPath(store), "POST", {
            name: "Revoked",
            slug: "revoked-create",
            description: "Revoked",
          })
        : capability === "update"
          ? await direct(page, apiPath(store, product.id), "PATCH", { name: "Revoked update" })
          : await direct(page, apiPath(store, product.id, "publish"), "POST");
    expect(denied.status).toBe(403);
    await expect(page).not.toHaveURL(/\/login/);
  });
}

test("real foreign Category and Product mutations are rejected without foreign data leakage", async ({
  page,
}) => {
  const store = fixtures.foreign.stores[0];
  await login(page, "foreign");
  const foreign = fixtures.foreignResource;
  const category = await direct(page, apiPath(store), "POST", {
    name: "Foreign category attempt",
    slug: "foreign-category-attempt",
    description: "Synthetic",
    category_ids: [foreign.category.id],
  });
  expect(category.status).toBe(422);
  expect(category.body.errors).toHaveProperty("category_ids");
  const attempts = [
    await direct(page, apiPath(store, store.products.draft.id), "PATCH", {
      category_ids: [foreign.category.id],
    }),
    await direct(page, apiPath(store, foreign.product.id), "PATCH", {
      name: "Foreign update attempt",
    }),
  ];
  expect(attempts[0].status).toBe(422);
  expect(attempts[1].status).toBe(404);
  for (const transition of ["publish", "unpublish", "archive"])
    attempts.push(await direct(page, apiPath(store, foreign.product.id, transition), "POST"));
  for (const attempt of attempts.slice(1)) expect(attempt.status).toBe(404);
  for (const attempt of [category, ...attempts]) {
    const serialized = JSON.stringify(attempt.body);
    for (const canary of [foreign.store.name, foreign.product.name, foreign.category.name])
      expect(serialized).not.toContain(canary);
    expect(attempt.body.data).toBeNull();
  }
  await page.goto(routePath(store, foreign.product.id, true));
  await expect(page.locator("body")).toContainText(/product not found|product is unavailable/i);
  await expect(page.locator("body")).not.toContainText(foreign.product.name);
  await expect(page.getByRole("textbox", { name: "Product name", exact: true })).toHaveCount(0);
});

test("real StoreA mutation commits but its delayed response cannot contaminate StoreB", async ({
  page,
}) => {
  const [a, b] = fixtures.switch.stores;
  const product = a.products.draft;
  await login(page, "switch", routePath(a, product.id, true));
  await page
    .getByRole("textbox", { name: "Product name", exact: true })
    .fill("Store A Late Mutation Canary");
  const delayed = await delayMutation(page, apiPath(a, product.id), "PATCH");
  try {
    await page.getByRole("button", { name: "Save changes", exact: true }).click();
    expect((await delayed.committed).data.name).toBe("Store A Late Mutation Canary");
    await page.evaluate(
      ({ storeId, canaries }) => {
        const leaks: string[] = [];
        Object.assign(window, { __f3bLeaks: leaks });
        new MutationObserver(() => {
          if (
            location.pathname.includes(storeId) &&
            canaries.some((text) => document.body.innerText.includes(text))
          )
            leaks.push("Store A mutation data appeared under B");
        }).observe(document.body, { childList: true, subtree: true, characterData: true });
      },
      { storeId: b.id, canaries: [product.name, "Store A Late Mutation Canary"] },
    );
    await page.getByRole("button", { name: "Switch store", exact: true }).click();
    acceptUnsaved(page);
    await page.getByRole("button", { name: `Open ${b.name}`, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${routePath(b)}$`));
    delayed.release();
    await delayed.finished;
    await expect(
      page.getByRole("link", { name: b.products.draft.name, exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(() => (window as unknown as { __f3bLeaks: string[] }).__f3bLeaks),
    ).toEqual([]);
    await expect(page.locator("body")).not.toContainText("Store A Late Mutation Canary");
    expect(writes(page, "PATCH", apiPath(a, product.id))).toHaveLength(1);
    expect((await direct(page, apiPath(a, product.id))).body.data.name).toBe(
      "Store A Late Mutation Canary",
    );
    expect((await direct(page, apiPath(b, b.products.draft.id))).body.data.name).toBe(
      b.products.draft.name,
    );
  } finally {
    delayed.release();
  }
});

for (const mode of ["logout", "identity"] as const) {
  test(`real delayed mutation after ${mode} cannot restore private Product state`, async ({
    page,
  }) => {
    const store = fixtures[mode].stores[0];
    const product = store.products.draft;
    await login(page, mode, routePath(store, product.id, true));
    await page
      .getByRole("textbox", { name: "Product name", exact: true })
      .fill(`${mode} late response canary`);
    const delayed = await delayMutation(page, apiPath(store, product.id), "PATCH");
    try {
      await page.getByRole("button", { name: "Save changes", exact: true }).click();
      await delayed.committed;
      if (mode === "logout") {
        await page.getByRole("button", { name: "Account menu", exact: true }).click();
        await page.getByRole("menuitem", { name: "Sign out", exact: true }).click();
      } else {
        change("identity", "identity");
        const response = page.waitForResponse(`${origin}/api/v1/me`);
        await page.evaluate(() => window.dispatchEvent(new Event("focus")));
        expect((await response).status()).toBe(401);
      }
      await expect(page).toHaveURL(/\/login/);
      delayed.release();
      await delayed.finished;
      await expect(page.getByRole("region", { name: "Current store" })).toHaveCount(0);
      await expect(page.locator("body")).not.toContainText(`${mode} late response canary`);
      expect(writes(page, "PATCH", apiPath(store, product.id))).toHaveLength(1);
    } finally {
      delayed.release();
    }
  });
}

test("real committed create with lost response has unknown outcome and no automatic replay", async ({
  page,
}) => {
  const store = fixtures.unknown_create.stores[0];
  await login(page, "unknown_create", `${routePath(store)}/new`);
  await fillCreate(page, "Created Despite Lost Response", "created-despite-lost-response");
  await page.route(origin + apiPath(store), async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    const response = await route.fetch();
    expect(response.status()).toBe(201);
    await route.abort("failed");
  });
  await page.getByRole("button", { name: "Create product", exact: true }).click();
  await expect(page.locator("body")).toContainText(
    /couldn.t confirm|could not confirm|outcome.*unknown/i,
  );
  await expect(page.getByRole("button", { name: "Create product", exact: true })).toBeDisabled();
  expect(writes(page, "POST", apiPath(store))).toHaveLength(1);
  await page.unroute(origin + apiPath(store));
  acceptUnsaved(page);
  await page.getByRole("button", { name: "Review products", exact: true }).click();
  await expect(
    page.getByRole("link", { name: "Created Despite Lost Response", exact: true }),
  ).toBeVisible();
  expect(writes(page, "POST", apiPath(store))).toHaveLength(1);
});

test("real committed edit with lost response reconciles by read without replaying stale edits", async ({
  page,
}) => {
  const store = fixtures.unknown_update.stores[0];
  const product = store.products.draft;
  await login(page, "unknown_update", routePath(store, product.id, true));
  await page
    .getByRole("textbox", { name: "Product name", exact: true })
    .fill("Updated Despite Lost Response");
  await page.route(origin + apiPath(store, product.id), async (route) => {
    if (route.request().method() !== "PATCH") return route.continue();
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    await route.abort("failed");
  });
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.locator("body")).toContainText(
    /couldn.t confirm|could not confirm|outcome.*unknown/i,
  );
  await expect(page.getByRole("button", { name: "Save changes", exact: true })).toBeDisabled();
  expect(writes(page, "PATCH", apiPath(store, product.id))).toHaveLength(1);
  await page.unroute(origin + apiPath(store, product.id));
  await page.getByRole("button", { name: "Refresh product", exact: true }).click();
  await expect(page.locator("body")).toContainText("Updated Despite Lost Response");
  expect(writes(page, "PATCH", apiPath(store, product.id))).toHaveLength(1);
});

test("real committed publish unpublish archive with ambiguous503 never replay and reconcile status", async ({
  page,
}) => {
  const store = fixtures.unknown_lifecycle.stores[0];
  const product = store.products.draft;
  await login(page, "unknown_lifecycle", routePath(store, product.id));
  await detail(page, product.name);
  for (const [operation, label, status] of [
    ["publish", "Publish", "published"],
    ["unpublish", "Unpublish", "draft"],
    ["archive", "Archive product", "archived"],
  ] as const) {
    const endpoint = apiPath(store, product.id, operation);
    await page.route(origin + endpoint, async (route) => {
      const committed = await route.fetch();
      expect(committed.status()).toBe(200);
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        headers: {
          "Access-Control-Allow-Origin": "http://localhost:3000",
          "Access-Control-Allow-Credentials": "true",
        },
        body: JSON.stringify({
          success: false,
          data: null,
          meta: { request_id: "8b04d259-6f1a-4ff7-b665-e54fc28b8cd8" },
          message: "SQLSTATE private internals",
          errors: {},
        }),
      });
    });
    if (operation === "archive") await archive(page);
    else await page.getByRole("button", { name: label, exact: true }).click();
    await expect(page.locator("body")).toContainText(
      /couldn.t confirm|could not confirm|outcome.*unknown/i,
    );
    await expect(page.locator("body")).not.toContainText("SQLSTATE");
    expect(writes(page, "POST", endpoint)).toHaveLength(1);
    await page.unroute(origin + endpoint);
    await page.getByRole("button", { name: "Refresh product", exact: true }).last().click();
    await expect(page.locator("body")).not.toContainText(
      /couldn.t confirm|could not confirm|outcome.*unknown/i,
    );
    expect((await direct(page, apiPath(store, product.id))).body.data.status).toBe(status);
    expect(writes(page, "POST", endpoint)).toHaveLength(1);
  }
});

for (const mode of ["create", "update"] as const) {
  test(`real rapid double ${mode} click dispatches exactly one mutation while pending`, async ({
    page,
  }) => {
    const group = `double_${mode}` as Group;
    const store = fixtures[group].stores[0];
    const product = store.products.draft;
    await login(
      page,
      group,
      mode === "create" ? `${routePath(store)}/new` : routePath(store, product.id, true),
    );
    if (mode === "create")
      await fillCreate(page, "Single Double-click Create", "single-double-click-create");
    else
      await page
        .getByRole("textbox", { name: "Product name", exact: true })
        .fill("Single Double-click Update");
    const endpoint = apiPath(store, mode === "create" ? undefined : product.id);
    const method = mode === "create" ? "POST" : "PATCH";
    const delayed = await delayMutation(page, endpoint, method);
    try {
      await page
        .getByRole("button", {
          name: mode === "create" ? "Create product" : "Save changes",
          exact: true,
        })
        .evaluate((button) => {
          (button as HTMLButtonElement).click();
          (button as HTMLButtonElement).click();
        });
      const committed = await delayed.committed;
      expect(writes(page, method, endpoint)).toHaveLength(1);
      await expect(page.getByRole("button", { name: /creating|saving/i })).toBeDisabled();
      delayed.release();
      await delayed.finished;
      await detail(page, committed.data.name);
      expect(writes(page, method, endpoint)).toHaveLength(1);
    } finally {
      delayed.release();
    }
  });
}

test("real forms remain usable without categories.view and preserve existing assignments", async ({
  page,
}) => {
  const store = fixtures.no_categories.stores[0];
  const product = store.products.draft;
  await login(page, "no_categories", routePath(store, product.id, true));
  await expect(
    page.getByRole("checkbox", { name: store.categories[0].name, exact: true }),
  ).toHaveCount(0);
  expect(requests.get(page)!.some((request) => request.path.includes("/catalog/categories"))).toBe(
    false,
  );
  await page
    .getByRole("textbox", { name: "Product name", exact: true })
    .fill("Updated Without Category Lookup");
  const result = await save(page, store, product);
  expect(result.input).toEqual({ name: "Updated Without Category Lookup" });
  expect(result.body.data.categories.map((category: Category) => category.id)).toEqual([
    store.categories[0].id,
  ]);
});

test("real unsaved edits protect Store switching without accidental submit", async ({ page }) => {
  const [a, b] = fixtures.unsaved.stores;
  await login(page, "unsaved", routePath(a, a.products.draft.id, true));
  await page.getByRole("textbox", { name: "Product name", exact: true }).fill("Unsubmitted Canary");
  await page.getByRole("button", { name: "Switch store", exact: true }).click();
  page.once("dialog", async (dialog) => {
    expect(dialog.message()).toBe("You have unsaved product changes. Leave without saving?");
    await dialog.dismiss();
  });
  await page.getByRole("button", { name: `Open ${b.name}`, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`${routePath(a, a.products.draft.id, true)}$`));
  await page.keyboard.press("Escape");
  await expect(page.getByRole("textbox", { name: "Product name", exact: true })).toHaveValue(
    "Unsubmitted Canary",
  );
  if (!(await page.getByRole("button", { name: `Open ${b.name}`, exact: true }).isVisible()))
    await page.getByRole("button", { name: "Switch store", exact: true }).click();
  acceptUnsaved(page);
  await page.getByRole("button", { name: `Open ${b.name}`, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`${routePath(b)}$`));
  await expect(page.locator("body")).not.toContainText("Unsubmitted Canary");
  expect(writes(page)).toHaveLength(0);
});

test("real create-only access creates a draft without Product or Category reads", async ({
  page,
}) => {
  const store = fixtures.create_only.stores[0];
  await login(page, "create_only", `${routePath(store)}/new`);
  await fillCreate(page, "Create Only Draft", "create-only-draft");
  const response = mutationResponse(page, store, "POST");
  await page.getByRole("button", { name: "Create product", exact: true }).click();
  expect((await response).status()).toBe(201);
  await expect(page.getByRole("heading", { name: "Product created", exact: true })).toBeVisible();
  await expect(page.locator("body")).toContainText("Create Only Draft was saved as a draft.");
  expect(
    requests
      .get(page)!
      .filter((entry) => entry.method === "GET" && entry.path.includes("/catalog/")),
  ).toEqual([]);
  await page.getByRole("button", { name: "Create another product", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Product name", exact: true })).toHaveValue("");
  expect(writes(page)).toHaveLength(1);
});

test("real create edit and archive confirmation are accessible at five widths with keyboard focus", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const store = fixtures.responsive.stores[0];
  await mkdir(path.resolve("artifacts/f3b/screenshots"), { recursive: true });
  await login(page, "responsive", `${routePath(store)}/new`);
  const scans = [];
  for (const surface of ["create", "edit", "archive"] as const) {
    if (surface === "edit") await edit(page, store, store.products.draft);
    if (surface === "archive") {
      await page.goto(routePath(store, store.products.draft.id));
      await detail(page, store.products.draft.name);
      await page.getByRole("button", { name: "Archive product", exact: true }).click();
      await expect(
        page.getByRole("alertdialog", { name: "Archive product", exact: true }),
      ).toBeVisible();
    }
    for (const width of [1440, 1280, 1024, 768, 390]) {
      await page.setViewportSize({ width, height: 900 });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
        ),
      ).toBe(false);
      if (surface !== "archive") {
        await page.getByRole("textbox", { name: "Product name", exact: true }).focus();
        await page.keyboard.press("Tab");
        await expect(page.getByRole("textbox", { name: "Slug", exact: true })).toBeFocused();
      } else {
        const dialog = page.getByRole("alertdialog", { name: "Archive product", exact: true });
        expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(
          true,
        );
        await page.keyboard.press("Tab");
        expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(
          true,
        );
      }
      const visibleFocus = await page.evaluate(() => {
        const style = getComputedStyle(document.activeElement!);
        return style.outlineStyle !== "none" || style.boxShadow !== "none";
      });
      expect(visibleFocus).toBe(true);
      if (width === 390 && surface !== "archive") {
        expect(
          await page
            .getByRole("textbox", { name: "Product name", exact: true })
            .evaluate((element) => parseFloat(getComputedStyle(element).fontSize)),
        ).toBeGreaterThanOrEqual(16);
      }
      const result = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
        .analyze();
      expect(result.violations).toEqual([]);
      scans.push({
        surface,
        width,
        violations: result.violations,
        passes: result.passes.length,
        visibleFocus,
      });
      await page.screenshot({
        path: path.resolve(`artifacts/f3b/screenshots/${surface}-${width}.png`),
        fullPage: true,
      });
      if (width === 1440 || width === 390)
        await page.screenshot({
          path: path.resolve(`artifacts/f3b/screenshots/${surface}-viewport-${width}.png`),
        });
    }
  }
  await page.keyboard.press("Escape");
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  expect(writes(page)).toHaveLength(0);
  await evidence("accessibility-responsive", scans);
});
