import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const baseline = "fc1b35e0679ab1b5f7e0076c744383216fb97eda";
export const mediaSources = [
  "src/lib/env.ts",
  "src/features/media/contracts.ts",
  "src/features/media/model.ts",
  "src/features/media/queries.ts",
  "src/features/media/mutations.ts",
  "src/lib/media-url.ts",
  "src/proxy.ts",
  "src/lib/api/client.ts",
  "src/lib/backend/client.ts",
];
export const mediaTestPaths = [
  "src/lib/env.test.ts",
  "src/features/media/contracts.test.ts",
  "src/features/media/model.test.ts",
  "src/features/media/mutations.test.ts",
  "src/features/media/safety.test.ts",
  "src/lib/media-url.test.ts",
  "src/proxy.test.ts",
  "src/lib/api/client.test.ts",
];
const protectedPaths = [
  ...mediaSources,
  ...mediaTestPaths,
  "src/lib/backend/contracts.ts",
  "src/lib/api/types.ts",
  "tests/architecture-policy.ts",
  "tests/architecture.test.ts",
  "tests/media-architecture.test.ts",
  "tests/media-mutations.mjs",
  "tests/media-mutations.config.mjs",
];
const outputDirectory = process.env.QAFILAH_MUTATION_ARTIFACT_ROOT
  ? resolve(root, process.env.QAFILAH_MUTATION_ARTIFACT_ROOT, "media-mutations")
  : join(root, "artifacts/f3f/media-mutations");
export const mediaVariants = {
  pristine: {
    expected: "GREEN",
  },
  "comment-decoy": {
    expected: "GREEN",
  },
  "string-decoy": {
    expected: "GREEN",
  },
  "multipart-header": {
    expected: "RED",
    killedBy: "uploads product with fresh multipart and no manual boundary",
    behavior: "Assign JSON Content-Type to a real multipart request",
  },
  "json-header-loss": {
    expected: "RED",
    killedBy: "PATCH product retains JSON and binds asset identity",
    behavior: "Remove Content-Type from the existing JSON path",
  },
  "patch-identity-bypass": {
    expected: "RED",
    killedBy: "PATCH product retains JSON and binds asset identity",
    behavior: "Accept a PATCH response for another MediaAsset UUID",
  },
  "unsafe-media-url": {
    expected: "RED",
    killedBy: "rejects unsafe media path",
    behavior: "Accept arbitrary strings in the centralized media path validator",
  },
  "wrong-media-origin": {
    expected: "RED",
    killedBy: "resolves only against the validated API origin",
    behavior: "Resolve Catalog images against a different dashboard origin",
  },
  "wildcard-api-origin": {
    expected: "RED",
    killedBy: "rejects unsafe production configuration https://*.example.test",
    behavior: "Allow wildcard API origins to become wildcard Catalog CSP image sources",
  },
  "wildcard-csp": {
    expected: "RED",
    killedBy: "permits only the validated API Catalog path",
    behavior: "Permit arbitrary image hosts through CSP",
  },
  "cross-kind-decoder": {
    expected: "RED",
    killedBy: "keeps media asset UUID distinct",
    behavior: "Accept Product-only is_primary in a Variant response",
  },
  "primary-invariant-loss": {
    expected: "RED",
    killedBy: "preserves returned tie ordering",
    behavior: "Accept a Product collection without its one primary image",
  },
  "unscoped-cache": {
    expected: "RED",
    killedBy: "separates principal Store revision Product Variant and media kind",
    behavior: "Remove principal Store and revision from collection identity",
  },
  "write-permission-bypass": {
    expected: "RED",
    killedBy: "requires independent product create grant",
    behavior: "Accept a create update delete with only media read authority",
  },
  "automatic-retry": {
    expected: "RED",
    killedBy: "consumes product create after unknown network",
    behavior: "Retry an actual dispatched media request after failure",
  },
  "post-success-duplicate": {
    expected: "RED",
    killedBy: "consumes product create until fresh review",
    behavior: "Allow another write after confirmed response before explicit review",
  },
  "single-flight-bypass": {
    expected: "RED",
    killedBy: "installs the collection latch",
    behavior: "Dispatch a second collection operation while the first is pending",
  },
  "unknown-reuse": {
    expected: "RED",
    killedBy: "consumes product create after unknown network",
    behavior: "Allow another write from the consumed unknown slot",
  },
  "stale-closure-reuse": {
    expected: "RED",
    killedBy: "consumes product create until fresh review",
    behavior: "Reuse an obsolete form callback after a fresh reviewed slot",
  },
  "failed-review-unlocks": {
    expected: "RED",
    killedBy: "keeps unknown lock when listVariantMedia review fails",
    behavior: "Release unknown state after failed authoritative review",
  },
  "confirmed-refresh-failure": {
    expected: "RED",
    killedBy: "retains confirmed success on Product projection failure",
    behavior: "Downgrade successful write after projection read failure",
  },
  "cross-kind-controller": {
    expected: "RED",
    killedBy: "does not share controllers across sessions, kinds",
    behavior: "Share mutation controllers between Product and Variant collections",
  },
  "navigation-uncertainty-loss": {
    expected: "RED",
    killedBy: "preserves unknown product create across Store A to B to A",
    behavior: "Discard the unresolved token when returning with a fresh authority revision",
  },
  "pristine-after": {
    expected: "GREEN",
  },
};
function replaceOnce(source, target, replacement) {
  const matches =
    typeof target === "string"
      ? source.split(target).length - 1
      : [...source.matchAll(new RegExp(target.source, "g"))].length;
  if (matches !== 1) throw new Error(`Expected exactly one operative media target: ${target}`);
  return source.replace(target, replacement);
}

