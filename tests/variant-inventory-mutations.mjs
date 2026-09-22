import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const baseline = "3b828756be8dd11e0dfdfc0d8b384a57f58fc135";
export const variantInventorySources = [
  "src/features/variant-inventory/contracts.ts",
  "src/features/variant-inventory/model.ts",
  "src/features/variant-inventory/queries.ts",
  "src/features/variant-inventory/mutations.ts",
];
export const variantInventoryTestPaths = [
  "src/features/variant-inventory/contracts.test.ts",
  "src/features/variant-inventory/model.test.ts",
  "src/features/variant-inventory/mutations.test.ts",
  "src/features/variant-inventory/safety.test.ts",
];
const protectedPaths = [
  ...variantInventorySources,
  ...variantInventoryTestPaths,
  "src/lib/backend/contracts.ts",
  "src/lib/backend/client.ts",
  "tests/architecture-policy.ts",
  "tests/architecture.test.ts",
  "tests/variant-inventory-architecture.test.ts",
  "tests/variant-inventory-mutations.mjs",
  "tests/variant-inventory-mutations.config.mjs",
];
const outputDirectory = process.env.QAFILAH_MUTATION_ARTIFACT_ROOT
  ? resolve(root, process.env.QAFILAH_MUTATION_ARTIFACT_ROOT, "variant-inventory-mutations")
  : join(root, "artifacts/f3e/variant-inventory-mutations");

