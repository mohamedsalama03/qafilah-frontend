// @vitest-environment node
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { inspectArchitecture } from "./architecture-policy";
import { inspectCurrencyAuthority } from "./currency-authority-policy";
import { productionAnalysis } from "./production-sources";

function optionalCurrency(node: ts.Node): boolean {
  function unwrap(value: ts.Node, method: string): ts.Expression | undefined {
    return ts.isCallExpression(value) &&
      value.arguments.length === 0 &&
      ts.isPropertyAccessExpression(value.expression) &&
      value.expression.name.text === method
      ? value.expression.expression
      : undefined;
  }
  const nullable = unwrap(node, "optional");
  const enumeration = nullable && unwrap(nullable, "nullable");
  if (
    !enumeration ||
    !ts.isCallExpression(enumeration) ||
    enumeration.arguments.length !== 1 ||
    !ts.isPropertyAccessExpression(enumeration.expression) ||
    enumeration.expression.name.text !== "enum" ||
    !ts.isIdentifier(enumeration.expression.expression) ||
    enumeration.expression.expression.text !== "z"
  )
    return false;
  const values = enumeration.arguments[0];
  return (
    !!values &&
    ts.isArrayLiteralExpression(values) &&
    values.elements.length === 3 &&
    values.elements.every(
      (value, index) => ts.isStringLiteral(value) && value.text === ["LYD", "USD", "EUR"][index],
    )
  );
}

const product = "src/features/products/components/product-screen.tsx";
const inspect = (source: string) => inspectCurrencyAuthority(product, source);

const finalGaps = [
  [
    "R3 ordinary identifier substitution",
    `function reuse(context, other) { const currency = context.store.currency; return currency === undefined && other ? {...context, store: {...context.store, currency: other.store.currency}} : context; }`,
    "currency-source-substitution",
  ],
  [
    "R4 module snapshot",
    `let box; function detail(state) { const shown = box?.currency; box = state.context?.store; return shown; }`,
    "retained-currency-snapshot",
  ],
  [
    "R4 local snapshot read before update",
    `function detail(state) { let box; const shown = box?.currency; box = state.context?.store; return shown; }`,
    "retained-currency-snapshot",
  ],
  ["R7 JSX literal", 'const view = <Money currency="LYD" />;', "literal-currency-jsx"],
  [
    "R8 formatter literal",
    'function minorUnitsToDecimal(amount, currency) { return String(amount) + currency; } minorUnitsToDecimal(1000, "LYD");',
    "literal-currency-argument",
  ],
  [
    "R9 ternary array fallback",
    'const currency = context.store.currency; const shown = currency != null ? currency : (["LYD","USD","EUR"] as const)[0];',
    "currency-fallback",
  ],
] as const;

