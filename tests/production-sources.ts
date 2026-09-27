import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { isProductionSource } from "./architecture-policy";

/** All application sources, including future features, plus executable entry/config sources.
 * No feature-directory allowlist. Tests, fixtures, docs and generated/vendor trees are excluded.
 */
export function productionSources(): Array<{ file: string; source: string }> {
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
  return [...files("src"), ...files("scripts"), "next.config.ts"].map((file) => ({
    file,
    source: readFileSync(file, "utf8"),
  }));
}
