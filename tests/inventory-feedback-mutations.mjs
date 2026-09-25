import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const baseline = "1604c28f1f04d8d1f0c26bd14ba16cb0a1468132";
export const inventoryFeedbackSources = [
  "src/features/inventory/components/product-inventory-panel.tsx",
  "src/features/products/components/product-screen.tsx",
];
export const inventoryFeedbackTestPaths = [
  "src/features/inventory/components/product-inventory-panel.test.tsx",
  "src/features/inventory/components/product-inventory-feedback.test.tsx",
];
const protectedPaths = [
  ...inventoryFeedbackSources,
  ...inventoryFeedbackTestPaths,
  "src/features/inventory/contracts.ts",
  "src/features/inventory/model.ts",
  "src/features/inventory/queries.ts",
  "src/features/inventory/mutations.ts",
  "src/features/inventory/contracts.test.ts",
  "src/features/inventory/mutations.test.ts",
  "src/features/products/queries.ts",
  "src/lib/backend/contracts.ts",
  "src/lib/backend/client.ts",
];
const outputDirectory = process.env.QAFILAH_MUTATION_ARTIFACT_ROOT
  ? resolve(root, process.env.QAFILAH_MUTATION_ARTIFACT_ROOT, "inventory-feedback-mutations")
  : join(root, "artifacts/f3c-l1l2/inventory-feedback-mutations");

export const inventoryFeedbackVariants = {
  pristine: { expected: "GREEN" },
  "comment-decoy": { expected: "GREEN" },
  "string-decoy": { expected: "GREEN" },
  "pending-refresh-failure": {
    expected: "RED",
    killedBy:
      "keeps confirmed inventory success truthful while Product projection refresh is pending and after it succeeds",
    behavior: "Restore the production warning when a Product read is merely pending",
  },
  "quantity-focus-steal": {
    expected: "RED",
    killedBy: "keeps post-review quantity 422 focus on the input after all effects settle",
    behavior: "Restore generic feedback focus despite an actionable quantity error after review",
  },
  "pristine-after": { expected: "GREEN" },
};

function replaceOnce(source, target, replacement) {
  if (source.split(target).length !== 2)
    throw new Error(`Expected exactly one operative inventory feedback target: ${target}`);
  return source.replace(target, replacement);
}

function mutateInventoryPendingFailure(source, path) {
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  if (file.parseDiagnostics.length) throw new Error("Cannot parse Inventory feedback target");
  // Bind JSX to the actual import, including aliases; a shadowed local component is not a target.
  const options = { noLib: true, noResolve: true };
  const isTargetFile = (name) => resolve(name) === resolve(path);
  const host = {
    ...ts.createCompilerHost(options),
    getSourceFile: (name) => (isTargetFile(name) ? file : undefined),
    fileExists: isTargetFile,
    readFile: (name) => (isTargetFile(name) ? source : undefined),
  };
  const checker = ts.createProgram([path], options, host).getTypeChecker();
  const bindings = file.statements
    .filter(
      (node) =>
        ts.isImportDeclaration(node) &&
        ts.isStringLiteral(node.moduleSpecifier) &&
        node.moduleSpecifier.text === "@/features/inventory/components/product-inventory-panel" &&
        !node.importClause?.isTypeOnly &&
        node.importClause?.namedBindings &&
        ts.isNamedImports(node.importClause.namedBindings),
    )
    .flatMap((node) => node.importClause.namedBindings.elements)
    .filter(
      (node) =>
        !node.isTypeOnly && (node.propertyName ?? node.name).text === "ProductInventoryPanel",
    );
  if (bindings.length !== 1) throw new Error("Expected one ProductInventoryPanel value import");
  const binding = checker.getSymbolAtLocation(bindings[0].name);
  if (!binding) throw new Error("Cannot resolve ProductInventoryPanel import");
  const panels = [];
  function visit(node) {
    if (
      (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) &&
      ts.isIdentifier(node.tagName) &&
      checker.getSymbolAtLocation(node.tagName) === binding
    )
      panels.push(node);
    ts.forEachChild(node, visit);
  }
  visit(file);
  if (panels.length !== 1)
    throw new Error("Expected one imported ProductInventoryPanel invocation");
  const attributes = panels[0].attributes.properties;
  if (attributes.some(ts.isJsxSpreadAttribute))
    throw new Error("Inventory feedback target must have explicit props without spreads");
  function expression(name) {
    const matches = attributes.filter(
      (node) => ts.isJsxAttribute(node) && ts.isIdentifier(node.name) && node.name.text === name,
    );
    const initializer = matches[0]?.initializer;
    if (
      matches.length !== 1 ||
      !initializer ||
      !ts.isJsxExpression(initializer) ||
      !initializer.expression
    )
      throw new Error(`Expected one Inventory ${name} expression`);
    return initializer.expression;
  }
  const failed = expression("productReadFailed");
  const pending = expression("productReadPending");
  return (
    source.slice(0, failed.getStart(file)) +
    `(${failed.getText(file)}) || (${pending.getText(file)})` +
    source.slice(failed.end)
  );
}

