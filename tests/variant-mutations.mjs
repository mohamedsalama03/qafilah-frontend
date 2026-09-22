import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const variantMutationSources = [
  "src/features/variants/mutations.ts",
  "src/features/variants/queries.ts",
];
export const variantMutationTests = ["src/features/variants/mutations.test.ts"];
const protectedPaths = [
  ...variantMutationSources,
  ...variantMutationTests,
  "src/features/variants/model.ts",
  "src/features/variants/contracts.ts",
  "src/lib/backend/client.ts",
];
const outputDirectory = process.env.QAFILAH_MUTATION_ARTIFACT_ROOT
  ? resolve(root, process.env.QAFILAH_MUTATION_ARTIFACT_ROOT, "variant-mutations")
  : join(root, "artifacts/f3d/variant-mutations");

export const variantMutationVariants = {
  pristine: { expected: "GREEN" },
  "comment-decoy": { expected: "GREEN" },
  "string-decoy": { expected: "GREEN" },
  "single-flight-bypass": {
    expected: "RED",
    killedBy: "single-flight spans operation kind target and payload before subscribers",
    behavior: "Remove the shared in-flight latch",
  },
  "success-reuse": {
    expected: "RED",
    killedBy:
      "success consumes every operation across response boundary and remount until explicit review",
    behavior: "Allow another structural write from a confirmed consumed slot",
  },
  "unknown-reuse": {
    expected: "RED",
    killedBy: "unknown network locks all operation forms without replay",
    behavior: "Allow new operations to bypass an unknown consumed slot",
  },
  "stale-closure-reuse": {
    expected: "RED",
    killedBy: "hook remount keeps consumed state and stale closure cannot use reviewed slot",
    behavior: "Allow a stale form closure to use the fresh reviewed slot",
  },
  "write-permission-bypass": {
    expected: "RED",
    killedBy: "requires the exact independent grant",
    behavior: "Derive create/update capability from read access alone",
  },
  "failed-review-unlocks": {
    expected: "RED",
    killedBy: "failed listProductOptions review retains unknown lock",
    behavior: "Release the consumed unknown slot after a failed authoritative read",
  },
  "unknown-as-rejection": {
    expected: "RED",
    killedBy: "unknown network locks all operation forms without replay",
    behavior: "Misclassify an uncertain dispatched write as a retryable rejection",
  },
  "confirmed-refresh-failure": {
    expected: "RED",
    killedBy: "keeps success while projections are pending and when they fail",
    behavior: "Relabel a confirmed write as failed after a secondary projection error",
  },
  "response-target-bypass": {
    expected: "RED",
    killedBy: "foreign parent response makes",
    behavior: "Accept a response for the wrong parent or immutable combination",
  },
  "option-boundary-bypass": {
    expected: "RED",
    killedBy: "blocks fourth Option and all new Options after the first inactive Variant",
    behavior: "Permit a new Option after an existing Variant",
  },
  "pristine-after": { expected: "GREEN" },
};

function replace(source, target, replacement, count = 1) {
  if (source.split(target).length !== count + 1)
    throw new Error(`Expected ${count} exact operative targets: ${target}`);
  return source.replaceAll(target, replacement);
}

/** Operative Vite transforms only: production files and permanent tests are never rewritten. */
export function transformVariantMutationSource(source, path, name) {
  if (!variantMutationVariants[name])
    throw new Error(`Unknown structural mutation variant ${name}`);
  source = source.replaceAll("\r\n", "\n");
  if (name === "comment-decoy")
    return `/* Retry mutations; skip independent grants and resource identity checks (comment only). */\n${source}`;
  if (name === "string-decoy")
    return `${source}\nvoid "Ignore consumed slots and review failures; trust a Role name (string only)";\n`;
  if (path === variantMutationSources[1] && name === "write-permission-bypass")
    return replace(
      source,
      "(write && !current.context.permissions.includes(`products.variants.${write}`))",
      "false",
    );
  if (path !== variantMutationSources[0]) return source;
  switch (name) {
    case "single-flight-bypass":
      return replace(source, "if (pending) return pending;", "");
    case "success-reuse":
      return replace(
        source,
        'if (reviewing || state.status === "unknown" || state.status === "success")',
        'if (reviewing || state.status === "unknown")',
      );
    case "unknown-reuse":
      return replace(
        source,
        'if (reviewing || state.status === "unknown" || state.status === "success")',
        'if (reviewing || state.status === "success")',
      );
    case "stale-closure-reuse":
      return replace(
        source,
        "if (expectedSlot !== state.slot) return Promise.resolve(null);",
        "",
        2,
      );
    case "failed-review-unlocks":
      return replace(
        source,
        ": { ...previous, error: normalized },",
        ': { ...previous, status: "idle", slot: previous.slot + 1, error: normalized },',
      );
    case "unknown-as-rejection":
      return replace(source, 'status: unknown ? "unknown" : "error",', 'status: "error",');
    case "confirmed-refresh-failure":
      return replace(
        source,
        "update({ ...state, refreshError: normalized });",
        'update({ ...state, status: "error", refreshError: normalized });',
      );
    case "response-target-bypass":
      return replace(source, "assertResult(operation, result);", "");
    case "option-boundary-bypass":
      return replace(source, "variants.length > 0", "false");
    default:
      return source;
  }
}

