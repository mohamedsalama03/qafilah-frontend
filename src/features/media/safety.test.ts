import { describe, expect, it, vi } from "vitest";
import type { MerchantProduct } from "@/features/products/contracts";
import type { MerchantVariant } from "@/features/variants/contracts";
import { ApiError } from "@/lib/api/errors";
import { createAuthController } from "@/lib/auth/controller";
import { createMerchantApi, type MerchantApi } from "@/lib/backend/client";
import type { MerchantStoreContext } from "@/lib/backend/contracts";
import { createQueryClient } from "@/lib/query/client";
import { createScopeController } from "@/lib/query/scope";
import { createStoreController } from "@/lib/stores/controller";
import type { MerchantMedia, MediaTarget, ProductMedia } from "./contracts";
import {
  createMediaMutationController,
  getMediaMutationController,
  type MediaIntent,
} from "./mutations";
import { mediaKeys } from "./queries";

const STORE = "a1111111-1111-4111-8111-111111111111";
const OTHER_STORE = "a2222222-2222-4222-8222-222222222222";
const PRODUCT = "b1111111-1111-4111-8111-111111111111";
const OTHER_PRODUCT = "b2222222-2222-4222-8222-222222222222";
const VARIANT = "c1111111-1111-4111-8111-111111111111";
const OTHER_VARIANT = "c2222222-2222-4222-8222-222222222222";
const ASSET = "d1111111-1111-4111-8111-111111111111";
const NEW_ASSET = "d2222222-2222-4222-8222-222222222222";
const grants = [
  "products.view",
  "products.variants.view",
  "products.media.view",
  "products.media.create",
  "products.media.update",
  "products.media.delete",
];
const stamp = "2026-09-01T00:00:00+00:00";
const product: MerchantProduct = {
  id: PRODUCT,
  name: "Media safety",
  slug: "media-safety",
  description: "Independent media fixture",
  type: "variant",
  status: "draft",
  requires_shipping: true,
  seo_title: null,
  seo_description: null,
  published_at: null,
  price: null,
  quantity: null,
  availability: "unavailable",
  categories: [],
  created_at: stamp,
  updated_at: stamp,
};
const variant: MerchantVariant = {
  id: VARIANT,
  value_ids: [OTHER_VARIANT],
  sku: null,
  status: "inactive",
  price: null,
  quantity: null,
  availability: "unavailable",
  created_at: stamp,
  updated_at: stamp,
};
function asset(kind: MediaTarget["kind"], id = ASSET): MerchantMedia {
  const shared = {
    id,
    url: `/storage/catalog/${id}`,
    mime_type: "image/png" as const,
    byte_size: 8,
    width: 1,
    height: 1,
    alt_text: null,
    position: 0,
    created_at: stamp,
    updated_at: stamp,
  };
  return kind === "product" ? { ...shared, is_primary: true } : shared;
}
const context = (id: string, permissions = grants): MerchantStoreContext => ({
  store: { id, name: "Safety store", status: "active" },
  membership: { id: PRODUCT, status: "active" },
  role: { id: OTHER_PRODUCT, name: "Independent media" },
  permissions,
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((accept, fail) => {
    resolve = accept;
    reject = fail;
  });
  return { promise, resolve, reject };
}
const intents = {
  create: (): MediaIntent => ({
    operation: "create",
    data: { image: new File(["private upload"], "private.png", { type: "image/png" }) },
  }),
  update: (): MediaIntent => ({
    operation: "update",
    mediaUuid: ASSET,
    data: { alt_text: "Reviewed view" },
  }),
  delete: (): MediaIntent => ({ operation: "delete", mediaUuid: ASSET }),
};
const cases = (["product", "variant"] as const).flatMap((kind) =>
  (["create", "update", "delete"] as const).map((operation) => ({ kind, operation })),
);
async function fixture(kind: MediaTarget["kind"] = "product", principalId = "media-principal") {
  const api: MerchantApi = {
    ...createMerchantApi({ apiOrigin: "https://api.example.test", fetch: vi.fn<typeof fetch>() }),
    authAdapter: {
      loadIdentity: vi.fn(async () => ({ principalId })),
      logout: vi.fn(async () => {}),
    },
    listStoresPage: vi.fn(async () => ({
      stores: [context(STORE).store, context(OTHER_STORE).store],
      pagination: { current_page: 1, last_page: 1, per_page: 20, total: 2 },
    })),
    loadStoreContext: vi.fn(async (id) => context(id)),
    loadProduct: vi.fn(async () => product),
    loadProductVariant: vi.fn(async () => variant),
    listProductMedia: vi.fn(async () => [asset("product") as ProductMedia]),
    listVariantMedia: vi.fn(async () => [asset("variant")]),
    createProductMedia: vi.fn(async () => asset("product", NEW_ASSET) as ProductMedia),
    createVariantMedia: vi.fn(async () => asset("variant", NEW_ASSET)),
    updateProductMedia: vi.fn(async () => asset("product") as ProductMedia),
    updateVariantMedia: vi.fn(async () => asset("variant")),
    deleteProductMedia: vi.fn(async () => {}),
    deleteVariantMedia: vi.fn(async () => {}),
  };
  const queryClient = createQueryClient();
  const scope = createScopeController(queryClient);
  const auth = createAuthController({
    adapter: api.authAdapter,
    onAuthorityLost: () => scope.clear(),
  });
  await auth.bootstrap();
  const session = { queryClient, scope, auth, onAuthorityLost: () => () => {} };
  const stores = createStoreController({
    principalId,
    api,
    queryClient,
    scope,
    onSessionError: auth.handleScopedReadError,
  });
  await stores.select(STORE);
  const target: MediaTarget =
    kind === "product"
      ? { kind, productUuid: PRODUCT }
      : { kind, productUuid: PRODUCT, variantUuid: VARIANT };
  const options = () => ({
    api,
    session,
    stores,
    scope: stores.getSnapshot().scope!,
    product,
    ...(kind === "variant" ? { variant } : {}),
  });
  const seed = () =>
    queryClient.setQueryData(mediaKeys.list(stores.getSnapshot().scope!, target), [asset(kind)]);
  seed();
  const controller = () => getMediaMutationController(options());
  const method = (operation: MediaIntent["operation"]) =>
    kind === "product"
      ? operation === "create"
        ? api.createProductMedia
        : operation === "update"
          ? api.updateProductMedia
          : api.deleteProductMedia
      : operation === "create"
        ? api.createVariantMedia
        : operation === "update"
          ? api.updateVariantMedia
          : api.deleteVariantMedia;
  return {
    api,
    queryClient,
    scope,
    auth,
    session,
    stores,
    target,
    options,
    seed,
    controller,
    method,
  };
}

describe("Media independent navigation and payload safety probes", () => {
  it.each(cases)(
    "preserves unknown $kind $operation across Store A to B to A",
    async ({ kind, operation }) => {
      const f = await fixture(kind);
      vi.mocked(f.method(operation)).mockRejectedValueOnce(
        new ApiError("network", { mutationOutcome: "unknown" }),
      );
      await f.controller().execute(intents[operation]());
      await f.stores.select(OTHER_STORE);
      expect(f.controller().getSnapshot().status).toBe("idle");
      await f.stores.select(STORE);
      f.seed();
      const returned = f.controller();
      expect(returned.getSnapshot()).toMatchObject({
        status: "unknown",
        operation: null,
        result: null,
        collection: null,
      });
      for (const intent of Object.values(intents))
        expect(await returned.execute(intent())).toBeNull();
      await returned.reconcile(0);
      expect(returned.getSnapshot()).toMatchObject({
        status: "idle",
        slot: 1,
        reviewedUnknown: true,
      });
      expect(f.method(operation)).toHaveBeenCalledTimes(1);
      expect(await returned.execute(intents[operation](), 0)).toBeNull();
      expect(f.method(operation)).toHaveBeenCalledTimes(1);
    },
  );
  it.each(cases)(
    "retains abandoned $kind $operation even when transport settles after departure",
    async ({ kind, operation }) => {
      const f = await fixture(kind);
      const response = deferred<MerchantMedia | void>();
      vi.mocked(f.method(operation)).mockReturnValueOnce(response.promise as never);
      const before = f.stores.getSnapshot().scope!;
      const pending = f.controller().execute(intents[operation]());
      await vi.waitFor(() => expect(f.method(operation)).toHaveBeenCalledTimes(1));
      await f.stores.select(OTHER_STORE);
      await pending;
      response.resolve(
        operation === "delete"
          ? undefined
          : asset(kind, operation === "create" ? NEW_ASSET : ASSET),
      );
      await Promise.resolve();
      expect(f.queryClient.getQueryData(mediaKeys.list(before, f.target))).toBeUndefined();
      await f.stores.select(STORE);
      f.seed();
      expect(f.controller().getSnapshot().status).toBe("unknown");
      expect(await f.controller().execute(intents[operation]())).toBeNull();
      expect(f.method(operation)).toHaveBeenCalledTimes(1);
    },
  );
  it("does not lend an unknown Product upload to another Product, Variant kind, or session", async () => {
    const f = await fixture();
    vi.mocked(f.api.createProductMedia).mockRejectedValueOnce(
      new ApiError("timeout", { mutationOutcome: "unknown" }),
    );
    await f.controller().execute(intents.create());
    expect(
      getMediaMutationController({
        ...f.options(),
        product: { ...product, id: OTHER_PRODUCT },
      }).getSnapshot().status,
    ).toBe("idle");
    expect(getMediaMutationController({ ...f.options(), variant }).getSnapshot().status).toBe(
      "idle",
    );
    const different = await fixture("product", "another-principal");
    expect(different.controller().getSnapshot().status).toBe("idle");
    expect(f.controller().getSnapshot().status).toBe("unknown");
  });
  it("keeps separate unresolved Variant collections within one Product", async () => {
    const f = await fixture("variant");
    vi.mocked(f.api.deleteVariantMedia).mockRejectedValueOnce(
      new ApiError("network", { mutationOutcome: "unknown" }),
    );
    await f.controller().execute(intents.delete());
    const other = getMediaMutationController({
      ...f.options(),
      variant: { ...variant, id: OTHER_VARIANT },
    });
    expect(other.getSnapshot().status).toBe("idle");
    expect(f.controller().getSnapshot().status).toBe("unknown");
  });
  it("preserves payload-free uncertainty across an authority revision", async () => {
    const f = await fixture();
    vi.mocked(f.api.createProductMedia).mockRejectedValueOnce(
      new ApiError("network", { mutationOutcome: "unknown" }),
    );
    const first = f.controller();
    await first.execute(intents.create());
    vi.mocked(f.api.loadStoreContext).mockResolvedValue(
      context(STORE, [...grants, "products.update"]),
    );
    await f.stores.revalidate();
    const next = f.controller();
    expect(next).not.toBe(first);
    expect(next.getSnapshot()).toMatchObject({
      status: "unknown",
      operation: null,
      result: null,
      collection: null,
    });
    expect(JSON.stringify(next.getSnapshot())).not.toMatch(
      /private\.png|private upload|image|alt_text/,
    );
    f.seed();
    await next.reconcile();
    expect(next.getSnapshot().status).toBe("idle");
    expect(f.api.createProductMedia).toHaveBeenCalledTimes(1);
  });
  it("retains the review lock after permissions are revoked", async () => {
    const f = await fixture();
    vi.mocked(f.api.deleteProductMedia).mockRejectedValueOnce(
      new ApiError("network", { mutationOutcome: "unknown" }),
    );
    await f.controller().execute(intents.delete());
    vi.mocked(f.api.loadStoreContext).mockResolvedValue(
      context(
        STORE,
        grants.filter((permission) => permission !== "products.media.view"),
      ),
    );
    await f.stores.revalidate();
    const next = f.controller();
    await next.reconcile();
    expect(next.getSnapshot().status).toBe("unknown");
    expect(f.api.listProductMedia).not.toHaveBeenCalled();
    expect(f.api.deleteProductMedia).toHaveBeenCalledTimes(1);
  });
  it("a late completion from an abandoned revision cannot clear a newer uncertain attempt", async () => {
    const f = await fixture();
    const oldResponse = deferred<ProductMedia>();
    vi.mocked(f.api.createProductMedia)
      .mockReturnValueOnce(oldResponse.promise)
      .mockRejectedValueOnce(new ApiError("network", { mutationOutcome: "unknown" }));
    const old = f.controller();
    const pending = old.execute(intents.create());
    await vi.waitFor(() => expect(f.api.createProductMedia).toHaveBeenCalledTimes(1));
    await f.stores.select(OTHER_STORE);
    await pending;
    await f.stores.select(STORE);
    f.seed();
    const next = f.controller();
    await next.reconcile();
    await next.execute(intents.create());
    expect(next.getSnapshot().status).toBe("unknown");
    oldResponse.resolve(asset("product", NEW_ASSET) as ProductMedia);
    await Promise.resolve();
    vi.mocked(f.api.loadStoreContext).mockResolvedValue(
      context(STORE, [...grants, "products.update"]),
    );
    await f.stores.revalidate();
    expect(f.controller().getSnapshot().status).toBe("unknown");
    expect(f.api.createProductMedia).toHaveBeenCalledTimes(2);
  });
  it("an older overlapping review cannot clear a different newer attempt token", async () => {
    const f = await fixture();
    vi.mocked(f.api.createProductMedia).mockRejectedValue(
      new ApiError("network", { mutationOutcome: "unknown" }),
    );
    const first = f.controller();
    await first.execute(intents.create());
    const other = createMediaMutationController(f.options());
    const delayedReview = deferred<ProductMedia[]>();
    vi.mocked(f.api.listProductMedia).mockReturnValueOnce(delayedReview.promise);
    const reviewing = first.reconcile();
    await vi.waitFor(() => expect(f.api.listProductMedia).toHaveBeenCalledTimes(1));
    await other.reconcile();
    await other.execute(intents.create());
    expect(other.getSnapshot().status).toBe("unknown");
    delayedReview.resolve([]);
    await reviewing;
    expect(first.getSnapshot().status).toBe("unknown");
    expect(await first.execute(intents.create())).toBeNull();
    expect(f.api.createProductMedia).toHaveBeenCalledTimes(2);
  });
  it("pre-dispatch CSRF failure is a known failure and leaves no unresolved upload token", async () => {
    const f = await fixture();
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new TypeError("offline"));
    f.api.createProductMedia = createMerchantApi({
      apiOrigin: "https://api.example.test",
      fetch: fetcher,
      readCookie: () => "XSRF-TOKEN=synthetic",
    }).createProductMedia;
    await f.controller().execute(intents.create());
    expect(f.controller().getSnapshot()).toMatchObject({
      status: "error",
      error: { mutationOutcome: "not-applicable" },
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    await f.stores.select(OTHER_STORE);
    await f.stores.select(STORE);
    expect(f.controller().getSnapshot().status).toBe("idle");
  });
  it("does not retain a File or metadata in success/error/unknown controller snapshots", async () => {
    const f = await fixture();
    const pending = deferred<ProductMedia>();
    vi.mocked(f.api.createProductMedia).mockReturnValueOnce(pending.promise);
    const task = f.controller().execute(intents.create());
    expect(JSON.stringify(f.controller().getSnapshot())).not.toMatch(
      /private\.png|private upload|"image"/,
    );
    pending.reject(new ApiError("network", { mutationOutcome: "unknown" }));
    await task;
    expect(JSON.stringify(f.controller().getSnapshot())).not.toMatch(
      /private\.png|private upload|"image"/,
    );
    await f.controller().reconcile();
    await f.controller().execute(intents.create());
    expect(JSON.stringify(f.controller().getSnapshot())).not.toMatch(
      /private\.png|private upload|"image"/,
    );
  });
});
