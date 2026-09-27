import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";
import {
  controllerCases,
  controllerFile,
  mutateController,
} from "./currency-provenance-fixtures.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const productFile = "src/features/products/components/product-screen.tsx";
export const testPaths = [
  "tests/store-currency-architecture.test.ts",
  "src/lib/backend/store-currency.test.ts",
];
const moneyComponent =
  'function Money({currency}: {currency?: "LYD" | "USD" | "EUR" | null}) { return <span>{currency}</span>; }\n';
const formatterImport =
  'import { minorUnitsToDecimal as renderAmount } from "@/features/products/model";\n';
export const variants = {
  pristine: {},
  "comment-decoy": {
    statement:
      'const currency = state.context /* navigator.language role previousStore */ ?.store[/* locale */ "currency"];',
  },
  "string-decoy": {},
  "authoritative-read": { statement: "const currency = state.context?.store.currency;" },
  "authoritative-alias": {
    statement:
      "const previousStore = state.context?.store; const currency = previousStore?.currency;",
  },
  "authoritative-computed-destructured": {
    statement:
      'const {currency: code} = state.context?.["store"] ?? {}; const currency = code ?? null;',
  },
  "authoritative-jsx": {
    prefix: moneyComponent,
    statement: "const currency = state.context?.store.currency;",
    jsx: "<Money currency={currency} />",
  },
  "authoritative-formatter": {
    prefix: formatterImport,
    statement:
      'const currency = state.context?.store.currency; const shown = currency == null ? "Not configured" : renderAmount(1000, currency);',
    jsx: "<span>{shown}</span>",
  },
  "validation-decoy": {
    statement:
      'const currency = state.context?.store.currency; const allowed = ["LYD", "USD", "EUR"] as const; const valid = currency != null && allowed.includes(currency);',
    jsx: "<span data-valid={valid}>{currency}</span>",
  },
  ...Object.fromEntries(
    Object.entries(controllerCases).map(([name, variant]) => [
      name,
      {
        ...variant,
        killedBy: "keeps repository-wide production currency authority",
      },
    ]),
  ),
  "unrelated-unresolved": {
    statement: "const shown = unknownProducer().whatever;",
    jsx: "<span>{shown}</span>",
  },
  "product-unresolved-currency": {
    statement: "const currency = unknownProducer().currency;",
    reason: "unresolved-currency-provenance",
    killedBy: "keeps production free of unresolved currency provenance",
  },
  "product-unresolved-jsx": {
    prefix: moneyComponent,
    statement: "const code = unknownProducer();",
    jsx: "<Money currency={code} />",
    reason: "unresolved-currency-provenance",
    killedBy: "keeps production free of unresolved currency provenance",
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
  "r3-ordinary-identifier-reuse": {
    prefix: 'let other: {store: {currency?: "LYD" | "USD" | "EUR" | null}} | undefined;\n',
    statement:
      "const context = state.context; const currency = context?.store.currency; const projection = currency === undefined && other && context ? {...context, store:{...context.store, currency:other.store.currency}} : context; other = context ?? undefined;",
    jsx: "<span>{projection?.store.currency}</span>",
    reason: "currency-source-substitution",
    killedBy: "keeps production free of R3 source substitution",
  },
  "r4-retained-snapshot": {
    prefix: 'let box: {currency?: "LYD" | "USD" | "EUR" | null} | undefined;\n',
    statement: "const shown = box?.currency; box = state.context?.store;",
    jsx: "<span>{shown}</span>",
    reason: "retained-currency-snapshot",
    killedBy: "keeps production free of R4 retained snapshot",
  },
  "r4-react-ref": {
    prefix: 'import {useRef as hold} from "react";\n',
    statement: "const box = hold(state.context?.store); const shown = box.current?.currency;",
    jsx: "<span>{shown}</span>",
    reason: "retained-currency-snapshot",
    killedBy: "keeps production free of R4 retained snapshot",
  },
  "r4-react-state": {
    prefix: 'import {useState as hold} from "react";\n',
    statement: "const [box] = hold(state.context?.store); const shown = box?.currency;",
    jsx: "<span>{shown}</span>",
    reason: "retained-currency-snapshot",
    killedBy: "keeps production free of R4 retained snapshot",
  },
  "r7-jsx-literal": {
    prefix: moneyComponent,
    statement: "const currency = state.context?.store.currency;",
    jsx: '<Money currency="LYD" />',
    reason: "literal-currency-jsx",
    killedBy: "keeps production free of R7 JSX currency",
  },
  "r8-formatter-literal": {
    prefix: formatterImport,
    statement: 'const shown = renderAmount(1000, "LYD");',
    jsx: "<span>{shown}</span>",
    reason: "literal-currency-argument",
    killedBy: "keeps production free of R8 formatter currency",
  },
  "r8-imported-arrow-literal": {
    prefix: 'import {formatAmount as showAmount} from "@/lib/formatting/money";\n',
    statement: 'const shown = showAmount(1000, "LYD");',
    jsx: "<span>{shown}</span>",
    reason: "literal-currency-argument",
    killedBy: "keeps production free of R8 formatter currency",
  },
  "authoritative-imported-arrow": {
    prefix: 'import {formatAmount as showAmount} from "@/lib/formatting/money";\n',
    statement:
      "const currency = state.context?.store.currency; const shown = currency == null ? null : showAmount(1000, currency);",
    jsx: "<span>{shown}</span>",
  },
  "r9-ternary-array-fallback": {
    statement:
      'const currency = state.context?.store.currency; const shown = currency != null ? currency : (["LYD", "USD", "EUR"] as const).at(0);',
    jsx: "<span>{shown}</span>",
    reason: "currency-fallback",
    killedBy: "keeps production free of R9 equivalent fallback",
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

export function mutateSources(entries, name) {
  return entries.map((entry) => ({
    ...entry,
    source:
      entry.file === controllerFile && name in controllerCases
        ? mutateController(entry.source, name)
        : entry.file === "src/lib/formatting/money.ts" &&
            ["r8-imported-arrow-literal", "authoritative-imported-arrow"].includes(name)
          ? entry.source +
            '\nexport const formatAmount = (amount: number, currency: string) => formatMoney(String(amount), {currency, locale: "en"});\n'
          : entry.file === productFile
            ? mutateProduct(entry.source, name)
            : entry.source,
  }));
}

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
    `\n${variant.jsx ?? "<span>{currency}</span>"}\n` +
    source.slice(jsx.openingFragment.end);
  const result =
    output.slice(0, returns[0].getStart(tree)) +
    variant.statement +
    "\n" +
    output.slice(returns[0].getStart(tree));
  // Preserve the client directive when adding imports or retained-state declarations.
  const directive = tree.statements[0];
  const at =
    directive && ts.isExpressionStatement(directive) && ts.isStringLiteral(directive.expression)
      ? directive.end
      : 0;
  const complete = result.slice(0, at) + "\n" + (variant.prefix ?? "") + result.slice(at);
  const parsed = ts.createSourceFile(
    productFile,
    complete,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  if (parsed.parseDiagnostics.length) throw new Error("Mutation must remain valid TSX");
  return complete;
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
      "tests/currency-provenance-fixtures.ts",
      "tests/production-sources.ts",
      "tests/store-currency-mutations.mjs",
      "tests/store-currency-mutations.config.mjs",
    ]),
  ];
  return Object.fromEntries(paths.map((path) => [path, hash(readFileSync(join(root, path)))]));
}

