import { describe, expect, it, vi } from "vitest";
import { createQueryClient } from "./client";
import { parseStoreUuid, storeKeys } from "./keys";
import { createScopeController } from "./scope";

const storeA = "d2cfd6a8-b5aa-4df0-a8bf-2d15d90bb2e1";
const storeB = "ef1f37c7-f515-452a-b598-ccdafad4902d";

describe("merchant cache isolation", () => {
  it("requires a Store UUID, never a numeric or arbitrary store identifier", () => {
    expect(() => parseStoreUuid(12)).toThrow();
    expect(() => parseStoreUuid("12")).toThrow();
    expect(() => parseStoreUuid("not-a-store-uuid")).toThrow();
  });
  it("includes principal, Store UUID, and authority revision in every resource key", () => {
    const controller = createScopeController(createQueryClient());
    const scope = controller.setScope({ principalId: "principal-a", storeUuid: storeA });
    expect(storeKeys.resource(scope, "test-resource", { page: 2 })).toEqual([
      "merchant",
      "principal-a",
      "store",
      storeA,
      scope.revision,
      "test-resource",
      { page: 2 },
    ]);
    controller.clear();
  });
  it("also purges previous authority when the requested destination is invalid", () => {
    const client = createQueryClient();
    const controller = createScopeController(client);
    const scope = controller.setScope({ principalId: "principal-a", storeUuid: storeA });
    const key = storeKeys.resource(scope, "test-resource");
    client.setQueryData(key, "sensitive");
    expect(() =>
      controller.setScope({ principalId: "principal-a", storeUuid: "invalid" }),
    ).toThrow();
    expect(controller.getScope()).toBeNull();
    expect(client.getQueryData(key)).toBeUndefined();
    controller.clear();
  });
  it("synchronously purges old Store data and mutation cache on switching", () => {
    const client = createQueryClient();
    const controller = createScopeController(client);
    const a = controller.setScope({ principalId: "principal-a", storeUuid: storeA });
    const key = storeKeys.resource(a, "test-resource");
    client.setQueryData(key, { private: "store-a" });
    client.getMutationCache().build(client, { mutationFn: async () => "sensitive result" });
    const b = controller.setScope({ principalId: "principal-a", storeUuid: storeB });
    expect(client.getQueryData(key)).toBeUndefined();
    expect(client.getQueryData(storeKeys.resource(b, "test-resource"))).toBeUndefined();
    expect(client.getMutationCache().getAll()).toHaveLength(0);
    expect(() => controller.assertCurrent(a)).toThrow();
    controller.clear();
  });
  it("rejects late old-Store work even when the operation ignores its signal", async () => {
    const client = createQueryClient();
    const controller = createScopeController(client);
    const a = controller.setScope({ principalId: "principal-a", storeUuid: storeA });
    let finish: (value: string) => void = () => {
      throw new Error("Missing request");
    };
    let observedSignal: AbortSignal | undefined;
    const pending = controller.run(a, (signal) => {
      observedSignal = signal;
      return new Promise<string>((resolve) => {
        finish = resolve;
      });
    });
    const outcome = expect(pending).rejects.toMatchObject({ kind: "cancelled" });
    controller.setScope({ principalId: "principal-a", storeUuid: storeB });
    expect(observedSignal?.aborted).toBe(true);
    finish("private stale data");
    await outcome;
    expect(client.getQueryCache().getAll()).toHaveLength(0);
    controller.clear();
  });
  it("cancels TanStack in-flight merchant queries and never restores removed data", async () => {
    const client = createQueryClient();
    const controller = createScopeController(client);
    const a = controller.setScope({ principalId: "principal-a", storeUuid: storeA });
    const key = storeKeys.resource(a, "test-resource");
    let finish: (value: string) => void = () => {
      throw new Error("Missing query");
    };
    const pending = client.fetchQuery({
      queryKey: key,
      queryFn: ({ signal }) =>
        controller.run(
          a,
          () =>
            new Promise<string>((resolve) => {
              finish = resolve;
            }),
          signal,
        ),
    });
    const outcome = expect(pending).rejects.toBeDefined();
    controller.setScope({ principalId: "principal-a", storeUuid: storeB });
    finish("private stale data");
    await outcome;
    expect(client.getQueryData(key)).toBeUndefined();
    controller.clear();
  });
  it("separates principals with access to the same Store and returning Store revisions", () => {
    const controller = createScopeController(createQueryClient());
    const a = controller.setScope({ principalId: "principal-a", storeUuid: storeA });
    const b = controller.setScope({ principalId: "principal-b", storeUuid: storeA });
    const nextA = controller.setScope({ principalId: "principal-a", storeUuid: storeA });
    expect(storeKeys.scope(a)).not.toEqual(storeKeys.scope(b));
    expect(storeKeys.scope(a)).not.toEqual(storeKeys.scope(nextA));
    controller.clear();
  });
  it("logout clears all data immediately and rejects use of previous authority", async () => {
    const client = createQueryClient();
    const controller = createScopeController(client);
    const scope = controller.setScope({ principalId: "principal-a", storeUuid: storeA });
    client.setQueryData(storeKeys.resource(scope, "test-resource"), "sensitive");
    client.setQueryData(["identity"], "sensitive");
    controller.clear();
    expect(controller.getScope()).toBeNull();
    expect(client.getQueryCache().getAll()).toHaveLength(0);
    const operation = vi.fn(async () => "stale");
    await expect(controller.run(scope, operation)).rejects.toMatchObject({ kind: "cancelled" });
    expect(operation).not.toHaveBeenCalled();
  });
  it("does not automatically retry queries or mutations", () => {
    const client = createQueryClient();
    expect(client.getDefaultOptions().queries?.retry).toBe(false);
    expect(client.getDefaultOptions().mutations?.retry).toBe(false);
    client.clear();
  });
});