describe("Store currency compatibility architecture", () => {
  it.each(finalGaps)("closes permanent static gap %s", (_name, source, reason) => {
    expect(
      inspect(source).map((violation) => violation.reason),
      source,
    ).toContain(reason);
  });
  it.each(["previous", "record", "a"])(
    "tracks source substitution and retained snapshots with identifier %s",
    (name) => {
      const substitution = `function display(context, ${name}) { const {currency: code} = context.store; return code === undefined && ${name} ? {...context, store:{...context.store, currency:${name}.store.currency}} : context; }`;
      expect(inspect(substitution).map(({ reason }) => reason)).toContain(
        "currency-source-substitution",
      );
      const retained = `let ${name}; function detail(state) { const copy = ${name}; const shown = copy?.currency; ${name} = state.context?.store; return shown; }`;
      expect(inspect(retained).map(({ reason }) => reason)).toContain("retained-currency-snapshot");
    },
  );
  it("preserves the original previous-Store fallback coverage", () => {
    const source =
      "const old = previousStore; const currency = state.context?.store.currency ?? old.currency;";
    expect(inspect(source).map(({ reason }) => reason)).toContain("currency-fallback");
  });
  it("keeps repository-wide production currency authority", () => {
    const { sources, currency: violations } = productionAnalysis();
    expect(sources.some(({ file }) => file === product)).toBe(true);
    expect(sources.some(({ file }) => file.startsWith("src/features/variants/"))).toBe(true);
    expect(sources.every(({ file }) => !/\.(test|spec)\./.test(file))).toBe(true);
    expect(violations, JSON.stringify(violations)).toEqual([]);
  });

  it("keeps production persistence and Pricing activation blocked", () => {
    const violations = productionAnalysis().architecture.filter(({ rule }) =>
      ["browser-persistence", "central-api-boundary", "verified-contract-registry"].includes(rule),
    );
    expect(violations, JSON.stringify(violations)).toEqual([]);
  });

  it("reuses one parsed production inventory and one analysis per rule", () => {
    const first = productionAnalysis();
    const second = productionAnalysis();
    expect(first).toBe(second);
    expect(first.currency).toBe(second.currency);
    expect(first.architecture).toBe(second.architecture);
    expect(first.parsedFiles).toBe(first.sources.length);
    expect(first.timing.currencyScans).toBe(1);
    expect(first.timing.architectureScans).toBe(1);
  });

  it.each([
    ["R3 source substitution", "currency-source-substitution"],
    ["R4 retained snapshot", "retained-currency-snapshot"],
    ["R7 JSX currency", "literal-currency-jsx"],
    ["R8 formatter currency", "literal-currency-argument"],
    ["R9 equivalent fallback", "currency-fallback"],
  ])("keeps production free of %s", (_name, reason) => {
    const violations = productionAnalysis().currency.filter(
      (violation) => violation.reason === reason,
    );
    expect(violations, JSON.stringify(violations)).toEqual([]);
  });

  it("owns optional typed currency only in strict selected context, never discovery", () => {
    const registry = productionAnalysis().sources.find(
      ({ file }) => file === "src/lib/backend/contracts.ts",
    )!;
    const tree = productionAnalysis().trees.get(registry.file)!;
    const shapes = new Map<string, ts.ObjectLiteralExpression>();
    function visit(node: ts.Node) {
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        ["selectedContextStore", "accessibleStore"].includes(node.name.text)
      ) {
        const call = node.initializer;
        expect(
          call &&
            ts.isCallExpression(call) &&
            ts.isPropertyAccessExpression(call.expression) &&
            call.expression.getText(tree) === "z.strictObject",
        ).toBe(true);
        if (
          call &&
          ts.isCallExpression(call) &&
          call.arguments[0] &&
          ts.isObjectLiteralExpression(call.arguments[0])
        )
          shapes.set(node.name.text, call.arguments[0]);
      }
      ts.forEachChild(node, visit);
    }
    visit(tree);
    expect([...shapes.keys()].sort()).toEqual(["accessibleStore", "selectedContextStore"]);
    expect(
      shapes.get("accessibleStore")!.properties.map((node) => node.name?.getText(tree)),
    ).toEqual(["id", "name", "status"]);
    const selected = shapes.get("selectedContextStore")!.properties;
    expect(selected).toHaveLength(2);
    expect(ts.isSpreadAssignment(selected[0]!) && selected[0].expression.getText(tree)).toBe(
      "accessibleStore.shape",
    );
    const currency = selected[1]!;
    expect(
      ts.isPropertyAssignment(currency) &&
        currency.name.getText(tree) === "currency" &&
        optionalCurrency(currency.initializer),
    ).toBe(true);
  });

  it.each([
    [
      "nullish LYD fallback",
      'const currency = context.store.currency ?? "LYD";',
      "currency-fallback",
    ],
    [
      "USD fallback via alias",
      'const read = context.store.currency; const selected = read || "USD";',
      "currency-fallback",
    ],
    [
      "EUR assignment fallback",
      'let currency = context.store.currency; currency ??= "EUR";',
      "currency-fallback",
    ],
    [
      "browser language",
      'const currency = navigator.language.startsWith("ar") ? "LYD" : "USD";',
      "synthesized-currency",
    ],
    [
      "locale mapping",
      'const mapping = { ar: "LYD", en: "USD" }; const currency = mapping[locale];',
      "synthesized-currency",
    ],
    [
      "locale alias",
      "const selected = navigator.language; const currency = selected;",
      "synthesized-currency",
    ],
    [
      "locale map consumed by a call",
      'const mapping = { ar: "LYD", en: "USD" }; render(mapping[locale]);',
      "synthesized-currency",
    ],
    [
      "Role name",
      'const currency = context.role.name === "Owner" ? "LYD" : "EUR";',
      "synthesized-currency",
    ],
    [
      "previous Store alias",
      "const old = previousStore; const currency = old.currency;",
      "previous-store-currency",
    ],
    [
      "previous Store destructuring",
      "const { currency: code } = previousStore; render(code);",
      "previous-store-currency",
    ],
    [
      "previous Store fallback",
      "const currency = context.store.currency ?? previousStore.currency;",
      "currency-fallback",
    ],
    ["independent synthesis", 'const currency = "LYD";', "synthesized-currency"],
    [
      "independent helper",
      'function choose() { return "USD"; } const currency = choose();',
      "synthesized-currency",
    ],
    [
      "destructuring default",
      'const { currency = "EUR" } = context.store;',
      "synthesized-currency",
    ],
    [
      "renamed destructuring default",
      'const { currency: code = "EUR" } = context.store;',
      "synthesized-currency",
    ],
    [
      "computed currency property",
      'const key = "cur" + "rency"; const result = { [key]: "LYD" };',
      "synthesized-currency",
    ],
    [
      "computed authoritative fallback",
      'const key = "currency"; const result = context.store[key] ?? "LYD";',
      "currency-fallback",
    ],
    ["unknown producer", "const currency = inferFromSomewhere();", "synthesized-currency"],
    [
      "schema default",
      'const schema = z.strictObject({currency: z.enum(["LYD","USD","EUR"]).default("LYD")});',
      "synthesized-currency",
    ],
  ])("rejects operative %s in Product and future production features", (_label, source, reason) => {
    for (const file of [
      product,
      "src/features/future/arbitrary.ts",
      "src/lib/formatting/example.ts",
      "src/app/example.tsx",
    ]) {
      expect(inspectCurrencyAuthority(file, source).map((violation) => violation.reason)).toContain(
        reason,
      );
    }
  });

  it.each([
    "const currency = context.store.currency;",
    'const currency = context /* navigator.language role previousStore */ .store[/* locale */ "currency"];',
    'function verb() { return "GET"; } const note = "USD is a currency code";',
    "const currency = state.context?.store.currency;",
    "const store = context.store; const currency = store.currency;",
    "const previousStore = context.store; const previousCurrency = previousStore.currency; const currency = previousCurrency;",
    "const { currency: code } = context.store; render(code);",
    'const code = context.store["currency"]; render(code);',
    "const currency = context.store.currency ?? null;",
    "const currency = context.store.currency; const node = <Money currency={currency} />;",
    "function minorUnitsToDecimal(amount, currency) { return String(amount); } const code = context.store.currency; if (code) minorUnitsToDecimal(1000, code);",
    "const {currency: code} = context.store; const chosen = code != null ? code : null; const node = <Money currency={chosen} />;",
    'const allowed = ["LYD", "USD", "EUR"] as const; const currency = context.store.currency; const valid = allowed.includes(currency); const isLyd = currency === "LYD";',
    'function supported(currency): boolean { return ["LYD", "USD", "EUR"].includes(currency); } supported("LYD");',
    'const labels = ["LYD", "USD", "EUR"]; const prose = "LYD"; const node = <span title="LYD">LYD</span>; recordMessage("LYD");',
    "let box; function detail(context) { const box = context.store; return box.currency; } function refresh(state) { box = state.context.store; }",
    "function read(context) { return context.store.currency; } const currency = read(context);",
    "const currency = context.store.currency; function render(currency) { return currency; }",
    'const currency = context.store.currency; new Intl.NumberFormat(locale, {style:"currency", currency});',
    "const decimals = { LYD: 3, USD: 2, EUR: 2 }; const precision = decimals[currency];",
    'const schema = z.strictObject({ currency: z.enum(["LYD", "USD", "EUR"]).nullable().optional() });',
    '/* const currency = navigator.language ? "LYD" : "USD" */ const documentation = "context.store.currency ?? LYD"; void "currency";',
  ])("permits authoritative consumption, metadata and decoys: %s", (source) => {
    expect(inspect(source)).toEqual([]);
  });

  it.each(["localStorage", "sessionStorage"])(
    "blocks Product currency persistence in %s",
    (storage) => {
      expect(
        inspectArchitecture(product, `${storage}.setItem("currency", context.store.currency);`).map(
          ({ rule }) => rule,
        ),
      ).toContain("browser-persistence");
    },
  );

  it.each(["GET", "PATCH"])("blocks Product/Variant %s Pricing activation", (method) => {
    for (const suffix of ["/pricing", "/variants/${input.variantUuid}/pricing"]) {
      const source =
        'export const merchantContracts = { pricing: { method: "' +
        method +
        '", path: input => `/api/v1/stores/${input.storeUuid}/catalog/products/${input.productUuid}' +
        suffix +
        "` } };";
      expect(
        inspectArchitecture("src/lib/backend/contracts.ts", source).map(({ rule }) => rule),
      ).toContain("verified-contract-registry");
    }
    expect(
      inspectArchitecture(product, `fetch("/api/v1/pricing", {method:"${method}"});`).map(
        ({ rule }) => rule,
      ),
    ).toContain("central-api-boundary");
  });
});