/** Apply operative changes before Vite compiles a module; never rewrite source files. */
export function transformInventoryFeedbackSource(source, path, name) {
  if (!inventoryFeedbackVariants[name])
    throw new Error(`Unknown inventory feedback mutation variant: ${name}`);
  source = source.replaceAll("\r\n", "\n");
  if (name === "comment-decoy")
    return `/* pending Product fetch = failure; generic feedback overrides quantity focus (comment only) */\n${source}`;
  if (name === "string-decoy")
    return `${source}\nvoid "isFetching means refresh failure; ignore quantity focus priority (string only)";\n`;
  if (path === inventoryFeedbackSources[1] && name === "pending-refresh-failure")
    return mutateInventoryPendingFailure(source, path);
  if (path === inventoryFeedbackSources[0] && name === "quantity-focus-steal")
    return replaceOnce(source, "if (quantityError && canEdit) return;", "");
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

function isBehavioralAssertionFailure(message) {
  return (
    message.startsWith("AssertionError:") ||
    /^Error: expect\((?:element|received)\)\.(?:not\.)?(?:toHaveFocus|toBeInTheDocument|toBeVisible)\(/.test(
      message,
    )
  );
}

export function runInventoryFeedbackMutations() {
  mkdirSync(outputDirectory, { recursive: true });
  const before = snapshot();
  const records = [];
  let pristineTestCount;
  try {
    for (const [name, variant] of Object.entries(inventoryFeedbackVariants)) {
      const transformedHashes = Object.fromEntries(
        inventoryFeedbackSources.map((path) => [
          path,
          sha256(
            transformInventoryFeedbackSource(readFileSync(join(root, path), "utf8"), path, name),
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
          "tests/inventory-feedback-mutations.config.mjs",
        ],
        {
          cwd: root,
          env: {
            ...process.env,
            QAFILAH_INVENTORY_FEEDBACK_MUTANT: name,
            QAFILAH_INVENTORY_FEEDBACK_REPORT: reportFile,
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
          `Inventory feedback variant ${name} did not complete: ${result.error?.message ?? result.signal}`,
        );
      const report = JSON.parse(readFileSync(reportFile, "utf8"));
      const assertions = report.testResults.flatMap((suite) => suite.assertionResults);
      const failures = assertions
        .filter((test) => test.status === "failed")
        .map((test) => ({ name: test.fullName, messages: test.failureMessages }));
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
          (failure) =>
            failure.messages.length && failure.messages.every(isBehavioralAssertionFailure),
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
          `Inventory feedback variant ${name}: expected ${variant.expected}, received ${actual}`,
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
            "All permanent inventory feedback component tests, without skipped/todo assertions",
          sourceBeforeSha256: before,
          sourceAfterSha256: after,
          mutationResidue: unchanged ? "ABSENT" : "PRESENT",
          records,
        },
        null,
        2,
      )}\n`,
    );
    if (!unchanged) throw new Error("Protected source changed during inventory feedback proof");
  }
  return records;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  runInventoryFeedbackMutations();
