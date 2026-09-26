import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { merchantContracts } from "../../src/lib/backend/contracts";

const authority = process.env.F3G_BACKEND_AUTHORITY;
if (
  ![
    "7cd52e549c2a657dc66643b36701356d1d024de5",
    "4c86b8429f6d3e26d07129494de99f7f5b76db73",
  ].includes(authority ?? "")
)
  throw new Error("Select an exact F3-G backend authority.");
const candidate = authority === "4c86b8429f6d3e26d07129494de99f7f5b76db73";
const apiOrigin = process.env.F3G_API_ORIGIN!;
const fixture = JSON.parse(readFileSync(process.env.F3G_FIXTURES!, "utf8")) as {
  email: string;
  password: string;
  stores: Array<{
    id: string;
    name: string;
    currency: "LYD" | "USD" | "EUR" | null;
    product: { id: string; name: string };
  }>;
};

for (const store of fixture.stores) {
  test(`real ${candidate ? "candidate" : "published"} backend login discovery context and Product workspace: ${store.currency ?? "null"}`, async ({
    page,
  }) => {
    const errors: string[] = [];
    const pricing: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("request", (request) => {
      if (
        new URL(request.url()).origin === apiOrigin &&
        /\/pricing(?:\/|$)/.test(new URL(request.url()).pathname)
      )
        pricing.push(request.method());
    });
    await page.goto("/login");
    await page.getByRole("textbox", { name: "Email address", exact: true }).fill(fixture.email);
    await page.getByLabel(/^Password/).fill(fixture.password);
    const discoveryResponse = page.waitForResponse((response) =>
      response.url().startsWith(`${apiOrigin}/api/v1/me/stores`),
    );
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    const discovery = await discoveryResponse;
    expect(discovery.status()).toBe(200);
    const stores = merchantContracts.stores.decode(await discovery.json()).stores;
    expect(stores).toHaveLength(4);
    for (const entry of stores) expect(Object.keys(entry).sort()).toEqual(["id", "name", "status"]);
    await expect(page.getByRole("button", { name: /^Open / })).toHaveCount(4);
    const selectedResponse = page.waitForResponse(`${apiOrigin}/api/v1/stores/${store.id}/context`);
    await page.getByRole("button", { name: `Open ${store.name}`, exact: true }).click();
    const selected = await selectedResponse;
    expect(selected.status()).toBe(200);
    const decoded = merchantContracts.context.decode(await selected.json());
    expect(decoded.store.id).toBe(store.id);
    expect(Object.hasOwn(decoded.store, "currency")).toBe(candidate);
    if (candidate) expect(decoded.store.currency).toBe(store.currency);
    await expect(page.getByRole("heading", { name: "Store overview", exact: true })).toBeVisible();
    await expect(page.getByRole("region", { name: "Current store", exact: true })).toContainText(
      store.name,
    );
    await page.getByRole("link", { name: "Products", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Products", exact: true })).toBeVisible();
    await page.getByRole("link", { name: store.product.name, exact: true }).click();
    await expect(
      page.getByRole("heading", { name: store.product.name, exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("textbox", { name: /currency/i })).toHaveCount(0);
    const persistence = await page.evaluate(async () => ({
      local: Object.keys(localStorage),
      session: Object.keys(sessionStorage),
      databases: await indexedDB.databases(),
    }));
    expect(persistence.local).toEqual([]);
    expect(persistence.session).toEqual([]);
    // Next development tooling owns this database; inspect its records rather than
    // treating framework debug metadata as application currency persistence.
    expect(persistence.databases.filter((db) => db.name !== "__next_debug_channel")).toEqual([]);
    const records = await page.evaluate(async () => {
      const output: string[] = [];
      for (const entry of await indexedDB.databases()) {
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          const open = indexedDB.open(entry.name!);
          open.onsuccess = () => resolve(open.result);
          open.onerror = () => reject(open.error);
        });
        for (const name of Array.from(db.objectStoreNames)) {
          const values = await new Promise<unknown[]>((resolve, reject) => {
            const read = db.transaction(name, "readonly").objectStore(name).getAll();
            read.onsuccess = () => resolve(read.result);
            read.onerror = () => reject(read.error);
          });
          output.push(
            JSON.stringify(values, (_key, value: unknown) =>
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
    expect(records.some((value) => /\bcurrency\b|\b(?:LYD|USD|EUR)\b/i.test(value))).toBe(false);
    expect(pricing).toEqual([]);
    expect(errors).toEqual([]);
  });
}
