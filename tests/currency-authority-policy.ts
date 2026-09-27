import ts from "typescript";

export interface CurrencyViolation {
  rule: "currency-authority";
  reason:
    | "synthesized-currency"
    | "currency-fallback"
    | "previous-store-currency"
    | "currency-source-substitution"
    | "retained-currency-snapshot"
    | "literal-currency-jsx"
    | "literal-currency-argument"
    | "unresolved-currency-provenance";
  file: string;
  line: number;
}

const currencyName = (name: string) => /(?:^currency$|Currency$|_currency$)/.test(name);
type Provenance = "AUTHORITATIVE" | "SAFE_NULL" | "SYNTHESIZED" | "STALE_OR_REUSED" | "UNRESOLVED";
type Value = {
  currency: boolean;
  made: boolean;
  stale: boolean;
  unknown: boolean;
  retained?: boolean;
  origins?: string[];
};
const empty: Value = { currency: false, made: false, stale: false, unknown: true };
const safeNull: Value = { ...empty, unknown: false };
const provenance = (value: Value): Provenance =>
  value.retained || value.stale
    ? "STALE_OR_REUSED"
    : value.made
      ? "SYNTHESIZED"
      : value.unknown
        ? "UNRESOLVED"
        : value.currency
          ? "AUTHORITATIVE"
          : "SAFE_NULL";
const merge = (...values: Value[]): Value => ({
  currency: values.some((value) => value.currency),
  made: values.some((value) => value.made),
  stale: values.some((value) => value.stale),
  retained: values.some((value) => value.retained),
  unknown: !values.length || values.some((value) => value.unknown),
  origins: [...new Set(values.flatMap((value) => value.origins ?? []))],
});

/** Bounded expression provenance, not a token ban: validation and explicit reads are legal.
 * Lexical declarations bind aliases and shadowing without constructing a compiler program.
 * Currency-producing expressions are checked wherever they occur, regardless of feature.
 */
