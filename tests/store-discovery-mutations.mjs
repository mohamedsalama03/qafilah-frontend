import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const controllerPath = join(root, "src/lib/stores/controller.ts");
const outputDirectory = join(root, "artifacts/f2-remediation/mutations");

function replaceOnce(source, before, after) {
  if (source.split(before).length !== 2) {
    throw new Error(`Expected one mutation target: ${before}`);
  }
  return source.replace(before, after);
}

// These transformations are applied only to Vitest's in-memory module source.
// The regular regression tests supply the assertions; no production file is rewritten.
export const discoveryMutations = {
  pristine: (source) => source,
  "comment-decoy": (source) =>
    `/* total last_page per_page current_page; accept partial stores; retry forever. */\n${source}`,
  "documentation-decoy": (source) =>
    `${source}\n/** Example regression descriptions: remove the ceiling; clear verified stores. */\n`,
  "accept-total-drift": (source) =>
    replaceOnce(source, "pagination.total !== pinned.total ||", "false ||"),
  "accept-last-page-drift": (source) =>
    replaceOnce(source, "pagination.last_page !== pinned.last_page ||", "false ||"),
  "accept-per-page-drift": (source) =>
    replaceOnce(source, "pagination.per_page !== pinned.per_page", "false"),
  "accept-wrong-current-page": (source) =>
    replaceOnce(source, "pagination.current_page !== page ||", "false ||"),
  "silent-duplicate-normalization": (source) =>
    replaceOnce(
      replaceOnce(
        source,
        "if (previous) throw new DiscoveryInconsistency();",
        "if (previous) continue;",
      ),
      "if (!pinned || stores.size !== pinned.total) throw new DiscoveryInconsistency();",
      "if (!pinned) throw new DiscoveryInconsistency();",
    ),
  "conflicting-duplicate-first-wins": (source) =>
    replaceOnce(
      discoveryMutations["silent-duplicate-normalization"](source),
      "if (previous && (previous.name !== store.name || previous.status !== store.status))",
      "if (false)",
    ),
  "mixed-candidate-publication": (source) =>
    replaceOnce(
      source,
      "      }\n    }\n    if (!pinned",
      `      }
      const partial = Object.freeze([...stores.values()]);
      options.queryClient.setQueryData(discoveryKey, partial);
      update({ ...state, stores: partial, discoveryStatus: "ready", discoveryError: null });
    }
    if (!pinned`,
    ),
  "retry-bound-removal": (source) =>
    replaceOnce(
      source,
      "const maximumDiscoveryAttempts = 2;",
      "const maximumDiscoveryAttempts = Infinity;",
    ),
  "page-ceiling-removal": (source) =>
    replaceOnce(source, "pagination.last_page > maximumDiscoveryPages", "false"),
  "transient-refresh-clears-verified-list": (source) =>
    replaceOnce(
      source,
      "stores: retainVerified ? state.stores : emptyStores,",
      "stores: emptyStores,",
    ),
  "first-page-only": (source) =>
    replaceOnce(source, "page <= (pinned?.last_page ?? 1)", "page <= 1"),
  "no-consistency-retry": (source) =>
    replaceOnce(
      source,
      "const maximumDiscoveryAttempts = 2;",
      "const maximumDiscoveryAttempts = 1;",
    ),
  "baseline-a2-reproduction": () => {
    const baseline = execFileSync(
      "git",
      ["show", "9f12cefbfe227eb96983a2efa605b52b52c82f07:src/lib/stores/controller.ts"],
      {
        cwd: root,
        encoding: "utf8",
        windowsHide: true,
      },
    );
    const observed = replaceOnce(
      baseline.replaceAll("\r\n", "\n"),
      'update({ ...state, stores: result, discoveryStatus: "ready", discoveryError: null });',
      `update({ ...state, stores: result, discoveryStatus: "ready", discoveryError: null });
        recordBaselineEvidence(process.env.QAFILAH_DISCOVERY_BASELINE_EVIDENCE, JSON.stringify({
          baselineCommit: "9f12cefbfe227eb96983a2efa605b52b52c82f07",
          discoveryStatus: state.discoveryStatus,
          publishedStoreCount: state.stores.length,
          revokedStore5StillPresent: state.stores.some(store => store.name === "Store 5"),
          eligibleStore21Missing: !state.stores.some(store => store.name === "Store 21"),
          fixture: "synthetic controller fixture; no backend mutation"
        }, null, 2));`,
    );
    return `import { writeFileSync as recordBaselineEvidence } from "node:fs";\n${observed}`;
  },
  "pristine-after": (source) => source,
};

