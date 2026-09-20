import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

type Product = { id: string; name: string; slug: string; description: string; status: string };
type Fixture = {
  email: string;
  password: string;
  store: { id: string; name: string; products: { draft: Product; published: Product } };
};
type Write = { method: string; path: string; csrf: boolean; authorization: boolean };
const fixtures = JSON.parse(
  readFileSync(path.resolve("artifacts/f3b-l2/runtime/reconciliation-fixtures.json"), "utf8"),
) as Record<string, Fixture>;
const backend = "http://localhost:3842";
const loaded =
  "The latest product was loaded from the server. Review it before making another change.";
const blank = "A new blank product form is ready. No earlier request has been repeated.";
const unknown = "We couldn’t confirm whether the change was completed.";
const traffic = new WeakMap<Page, Write[]>();
const evidence = new WeakMap<Page, Record<string, unknown>>();
const runtimeErrors = new WeakMap<Page, string[]>();

function api(fixture: Fixture, item = true) {
  return `/api/v1/stores/${fixture.store.id}/catalog/products${item ? `/${fixture.store.products.draft.id}` : ""}`;
}
function route(fixture: Fixture, edit = true) {
  return `/stores/${fixture.store.id}/products${edit ? `/${fixture.store.products.draft.id}/edit` : "/new"}`;
}
function field(page: Page, name = "Product name") {
  return page.getByRole("textbox", { name, exact: true });
}
function guidance(page: Page, text = loaded) {
  return page.getByRole("status").filter({ hasText: text });
}
function writes(page: Page, method: string) {
  return traffic.get(page)!.filter((entry) => entry.method === method);
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  traffic.set(page, []);
  evidence.set(page, {});
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
      csrf: !!request.headers()["x-xsrf-token"],
      authorization: !!request.headers().authorization,
    });
  });
});

