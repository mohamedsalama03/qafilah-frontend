import { defineConfig } from "vitest/config";
import baseConfig from "../vitest.config.ts";
import {
  variantInventorySources,
  variantInventoryTestPaths,
  variantInventoryVariants,
  transformVariantInventorySource,
} from "./variant-inventory-mutations.mjs";

const name = process.env.QAFILAH_VARIANT_INVENTORY_MUTANT;
if (!variantInventoryVariants[name])
  throw new Error("A known inventory mutation variant is required");

export default defineConfig({
  ...baseConfig,
  plugins: [
    {
      name: "qafilah-variant-inventory-in-memory-mutation",
      enforce: "pre",
      transform(source, id) {
        const path = variantInventorySources.find((path) =>
          id.replaceAll("\\", "/").endsWith(`/${path}`),
        );
        if (path) return { code: transformVariantInventorySource(source, path, name), map: null };
      },
    },
  ],
  test: {
    ...baseConfig.test,
    include: variantInventoryTestPaths,
    reporters: ["json"],
    outputFile: process.env.QAFILAH_VARIANT_INVENTORY_REPORT,
    maxWorkers: 1,
  },
});
