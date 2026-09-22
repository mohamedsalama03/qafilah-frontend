import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

type Option = { id: string; name: string; values: { id: string; value: string }[] };
type Product = { id: string; name: string; options: Option[]; variants: string[] };
type Store = {
  id: string;
  name: string;
  products: Record<"empty" | "configured" | "other" | "simple" | "archived", Product>;
};
type Fixture = { email: string; password: string; stores: Store[] };
type Traffic = {
  method: string;
  path: string;
  body?: unknown;
  status?: number;
  csrf: boolean;
  bearer: boolean;
};
const fixtures = JSON.parse(
  readFileSync(path.resolve("artifacts/f3d/runtime/variant-fixtures.json"), "utf8"),
) as Record<string, Fixture>;
const origin = "http://localhost:3842";
const traffic = new WeakMap<Page, Traffic[]>();
const errors = new WeakMap<Page, string[]>();
const details = new WeakMap<Page, unknown>();
const api = (store: Store, product = store.products.empty) =>
  `/api/v1/stores/${store.id}/catalog/products/${product.id}`;
const route = (store: Store, product = store.products.empty) =>
  `/stores/${store.id}/products/${product.id}/variants`;
const writes = (page: Page) =>
  traffic
    .get(page)!
    .filter((r) => /^(POST|PATCH)$/.test(r.method) && /\/(options|variants)(\/|$)/.test(r.path));
const options = (page: Page) => page.getByRole("region", { name: "Options", exact: true });
const variants = (page: Page) => page.getByRole("region", { name: "Variants", exact: true });
const form = (page: Page, name: string) => page.getByRole("form", { name, exact: true });

