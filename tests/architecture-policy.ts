import ts from "typescript";

export type ArchitectureRule =
  | "browser-persistence"
  | "central-api-boundary"
  | "token-authentication"
  | "unsafe-html"
  | "merchant-surface-boundary"
  | "production-development-import"
  | "restricted-image-hosts";

export interface ArchitectureViolation {
  rule: ArchitectureRule;
  file: string;
  line: number;
  column: number;
}

/** Parse executable syntax, never documentation, comments, test names or fixture contents. */
export function isProductionSource(filename: string): boolean {
  const path = filename.replaceAll("\\", "/");
  return (
    /\.[cm]?[jt]sx?$/.test(path) &&
    !/\.d\.ts$/.test(path) &&
    !/\.(test|spec)\.[jt]sx?$/.test(path) &&
    !/(^|\/)(tests?|__tests__|__fixtures__|fixtures|dev|docs|node_modules|\.next)(\/|$)/.test(path)
  );
}

function unwrap(expression: ts.Expression): ts.Expression {
  if (
    ts.isParenthesizedExpression(expression) ||
    ts.isAsExpression(expression) ||
    ts.isSatisfiesExpression(expression) ||
    ts.isNonNullExpression(expression) ||
    ts.isTypeAssertionExpression(expression)
  )
    return unwrap(expression.expression);
  return expression;
}

