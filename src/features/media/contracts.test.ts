// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { createMerchantApi } from "@/lib/backend/client";
import { merchantContracts } from "@/lib/backend/contracts";
import {
  decodeProductMedia,
  decodeVariantMedia,
  decodeProductMediaList,
  decodeVariantMediaList,
  type CreateProductMediaInput,
} from "./contracts";
const storeUuid = "11111111-1111-4111-8111-111111111111",
  productUuid = "22222222-2222-4222-8222-222222222222",
  variantUuid = "33333333-3333-4333-8333-333333333333",
  mediaUuid = "44444444-4444-4444-8444-444444444444",
  other = "55555555-5555-4555-8555-555555555555";
const input = { storeUuid, productUuid, variantUuid, mediaUuid };
const media = {
  id: mediaUuid,
  url: `/storage/catalog/${other}`,
  mime_type: "image/png",
  byte_size: 100,
  width: 10,
  height: 10,
  alt_text: null,
  position: 0,
  created_at: "2026-09-23T00:00:00+00:00",
  updated_at: "2026-09-23T00:00:00+00:00",
};
const product = { ...media, is_primary: true };
const envelope = (data: unknown) => ({
  success: true,
  data,
  meta: { request_id: other },
  message: null,
});
const response = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
const csrf = () => new Response(null, { status: 204 });
const image = () => new File(["synthetic"], "image.png", { type: "image/png" });
function setup() {
  const fetcher = vi.fn<typeof fetch>();
  return {
    fetcher,
    api: createMerchantApi({
      apiOrigin: "https://api.example.test",
      fetch: fetcher,
      readCookie: () => "XSRF-TOKEN=synthetic",
    }),
  };
}
const entries = [
  "productMedia",
  "createProductMedia",
  "updateProductMedia",
  "deleteProductMedia",
  "variantMedia",
  "createVariantMedia",
  "updateVariantMedia",
  "deleteVariantMedia",
] as const;
describe("eight published media contracts", () => {
  it("activates exactly the eight nested contract paths, methods and statuses", () => {
    expect(Object.keys(merchantContracts).filter((key) => /media/i.test(key))).toEqual(entries);
    expect(Object.keys(merchantContracts)).toHaveLength(35);
    entries.forEach((key, index) => {
      const contract = merchantContracts[key];
      const variant = index >= 4;
      const operation = index % 4;
      expect(contract.method).toBe(["GET", "POST", "PATCH", "DELETE"][operation]);
      expect(contract.successStatus).toBe([200, 201, 200, 204][operation]);
      expect(
        contract.path({ ...input, data: { image: image(), position: 1, is_primary: true } }),
      ).toBe(
        `/api/v1/stores/${storeUuid}/catalog/products/${productUuid}${variant ? `/variants/${variantUuid}` : ""}/media${operation >= 2 ? `/${mediaUuid}` : ""}`,
      );
      expect(contract.evidence.source).toContain("7cd52e549c2a657dc66643b36701356d1d024de5");
    });
  });
  it("keeps media asset UUID distinct from opaque URL UUID and strict kinds", () => {
    expect(decodeProductMedia(envelope(product))).toEqual(product);
    expect(decodeVariantMedia(envelope(media))).toEqual(media);
    expect(() => decodeProductMedia(envelope(media))).toThrow();
    expect(() => decodeVariantMedia(envelope(product))).toThrow();
  });
  it.each([
    { url: "https://evil.test/image" },
    { url: media.url + "?x=1" },
    { id: "invalid" },
    { byte_size: 0 },
    { byte_size: 5242881 },
    { width: 8001 },
    { width: 8000, height: 5001 },
    { mime_type: "image/svg+xml" },
    { position: 10001 },
    { alt_text: " noncanonical " },
    { alt_text: "a\nb" },
    { created_at: null },
    { version: 1 },
  ])("rejects invalid/expanded resource %j", (change) =>
    expect(() => decodeVariantMedia(envelope({ ...media, ...change }))).toThrow(),
  );
  it("preserves returned tie ordering and rejects duplicate/misordered/over-limit collections", () => {
    const second = { ...media, id: other };
    expect(decodeVariantMediaList(envelope([media, second]))).toEqual([media, second]);
    expect(() => decodeVariantMediaList(envelope([media, media]))).toThrow();
    expect(() => decodeVariantMediaList(envelope([{ ...media, position: 2 }, second]))).toThrow();
    expect(() => decodeVariantMediaList(envelope(Array(6).fill(media)))).toThrow();
    expect(() => decodeProductMediaList(envelope([{ ...product, is_primary: false }]))).toThrow();
    expect(() => decodeProductMediaList(envelope([product, { ...product, id: other }]))).toThrow();
    expect(decodeProductMediaList(envelope([]))).toEqual([]);
  });
  it.each(["product", "variant"] as const)(
    "reads %s through the central scoped route",
    async (kind) => {
      const { api, fetcher } = setup();
      fetcher.mockResolvedValue(response(envelope([kind === "product" ? product : media])));
      const result =
        kind === "product" ? await api.listProductMedia(input) : await api.listVariantMedia(input);
      expect(result).toHaveLength(1);
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(fetcher.mock.calls[0]![1]).toMatchObject({
        method: "GET",
        credentials: "include",
        body: undefined,
      });
    },
  );
  it.each(["product", "variant"] as const)(
    "uploads %s with fresh multipart and no manual boundary",
    async (kind) => {
      const { api, fetcher } = setup();
      fetcher
        .mockResolvedValueOnce(csrf())
        .mockResolvedValueOnce(response(envelope(kind === "product" ? product : media), 201));
      const data = { image: image(), alt_text: null, position: 0 };
      await (kind === "product"
        ? api.createProductMedia({ ...input, data: { ...data, is_primary: false } })
        : api.createVariantMedia({ ...input, data }));
      const request = fetcher.mock.calls[1]![1]!;
      const headers = new Headers(request.headers);
      expect(request).toMatchObject({
        method: "POST",
        credentials: "include",
        redirect: "error",
        cache: "no-store",
        mode: "cors",
      });
      expect(headers.get("X-XSRF-TOKEN")).toBe("synthetic");
      expect(headers.has("Content-Type")).toBe(false);
      expect(request.body).toBeInstanceOf(FormData);
      const form = request.body as FormData;
      expect(form.get("position")).toBe("0");
      expect(form.get("image")).toBeInstanceOf(File);
      expect(form.has("is_primary")).toBe(kind === "product");
      expect(fetcher).toHaveBeenCalledTimes(2);
    },
  );
  it("captures immutable File, metadata and nested target before CSRF yields", async () => {
    let release!: (response: Response) => void;
    const { api, fetcher } = setup();
    fetcher
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            release = resolve;
          }),
      )
      .mockResolvedValueOnce(response(envelope(product), 201));
    const original = image();
    const request: CreateProductMediaInput = {
      storeUuid,
      productUuid,
      data: { image: original, alt_text: "original", position: 2 },
    };
    const pending = api.createProductMedia(request);
    request.storeUuid = other;
    request.productUuid = other;
    request.data.image = new File(["edited"], "edited.webp", { type: "image/webp" });
    request.data.alt_text = "edited";
    request.data.position = 9;
    release(csrf());
    await pending;
    const form = fetcher.mock.calls[1]![1]!.body as FormData;
    expect(String(fetcher.mock.calls[1]![0])).toContain(
      `/stores/${storeUuid}/catalog/products/${productUuid}/media`,
    );
    expect(form.get("alt_text")).toBe("original");
    expect(form.get("position")).toBe("2");
    expect((form.get("image") as File).name).toBe("image.png");
  });
  it.each(["product", "variant"] as const)(
    "PATCH %s retains JSON and binds asset identity",
    async (kind) => {
      const { api, fetcher } = setup();
      fetcher
        .mockResolvedValueOnce(csrf())
        .mockResolvedValueOnce(
          response(envelope({ ...(kind === "product" ? product : media), id: other })),
        );
      const operation = kind === "product" ? api.updateProductMedia : api.updateVariantMedia;
      await expect(operation({ ...input, data: { position: 1 } })).rejects.toMatchObject({
        kind: "invalid-response",
        mutationOutcome: "unknown",
      });
      expect(fetcher.mock.calls[1]![1]!.body).toBe('{"position":1}');
      expect(new Headers(fetcher.mock.calls[1]![1]!.headers).get("Content-Type")).toBe(
        "application/json",
      );
      expect(fetcher).toHaveBeenCalledTimes(2);
    },
  );
  it.each(["product", "variant"] as const)(
    "DELETE %s accepts only 204/no-body and never invents detach",
    async (kind) => {
      const { api, fetcher } = setup();
      fetcher
        .mockResolvedValueOnce(csrf())
        .mockResolvedValueOnce(new Response(null, { status: 204 }));
      await (kind === "product" ? api.deleteProductMedia(input) : api.deleteVariantMedia(input));
      expect(fetcher.mock.calls[1]![1]).toMatchObject({ method: "DELETE", body: undefined });
      expect(fetcher).toHaveBeenCalledTimes(2);
    },
  );
  it("rejects 200/undefined as an invalid DELETE response", async () => {
    const { api, fetcher } = setup();
    fetcher.mockResolvedValueOnce(csrf()).mockResolvedValueOnce(response(null));
    await expect(api.deleteProductMedia(input)).rejects.toMatchObject({
      kind: "invalid-response",
      mutationOutcome: "unknown",
    });
  });
  it.each(["create", "update", "delete"] as const)(
    "never replays an uncertain %s request",
    async (operation) => {
      const { api, fetcher } = setup();
      fetcher.mockResolvedValueOnce(csrf()).mockRejectedValueOnce(new TypeError("lost"));
      const pending =
        operation === "create"
          ? api.createProductMedia({ ...input, data: { image: image() } })
          : operation === "update"
            ? api.updateProductMedia({ ...input, data: { position: 2 } })
            : api.deleteProductMedia(input);
      await expect(pending).rejects.toMatchObject({ kind: "network", mutationOutcome: "unknown" });
      expect(fetcher).toHaveBeenCalledTimes(2);
    },
  );
  it.each(["storeUuid", "productUuid", "variantUuid", "mediaUuid"] as const)(
    "rejects malformed %s before CSRF",
    async (field) => {
      const { api, fetcher } = setup();
      await expect(
        api.deleteVariantMedia({ ...input, [field]: "../foreign" }),
      ).rejects.toMatchObject({ kind: "configuration" });
      expect(fetcher).not.toHaveBeenCalled();
    },
  );
  it("rejects expanded upload metadata before CSRF", async () => {
    const { api, fetcher } = setup();
    await expect(
      api.createVariantMedia({ ...input, data: { image: image(), is_primary: true } as never }),
    ).rejects.toMatchObject({ kind: "configuration" });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
