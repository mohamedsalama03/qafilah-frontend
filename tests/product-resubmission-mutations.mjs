import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const baseline = "b669c968ca8535475c4f0a9f06cbdc12515b2729";
export const resubmissionSources = [
  "src/features/products/mutations.ts",
  "src/features/products/components/product-actions.tsx",
  "src/features/products/components/product-form-screen.tsx",
];
const testPaths = [
  "src/features/products/components/product-resubmission.test.tsx",
  "src/features/products/product-resubmission.test.ts",
];
const protectedPaths = [
  ...resubmissionSources,
  "src/features/products/components/mutation-feedback.tsx",
  ...testPaths,
];
const outputDirectory = process.env.QAFILAH_MUTATION_ARTIFACT_ROOT
  ? resolve(root, process.env.QAFILAH_MUTATION_ARTIFACT_ROOT, "resubmission-mutations")
  : join(root, "artifacts/f3b-remediation/resubmission-mutations");
const boundary = "(?:publish|unpublish|create|save) (?:click|Enter) at 120 ms";
const terminal = "terminal .* controller refuses";
const retained = "retained .* hook handlers";
const latestRead = "reopening edit|starts a new edit|remounted confirmed edit";
const completePattern = `${boundary}|${terminal}|${retained}|${latestRead}`;

export const resubmissionVariants = {
  "rejected-baseline": { expected: "RED", pattern: boundary, count: 8, failed: 8 },
  pristine: { expected: "GREEN", pattern: completePattern, count: 21 },
  "comment-decoy": { expected: "GREEN", pattern: completePattern, count: 21 },
  "string-decoy": { expected: "GREEN", pattern: completePattern, count: 21 },
  "controller-success-guard": { expected: "RED", pattern: terminal, count: 5, failed: 5 },
  "lifecycle-completed-slot": {
    expected: "RED",
    pattern: "(?:publish|unpublish) (?:click|Enter) at 120 ms",
    count: 4,
    failed: 4,
  },
  "create-completed-slot": {
    expected: "RED",
    pattern: "create (?:click|Enter) at 120 ms",
    count: 2,
    failed: 2,
  },
  "save-completed-slot": {
    expected: "RED",
    pattern: "save (?:click|Enter) at 120 ms",
    count: 2,
    failed: 2,
  },
  "retained-handler-slot": { expected: "RED", pattern: retained, count: 4, failed: 4 },
  "retained-reviewed-product": { expected: "RED", pattern: "reopening edit", count: 2, failed: 2 },
  "review-query-notification": {
    expected: "RED",
    pattern: "starts a new edit",
    count: 1,
    failed: 1,
  },
  "review-mislabeled-write": {
    expected: "RED",
    pattern: "remounted confirmed edit",
    count: 1,
    failed: 1,
  },
  "pristine-after": {
    expected: "GREEN",
    pattern: completePattern,
    count: 21,
  },
};