test.beforeEach(async ({ page }) => {
  traffic.set(page, []);
  errors.set(page, []);
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  page.on("pageerror", (e) => errors.get(page)!.push(e.message));
  page.on("request", (r) => {
    if (!r.url().startsWith(origin)) return;
    traffic.get(page)!.push({
      method: r.method(),
      path: new URL(r.url()).pathname,
      ...(r.url().includes("/catalog/") && r.postData() ? { body: r.postDataJSON() } : {}),
      csrf: !!r.headers()["x-xsrf-token"],
      bearer: !!r.headers().authorization,
    });
  });
  page.on("response", (r) => {
    const entry = traffic
      .get(page)!
      .findLast(
        (e) =>
          e.path === new URL(r.url()).pathname &&
          e.method === r.request().method() &&
          e.status === undefined,
      );
    if (entry) entry.status = r.status();
  });
});
test.afterEach(async ({ page }, info) => {
  await mkdir(path.resolve("artifacts/f3d/browser"), { recursive: true });
  await writeFile(
    path.resolve(
      `artifacts/f3d/browser/${info.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.json`,
    ),
    JSON.stringify(
      { requests: traffic.get(page), details: details.get(page), runtimeErrors: errors.get(page) },
      null,
      2,
    ),
  );
  expect(errors.get(page)).toEqual([]);
  expect(
    traffic
      .get(page)!
      .some(
        (r) =>
          r.bearer ||
          /\/(pricing|media)(\/|$)/.test(r.path) ||
          (/\/inventory(\/|$)/.test(r.path) &&
            !(r.method === "GET" && /\/products\/[^/]+\/variants\/[^/]+\/inventory$/.test(r.path))),
      ),
  ).toBe(false);
  for (const entry of writes(page)) {
    expect(entry.csrf).toBe(true);
    expect(entry.path).toMatch(
      /\/catalog\/products\/[^/]+\/(options(?:\/[^/]+(?:\/values(?:\/[^/]+)?)?)?|variants(?:\/[^/]+)?)$/,
    );
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
async function prepare(page: Page, group: string, kind: keyof Store["products"] = "empty") {
  const store = fixtures[group].stores[0];
  await login(page, group, route(store, store.products[kind]));
  await expect(options(page)).toBeVisible();
  return store;
}
function response(page: Page, endpoint: string, method: string) {
  return page.waitForResponse(
    (r) => r.url() === origin + endpoint && r.request().method() === method,
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
          ...(method !== "GET"
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
function control(group: string, change: string) {
  return JSON.parse(
    execFileSync(
      "docker",
      [
        "exec",
        "qafilah-f2-runtime-app-1",
        "qafilah-entrypoint",
        "php",
        "/tmp/f3d-fixtures.php",
        group,
        change,
      ],
      { encoding: "utf8" },
    ),
  );
}
async function review(page: Page) {
  await page.getByRole("button", { name: "Review current configuration", exact: true }).click();
  await expect(
    page.getByText(
      "Current configuration reviewed. Review the values before starting a new change.",
      { exact: false },
    ),
  ).toBeVisible();
}
async function addOption(page: Page, store: Store, name: string) {
  await options(page).getByRole("button", { name: "Add option", exact: true }).click();
  await form(page, "Create option")
    .getByRole("textbox", { name: "Option name", exact: true })
    .fill(name);
  await form(page, "Create option")
    .getByRole("textbox", { name: "Position", exact: true })
    .fill("0");
  const received = response(page, api(store) + "/options", "POST");
  await form(page, "Create option")
    .getByRole("button", { name: "Create option", exact: true })
    .click();
  const result = await received;
  expect(result.status()).toBe(201);
  await expect(page.getByText("Changes saved.", { exact: true })).toBeVisible();
  return (await result.json()).data as Option;
}
async function capture(page: Page, surface: string, widths = [1440, 390]) {
  await mkdir(path.resolve("artifacts/f3d/screenshots"), { recursive: true });
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
      path: path.resolve(`artifacts/f3d/screenshots/${surface}-${width}.png`),
      fullPage: true,
    });
    scans.push({ width, violations: scan.violations });
  }
  await writeFile(
    path.resolve(`artifacts/f3d/screenshots/${surface}-axe.json`),
    JSON.stringify(scans, null, 2),
  );
  await page.setViewportSize({ width: 1440, height: 1100 });
}

test("real UI workflow uses all nine contracts and preserves parent Option on Value writes", async ({
  page,
}) => {
  const store = await prepare(page, "workflow");
  const base = api(store);
  await capture(page, "empty");
  const option = await addOption(page, store, " Size ");
  expect(option.name).toBe("Size");
  await review(page);
  const article = page.getByRole("article", { name: "Size", exact: true });
  await article.getByRole("button", { name: "Edit option", exact: true }).click();
  await form(page, "Edit option")
    .getByRole("textbox", { name: "Option name", exact: true })
    .fill("Sizing");
  await form(page, "Edit option").getByRole("textbox", { name: "Position", exact: true }).fill("4");
  const optionSaved = response(page, `${base}/options/${option.id}`, "PATCH");
  await form(page, "Edit option").getByRole("button", { name: "Save option", exact: true }).click();
  expect((await optionSaved).status()).toBe(200);
  expect((await optionSaved).request().postDataJSON()).toEqual({ name: "Sizing", position: 4 });
  await review(page);
  await page
    .getByRole("article", { name: "Sizing", exact: true })
    .getByRole("button", { name: "Add value", exact: true })
    .click();
  await form(page, "Create value").getByRole("textbox", { name: "Value", exact: true }).fill(" M ");
  await form(page, "Create value")
    .getByRole("textbox", { name: "Position", exact: true })
    .fill("2");
  const valueSaved = response(page, `${base}/options/${option.id}/values`, "POST");
  await form(page, "Create value")
    .getByRole("button", { name: "Create value", exact: true })
    .click();
  expect((await valueSaved).status()).toBe(201);
  const parent = (await (await valueSaved).json()).data as Option;
  expect(parent.id).toBe(option.id);
  expect(parent.name).toBe("Sizing");
  await review(page);
  await page
    .getByRole("article", { name: "Sizing", exact: true })
    .getByRole("button", { name: "Edit value", exact: true })
    .click();
  await form(page, "Edit value")
    .getByRole("textbox", { name: "Value", exact: true })
    .fill("Medium");
  await form(page, "Edit value").getByRole("textbox", { name: "Position", exact: true }).fill("8");
  const valueEdited = response(
    page,
    `${base}/options/${option.id}/values/${parent.values[0].id}`,
    "PATCH",
  );
  await form(page, "Edit value").getByRole("button", { name: "Save value", exact: true }).click();
  expect((await valueEdited).status()).toBe(200);
  expect((await valueEdited).request().postDataJSON()).toEqual({ value: "Medium", position: 8 });
  await review(page);
  await variants(page).getByRole("button", { name: "Create variant", exact: true }).click();
  await expect(options(page)).toContainText("Once a variant exists, no more options can be added.");
  await form(page, "Create variant")
    .getByRole("combobox", { name: "Sizing", exact: true })
    .selectOption(parent.values[0].id);
  await form(page, "Create variant")
    .getByRole("textbox", { name: "SKU", exact: true })
    .fill("WORKFLOW-SKU");
  const created = response(page, base + "/variants", "POST");
  await form(page, "Create variant")
    .getByRole("button", { name: "Create variant", exact: true })
    .click();
  expect((await created).status()).toBe(201);
  const variant = (await (await created).json()).data;
  expect(variant.status).toBe("active");
  expect(variant.quantity).toBeNull();
  expect(variant.price).toBeNull();
  await review(page);
  await variants(page).getByRole("link").first().click();
  await expect(
    page.getByRole("heading", { name: "Variant details", level: 1, exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Edit variant", exact: true }).click();
  await form(page, "Edit variant")
    .getByRole("textbox", { name: "SKU", exact: true })
    .fill("\uFEFF");
  await form(page, "Edit variant")
    .getByRole("button", { name: "Save variant", exact: true })
    .click();
  await expect(
    form(page, "Edit variant").getByRole("textbox", { name: "SKU", exact: true }),
  ).toHaveAttribute("aria-invalid", "true");
  expect(writes(page)).toHaveLength(5);
  await form(page, "Edit variant").getByRole("textbox", { name: "SKU", exact: true }).fill("");
  await form(page, "Edit variant")
    .getByRole("combobox", { name: "Status", exact: true })
    .selectOption("inactive");
  const updated = response(page, `${base}/variants/${variant.id}`, "PATCH");
  await form(page, "Edit variant")
    .getByRole("button", { name: "Save variant", exact: true })
    .click();
  expect((await updated).status()).toBe(200);
  expect((await updated).request().postDataJSON()).toEqual({ sku: null, status: "inactive" });
  await review(page);
  await page.getByRole("button", { name: "Edit variant", exact: true }).click();
  await form(page, "Edit variant")
    .getByRole("combobox", { name: "Status", exact: true })
    .selectOption("active");
  const active = response(page, `${base}/variants/${variant.id}`, "PATCH");
  await form(page, "Edit variant")
    .getByRole("button", { name: "Save variant", exact: true })
    .click();
  expect((await active).status()).toBe(200);
  await capture(page, "variant-detail");
  expect(writes(page)).toHaveLength(7);
  for (const [method, suffix] of [
    ["GET", "/options"],
    ["POST", "/options"],
    ["PATCH", `/options/${option.id}`],
    ["POST", `/options/${option.id}/values`],
    ["PATCH", `/options/${option.id}/values/${parent.values[0].id}`],
    ["GET", "/variants"],
    ["POST", "/variants"],
    ["GET", `/variants/${variant.id}`],
    ["PATCH", `/variants/${variant.id}`],
  ])
    expect(
      traffic
        .get(page)!
        .some(
          (r) =>
            r.method === method && r.path === base + suffix && [200, 201].includes(r.status ?? 0),
        ),
    ).toBe(true);
});

for (const grants of ["none", "view", "create", "update", "view_create", "view_update"]) {
  test(`real independent structural permissions ${grants} ignore role labels and Product CRUD`, async ({
    page,
  }) => {
    const group = `permissions_${grants}`;
    const store = fixtures[group].stores[0];
    await login(page, group, route(store, store.products.configured));
    const base = api(store, store.products.configured);
    expect((await direct(page, base + "/options")).status).toBe(
      grants.includes("view") ? 200 : 403,
    );
    expect((await direct(page, base + "/variants")).status).toBe(
      grants.includes("view") ? 200 : 403,
    );
    expect(
      (await direct(page, api(store) + "/options", "POST", { name: "Independent", position: 0 }))
        .status,
    ).toBe(grants.includes("create") ? 201 : 403);
    expect(
      (
        await direct(page, `${base}/variants/${store.products.configured.variants[0]}`, "PATCH", {
          sku: "Updated",
        })
      ).status,
    ).toBe(grants.includes("update") ? 200 : 403);
    if (grants.includes("view")) {
      await expect(options(page)).toBeVisible();
      expect(
        await options(page).getByRole("button", { name: "Add value", exact: true }).count(),
      ).toBe(grants.includes("create") ? 1 : 0);
      expect(
        await options(page).getByRole("button", { name: "Edit option", exact: true }).count(),
      ).toBe(grants.includes("update") ? 1 : 0);
    } else await expect(options(page)).toHaveCount(0);
  });
}

test("real canonical normalization complete PATCH and no-op validation", async ({ page }) => {
  const store = await prepare(page, "validation");
  const base = api(store);
  const created = await direct(page, base + "/options", "POST", {
    name: " Ｓｉｚｅ ",
    position: 10000,
  });
  expect(created.status).toBe(201);
  expect(created.body.data.name).toBe("Size");
  const option = created.body.data.id;
  for (const body of [
    { name: "size", position: 0 },
    { name: "Line\nbreak", position: 0 },
    { name: "bad\u200Dlabel", position: 0 },
    { name: "x".repeat(81), position: 0 },
    { name: "Other", position: -1 },
    { name: "Other", position: 10001 },
    { name: "Other", position: 0, tenant_id: "foreign" },
  ])
    expect((await direct(page, base + "/options", "POST", body)).status).toBe(422);
  for (const body of [{ name: "Changed" }, { position: 3 }, { name: "Size", position: 10000 }])
    expect((await direct(page, `${base}/options/${option}`, "PATCH", body)).status).toBe(422);
  const value = await direct(page, `${base}/options/${option}/values`, "POST", {
    value: " Ｍ ",
    position: 0,
  });
  expect(value.status).toBe(201);
  expect(value.body.data.id).toBe(option);
  expect(value.body.data.values[0].value).toBe("M");
  const valueId = value.body.data.values[0].id;
  for (const body of [{ value: "M" }, { position: 2 }, { value: "M", position: 0 }])
    expect(
      (await direct(page, `${base}/options/${option}/values/${valueId}`, "PATCH", body)).status,
    ).toBe(422);
  expect(
    (await direct(page, `${base}/options/${option}/values`, "POST", { value: "ｍ", position: 1 }))
      .status,
  ).toBe(422);
});

test("real three Options twenty Values hundred Variants including inactive limits", async ({
  page,
}) => {
  const store = await prepare(page, "limits", "configured");
  const product = store.products.configured;
  const base = api(store, product);
  const read = await direct(page, base + "/variants");
  expect(read.body.data).toHaveLength(100);
  expect(read.body.data.filter((v: { status: string }) => v.status === "inactive")).toHaveLength(
    50,
  );
  expect(
    (await direct(page, base + "/options", "POST", { name: "Fourth", position: 4 })).status,
  ).toBe(422);
  expect(
    (
      await direct(page, `${base}/options/${product.options[0].id}/values`, "POST", {
        value: "Twenty one",
        position: 21,
      })
    ).status,
  ).toBe(422);
  expect(
    (
      await direct(page, base + "/variants", "POST", {
        value_ids: [
          product.options[0].values[0].id,
          product.options[1].values[5].id,
          product.options[2].values[0].id,
        ],
      })
    ).status,
  ).toBe(422);
  for (let n = 0; n < 3; n++)
    expect(
      (await direct(page, api(store) + "/options", "POST", { name: `Option ${n}`, position: n }))
        .status,
    ).toBe(201);
  expect(
    (await direct(page, api(store) + "/options", "POST", { name: "Option 4", position: 4 })).status,
  ).toBe(422);
  await capture(page, "limits");
});

test("real combinations require every Option stay unique immutable and lock only new Options", async ({
  page,
}) => {
  const store = await prepare(page, "combinations");
  const base = api(store);
  const a = (await direct(page, base + "/options", "POST", { name: "Size", position: 0 })).body
    .data;
  const b = (await direct(page, base + "/options", "POST", { name: "Color", position: 1 })).body
    .data;
  const av = (
    await direct(page, `${base}/options/${a.id}/values`, "POST", { value: "M", position: 0 })
  ).body.data.values[0].id;
  const bv = (
    await direct(page, `${base}/options/${b.id}/values`, "POST", { value: "Black", position: 0 })
  ).body.data.values[0].id;
  for (const ids of [[], [av], [av, av], [av, store.products.other.options[0].values[0].id]])
    expect((await direct(page, base + "/variants", "POST", { value_ids: ids })).status).toBe(422);
  const created = await direct(page, base + "/variants", "POST", {
    value_ids: [bv, av],
    sku: null,
  });
  expect(created.status).toBe(201);
  expect((await direct(page, base + "/variants", "POST", { value_ids: [av, bv] })).status).toBe(
    422,
  );
  expect(
    (
      await direct(page, `${base}/variants/${created.body.data.id}`, "PATCH", {
        value_ids: [av, bv],
      })
    ).status,
  ).toBe(422);
  expect(
    (await direct(page, base + "/options", "POST", { name: "Material", position: 2 })).status,
  ).toBe(422);
  expect(
    (await direct(page, `${base}/options/${a.id}`, "PATCH", { name: "Sizing", position: 4 }))
      .status,
  ).toBe(200);
  expect(
    (
      await direct(page, `${base}/options/${a.id}/values/${av}`, "PATCH", {
        value: "Medium",
        position: 4,
      })
    ).status,
  ).toBe(200);
  expect(
    (await direct(page, `${base}/options/${a.id}/values`, "POST", { value: "Large", position: 8 }))
      .status,
  ).toBe(201);
});

test("real Store SKU uniqueness is case-sensitive across Products allows null and clears", async ({
  page,
}) => {
  const store = await prepare(page, "sku", "configured");
  const a = store.products.configured;
  const b = store.products.other;
  const first = `${api(store, a)}/variants/${a.variants[0]}`;
  const second = `${api(store, b)}/variants/${b.variants[0]}`;
  expect((await direct(page, first, "PATCH", { sku: "Case-Sensitive" })).status).toBe(200);
  expect((await direct(page, second, "PATCH", { sku: "Case-Sensitive" })).status).toBe(422);
  expect((await direct(page, second, "PATCH", { sku: "case-sensitive" })).status).toBe(200);
  for (const target of [first, second])
    expect((await direct(page, target, "PATCH", { sku: null })).status).toBe(200);
  for (const target of [first, second])
    expect((await direct(page, target)).body.data.sku).toBeNull();
  for (const body of [
    { sku: "x".repeat(65) },
    { sku: "bad\u200Dsku" },
    { sku: "\uFEFF" },
    {},
    { status: "archived" },
    { sku: null },
  ])
    expect((await direct(page, first, "PATCH", body)).status).toBe(422);
});

test("real simple and archived boundaries reject all applicable structural writes", async ({
  page,
}) => {
  const store = fixtures.boundaries.stores[0];
  for (const kind of ["simple", "archived"] as const) {
    await login(page, "boundaries", route(store, store.products[kind]));
    const base = api(store, store.products[kind]);
    expect(
      (await direct(page, base + "/options", "POST", { name: "Forbidden", position: 0 })).status,
    ).toBe(422);
    expect(
      (
        await direct(page, base + "/variants", "POST", {
          value_ids: [store.products.configured.options[0].values[0].id],
        })
      ).status,
    ).toBe(422);
    if (kind === "archived") {
      const option = store.products.archived.options[0];
      expect(
        (
          await direct(page, `${base}/options/${option.id}`, "PATCH", {
            name: "Changed",
            position: 2,
          })
        ).status,
      ).toBe(422);
      expect(
        (
          await direct(page, `${base}/options/${option.id}/values`, "POST", {
            value: "New",
            position: 3,
          })
        ).status,
      ).toBe(422);
      expect(
        (
          await direct(
            page,
            `${base}/options/${option.id}/values/${option.values[0].id}`,
            "PATCH",
            { value: "Changed", position: 2 },
          )
        ).status,
      ).toBe(422);
      expect(
        (
          await direct(page, `${base}/variants/${store.products.archived.variants[0]}`, "PATCH", {
            status: "inactive",
          })
        ).status,
      ).toBe(422);
    }
    if (kind === "simple")
      await expect(page.getByRole("button", { name: "Add option", exact: true })).toHaveCount(0);
    else await expect(page.getByRole("button", { name: "Add option", exact: true })).toBeDisabled();
    await page.getByRole("button", { name: "Account menu", exact: true }).click();
    await page.getByRole("menuitem", { name: "Sign out", exact: true }).click();
    await expect(page).toHaveURL(/\/login/);
  }
});

test("real foreign Store and wrong-parent Product Option Value Variant paths fail closed", async ({
  page,
}) => {
  const store = await prepare(page, "foreign", "configured");
  const foreign = fixtures.foreign.stores[1];
  const a = store.products.configured;
  const b = store.products.other;
  const base = api(store, a);
  expect((await direct(page, api(store, foreign.products.configured) + "/variants")).status).toBe(
    404,
  );
  expect((await direct(page, `${base}/variants/${b.variants[0]}`)).status).toBe(404);
  expect(
    (await direct(page, `${base}/variants/${b.variants[0]}`, "PATCH", { sku: "Forbidden" })).status,
  ).toBe(404);
  expect(
    (
      await direct(page, `${base}/options/${b.options[0].id}`, "PATCH", {
        name: "Forbidden",
        position: 0,
      })
    ).status,
  ).toBe(404);
  expect(
    (
      await direct(page, `${base}/options/${b.options[0].id}/values`, "POST", {
        value: "Forbidden",
        position: 0,
      })
    ).status,
  ).toBe(404);
  expect(
    (
      await direct(
        page,
        `${base}/options/${a.options[0].id}/values/${b.options[0].values[0].id}`,
        "PATCH",
        { value: "Forbidden", position: 0 },
      )
    ).status,
  ).toBe(404);
  expect(
    (
      await direct(page, base + "/variants", "POST", {
        value_ids: [foreign.products.configured.options[0].values[0].id],
      })
    ).status,
  ).toBe(422);
});

for (const grant of ["view", "create", "update"] as const)
  test(`real ${grant} permission revocation removes structural authority`, async ({ page }) => {
    const group = `revoke_${grant}`;
    const store = await prepare(page, group, "configured");
    control(group, `products.variants.${grant}`);
    const refreshed = response(page, `/api/v1/stores/${store.id}/context`, "GET");
    await page.getByRole("button", { name: "Refresh access", exact: true }).click();
    expect((await refreshed).status()).toBe(200);
    if (grant === "view") {
      await expect(options(page)).toHaveCount(0);
      expect((await direct(page, api(store) + "/options")).status).toBe(403);
    } else {
      await expect(
        options(page).getByRole("button", {
          name: grant === "create" ? "Add value" : "Edit option",
          exact: true,
        }),
      ).toHaveCount(0);
      const target =
        grant === "create"
          ? api(store) + "/options"
          : `${api(store, store.products.configured)}/variants/${store.products.configured.variants[0]}`;
      expect(
        (
          await direct(
            page,
            target,
            grant === "create" ? "POST" : "PATCH",
            grant === "create" ? { name: "Revoked", position: 0 } : { sku: "Revoked" },
          )
        ).status,
      ).toBe(403);
    }
  });

async function uncertain(page: Page, group: string, committed: boolean) {
  const store = await prepare(page, group);
  const target = api(store) + "/options";
  await page.route(origin + target, async (request) => {
    if (request.request().method() !== "POST") return request.continue();
    if (committed) {
      const actual = await request.fetch();
      expect(actual.status()).toBe(201);
      details.set(page, { persistedBeforeResponseLoss: (await actual.json()).data });
    }
    await request.abort("failed");
  });
  await options(page).getByRole("button", { name: "Add option", exact: true }).click();
  await form(page, "Create option")
    .getByRole("textbox", { name: "Option name", exact: true })
    .fill("Committed size");
  await form(page, "Create option")
    .getByRole("textbox", { name: "Position", exact: true })
    .fill("0");
  await form(page, "Create option")
    .getByRole("button", { name: "Create option", exact: true })
    .click();
  await expect(
    page.getByText("The result of this change is unknown.", { exact: true }),
  ).toBeVisible();
  await page.unroute(origin + target);
  expect(writes(page)).toHaveLength(1);
  return store;
}
for (const committed of [true, false])
  test(`real ${committed ? "committed" : "uncommitted"} unknown Option outcome requires review without replay or causal inference`, async ({
    page,
  }) => {
    const store = await uncertain(page, committed ? "committed" : "uncommitted", committed);
    await capture(page, committed ? "unknown-committed" : "unknown-uncommitted");
    expect((await direct(page, api(store) + "/options")).body.data).toHaveLength(committed ? 1 : 0);
    await review(page);
    await expect(form(page, "Create option")).toHaveCount(0);
    expect(writes(page)).toHaveLength(1);
    await expect(page.locator("body")).not.toContainText("Changes saved.");
    await addOption(page, store, "Deliberate fresh option");
    expect(writes(page)).toHaveLength(2);
    expect((await direct(page, api(store) + "/options")).body.data).toHaveLength(committed ? 2 : 1);
  });
test("real failed review retains unknown lock until authoritative configuration succeeds", async ({
  page,
}) => {
  const store = await uncertain(page, "failed_review", false);
  const target = origin + api(store) + "/options";
  await page.route(target, (r) => r.abort("failed"));
  await page.getByRole("button", { name: "Review current configuration", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Review current configuration", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByText("The result of this change is unknown.", { exact: true }),
  ).toBeVisible();
  await expect(
    options(page).getByRole("button", { name: "Add option", exact: true }),
  ).toBeDisabled();
  expect(writes(page)).toHaveLength(1);
  await page.unroute(target);
  await review(page);
  expect(writes(page)).toHaveLength(1);
});
test("real partial configuration preserves confirmed Option when a later Value is rejected", async ({
  page,
}) => {
  const store = await prepare(page, "partial");
  const option = await addOption(page, store, "Size");
  await review(page);
  await page
    .getByRole("article", { name: "Size", exact: true })
    .getByRole("button", { name: "Add value", exact: true })
    .click();
  // A concurrent real request creates the same Value after the editor opened.
  expect(
    (
      await direct(page, `${api(store)}/options/${option.id}/values`, "POST", {
        value: "M",
        position: 0,
      })
    ).status,
  ).toBe(201);
  await form(page, "Create value").getByRole("textbox", { name: "Value", exact: true }).fill("M");
  await form(page, "Create value")
    .getByRole("textbox", { name: "Position", exact: true })
    .fill("0");
  const rejected = response(page, `${api(store)}/options/${option.id}/values`, "POST");
  await form(page, "Create value")
    .getByRole("textbox", { name: "Value", exact: true })
    .press("Enter");
  expect((await rejected).status()).toBe(422);
  await expect(
    form(page, "Create value").getByRole("textbox", { name: "Value", exact: true }),
  ).toHaveAttribute("aria-invalid", "true");
  await page.evaluate(async () => {
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
  });
  await expect(
    form(page, "Create value").getByRole("textbox", { name: "Value", exact: true }),
  ).toBeFocused();
  expect((await direct(page, api(store) + "/options")).body.data).toHaveLength(1);
  expect((await direct(page, api(store) + "/variants")).body.data).toHaveLength(0);
  await capture(page, "partial-422");
});

for (const delay of [0, 50, 120, 300, 450])
  test(`real response-boundary Option double-submit ${delay}ms consumes one slot`, async ({
    page,
  }) => {
    const store = await prepare(page, `double_${delay}`);
    const target = api(store) + "/options";
    await options(page).getByRole("button", { name: "Add option", exact: true }).click();
    await form(page, "Create option")
      .getByRole("textbox", { name: "Option name", exact: true })
      .fill("Once");
    await form(page, "Create option")
      .getByRole("textbox", { name: "Position", exact: true })
      .fill("0");
    await form(page, "Create option").evaluate((element, delay) => {
      (element as HTMLFormElement).requestSubmit();
      window.setTimeout(() => (element as HTMLFormElement).requestSubmit(), delay);
    }, delay);
    await expect(page.getByText("Changes saved.", { exact: true })).toBeVisible();
    await page.waitForTimeout(delay + 100);
    expect(writes(page)).toHaveLength(1);
    expect((await direct(page, target)).body.data).toHaveLength(1);
  });
test("real repeated Enter submits a structural operation only once", async ({ page }) => {
  const store = await prepare(page, "enter");
  await options(page).getByRole("button", { name: "Add option", exact: true }).click();
  await form(page, "Create option")
    .getByRole("textbox", { name: "Option name", exact: true })
    .fill("Keyboard once");
  await form(page, "Create option")
    .getByRole("textbox", { name: "Position", exact: true })
    .fill("0");
  await form(page, "Create option")
    .getByRole("textbox", { name: "Option name", exact: true })
    .press("Enter");
  await page.keyboard.press("Enter");
  await expect(page.getByText("Changes saved.", { exact: true })).toBeVisible();
  await page.keyboard.press("Enter");
  expect(writes(page)).toHaveLength(1);
  expect((await direct(page, api(store) + "/options")).body.data).toHaveLength(1);
});

async function hold(page: Page, endpoint: string, method: string) {
  let release!: () => void;
  let observed!: () => void;
  let finished!: () => void;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  const received = new Promise<void>((r) => {
    observed = r;
  });
  const done = new Promise<void>((r) => {
    finished = r;
  });
  await page.route(origin + endpoint, async (request) => {
    if (request.request().method() !== method) return request.continue();
    try {
      const actual = await request.fetch();
      expect(actual.status()).toBe(method === "GET" ? 200 : 201);
      observed();
      await gate;
      await request.fulfill({ response: actual }).catch(() => undefined);
    } finally {
      finished();
    }
  });
  return { release, received, done };
}

test("real Value write with a substituted foreign parent response stays unknown until review", async ({
  page,
}) => {
  const store = await prepare(page, "malformed", "configured");
  const product = store.products.configured;
  const parent = product.options[0];
  const target = `${api(store, product)}/options/${parent.id}/values`;
  const other = (await direct(page, `${api(store, store.products.other)}/options`)).body.data[0];
  await page.route(origin + target, async (request) => {
    const actual = await request.fetch();
    expect(actual.status()).toBe(201);
    const envelope = await actual.json();
    await request.fulfill({ response: actual, body: JSON.stringify({ ...envelope, data: other }) });
  });
  await page
    .getByRole("article", { name: "Size", exact: true })
    .getByRole("button", { name: "Add value", exact: true })
    .click();
  await form(page, "Create value")
    .getByRole("textbox", { name: "Value", exact: true })
    .fill("New authoritative value");
  await form(page, "Create value")
    .getByRole("textbox", { name: "Position", exact: true })
    .fill("8");
  await form(page, "Create value")
    .getByRole("button", { name: "Create value", exact: true })
    .click();
  await expect(
    page.getByText("The result of this change is unknown.", { exact: true }),
  ).toBeVisible();
  await page.unroute(origin + target);
  await review(page);
  await expect(options(page)).toContainText("New authoritative value");
  await expect(page.locator("body")).not.toContainText("Changes saved.");
  expect(writes(page)).toHaveLength(1);
});

test("real confirmed Option save retains success when secondary configuration refresh fails", async ({
  page,
}) => {
  const store = await prepare(page, "refresh_failure");
  const target = api(store) + "/options";
  await page.route(origin + target, async (request) => {
    if (request.request().method() === "GET") return request.abort("failed");
    return request.continue();
  });
  await addOption(page, store, "Persisted size");
  await expect(page.locator("body")).toContainText(
    "The change was saved, but the latest configuration could not be refreshed.",
  );
  await expect(page.getByText("Changes saved.", { exact: true })).toBeVisible();
  await expect(
    page.getByText("The result of this change is unknown.", { exact: true }),
  ).toHaveCount(0);
  await page.unroute(origin + target);
  await review(page);
  await expect(options(page)).toContainText("Persisted size");
  expect(writes(page)).toHaveLength(1);
});
for (const boundary of ["switch", "product", "principal"] as const)
  for (const method of ["GET", "POST"] as const)
    test(`real late ${method} cannot publish across ${boundary} boundary`, async ({ page }) => {
      const group = `${boundary}_${method === "GET" ? "get" : "write"}`;
      const store = fixtures[group].stores[0];
      const target = api(store) + "/options";
      const delayed = method === "GET" ? await hold(page, target, method) : undefined;
      await login(page, group);
      const operation = delayed ?? (await hold(page, target, method));
      try {
        if (method === "POST") {
          await options(page).getByRole("button", { name: "Add option", exact: true }).click();
          await form(page, "Create option")
            .getByRole("textbox", { name: "Option name", exact: true })
            .fill("Old principal option");
          await form(page, "Create option")
            .getByRole("textbox", { name: "Position", exact: true })
            .fill("0");
          await form(page, "Create option")
            .getByRole("button", { name: "Create option", exact: true })
            .click();
        }
        await operation.received;
        await page.evaluate(() => Object.assign(window, { __variantSameDocument: true }));
        let destination = store;
        let product = store.products.other;
        if (boundary === "switch") {
          destination = fixtures[group].stores[1];
          product = destination.products.configured;
          await page.getByRole("button", { name: "Switch store", exact: true }).click();
          await page.getByRole("button", { name: `Open ${destination.name}`, exact: true }).click();
        }
        if (boundary === "principal") {
          destination = fixtures.permissions_view.stores[0];
          product = destination.products.configured;
          await page.getByRole("button", { name: "Account menu", exact: true }).click();
          await page.getByRole("menuitem", { name: "Sign out", exact: true }).click();
          await expect(page).toHaveURL(/\/login/);
          await page
            .getByRole("textbox", { name: "Email address", exact: true })
            .fill(fixtures.permissions_view.email);
          await page.getByLabel(/^Password/).fill(fixtures.permissions_view.password);
          await page.getByRole("button", { name: "Sign in", exact: true }).click();
          await expect(page).toHaveURL(new RegExp(`/stores/${destination.id}$`));
        }
        await page.getByRole("link", { name: "Products", exact: true }).first().click();
        await page.getByRole("link", { name: product.name, exact: true }).click();
        await page.getByRole("link", { name: "Manage variants", exact: true }).click();
        await expect(options(page)).toContainText("Size");
        operation.release();
        await operation.done;
        await expect(options(page)).not.toContainText("Old principal option");
        await expect(page.locator("body")).not.toContainText(store.products.empty.name);
        await expect(page.locator("body")).not.toContainText("Changes saved.");
        expect(
          await page.evaluate(
            () => (window as unknown as { __variantSameDocument: boolean }).__variantSameDocument,
          ),
        ).toBe(true);
        expect(writes(page)).toHaveLength(method === "POST" ? 1 : 0);
      } finally {
        operation.release();
      }
    });