export function transformDiscoverySource(source, name) {
  const transform = discoveryMutations[name];
  if (!transform) throw new Error(`Unknown Store discovery mutation: ${name}`);
  return transform(source.replaceAll("\r\n", "\n"));
}

const focusedPatterns = {
  "retry-bound-removal":
    "stops after two inconsistent attempts with explicit initial failure and no third attempt",
  "first-page-only": "publishes all .* healthy Stores|fetches all 23 memberships",
  "no-consistency-retry": "restarts at page one",
  "baseline-a2-reproduction":
    "reproduces the 41-to-40 membership race without retaining revoked Store 5 or missing Store 21",
};

function sha256(source) {
  return createHash("sha256").update(source).digest("hex");
}

export function runDiscoveryMutations() {
  mkdirSync(outputDirectory, { recursive: true });
  const before = readFileSync(controllerPath);
  const records = [];
  for (const name of Object.keys(discoveryMutations)) {
    // Validate the mutation target before spawning. A stale target is an error, never RED proof.
    transformDiscoverySource(before.toString("utf8"), name);
    const reportFile = join(outputDirectory, `${name}.json`);
    const result = spawnSync(
      process.execPath,
      [
        join(root, "node_modules/vitest/vitest.mjs"),
        "run",
        "--config",
        "tests/store-discovery-mutations.config.mjs",
      ],
      {
        cwd: root,
        env: {
          ...process.env,
          QAFILAH_DISCOVERY_MUTANT: name,
          QAFILAH_DISCOVERY_MUTATION_REPORT: reportFile,
          QAFILAH_DISCOVERY_MUTATION_TEST_PATTERN: focusedPatterns[name] ?? "",
          QAFILAH_DISCOVERY_BASELINE_EVIDENCE: join(outputDirectory, "baseline-a2-observed.json"),
          NO_COLOR: "1",
        },
        encoding: "utf8",
        timeout: 60_000,
        maxBuffer: 8 * 1024 * 1024,
        windowsHide: true,
      },
    );
    writeFileSync(join(outputDirectory, `${name}.log`), `${result.stdout}\n${result.stderr}`);
    if (result.error || result.signal) {
      throw new Error(
        `Mutation ${name} did not complete: ${result.error?.message ?? result.signal}`,
      );
    }
    const report = JSON.parse(readFileSync(reportFile, "utf8"));
    const failures = report.testResults.flatMap((suite) =>
      suite.assertionResults
        .filter((assertion) => assertion.status === "failed")
        .map((assertion) => ({
          name: assertion.fullName,
          messages: assertion.failureMessages,
        })),
    );
    const assertionFailuresOnly =
      report.testResults.every((suite) => !suite.message) &&
      failures.every(
        (failure) =>
          failure.messages.length > 0 &&
          failure.messages.every((message) => message.startsWith("AssertionError:")),
      );
    const expected = name.startsWith("pristine") || name.endsWith("-decoy") ? "GREEN" : "RED";
    const actual =
      result.status === 0 && report.success === true
        ? "GREEN"
        : result.status === 1 &&
            failures.length > 0 &&
            report.numFailedTests === failures.length &&
            assertionFailuresOnly
          ? "RED"
          : "HARNESS ERROR";
    const record = {
      name,
      expected,
      actual,
      testCount: report.numTotalTests,
      executedTestCount: report.numPassedTests + report.numFailedTests,
      failedTestCount: report.numFailedTests,
      assertionFailuresOnly,
      focusedTestPattern: focusedPatterns[name] ?? null,
      killedBy: failures,
      sourceSha256: sha256(transformDiscoverySource(before.toString("utf8"), name)),
    };
    records.push(record);
    process.stdout.write(`${name}: ${actual} (${report.numFailedTests} failed assertions)\n`);
    if (actual !== expected) {
      writeFileSync(join(outputDirectory, "results.json"), JSON.stringify(records, null, 2));
      throw new Error(`Mutation ${name}: expected ${expected}, received ${actual}`);
    }
  }
  const after = readFileSync(controllerPath);
  const summary = {
    source: "src/lib/stores/controller.ts",
    sourceBeforeSha256: sha256(before),
    sourceAfterSha256: sha256(after),
    mutationResidue: before.equals(after) ? "ABSENT" : "PRESENT",
    execution: "Vitest pre-transform; production source never rewritten",
    records,
  };
  writeFileSync(join(outputDirectory, "results.json"), `${JSON.stringify(summary, null, 2)}\n`);
  if (!before.equals(after)) throw new Error("Production source changed during mutation proof");
  return summary;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runDiscoveryMutations();
}
