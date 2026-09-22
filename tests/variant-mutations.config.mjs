import { defineConfig } from "vitest/config";
import baseConfig from "../vitest.config.ts";
import {
  variantMutationSources,
  variantMutationTests,
  variantMutationVariants,
  transformVariantMutationSource,
} from "./variant-mutations.mjs";

const name = process.env.QAFILAH_VARIANT_MUTANT;
if (!variantMutationVariants[name])
  throw new Error("A known structural mutation variant is required");

export default defineConfig({
  ...baseConfig,
  plugins: [
    {
      name: "qafilah-structural-in-memory-mutation",
      enforce: "pre",
      transform(source, id) {
        const path = variantMutationSources.find((path) =>
          id.replaceAll("\\", "/").endsWith(`/${path}`),
        );
        if (path) return { code: transformVariantMutationSource(source, path, name), map: null };
      },
    },
  ],
  test: {
    ...baseConfig.test,
    include: variantMutationTests,
    reporters: ["json"],
    outputFile: process.env.QAFILAH_VARIANT_MUTATION_REPORT,
    maxWorkers: 1,
  },
});
