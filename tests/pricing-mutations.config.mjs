import { defineConfig } from "vitest/config";
import baseConfig from "../vitest.config.ts";
import {
  pricingSources,
  pricingTestPaths,
  pricingVariants,
  transformPricingSource,
} from "./pricing-mutations.mjs";

const name = process.env.QAFILAH_PRICING_MUTANT;
if (!pricingVariants[name]) throw new Error("A known inventory mutation variant is required");

export default defineConfig({
  ...baseConfig,
  plugins: [
    {
      name: "qafilah-pricing-in-memory-mutation",
      enforce: "pre",
      transform(source, id) {
        if (id.replaceAll("\\", "/").endsWith("/tests/production-sources.ts"))
          return {
            code:
              'import { transformPricingSource } from "./pricing-mutations.mjs";\n' +
              source.replace(
                "export function productionSources()",
                "function pristineProductionSources()",
              ) +
              "\nexport function productionSources() { return pristineProductionSources().map(item => ({...item,source: transformPricingSource(item.source,item.file," +
              JSON.stringify(name) +
              ")})); }",
            map: null,
          };
        const path = pricingSources.find((path) => id.replaceAll("\\", "/").endsWith(`/${path}`));
        if (path) return { code: transformPricingSource(source, path, name), map: null };
      },
    },
  ],
  test: {
    ...baseConfig.test,
    include: pricingTestPaths,
    reporters: ["json"],
    outputFile: process.env.QAFILAH_PRICING_REPORT,
    maxWorkers: 1,
  },
});
