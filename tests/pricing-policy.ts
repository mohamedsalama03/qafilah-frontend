import ts from "typescript";

/** Executable syntax only: comments and quoted examples are not mutations. */
export function inspectPricingSafety(path: string, source: string): number[] {
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const violations: number[] = [];
  const inPricing = path.startsWith("src/features/pricing/");
  const mutation = path === "src/features/pricing/mutations.ts";
  const query = path === "src/features/pricing/queries.ts";
  const calls = new Map<string, ts.Node[]>();
  const report = (node: ts.Node) =>
    violations.push(file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1);
  const member = (node: ts.Expression): string | undefined =>
    ts.isPropertyAccessExpression(node)
      ? node.name.text
      : ts.isIdentifier(node)
        ? node.text
        : undefined;
  function visit(node: ts.Node) {
    if (ts.isCallExpression(node)) {
      const name = member(node.expression) ?? "";
      if (/^update(?:Product|Variant)Pricing$/.test(name)) {
        if (!mutation) report(node);
        calls.set(name, [...(calls.get(name) ?? []), node]);
      }
      if (/^load(?:Product|Variant)Pricing$/.test(name) && !mutation && !query) report(node);
      if (
        inPricing &&
        /^(?:setTimeout|setInterval|requestAnimationFrame|parseFloat|round|floor|ceil|toFixed)$/.test(
          name,
        )
      )
        report(node);
      if (
        inPricing &&
        name === "resource" &&
        node.arguments[1] &&
        ts.isStringLiteral(node.arguments[1]) &&
        node.arguments[1].text === "pricing"
      ) {
        const [scope, , identity] = node.arguments;
        if (
          !scope ||
          !ts.isIdentifier(scope) ||
          scope.text !== "scope" ||
          !identity ||
          !ts.isObjectLiteralExpression(identity)
        )
          report(node);
        else {
          const keys = identity.properties.map((p) =>
            p.name && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) ? p.name.text : "",
          );
          if (!keys.includes("productUuid") || !keys.includes("variantUuid")) report(node);
        }
      }
    }
    if (
      inPricing &&
      ts.isBinaryExpression(node) &&
      [
        ts.SyntaxKind.AsteriskToken,
        ts.SyntaxKind.SlashToken,
        ts.SyntaxKind.PercentToken,
        ts.SyntaxKind.AsteriskAsteriskToken,
      ].includes(node.operatorToken.kind)
    )
      report(node);
    if (
      inPricing &&
      ts.isPropertyAssignment(node) &&
      member(node.name as ts.Expression) === "retry" &&
      node.initializer.kind !== ts.SyntaxKind.FalseKeyword
    )
      report(node);
    if (
      inPricing &&
      ts.isPropertyAssignment(node) &&
      member(node.name as ts.Expression) === "queryKey" &&
      ts.isArrayLiteralExpression(node.initializer)
    )
      report(node);
    ts.forEachChild(node, visit);
  }
  visit(file);
  for (const dispatches of calls.values()) dispatches.slice(1).forEach(report);
  return violations;
}
