import { defineConfig } from "vitest/config";
import ts from "typescript";
import baseConfig from "../vitest.config.ts";
import { testPaths, variants } from "./store-currency-mutations.mjs";

const name = process.env.QAFILAH_CURRENCY_MUTANT;
if (!variants[name]) throw new Error("A known currency mutation variant is required");

export default defineConfig({
  ...baseConfig,
  plugins: [
    {
      name: "currency-production-reader-in-memory-mutation",
      enforce: "pre",
      transform(source, id) {
        if (!id.replaceAll("\\", "/").endsWith("/tests/production-sources.ts")) return;
        const tree = ts.createSourceFile(id, source, ts.ScriptTarget.Latest, true);
        const readers = tree.statements.filter(
          (node) => ts.isFunctionDeclaration(node) && node.name?.text === "productionSources",
        );
        if (readers.length !== 1) throw new Error("Expected one production source reader");
        const identifier = readers[0].name;
        const original =
          source.slice(0, identifier.getStart(tree)) +
          "pristineProductionSources" +
          source.slice(identifier.end);
        return {
          code: `import { mutateProduct, productFile } from "./store-currency-mutations.mjs";\n${original}\nexport function productionSources() { return pristineProductionSources().map(entry => ({...entry, source: entry.file === productFile ? mutateProduct(entry.source, ${JSON.stringify(name)}) : entry.source})); }`,
          map: null,
        };
      },
    },
  ],
  test: {
    ...baseConfig.test,
    include: testPaths,
    reporters: ["json"],
    outputFile: process.env.QAFILAH_CURRENCY_REPORT,
    maxWorkers: 1,
  },
});
