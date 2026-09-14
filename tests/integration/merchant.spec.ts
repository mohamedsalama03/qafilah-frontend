import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

type StoreFixture = { id: string; name: string };
type MerchantFixture = {
  email: string;
  password: string;
  principalId: string;
  stores: StoreFixture[];
};
const fixtures = JSON.parse(
  readFileSync(path.resolve("artifacts/f2/runtime/browser-fixtures.json"), "utf8"),
) as Record<string, MerchantFixture> & { foreign: StoreFixture };
const apiOrigin = "http://localhost:3842";
const faults = new WeakMap<Page, string[]>();
type RequestEvidence = {
  method: string;
  path: string;
  status?: number;
  csrfHeader: boolean;
  authorizationHeader: boolean;
};
const requests = new WeakMap<Page, RequestEvidence[]>();

async function evidence(name: string, value: unknown) {
  await mkdir(path.resolve("artifacts/f2/browser"), { recursive: true });
  await writeFile(
    path.resolve(`artifacts/f2/browser/${name}.json`),
    JSON.stringify(value, null, 2),
  );
}

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1440, height: 900 });
  const errors: string[] = [];
  faults.set(page, errors);
  const traffic: RequestEvidence[] = [];
  requests.set(page, traffic);
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (
      /hydration|did not match|invalid hook|refused to.*script|content security policy/i.test(
        message.text(),
      )
    )
      errors.push(message.text());
  });
  page.on("request", (request) => {
    if (request.url().startsWith(apiOrigin))
      traffic.push({
        method: request.method(),
        path: new URL(request.url()).pathname + new URL(request.url()).search,
        csrfHeader: !!request.headers()["x-xsrf-token"],
        authorizationHeader: !!request.headers().authorization,
      });
  });
  page.on("response", (response) => {
    if (response.url().startsWith(apiOrigin)) {
      const item = traffic.findLast(
        (entry) =>
          entry.method === response.request().method() &&
          entry.path === new URL(response.url()).pathname + new URL(response.url()).search &&
          entry.status === undefined,
      );
      if (item) item.status = response.status();
    }
  });
});

test.afterEach(async ({ page }, info) => {
  await evidence(info.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase(), {
    requests: requests.get(page),
    runtimeErrors: faults.get(page),
  });
  expect(faults.get(page)).toEqual([]);
});

