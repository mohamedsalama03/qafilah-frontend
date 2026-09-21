import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const baseline = "f0439c35d963bcfd67e79ebda1fcd0e23028b93d";
export const inventorySources = [
  "src/features/inventory/contracts.ts",
  "src/features/inventory/model.ts",
  "src/features/inventory/queries.ts",
  "src/features/inventory/mutations.ts",
];
export const inventoryTestPaths = [
  "src/features/inventory/contracts.test.ts",
  "src/features/inventory/mutations.test.ts",
];
const protectedPaths = [
  ...inventorySources,
  ...inventoryTestPaths,
  "src/lib/backend/contracts.ts",
  "src/lib/backend/client.ts",
  "tests/architecture-policy.ts",
  "tests/architecture.test.ts",
];
const outputDirectory = process.env.QAFILAH_MUTATION_ARTIFACT_ROOT
  ? resolve(root, process.env.QAFILAH_MUTATION_ARTIFACT_ROOT, "inventory-mutations")
  : join(root, "artifacts/f3c/inventory-mutations");

export const inventoryVariants = {
  pristine: { expected: "GREEN" },
  "comment-decoy": { expected: "GREEN" },
  "string-decoy": { expected: "GREEN" },
  "automatic-retry": {
    expected: "RED",
    killedBy: "never automatically retries a dispatched unknown inventory update",
    behavior: "Retry the actual inventory PATCH once after its promise rejects",
  },
  "unscoped-cache": {
    expected: "RED",
    killedBy: "keeps inventory cache keys scoped to principal Store revision and Product",
    behavior: "Remove principal, Store and authority revision from the live inventory key factory",
  },
  "null-zero-conflation": {
    expected: "RED",
    killedBy: "distinguishes null from zero without numeric coercion",
    behavior: "Treat zero as unconfigured in the production inventory quantity formatter",
  },
  "response-consistency-bypass": {
    expected: "RED",
    killedBy: "rejects inconsistent quantity and availability",
    behavior: "Keep structural decoding while accepting inconsistent quantity/availability pairs",
  },
  "post-success-duplicate": {
    expected: "RED",
    killedBy: "consumes success across the response boundary and remount until explicit review",
    behavior: "Release the controller's consumed success guard after the first response settles",
  },
  "pristine-after": { expected: "GREEN" },
};

function replaceOnce(source, target, replacement) {
  const matches =
    typeof target === "string"
      ? source.split(target).length - 1
      : [...source.matchAll(new RegExp(target.source, "g"))].length;
  if (matches !== 1) throw new Error(`Expected exactly one operative inventory target: ${target}`);
  return source.replace(target, replacement);
}

/** Vite pre-transform only: production files and tests are never rewritten. */
export function transformInventorySource(source, path, name) {
  if (!inventoryVariants[name]) throw new Error(`Unknown inventory mutation variant: ${name}`);
  source = source.replaceAll("\r\n", "\n");
  if (name === "comment-decoy")
    return `/* retry PATCH; quantity ?? 0; ["product-inventory"]; remove success guard; bypass refine (comment only) */\n${source}`;
  if (name === "string-decoy")
    return `${source}\nvoid "retry PATCH; quantity ?? 0; unscoped inventory; bypass consistency; post-success replay (string only)";\n`;
  if (name === "automatic-retry" && path === inventorySources[3])
    return replaceOnce(
      source,
      /return api!\.updateProductInventory\(([\s\S]*?)\);/,
      "return api!.updateProductInventory($1).catch(() => api!.updateProductInventory($1));",
    );
  if (name === "unscoped-cache" && path === inventorySources[2])
    return replaceOnce(
      source,
      'storeKeys.resource(scope, "product-inventory", { productUuid })',
      '["product-inventory", productUuid]',
    );
  if (name === "null-zero-conflation" && path === inventorySources[1])
    return replaceOnce(source, "quantity === null", "!quantity");
  if (name === "response-consistency-bypass" && path === inventorySources[0])
    return replaceOnce(source, /\.refine\(\(value\) =>([\s\S]*?)\n {2}\);/, ".refine(() => true);");
  if (name === "post-success-duplicate" && path === inventorySources[3])
    return replaceOnce(
      source,
      'review || state.status === "unknown" || state.status === "success"',
      'review || state.status === "unknown"',
    );
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

function isAssertionFailure(message) {
  // Vitest emits a plain Error for a rejects/resolves matcher mismatch. Require
  // its assertion-runtime frame as well as the specific mismatch wording; a
  // runtime/import/compilation Error is never evidence that a mutant was killed.
  return (
    message.startsWith("AssertionError:") ||
    (/^Error: promise (?:resolved|rejected) [\s\S]*? instead of (?:rejecting|resolving)/.test(
      message,
    ) &&
      /__VITEST_(?:REJECTS|RESOLVES)__/.test(message))
  );
}

export function runInventoryMutations() {
  mkdirSync(outputDirectory, { recursive: true });
  const before = snapshot();
  const records = [];
  let pristineTestCount;
  try {
    for (const [name, variant] of Object.entries(inventoryVariants)) {
      const transformedHashes = Object.fromEntries(
        inventorySources.map((path) => [
          path,
          sha256(transformInventorySource(readFileSync(join(root, path), "utf8"), path, name)),
        ]),
      );
      const reportFile = join(outputDirectory, `${name}.json`);
      const result = spawnSync(
        process.execPath,
        [
          join(root, "node_modules/vitest/vitest.mjs"),
          "run",
          "--config",
          "tests/inventory-mutations.config.mjs",
        ],
        {
          cwd: root,
          env: {
            ...process.env,
            QAFILAH_INVENTORY_MUTANT: name,
            QAFILAH_INVENTORY_REPORT: reportFile,
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
          `Inventory variant did not complete: ${result.error?.message ?? result.signal}`,
        );
      const report = JSON.parse(readFileSync(reportFile, "utf8"));
      const assertions = report.testResults.flatMap((suite) => suite.assertionResults);
      const failures = assertions
        .filter((test) => test.status === "failed")
        .map((test) => ({
          name: test.fullName,
          messages: test.failureMessages,
        }));
      const executedTestCount = report.numPassedTests + report.numFailedTests;
      if (name === "pristine") pristineTestCount = executedTestCount;
      const complete =
        executedTestCount > 0 &&
        executedTestCount === pristineTestCount &&
        assertions.every((test) => ["passed", "failed"].includes(test.status)) &&
        !report.numPendingTests &&
        !report.numTodoTests;
      const assertionFailuresOnly =
        report.testResults.every((suite) => !suite.message) &&
        failures.every(
          (failure) => failure.messages.length && failure.messages.every(isAssertionFailure),
        );
      const intendedInvariantFailed =
        !variant.killedBy || failures.some((failure) => failure.name.includes(variant.killedBy));
      const actual =
        result.status === 0 && report.success && complete
          ? "GREEN"
          : result.status === 1 &&
              complete &&
              failures.length > 0 &&
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
        throw new Error(
          `Inventory variant ${name}: expected ${variant.expected}, received ${actual}`,
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
          execution:
            "Vitest pre-transform only; production source and permanent tests never rewritten",
          testSelection:
            "All permanent inventory contract and controller tests, without skipped/todo assertions",
          sourceBeforeSha256: before,
          sourceAfterSha256: after,
          mutationResidue: unchanged ? "ABSENT" : "PRESENT",
          records,
        },
        null,
        2,
      )}\n`,
    );
    if (!unchanged) throw new Error("Protected source changed during inventory proof");
  }
  return records;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  runInventoryMutations();