/** A deliberately bounded source policy, not a general-purpose JavaScript taint analyzer. */
export function inspectArchitecture(filename: string, source: string): ArchitectureViolation[] {
  if (!isProductionSource(filename)) return [];
  const file = ts.createSourceFile(
    filename,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const aliases = new Map<string, ts.Expression>();
  const destructured = new Map<string, string>();
  const path = filename.replaceAll("\\", "/");
  const centralApi = /(^|\/)src\/lib\/api\//.test(path);
  const imageConfiguration = /(^|\/)next\.config\.[cm]?[jt]s$/.test(path);
  const violations: ArchitectureViolation[] = [];
  const reported = new Set<string>();

  function visit(node: ts.Node, callback: (child: ts.Node) => void): void {
    callback(node);
    ts.forEachChild(node, (child) => visit(child, callback));
  }

  function report(rule: ArchitectureRule, node: ts.Node): void {
    const position = node.getStart(file);
    const key = `${rule}:${position}`;
    if (reported.has(key)) return;
    reported.add(key);
    const { line, character } = file.getLineAndCharacterOfPosition(position);
    violations.push({ rule, file: filename, line: line + 1, column: character + 1 });
  }

  visit(file, (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer)
      aliases.set(node.name.text, node.initializer);
  });

  function literal(
    expression: ts.Expression | undefined,
    seen = new Set<string>(),
  ): string | undefined {
    if (!expression) return undefined;
    const node = unwrap(expression);
    if (ts.isStringLiteralLike(node)) return node.text;
    if (ts.isIdentifier(node) && !seen.has(node.text)) {
      seen.add(node.text);
      return literal(aliases.get(node.text), seen);
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      const left = literal(node.left, new Set(seen));
      const right = literal(node.right, new Set(seen));
      return left === undefined || right === undefined ? undefined : left + right;
    }
    return undefined;
  }

  function nameOf(name: ts.PropertyName): string | undefined {
    if (ts.isIdentifier(name) || ts.isStringLiteralLike(name)) return name.text;
    if (ts.isComputedPropertyName(name)) return literal(name.expression);
    return undefined;
  }

  function expressionPath(expression: ts.Expression, seen = new Set<string>()): string | undefined {
    const node = unwrap(expression);
    if (ts.isIdentifier(node)) {
      if (seen.has(node.text)) return undefined;
      seen.add(node.text);
      const destructuredPath = destructured.get(node.text);
      if (destructuredPath) return destructuredPath;
      const alias = aliases.get(node.text);
      return alias ? expressionPath(alias, seen) : node.text;
    }
    if (ts.isPropertyAccessExpression(node)) {
      const object = expressionPath(node.expression, seen);
      return object ? `${object}.${node.name.text}` : undefined;
    }
    if (ts.isElementAccessExpression(node)) {
      const object = expressionPath(node.expression, seen);
      const property = literal(node.argumentExpression);
      return object && property ? `${object}.${property}` : undefined;
    }
    return undefined;
  }

  visit(file, (node) => {
    if (
      !ts.isVariableDeclaration(node) ||
      !ts.isObjectBindingPattern(node.name) ||
      !node.initializer
    )
      return;
    const object = expressionPath(node.initializer);
    if (!object) return;
    for (const binding of node.name.elements) {
      if (!ts.isIdentifier(binding.name)) continue;
      const property = binding.propertyName ? nameOf(binding.propertyName) : binding.name.text;
      if (property) destructured.set(binding.name.text, `${object}.${property}`);
    }
  });

  function isDevelopmentCondition(expression: ts.Expression): boolean {
    const node = unwrap(expression);
    if (
      !ts.isBinaryExpression(node) ||
      node.operatorToken.kind !== ts.SyntaxKind.EqualsEqualsEqualsToken
    )
      return false;
    return (
      (expressionPath(node.left) === "process.env.NODE_ENV" &&
        literal(node.right) === "development") ||
      (expressionPath(node.right) === "process.env.NODE_ENV" &&
        literal(node.left) === "development")
    );
  }

  function isDevelopmentOnly(node: ts.Node): boolean {
    for (let child = node, parent = child.parent; parent; child = parent, parent = parent.parent) {
      if (
        ts.isIfStatement(parent) &&
        child === parent.thenStatement &&
        isDevelopmentCondition(parent.expression)
      )
        return true;
    }
    return false;
  }

  function inspectModule(module: string, node: ts.Node): void {
    if (
      /(^|\/)(platform(?:-admin)?|diagnostics?|notification-diagnostics)(\/|$)/i.test(module) ||
      /(^|[\/@-])(devtools|analytics|posthog|mixpanel|amplitude|sentry|gtag)([\/@-]|$)/i.test(
        module,
      ) ||
      /^(?:@segment\/|@vercel\/speed-insights)/.test(module)
    )
      report("merchant-surface-boundary", node);
    if (/^(?:jose|jsonwebtoken|jwt-decode|jwt-simple)(\/|$)/.test(module))
      report("token-authentication", node);
    if (!centralApi && /^(?:axios|ky|ofetch|node-fetch|cross-fetch|undici)(\/|$)/.test(module))
      report("central-api-boundary", node);
    if (/(^|\/)(dev|__fixtures__|fixtures|mocks)(\/|$)/.test(module) && !isDevelopmentOnly(node))
      report("production-development-import", node);
  }

  function inspectExecutable(expression: ts.Expression): void {
    const target = expressionPath(expression);
    if (!target) return;
    if (
      /^(?:(?:window|globalThis|self)\.)?(?:localStorage|sessionStorage|indexedDB)(?:\.|$)/.test(
        target,
      )
    )
      report("browser-persistence", expression);
    if (
      !centralApi &&
      /^(?:(?:window|globalThis|self)\.)?(?:fetch|XMLHttpRequest)(?:\.|$)/.test(target)
    )
      report("central-api-boundary", expression);
  }

  function resolveExpression(expression: ts.Expression, seen = new Set<string>()): ts.Expression {
    const node = unwrap(expression);
    if (ts.isIdentifier(node) && aliases.has(node.text) && !seen.has(node.text)) {
      seen.add(node.text);
      return resolveExpression(aliases.get(node.text)!, seen);
    }
    return node;
  }

  function inspectImagePatterns(node: ts.PropertyAssignment): void {
    const name = nameOf(node.name);
    if (name !== "remotePatterns" && name !== "domains") return;
    const patterns = resolveExpression(node.initializer);
    if (!ts.isArrayLiteralExpression(patterns)) {
      report("restricted-image-hosts", node);
      return;
    }
    for (const element of patterns.elements) {
      const pattern = resolveExpression(element);
      let hostname: string | undefined;
      if (name === "domains") hostname = literal(pattern);
      else if (ts.isObjectLiteralExpression(pattern)) {
        const host = pattern.properties.find(
          (property) => ts.isPropertyAssignment(property) && nameOf(property.name) === "hostname",
        );
        if (host && ts.isPropertyAssignment(host)) hostname = literal(host.initializer);
      } else if (ts.isNewExpression(pattern) && expressionPath(pattern.expression) === "URL") {
        const url = literal(pattern.arguments?.[0]);
        if (url) {
          try {
            hostname = new URL(url).hostname;
          } catch {
            hostname = undefined;
          }
        }
      }
      if (!hostname || hostname.includes("*")) report("restricted-image-hosts", element);
    }
  }

  visit(file, (node) => {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      !node.importClause?.isTypeOnly
    )
      inspectModule(node.moduleSpecifier.text, node);
    if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      !node.isTypeOnly
    )
      inspectModule(node.moduleSpecifier.text, node);
    if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      inspectExecutable(node.expression);
      const target = expressionPath(node.expression);
      if (
        ts.isCallExpression(node) &&
        (node.expression.kind === ts.SyntaxKind.ImportKeyword || target === "require")
      ) {
        const modulePath = literal(node.arguments[0]);
        if (modulePath) inspectModule(modulePath, node);
      }
      if (target && /\.(?:set|append|setRequestHeader)$/.test(target)) {
        const header = literal(node.arguments?.[0]);
        const value = literal(node.arguments?.[1]);
        if (header?.toLowerCase() === "authorization" || /^Bearer\s/i.test(value ?? ""))
          report("token-authentication", node);
      }
      if (ts.isNewExpression(node) && target === "Headers") {
        const entries = node.arguments?.[0];
        if (entries && ts.isArrayLiteralExpression(entries)) {
          for (const entry of entries.elements) {
            if (
              ts.isArrayLiteralExpression(entry) &&
              literal(entry.elements[0])?.toLowerCase() === "authorization"
            )
              report("token-authentication", entry);
          }
        }
      }
      if (target?.endsWith(".insertAdjacentHTML")) report("unsafe-html", node);
    }
    if (ts.isVariableDeclaration(node) && node.initializer) inspectExecutable(node.initializer);
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node))
      inspectExecutable(node);
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      const target = expressionPath(node.left);
      if (target && /^(?:(?:window|globalThis)\.)?document\.cookie$/.test(target))
        report("browser-persistence", node);
      if (target && /\.(?:innerHTML|outerHTML)$/.test(target)) report("unsafe-html", node);
      if (target?.toLowerCase().endsWith(".authorization")) report("token-authentication", node);
    }
    if (ts.isPropertyAssignment(node)) {
      const name = nameOf(node.name);
      if (name?.toLowerCase() === "authorization") report("token-authentication", node);
      if (name === "dangerouslySetInnerHTML") report("unsafe-html", node);
      if (imageConfiguration) inspectImagePatterns(node);
    }
    if (
      ts.isJsxAttribute(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === "dangerouslySetInnerHTML"
    )
      report("unsafe-html", node);
  });
  return violations;
}
