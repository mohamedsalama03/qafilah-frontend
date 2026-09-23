import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

type Kind = "product" | "variant";
type Product = {
  id: string;
  name: string;
  variants: Record<"first" | "second" | "inactive", string>;
  assets: Record<string, string>;
};
type Store = {
  id: string;
  name: string;
  products: Record<"main" | "other" | "archived" | "simple", Product>;
};
type Fixture = { email: string; password: string; stores: Store[] };
type Media = {
  id: string;
  url: string;
  mime_type: string;
  byte_size: number;
  width: number;
  height: number;
  alt_text: string | null;
  position: number;
  is_primary?: boolean;
};
type FileData = { name: string; mimeType: string; buffer: Buffer };
type Traffic = {
  method: string;
  path: string;
  csrf: boolean;
  bearer: boolean;
  contentType: string;
  status?: number;
  body?: unknown;
};
const fixtures = JSON.parse(
  readFileSync(path.resolve("artifacts/f3f/runtime/media-fixtures.json"), "utf8"),
) as Record<string, Fixture>;
const origin = "http://localhost:3842";
const traffic = new WeakMap<Page, Traffic[]>();
const errors = new WeakMap<Page, string[]>();
const evidence = new WeakMap<Page, unknown>();
const panel = (page: Page, kind: Kind = "product") =>
  page.getByRole("region", {
    name: kind === "product" ? "Product images" : "Variant images",
    exact: true,
  });
const base = (store: Store, product = store.products.main) =>
  `/api/v1/stores/${store.id}/catalog/products/${product.id}`;
const api = (
  store: Store,
  kind: Kind = "product",
  product = store.products.main,
  variant = product.variants.first,
) => `${base(store, product)}${kind === "variant" ? `/variants/${variant}` : ""}/media`;
const route = (
  store: Store,
  kind: Kind = "product",
  product = store.products.main,
  variant = product.variants.first,
) =>
  `/stores/${store.id}/products/${product.id}${kind === "variant" ? `/variants/${variant}` : ""}`;
const writes = (page: Page) =>
  traffic
    .get(page)!
    .filter(
      (entry) =>
        ["POST", "PATCH", "DELETE"].includes(entry.method) && /\/media(?:\/|$)/.test(entry.path),
    );
const response = (page: Page, endpoint: string, method: string) =>
  page.waitForResponse(
    (item) => item.url() === origin + endpoint && item.request().method() === method,
  );

test.beforeEach(async ({ page }) => {
  traffic.set(page, []);
  errors.set(page, []);
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  page.on("pageerror", (error) => errors.get(page)!.push(error.message));
  page.on("request", (request) => {
    if (!request.url().startsWith(origin)) return;
    const headers = request.headers();
    traffic.get(page)!.push({
      method: request.method(),
      path: new URL(request.url()).pathname,
      csrf: !!headers["x-xsrf-token"],
      bearer: !!headers.authorization,
      contentType: headers["content-type"] ?? "",
      ...(headers["content-type"]?.includes("application/json") &&
      request.postData() &&
      request.url().includes("/catalog/")
        ? { body: request.postDataJSON() }
        : {}),
    });
  });
  page.on("response", (result) => {
    const entry = traffic
      .get(page)!
      .findLast(
        (item) =>
          item.path === new URL(result.url()).pathname &&
          item.method === result.request().method() &&
          item.status === undefined,
      );
    if (entry) entry.status = result.status();
  });
});

test.afterEach(async ({ page }, info) => {
  await mkdir("artifacts/f3f/browser", { recursive: true });
  await writeFile(
    `artifacts/f3f/browser/${info.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.json`,
    JSON.stringify(
      {
        requests: traffic.get(page),
        evidence: evidence.get(page),
        runtimeErrors: errors.get(page),
      },
      null,
      2,
    ),
  );
  expect(errors.get(page)).toEqual([]);
  expect(traffic.get(page)!.some((entry) => entry.bearer)).toBe(false);
  expect(
    traffic
      .get(page)!
      .some((entry) => /\/(pricing|uploads|presign|media-library)\b/.test(entry.path)),
  ).toBe(false);
  for (const entry of writes(page)) {
    expect(entry.csrf).toBe(true);
    expect(entry.path).toMatch(
      /\/catalog\/products\/[^/]+(?:\/variants\/[^/]+)?\/media(?:\/[^/]+)?$/,
    );
    if (entry.method === "POST")
      expect(entry.contentType).toMatch(/^multipart\/form-data; boundary=/);
  }
});

