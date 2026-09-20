import { defineConfig } from "vitest/config";
import baseConfig from "../vitest.config.ts";
import {
  guidanceSources,
  guidanceVariants,
  transformGuidanceSource,
} from "./product-guidance-mutations.mjs";

const name = process.env.QAFILAH_GUIDANCE_MUTANT;
if (!guidanceVariants[name])
  throw new Error("A known Product guidance mutation variant is required");
export default defineConfig({
  ...baseConfig,
  plugins: [
    {
      name: "qafilah-product-guidance-in-memory-mutation",
      enforce: "pre",
      transform(source, id) {
        const path = guidanceSources.find((path) => id.replaceAll("\\", "/").endsWith(`/${path}`));
        if (path) return { code: transformGuidanceSource(source, path, name), map: null };
      },
    },
  ],
  test: {
    ...baseConfig.test,
    include: ["src/features/products/components/product-guidance.test.tsx"],
    reporters: ["json"],
    outputFile: process.env.QAFILAH_GUIDANCE_REPORT,
    testNamePattern: guidanceVariants[name].pattern,
    maxWorkers: 1,
  },
});
