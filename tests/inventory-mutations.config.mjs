import { defineConfig } from "vitest/config";
import baseConfig from "../vitest.config.ts";
import {
  inventorySources,
  inventoryTestPaths,
  inventoryVariants,
  transformInventorySource,
} from "./inventory-mutations.mjs";

const name = process.env.QAFILAH_INVENTORY_MUTANT;
if (!inventoryVariants[name]) throw new Error("A known inventory mutation variant is required");

export default defineConfig({
  ...baseConfig,
  plugins: [
    {
      name: "qafilah-inventory-in-memory-mutation",
      enforce: "pre",
      transform(source, id) {
        const path = inventorySources.find((path) => id.replaceAll("\\", "/").endsWith(`/${path}`));
        if (path) return { code: transformInventorySource(source, path, name), map: null };
      },
    },
  ],
  test: {
    ...baseConfig.test,
    include: inventoryTestPaths,
    reporters: ["json"],
    outputFile: process.env.QAFILAH_INVENTORY_REPORT,
    maxWorkers: 1,
  },
});
