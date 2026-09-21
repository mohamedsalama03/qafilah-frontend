import { defineConfig } from "vitest/config";
import baseConfig from "../vitest.config.ts";
import {
  inventoryFeedbackSources,
  inventoryFeedbackTestPaths,
  inventoryFeedbackVariants,
  transformInventoryFeedbackSource,
} from "./inventory-feedback-mutations.mjs";

const name = process.env.QAFILAH_INVENTORY_FEEDBACK_MUTANT;
if (!inventoryFeedbackVariants[name])
  throw new Error("A known inventory feedback mutation variant is required");

export default defineConfig({
  ...baseConfig,
  plugins: [
    {
      name: "qafilah-inventory-feedback-in-memory-mutation",
      enforce: "pre",
      transform(source, id) {
        const path = inventoryFeedbackSources.find((path) =>
          id.replaceAll("\\", "/").endsWith(`/${path}`),
        );
        if (path) return { code: transformInventoryFeedbackSource(source, path, name), map: null };
      },
    },
  ],
  test: {
    ...baseConfig.test,
    include: inventoryFeedbackTestPaths,
    reporters: ["json"],
    outputFile: process.env.QAFILAH_INVENTORY_FEEDBACK_REPORT,
    maxWorkers: 1,
  },
});
