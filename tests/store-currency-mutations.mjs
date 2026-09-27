import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const productFile = "src/features/products/components/product-screen.tsx";
export const testPaths = [
  "tests/store-currency-architecture.test.ts",
  "src/lib/backend/store-currency.test.ts",
];
export const variants = {
  pristine: {},
  "comment-decoy": {
    statement:
      'const currency = state.context /* navigator.language role previousStore */ ?.store[/* locale */ "currency"];',
  },
  "string-decoy": {},
  "authoritative-read": { statement: "const currency = state.context?.store.currency;" },
  "authoritative-alias": {
    statement: "const selected = state.context?.store; const currency = selected?.currency;",
  },
  "product-lyd-fallback": {
    statement: 'const currency = state.context?.store.currency ?? "LYD";',
    reason: "currency-fallback",
  },
  "product-browser-language": {
    statement: 'const currency = navigator.language.startsWith("ar") ? "LYD" : "USD";',
    reason: "synthesized-currency",
  },
  "product-role-name": {
    statement: 'const currency = state.context?.role.name === "Owner" ? "LYD" : "EUR";',
    reason: "synthesized-currency",
  },
  "product-previous-store": {
    prefix: 'let previousStore: {currency?: "LYD" | "USD" | "EUR" | null} | undefined;\n',
    statement:
      "const currency = state.context?.store.currency ?? previousStore?.currency; previousStore = state.context?.store;",
    reason: "currency-fallback",
  },
  "product-independent-synthesis": {
    statement: 'const currency = "USD";',
    reason: "synthesized-currency",
  },
  "product-local-storage": {
    statement:
      'const currency = state.context?.store.currency; if (currency) localStorage.setItem("currency", currency);',
    reason: "browser-persistence",
  },
  "product-session-storage": {
    statement:
      'const currency = state.context?.store.currency; if (currency) sessionStorage.setItem("currency", currency);',
    reason: "browser-persistence",
  },
  "product-pricing-get": {
    statement:
      "const currency = state.context?.store.currency; void fetch(`/api/v1/stores/${state.scope!.storeUuid}/catalog/products/${productUuid}/pricing`);",
    reason: "central-api-boundary",
  },
  "product-pricing-patch": {
    statement:
      'const currency = state.context?.store.currency; void fetch(`/api/v1/stores/${state.scope!.storeUuid}/catalog/products/${productUuid}/pricing`, {method:"PATCH"});',
    reason: "central-api-boundary",
  },
  "pristine-after": {},
};

/** Structural ProductDetail injection: the new value is rendered, not an unused fixture.
 * Only the source reader's in-memory result changes. No production/test files are rewritten.
 */
