// @vitest-environment node
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { inspectArchitecture } from "./architecture-policy";

const registry = "src/lib/backend/contracts.ts";

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

// Currency is decoder-only compatibility data in the Store/session boundary.
// Inspect syntax nodes so comments and documentation strings do not become anchors.
function currencyBoundary(file: string, source: string): string[] {
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const violations: string[] = [];
  function visit(node: ts.Node) {
    if (ts.isPropertyAssignment(node) && node.name.getText(tree) === "currency") {
      const object = node.parent;
      const call = object.parent;
      const declaration = call.parent;
      if (
        file === registry &&
        ts.isObjectLiteralExpression(object) &&
        ts.isCallExpression(call) &&
        ts.isPropertyAccessExpression(call.expression) &&
        call.expression.name.text === "strictObject" &&
        ts.isIdentifier(call.expression.expression) &&
        call.expression.expression.text === "z" &&
        ts.isVariableDeclaration(declaration) &&
        declaration.name.getText(tree) === "selectedContextStore" &&
        optionalCurrency(node.initializer)
      )
        return;
    }
    if (
      (ts.isIdentifier(node) || ts.isStringLiteral(node)) &&
      node.text
        .replace(/([a-z])([A-Z])/g, "$1 $2")
        .split(/[^a-z]+/i)
        .some((word) => word.toLowerCase() === "currency")
    ) {
      // Standalone string expressions are documentation, not executable currency use.
      if (!(ts.isStringLiteral(node) && ts.isExpressionStatement(node.parent)))
        violations.push(node.text);
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  return violations;
}

function files(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = join(directory, entry.name).replaceAll("\\", "/");
    return entry.isDirectory()
      ? files(file)
      : /\.[cm]?[jt]sx?$/.test(file) && !file.includes(".test.")
        ? [file]
        : [];
  });
}

describe("Store currency compatibility architecture", () => {
  it("keeps currency solely in the selected-context strict decoder", () => {
    for (const file of [
      ...files("src/features/stores"),
      ...files("src/features/auth"),
      ...files("src/lib/stores"),
      ...files("src/lib/auth"),
      ...files("src/lib/backend"),
    ]) {
      expect(currencyBoundary(file, readFileSync(file, "utf8")), file).toEqual([]);
    }
  });

  it.each([
    'const accessibleStore = z.strictObject({ currency: z.enum(["LYD", "USD", "EUR"]).nullable().optional() });',
    'const selectedContextStore = z.strictObject({ currency: z.enum(["LYD", "USD", "EUR"]).nullable().optional().default("LYD") });',
    "const selectedContextStore = z.strictObject({ currency: z.string().optional() });",
    'const selectedContextStore = z.strictObject({ currency: z.enum(["LYD", "USD", "EUR"]).nullable() });',
    'const currency = context.store.currency ?? "LYD";',
    'const currency = locale === "ar" ? "LYD" : "USD";',
    'const currency = context.role.name === "Owner" ? "LYD" : "USD";',
    'localStorage.setItem("currency", context.store.currency);',
  ])("rejects operative currency boundary violation %s", (source) => {
    expect(currencyBoundary(registry, source).length).toBeGreaterThan(0);
  });

  it("ignores comments and standalone documentation decoys", () => {
    expect(currencyBoundary(registry, '/* currency default LYD */\n"currency example";')).toEqual(
      [],
    );
  });

  it.each(["GET", "PATCH"])("does not activate %s Product or Variant pricing", (method) => {
    for (const suffix of ["/pricing", "/variants/${input.variantUuid}/pricing"]) {
      const source =
        'export const merchantContracts = { pricing: { method: "' +
        method +
        '", path: input => `/api/v1/stores/${input.storeUuid}/catalog/products/${input.productUuid}' +
        suffix +
        "` } };";
      expect(inspectArchitecture(registry, source).map((violation) => violation.rule)).toContain(
        "verified-contract-registry",
      );
    }
  });

  it.each([
    'localStorage.setItem("currency", value);',
    'sessionStorage.setItem("currency", value);',
    'indexedDB.open("currency");',
  ])("retains the global persistence prohibition %s", (source) => {
    expect(
      inspectArchitecture("src/features/stores/example.ts", source).map(
        (violation) => violation.rule,
      ),
    ).toContain("browser-persistence");
  });
});