test.afterEach(async ({ page }, info) => {
  await mkdir(path.resolve("artifacts/f3b-l2/browser"), { recursive: true });
  await writeFile(
    path.resolve(
      `artifacts/f3b-l2/browser/${info.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.json`,
    ),
    JSON.stringify(
      {
        writes: traffic.get(page),
        evidence: evidence.get(page),
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

async function login(page: Page, group: string, edit = true) {
  const fixture = fixtures[group];
  const destination = route(fixture, edit);
  await page.goto(`/login?returnTo=${encodeURIComponent(destination)}`);
  await page.getByRole("textbox", { name: "Email address", exact: true }).fill(fixture.email);
  await page.getByLabel(/^Password/).fill(fixture.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(destination + "$"));
  await expect(field(page)).toBeVisible();
  return fixture;
}

async function read(page: Page, fixture: Fixture, action?: string) {
  const result = await page.evaluate(
    async ({ url, action }) => {
      const csrf = document.cookie
        .split("; ")
        .find((item) => item.startsWith("XSRF-TOKEN="))
        ?.split("=")
        .slice(1)
        .join("=");
      const response = await fetch(url, {
        credentials: "include",
        method: action ? "POST" : "GET",
        headers: {
          Accept: "application/json",
          ...(action && csrf ? { "X-XSRF-TOKEN": decodeURIComponent(csrf) } : {}),
        },
      });
      return { status: response.status, body: await response.json() };
    },
    { url: backend + api(fixture) + (action ? `/${action}` : ""), action },
  );
  expect(result.status).toBe(200);
  return result.body.data as Product;
}

async function makeUnknown(page: Page, fixture: Fixture, committed: boolean) {
  const before = fixture.store.products.draft.name;
  const typed = `${before} changed B`;
  await field(page).fill(typed);
  let dispatches = 0;
  let backendWriteStatus: number | null = null;
  await page.route(backend + api(fixture), async (request) => {
    if (request.request().method() !== "PATCH") return request.continue();
    dispatches++;
    if (committed) {
      const result = await request.fetch();
      backendWriteStatus = result.status();
      expect(backendWriteStatus).toBe(200);
      expect((await result.json()).data.name).toBe(typed);
    }
    await request.abort("failed");
  });
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: unknown })).toContainText(unknown);
  await expect(field(page)).toHaveValue(typed);
  await expect(page.getByRole("button", { name: "Save changes", exact: true })).toBeDisabled();
  expect(dispatches).toBe(1);
  expect(writes(page, "PATCH")).toHaveLength(1);
  await page.unroute(backend + api(fixture));
  const authoritative = await read(page, fixture);
  expect(authoritative.name).toBe(committed ? typed : before);
  evidence.set(page, {
    ...evidence.get(page),
    outcome: committed
      ? "Real PATCH 200 committed; delivery aborted"
      : "PATCH delivery aborted before backend dispatch; no route.fetch",
    backendWriteStatus,
    typedName: typed,
    authoritativeNameBeforeReconcile: authoritative.name,
  });
  return { before, typed, authoritative };
}

async function reconcile(page: Page, fixture: Fixture, expectedName: string) {
  const oldField = await field(page).elementHandle();
  const refresh = page.getByRole("button", { name: "Refresh product", exact: true });
  await refresh.focus();
  await expect(refresh).toBeFocused();
  const response = page.waitForResponse(
    (result) => result.url() === backend + api(fixture) && result.request().method() === "GET",
  );
  await page.keyboard.press("Enter");
  const explicitResponse = await response;
  expect(explicitResponse.status()).toBe(200);
  expect((await explicitResponse.json()).data.name).toBe(expectedName);
  await expect(field(page)).toHaveValue(expectedName);
  await expect(guidance(page)).toBeVisible();
  await expect(guidance(page)).toHaveAttribute("aria-live", "polite");
  await expect(guidance(page)).toHaveAttribute("aria-atomic", "true");
  expect(await oldField!.evaluate((element) => element.isConnected)).toBe(false);
  expect(await guidance(page).evaluate((element) => element === document.activeElement)).toBe(
    false,
  );
  await page.keyboard.press("Tab");
  expect(
    await page.evaluate(() => document.activeElement?.matches("a,button,input,textarea,select")),
  ).toBe(true);
  await expect(guidance(page)).toBeVisible();
  expect(writes(page, "PATCH")).toHaveLength(1);
  evidence.set(page, {
    ...evidence.get(page),
    explicitGetStatus: 200,
    authoritativeNameAfterReconcile: expectedName,
    originalFieldDetached: true,
    statusVisibleAfterRemount: true,
    polite: true,
    atomic: true,
    statusDidNotStealFocus: true,
    keyboardReachable: true,
  });
}

async function capture(page: Page, surface: string, text = loaded) {
  await mkdir(path.resolve("artifacts/f3b-l2/screenshots"), { recursive: true });
  const scans = [];
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1100 });
    await guidance(page, text).scrollIntoViewIfNeeded();
    await expect(guidance(page, text)).toBeVisible();
    const scan = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(scan.violations).toEqual([]);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflow).toBe(false);
    if (width === 390)
      expect(
        await field(page).evaluate((element) => parseFloat(getComputedStyle(element).fontSize)),
      ).toBeGreaterThanOrEqual(16);
    scans.push({ width, violations: scan.violations, overflow, guidanceVisible: true });
    await page.screenshot({
      path: path.resolve(`artifacts/f3b-l2/screenshots/${surface}-${width}.png`),
      fullPage: true,
    });
    await page.screenshot({
      path: path.resolve(`artifacts/f3b-l2/screenshots/${surface}-viewport-${width}.png`),
    });
  }
  await writeFile(
    path.resolve(`artifacts/f3b-l2/screenshots/${surface}-axe.json`),
    JSON.stringify(scans, null, 2),
  );
  await page.setViewportSize({ width: 1440, height: 1100 });
}

