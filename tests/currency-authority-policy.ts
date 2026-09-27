import ts from "typescript";

export interface CurrencyViolation {
  rule: "currency-authority";
  reason: "synthesized-currency" | "currency-fallback" | "previous-store-currency";
  file: string;
  line: number;
}

const currencyName = (name: string) => /(?:^currency$|Currency$|_currency$)/.test(name);
const historical = (name: string) =>
  /(?:previous|prior|last|cached|remembered).*store|(?:previous|prior|last|cached|remembered).*currency/i.test(
    name,
  );
type Value = { currency: boolean; made: boolean; stale: boolean };
const empty: Value = { currency: false, made: false, stale: false };
const merge = (...values: Value[]): Value => ({
  currency: values.some((value) => value.currency),
  made: values.some((value) => value.made),
  stale: values.some((value) => value.stale),
});

/** Bounded expression provenance, not a token ban: validation and explicit reads are legal.
 * Local symbols are bound by TypeScript, so aliases and shadowing retain their meaning.
 * Currency-producing expressions are checked wherever they occur, regardless of feature.
 */
export function inspectCurrencyAuthority(filename: string, source: string): CurrencyViolation[] {
  const tree = ts.createSourceFile(
    filename,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const options = { noLib: true, noResolve: true };
  const host = {
    ...ts.createCompilerHost(options),
    getSourceFile: (name: string) => (name === filename ? tree : undefined),
    fileExists: (name: string) => name === filename,
    readFile: (name: string) => (name === filename ? source : undefined),
  };
  const checker = ts.createProgram([filename], options, host).getTypeChecker();
  const violations: CurrencyViolation[] = [];
  const unwrap = (node: ts.Expression): ts.Expression =>
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isNonNullExpression(node) ||
    ts.isSatisfiesExpression(node) ||
    ts.isTypeAssertionExpression(node)
      ? unwrap(node.expression)
      : node;
  const declaration = (node: ts.Identifier) => checker.getSymbolAtLocation(node)?.valueDeclaration;
  function key(node: ts.Node | undefined): string | undefined {
    if (!node) return;
    if (ts.isIdentifier(node) || ts.isStringLiteralLike(node)) return node.text;
    if (ts.isComputedPropertyName(node)) return literal(node.expression);
  }
  function literal(node: ts.Expression, seen = new Set<ts.Node>()): string | undefined {
    node = unwrap(node);
    if (seen.has(node)) return;
    seen.add(node);
    if (ts.isStringLiteralLike(node)) return node.text;
    if (ts.isIdentifier(node)) {
      const bound = declaration(node);
      if (bound && ts.isVariableDeclaration(bound) && bound.initializer)
        return literal(bound.initializer, seen);
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      const left = literal(node.left, seen),
        right = literal(node.right, seen);
      if (left !== undefined && right !== undefined) return left + right;
    }
  }
  function schema(node: ts.Expression): boolean {
    node = unwrap(node);
    if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return false;
    const { expression: receiver, name } = node.expression;
    if (["nullable", "optional"].includes(name.text) && !node.arguments.length)
      return schema(receiver);
    return name.text === "enum" && ts.isIdentifier(receiver) && receiver.text === "z";
  }
  // Inspect receiver symbols/property names, never raw source text: inline comments
  // and quoted documentation must not turn an authoritative read into inference.
  function receiverNames(node: ts.Expression, seen = new Set<ts.Node>()): string[] {
    node = unwrap(node);
    if (seen.has(node)) return [];
    const next = new Set(seen).add(node);
    if (ts.isIdentifier(node)) {
      const bound = declaration(node);
      return [
        node.text,
        ...(bound && ts.isVariableDeclaration(bound) && bound.initializer
          ? receiverNames(bound.initializer, next)
          : []),
      ];
    }
    if (ts.isPropertyAccessExpression(node))
      return [...receiverNames(node.expression, next), node.name.text];
    if (ts.isElementAccessExpression(node))
      return [...receiverNames(node.expression, next), literal(node.argumentExpression) ?? ""];
    if (ts.isCallExpression(node)) return receiverNames(node.expression, next);
    return [];
  }
  function value(node: ts.Expression, seen = new Set<ts.Node>()): Value {
    node = unwrap(node);
    if (seen.has(node)) return empty;
    const next = new Set(seen).add(node);
    if (schema(node)) return empty;
    if (ts.isStringLiteralLike(node))
      return /^(?:LYD|USD|EUR)$/.test(node.text) ? { ...empty, currency: true, made: true } : empty;
    if (ts.isIdentifier(node)) {
      const bound = declaration(node);
      let result = empty;
      if (bound && (ts.isVariableDeclaration(bound) || ts.isParameter(bound)) && bound.initializer)
        result = value(bound.initializer, next);
      else if (bound && ts.isBindingElement(bound)) {
        result = { ...empty, currency: currencyName(key(bound.propertyName ?? bound.name) ?? "") };
        const owner = bound.parent.parent;
        if ((ts.isVariableDeclaration(owner) || ts.isParameter(owner)) && owner.initializer)
          result = { ...result, stale: value(owner.initializer, next).stale };
        if (bound.initializer) result = merge(result, value(bound.initializer, next));
      } else if (currencyName(node.text)) result = { ...empty, currency: true };
      return { ...result, stale: result.stale || historical(node.text) };
    }
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      const name = ts.isPropertyAccessExpression(node)
        ? node.name.text
        : literal(node.argumentExpression);
      const receiver = value(node.expression, next);
      // A lookup in a locally manufactured code map is inference, not a backend read.
      const bound = ts.isIdentifier(node.expression) ? declaration(node.expression) : undefined;
      const object =
        bound && ts.isVariableDeclaration(bound) && bound.initializer
          ? unwrap(bound.initializer)
          : unwrap(node.expression);
      if (ts.isObjectLiteralExpression(object)) {
        const properties = object.properties.filter(ts.isPropertyAssignment);
        const selected = properties.filter((property) => !name || key(property.name) === name);
        const result = merge(...selected.map((property) => value(property.initializer, next)));
        if (result.currency) return result;
      }
      if (currencyName(name ?? "")) {
        const names = receiverNames(node.expression);
        return {
          currency: true,
          made: names.some((name) =>
            /^(?:navigator|locale|language|role|resolvedOptions)$/i.test(name),
          ),
          stale: receiver.stale || names.some(historical),
        };
      }
      // Do not propagate currency through arbitrary properties (e.g. fraction digits).
      return { ...empty, stale: receiver.stale || historical(name ?? "") };
    }
    if (ts.isConditionalExpression(node))
      return merge(value(node.whenTrue, next), value(node.whenFalse, next));
    if (
      ts.isBinaryExpression(node) &&
      [
        ts.SyntaxKind.QuestionQuestionToken,
        ts.SyntaxKind.BarBarToken,
        ts.SyntaxKind.AmpersandAmpersandToken,
        ts.SyntaxKind.EqualsToken,
      ].includes(node.operatorToken.kind)
    )
      return merge(value(node.left, next), value(node.right, next));
    if (ts.isCallExpression(node)) {
      const bound = ts.isIdentifier(node.expression) ? declaration(node.expression) : undefined;
      const fn = bound && ts.isVariableDeclaration(bound) ? bound.initializer : bound;
      if (
        fn &&
        (ts.isFunctionDeclaration(fn) || ts.isArrowFunction(fn) || ts.isFunctionExpression(fn)) &&
        fn.body
      ) {
        if (!ts.isBlock(fn.body)) return value(fn.body, next);
        const results: Value[] = [];
        function returns(part: ts.Node) {
          if (ts.isReturnStatement(part) && part.expression)
            results.push(value(part.expression, next));
          else if (!ts.isFunctionLike(part)) ts.forEachChild(part, returns);
        }
        returns(fn.body);
        return merge(...results);
      }
    }
    return empty;
  }
  const absent = (node: ts.Expression) =>
    node.kind === ts.SyntaxKind.NullKeyword ||
    (ts.isIdentifier(node) && node.text === "undefined") ||
    ts.isVoidExpression(node);
  function report(node: ts.Node, reason: CurrencyViolation["reason"]) {
    violations.push({
      rule: "currency-authority",
      reason,
      file: filename,
      line: tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1,
    });
  }
  function consume(node: ts.Expression, required = false) {
    if (schema(node) || absent(node)) return;
    const result = value(node);
    if (result.stale && (required || result.currency)) report(node, "previous-store-currency");
    else if (result.made || (required && !result.currency)) report(node, "synthesized-currency");
  }
  function visit(node: ts.Node) {
    if (ts.isTypeNode(node)) return;
    if (
      ts.isBindingElement(node) &&
      ts.isIdentifier(node.name) &&
      currencyName(key(node.propertyName ?? node.name) ?? "")
    )
      consume(node.name, true);
    if (
      (ts.isVariableDeclaration(node) || ts.isParameter(node) || ts.isBindingElement(node)) &&
      node.initializer
    ) {
      const isCurrency = currencyName(
        key(ts.isBindingElement(node) ? (node.propertyName ?? node.name) : node.name) ?? "",
      );
      if (isCurrency) consume(node.initializer, true);
      else if (!ts.isStringLiteralLike(unwrap(node.initializer))) consume(node.initializer);
    }
    if (ts.isPropertyAssignment(node) && currencyName(key(node.name) ?? ""))
      consume(node.initializer, true);
    if (ts.isShorthandPropertyAssignment(node) && currencyName(node.name.text))
      consume(node.name, true);
    if (ts.isBinaryExpression(node)) {
      const op = node.operatorToken.kind;
      if (
        [
          ts.SyntaxKind.QuestionQuestionToken,
          ts.SyntaxKind.BarBarToken,
          ts.SyntaxKind.QuestionQuestionEqualsToken,
          ts.SyntaxKind.BarBarEqualsToken,
        ].includes(op) &&
        value(node.left).currency &&
        !absent(node.right)
      )
        report(node, "currency-fallback");
      if (op === ts.SyntaxKind.EqualsToken) consume(node.right, value(node.left).currency);
    }
    if (ts.isConditionalExpression(node)) consume(node);
    if (ts.isReturnStatement(node) && node.expression) consume(node.expression);
    if (ts.isArrowFunction(node) && !ts.isBlock(node.body)) consume(node.body);
    if (ts.isJsxExpression(node) && node.expression) consume(node.expression);
    if (ts.isCallExpression(node))
      for (const argument of node.arguments)
        if (!ts.isStringLiteralLike(unwrap(argument))) consume(argument);
    ts.forEachChild(node, visit);
  }
  visit(tree);
  return violations;
}