function replaceOnce(source, before, after) {
  if (source.split(before).length !== 2)
    throw new Error(`Expected one operative target: ${before}`);
  return source.replace(before, after);
}
function withoutTerminalGuard(source) {
  return replaceOnce(
    source,
    'if (reconciliation || state.status === "unknown" || state.status === "success")',
    'if (reconciliation || state.status === "unknown")',
  );
}
function withoutSuccessBlocking(source) {
  return replaceOnce(source, '      state.status === "success" ||\n', "");
}
function baselineSource(path) {
  const result = spawnSync("git", ["show", `${baseline}:${path}`], {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.status !== 0 || result.error) throw new Error(`Cannot read frozen baseline ${path}`);
  return result.stdout;
}
export function transformResubmissionSource(source, path, name) {
  if (!resubmissionVariants[name]) throw new Error(`Unknown resubmission variant: ${name}`);
  source = source.replaceAll("\r\n", "\n");
  if (name === "rejected-baseline") return baselineSource(path);
  if (name === "comment-decoy")
    return `/* success is terminal; slot guard removed (comment only). */\n${source}`;
  if (name === "string-decoy")
    return `${source}\nvoid "Release success and show the opposite action without review (string only)";\n`;
  if (name === "controller-success-guard" && path === resubmissionSources[0])
    return withoutTerminalGuard(source);
  if (name === "retained-handler-slot" && path === resubmissionSources[0])
    return replaceOnce(
      source,
      "controller.execute(command, state.slot)",
      "controller.execute(command)",
    );
  if (path === resubmissionSources[2]) {
    if (name === "retained-reviewed-product")
      return replaceOnce(
        source,
        "product={query.data}",
        "product={mutation.state.product ?? query.data}",
      );
    if (name === "review-mislabeled-write")
      return replaceOnce(
        source,
        'mutation.isPending && mutation.state.status !== "reviewing"',
        "mutation.isPending",
      );
    if (name === "review-query-notification") {
      source = replaceOnce(source, "  const mutation = useProductMutation(productUuid);\n", "");
      source = replaceOnce(
        source,
        "return <ProductFormFields key={mutation.state.slot} mutation={mutation} product={query.data} />;",
        "return <DetachedEditSlot product={query.data} />;",
      );
      return `${source}\nfunction DetachedEditSlot({ product }: { product: MerchantProduct }) {
        const mutation = useProductMutation(product.id);
        return <ProductFormFields key={mutation.state.slot} mutation={mutation} product={product} />;
      }\n`;
    }
  }
  // These three operative UI mutants remove the selected completed-slot boundary
  // together with its redundant shared gates. Removing only the visible branch
  // would remain safe because the shared controller still rejects its write.
  if (["lifecycle-completed-slot", "create-completed-slot", "save-completed-slot"].includes(name)) {
    if (path === resubmissionSources[0])
      return withoutSuccessBlocking(withoutTerminalGuard(source));
    if (name === "lifecycle-completed-slot" && path === resubmissionSources[1])
      return replaceOnce(
        source,
        'const confirmed = mutation.state.status === "success" || mutation.state.status === "reviewing";',
        "const confirmed = false;",
      );
    if (path === resubmissionSources[2] && name !== "lifecycle-completed-slot")
      return replaceOnce(
        source,
        'if (mutation.state.status === "success" || mutation.state.status === "reviewing")',
        `if (${name === "create-completed-slot" ? "!create" : "create"} && (mutation.state.status === "success" || mutation.state.status === "reviewing"))`,
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
export function runResubmissionMutations() {
  mkdirSync(outputDirectory, { recursive: true });
  const before = snapshot();
  const records = [];
  try {
    for (const [name, variant] of Object.entries(resubmissionVariants)) {
      const transformedHashes = Object.fromEntries(
        resubmissionSources.map((path) => [
          path,
          sha256(transformResubmissionSource(readFileSync(join(root, path), "utf8"), path, name)),
        ]),
      );
      const reportFile = join(outputDirectory, `${name}.json`);
      const result = spawnSync(
        process.execPath,
        [
          join(root, "node_modules/vitest/vitest.mjs"),
          "run",
          "--config",
          "tests/product-resubmission-mutations.config.mjs",
        ],
        {
          cwd: root,
          env: {
            ...process.env,
            QAFILAH_RESUBMISSION_MUTANT: name,
            QAFILAH_RESUBMISSION_REPORT: reportFile,
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
            failure.messages.every(
              (message) =>
                message.startsWith("AssertionError:") ||
                /^Error: expect\(element\)\.toHaveValue\(/.test(message),
            ),
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
        throw new Error(`Variant ${name}: expected ${variant.expected}, got ${actual}`);
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
            "Vitest pre-transform only; git show reads the frozen baseline; no production source is written",
          operativeChanges: {
            "controller-success-guard":
              "Remove shared terminal-success rejection; direct repeated execution must send twice",
            "lifecycle-completed-slot":
              "Remove completed lifecycle branch plus redundant shared success rejection/blocking; response-boundary input reverses the confirmed action",
            "create-completed-slot":
              "Remove confirmed create form branch plus redundant shared success rejection/blocking; delayed navigation permits duplicate POST",
            "save-completed-slot":
              "Remove confirmed edit form branch plus redundant shared success rejection/blocking; delayed navigation permits duplicate PATCH",
            "retained-handler-slot":
              "Stop capturing the render slot in execute; an old handler can submit into the new slot",
            "retained-reviewed-product":
              "Prefer retained controller Product data over a later authoritative edit GET; reopening shows obsolete fields",
            "review-query-notification":
              "Renew the edit slot in a child detached from its query subscription; an immediate fresh edit initializes before the query notification",
            "review-mislabeled-write":
              "Treat a confirmed Product review GET as a pending mutation; leaving a remounted completed edit shows a false sending warning",
          },
          sourceBeforeSha256: before,
          sourceAfterSha256: after,
          mutationResidue: unchanged ? "ABSENT" : "PRESENT",
          records,
        },
        null,
        2,
      )}\n`,
    );
    if (!unchanged) throw new Error("Protected source changed during resubmission mutation proof");
  }
  return records;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  runResubmissionMutations();
