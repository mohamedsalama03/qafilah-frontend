// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { inspectArchitecture, type ArchitectureRule } from "./architecture-policy";

const query = "src/features/variants/queries.ts";
const mutation = "src/features/variants/mutations.ts";
const component = "src/features/variants/components/variants-screen.tsx";
const registry = "src/lib/backend/contracts.ts";

describe("structural Variant architecture", () => {
  it.each([query, mutation, component, registry])("accepts pristine source %s", (file) => {
    expect(inspectArchitecture(file, readFileSync(file, "utf8"))).toEqual([]);
  });
  it.each([
    [
      "scope",
      'storeKeys.resource(scope, "product-options", { productUuid })',
      'storeKeys.resource(productUuid, "product-options", { productUuid })',
    ],
    [
      "Product",
      'storeKeys.resource(scope, "product-variants", { productUuid })',
      'storeKeys.resource(scope, "product-variants", {})',
    ],
    [
      "Variant",
      'storeKeys.resource(scope, "product-variant", { productUuid, variantUuid })',
      'storeKeys.resource(scope, "product-variant", { productUuid })',
    ],
    [
      "global key",
      'storeKeys.resource(scope, "product-options", { productUuid })',
      '["product-options", productUuid]',
    ],
  ])("rejects operative key mutant removing %s", (_name, anchor, replacement) => {
    const source = readFileSync(query, "utf8");
    const mutant = source.replace(anchor, replacement);
    expect(mutant).not.toBe(source);
    expect(inspectArchitecture(query, mutant).map((item) => item.rule)).toContain(
      "variant-query-isolation",
    );
  });
  it.each([
    "createProductOption",
    "updateProductOption",
    "createProductOptionValue",
    "updateProductOptionValue",
    "createProductVariant",
    "updateProductVariant",
  ])("requires scoped lifecycle for %s", (name) => {
    expect(
      inspectArchitecture(component, `api.${name}(input);`).map((item) => item.rule),
    ).toContain("variant-mutation-boundary");
    expect(inspectArchitecture(mutation, `api.${name}(input);`)).toEqual([]);
    expect(
      inspectArchitecture(mutation, `api.${name}(input); api.${name}(input);`).map(
        (item) => item.rule,
      ),
    ).toContain("variant-mutation-retry");
  });
  it.each(["listProductOptions", "listProductVariants", "loadProductVariant"])(
    "requires scoped reads for %s",
    (name) => {
      expect(
        inspectArchitecture(component, `api.${name}(input);`).map((item) => item.rule),
      ).toContain("variant-query-isolation");
      expect(inspectArchitecture(query, `api.${name}(input);`)).toEqual([]);
    },
  );
  it.each([
    ["retries", "variant-mutation-retry", "useMutation({retry:2,mutationFn:write});"],
    [
      "scheduled replay",
      "variant-mutation-retry",
      "setTimeout(() => api.createProductVariant(input), 200);",
    ],
    [
      "unscoped publication",
      "variant-mutation-isolation",
      'queryClient.setQueryData(["product-variants"], data);',
    ],
    [
      "unscoped invalidation",
      "variant-mutation-isolation",
      'queryClient.invalidateQueries({queryKey:["product-options"]});',
    ],
    [
      "role authority",
      "role-derived-authority",
      'const canCreate = context.role.name === "Owner";',
    ],
    ["browser authority", "browser-persistence", 'localStorage.setItem("variant-slot", slot);'],
    [
      "direct transport",
      "central-api-boundary",
      'fetch("/api/v1/stores/a/catalog/products/b/variants", {method:"POST"});',
    ],
  ] as [string, ArchitectureRule, string][])("rejects %s", (_name, rule, source) => {
    expect(inspectArchitecture(mutation, source).map((item) => item.rule)).toContain(rule);
  });
  it.each([
    ["productOptions", "GET", "options"],
    ["createProductOption", "POST", "options"],
    ["updateProductOption", "PATCH", "options/${input.optionUuid}"],
    ["createProductOptionValue", "POST", "options/${input.optionUuid}/values"],
    ["updateProductOptionValue", "PATCH", "options/${input.optionUuid}/values/${input.valueUuid}"],
    ["productVariants", "GET", "variants"],
    ["createProductVariant", "POST", "variants"],
    ["productVariant", "GET", "variants/${input.variantUuid}"],
    ["updateProductVariant", "PATCH", "variants/${input.variantUuid}"],
  ])("requires strict resource decoding for %s", (name, method, suffix) => {
    const source = `export const merchantContracts = { ${name}: { method:"${method}", path: input => \`/api/v1/stores/\${input.storeUuid}/catalog/products/\${input.productUuid}/${suffix}\`, decode: payload => payload.data as Resource } };`;
    expect(inspectArchitecture(registry, source).map((item) => item.rule)).toContain(
      "variant-response-boundary",
    );
  });
  it.each(["pricing", "inventory", "media", "archive", "delete", "bulk", "matrix"])(
    "rejects deferred or invented Variant %s contract",
    (suffix) => {
      const source = `export const merchantContracts = { updateProductVariant: {method:"PATCH",path: input => \`/api/v1/stores/\${input.storeUuid}/catalog/products/\${input.productUuid}/variants/\${input.variantUuid}/${suffix}\`, decode:decodeMerchantVariant} };`;
      expect(inspectArchitecture(registry, source).map((item) => item.rule)).toContain(
        "verified-contract-registry",
      );
    },
  );
  it("allows scoped keys and executable comment/string decoys", () => {
    const source = `
      cache.setQueryData(variantKeys.detail(scope, productUuid, variantUuid), resource);
      cache.invalidateQueries({ queryKey: variantKeys.options(scope, productUuid) });
      const canEdit = context.permissions.includes("products.variants.update");
      // setTimeout(() => api.createProductVariant(input), 20); retry: true;
      const copy = "localStorage.setItem('slot', slot); retry:true";
    `;
    expect(inspectArchitecture(mutation, source)).toEqual([]);
  });
});