export function mutateProduct(source, name) {
  const variant = variants[name];
  if (!variant) throw new Error(`Unknown currency variant ${name}`);
  if (name === "comment-decoy")
    source = `/* state.context?.store.currency ?? "LYD"; navigator.language; localStorage.setItem("currency", "USD"); */\n${source}`;
  if (name === "string-decoy")
    return `${source}\nvoid 'state.context?.store.currency ?? "LYD"; navigator.language; localStorage.setItem("currency", "USD")';\n`;
  if (!variant.statement) return source;
  const tree = ts.createSourceFile(
    productFile,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const components = tree.statements.filter(
    (node) => ts.isFunctionDeclaration(node) && node.name?.text === "ProductDetail",
  );
  if (components.length !== 1 || !components[0].body)
    throw new Error("Expected one ProductDetail body");
  const returns = components[0].body.statements.filter(ts.isReturnStatement);
  if (returns.length !== 1 || !returns[0].expression)
    throw new Error("Expected one ProductDetail render");
  const expression = returns[0].expression;
  const jsx = ts.isParenthesizedExpression(expression) ? expression.expression : expression;
  if (!ts.isJsxFragment(jsx)) throw new Error("Expected ProductDetail fragment");
  // Apply later offset first. The declaration is consumed by the actual JSX render.
  const output =
    source.slice(0, jsx.openingFragment.end) +
    "\n<span>{currency}</span>\n" +
    source.slice(jsx.openingFragment.end);
  const result =
    output.slice(0, returns[0].getStart(tree)) +
    variant.statement +
    "\n" +
    output.slice(returns[0].getStart(tree));
  const parsed = ts.createSourceFile(
    productFile,
    result,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  if (parsed.parseDiagnostics.length) throw new Error("Mutation must remain valid TSX");
  return (variant.prefix ?? "") + result;
}

const hash = (data) => createHash("sha256").update(data).digest("hex");
function snapshot() {
  const git = spawnSync(
    "git",
    [
      "ls-files",
      "src",
      "public",
      "scripts",
      "tests",
      "next.config.ts",
      "package.json",
      "pnpm-lock.yaml",
    ],
    { cwd: root, encoding: "utf8", windowsHide: true },
  );
  if (git.status !== 0) throw new Error("Cannot snapshot tracked protected files");
  const paths = [
    ...new Set([
      ...git.stdout.trim().split(/\r?\n/),
      "tests/currency-authority-policy.ts",
      "tests/production-sources.ts",
      "tests/store-currency-mutations.mjs",
      "tests/store-currency-mutations.config.mjs",
    ]),
  ];
  return Object.fromEntries(paths.map((path) => [path, hash(readFileSync(join(root, path)))]));
}

export function runCurrencyMutations() {
  const directory = join(root, "artifacts/f3g-l1/currency-mutations");
  mkdirSync(directory, { recursive: true });
  const before = snapshot();
  const records = [];
  let count;
  try {
    for (const [name, variant] of Object.entries(variants)) {
      const reportPath = join(directory, `${name}.json`);
      const run = spawnSync(
        process.execPath,
        [
          join(root, "node_modules/vitest/vitest.mjs"),
          "run",
          "--config",
          "tests/store-currency-mutations.config.mjs",
        ],
        {
          cwd: root,
          env: {
            ...process.env,
            QAFILAH_CURRENCY_MUTANT: name,
            QAFILAH_CURRENCY_REPORT: reportPath,
            NO_COLOR: "1",
          },
          encoding: "utf8",
          timeout: 90_000,
          maxBuffer: 8 * 1024 * 1024,
          windowsHide: true,
        },
      );
      writeFileSync(join(directory, `${name}.log`), `${run.stdout}\n${run.stderr}`);
      if (run.error || run.signal)
        throw new Error(`Currency mutation infrastructure failure: ${name}`);
      const report = JSON.parse(readFileSync(reportPath, "utf8"));
      const assertions = report.testResults.flatMap((suite) => suite.assertionResults);
      const failures = assertions.filter((assertion) => assertion.status === "failed");
      const executed = report.numPassedTests + report.numFailedTests;
      if (name === "pristine") count = executed;
      const complete =
        executed > 0 &&
        executed === count &&
        assertions.length === count &&
        assertions.every((assertion) => ["passed", "failed"].includes(assertion.status)) &&
        !report.numPendingTests &&
        !report.numTodoTests;
      const expectedAssertion = ["browser-persistence", "central-api-boundary"].includes(
        variant.reason,
      )
        ? "keeps production persistence and Pricing activation blocked"
        : "keeps repository-wide production currency authority";
      const intended = failures.some(
        (assertion) =>
          assertion.fullName.includes(expectedAssertion) &&
          assertion.failureMessages.some((message) => message.includes(variant.reason)),
      );
      const assertionOnly =
        report.testResults.every((suite) => !suite.message) &&
        failures.every(
          (assertion) =>
            assertion.failureMessages.length &&
            assertion.failureMessages.every((message) => message.startsWith("AssertionError:")),
        );
      const actual =
        complete && run.status === 0 && report.success
          ? "GREEN"
          : complete && run.status === 1 && failures.length && assertionOnly && intended
            ? "RED"
            : "HARNESS ERROR";
      const expected = variant.reason ? "RED" : "GREEN";
      records.push({
        name,
        expected,
        actual,
        executed,
        intended,
        failures,
        transformedSha256: hash(mutateProduct(readFileSync(join(root, productFile), "utf8"), name)),
      });
      process.stdout.write(`${name}: ${actual} (${failures.length}/${executed} failed)\n`);
      if (actual !== expected)
        throw new Error(`Currency variant ${name}: expected ${expected}, got ${actual}`);
    }
  } finally {
    const after = snapshot();
    const unchanged = JSON.stringify(before) === JSON.stringify(after);
    writeFileSync(
      join(directory, "results.json"),
      JSON.stringify(
        {
          execution: "Permanent production scan with in-memory ProductDetail source injection",
          before,
          after,
          residue: unchanged ? "NONE" : "PRESENT",
          records,
        },
        null,
        2,
      ) + "\n",
    );
    if (!unchanged) throw new Error("Currency mutation residue detected");
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  runCurrencyMutations();