export const variantInventoryVariants = {
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
    killedBy: "distinguishes unconfigured stock from configured zero stock",
    behavior: "Treat zero as unconfigured in the production inventory quantity formatter",
  },
  "response-consistency-bypass": {
    expected: "RED",
    killedBy: "rejects inconsistent, malformed, or expanded resources",
    behavior: "Keep structural decoding while accepting inconsistent quantity/availability pairs",
  },
  "post-success-duplicate": {
    expected: "RED",
    killedBy: "consumes success across the response boundary and remount until explicit review",
    behavior: "Release the controller's consumed success guard after the first response settles",
  },
  "single-flight-bypass": {
    expected: "RED",
    killedBy: "installs its latch before notifying synchronous subscribers",
    behavior:
      "Dispatch another actual PATCH on a reentrant submit instead of sharing the pending result",
  },
  "unknown-reuse": {
    expected: "RED",
    killedBy: "never automatically retries a dispatched unknown inventory update",
    behavior: "Allow the consumed unknown slot to submit again",
  },
  "stale-closure-reuse": {
    expected: "RED",
    killedBy: "shows intervening stock change and never replays the old submitted quantity",
    behavior: "Let an old form closure submit into a fresh reviewed interaction",
  },
  "failed-review-unlocks": {
    expected: "RED",
    killedBy: "retains unknown lock when loadVariantInventory review fails",
    behavior: "Release unknown state when an authoritative reconciliation read fails",
  },
  "write-permission-bypass": {
    expected: "RED",
    killedBy: "requires the exact context grant products.variants.inventory.update before dispatch",
    behavior: "Allow writes with only Product and Variant read permissions",
  },
  "confirmed-refresh-failure": {
    expected: "RED",
    killedBy: "preserves confirmed success and the consumed attempt if later Product refresh fails",
    behavior: "Downgrade a confirmed write after a projection refresh failure",
  },
  "cross-variant-controller": {
    expected: "RED",
    killedBy: "never shares a controller between Variants",
    behavior: "Remove Variant from session-owned mutation controller identity",
  },
  "navigation-uncertainty-loss": {
    expected: "RED",
    killedBy:
      "preserves unresolved intent through Store navigation and requires explicit review on return",
    behavior:
      "Ignore the unresolved marker when constructing a new scope controller after navigation",
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
export function transformVariantInventorySource(source, path, name) {
  if (!variantInventoryVariants[name])
    throw new Error(`Unknown inventory mutation variant: ${name}`);
  source = source.replaceAll("\r\n", "\n");
  if (name === "comment-decoy")
    return `/* retry PATCH; quantity ?? 0; ["product-inventory"]; remove success guard; bypass refine (comment only) */\n${source}`;
  if (name === "string-decoy")
    return `${source}\nvoid "retry PATCH; quantity ?? 0; unscoped inventory; bypass consistency; post-success replay (string only)";\n`;
  if (name === "automatic-retry" && path === variantInventorySources[3])
    return replaceOnce(
      source,
      /return api!\.updateVariantInventory\(([\s\S]*?)\);/,
      "return api!.updateVariantInventory($1).catch(() => api!.updateVariantInventory($1));",
    );
  if (name === "unscoped-cache" && path === variantInventorySources[2])
    return replaceOnce(
      source,
      'storeKeys.resource(scope, "variant-inventory", { productUuid, variantUuid })',
      '["variant-inventory", productUuid, variantUuid]',
    );
  if (name === "null-zero-conflation" && path === variantInventorySources[1])
    return replaceOnce(source, "quantity === null", "!quantity");
  if (name === "response-consistency-bypass" && path === variantInventorySources[0])
    return replaceOnce(source, /\.refine\(\(value\) =>([\s\S]*?)\n {2}\);/, ".refine(() => true);");
  if (name === "post-success-duplicate" && path === variantInventorySources[3])
    return replaceOnce(
      source,
      'review || state.status === "unknown" || state.status === "success"',
      'review || state.status === "unknown"',
    );
  if (name === "write-permission-bypass" && path === variantInventorySources[2])
    return replaceOnce(
      source,
      '(write && !current.context.permissions.includes("products.variants.inventory.update"))',
      "false",
    );
  if (path === variantInventorySources[3]) {
    if (name === "single-flight-bypass")
      return replaceOnce(
        source,
        "if (pending) return pending;",
        "if (pending) return api!.updateVariantInventory({ storeUuid: scope.storeUuid, productUuid, variantUuid, data: { quantity } });",
      );
    if (name === "unknown-reuse") {
      source = replaceOnce(
        source,
        'review || state.status === "unknown" || state.status === "success"',
        'review || state.status === "success"',
      );
      return replaceOnce(source, "if (unresolved.has(unresolvedIdentity)) {", "if (false) {");
    }
    if (name === "stale-closure-reuse") {
      const target = "if (expectedSlot !== state.slot) return Promise.resolve(null);";
      if (source.split(target).length !== 3) throw new Error("Expected two operative slot guards");
      return source.replaceAll(target, "");
    }
    if (name === "failed-review-unlocks")
      return replaceOnce(
        source,
        ": { ...previous, error: normalized },",
        ': { ...previous, status: "idle", slot: previous.slot + 1, error: normalized },',
      );
    if (name === "confirmed-refresh-failure")
      return replaceOnce(
        source,
        "update({ ...state, refreshError: normalized });",
        'update({ ...state, status: "error", refreshError: normalized });',
      );
    if (name === "cross-variant-controller")
      return replaceOnce(
        source,
        "JSON.stringify([options.product.id, options.variant.id])",
        "JSON.stringify([options.product.id])",
      );
    if (name === "navigation-uncertainty-loss")
      return replaceOnce(
        source,
        "let state: VariantInventoryMutationState = unresolved.has(unresolvedIdentity)",
        "let state: VariantInventoryMutationState = false",
      );
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

export function runVariantInventoryMutations() {
  mkdirSync(outputDirectory, { recursive: true });
  const before = snapshot();
  const records = [];
  let pristineTestCount;
  try {
    for (const [name, variant] of Object.entries(variantInventoryVariants)) {
      const transformedHashes = Object.fromEntries(
        variantInventorySources.map((path) => [
          path,
          sha256(
            transformVariantInventorySource(readFileSync(join(root, path), "utf8"), path, name),
          ),
        ]),
      );
      const reportFile = join(outputDirectory, `${name}.json`);
      const result = spawnSync(
        process.execPath,
        [
          join(root, "node_modules/vitest/vitest.mjs"),
          "run",
          "--config",
          "tests/variant-inventory-mutations.config.mjs",
        ],
        {
          cwd: root,
          env: {
            ...process.env,
            QAFILAH_VARIANT_INVENTORY_MUTANT: name,
            QAFILAH_VARIANT_INVENTORY_REPORT: reportFile,
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
            "All permanent Variant inventory contract, model, lifecycle and independent safety tests, without skipped/todo assertions",
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
  runVariantInventoryMutations();
