import { defineConfig } from "vitest/config";
import baseConfig from "../vitest.config.ts";
import { transformDiscoverySource } from "./store-discovery-mutations.mjs";

export default defineConfig({
  ...baseConfig,
  plugins: [
    {
      name: "qafilah-discovery-in-memory-mutation",
      enforce: "pre",
      transform(source, id) {
        if (id.replaceAll("\\", "/").endsWith("/src/lib/stores/controller.ts")) {
          return {
            code: transformDiscoverySource(source, process.env.QAFILAH_DISCOVERY_MUTANT),
            map: null,
          };
        }
      },
    },
  ],
  test: {
    ...baseConfig.test,
    include: ["src/lib/stores/controller.test.ts", "src/lib/stores/discovery.test.ts"],
    reporters: ["json"],
    outputFile: process.env.QAFILAH_DISCOVERY_MUTATION_REPORT,
    testNamePattern: process.env.QAFILAH_DISCOVERY_MUTATION_TEST_PATTERN,
  },
});