test("uncommitted uncertain update reconciles server A with guidance after remount and permits one deliberate save", async ({
  page,
}) => {
  const fixture = await login(page, "uncommitted");
  const result = await makeUnknown(page, fixture, false);
  await reconcile(page, fixture, result.before);
  await capture(page, "uncommitted-update-guidance");
  await field(page, "Description").focus();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.type("Deliberate description after reviewing server A.");
  await expect(guidance(page)).toBeVisible();
  const response = page.waitForResponse(
    (item) => item.url() === backend + api(fixture) && item.request().method() === "PATCH",
  );
  await page.getByRole("button", { name: "Save changes", exact: true }).focus();
  await page.keyboard.press("Enter");
  const saved = await response;
  expect(saved.status()).toBe(200);
  expect(saved.request().postDataJSON()).toEqual({
    description: "Deliberate description after reviewing server A.",
  });
  expect((await saved.json()).data.name).toBe(result.before);
  expect(writes(page, "PATCH")).toHaveLength(2);
  evidence.set(page, {
    ...evidence.get(page),
    laterDeliberatePatchStatus: 200,
    laterPatchCount: 1,
    staleNameNotReplayed: true,
  });
});

test("committed uncertain update reads proven server B and keeps guidance through a fresh form", async ({
  page,
}) => {
  const fixture = await login(page, "committed");
  const result = await makeUnknown(page, fixture, true);
  await reconcile(page, fixture, result.typed);
  await capture(page, "committed-update-guidance");
  expect((await read(page, fixture)).name).toBe(result.typed);
  expect(writes(page, "PATCH")).toHaveLength(1);
});

async function holdDetail(page: Page, fixture: Fixture) {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(
    (url) =>
      url.origin === "http://localhost:3000" &&
      new RegExp(`^/stores/${fixture.store.id}/products/[a-f0-9-]+$`).test(url.pathname),
    async (request) => {
      await gate;
      await request.continue().catch(() => undefined);
    },
  );
  return release;
}

