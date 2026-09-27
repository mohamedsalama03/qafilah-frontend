import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { inspectArchitecture, isProductionSource } from "./architecture-policy";
import { inspectCurrencyAuthority } from "./currency-authority-policy";

let inventory: Array<{ file: string; source: string }> | undefined;

/** All application sources, including future features, plus executable entry/config sources.
 * No feature-directory allowlist. Tests, fixtures, docs and generated/vendor trees are excluded.
 */
export function productionSources(): Array<{ file: string; source: string }> {
  if (inventory) return inventory;
  function files(directory: string): string[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const file = join(directory, entry.name).replaceAll("\\", "/");
      if (entry.isDirectory())
        return /^(?:node_modules|vendor|generated|__generated__|\.next|\.git|docs|tests?|__tests__|fixtures|__fixtures__|dev)$/.test(
          entry.name,
        )
          ? []
          : files(file);
      return isProductionSource(file) ? [file] : [];
    });
  }
  inventory = [...files("src"), ...files("scripts"), "next.config.ts"].map((file) => ({
    file,
    source: readFileSync(file, "utf8"),
  }));
  return inventory;
}

function scanProduction() {
  const started = performance.now();
  const sources = productionSources();
  const trees = new Map(
    sources.map(({ file, source }) => [
      file,
      ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX),
    ]),
  );
  let currency: ReturnType<typeof inspectCurrencyAuthority> | undefined;
  let architecture: ReturnType<typeof inspectArchitecture> | undefined;
  const timing = {
    parseMs: performance.now() - started,
    currencyMs: 0,
    architectureMs: 0,
    currencyScans: 0,
    architectureScans: 0,
  };
  return {
    sources,
    trees,
    get currency() {
      if (!currency) {
        const start = performance.now();
        currency = sources.flatMap(({ file, source }) =>
          inspectCurrencyAuthority(file, source, trees),
        );
        timing.currencyMs = performance.now() - start;
        timing.currencyScans++;
      }
      return currency;
    },
    get architecture() {
      if (!architecture) {
        const start = performance.now();
        architecture = sources.flatMap(({ file, source }) =>
          inspectArchitecture(file, source, trees.get(file)),
        );
        timing.architectureMs = performance.now() - start;
        timing.architectureScans++;
      }
      return architecture;
    },
    parsedFiles: trees.size,
    timing,
  };
}

let analysis: ReturnType<typeof scanProduction> | undefined;
/** Immutable production snapshot per Vitest process. Mutation variants each start a fresh
 * process and replace the source reader before this lazy cache is initialized. Both rules
 * share one parse; repeated assertions reuse results, not repeated filesystem scans.
 */
export function productionAnalysis() {
  return (analysis ??= scanProduction());
}
