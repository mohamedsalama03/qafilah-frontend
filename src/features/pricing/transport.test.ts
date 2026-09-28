import { describe, expect, it, vi } from "vitest";
import { createMerchantApi } from "@/lib/backend/client";

const id = "11111111-1111-4111-8111-111111111111";
const input = { storeUuid: id, productUuid: id, variantUuid: id, data: { amount: 12345 } };
const envelope = (amount = 12345) => ({
  success: true,
  data: { price: { amount, currency: "LYD" } },
  meta: { request_id: id },
  message: null,
});
describe.each(["Product", "Variant"] as const)("%s pricing transport", (kind) => {
  function fixture(response: () => Response | Promise<Response> = () => Response.json(envelope())) {
    const fetcher = vi.fn<typeof fetch>(async (url) =>
      String(url).endsWith("/sanctum/csrf-cookie")
        ? new Response(null, { status: 204 })
        : response(),
    );
    const api = createMerchantApi({
      apiOrigin: "https://api.example.test",
      fetch: fetcher,
      readCookie: () => "XSRF-TOKEN=encoded%20token",
    });
    return {
      fetcher,
      api,
      write: kind === "Product" ? api.updateProductPricing : api.updateVariantPricing,
      read: kind === "Product" ? api.loadProductPricing : api.loadVariantPricing,
    };
  }
  it("sends exactly one amount-only JSON PATCH with CSRF and credentials", async () => {
    const f = fixture();
    await f.write(input);
    expect(f.fetcher).toHaveBeenCalledTimes(2);
    const [url, init] = f.fetcher.mock.calls[1];
    expect(String(url)).toBe(
      `https://api.example.test/api/v1/stores/${id}/catalog/products/${id}${kind === "Variant" ? `/variants/${id}` : ""}/pricing`,
    );
    expect(init?.method).toBe("PATCH");
    expect(init?.credentials).toBe("include");
    expect(JSON.parse(init?.body as string)).toEqual({ amount: 12345 });
    expect(new Headers(init?.headers).get("X-XSRF-TOKEN")).toBe("encoded token");
  });
  it("reads without CSRF or a write", async () => {
    const f = fixture();
    await f.read(input);
    expect(f.fetcher).toHaveBeenCalledTimes(1);
    expect(f.fetcher.mock.calls[0][1]?.method).toBe("GET");
  });
  it.each([401, 419, 403, 404, 422, 429, 500, 503])(
    "normalizes %s and never replays",
    async (status) => {
      const f = fixture(() =>
        Response.json(
          {
            success: false,
            data: null,
            message: "internal diagnostic",
            errors: { amount: ["unsafe internals"] },
          },
          { status },
        ),
      );
      await expect(f.write(input)).rejects.toMatchObject({ status });
      expect(f.fetcher).toHaveBeenCalledTimes(2);
    },
  );
  it.each(["network", "malformed", "mismatch"])(
    "marks %s after dispatch unknown without replay",
    async (failure) => {
      const f = fixture(() => {
        if (failure === "network") throw new TypeError("socket lost");
        return Response.json(failure === "malformed" ? { success: true, data: {} } : envelope(3));
      });
      await expect(f.write(input)).rejects.toMatchObject({ mutationOutcome: "unknown" });
      expect(f.fetcher).toHaveBeenCalledTimes(2);
    },
  );
  it("snapshots target and payload before CSRF yields", async () => {
    let release!: (r: Response) => void;
    const gate = new Promise<Response>((r) => (release = r));
    const f = fixture();
    f.fetcher.mockImplementationOnce(() => gate);
    const mutable = { ...input, data: { amount: 12345 } };
    const pending = f.write(mutable);
    mutable.productUuid = "22222222-2222-4222-8222-222222222222";
    mutable.data.amount = 9;
    release(new Response(null, { status: 204 }));
    await pending;
    expect(String(f.fetcher.mock.calls[1][0])).toContain(`/products/${id}`);
    expect(JSON.parse(f.fetcher.mock.calls[1][1]?.body as string)).toEqual({ amount: 12345 });
  });
});