async function login(page: Page, group: string, returnTo?: string) {
  const fixture = fixtures[group];
  await page.goto(`/login${returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : ""}`);
  await expect(page.getByRole("textbox", { name: "Email address", exact: true })).toBeVisible();
  await page.getByRole("textbox", { name: "Email address", exact: true }).fill(fixture.email);
  await page.getByLabel(/^Password/).fill(fixture.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

async function ready(page: Page, store: StoreFixture) {
  await expect(page).toHaveURL(new RegExp(`/stores/${store.id}$`));
  await expect(page.getByRole("heading", { name: "Store overview", exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Current store", exact: true })).toContainText(
    store.name,
  );
}

async function focusRecheck(page: Page, uuid?: string) {
  const response = page.waitForResponse(
    (item) =>
      item.url() === `${apiOrigin}${uuid ? `/api/v1/stores/${uuid}/context` : "/api/v1/me"}`,
  );
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  return response;
}

function change(group: string, operation: string) {
  const args = [
    "-d",
    "Ubuntu",
    "--",
    "docker",
    "exec",
    "qafilah-f2-runtime-app-1",
    "qafilah-entrypoint",
    "php",
    "/tmp/f2-fixtures.php",
    group,
    operation,
  ];
  const result = execFileSync("wsl", args, {
    encoding: "utf8",
    timeout: 30_000,
    stdio: ["ignore", "pipe", "pipe"],
  });
  expect(JSON.parse(result)).toEqual({ changed: operation, group });
}

test("real Sanctum login discovers all 23 nonowner Stores and isolates A to B", async ({
  page,
  context,
}) => {
  const [a, b] = fixtures.merchant.stores;
  await login(page, "merchant");
  await expect(page.getByRole("button", { name: /^Open / })).toHaveCount(23);
  await page.getByRole("button", { name: `Open ${a.name}`, exact: true }).click();
  await ready(page, a);
  const cookieFlags = (await context.cookies(apiOrigin)).map(
    ({ name, httpOnly, secure, sameSite, path: cookiePath, domain }) => ({
      name,
      httpOnly,
      secure,
      sameSite,
      path: cookiePath,
      domain,
    }),
  );
  expect(cookieFlags.find((cookie) => cookie.name === "XSRF-TOKEN")).toMatchObject({
    httpOnly: false,
    secure: false,
    sameSite: "Lax",
    path: "/",
    domain: "localhost",
  });
  expect(
    cookieFlags.some(
      (cookie) =>
        cookie.httpOnly && !cookie.secure && cookie.sameSite === "Lax" && cookie.path === "/",
    ),
  ).toBe(true);
  const storage = await page.evaluate(async () => ({
    local: Object.keys(localStorage),
    session: Object.keys(sessionStorage),
    databases: (await indexedDB.databases()).map((database) => database.name),
  }));
  expect(storage.local).toEqual([]);
  expect(storage.session).toEqual([]);
  // Installed Next development tooling persists its debug channel. Inspect its contents,
  // rather than confusing framework debug metadata with application auth persistence.
  expect(storage.databases.filter((name) => name !== "__next_debug_channel")).toEqual([]);
  const debugRecords = await page.evaluate(async () => {
    const output: string[] = [];
    for (const entry of await indexedDB.databases()) {
      if (!entry.name) continue;
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const open = indexedDB.open(entry.name!);
        open.onsuccess = () => resolve(open.result);
        open.onerror = () => reject(open.error);
      });
      for (const name of Array.from(db.objectStoreNames)) {
        const records = await new Promise<unknown[]>((resolve, reject) => {
          const get = db.transaction(name, "readonly").objectStore(name).getAll();
          get.onsuccess = () => resolve(get.result);
          get.onerror = () => reject(get.error);
        });
        output.push(
          JSON.stringify(records, (_key, value: unknown) =>
            value instanceof ArrayBuffer || ArrayBuffer.isView(value)
              ? new TextDecoder().decode(value as ArrayBuffer)
              : value,
          ),
        );
      }
      db.close();
    }
    return output;
  });
  const secretValues = [
    fixtures.merchant.password,
    ...(await context.cookies(apiOrigin)).map((cookie) => cookie.value),
  ];
  expect(
    debugRecords.some((records) => secretValues.some((secret) => records.includes(secret))),
    "No credential or session cookie value in IndexedDB",
  ).toBe(false);
  const beforeFocus = requests.get(page)!.length;
  await page.getByRole("button", { name: "Switch store", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Switch store", exact: true })
    .getByLabel("Find a store")
    .fill("LongStore");
  await focusRecheck(page, a.id);
  await expect(
    page.getByRole("dialog", { name: "Switch store", exact: true }).getByLabel("Find a store"),
  ).toHaveValue("LongStore");
  const focusTraffic = requests.get(page)!.slice(beforeFocus);
  expect(focusTraffic.filter((entry) => entry.path === "/api/v1/me")).toHaveLength(1);
  expect(focusTraffic.filter((entry) => entry.path.endsWith("/context"))).toHaveLength(1);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(`${apiOrigin}/api/v1/stores/${b.id}/context`, async (route) => {
    await gate;
    await route.continue();
  });
  await page.evaluate(
    ({ foreignName, targetId }) => {
      const observations: string[] = [];
      Object.assign(window, { __f2Leaks: observations });
      new MutationObserver(() => {
        const region = document.querySelector('[aria-label="Current store"]');
        if (location.pathname.endsWith(targetId) && region?.textContent?.includes(foreignName))
          observations.push("prior Store remained visible under destination URL");
      }).observe(document.body, { childList: true, subtree: true, characterData: true });
    },
    { foreignName: a.name, targetId: b.id },
  );
  await page.getByRole("button", { name: `Open ${b.name}`, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/stores/${b.id}$`));
  await expect(page.getByRole("heading", { name: "Store overview", exact: true })).toHaveCount(0);
  release();
  await ready(page, b);
  await expect(page.getByRole("region", { name: "Current store" })).toContainText("Products View");
  await expect(page.getByRole("region", { name: "Current store" })).not.toContainText(
    "Orders View",
  );
  expect(
    await page.evaluate(() => (window as unknown as { __f2Leaks: string[] }).__f2Leaks),
  ).toEqual([]);
  expect(requests.get(page)!.some((entry) => entry.authorizationHeader)).toBe(false);
  expect(
    requests
      .get(page)!
      .filter((entry) => entry.method === "POST")
      .every((entry) => entry.csrfHeader),
  ).toBe(true);
  expect(
    requests
      .get(page)!
      .filter((entry) => entry.method === "GET")
      .some((entry) => entry.csrfHeader),
  ).toBe(false);
  await evidence("cookies-storage-and-request-counts", {
    cookieFlags,
    storage,
    focusTraffic,
    requestSequence: requests.get(page),
  });
});

test("zero operational Stores is truthful despite draft ownership", async ({ page }) => {
  await login(page, "zero");
  await expect(
    page
      .getByText(
        /no stores are available|no stores available|no available stores|no active stores/i,
      )
      .first(),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /^Open / })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Store overview" })).toHaveCount(0);
});

test("one eligible Store auto-enters and permitted deep link survives refresh", async ({
  page,
}) => {
  const store = fixtures.one.stores[0];
  await login(page, "one");
  await ready(page, store);
  await page.reload();
  await ready(page, store);
  await page.goto(`/stores/${store.id}`);
  await ready(page, store);
  await page.goto(`/stores/${store.id.toUpperCase()}`);
  await expect(page.getByRole("region", { name: "Current store" })).toHaveAttribute(
    "data-store-uuid",
    store.id,
  );
});

test("foreign and malformed deep links disclose no Store and do not globally sign out", async ({
  page,
}) => {
  await login(page, "merchant", `/stores/${fixtures.foreign.id}`);
  const region = page.getByRole("region", { name: "Current store", exact: true });
  await expect(
    page.getByRole("heading", { name: "Store access is unavailable", exact: true }),
  ).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await expect(region).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText(fixtures.foreign.name);
  expect(
    requests
      .get(page)!
      .some(
        (entry) =>
          entry.path === `/api/v1/stores/${fixtures.foreign.id}/context` && entry.status === 404,
      ),
  ).toBe(true);
  await page.goto("/stores/not-a-uuid");
  await expect(region).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Store access is unavailable", exact: true }),
  ).toBeVisible();
  expect(requests.get(page)!.some((entry) => entry.path.includes("not-a-uuid/context"))).toBe(
    false,
  );
  await page.goto(`/stores/${fixtures.merchant.stores[0].id}`);
  await ready(page, fixtures.merchant.stores[0]);
});

test("same-session permission removal Role replacement and membership suspension refresh authority", async ({
  page,
}) => {
  const store = fixtures.revocation.stores[0];
  await login(page, "revocation", `/stores/${store.id}`);
  await ready(page, store);
  await expect(page.getByRole("region", { name: "Current store" })).toContainText(/orders view/i);
  change("revocation", "permission");
  expect((await focusRecheck(page, store.id)).status()).toBe(200);
  await expect(page.getByRole("region", { name: "Current store" })).not.toContainText(
    /orders view/i,
  );
  change("revocation", "role");
  expect((await focusRecheck(page, store.id)).status()).toBe(200);
  await expect(page.getByRole("region", { name: "Current store" })).toContainText(
    "Replacement Reader",
  );
  await expect(page.getByRole("region", { name: "Current store" })).toContainText(/products view/i);
  change("revocation", "membership");
  expect((await focusRecheck(page, store.id)).status()).toBe(403);
  await expect(page.getByRole("region", { name: "Current store" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Sign in to your workspace" })).toHaveCount(0);
  await page.goto(`/stores/${fixtures.revocation.stores[1].id}`);
  await ready(page, fixtures.revocation.stores[1]);
});

test("a misleading Role with zero grants invents no capabilities", async ({ page }) => {
  await login(page, "emptygrants");
  await ready(page, fixtures.emptygrants.stores[0]);
  const region = page.getByRole("region", { name: "Current store" });
  await expect(region).toContainText("Administrator");
  await expect(region).not.toContainText(/orders view|products view/i);
});

test("global identity suspension purges the workspace on the next real recheck", async ({
  page,
}) => {
  await login(page, "identity");
  await ready(page, fixtures.identity.stores[0]);
  change("identity", "identity");
  expect((await focusRecheck(page)).status()).toBe(401);
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByRole("region", { name: "Current store" })).toHaveCount(0);
});

test("logout failure latches locally then retry terminates remotely and browser back stays private", async ({
  page,
  context,
}) => {
  await login(page, "one");
  await ready(page, fixtures.one.stores[0]);
  const second = await context.newPage();
  await second.goto(`/stores/${fixtures.one.stores[0].id}`);
  await ready(second, fixtures.one.stores[0]);
  await page.bringToFront();
  await page.route(`${apiOrigin}/api/v1/auth/logout`, (route) => route.abort("failed"));
  await page.getByRole("button", { name: "Account menu", exact: true }).click();
  await page.getByRole("menuitem", { name: "Sign out", exact: true }).click();
  await expect(page.getByRole("button", { name: "Retry sign out", exact: true })).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await expect(page.getByRole("region", { name: "Current store" })).toHaveCount(0);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByRole("button", { name: "Retry sign out", exact: true })).toBeVisible();
  await page.unroute(`${apiOrigin}/api/v1/auth/logout`);
  await page.getByRole("button", { name: "Retry sign out", exact: true }).click();
  await expect(page).toHaveURL(/\/login/);
  await second.bringToFront();
  await expect(second.getByRole("region", { name: "Current store" })).toHaveCount(0);
  await expect(second).toHaveURL(/\/login/);
  await page.goBack();
  await expect(page.getByRole("region", { name: "Current store" })).toHaveCount(0);
  await second.close();
});

test("real error envelopes preserve CSRF Origin Host validation and rate limits", async ({
  page,
  request,
  context,
}) => {
  await page.goto("/login");
  await expect(page.getByRole("textbox", { name: "Email address", exact: true })).toBeVisible();
  const statuses = await page.evaluate(async (origin) => {
    const read = async (url: string, options: RequestInit = {}) => {
      const response = await fetch(origin + url, {
        credentials: "include",
        headers: { Accept: "application/json" },
        ...options,
      });
      const body = response.status === 204 ? null : await response.json();
      return {
        status: response.status,
        requestId: body?.meta?.request_id,
        errors: body?.errors ? Object.keys(body.errors) : [],
        exposedRequestId: response.headers.get("x-request-id"),
      };
    };
    const anonymous = await read("/api/v1/me");
    const csrf = await read("/sanctum/csrf-cookie");
    const noCsrf = await read("/api/v1/auth/login", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ email: "invalid@example.test", password: "invalid" }),
    });
    const token = decodeURIComponent(
      document.cookie
        .split("; ")
        .find((cookie) => cookie.startsWith("XSRF-TOKEN="))!
        .slice("XSRF-TOKEN=".length),
    );
    const prohibited = await read("/api/v1/auth/login", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-XSRF-TOKEN": token,
      },
      body: JSON.stringify({ email: "invalid@example.test", password: "invalid", extra: true }),
    });
    return { anonymous, csrf, noCsrf, prohibited };
  }, apiOrigin);
  expect(statuses.anonymous.status).toBe(401);
  expect(statuses.csrf.status).toBe(204);
  expect(statuses.noCsrf.status).toBe(419);
  expect(statuses.prohibited.status).toBe(422);
  expect(statuses.prohibited.requestId).toMatch(/^[a-f0-9-]{36}$/i);
  expect(statuses.prohibited.exposedRequestId).toBeNull();
  const host = await request.get("http://127.0.0.1:3842/api/v1/me", {
    headers: { Accept: "application/json" },
  });
  expect(host.status()).toBe(400);
  const deniedOrigin = await request.get(`${apiOrigin}/api/v1/me`, {
    headers: { Accept: "application/json", Origin: "https://unapproved.example.test" },
  });
  expect(deniedOrigin.headers()["access-control-allow-origin"]).toBe("http://localhost:3000");
  // The fixed approved origin does not match a foreign Origin, so browsers cannot read it.
  const foreignPage = await context.newPage();
  const readable = await foreignPage.evaluate(async (origin) => {
    try {
      await fetch(`${origin}/api/v1/me`, { credentials: "include" });
      return true;
    } catch {
      return false;
    }
  }, apiOrigin);
  expect(readable).toBe(false);
  await foreignPage.close();
  for (let attempt = 0; attempt < 6; attempt++) {
    await page
      .getByRole("textbox", { name: "Email address", exact: true })
      .fill(fixtures.errors.email);
    await page.getByLabel(/^Password/).fill("Incorrect synthetic password");
    const result = page.waitForResponse(`${apiOrigin}/api/v1/auth/login`);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    expect((await result).status()).toBe(attempt < 5 ? 422 : 429);
    await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeEnabled();
  }
  await expect(page.locator("body")).not.toContainText(/SQLSTATE|Stack trace|vendor\//);
  await evidence("security-error-semantics", {
    ...statuses,
    wrongHost: host.status(),
    wrongOriginAllowed: false,
  });
});

test("integrated login Store switcher and long names are accessible and contained", async ({
  page,
}) => {
  await page.goto("/login");
  await expect(page.getByRole("textbox", { name: "Email address", exact: true })).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({
    path: path.resolve("artifacts/f2/browser/login-1440.png"),
    fullPage: true,
  });
  await login(page, "merchant", `/stores/${fixtures.merchant.stores[1].id}`);
  await ready(page, fixtures.merchant.stores[1]);
  const results = [];
  for (const width of [1440, 1280, 1024, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflow).toBe(false);
    await page.screenshot({
      path: path.resolve(`artifacts/f2/browser/store-overview-${width}.png`),
      fullPage: true,
    });
    if (width < 1024)
      await page.getByRole("button", { name: "Open navigation", exact: true }).click();
    await page.getByRole("button", { name: "Switch store", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Switch store", exact: true })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Close store switcher", exact: true }),
    ).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByLabel("Find a store", { exact: true })).toBeFocused();
    const scan = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(scan.violations).toEqual([]);
    results.push({ width, overflow, axePasses: scan.passes.length, violations: scan.violations });
    await page.screenshot({
      path: path.resolve(`artifacts/f2/browser/store-switcher-${width}.png`),
      fullPage: true,
    });
    await page.keyboard.press("Escape");
    if (width < 1024) await page.keyboard.press("Escape");
  }
  await evidence("accessibility-responsive", results);
});

test("real adapter preserves local workspace through a transient recheck failure", async ({
  page,
}) => {
  const store = fixtures.merchant.stores[0];
  await login(page, "merchant", `/stores/${store.id}`);
  await ready(page, store);
  await page.getByRole("button", { name: "Switch store", exact: true }).click();
  await page.getByLabel("Find a store", { exact: true }).fill("retained search");
  await page.route(`${apiOrigin}/api/v1/me`, (route) =>
    route.fulfill({
      status: 500,
      contentType: "application/json",
      headers: {
        "Access-Control-Allow-Origin": "http://localhost:3000",
        "Access-Control-Allow-Credentials": "true",
      },
      body: JSON.stringify({
        success: false,
        data: null,
        message: "SQLSTATE private server internals",
        errors: {},
        meta: { request_id: "61ebf147-26e2-43fb-a449-7fe3cc3ba095" },
      }),
    }),
  );
  expect((await focusRecheck(page)).status()).toBe(500);
  await expect(page.getByLabel("Find a store", { exact: true })).toHaveValue("retained search");
  await expect(page.locator("body")).not.toContainText("SQLSTATE");
  await page.unroute(`${apiOrigin}/api/v1/me`);
  expect((await focusRecheck(page, store.id)).status()).toBe(200);
  await expect(page.getByLabel("Find a store", { exact: true })).toHaveValue("retained search");
});

test("real private overlays hide synchronously before a page-history snapshot", async ({
  page,
}) => {
  const store = fixtures.merchant.stores[0];
  await login(page, "merchant", `/stores/${store.id}`);
  await ready(page, store);
  for (const surface of ["store", "account", "mobile"] as const) {
    if (surface === "mobile") await page.setViewportSize({ width: 390, height: 844 });
    const name =
      surface === "store"
        ? "Switch store"
        : surface === "account"
          ? "Account menu"
          : "Open navigation";
    await page.getByRole("button", { name, exact: true }).click();
    const snapshot = await page.evaluate(() => {
      const portals = Array.from(
        document.querySelectorAll<HTMLElement>("[data-merchant-private-overlay]"),
      );
      const before = portals.filter((element) =>
        element.checkVisibility({ checkVisibilityCSS: true }),
      ).length;
      window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true }));
      const remaining = portals.filter((element) =>
        element.checkVisibility({ checkVisibilityCSS: true }),
      ).length;
      return { before, remaining };
    });
    expect(snapshot.before).toBeGreaterThan(0);
    expect(snapshot.remaining).toBe(0);
    await page.evaluate(() =>
      window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })),
    );
    await ready(page, store);
  }
});
