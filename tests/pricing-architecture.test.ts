// @vitest-environment node
import { describe, expect, it } from "vitest";
import { merchantContracts } from "../src/lib/backend/contracts";
import { inspectArchitecture } from "./architecture-policy";
import { inspectPricingSafety } from "./pricing-policy";
import { productionAnalysis } from "./production-sources";

describe("Pricing architecture", () => {
  it("keeps production pricing and currency authority safe", () => {
    const result = productionAnalysis();
    expect(result.architecture).toEqual([]);
    expect(result.currency).toEqual([]);
  });
  it("activates exactly four verified Pricing contracts", () => {
    const entries = Object.entries(merchantContracts).filter(([name]) => /Pricing$/.test(name));
    const id = "11111111-1111-4111-8111-111111111111";
    expect(
      entries.map(([name, c]) => [
        name,
        c.method,
        c.path({ storeUuid: id, productUuid: id, variantUuid: id, data: { amount: 1 } } as never),
      ]),
    ).toEqual([
      ["productPricing", "GET", `/api/v1/stores/${id}/catalog/products/${id}/pricing`],
      ["updateProductPricing", "PATCH", `/api/v1/stores/${id}/catalog/products/${id}/pricing`],
      [
        "variantPricing",
        "GET",
        `/api/v1/stores/${id}/catalog/products/${id}/variants/${id}/pricing`,
      ],
      [
        "updateVariantPricing",
        "PATCH",
        `/api/v1/stores/${id}/catalog/products/${id}/variants/${id}/pricing`,
      ],
    ]);
    for (const [, entry] of entries)
      expect(entry.evidence.source).toContain("4c86b8429f6d3e26d07129494de99f7f5b76db73");
  });
  it.each([
    "discounts",
    "compare-at",
    "taxes",
    "currency",
    "history",
    "bulk",
    "promotions",
    "subscriptions",
  ])("rejects deferred %s endpoints", (suffix) => {
    expect(
      inspectArchitecture(
        "src/lib/backend/contracts.ts",
        `const merchantContracts = { productPricing: {method:"GET",path: input => \`/api/v1/stores/\${input.storeUuid}/catalog/products/\${input.productUuid}/${suffix}\`,decode:decodePricing}};`,
      ).map((v) => v.rule),
    ).toContain("verified-contract-registry");
  });
  it.each([
    "api.updateProductPricing(input);api.updateProductPricing(input);",
    "setTimeout(()=>api.updateVariantPricing(input),1);",
    "const amount = parseFloat(text) * 100;",
    "const next = Math.round(amount);",
    "useMutation({retry:2});",
    'cache.setQueryData(["pricing", productUuid], result); const query = {queryKey:["pricing"]};',
    'storeKeys.resource(scope,"pricing",{productUuid});',
  ])("rejects operative unsafe production syntax %s", (source) =>
    expect(
      inspectPricingSafety("src/features/pricing/mutations.ts", source).length,
    ).toBeGreaterThan(0),
  );
  it("keeps dispatch and read boundaries outside components", () => {
    for (const method of [
      "loadProductPricing",
      "loadVariantPricing",
      "updateProductPricing",
      "updateVariantPricing",
    ])
      expect(
        inspectPricingSafety(
          "src/features/pricing/components/pricing-panel.tsx",
          `api.${method}(input);`,
        ),
      ).toHaveLength(1);
  });
  it("ignores comment/string decoys and allows authoritative formatting", () => {
    expect(
      inspectPricingSafety(
        "src/features/pricing/model.ts",
        '// Math.round(amount * 100);\nconst help="parseFloat(text) * 100"; const digits = whole + fraction.padEnd(exponent,"0");',
      ),
    ).toEqual([]);
  });
});
