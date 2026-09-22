// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { createMerchantApi, type MerchantApi } from "@/lib/backend/client";
import type {
  CreateProductVariantInput,
  UpdateProductOptionInput,
  UpdateProductOptionValueInput,
  UpdateProductVariantInput,
} from "./contracts";

const storeUuid = "11111111-1111-4111-8111-111111111111";
const productUuid = "22222222-2222-4222-8222-222222222222";
const optionUuid = "33333333-3333-4333-8333-333333333333";
const valueUuid = "44444444-4444-4444-8444-444444444444";
const variantUuid = "55555555-5555-4555-8555-555555555555";
const otherUuid = "66666666-6666-4666-8666-666666666666";
const requestId = "77777777-7777-4777-8777-777777777777";
const input = { storeUuid, productUuid, optionUuid, valueUuid, variantUuid };
const option = {
  id: optionUuid,
  name: "Size",
  position: 0,
  values: [{ id: valueUuid, value: "Large", position: 1 }],
};
const variant = {
  id: variantUuid,
  value_ids: [valueUuid],
  sku: null,
  status: "active",
  price: null,
  quantity: null,
  availability: "unavailable",
  created_at: "2026-09-22T01:02:03+00:00",
  updated_at: "2026-09-22T01:02:03+00:00",
};
const envelope = (data: unknown) => ({
  success: true,
  data,
  meta: { request_id: requestId },
  message: null,
});
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
const csrf = () => new Response(null, { status: 204 });
const prefix = `/api/v1/stores/${storeUuid}/catalog/products/${productUuid}`;
const setup = () => {
  const fetcher = vi.fn<typeof fetch>();
  const api = createMerchantApi({
    apiOrigin: "https://api.example.test",
    fetch: fetcher,
    readCookie: () => "XSRF-TOKEN=structural%2Bcsrf",
  });
  return { api, fetcher };
};
type WriteCase = {
  name: string;
  method: string;
  suffix: string;
  result: unknown;
  body: unknown;
  call: (api: MerchantApi) => Promise<unknown>;
};
const writes: WriteCase[] = [
  {
    name: "Option create",
    method: "POST",
    suffix: "/options",
    result: option,
    body: { name: "Size", position: 0 },
    call: (api) => api.createProductOption({ ...input, data: { name: " Ｓｉｚｅ ", position: 0 } }),
  },
  {
    name: "Option update",
    method: "PATCH",
    suffix: `/options/${optionUuid}`,
    result: option,
    body: { name: "Size", position: 0 },
    call: (api) => api.updateProductOption({ ...input, data: { name: "Size", position: 0 } }),
  },
  {
    name: "Value create",
    method: "POST",
    suffix: `/options/${optionUuid}/values`,
    result: option,
    body: { value: "Large", position: 1 },
    call: (api) =>
      api.createProductOptionValue({ ...input, data: { value: " Large ", position: 1 } }),
  },
  {
    name: "Value update",
    method: "PATCH",
    suffix: `/options/${optionUuid}/values/${valueUuid}`,
    result: option,
    body: { value: "Large", position: 1 },
    call: (api) =>
      api.updateProductOptionValue({ ...input, data: { value: "Large", position: 1 } }),
  },
  {
    name: "Variant create",
    method: "POST",
    suffix: "/variants",
    result: variant,
    body: { value_ids: [valueUuid] },
    call: (api) => api.createProductVariant({ ...input, data: { value_ids: [valueUuid] } }),
  },
  {
    name: "Variant update",
    method: "PATCH",
    suffix: `/variants/${variantUuid}`,
    result: variant,
    body: { sku: null, status: "active" },
    call: (api) => api.updateProductVariant({ ...input, data: { sku: null, status: "active" } }),
  },
];

