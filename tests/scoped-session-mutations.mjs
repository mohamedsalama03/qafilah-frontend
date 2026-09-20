import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = "src/lib/auth/controller.ts";
const protectedPaths = [
  sourcePath,
  "src/features/auth/components/session-boundary.tsx",
  "src/features/stores/components/store-provider.tsx",
  "src/features/products/queries.ts",
  "src/features/auth/components/scoped-read-revalidation.test.tsx",
];
const outputDirectory = process.env.QAFILAH_MUTATION_ARTIFACT_ROOT
  ? resolve(root, process.env.QAFILAH_MUTATION_ARTIFACT_ROOT, "scoped-session-mutations")
  : join(root, "artifacts/f3a-l1/mutations");
export const scopedSessionTestPattern = "settles persistent|also bounds";

function replaceOnce(source, before, after) {
  if (source.split(before).length !== 2)
    throw new Error(`Expected exactly one operative mutation target: ${before}`);
  return source.replace(before, after);
}

// Only Vitest's in-memory module source changes. The same permanent component tests
// challenge both real Product reads and the shared Store-context read boundary.
export const scopedSessionMutations = {
  pristine: (source) => source,
  "comment-decoy": (source) =>
    `/* scopedReadError: false; unlimited same-principal scoped read retry. */\n${source}`,
  "string-decoy": (source) =>
    `${source}\nvoid "Ignore scopedReadError and remount after every successful identity check";\n`,
  "unlimited-same-principal-scoped-retry": (source) =>
    replaceOnce(source, "!resumeScopedReads", "false"),
  "pristine-after": (source) => source,
};

export function transformScopedSessionSource(source, name) {
  const transform = scopedSessionMutations[name];
  if (!transform) throw new Error(`Unknown scoped-session mutation: ${name}`);
  return transform(source.replaceAll("\r\n", "\n"));
}

function sha256(source) {
  return createHash("sha256").update(source).digest("hex");
}

function snapshotSources() {
  return Object.fromEntries(
    protectedPaths.map((path) => [path, sha256(readFileSync(join(root, path)))]),
  );
}

export function runScopedSessionMutations() {
  mkdirSync(outputDirectory, { recursive: true });
  const before = snapshotSources();
  const source = readFileSync(join(root, sourcePath), "utf8");
  const records = [];
  try {
    for (const name of Object.keys(scopedSessionMutations)) {
      // A stale transformation is a harness error; compilation failure is never RED proof.
      const transformed = transformScopedSessionSource(source, name);
      const reportFile = join(outputDirectory, `${name}.json`);
      const result = spawnSync(
        process.execPath,
        [
          join(root, "node_modules/vitest/vitest.mjs"),
          "run",
          "--config",
          "tests/scoped-session-mutations.config.mjs",
        ],
        {
          cwd: root,
          env: {
            ...process.env,
            QAFILAH_SCOPED_SESSION_MUTANT: name,
            QAFILAH_SCOPED_SESSION_MUTATION_REPORT: reportFile,
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
          `Mutation ${name} did not complete: ${result.error?.message ?? result.signal}`,
        );
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
      const expected = name === "unlimited-same-principal-scoped-retry" ? "RED" : "GREEN";
      const executedTestCount = report.numPassedTests + report.numFailedTests;
      const actual =
        result.status === 0 && report.success === true && executedTestCount === 4
          ? "GREEN"
          : result.status === 1 &&
              failures.length === 4 &&
              report.numFailedTests === 4 &&
              executedTestCount === 4 &&
              assertionFailuresOnly
            ? "RED"
            : "HARNESS ERROR";
      const record = {
        name,
        expected,
        actual,
        executedTestCount,
        failedTestCount: report.numFailedTests,
        assertionFailuresOnly,
        sourceSha256: sha256(transformed),
        killedBy: failures,
      };
      records.push(record);
      process.stdout.write(`${name}: ${actual} (${record.failedTestCount} failed assertions)\n`);
      if (actual !== expected)
        throw new Error(`Mutation ${name}: expected ${expected}, received ${actual}`);
    }
  } finally {
    const after = snapshotSources();
    const unchanged = protectedPaths.every((path) => before[path] === after[path]);
    const summary = {
      source: sourcePath,
      execution: "Vitest pre-transform; production source never rewritten",
      operativeChange:
        "Remove successful same-principal bootstrap latch retention so each reconciliation remounts and repeats scoped reads",
      safetyStop:
        "Synthetic transport rejects the fourth scoped attempt with a network error; exact-count assertions kill the unlimited scheduling mutant",
      focusedTestPattern: scopedSessionTestPattern,
      sourceBeforeSha256: before,
      sourceAfterSha256: after,
      mutationResidue: unchanged ? "ABSENT" : "PRESENT",
      records,
    };
    writeFileSync(join(outputDirectory, "results.json"), `${JSON.stringify(summary, null, 2)}\n`);
    if (!unchanged) throw new Error("Protected source changed during mutation proof");
  }
  return records;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  runScopedSessionMutations();