export function runCurrencyMutations() {
  const directory = join(
    root,
    process.env.QAFILAH_MUTATION_ARTIFACT_ROOT ?? "artifacts/f3g-l1-final",
    "currency-mutations",
  );
  mkdirSync(directory, { recursive: true });
  const before = snapshot();
  const records = [];
  let count;
  try {
    for (const [name, variant] of Object.entries(variants)) {
      const reportPath = join(directory, `${name}.json`);
      // An infrastructure failure must never reuse a RED report from an earlier run.
      rmSync(reportPath, { force: true });
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
        !report.numTodoTests &&
        !report.numRuntimeErrorTestSuites;
      const expectedAssertion =
        variant.killedBy ??
        (["browser-persistence", "central-api-boundary"].includes(variant.reason)
          ? "keeps production persistence and Pricing activation blocked"
          : "keeps repository-wide production currency authority");
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
        scanTimings: assertions
          .filter((assertion) =>
            /keeps repository-wide|keeps production persistence/.test(assertion.fullName),
          )
          .map((assertion) => ({ name: assertion.fullName, durationMs: assertion.duration })),
        transformedSha256: Object.fromEntries(
          mutateSources(
            [productFile, controllerFile, "src/lib/formatting/money.ts"].map((file) => ({
              file,
              source: readFileSync(join(root, file), "utf8"),
            })),
            name,
          ).map(({ file, source }) => [file, hash(source)]),
        ),
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
          execution:
            "Permanent production scan with in-memory real controller, ProductDetail and imported helper injection",
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