describe("central structural transport and response correlation", () => {
  it.each(writes)(
    "$name uses one normalized request after fresh CSRF",
    async ({ method, suffix, result, body, call }) => {
      const { api, fetcher } = setup();
      fetcher
        .mockResolvedValueOnce(csrf())
        .mockResolvedValueOnce(json(envelope(result), method === "POST" ? 201 : 200));
      expect(await call(api)).toEqual(result);
      expect(fetcher).toHaveBeenCalledTimes(2);
      expect(String(fetcher.mock.calls[0]![0])).toBe(
        "https://api.example.test/sanctum/csrf-cookie",
      );
      expect(String(fetcher.mock.calls[1]![0])).toBe(`https://api.example.test${prefix}${suffix}`);
      expect(JSON.parse(String(fetcher.mock.calls[1]![1]!.body))).toEqual(body);
      expect(fetcher.mock.calls[1]![1]!.method).toBe(method);
      expect(new Headers(fetcher.mock.calls[1]![1]!.headers).get("X-XSRF-TOKEN")).toBe(
        "structural+csrf",
      );
      for (const [, init] of fetcher.mock.calls) {
        expect(init).toMatchObject({
          credentials: "include",
          cache: "no-store",
          redirect: "error",
          mode: "cors",
          referrerPolicy: "no-referrer",
        });
        expect(new Headers(init?.headers).has("Authorization")).toBe(false);
      }
    },
  );
  it("uses exactly three unpaginated reads without CSRF or a request body", async () => {
    const { api, fetcher } = setup();
    fetcher
      .mockResolvedValueOnce(json(envelope([option])))
      .mockResolvedValueOnce(json(envelope([variant])))
      .mockResolvedValueOnce(json(envelope(variant)));
    expect(await api.listProductOptions(input)).toEqual([option]);
    expect(await api.listProductVariants(input)).toEqual([variant]);
    expect(await api.loadProductVariant(input)).toEqual(variant);
    expect(fetcher.mock.calls.map(([url]) => new URL(String(url)).pathname)).toEqual([
      `${prefix}/options`,
      `${prefix}/variants`,
      `${prefix}/variants/${variantUuid}`,
    ]);
    for (const [url, init] of fetcher.mock.calls) {
      expect(new URL(String(url)).search).toBe("");
      expect(init?.method).toBe("GET");
      expect(init?.body).toBeUndefined();
    }
  });
  it("rejects a foreign Variant detail without fabricating a mutation outcome", async () => {
    const { api, fetcher } = setup();
    fetcher.mockResolvedValueOnce(json(envelope({ ...variant, id: otherUuid })));
    await expect(api.loadProductVariant(input)).rejects.toMatchObject({
      kind: "invalid-response",
      mutationOutcome: "not-applicable",
    });
  });
  it.each([
    { name: "Option wrong parent", write: 1, result: { ...option, id: otherUuid } },
    { name: "Option wrong name", write: 0, result: { ...option, name: "Other" } },
    { name: "Option wrong position", write: 1, result: { ...option, position: 8 } },
    { name: "Value create wrong parent", write: 2, result: { ...option, id: otherUuid } },
    { name: "Value create absent", write: 2, result: { ...option, values: [] } },
    { name: "Value update wrong parent", write: 3, result: { ...option, id: otherUuid } },
    {
      name: "Value update wrong target",
      write: 3,
      result: { ...option, values: [{ ...option.values[0], id: otherUuid }] },
    },
    {
      name: "Value update wrong text",
      write: 3,
      result: { ...option, values: [{ ...option.values[0], value: "Other" }] },
    },
    {
      name: "Value update wrong position",
      write: 3,
      result: { ...option, values: [{ ...option.values[0], position: 2 }] },
    },
    { name: "Variant wrong combination", write: 4, result: { ...variant, value_ids: [otherUuid] } },
    { name: "Variant wrong creation status", write: 4, result: { ...variant, status: "inactive" } },
    { name: "Variant wrong creation SKU", write: 4, result: { ...variant, sku: "Unexpected" } },
    { name: "Variant update wrong identity", write: 5, result: { ...variant, id: otherUuid } },
    { name: "Variant update failed clear", write: 5, result: { ...variant, sku: "Retained" } },
    { name: "Variant update wrong status", write: 5, result: { ...variant, status: "inactive" } },
  ])("treats $name as unknown without any replay", async ({ write, result }) => {
    const { api, fetcher } = setup();
    fetcher.mockResolvedValueOnce(csrf()).mockResolvedValueOnce(json(envelope(result)));
    await expect(writes[write]!.call(api)).rejects.toMatchObject({
      kind: "invalid-response",
      mutationOutcome: "unknown",
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it.each(writes)("$name never replays a lost or malformed success response", async ({ call }) => {
    for (const response of [
      new Error("lost response"),
      json(envelope({ invalid: true })),
      new Response("<html>private proxy text</html>", {
        status: 200,
        headers: { "Content-Type": "text/html" },
      }),
    ]) {
      const { api, fetcher } = setup();
      fetcher.mockResolvedValueOnce(csrf());
      if (response instanceof Error) fetcher.mockRejectedValueOnce(response);
      else fetcher.mockResolvedValueOnce(response);
      await expect(call(api)).rejects.toMatchObject({ mutationOutcome: "unknown" });
      expect(fetcher).toHaveBeenCalledTimes(2);
    }
  });
  it.each(writes)(
    "$name preserves definitive rejection vs uncertain server failure",
    async ({ call }) => {
      for (const status of [401, 403, 404, 419, 422, 429, 500, 503]) {
        const { api, fetcher } = setup();
        fetcher.mockResolvedValueOnce(csrf()).mockResolvedValueOnce(
          json(
            {
              success: false,
              data: null,
              meta: { request_id: requestId },
              message: "SQLSTATE private details",
              errors: {
                value_ids: ["Select exactly one Value from every Option."],
                "value_ids.0": ["The selected Value is invalid."],
                sku: ["The SKU already exists in this Store."],
                name: ["SQLSTATE private error"],
                tenant_id: ["unreviewed field"],
              },
            },
            status,
          ),
        );
        const failure = await call(api).catch((error: unknown) => error);
        expect(failure).toMatchObject({
          status,
          requestId,
          mutationOutcome: status >= 500 ? "unknown" : "not-applicable",
        });
        expect(JSON.stringify(failure)).not.toMatch(/SQLSTATE|unreviewed field/);
        if (status === 422)
          expect(failure).toMatchObject({
            fieldErrors: {
              value_ids: ["Select exactly one Value from every Option."],
              "value_ids.0": ["The selected Value is invalid."],
              sku: ["The SKU already exists in this Store."],
              name: [],
            },
          });
        expect(fetcher).toHaveBeenCalledTimes(2);
      }
    },
  );
  it("rejects every invalid route identity before reads, CSRF, or writes", async () => {
    const { api, fetcher } = setup();
    const invalid = "../foreign";
    const calls = [
      api.listProductOptions({ ...input, storeUuid: invalid }),
      api.listProductVariants({ ...input, productUuid: invalid }),
      api.loadProductVariant({ ...input, variantUuid: invalid }),
      api.createProductOption({
        ...input,
        productUuid: invalid,
        data: { name: "Size", position: 0 },
      }),
      api.updateProductOption({
        ...input,
        optionUuid: invalid,
        data: { name: "Size", position: 0 },
      }),
      api.createProductOptionValue({
        ...input,
        optionUuid: invalid,
        data: { value: "Large", position: 0 },
      }),
      api.updateProductOptionValue({
        ...input,
        valueUuid: invalid,
        data: { value: "Large", position: 0 },
      }),
      api.createProductVariant({ ...input, storeUuid: invalid, data: { value_ids: [valueUuid] } }),
      api.updateProductVariant({ ...input, variantUuid: invalid, data: { sku: null } }),
    ];
    for (const call of calls)
      await expect(call).rejects.toMatchObject({
        kind: "configuration",
        mutationOutcome: "not-applicable",
      });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("rejects incomplete and deferred mutation payloads before dispatch", async () => {
    const { api, fetcher } = setup();
    const calls = [
      api.updateProductOption({
        ...input,
        data: { name: "Size" },
      } as unknown as UpdateProductOptionInput),
      api.updateProductOptionValue({
        ...input,
        data: { position: 0 },
      } as unknown as UpdateProductOptionValueInput),
      api.createProductVariant({
        ...input,
        data: { value_ids: [valueUuid], quantity: 1 },
      } as CreateProductVariantInput),
      api.updateProductVariant({
        ...input,
        data: { value_ids: [valueUuid] },
      } as unknown as UpdateProductVariantInput),
      api.updateProductVariant({ ...input, data: {} }),
    ];
    for (const call of calls) await expect(call).rejects.toMatchObject({ kind: "configuration" });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("snapshots nested data and route identity before CSRF yields", async () => {
    const { api, fetcher } = setup();
    let release!: (response: Response) => void;
    fetcher
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            release = resolve;
          }),
      )
      .mockResolvedValueOnce(json(envelope(variant), 201));
    const mutable = { ...input, data: { value_ids: [valueUuid], sku: null } };
    const pending = api.createProductVariant(mutable);
    mutable.productUuid = otherUuid;
    mutable.data.value_ids[0] = otherUuid;
    release(csrf());
    expect(await pending).toEqual(variant);
    expect(new URL(String(fetcher.mock.calls[1]![0])).pathname).toBe(`${prefix}/variants`);
    expect(JSON.parse(String(fetcher.mock.calls[1]![1]!.body))).toEqual({
      value_ids: [valueUuid],
      sku: null,
    });
  });
  it("accepts server combination ordering and preserves SKU case", async () => {
    const { api, fetcher } = setup();
    const result = { ...variant, value_ids: [otherUuid, valueUuid], sku: "Sku-A" };
    fetcher.mockResolvedValueOnce(csrf()).mockResolvedValueOnce(json(envelope(result), 201));
    expect(
      await api.createProductVariant({
        ...input,
        data: { value_ids: [valueUuid, otherUuid], sku: " Ｓｋｕ-A " },
      }),
    ).toEqual(result);
  });
  it("does not dispatch when fresh CSRF fails or an attempt is already cancelled", async () => {
    const { api, fetcher } = setup();
    fetcher.mockRejectedValueOnce(new Error("CSRF unavailable"));
    await expect(api.updateProductVariant({ ...input, data: { sku: null } })).rejects.toMatchObject(
      { kind: "network", mutationOutcome: "not-applicable" },
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
    fetcher.mockClear();
    const controller = new AbortController();
    controller.abort();
    await expect(
      api.updateProductVariant({ ...input, data: { sku: null } }, controller.signal),
    ).rejects.toMatchObject({ kind: "cancelled", mutationOutcome: "not-applicable" });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