test("known successful save remains confirmed after failed review and Start a new edit loads guidance", async ({
  page,
}) => {
  const fixture = await login(page, "known_review");
  const release = await holdDetail(page, fixture);
  try {
    const name = "Known saved authoritative product";
    await field(page).fill(name);
    await page.getByRole("button", { name: "Save changes", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Product saved", exact: true })).toBeVisible();
    await page.route(backend + api(fixture), async (request) => {
      if (request.request().method() === "GET") await request.abort("failed");
      else await request.continue();
    });
    await page.getByRole("button", { name: "Start a new edit", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Product saved", exact: true })).toBeVisible();
    await expect(page.getByRole("alert").filter({ hasText: "The change was saved" })).toContainText(
      "The change was saved, but the latest product could not be reviewed.",
    );
    await expect(page.getByText(unknown, { exact: true })).toHaveCount(0);
    await expect(field(page)).toHaveCount(0);
    expect(writes(page, "PATCH")).toHaveLength(1);
    await page.unroute(backend + api(fixture));
    await page.getByRole("button", { name: "Start a new edit", exact: true }).focus();
    await page.keyboard.press("Enter");
    await expect(field(page)).toHaveValue(name);
    await expect(guidance(page)).toBeVisible();
    expect(writes(page, "PATCH")).toHaveLength(1);
    evidence.set(page, {
      knownSuccessPreservedAfterFailedGet: true,
      freshEditValue: name,
      statusVisible: true,
    });
  } finally {
    release();
  }
});

async function createFields(page: Page, group: string) {
  await field(page).fill(`Reconciliation ${group} creation`);
  await field(page, "Slug").fill(`reconciliation-${group.replaceAll("_", "-")}`);
  await field(page, "Description").fill("Synthetic reconciliation create payload.");
}

test("unknown committed creation requires explicit list review before a separate blank form with guidance", async ({
  page,
}) => {
  const fixture = await login(page, "unknown_create", false);
  await createFields(page, "unknown_create");
  let createdId: string | undefined;
  await page.route(backend + api(fixture, false), async (request) => {
    if (request.request().method() !== "POST") return request.continue();
    const result = await request.fetch();
    expect(result.status()).toBe(201);
    createdId = (await result.json()).data.id;
    await request.abort("failed");
  });
  await page.getByRole("button", { name: "Create product", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: unknown })).toContainText(unknown);
  expect(createdId).toBeTruthy();
  await expect(
    page.getByRole("button", { name: "Start a separate product", exact: true }),
  ).toHaveCount(0);
  await page.unroute(backend + api(fixture, false));
  await page.getByRole("button", { name: "Review products", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Products", exact: true })).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Reconciliation unknown_create creation", exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Create product", exact: true }).click();
  const oldField = await field(page).elementHandle();
  await page.getByRole("button", { name: "Start a separate product", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(field(page)).toHaveValue("");
  await expect(field(page, "Slug")).toHaveValue("");
  await expect(field(page, "Description")).toHaveValue("");
  await expect(guidance(page, blank)).toBeVisible();
  expect(await oldField!.evaluate((element) => element.isConnected)).toBe(false);
  expect(writes(page, "POST")).toHaveLength(1);
  await capture(page, "separate-blank-guidance", blank);
  await createFields(page, "separate_deliberate");
  const response = page.waitForResponse(
    (item) => item.url() === backend + api(fixture, false) && item.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Create product", exact: true }).click();
  const second = await response;
  expect(second.status()).toBe(201);
  expect((await second.json()).data.id).not.toBe(createdId);
  expect(writes(page, "POST")).toHaveLength(2);
  evidence.set(page, {
    firstCommitVerified201: true,
    listReviewed: true,
    originalFieldDetached: true,
    blankFreshPayload: true,
    guidanceVisible: true,
    deliberateSeparateCreate201: true,
    automaticReplay: 0,
  });
});

test("known create-only success starts another blank product with persistent guidance and no reads", async ({
  page,
}) => {
  const fixture = await login(page, "known_create", false);
  const productReads: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/catalog/") && request.method() === "GET")
      productReads.push(new URL(request.url()).pathname);
  });
  await createFields(page, "known_create");
  await page.getByRole("button", { name: "Create product", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Product created", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Create another product", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(field(page)).toHaveValue("");
  await expect(field(page, "Slug")).toHaveValue("");
  await expect(field(page, "Description")).toHaveValue("");
  await expect(guidance(page, blank)).toBeVisible();
  await expect(guidance(page, blank)).toHaveAttribute("aria-live", "polite");
  expect(
    await guidance(page, blank).evaluate((element) => element === document.activeElement),
  ).toBe(false);
  expect(writes(page, "POST")).toHaveLength(1);
  expect(productReads).toEqual([]);
  await expect(page).toHaveURL(new RegExp(route(fixture, false) + "$"));
  evidence.set(page, {
    blankFreshForm: true,
    roleStatusVisible: true,
    noProductReads: true,
    automaticReplay: 0,
  });
});

test("failed unknown reconciliation retains uncertainty and write lock until a successful explicit GET", async ({
  page,
}) => {
  const fixture = await login(page, "failed_unknown");
  const result = await makeUnknown(page, fixture, false);
  await page.route(backend + api(fixture), async (request) => {
    if (request.request().method() === "GET") await request.abort("failed");
    else await request.continue();
  });
  await page.getByRole("button", { name: "Refresh product", exact: true }).click();
  await expect(page.getByRole("button", { name: "Refresh product", exact: true })).toBeEnabled();
  await expect(page.getByRole("alert").filter({ hasText: unknown })).toContainText(unknown);
  await expect(page.getByRole("button", { name: "Save changes", exact: true })).toBeDisabled();
  await expect(guidance(page)).toHaveCount(0);
  expect(writes(page, "PATCH")).toHaveLength(1);
  await page.unroute(backend + api(fixture));
  await reconcile(page, fixture, result.before);
  evidence.set(page, { ...evidence.get(page), failedGetRetainedUnknownLock: true });
});

test("authoritative archived result explains reconciliation while keeping the form unavailable", async ({
  page,
}) => {
  const fixture = await login(page, "archived");
  await makeUnknown(page, fixture, false);
  expect((await read(page, fixture, "archive")).status).toBe("archived");
  await page.getByRole("button", { name: "Refresh product", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "This product is archived", exact: true }),
  ).toBeVisible();
  await expect(guidance(page)).toBeVisible();
  await expect(field(page)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Save changes", exact: true })).toHaveCount(0);
  expect(writes(page, "PATCH")).toHaveLength(1);
  evidence.set(page, {
    authoritativeArchive200: true,
    roleStatusVisible: true,
    noEditableArchivedForm: true,
  });
});
