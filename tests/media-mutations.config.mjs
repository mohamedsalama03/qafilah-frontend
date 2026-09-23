import { defineConfig } from "vitest/config";
import baseConfig from "../vitest.config.ts";
import {
  mediaSources,
  mediaTestPaths,
  mediaVariants,
  transformMediaSource,
} from "./media-mutations.mjs";

const name = process.env.QAFILAH_MEDIA_MUTANT;
if (!mediaVariants[name]) throw new Error("A known media mutation variant is required");

export default defineConfig({
  ...baseConfig,
  plugins: [
    {
      name: "qafilah-media-in-memory-mutation",
      enforce: "pre",
      transform(source, id) {
        const path = mediaSources.find((path) => id.replaceAll("\\", "/").endsWith(`/${path}`));
        if (path) return { code: transformMediaSource(source, path, name), map: null };
      },
    },
  ],
  test: {
    ...baseConfig.test,
    include: mediaTestPaths,
    reporters: ["json"],
    outputFile: process.env.QAFILAH_MEDIA_REPORT,
    maxWorkers: 1,
  },
});
