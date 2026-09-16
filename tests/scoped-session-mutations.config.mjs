import { defineConfig } from "vitest/config";
import baseConfig from "../vitest.config.ts";
import {
  scopedSessionTestPattern,
  transformScopedSessionSource,
} from "./scoped-session-mutations.mjs";

export default defineConfig({
  ...baseConfig,
  plugins: [
    {
      name: "qafilah-scoped-session-in-memory-mutation",
      enforce: "pre",
      transform(source, id) {
        if (id.replaceAll("\\", "/").endsWith("/src/lib/auth/controller.ts"))
          return {
            code: transformScopedSessionSource(source, process.env.QAFILAH_SCOPED_SESSION_MUTANT),
            map: null,
          };
      },
    },
  ],
  test: {
    ...baseConfig.test,
    include: ["src/features/auth/components/scoped-read-revalidation.test.tsx"],
    reporters: ["json"],
    outputFile: process.env.QAFILAH_SCOPED_SESSION_MUTATION_REPORT,
    testNamePattern: scopedSessionTestPattern,
  },
});
