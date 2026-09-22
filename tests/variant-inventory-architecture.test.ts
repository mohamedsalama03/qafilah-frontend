// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { inspectArchitecture, type ArchitectureRule } from "./architecture-policy";

const query = "src/features/variant-inventory/queries.ts";
const mutation = "src/features/variant-inventory/mutations.ts";
const component = "src/features/variant-inventory/components/variant-inventory-panel.tsx";
const registry = "src/lib/backend/contracts.ts";

describe("Variant inventory architecture", () => {
  it.each([query, mutation, component, registry])("accepts pristine source %s", (file) => {
    expect(inspectArchitecture(file, readFileSync(file, "utf8"))).toEqual([]);
  });

  it.each([
    ["scope", 'storeKeys.resource(productUuid, "variant-inventory", { productUuid, variantUuid })'],
    ["Product", 'storeKeys.resource(scope, "variant-inventory", { variantUuid })'],
    ["Variant", 'storeKeys.resource(scope, "variant-inventory", { productUuid })'],
    ["global key", '["variant-inventory", productUuid, variantUuid]'],
  ])("rejects operative key mutant removing %s", (_name, replacement) => {
    const source = readFileSync(query, "utf8");
    const mutant = source.replace(
      'storeKeys.resource(scope, "variant-inventory", { productUuid, variantUuid })',
      replacement,
    );
    expect(mutant).not.toBe(source);
    expect(inspectArchitecture(query, mutant).map((item) => item.rule)).toContain(
      "variant-inventory-query-isolation",
    );
  });

  it("requires the scoped mutation lifecycle and one dispatch site", () => {
    expect(
      inspectArchitecture(component, "api.updateVariantInventory(input);").map((item) => item.rule),
    ).toContain("variant-inventory-mutation-boundary");
    expect(inspectArchitecture(mutation, "api.updateVariantInventory(input);")).toEqual([]);
    expect(
      inspectArchitecture(
        mutation,
        "api.updateVariantInventory(input); api.updateVariantInventory(input);",
      ).map((item) => item.rule),
    ).toContain("variant-inventory-mutation-retry");
  });

  it("requires scoped inventory reads", () => {
    expect(
      inspectArchitecture(component, "api.loadVariantInventory(input);").map((item) => item.rule),
    ).toContain("variant-inventory-query-isolation");
    expect(inspectArchitecture(query, "api.loadVariantInventory(input);")).toEqual([]);
  });

  it.each([
    [
      "retry policy",
      "variant-inventory-mutation-retry",
      "useMutation({ retry: 2, mutationFn: write });",
    ],
    [
      "scheduled replay",
      "variant-inventory-mutation-retry",
      "setTimeout(() => api.updateVariantInventory(input), 100);",
    ],
    [
      "unscoped publication",
      "variant-inventory-mutation-isolation",
      'cache.setQueryData(["variant-inventory", productUuid, variantUuid], data);',
    ],
    [
      "unscoped invalidation",
      "variant-inventory-mutation-isolation",
      'cache.invalidateQueries({ queryKey: ["variant-inventory"] });',
    ],
    [
      "missing Variant key argument",
      "variant-inventory-mutation-isolation",
      "cache.setQueryData(variantInventoryKeys.detail(scope, productUuid), data);",
    ],
    [
      "quantity adjustment",
      "variant-inventory-absolute-quantity",
      "const next = quantity + delta;",
    ],
    ["quantity decrement", "variant-inventory-absolute-quantity", "quantity--;"],
    [
      "unconfigured zero coercion",
      "variant-inventory-absolute-quantity",
      "const current = quantity ?? 0;",
    ],
    [
      "direct transport",
      "central-api-boundary",
      'fetch("/api/v1/stores/a/catalog/products/b/variants/c/inventory", { method: "PATCH" });',
    ],
    ["role authority", "role-derived-authority", 'const canEdit = context.role.name === "Owner";'],
    [
      "persistent authority",
      "browser-persistence",
      'sessionStorage.setItem("inventory-slot", slot);',
    ],
    ["unrelated Category discovery", "product-query-isolation", "api.listCategories(input);"],
    ["unrelated Option discovery", "variant-query-isolation", "api.listProductOptions(input);"],
  ] as [string, ArchitectureRule, string][])("rejects %s", (_name, rule, source) => {
    expect(inspectArchitecture(mutation, source).map((item) => item.rule)).toContain(rule);
  });

  it.each([
    ["variantInventory", "GET"],
    ["updateVariantInventory", "PATCH"],
  ])("requires strict decoding for %s", (name, method) => {
    const source = `export const merchantContracts = { ${name}: { method: "${method}", path: input => \`/api/v1/stores/\${input.storeUuid}/catalog/products/\${input.productUuid}/variants/\${input.variantUuid}/inventory\`, decode: payload => payload.data as Resource } };`;
    expect(inspectArchitecture(registry, source).map((item) => item.rule)).toContain(
      "variant-inventory-response-boundary",
    );
  });

  it.each(["pricing", "media", "locations", "adjustments", "history", "bulk", "reservations"])(
    "rejects deferred %s endpoint",
    (suffix) => {
      const source = `export const merchantContracts = { updateVariantInventory: { method: "PATCH", path: input => \`/api/v1/stores/\${input.storeUuid}/catalog/products/\${input.productUuid}/variants/\${input.variantUuid}/${suffix}\`, decode: decodeVariantInventory } };`;
      expect(inspectArchitecture(registry, source).map((item) => item.rule)).toContain(
        "verified-contract-registry",
      );
    },
  );

  it("accepts scoped publication and executable comment/string decoys", () => {
    expect(
      inspectArchitecture(
        mutation,
        `
      cache.setQueryData(variantInventoryKeys.detail(scope, productUuid, variantUuid), inventory);
      cache.invalidateQueries({ queryKey: variantKeys.detail(scope, productUuid, variantUuid) });
      cache.invalidateQueries({ queryKey: variantKeys.list(scope, productUuid) });
      cache.invalidateQueries({ queryKey: productKeys.detail(scope, productUuid) });
      const canEdit = context.permissions.includes("products.variants.inventory.update");
      // retry PATCH; quantity += 1; localStorage.setItem("slot", slot);
      const copy = "setTimeout(() => api.updateVariantInventory(input), 1); retry: true";
    `,
      ),
    ).toEqual([]);
  });
});
