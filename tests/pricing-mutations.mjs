import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const baseline = "add4cc9ca38ffece91763ccf0684684f1efc5092";
export const pricingSources = [
  "src/features/pricing/model.ts",
  "src/features/pricing/queries.ts",
  "src/features/pricing/mutations.ts",
  "src/features/pricing/components/pricing-panel.tsx",
  "src/features/products/model.ts",
];
export const pricingTestPaths = [
  "src/features/pricing/model.test.ts",
  "src/features/pricing/mutations.test.ts",
  "tests/pricing-architecture.test.ts",
];
const protectedPaths = [
  ...pricingSources,
  ...pricingTestPaths,
  "tests/pricing-policy.ts",
  "tests/currency-authority-policy.ts",
  "tests/architecture-policy.ts",
  "tests/pricing-mutations.mjs",
  "tests/pricing-mutations.config.mjs",
];
const outputDirectory = join(root, "artifacts/f3g/pricing-mutations");
export const pricingVariants = {
  pristine: { expected: "GREEN" },
  "comment-decoy": { expected: "GREEN" },
  "string-decoy": { expected: "GREEN" },
  "automatic-replay": {
    expected: "RED",
    killedBy: "never replays unknown writes; review observes only and requires a fresh slot",
  },
  "wrong-exponent": { expected: "RED", killedBy: "uses the published currency exponents" },
  "floating-money": {
    expected: "RED",
    killedBy: "keeps production pricing and currency authority safe",
  },
  "currency-fallback": {
    expected: "RED",
    killedBy: "keeps production pricing and currency authority safe",
  },
  "unscoped-key": {
    expected: "RED",
    killedBy: "scopes keys to principal Store authority Product and Variant",
  },
  "read-bypass": { expected: "RED", killedBy: "denies write-only reads and editor dispatch" },
  "write-bypass": { expected: "RED", killedBy: "checks independent grant" },
  "success-reuse": {
    expected: "RED",
    killedBy: "single flights reentrant submissions and consumes success across remount",
  },
  "failed-review-unlocks": { expected: "RED", killedBy: "failed review retains the unknown lock" },
  "stale-handler": {
    expected: "RED",
    killedBy: "never replays unknown writes; review observes only and requires a fresh slot",
  },
  "lost-uncertainty": {
    expected: "RED",
    killedBy: "keeps uncertainty across Store navigation and read-permission loss",
  },
  "pristine-after": { expected: "GREEN" },
};
function replaceOnce(source, from, to) {
  if (source.split(from).length !== 2)
    throw new Error("Expected one operative pricing anchor: " + from);
  return source.replace(from, to);
}
export function transformPricingSource(source, path, name) {
  if (name === "comment-decoy")
    return (
      source +
      '\n// Math.round(parseFloat(text) * 100); const currency = context.store.currency ?? "LYD";\n'
    );
  if (name === "string-decoy")
    return (
      source +
      '\nconst pricingDocumentationDecoy = "api.updateProductPricing(input); retry: 2"; void pricingDocumentationDecoy;\n'
    );
  if (path === "src/features/products/model.ts" && name === "wrong-exponent")
    return replaceOnce(source, "LYD: 3", "LYD: 2");
  if (path === "src/features/pricing/model.ts" && name === "floating-money")
    return replaceOnce(
      source,
      "priceAmountSchema.parse(Number(digits))",
      "priceAmountSchema.parse(Math.round(parseFloat(input) * 10 ** exponent))",
    );
  if (path.endsWith("pricing-panel.tsx") && name === "currency-fallback")
    return replaceOnce(
      source,
      "const currency = state.context?.store.currency;",
      'const currency = state.context?.store.currency ?? "LYD";',
    );
  if (path.endsWith("pricing/queries.ts")) {
    if (name === "unscoped-key")
      return replaceOnce(
        source,
        'storeKeys.resource(scope, "pricing", { productUuid, variantUuid })',
        '["pricing", productUuid, variantUuid]',
      );
    if (name === "read-bypass")
      return source
        .replace('!current.context.permissions.includes("products.view")', "false")
        .replace(
          '!!variantUuid && !current.context.permissions.includes("products.variants.view")',
          "false",
        );
    if (name === "write-bypass") return replaceOnce(source, "(write &&", "(write && false &&");
  }
  if (path.endsWith("pricing/mutations.ts")) {
    if (name === "automatic-replay") {
      const matches = [
        ...source.matchAll(/return variantUuid[\s\S]+?: api!\.updateProductPricing\([\s\S]+?\);/g),
      ];
      if (matches.length !== 1) throw new Error("Expected one pricing dispatch branch");
      const original = matches[0][0],
        expression = original.slice(7, -1);
      return source.replace(
        original,
        "const repeat = () => " + expression + "; return repeat().catch(() => repeat());",
      );
    }
    if (name === "success-reuse")
      return replaceOnce(
        source,
        'review || state.status === "unknown" || state.status === "success"',
        'review || state.status === "unknown"',
      );
    if (name === "failed-review-unlocks")
      return replaceOnce(
        source,
        "{ ...previous, error: normalized }",
        '{ ...previous, status: "idle", error: normalized }',
      );
    if (name === "stale-handler") return source.replaceAll("expectedSlot !== state.slot", "false");
    if (name === "lost-uncertainty")
      return replaceOnce(
        source,
        "let state: PricingMutationState = unresolved.has(unresolvedIdentity)",
        "let state: PricingMutationState = false",
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

export function runPricingMutations() {
  mkdirSync(outputDirectory, { recursive: true });
  const before = snapshot();
  const records = [];
  let pristineTestCount;
  try {
    for (const [name, variant] of Object.entries(pricingVariants)) {
      const transformedHashes = Object.fromEntries(
        pricingSources.map((path) => [
          path,
          sha256(transformPricingSource(readFileSync(join(root, path), "utf8"), path, name)),
        ]),
      );
      const reportFile = join(outputDirectory, `${name}.json`);
      const result = spawnSync(
        process.execPath,
        [
          join(root, "node_modules/vitest/vitest.mjs"),
          "run",
          "--config",
          "tests/pricing-mutations.config.mjs",
        ],
        {
          cwd: root,
          env: {
            ...process.env,
            QAFILAH_PRICING_MUTANT: name,
            QAFILAH_PRICING_REPORT: reportFile,
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
          `Pricing variant did not complete: ${result.error?.message ?? result.signal}`,
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
          `Pricing variant ${name}: expected ${variant.expected}, received ${actual}`,
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
            "All permanent Pricing contract, model, lifecycle and independent safety tests, without skipped/todo assertions",
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
  runPricingMutations();
