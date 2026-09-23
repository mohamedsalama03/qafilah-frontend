import { expect, test, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";

const apiOrigin = "https://localhost:3844";
type Media = {
  id: string;
  url: string;
  mime_type: string;
  byte_size: number;
  width: number;
  height: number;
};
type Product = { id: string; variants: { first: string } };
type Fixture = {
  email: string;
  password: string;
  stores: { id: string; products: { main: Product } }[];
};
const fixture = (
  JSON.parse(readFileSync("artifacts/f3f/runtime/media-fixtures.json", "utf8")) as Record<
    string,
    Fixture
  >
).production;
const store = fixture.stores[0];
const product = store.products.main;
const productRoute = `/stores/${store.id}/products/${product.id}`;
const variantsRoute = `${productRoute}/variants/${product.variants.first}`;
const endpoint = (variant: boolean) =>
  `/api/v1/stores/${store.id}/catalog/products/${product.id}${variant ? `/variants/${product.variants.first}` : ""}/media`;
const panel = (page: Page, variant: boolean) =>
  page.getByRole("region", { name: variant ? "Variant images" : "Product images", exact: true });

test("fresh production image private routes fail closed with exact scoped media CSP", async ({
  page,
}) => {
  const results = [];
  for (const target of [productRoute, variantsRoute, `/stores/${store.id}/products/new`]) {
    const response = await page.goto(target);
    expect(response!.headers()["cache-control"]).toMatch(/private.*no-store|no-store.*private/);
    const csp = response!.headers()["content-security-policy"];
    expect(
      csp
        .split(";")
        .find((part) => part.trim().startsWith("img-src"))
        ?.trim(),
    ).toBe("img-src 'self' data: https://localhost:3844/storage/catalog/");
    expect(csp).not.toContain("unsafe-eval");
    await expect(page).toHaveURL(/\/login\?returnTo=/);
    await expect(page.getByRole("textbox", { name: "Email address", exact: true })).toBeVisible();
    await expect(page.getByRole("region", { name: /^(Product|Variant) images$/ })).toHaveCount(0);
    results.push({
      target,
      private: true,
      noStore: true,
      failClosed: true,
      imgSrc: "img-src 'self' data: https://localhost:3844/storage/catalog/",
    });
  }
  await writeFile("artifacts/f3f/production-private-pages.json", JSON.stringify(results, null, 2));
});

test("fresh production image renders six real public images with CSP enforcement and persistent published storage", async ({
  page,
  playwright,
}) => {
  const runtimeErrors: string[] = [];
  const mutations: { method: string; path: string; csrf: boolean; multipart: boolean }[] = [];
  page.on("pageerror", (error) => runtimeErrors.push(error.message));
  page.on("request", (request) => {
    if (
      request.url().startsWith(apiOrigin) &&
      request.method() === "POST" &&
      request.url().endsWith("/media")
    )
      mutations.push({
        method: request.method(),
        path: new URL(request.url()).pathname,
        csrf: !!request.headers()["x-xsrf-token"],
        multipart: /^multipart\/form-data; boundary=/.test(request.headers()["content-type"] ?? ""),
      });
  });
  await page.goto(`/login?returnTo=${encodeURIComponent(productRoute)}`);
  await page.getByRole("textbox", { name: "Email address", exact: true }).fill(fixture.email);
  await page.getByLabel(/^Password/).fill(fixture.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(productRoute + "$"));
  const anonymous = await playwright.request.newContext({ ignoreHTTPSErrors: true });
  const records: { variant: boolean; media: Media; sha256: string; mime: string; bytes: number }[] =
    [];
  for (const variant of [false, true]) {
    if (variant) await page.goto(variantsRoute);
    const region = panel(page, variant);
    for (const mime of ["image/jpeg", "image/png", "image/webp"]) {
      const encoded = await page.evaluate((type) => {
        const canvas = document.createElement("canvas");
        canvas.width = 24;
        canvas.height = 18;
        const context = canvas.getContext("2d")!;
        context.fillStyle = "#6b9278";
        context.fillRect(0, 0, 24, 18);
        return canvas.toDataURL(type).split(",")[1];
      }, mime);
      const bytes = Buffer.from(encoded, "base64");
      await region.getByRole("button", { name: "Upload image", exact: true }).click();
      await region
        .getByRole("button", { name: "Image", exact: true })
        .setInputFiles({ name: `production.${mime.split("/")[1]}`, mimeType: mime, buffer: bytes });
      const alt = `${variant ? "Variant" : "Product"} ${mime} production`;
      await region.getByRole("textbox", { name: "Alt text", exact: true }).fill(alt);
      const received = page.waitForResponse(
        (response) =>
          response.url() === apiOrigin + endpoint(variant) &&
          response.request().method() === "POST",
      );
      await region.getByRole("button", { name: "Upload image", exact: true }).click();
      const response = await received;
      expect(response.status()).toBe(201);
      const media = (await response.json()).data as Media;
      await expect(region).toContainText("Image uploaded.");
      await region.getByRole("button", { name: "Review current images", exact: true }).click();
      const thumbnail = region.getByRole("img", { name: alt, exact: true });
      await expect(thumbnail).toHaveAttribute("src", apiOrigin + media.url);
      await expect
        .poll(() => thumbnail.evaluate((node) => (node as HTMLImageElement).naturalWidth))
        .toBe(24);
      const image = await anonymous.get(apiOrigin + media.url);
      expect(image.status()).toBe(200);
      expect(image.headers()["content-type"]).toBe(mime);
      expect((await image.body()).equals(bytes)).toBe(true);
      records.push({
        variant,
        media,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        mime,
        bytes: bytes.length,
      });
    }
  }
  await page.evaluate(() => {
    Object.assign(window, { __mediaCspViolations: [] as { directive: string; uri: string }[] });
    document.addEventListener("securitypolicyviolation", (event) => {
      (
        window as unknown as { __mediaCspViolations: { directive: string; uri: string }[] }
      ).__mediaCspViolations.push({ directive: event.effectiveDirective, uri: event.blockedURI });
    });
  });
  await page.evaluate((api) => {
    for (const url of [
      api + "/up",
      "https://unapproved.example.invalid/storage/catalog/11111111-1111-4111-8111-111111111111",
    ]) {
      const image = document.createElement("img");
      image.src = url;
      image.alt = "CSP negative probe";
      document.body.append(image);
    }
  }, apiOrigin);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { __mediaCspViolations: unknown[] }).__mediaCspViolations.length,
      ),
    )
    .toBe(2);
  const cspViolations = await page.evaluate(
    () =>
      (window as unknown as { __mediaCspViolations: { directive: string; uri: string }[] })
        .__mediaCspViolations,
  );
  expect(cspViolations.every((item) => item.directive === "img-src")).toBe(true);
  const recreation = JSON.parse(
    execFileSync(
      "pwsh",
      ["-NoProfile", "-File", "artifacts/f3f/runtime/recreate-media-services.ps1"],
      { encoding: "utf8", timeout: 120_000, stdio: ["ignore", "pipe", "pipe"] },
    ),
  );
  expect(recreation.appChanged).toBe(true);
  expect(recreation.nginxChanged).toBe(true);
  expect(recreation.sameMediaVolume).toBe(true);
  for (const record of records) {
    const image = await anonymous.get(apiOrigin + record.media.url);
    expect(image.status()).toBe(200);
    expect(image.headers()["content-type"]).toBe(record.mime);
    expect(
      createHash("sha256")
        .update(await image.body())
        .digest("hex"),
    ).toBe(record.sha256);
  }
  for (const variant of [false, true]) {
    await page.goto(variant ? variantsRoute : productRoute);
    const thumbnails = panel(page, variant).getByRole("img");
    await expect(thumbnails).toHaveCount(3);
    for (const image of await thumbnails.all())
      await expect
        .poll(() => image.evaluate((node) => (node as HTMLImageElement).naturalWidth))
        .toBe(24);
  }
  expect(runtimeErrors).toEqual([]);
  expect(mutations).toHaveLength(6);
  expect(mutations.every((item) => item.csrf && item.multipart)).toBe(true);
  await writeFile(
    "artifacts/f3f/production-public-images.json",
    JSON.stringify(
      {
        backendAuthority: "7cd52e549c2a657dc66643b36701356d1d024de5",
        apiOrigin,
        frontendOrigin: "https://localhost:3002",
        anonymousPublicDelivery: true,
        noSyntheticDomainResponses: true,
        records,
        recreation,
        cspViolations,
        mutations,
        runtimeErrors,
      },
      null,
      2,
    ),
  );
  await anonymous.dispose();
});