async function login(
  page: Page,
  group: string,
  kind: Kind = "product",
  target = route(fixtures[group].stores[0], kind),
) {
  await page.goto(`/login?returnTo=${encodeURIComponent(target)}`);
  await page
    .getByRole("textbox", { name: "Email address", exact: true })
    .fill(fixtures[group].email);
  await page.getByLabel(/^Password/).fill(fixtures[group].password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(target.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$"));
  return fixtures[group].stores[0];
}
async function ready(page: Page, group: string, kind: Kind = "product") {
  const store = await login(page, group, kind);
  await expect(panel(page, kind)).toBeVisible();
  await expect(
    panel(page, kind).getByRole("button", { name: "Upload image", exact: true }),
  ).toBeEnabled();
  return store;
}
async function picture(page: Page, mime = "image/png", width = 16, height = 12): Promise<FileData> {
  const bytes = await page.evaluate(
    ({ mime, width, height }) => {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d")!;
      context.fillStyle = "#4b735d";
      context.fillRect(0, 0, width, height);
      return canvas.toDataURL(mime).split(",")[1];
    },
    { mime, width, height },
  );
  return {
    name: `verification.${mime.split("/")[1]}`,
    mimeType: mime,
    buffer: Buffer.from(bytes, "base64"),
  };
}
async function direct(
  page: Page,
  endpoint: string,
  method = "GET",
  body?: Record<string, unknown>,
  file?: FileData,
) {
  return page.evaluate(
    async ({ url, method, body, file }) => {
      const token = document.cookie
        .split("; ")
        .find((cookie) => cookie.startsWith("XSRF-TOKEN="))
        ?.slice(11);
      const headers: Record<string, string> = {
        Accept: "application/json",
        ...(method !== "GET" ? { "X-XSRF-TOKEN": decodeURIComponent(token ?? "") } : {}),
      };
      let payload: FormData | string | undefined;
      if (file) {
        const data = new FormData();
        data.append(
          "image",
          new Blob([Uint8Array.from(atob(file.base64), (char) => char.charCodeAt(0))], {
            type: file.mimeType,
          }),
          file.name,
        );
        for (const [key, value] of Object.entries(body ?? {}))
          data.append(key, value === null ? "" : String(value));
        payload = data;
      } else if (body) {
        headers["Content-Type"] = "application/json";
        payload = JSON.stringify(body);
      }
      const result = await fetch(url, {
        method,
        credentials: "include",
        headers,
        ...(payload ? { body: payload } : {}),
      });
      const text = await result.text();
      return { status: result.status, body: text ? JSON.parse(text) : null };
    },
    {
      url: origin + endpoint,
      method,
      body,
      file: file
        ? { name: file.name, mimeType: file.mimeType, base64: file.buffer.toString("base64") }
        : undefined,
    },
  );
}
async function uploadForm(
  page: Page,
  kind: Kind,
  file: FileData,
  alt = "Uploaded image",
  position = "0",
) {
  const region = panel(page, kind);
  await region.getByRole("button", { name: "Upload image", exact: true }).click();
  await region.getByRole("button", { name: "Image", exact: true }).setInputFiles(file);
  await region.getByRole("textbox", { name: "Alt text", exact: true }).fill(alt);
  await region.getByRole("textbox", { name: "Position", exact: true }).fill(position);
}
async function upload(
  page: Page,
  store: Store,
  kind: Kind,
  file: FileData,
  alt = "Uploaded image",
  position = "0",
) {
  await uploadForm(page, kind, file, alt, position);
  const received = response(page, api(store, kind), "POST");
  await panel(page, kind).getByRole("button", { name: "Upload image", exact: true }).click();
  const result = await received;
  expect(result.status()).toBe(201);
  const media = (await result.json()).data as Media;
  await expect(panel(page, kind)).toContainText(/uploaded/i);
  return media;
}
async function review(page: Page, kind: Kind) {
  await panel(page, kind)
    .getByRole("button", { name: "Review current images", exact: true })
    .click();
  await expect(
    panel(page, kind).getByRole("button", { name: "Upload image", exact: true }),
  ).toBeEnabled();
}
async function publicImage(page: Page, media: Media, file?: FileData) {
  expect(media.url).toMatch(/^\/storage\/catalog\/[0-9a-f-]{36}$/);
  const result = await page.request.get(origin + media.url);
  expect(result.status()).toBe(200);
  expect(result.headers()["content-type"]).toBe(media.mime_type);
  const bytes = await result.body();
  expect(bytes.length).toBe(media.byte_size);
  if (file) expect(bytes.equals(file.buffer)).toBe(true);
  return {
    url: media.url,
    mime: result.headers()["content-type"],
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}
async function capture(page: Page, name: string, widths = [1440, 390]) {
  await mkdir("artifacts/f3f/screenshots", { recursive: true });
  const scans = [];
  for (const width of widths) {
    await page.setViewportSize({ width, height: 1100 });
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    const result = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(result.violations).toEqual([]);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      ),
    ).toBe(false);
    await page.screenshot({
      path: `artifacts/f3f/screenshots/${name}-${width}.png`,
      fullPage: true,
    });
    scans.push({ width, violations: result.violations });
  }
  await writeFile(`artifacts/f3f/screenshots/${name}-axe.json`, JSON.stringify(scans, null, 2));
  await page.setViewportSize({ width: 1440, height: 1100 });
}
function control(group: string, change: string) {
  return JSON.parse(
    execFileSync(
      "docker",
      [
        "exec",
        "qafilah-f3f-runtime-app-1",
        "qafilah-entrypoint",
        "php",
        "/tmp/f3f-fixtures.php",
        group,
        change,
      ],
      { encoding: "utf8", timeout: 30_000, stdio: ["ignore", "pipe", "pipe"] },
    ),
  );
}

for (const kind of ["product", "variant"] as const)
  test(`real ${kind} JPEG PNG WebP upload metadata delete renders exact public bytes`, async ({
    page,
  }) => {
    const store = await ready(page, `crud_${kind}`, kind);
    const records = [];
    for (const [index, mime] of ["image/jpeg", "image/png", "image/webp"].entries()) {
      const file = await picture(page, mime);
      const media = await upload(page, store, kind, file, `${kind} ${mime}`, String(20 - index));
      records.push(await publicImage(page, media, file));
      await review(page, kind);
      const image = panel(page, kind).getByRole("img", { name: `${kind} ${mime}`, exact: true });
      await expect(image).toBeVisible();
      await expect(image).toHaveAttribute("src", origin + media.url);
      expect(
        await image.evaluate(
          (node) =>
            (node as HTMLImageElement).complete && (node as HTMLImageElement).naturalWidth === 16,
        ),
      ).toBe(true);
      if (index !== 2) continue;
      const card = panel(page, kind).getByRole("listitem", { name: "Image 1", exact: true });
      await card.getByRole("button", { name: "Edit image", exact: true }).click();
      await panel(page, kind)
        .getByRole("textbox", { name: "Alt text", exact: true })
        .fill("Revised image");
      await panel(page, kind).getByRole("textbox", { name: "Position", exact: true }).fill("7");
      const saved = response(page, api(store, kind) + "/" + media.id, "PATCH");
      await panel(page, kind).getByRole("button", { name: "Save image", exact: true }).click();
      expect((await saved).status()).toBe(200);
      await review(page, kind);
      const current = (await direct(page, api(store, kind))).body.data as Media[];
      expect(current[0]).toMatchObject({ id: media.id, alt_text: "Revised image", position: 7 });
      await panel(page, kind)
        .getByRole("listitem", { name: "Image 1", exact: true })
        .getByRole("button", { name: "Delete image", exact: true })
        .click();
      const dialog = page.getByRole("alertdialog", { name: "Delete image?", exact: true });
      await expect(dialog).toBeVisible();
      const deleted = response(page, api(store, kind) + "/" + media.id, "DELETE");
      await dialog.getByRole("button", { name: "Delete image", exact: true }).click();
      expect((await deleted).status()).toBe(204);
      await expect(
        panel(page, kind).locator('div[tabindex="-1"]').filter({ hasText: "Image deleted." }),
      ).toBeFocused();
      expect((await deleted).headers()["content-length"] ?? "0").toBe("0");
      expect((await page.request.get(origin + media.url)).status()).toBe(404);
    }
    evidence.set(page, records);
    expect(writes(page).map((item) => item.method)).toEqual([
      "POST",
      "POST",
      "POST",
      "PATCH",
      "DELETE",
    ]);
  });

test("real Product first primary transitions ordered ties and deletion fallback remain server authoritative", async ({
  page,
}) => {
  const store = await ready(page, "persistence");
  const image = await picture(page);
  const first = (
    await direct(
      page,
      api(store),
      "POST",
      { position: 20, is_primary: "0", alt_text: "First" },
      image,
    )
  ).body.data as Media;
  expect(first.is_primary).toBe(true);
  const second = (
    await direct(page, api(store), "POST", { position: 10, alt_text: "Second" }, image)
  ).body.data as Media;
  const third = (await direct(page, api(store), "POST", { position: 10, alt_text: "Third" }, image))
    .body.data as Media;
  expect((await direct(page, api(store))).body.data.map((item: Media) => item.id)).toEqual([
    second.id,
    third.id,
    first.id,
  ]);
  await page.reload();
  await expect(panel(page).getByRole("listitem", { name: "Image 1", exact: true })).toContainText(
    "Second",
  );
  const saved = response(page, api(store) + "/" + second.id, "PATCH");
  await panel(page)
    .getByRole("listitem", { name: "Image 1", exact: true })
    .getByRole("button", { name: "Set as primary", exact: true })
    .click();
  expect((await saved).status()).toBe(200);
  await review(page, "product");
  expect(
    (await direct(page, api(store))).body.data
      .filter((item: Media) => item.is_primary)
      .map((item: Media) => item.id),
  ).toEqual([second.id]);
  expect(
    (await direct(page, api(store) + "/" + second.id, "PATCH", { is_primary: false })).status,
  ).toBe(422);
  expect((await direct(page, api(store) + "/" + second.id, "DELETE")).status).toBe(204);
  expect(
    (await direct(page, api(store))).body.data
      .filter((item: Media) => item.is_primary)
      .map((item: Media) => item.id),
  ).toEqual([third.id]);
});

test("real media byte dimension pixel text position unknown fields and unchanged metadata boundaries", async ({
  page,
}) => {
  const store = await ready(page, "validation");
  const png = await picture(page);
  const oversized = {
    ...png,
    buffer: Buffer.concat([png.buffer, Buffer.alloc(5_242_881 - png.buffer.length)]),
  };
  for (const file of [
    { ...png, buffer: Buffer.alloc(0) },
    oversized,
    await picture(page, "image/png", 8001, 1),
    await picture(page, "image/png", 8000, 5001),
    {
      name: "bad.png",
      mimeType: "image/png",
      buffer: Buffer.from("<svg><script>alert(1)</script></svg>"),
    },
  ])
    expect((await direct(page, api(store), "POST", {}, file)).status).toBe(422);
  for (const body of [
    { position: -1 },
    { position: 10001 },
    { position: "1.5" },
    { alt_text: "x".repeat(251) },
    { alt_text: "bad\ntext" },
    { alt_text: "bad\u200dtext" },
    { tenant_id: store.id },
    { storage_key: "catalog/fake" },
    { url: "https://alternate.invalid/image" },
  ])
    expect((await direct(page, api(store), "POST", body, png)).status).toBe(422);
  const maximum = {
    ...png,
    buffer: Buffer.concat([png.buffer, Buffer.alloc(5_242_880 - png.buffer.length)]),
  };
  const result = await direct(
    page,
    api(store),
    "POST",
    { position: "10000", alt_text: "  Ｆｒｏｎｔ  " },
    maximum,
  );
  expect(result.status).toBe(201);
  expect(result.body.data).toMatchObject({
    position: 10000,
    alt_text: "Front",
    byte_size: 5_242_880,
  });
  const endpoint = api(store) + "/" + result.body.data.id;
  expect((await direct(page, endpoint, "PATCH", { alt_text: "Front" })).status).toBe(200);
  for (const body of [{}, { image: "replacement" }, { position: 10001 }, { is_primary: false }])
    expect((await direct(page, endpoint, "PATCH", body)).status).toBe(422);
  expect((await direct(page, endpoint, "PATCH", { alt_text: null })).status).toBe(200);
  const edge = await picture(page, "image/png", 8000, 5000);
  const accepted = await direct(page, api(store, "variant"), "POST", { position: 0 }, edge);
  expect(accepted.status).toBe(201);
  expect(accepted.body.data).toMatchObject({ width: 8000, height: 5000 });
});

test("real Product ten and Variant five limits count every existing association", async ({
  page,
}) => {
  const store = await ready(page, "limits");
  const image = await picture(page);
  for (const kind of ["product", "variant"] as const) {
    const limit = kind === "product" ? 10 : 5;
    for (let index = 0; index < limit; index++)
      expect(
        (await direct(page, api(store, kind), "POST", { alt_text: `Image ${index}` }, image))
          .status,
      ).toBe(201);
    expect((await direct(page, api(store, kind), "POST", {}, image)).status).toBe(422);
    expect((await direct(page, api(store, kind))).body.data).toHaveLength(limit);
  }
});

for (const grant of ["none", "view", "create", "update", "delete", "all"] as const)
  test(`real independent media ${grant} grant ignores role names and unrelated Product grants`, async ({
    page,
  }) => {
    const group = `permissions_${grant}`;
    const store = await login(page, group);
    const image = await picture(page);
    const readable = grant !== "none";
    const read = await direct(page, api(store));
    expect(read.status).toBe(readable ? 200 : 403);
    if (readable) {
      await expect(panel(page)).toBeVisible();
      await expect(
        panel(page).getByRole("button", { name: "Upload image", exact: true }),
      ).toHaveCount(grant === "create" || grant === "all" ? 1 : 0);
      await expect(
        panel(page).getByRole("button", { name: "Edit image", exact: true }),
      ).toHaveCount(grant === "update" || grant === "all" ? 1 : 0);
      await expect(
        panel(page).getByRole("button", { name: "Delete image", exact: true }),
      ).toHaveCount(grant === "delete" || grant === "all" ? 1 : 0);
    } else await expect(panel(page)).toHaveCount(0);
    const asset = store.products.main.assets.product;
    expect(
      (await direct(page, api(store), "POST", { alt_text: "Grant upload" }, image)).status,
    ).toBe(grant === "create" || grant === "all" ? 201 : 403);
    expect(
      (await direct(page, api(store) + "/" + asset, "PATCH", { alt_text: "Grant patch" })).status,
    ).toBe(grant === "update" || grant === "all" ? 200 : 403);
    expect((await direct(page, api(store) + "/" + asset, "DELETE")).status).toBe(
      grant === "delete" || grant === "all" ? 204 : 403,
    );
  });

for (const prerequisite of ["no_product", "no_variant"] as const)
  test(`real media keeps ${prerequisite} context prerequisite closed`, async ({ page }) => {
    await login(page, prerequisite, "variant");
    await expect(panel(page, "variant")).toHaveCount(0);
    expect(traffic.get(page)!.filter((item) => /\/media$/.test(item.path))).toHaveLength(0);
  });

for (const verb of ["create", "update", "delete"] as const)
  test(`real media ${verb} alone authorizes its backend operation but never unlocks unreadable frontend`, async ({
    page,
  }) => {
    const store = await login(page, `permissions_${verb}_only`);
    await expect(panel(page)).toHaveCount(0);
    const image = await picture(page);
    for (const kind of ["product", "variant"] as const) {
      const endpoint = api(store, kind);
      const asset = store.products.main.assets[kind === "product" ? "product" : "first"];
      expect((await direct(page, endpoint)).status).toBe(403);
      expect((await direct(page, endpoint, "POST", {}, image)).status).toBe(
        verb === "create" ? 201 : 403,
      );
      expect(
        (await direct(page, endpoint + "/" + asset, "PATCH", { alt_text: "Only grant" })).status,
      ).toBe(verb === "update" ? 200 : 403);
      expect((await direct(page, endpoint + "/" + asset, "DELETE")).status).toBe(
        verb === "delete" ? 204 : 403,
      );
    }
  });

test("real inactive Variant editable archived Product read-only and server write rejects", async ({
  page,
}) => {
  const store = fixtures.inactive.stores[0];
  const product = store.products.main;
  await login(
    page,
    "inactive",
    "variant",
    route(store, "variant", product, product.variants.inactive),
  );
  await expect(
    panel(page, "variant").getByRole("button", { name: "Upload image", exact: true }),
  ).toBeEnabled();
  const image = await picture(page);
  expect(
    (
      await direct(
        page,
        api(store, "variant", product, product.variants.inactive),
        "POST",
        {},
        image,
      )
    ).status,
  ).toBe(201);
  await page.goto(route(store, "product", store.products.archived));
  await expect(panel(page)).toBeVisible();
  for (const name of ["Upload image", "Edit image", "Delete image", "Set as primary"])
    await expect(panel(page).getByRole("button", { name, exact: true })).toHaveCount(0);
  for (const kind of ["product", "variant"] as const) {
    const endpoint = api(store, kind, store.products.archived);
    const id = store.products.archived.assets[kind === "product" ? "product" : "first"];
    expect((await direct(page, endpoint, "POST", {}, image)).status).toBe(422);
    expect(
      (await direct(page, endpoint + "/" + id, "PATCH", { alt_text: "Archived" })).status,
    ).toBe(422);
    expect((await direct(page, endpoint + "/" + id, "DELETE")).status).toBe(422);
  }
});

test("real foreign wrong-parent cross-kind malformed and unknown media paths fail safely", async ({
  page,
}) => {
  const store = await ready(page, "foreign");
  const otherStore = fixtures.foreign.stores[1];
  const product = store.products.main;
  const other = store.products.other;
  const unknown = "f812a554-2994-4ec3-8d79-22460231c601";
  const image = await picture(page);
  for (const endpoint of [
    api(store, "product", otherStore.products.main),
    api(otherStore, "product", product),
    api(fixtures.permissions_all.stores[0]),
    api(store, "variant", other, product.variants.first),
    api(store, "variant", product, other.variants.first),
    api(store, "variant", product, otherStore.products.main.variants.first),
  ]) {
    expect((await direct(page, endpoint)).status).toBe(404);
    expect((await direct(page, endpoint, "POST", {}, image)).status).toBe(404);
  }
  for (const endpoint of [
    api(store) + "/" + other.assets.product,
    api(store) + "/" + product.assets.first,
    api(store, "variant") + "/" + product.assets.product,
    api(store, "variant") + "/" + product.assets.second,
    api(store) + "/" + otherStore.products.main.assets.product,
    api(store) + "/" + unknown,
    api(store) + "/malformed",
  ]) {
    for (const method of ["PATCH", "DELETE"]) {
      const result = await direct(
        page,
        endpoint,
        method,
        method === "PATCH" ? { alt_text: "Wrong authority" } : undefined,
      );
      expect(result.status).toBe(404);
      expect(JSON.stringify(result.body)).not.toMatch(/SQLSTATE|stack trace|storage_key|vendor\//i);
    }
  }
});

for (const verb of ["view", "create", "update", "delete"] as const)
  test(`real media ${verb} revocation closes stale controls after backend denial`, async ({
    page,
  }) => {
    const group = `revoke_${verb}`;
    const store = await ready(page, group);
    const file = await picture(page);
    control(group, `products.media.${verb}`);
    const endpoint = api(store);
    const asset = store.products.main.assets.product;
    const result =
      verb === "view"
        ? await direct(page, endpoint)
        : verb === "create"
          ? await direct(page, endpoint, "POST", {}, file)
          : await direct(
              page,
              endpoint + "/" + asset,
              verb === "update" ? "PATCH" : "DELETE",
              verb === "update" ? { alt_text: "Revoked" } : undefined,
            );
    expect(result.status).toBe(403);
    await page.getByRole("button", { name: "Refresh access", exact: true }).click();
    if (verb === "view") await expect(panel(page)).toHaveCount(0);
    else
      await expect(
        panel(page).getByRole("button", {
          name:
            verb === "create" ? "Upload image" : verb === "update" ? "Edit image" : "Delete image",
          exact: true,
        }),
      ).toHaveCount(0);
  });

async function startChange(
  page: Page,
  store: Store,
  method: "POST" | "PATCH" | "DELETE",
  kind: Kind = "product",
) {
  if (method === "POST") {
    await uploadForm(page, kind, await picture(page), "Pending new image");
    await panel(page, kind).getByRole("button", { name: "Upload image", exact: true }).click();
  } else if (method === "PATCH") {
    await panel(page, kind)
      .getByRole("listitem", { name: "Image 1", exact: true })
      .getByRole("button", { name: "Edit image", exact: true })
      .click();
    await panel(page, kind)
      .getByRole("textbox", { name: "Alt text", exact: true })
      .fill("Pending changed image");
    await panel(page, kind).getByRole("button", { name: "Save image", exact: true }).click();
  } else {
    await panel(page, kind)
      .getByRole("listitem", { name: "Image 1", exact: true })
      .getByRole("button", { name: "Delete image", exact: true })
      .click();
    await page
      .getByRole("alertdialog", { name: "Delete image?", exact: true })
      .getByRole("button", { name: "Delete image", exact: true })
      .click();
  }
}
async function uncertain(
  page: Page,
  group: string,
  method: "POST" | "PATCH" | "DELETE",
  committed: boolean,
  kind: Kind = "product",
) {
  const store = await ready(page, group, kind);
  const endpoint =
    api(store, kind) +
    (method === "POST"
      ? ""
      : "/" + store.products.main.assets[kind === "product" ? "product" : "first"]);
  await page.route(origin + endpoint, async (request) => {
    if (request.request().method() !== method) return request.continue();
    if (committed) {
      const actual = await request.fetch();
      expect(actual.status()).toBe(method === "POST" ? 201 : method === "PATCH" ? 200 : 204);
      evidence.set(page, { independentlyObservedCommit: { method, status: actual.status() } });
    }
    return request.abort("failed");
  });
  await startChange(page, store, method, kind);
  await expect(panel(page, kind)).toContainText("The result of this image change is unknown.");
  await expect(
    panel(page, kind).getByRole("button", { name: "Upload image", exact: true }),
  ).toHaveCount(0);
  if (method === "DELETE")
    await expect(
      panel(page, kind)
        .locator('div[tabindex="-1"]')
        .filter({ hasText: "The result of this image change is unknown." }),
    ).toBeFocused();
  expect(writes(page)).toHaveLength(1);
  await page.unroute(origin + endpoint);
  return store;
}

for (const kind of ["product", "variant"] as const)
  for (const method of ["POST", "PATCH", "DELETE"] as const)
    for (const committed of [true, false])
      test(`real ${committed ? "committed" : "uncommitted"} unknown ${kind} ${method} reviews current collection without replay or causal claim`, async ({
        page,
      }) => {
        const store = await uncertain(
          page,
          `${committed ? "committed" : "uncommitted"}_${method.toLowerCase()}`,
          method,
          committed,
          kind,
        );
        if (method === "POST") await capture(page, `unknown-${kind}-post-${committed}`);
        await review(page, kind);
        await expect(panel(page, kind)).toContainText(
          "does not prove whether the earlier request took effect",
        );
        await expect(
          panel(page, kind).getByRole("button", { name: "Image", exact: true }),
        ).toHaveCount(0);
        const collection = (await direct(page, api(store, kind))).body.data as Media[];
        expect(collection.length).toBe(
          committed ? (method === "POST" ? 2 : method === "DELETE" ? 0 : 1) : 1,
        );
        if (method === "PATCH")
          expect(collection[0].alt_text).toBe(
            committed
              ? "Pending changed image"
              : kind === "product"
                ? "Existing product image"
                : "Existing first image",
          );
        expect(writes(page)).toHaveLength(1);
        await upload(page, store, kind, await picture(page), "Fresh deliberate image");
        expect(writes(page)).toHaveLength(2);
      });

test("real failed collection review preserves unknown lock then successful review discards old file", async ({
  page,
}) => {
  const store = await uncertain(page, "failed_review", "POST", false);
  await page.route(origin + api(store), async (request) => request.abort("failed"));
  await panel(page).getByRole("button", { name: "Review current images", exact: true }).click();
  await expect(
    panel(page).getByRole("button", { name: "Review current images", exact: true }),
  ).toBeEnabled();
  await expect(panel(page)).toContainText("The result of this image change is unknown.");
  await expect(panel(page).getByRole("button", { name: "Upload image", exact: true })).toHaveCount(
    0,
  );
  await page.unroute(origin + api(store));
  await review(page, "product");
  await panel(page).getByRole("button", { name: "Upload image", exact: true }).click();
  expect(
    await panel(page)
      .getByRole("button", { name: "Image", exact: true })
      .evaluate((element) => (element as HTMLInputElement).files?.length),
  ).toBe(0);
  expect(writes(page)).toHaveLength(1);
});

test("real confirmed upload retains success when secondary Product refresh fails", async ({
  page,
}) => {
  const store = await ready(page, "refresh_failure");
  await page.route(origin + base(store), async (request) => request.abort("failed"));
  await upload(page, store, "product", await picture(page));
  await expect(panel(page)).toContainText("Image uploaded.");
  await expect(panel(page)).toContainText("The change is confirmed");
  await expect(panel(page)).not.toContainText("The result of this image change is unknown.");
  expect(writes(page)).toHaveLength(1);
});

for (const interval of [0, 50, 120, 300, 450])
  test(`real upload double submit at ${interval}ms dispatches one multipart request`, async ({
    page,
  }) => {
    const store = await ready(page, `double_${interval}`);
    await uploadForm(page, "product", await picture(page));
    await panel(page)
      .getByRole("textbox", { name: "Alt text", exact: true })
      .evaluate((input, delay) => {
        const form = input.closest("form")!;
        form.requestSubmit();
        window.setTimeout(() => form.requestSubmit(), delay);
      }, interval);
    await expect(panel(page)).toContainText("Image uploaded.");
    await page.waitForTimeout(interval + 100);
    expect(writes(page)).toHaveLength(1);
    expect((await direct(page, api(store))).body.data).toHaveLength(2);
  });

test("real repeated Enter cannot replay a consumed upload", async ({ page }) => {
  await ready(page, "enter");
  await uploadForm(page, "product", await picture(page));
  await panel(page).getByRole("textbox", { name: "Alt text", exact: true }).press("Enter");
  await page.keyboard.press("Enter");
  await expect(panel(page)).toContainText("Image uploaded.");
  await page.keyboard.press("Enter");
  expect(writes(page)).toHaveLength(1);
});

async function navigate(
  page: Page,
  store: Store,
  product = store.products.main,
  variant = product.variants.first,
) {
  await page.getByRole("link", { name: "Products", exact: true }).first().click();
  await page.getByRole("link", { name: product.name, exact: true }).click();
  await page.getByRole("link", { name: "Manage variants", exact: true }).click();
  await page
    .locator(`a[href='/stores/${store.id}/products/${product.id}/variants/${variant}']`)
    .click();
  await expect(page).toHaveURL(new RegExp(`/variants/${variant}$`));
}
async function hold(page: Page, endpoint: string, method: string) {
  let release!: () => void;
  let received!: () => void;
  let done!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const actualReceived = new Promise<void>((resolve) => {
    received = resolve;
  });
  const completed = new Promise<void>((resolve) => {
    done = resolve;
  });
  await page.route(origin + endpoint, async (request) => {
    if (request.request().method() !== method) return request.continue();
    const actual = await request.fetch();
    expect(actual.ok()).toBe(true);
    received();
    await gate;
    try {
      await request.fulfill({ response: actual });
    } catch {
      /* Navigation can legitimately abort the held request. */
    } finally {
      done();
    }
  });
  return { release, received: actualReceived, done: completed };
}

for (const boundary of ["switch", "product", "variant", "principal"] as const)
  for (const method of ["GET", "POST", "PATCH", "DELETE"] as const)
    test(`real delayed media ${method} cannot cross ${boundary} authority`, async ({ page }) => {
      const group = `${boundary}_${method.toLowerCase()}`;
      const store = fixtures[group].stores[0];
      const endpoint =
        api(store, "variant") +
        (method === "PATCH" || method === "DELETE" ? "/" + store.products.main.assets.first : "");
      const delayed = method === "GET" ? await hold(page, endpoint, method) : undefined;
      await login(
        page,
        group,
        "variant",
        method === "DELETE" ? route(store, "product") : route(store, "variant"),
      );
      if (method === "DELETE") await navigate(page, store);
      if (!delayed)
        await expect(
          panel(page, "variant").getByRole("button", { name: "Upload image", exact: true }),
        ).toBeEnabled();
      const operation = delayed ?? (await hold(page, endpoint, method));
      try {
        if (method !== "GET") await startChange(page, store, method, "variant");
        await operation.received;
        await page.evaluate(() => Object.assign(window, { __mediaDocument: true }));
        if (method === "DELETE") {
          await page.goBack();
          await expect(page.getByRole("alertdialog")).toHaveCount(0);
        }
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
          destination = fixtures.permissions_view.stores[0];
          product = destination.products.main;
          variant = product.variants.first;
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
        await navigate(page, destination, product, variant);
        const expectedAlt =
          boundary === "variant" ? "Existing second image" : "Existing first image";
        await expect(panel(page, "variant")).toContainText(expectedAlt);
        operation.release();
        await operation.done;
        await expect(panel(page, "variant")).toContainText(expectedAlt);
        await expect(panel(page, "variant")).not.toContainText("Pending changed image");
        await expect(panel(page, "variant")).not.toContainText("Pending new image");
        await expect(panel(page, "variant")).not.toContainText("Image uploaded.");
        await expect(panel(page, "variant")).not.toContainText("Image deleted.");
        expect(
          (await direct(page, api(destination, "variant", product, variant))).body.data.map(
            (item: Media) => item.id,
          ),
        ).toEqual([product.assets[boundary === "variant" ? "second" : "first"]]);
        expect(
          await page.evaluate(
            () => (window as unknown as { __mediaDocument: boolean }).__mediaDocument,
          ),
        ).toBe(true);
        expect(writes(page)).toHaveLength(method === "GET" ? 0 : 1);
      } finally {
        operation.release();
      }
    });

test("real unknown upload survives same-document Product navigation and remount", async ({
  page,
}) => {
  const store = await uncertain(page, "remount", "POST", true);
  await page.getByRole("link", { name: "Products", exact: true }).first().click();
  await page.getByRole("link", { name: store.products.other.name, exact: true }).click();
  await expect(panel(page)).not.toContainText("The result of this image change is unknown.");
  await page.getByRole("link", { name: "Products", exact: true }).first().click();
  await page.getByRole("link", { name: store.products.main.name, exact: true }).click();
  await expect(panel(page)).toContainText("The result of this image change is unknown.");
  await expect(panel(page).getByRole("button", { name: "Upload image", exact: true })).toHaveCount(
    0,
  );
  await review(page, "product");
  expect(writes(page)).toHaveLength(1);
});

test("real unsafe media URLs fail closed before browser image requests", async ({ page }) => {
  const store = fixtures.unsafe.stores[0];
  const requested: string[] = [];
  page.on("request", (request) => {
    if (request.resourceType() === "image") requested.push(request.url());
  });
  await page.route(origin + api(store), async (request) => {
    const actual = await request.fetch();
    const data = await actual.json();
    data.data[0].url =
      "https://unsafe.invalid/storage/catalog/11111111-1111-4111-8111-111111111111";
    await request.fulfill({ response: actual, body: JSON.stringify(data) });
  });
  await login(page, "unsafe");
  await expect(
    panel(page).getByRole("button", { name: "Refresh images", exact: true }),
  ).toBeVisible();
  expect(requested.some((url) => url.includes("unsafe.invalid"))).toBe(false);
  await expect(panel(page).getByRole("img")).toHaveCount(0);
});

test("real media responsive empty upload validation pending success and populated surfaces have focused axe coverage", async ({
  page,
}) => {
  const store = await ready(page, "responsive");
  await capture(page, "empty", [1440, 1024, 768, 390]);
  await panel(page).getByRole("button", { name: "Upload image", exact: true }).click();
  await panel(page).getByRole("button", { name: "Upload image", exact: true }).click();
  await expect(panel(page).getByRole("button", { name: "Image", exact: true })).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  await expect(panel(page).getByRole("button", { name: "Image", exact: true })).toBeFocused();
  await capture(page, "upload-validation");
  await panel(page)
    .getByRole("button", { name: "Image", exact: true })
    .setInputFiles(await picture(page));
  await panel(page)
    .getByRole("textbox", { name: "Alt text", exact: true })
    .fill("Green product sample");
  const held = await hold(page, api(store), "POST");
  await panel(page).getByRole("button", { name: "Upload image", exact: true }).click();
  await held.received;
  await capture(page, "upload-pending");
  held.release();
  await held.done;
  await expect(panel(page)).toContainText("Image uploaded.");
  await capture(page, "upload-success");
  await review(page, "product");
  await capture(page, "populated", [1440, 1024, 768, 390]);
});