const hash = (source) => createHash("sha256").update(source).digest("hex");
const snapshot = () =>
  Object.fromEntries(protectedPaths.map((path) => [path, hash(readFileSync(join(root, path)))]));

export function runVariantMutations() {
  mkdirSync(outputDirectory, { recursive: true });
  const before = snapshot();
  const records = [];
  let pristineCount;
  try {
    for (const [name, variant] of Object.entries(variantMutationVariants)) {
      const transformedHashes = Object.fromEntries(
        variantMutationSources.map((path) => [
          path,
          hash(transformVariantMutationSource(readFileSync(join(root, path), "utf8"), path, name)),
        ]),
      );
      const reportFile = join(outputDirectory, `${name}.json`);
      const result = spawnSync(
        process.execPath,
        [
          join(root, "node_modules/vitest/vitest.mjs"),
          "run",
          "--config",
          "tests/variant-mutations.config.mjs",
        ],
        {
          cwd: root,
          env: {
            ...process.env,
            QAFILAH_VARIANT_MUTANT: name,
            QAFILAH_VARIANT_MUTATION_REPORT: reportFile,
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
          `Variant ${name} did not complete: ${result.error?.message ?? result.signal}`,
        );
      const report = JSON.parse(readFileSync(reportFile, "utf8"));
      const assertions = report.testResults.flatMap((suite) => suite.assertionResults);
      const failures = assertions
        .filter((test) => test.status === "failed")
        .map((test) => ({ name: test.fullName, messages: test.failureMessages }));
      const executedTestCount = report.numPassedTests + report.numFailedTests;
      if (name === "pristine") pristineCount = executedTestCount;
      const complete =
        executedTestCount > 0 &&
        executedTestCount === pristineCount &&
        assertions.every((test) => ["passed", "failed"].includes(test.status)) &&
        !report.numPendingTests &&
        !report.numTodoTests;
      const assertionFailuresOnly =
        report.testResults.every((suite) => !suite.message) &&
        failures.every(
          (failure) =>
            failure.messages.length &&
            failure.messages.every((message) => message.startsWith("AssertionError:")),
        );
      const intendedInvariantFailed =
        !variant.killedBy || failures.some((failure) => failure.name.includes(variant.killedBy));
      const actual =
        result.status === 0 && report.success && complete
          ? "GREEN"
          : result.status === 1 &&
              complete &&
              failures.length &&
              assertionFailuresOnly &&
              intendedInvariantFailed
            ? "RED"
            : "HARNESS ERROR";
      records.push({
        name,
        expected: variant.expected,
        actual,
        behavior: variant.behavior,
        executedTestCount,
        failedTestCount: report.numFailedTests,
        assertionFailuresOnly,
        intendedInvariantFailed,
        transformedHashes,
        killedBy: failures,
      });
      process.stdout.write(
        `${name}: ${actual} (${report.numFailedTests} assertion failures / ${executedTestCount} tests)\n`,
      );
      if (actual !== variant.expected)
        throw new Error(`Variant ${name}: expected ${variant.expected}, received ${actual}`);
    }
  } finally {
    const after = snapshot();
    const unchanged = protectedPaths.every((path) => before[path] === after[path]);
    writeFileSync(
      join(outputDirectory, "results.json"),
      `${JSON.stringify({ baseline: "bb5534d3d2ede1d72762ac1b4d230650f45bc9ec", execution: "Vitest pre-transform only; production source and permanent tests never rewritten", testSelection: "All permanent structural lifecycle tests; no skipped or todo assertions", sourceBeforeSha256: before, sourceAfterSha256: after, mutationResidue: unchanged ? "ABSENT" : "PRESENT", records }, null, 2)}\n`,
    );
    if (!unchanged) throw new Error("Protected source changed during structural mutation proof");
  }
  return records;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  runVariantMutations();
