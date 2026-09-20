import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const baseline = "e3eff36f62d793c4248a80506b926a07e3aa0e29";
export const guidanceSources = [
  "src/features/products/mutations.ts",
  "src/features/products/components/product-form-screen.tsx",
  "src/features/products/components/mutation-feedback.tsx",
  "src/features/products/components/product-actions.tsx",
];
const protectedPaths = [
  ...guidanceSources,
  "src/features/products/components/product-guidance.test.tsx",
  "src/features/products/product-guidance.test.ts",
];
const outputDirectory = join(root, "artifacts/f3b-l2/guidance-mutations");
export const guidanceVariants = {
  "baseline-notice-loss": { expected: "RED", pattern: "notice probe", count: 5, failed: 5 },
  pristine: { expected: "GREEN", count: 15 },
  "comment-decoy": { expected: "GREEN", count: 15 },
  "string-decoy": { expected: "GREEN", count: 15 },
  "notice-loss": {
    expected: "RED",
    pattern: "notice probe|preserves committed B|Start a new edit|separate creation",
    count: 9,
    failed: 9,
  },
  "pristine-after": { expected: "GREEN", count: 15 },
};
export function transformGuidanceSource(source, path, name) {
  if (!guidanceVariants[name]) throw new Error(`Unknown guidance variant: ${name}`);
  source = source.replaceAll("\r\n", "\n");
  if (name === "baseline-notice-loss") {
    const result = spawnSync("git", ["show", `${baseline}:${path}`], {
      cwd: root,
      encoding: "utf8",
      windowsHide: true,
    });
    if (result.status !== 0 || result.error) throw new Error(`Cannot read frozen baseline ${path}`);
    return result.stdout;
  }
  if (name === "comment-decoy")
    return `/* guidance: undefined; lose the new-slot notice (comment only) */\n${source}`;
  if (name === "string-decoy")
    return `${source}\nvoid "guidance: undefined; discard loaded-product and blank-product notice (string only)";\n`;
  if (name === "notice-loss" && path === guidanceSources[0]) {
    const target = 'guidance: product ? "product-loaded" : "blank-product",';
    if (source.split(target).length !== 2)
      throw new Error("Expected exactly one operative fresh-slot guidance target");
    return source.replace(target, "guidance: undefined,");
  }
  return source;
}
function sha256(source) {
  return createHash("sha256").update(source).digest("hex");
}
function snapshot() {
  return Object.fromEntries(
    protectedPaths.map((path) => [path, sha256(readFileSync(join(root, path)))]),
  );
}
export function runGuidanceMutations() {
  mkdirSync(outputDirectory, { recursive: true });
  const before = snapshot();
  const records = [];
  try {
    for (const [name, variant] of Object.entries(guidanceVariants)) {
      const transformedHashes = Object.fromEntries(
        guidanceSources.map((path) => [
          path,
          sha256(transformGuidanceSource(readFileSync(join(root, path), "utf8"), path, name)),
        ]),
      );
      const reportFile = join(outputDirectory, `${name}.json`);
      const result = spawnSync(
        process.execPath,
        [
          join(root, "node_modules/vitest/vitest.mjs"),
          "run",
          "--config",
          "tests/product-guidance-mutations.config.mjs",
        ],
        {
          cwd: root,
          env: {
            ...process.env,
            QAFILAH_GUIDANCE_MUTANT: name,
            QAFILAH_GUIDANCE_REPORT: reportFile,
            NO_COLOR: "1",
          },
          encoding: "utf8",
          timeout: 60_000,
          maxBuffer: 8 * 1024 * 1024,
          windowsHide: true,
        },
      );
      writeFileSync(join(outputDirectory, `${name}.log`), `${result.stdout}\n${result.stderr}`);
      if (result.error || result.signal)
        throw new Error(
          `Guidance variant did not complete: ${result.error?.message ?? result.signal}`,
        );
      const report = JSON.parse(readFileSync(reportFile, "utf8"));
      const failures = report.testResults.flatMap((suite) =>
        suite.assertionResults
          .filter((test) => test.status === "failed")
          .map((test) => ({ name: test.fullName, messages: test.failureMessages })),
      );
      const assertionFailuresOnly =
        report.testResults.every((suite) => !suite.message) &&
        failures.every(
          (failure) =>
            failure.messages.length &&
            failure.messages.every((message) => message.startsWith("AssertionError:")),
        );
      const executedTestCount = report.numPassedTests + report.numFailedTests;
      const actual =
        result.status === 0 && report.success && executedTestCount === variant.count
          ? "GREEN"
          : result.status === 1 &&
              executedTestCount === variant.count &&
              failures.length === variant.failed &&
              assertionFailuresOnly
            ? "RED"
            : "HARNESS ERROR";
      records.push({
        name,
        expected: variant.expected,
        actual,
        executedTestCount,
        failedTestCount: report.numFailedTests,
        assertionFailuresOnly,
        transformedHashes,
        killedBy: failures,
      });
      process.stdout.write(
        `${name}: ${actual} (${report.numFailedTests} assertion failures / ${executedTestCount} tests)\n`,
      );
      if (actual !== variant.expected)
        throw new Error(
          `Guidance variant ${name}: expected ${variant.expected}, received ${actual}`,
        );
    }
  } finally {
    const after = snapshot();
    const unchanged = protectedPaths.every((path) => before[path] === after[path]);
    writeFileSync(
      join(outputDirectory, "results.json"),
      `${JSON.stringify(
        {
          baseline,
          execution: "Vitest pre-transform only; production source is never rewritten",
          probe:
            "Five repeated permanent uncommitted-unknown update cases reconstruct the reported 0/5 result; the original external Agent 2 probe was not available in this workspace",
          operativeChange:
            "Drop guidance when renewing the slot while preserving authoritative Product data, fresh-slot identity, locks and mutation dispatch behavior",
          sourceBeforeSha256: before,
          sourceAfterSha256: after,
          mutationResidue: unchanged ? "ABSENT" : "PRESENT",
          records,
        },
        null,
        2,
      )}\n`,
    );
    if (!unchanged) throw new Error("Protected source changed during guidance proof");
  }
  return records;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  runGuidanceMutations();