/** Vite pre-transform only: production files and permanent tests are never rewritten. */
export function transformMediaSource(source, path, name) {
  if (!mediaVariants[name]) throw new Error(`Unknown media mutation variant: ${name}`);
  source = source.replaceAll("\r\n", "\n");
  if (name === "comment-decoy")
    return `/* upload replay; document.origin; img-src *; no media permission; localStorage.setItem("file", file); */\n${source}`;
  if (name === "string-decoy")
    return `${source}\nvoid 'upload replay; document.origin; img-src *; no media permission; retry: true';\n`;
  if (path === "src/lib/env.ts" && name === "wildcard-api-origin")
    return replaceOnce(source, 'url.hostname.includes("*") ||', "");
  if (path === "src/lib/api/client.ts") {
    if (name === "multipart-header")
      return replaceOnce(
        source,
        "if (body !== undefined && !contract.multipartBody)",
        "if (body !== undefined)",
      );
    if (name === "json-header-loss")
      return replaceOnce(
        source,
        'headers.set("Content-Type", "application/json");',
        'headers.delete("Content-Type");',
      );
  }
  if (path === "src/lib/backend/client.ts" && name === "patch-identity-bypass") {
    const target = "(result, request) => result.id === request.mediaUuid.toLowerCase()";
    if (source.split(target).length !== 3)
      throw new Error("Expected both MediaAsset identity checks");
    return source.replaceAll(target, "() => true");
  }
  if (path === "src/lib/media-url.ts") {
    if (name === "unsafe-media-url")
      return replaceOnce(
        source,
        'typeof value === "string" && mediaPath.test(value)',
        'typeof value === "string"',
      );
    if (name === "wrong-media-origin")
      return replaceOnce(
        source,
        "new URL(path, origin)",
        'new URL(path, "https://dashboard.example.test")',
      );
  }
  if (path === "src/proxy.ts" && name === "wildcard-csp")
    return replaceOnce(source, "` ${apiOrigin}/storage/catalog/`", '" *"');
  if (path === "src/features/media/contracts.ts") {
    if (name === "cross-kind-decoder")
      return replaceOnce(source, ".strictObject(shape)", ".object(shape)");
    if (name === "primary-invariant-loss")
      return replaceOnce(
        source,
        ".refine((items) => items.length === 0 || items.filter((item) => item.is_primary).length === 1)",
        ".refine(() => true)",
      );
  }
  if (path === "src/features/media/queries.ts") {
    if (name === "unscoped-cache")
      return replaceOnce(source, 'storeKeys.resource(scope, "media", target)', '["media", target]');
    if (name === "write-permission-bypass")
      return replaceOnce(
        source,
        "(operation && !current.context.permissions.includes(mediaPermissions[operation]))",
        "false",
      );
  }
  if (path === "src/features/media/mutations.ts") {
    if (name === "automatic-retry")
      return replaceOnce(
        source,
        "return dispatch(intent, signal).then((result) => {",
        "return dispatch(intent, signal).catch(() => dispatch(intent, signal)).then((result) => {",
      );
    if (name === "post-success-duplicate")
      return replaceOnce(
        source,
        'review || state.status === "unknown" || state.status === "success"',
        'review || state.status === "unknown"',
      );
    if (name === "single-flight-bypass")
      return replaceOnce(
        source,
        "if (pending) return pending;",
        "if (pending) return dispatch(snapshotIntent(input), new AbortController().signal).then((media) => ({ operation: input.operation, media }));",
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
      if (source.split(target).length !== 3) throw new Error("Expected both consumed slot guards");
      return source.replaceAll(target, "");
    }
    if (name === "failed-review-unlocks")
      return replaceOnce(
        source,
        ": { ...previous, error: normalized },",
        ': { ...previous, status: "idle", error: normalized },',
      );
    if (name === "confirmed-refresh-failure")
      return replaceOnce(
        source,
        "update({ ...state, refreshError: normalized });",
        'update({ ...state, status: "error", refreshError: normalized });',
      );
    if (name === "cross-kind-controller")
      return replaceOnce(
        source,
        `const identity = JSON.stringify([
    target.kind,
    target.productUuid,
    target.kind === "variant" ? target.variantUuid : null,
  ]);`,
        "const identity = JSON.stringify([target.productUuid]);",
      );
    if (name === "navigation-uncertainty-loss")
      return replaceOnce(
        source,
        "let state: MediaMutationState = unresolved.has(unresolvedIdentity)",
        "let state: MediaMutationState = false",
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

export function runMediaMutations() {
  mkdirSync(outputDirectory, { recursive: true });
  // Refuse drifted operative targets before starting any child test process.
  for (const name of Object.keys(mediaVariants))
    for (const path of mediaSources)
      transformMediaSource(readFileSync(join(root, path), "utf8"), path, name);
  const before = snapshot();
  const records = [];
  let pristineTestCount;
  try {
    for (const [name, variant] of Object.entries(mediaVariants)) {
      const transformedHashes = Object.fromEntries(
        mediaSources.map((path) => [
          path,
          sha256(transformMediaSource(readFileSync(join(root, path), "utf8"), path, name)),
        ]),
      );
      const reportFile = join(outputDirectory, `${name}.json`);
      const result = spawnSync(
        process.execPath,
        [
          join(root, "node_modules/vitest/vitest.mjs"),
          "run",
          "--config",
          "tests/media-mutations.config.mjs",
        ],
        {
          cwd: root,
          env: {
            ...process.env,
            QAFILAH_MEDIA_MUTANT: name,
            QAFILAH_MEDIA_REPORT: reportFile,
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
          `Media variant did not complete: ${result.error?.message ?? result.signal}`,
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
        throw new Error(`Media variant ${name}: expected ${variant.expected}, received ${actual}`);
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
            "All permanent media contract, model, lifecycle, independent safety, central transport, URL and CSP tests without skipped/todo assertions",
          sourceBeforeSha256: before,
          sourceAfterSha256: after,
          mutationResidue: unchanged ? "ABSENT" : "PRESENT",
          records,
        },
        null,
        2,
      )}\n`,
    );
    if (!unchanged) throw new Error("Protected source changed during media proof");
  }
  return records;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  runMediaMutations();
