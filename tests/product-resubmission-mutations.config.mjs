import { defineConfig } from "vitest/config";
import baseConfig from "../vitest.config.ts";
import {
  resubmissionSources,
  resubmissionVariants,
  transformResubmissionSource,
} from "./product-resubmission-mutations.mjs";

const name = process.env.QAFILAH_RESUBMISSION_MUTANT;
if (!resubmissionVariants[name])
  throw new Error("A known resubmission mutation variant is required");
export default defineConfig({
  ...baseConfig,
  plugins: [
    {
      name: "qafilah-product-resubmission-in-memory-mutation",
      enforce: "pre",
      transform(source, id) {
        const path = resubmissionSources.find((path) =>
          id.replaceAll("\\", "/").endsWith(`/${path}`),
        );
        if (path) return { code: transformResubmissionSource(source, path, name), map: null };
      },
    },
  ],
  test: {
    ...baseConfig.test,
    include: [
      "src/features/products/components/product-resubmission.test.tsx",
      "src/features/products/product-resubmission.test.ts",
    ],
    reporters: ["json"],
    outputFile: process.env.QAFILAH_RESUBMISSION_REPORT,
    testNamePattern: resubmissionVariants[name].pattern,
    maxWorkers: 1,
  },
});