export function inspectCurrencyAuthority(
  filename: string,
  source: string,
  sources: ReadonlyMap<string, ts.SourceFile> = new Map(),
): CurrencyViolation[] {
  const tree =
    sources.get(filename)?.text === source
      ? sources.get(filename)!
      : ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const violations: CurrencyViolation[] = [];
  const unwrap = (node: ts.Expression): ts.Expression =>
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isNonNullExpression(node) ||
    ts.isSatisfiesExpression(node) ||
    ts.isTypeAssertionExpression(node)
      ? unwrap(node.expression)
      : node;
  const locals = new Map<ts.Node, Map<string, ts.Declaration>>();
  let currencySyntax = false;
  const computedKeys: ts.Expression[] = [];
  const calls: ts.Expression[] = [];
  const scope = (node: ts.Node) =>
    ts.isSourceFile(node) ||
    ts.isBlock(node) ||
    ts.isFunctionLike(node) ||
    ts.isCatchClause(node) ||
    ts.isForStatement(node) ||
    ts.isForOfStatement(node) ||
    ts.isForInStatement(node);
  function bind(name: ts.Identifier, bound: ts.Declaration, start: ts.Node = bound.parent) {
    let owner = start;
    const hoisted =
      ts.isVariableDeclaration(bound) &&
      ts.isVariableDeclarationList(bound.parent) &&
      !(bound.parent.flags & ts.NodeFlags.BlockScoped);
    while (
      owner.parent &&
      (!scope(owner) || (hoisted && !ts.isFunctionLike(owner) && !ts.isSourceFile(owner)))
    )
      owner = owner.parent;
    const bindings = locals.get(owner) ?? new Map<string, ts.Declaration>();
    bindings.set(name.text, bound);
    locals.set(owner, bindings);
  }
  function indexBindings(node: ts.Node) {
    if (ts.isIdentifier(node) && currencyName(node.text)) currencySyntax = true;
    if (ts.isStringLiteralLike(node) && /^(?:currency|LYD|USD|EUR)$/.test(node.text))
      currencySyntax = true;
    if (ts.isComputedPropertyName(node)) computedKeys.push(node.expression);
    if (ts.isElementAccessExpression(node)) computedKeys.push(node.argumentExpression);
    if (ts.isCallExpression(node)) calls.push(node.expression);
    if (
      (ts.isVariableDeclaration(node) ||
        ts.isParameter(node) ||
        ts.isBindingElement(node) ||
        ts.isImportSpecifier(node) ||
        ts.isNamespaceImport(node)) &&
      ts.isIdentifier(node.name)
    )
      bind(node.name, node);
    if (ts.isFunctionDeclaration(node) && node.name) bind(node.name, node);
    if (ts.isFunctionExpression(node) && node.name) bind(node.name, node, node);
    ts.forEachChild(node, indexBindings);
  }
  indexBindings(tree);
  function declaration(node: ts.Identifier): ts.Declaration | undefined {
    for (let owner: ts.Node | undefined = node.parent; owner; owner = owner.parent) {
      const bound = locals.get(owner)?.get(node.text);
      if (bound) return bound;
    }
  }
  // Every production AST is inspected. Only currency-relevant syntax needs the more
  // expensive value-flow walk; folded computed keys and imported currency consumers
  // are included, so this is not a textual prefilter or a feature-directory allowlist.
  if (
    !currencySyntax &&
    !computedKeys.some((key) => currencyName(literal(key) ?? "")) &&
    !calls.some((callee) => functionSlots(callee).length)
  )
    return [];
  const writes = new Map<ts.Declaration, ts.BinaryExpression[]>();
  function indexWrites(node: ts.Node) {
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isIdentifier(node.left)
    ) {
      const bound = declaration(node.left);
      if (bound) writes.set(bound, [...(writes.get(bound) ?? []), node]);
    }
    ts.forEachChild(node, indexWrites);
  }
  indexWrites(tree);
  function executionOwner(node: ts.Node): ts.Node {
    let parent = node.parent;
    while (parent && !ts.isFunctionLike(parent) && !ts.isSourceFile(parent)) parent = parent.parent;
    return parent ?? tree;
  }
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
  // Canonical local source identity follows aliases/destructuring, not labels such as
  // "previous". It lets a null-check of source A reject substitution from source B.
  function reference(node: ts.Expression, seen = new Set<ts.Node>()): string | undefined {
    node = unwrap(node);
    if (seen.has(node)) return;
    const next = new Set(seen).add(node);
    if (ts.isIdentifier(node)) {
      const bound = declaration(node);
      if (bound && ts.isVariableDeclaration(bound) && bound.initializer)
        return reference(bound.initializer, next);
      if (bound && ts.isBindingElement(bound)) {
        const owner = bound.parent.parent;
        if ((ts.isVariableDeclaration(owner) || ts.isParameter(owner)) && owner.initializer) {
          const base = reference(owner.initializer, next);
          return base && `${base}.${key(bound.propertyName ?? bound.name)}`;
        }
      }
      return `${node.text}@${bound?.pos ?? "external"}`;
    }
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      const base = reference(node.expression, next);
      const name = ts.isPropertyAccessExpression(node)
        ? node.name.text
        : literal(node.argumentExpression);
      return base && name ? `${base}.${name}` : undefined;
    }
    if (ts.isCallExpression(node)) {
      const bound = ts.isIdentifier(node.expression) ? declaration(node.expression) : undefined;
      if (
        bound &&
        ts.isImportSpecifier(bound) &&
        (bound.propertyName ?? bound.name).text === "useStores"
      ) {
        const imported = bound.parent.parent.parent;
        if (
          ts.isImportDeclaration(imported) &&
          ts.isStringLiteral(imported.moduleSpecifier) &&
          imported.moduleSpecifier.text === "@/features/stores/components/store-provider"
        )
          return `selected@${node.pos}`;
      }
      return `call@${node.pos}`;
    }
    if (ts.isAwaitExpression(node)) return reference(node.expression, next);
  }
  const snapshot = (node: ts.Expression): boolean => {
    node = unwrap(node);
    return (
      /\.(?:store|context)$/.test(reference(node) ?? "") ||
      (ts.isConditionalExpression(node) && (snapshot(node.whenTrue) || snapshot(node.whenFalse)))
    );
  };
  function retainedRead(node: ts.Identifier, bound: ts.Declaration | undefined): boolean {
    if (!bound) return false;
    if (
      ts.isVariableDeclaration(bound) &&
      bound.initializer &&
      executionOwner(bound) !== executionOwner(node) &&
      snapshot(bound.initializer)
    )
      return true;
    return (writes.get(bound) ?? []).some(
      (write) =>
        snapshot(write.right) &&
        (executionOwner(write) !== executionOwner(node) ||
          executionOwner(bound) !== executionOwner(node) ||
          write.pos > node.pos),
    );
  }
  function resolveValue(node: ts.Expression, seen = new Set<ts.Node>()): ts.Expression {
    node = unwrap(node);
    if (seen.has(node)) return node;
    if (ts.isIdentifier(node)) {
      const bound = declaration(node);
      if (bound && ts.isVariableDeclaration(bound) && bound.initializer)
        return resolveValue(bound.initializer, new Set(seen).add(node));
    }
    return node;
  }
  function currencyParameters(fn: ts.SignatureDeclaration): number[] {
    // Validators consume allowed-code literals as comparisons, not as display authority.
    if (
      fn.type &&
      (fn.type.kind === ts.SyntaxKind.BooleanKeyword || ts.isTypePredicateNode(fn.type))
    )
      return [];
    return fn.parameters.flatMap((parameter, index) =>
      currencyName(key(parameter.name) ?? "") ? [index] : [],
    );
  }
  function functionSlots(expression: ts.Expression, seen = new Set<ts.Node>()): number[] {
    expression = unwrap(expression);
    if (seen.has(expression)) return [];
    const next = new Set(seen).add(expression);
    if (ts.isArrowFunction(expression) || ts.isFunctionExpression(expression))
      return currencyParameters(expression);
    if (!ts.isIdentifier(expression)) return [];
    const bound = declaration(expression);
    if (bound && ts.isFunctionDeclaration(bound)) return currencyParameters(bound);
    if (bound && ts.isVariableDeclaration(bound) && bound.initializer)
      return functionSlots(bound.initializer, next);
    if (bound && ts.isImportSpecifier(bound)) {
      const imported = bound.parent.parent.parent;
      if (ts.isImportDeclaration(imported) && ts.isStringLiteral(imported.moduleSpecifier)) {
        const modulePath = imported.moduleSpecifier.text;
        const base = modulePath.startsWith("@/")
          ? `src/${modulePath.slice(2)}`
          : new URL(modulePath, `file:///${filename}`).pathname.slice(1);
        const target = sources.get(base) ?? sources.get(`${base}.ts`) ?? sources.get(`${base}.tsx`);
        const name = (bound.propertyName ?? bound.name).text;
        const fn = target?.statements.find(
          (statement) => ts.isFunctionDeclaration(statement) && statement.name?.text === name,
        );
        if (fn && ts.isFunctionDeclaration(fn)) return currencyParameters(fn);
        for (const statement of target?.statements ?? []) {
          if (!ts.isVariableStatement(statement)) continue;
          for (const variable of statement.declarationList.declarations) {
            const initializer = variable.initializer && unwrap(variable.initializer);
            if (
              ts.isIdentifier(variable.name) &&
              variable.name.text === name &&
              initializer &&
              (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer))
            )
              return currencyParameters(initializer);
          }
        }
      }
    }
    return [];
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
  // These are contract-shaped inputs, not arbitrary objects with a property named
  // currency. Locals must resolve all the way to an input; casts and names cannot
  // bless an unknown initializer. Unsupported producers remain UNRESOLVED.
  function contextInput(node: ts.Expression): boolean {
    const base = reference(node);
    if (
      base &&
      /^(?:(?:context|state|product)@[^.]+(?:\.context)?|selected@[^.]+\.state\.context)$/.test(
        base,
      )
    )
      return true;
    const receiver = resolveValue(node);
    if (ts.isIdentifier(receiver)) {
      const bound = declaration(receiver);
      return !!bound && ts.isParameter(bound);
    }
    if (!ts.isAwaitExpression(receiver)) return false;
    const call = unwrap(receiver.expression);
    const member = (expression: ts.Expression, names: string[]): boolean => {
      const name = names.at(-1);
      return names.length === 1
        ? ts.isIdentifier(expression) && expression.text === name
        : ts.isPropertyAccessExpression(expression) &&
            expression.name.text === name &&
            member(expression.expression, names.slice(0, -1));
    };
    return (
      ts.isCallExpression(call) &&
      member(call.expression, ["options", "scope", "run"]) &&
      call.arguments.some(
        (argument) =>
          ts.isArrowFunction(argument) &&
          ts.isCallExpression(argument.body) &&
          member(argument.body.expression, ["options", "api", "loadStoreContext"]),
      )
    );
  }
  function currencyOwner(node: ts.Expression, seen = new Set<ts.Node>()): boolean {
    node = unwrap(node);
    if (seen.has(node)) return false;
    const next = new Set(seen).add(node);
    if (ts.isIdentifier(node)) {
      const bound = declaration(node);
      if (bound && ts.isVariableDeclaration(bound) && bound.initializer)
        return currencyOwner(bound.initializer, next);
      if (
        bound &&
        ts.isBindingElement(bound) &&
        key(bound.propertyName ?? bound.name) === "store"
      ) {
        const owner = bound.parent.parent;
        return (
          ts.isVariableDeclaration(owner) && !!owner.initializer && contextInput(owner.initializer)
        );
      }
      if (bound && ts.isParameter(bound) && bound.type)
        return /^(?:MoneyDisplayOptions|CatalogMoney)$/.test(bound.type.getText(tree));
      return false;
    }
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken &&
      ts.isObjectLiteralExpression(unwrap(node.right)) &&
      !(unwrap(node.right) as ts.ObjectLiteralExpression).properties.length
    )
      return currencyOwner(node.left, next);
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      const field = ts.isPropertyAccessExpression(node)
        ? node.name.text
        : literal(node.argumentExpression);
      if (field !== "store" && field !== "price") return false;
      return contextInput(node.expression);
    }
    return false;
  }
  function propertyValue(
    owner: ts.Expression,
    name: string | undefined,
    seen: Set<ts.Node>,
  ): Value {
    const receiver = value(owner, seen);
    const object = resolveValue(owner);
    if (ts.isObjectLiteralExpression(object)) {
      const selected = object.properties
        .filter(ts.isPropertyAssignment)
        .filter((property) => !name || key(property.name) === name);
      if (selected.length)
        return merge(...selected.map((property) => value(property.initializer, seen)));
    }
    if (currencyName(name ?? "")) {
      const origin = reference(owner);
      return {
        ...receiver,
        currency: true,
        unknown: !currencyOwner(owner),
        made:
          receiver.made ||
          receiverNames(owner).some((part) =>
            /^(?:navigator|locale|language|role|resolvedOptions)$/i.test(part),
          ),
        origins: origin ? [`${origin}.${name}`] : [],
      };
    }
    return { ...empty, stale: receiver.stale, retained: receiver.retained };
  }
  const values = new WeakMap<ts.Expression, Value>();
  function value(node: ts.Expression, seen = new Set<ts.Node>()): Value {
    if (seen.size) return inferValue(node, seen);
    const cached = values.get(node);
    if (cached) return cached;
    const result = inferValue(node, seen);
    values.set(node, result);
    return result;
  }
  function inferValue(node: ts.Expression, seen: Set<ts.Node>): Value {
    node = unwrap(node);
    if (seen.has(node)) return empty;
    const next = new Set(seen).add(node);
    if (schema(node)) return empty;
    if (absent(node)) return safeNull;
    if (ts.isStringLiteralLike(node))
      return /^(?:LYD|USD|EUR)$/.test(node.text) ? { ...empty, currency: true, made: true } : empty;
    if (ts.isIdentifier(node)) {
      const bound = declaration(node);
      let result = empty;
      if (bound && (ts.isVariableDeclaration(bound) || ts.isParameter(bound)) && bound.initializer)
        result = value(bound.initializer, next);
      else if (bound && ts.isBindingElement(bound)) {
        const owner = bound.parent.parent;
        if ((ts.isVariableDeclaration(owner) || ts.isParameter(owner)) && owner.initializer)
          result = propertyValue(owner.initializer, key(bound.propertyName ?? bound.name), next);
        else if (ts.isParameter(owner) && currencyName(key(bound.propertyName ?? bound.name) ?? ""))
          result = { ...empty, currency: true, unknown: false };
        else if (ts.isVariableDeclaration(owner) && owner.initializer)
          result = value(owner.initializer, next);
        if (bound.initializer) result = merge(result, value(bound.initializer, next));
      } else if (currencyName(node.text))
        result = { ...empty, currency: true, unknown: !bound || !ts.isParameter(bound) };
      const origin = result.currency && !result.origins?.length ? reference(node) : undefined;
      return {
        ...result,
        origins: result.origins?.length
          ? result.origins
          : result.currency && origin
            ? [origin]
            : [],
        retained: result.retained || retainedRead(node, bound),
        stale: result.stale,
      };
    }
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      const name = ts.isPropertyAccessExpression(node)
        ? node.name.text
        : literal(node.argumentExpression);
      // A lookup in a locally manufactured code map is inference, not a backend read.
      const object = resolveValue(node.expression);
      if (ts.isArrayLiteralExpression(object) && ts.isElementAccessExpression(node)) {
        const index = unwrap(node.argumentExpression);
        const elements = ts.isNumericLiteral(index)
          ? [object.elements[Number(index.text)]].filter((entry): entry is ts.Expression => !!entry)
          : [...object.elements];
        return merge(...elements.map((element) => value(element, next)));
      }
      return propertyValue(node.expression, name, next);
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
      if (ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "at") {
        const array = resolveValue(node.expression.expression);
        if (ts.isArrayLiteralExpression(array))
          return merge(...array.elements.map((element) => value(element, next)));
      }
      const callee = ts.isIdentifier(node.expression) ? declaration(node.expression) : undefined;
      const importedName =
        callee && ts.isImportSpecifier(callee)
          ? (callee.propertyName ?? callee.name).text
          : undefined;
      if (["useRef", "useState"].includes(importedName ?? node.expression.getText(tree)))
        return { ...empty, retained: true };
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
    if (!required && !result.currency && !result.made) return;
    const classification = provenance(result);
    if (result.retained) report(node, "retained-currency-snapshot");
    else if (classification === "STALE_OR_REUSED") report(node, "previous-store-currency");
    else if (classification === "SYNTHESIZED") report(node, "synthesized-currency");
    else if (classification === "UNRESOLVED") report(node, "unresolved-currency-provenance");
    else if (result.currency && (result.origins?.length ?? 0) > 1)
      report(node, "currency-source-substitution");
  }
  function conditionalSources(node: ts.ConditionalExpression) {
    const origins = new Set<string>();
    function condition(part: ts.Node) {
      if (
        ts.isBinaryExpression(part) &&
        [
          ts.SyntaxKind.EqualsEqualsToken,
          ts.SyntaxKind.EqualsEqualsEqualsToken,
          ts.SyntaxKind.ExclamationEqualsToken,
          ts.SyntaxKind.ExclamationEqualsEqualsToken,
        ].includes(part.operatorToken.kind)
      ) {
        for (const [read, missing] of [
          [part.left, part.right],
          [part.right, part.left],
        ]) {
          if (absent(missing!))
            for (const origin of value(read!).origins ?? []) origins.add(origin);
        }
      }
      ts.forEachChild(part, condition);
    }
    condition(node.condition);
    if (!origins.size) return;
    function candidate(expression: ts.Expression) {
      const result = value(expression);
      if (result.currency && result.made) report(expression, "currency-fallback");
      else if (result.currency && result.origins?.some((origin) => !origins.has(origin)))
        report(expression, "currency-source-substitution");
    }
    function branch(part: ts.Node) {
      if (ts.isPropertyAssignment(part) && currencyName(key(part.name) ?? ""))
        candidate(part.initializer);
      if (
        ts.isJsxAttribute(part) &&
        currencyName(part.name.getText(tree)) &&
        part.initializer &&
        ts.isJsxExpression(part.initializer) &&
        part.initializer.expression
      )
        candidate(part.initializer.expression);
      ts.forEachChild(part, branch);
    }
    for (const expression of [node.whenTrue, node.whenFalse]) {
      candidate(expression);
      branch(expression);
    }
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
    if (ts.isConditionalExpression(node)) {
      consume(node);
      conditionalSources(node);
    }
    if (ts.isReturnStatement(node) && node.expression) consume(node.expression);
    if (ts.isArrowFunction(node) && !ts.isBlock(node.body)) consume(node.body);
    if (ts.isJsxExpression(node) && node.expression) consume(node.expression);
    if (
      ts.isJsxAttribute(node) &&
      ts.isIdentifier(node.name) &&
      currencyName(node.name.text) &&
      node.initializer &&
      ts.isStringLiteral(node.initializer)
    )
      report(node.initializer, "literal-currency-jsx");
    if (
      ts.isJsxAttribute(node) &&
      currencyName(node.name.getText(tree)) &&
      node.initializer &&
      ts.isJsxExpression(node.initializer) &&
      node.initializer.expression
    )
      consume(node.initializer.expression, true);
    if (ts.isCallExpression(node)) {
      const slots = functionSlots(node.expression);
      // Membership/regexp checks observe a value, they do not publish currency.
      const inspection =
        ts.isPropertyAccessExpression(node.expression) &&
        ["includes", "has", "hasOwn", "test"].includes(node.expression.name.text);
      for (const [index, argument] of node.arguments.entries()) {
        if (slots.includes(index) && value(argument).made)
          report(argument, "literal-currency-argument");
        else if (slots.includes(index)) consume(argument, true);
        else if (!inspection && !ts.isStringLiteralLike(unwrap(argument))) consume(argument);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  return violations;
}
