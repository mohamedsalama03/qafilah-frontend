import ts from "typescript";

export type ArchitectureRule =
  | "browser-persistence"
  | "central-api-boundary"
  | "token-authentication"
  | "unsafe-html"
  | "merchant-surface-boundary"
  | "production-development-import"
  | "restricted-image-hosts"
  | "verified-contract-registry"
  | "role-derived-authority"
  | "uuid-derived-authority"
  | "tenant-selector-authority"
  | "product-query-isolation"
  | "product-mutation-boundary"
  | "product-mutation-retry"
  | "product-mutation-isolation"
  | "inventory-query-isolation"
  | "inventory-mutation-boundary"
  | "inventory-mutation-retry"
  | "inventory-mutation-isolation"
  | "inventory-absolute-quantity"
  | "inventory-response-boundary"
  | "variant-query-isolation"
  | "variant-mutation-boundary"
  | "variant-mutation-retry"
  | "variant-mutation-isolation"
  | "variant-response-boundary"
  | "variant-inventory-query-isolation"
  | "variant-inventory-mutation-boundary"
  | "variant-inventory-mutation-retry"
  | "variant-inventory-mutation-isolation"
  | "variant-inventory-absolute-quantity"
  | "variant-inventory-response-boundary";

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
  type Binding = ts.Expression | ts.FunctionDeclaration | null;
  const bindings = new Map<ts.Node, Map<string, Binding>>();
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

  function bind(name: ts.Identifier, value: Binding): void {
    let scope = name.parent.parent;
    while (
      scope.parent &&
      !ts.isBlock(scope) &&
      !ts.isSourceFile(scope) &&
      !ts.isFunctionLike(scope) &&
      !ts.isForStatement(scope) &&
      !ts.isForOfStatement(scope) &&
      !ts.isForInStatement(scope)
    )
      scope = scope.parent;
    const locals = bindings.get(scope) ?? new Map<string, Binding>();
    locals.set(name.text, value);
    bindings.set(scope, locals);
  }

  function bindingFor(name: ts.Identifier): Binding | undefined {
    for (let scope: ts.Node | undefined = name.parent; scope; scope = scope.parent) {
      const locals = bindings.get(scope);
      if (locals?.has(name.text)) return locals.get(name.text);
    }
    return undefined;
  }

  visit(file, (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name))
      bind(node.name, node.initializer ?? null);
    if (ts.isParameter(node) && ts.isIdentifier(node.name)) bind(node.name, null);
    if (ts.isFunctionDeclaration(node) && node.name) bind(node.name, node);
  });

  function literal(
    expression: ts.Expression | undefined,
    seen = new Set<ts.Node>(),
  ): string | undefined {
    if (!expression) return undefined;
    const node = unwrap(expression);
    if (ts.isStringLiteralLike(node)) return node.text;
    if (ts.isIdentifier(node)) {
      const binding = bindingFor(node);
      if (binding && !ts.isFunctionDeclaration(binding) && !seen.has(binding)) {
        seen.add(binding);
        return literal(binding, seen);
      }
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

  function expressionPath(
    expression: ts.Expression,
    seen = new Set<ts.Node>(),
  ): string | undefined {
    const node = unwrap(expression);
    if (ts.isIdentifier(node)) {
      const destructuredPath = destructured.get(node.text);
      if (destructuredPath) return destructuredPath;
      const alias = bindingFor(node);
      if (!alias || ts.isFunctionDeclaration(alias)) return node.text;
      if (seen.has(alias)) return undefined;
      seen.add(alias);
      return expressionPath(alias, seen);
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
    // Preserve the constructor identity through `const headers = new Headers()`.
    // Previously the identifier resolved to a NewExpression and lost its path,
    // so the later set/append invocation was never inspected as a header write.
    if (ts.isNewExpression(node)) return expressionPath(node.expression, seen);
    if (ts.isCallExpression(node)) {
      const called = unwrap(node.expression);
      const helper = ts.isIdentifier(called) ? bindingFor(called) : called;
      if (
        helper &&
        (ts.isFunctionDeclaration(helper) ||
          ts.isFunctionExpression(helper) ||
          ts.isArrowFunction(helper)) &&
        helper.body
      ) {
        if (seen.has(helper)) return undefined;
        seen.add(helper);
        if (!ts.isBlock(helper.body)) return expressionPath(helper.body, seen);
        const returns = helper.body.statements.filter(ts.isReturnStatement);
        // Bounded local helper resolution; no execution or whole-program analysis.
        if (returns.length === 1 && returns[0]?.expression)
          return expressionPath(returns[0].expression, seen);
      }
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
      /(^|\/)(platform(?:-admin)?|storefront|diagnostics?|notification-diagnostics)(\/|$)/i.test(
        module,
      ) ||
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

  function resolveExpression(expression: ts.Expression, seen = new Set<ts.Node>()): ts.Expression {
    const node = unwrap(expression);
    if (ts.isIdentifier(node)) {
      const binding = bindingFor(node);
      if (binding && !ts.isFunctionDeclaration(binding) && !seen.has(binding)) {
        seen.add(binding);
        return resolveExpression(binding, seen);
      }
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

  // Published F2–F3-D contracts plus exactly two Variant inventory contracts.
  // Backend evidence for another capability does not authorize activating it here.
  const verifiedContracts: Record<string, readonly [string, string]> = {
    csrf: ["GET", "/sanctum/csrf-cookie"],
    login: ["POST", "/api/v1/auth/login"],
    identity: ["GET", "/api/v1/me"],
    logout: ["POST", "/api/v1/auth/logout"],
    stores: ["GET", "/api/v1/me/stores?page={value}"],
    context: ["GET", "/api/v1/stores/{value}/context"],
    products: ["GET", "/api/v1/stores/{value}/catalog/products?{value}"],
    product: ["GET", "/api/v1/stores/{value}/catalog/products/{value}"],
    categories: ["GET", "/api/v1/stores/{value}/catalog/categories?{value}"],
    createProduct: ["POST", "/api/v1/stores/{value}/catalog/products"],
    updateProduct: ["PATCH", "/api/v1/stores/{value}/catalog/products/{value}"],
    publishProduct: ["POST", "/api/v1/stores/{value}/catalog/products/{value}/publish"],
    unpublishProduct: ["POST", "/api/v1/stores/{value}/catalog/products/{value}/unpublish"],
    archiveProduct: ["POST", "/api/v1/stores/{value}/catalog/products/{value}/archive"],
    productInventory: ["GET", "/api/v1/stores/{value}/catalog/products/{value}/inventory"],
    updateProductInventory: ["PATCH", "/api/v1/stores/{value}/catalog/products/{value}/inventory"],
    productOptions: ["GET", "/api/v1/stores/{value}/catalog/products/{value}/options"],
    createProductOption: ["POST", "/api/v1/stores/{value}/catalog/products/{value}/options"],
    updateProductOption: [
      "PATCH",
      "/api/v1/stores/{value}/catalog/products/{value}/options/{value}",
    ],
    createProductOptionValue: [
      "POST",
      "/api/v1/stores/{value}/catalog/products/{value}/options/{value}/values",
    ],
    updateProductOptionValue: [
      "PATCH",
      "/api/v1/stores/{value}/catalog/products/{value}/options/{value}/values/{value}",
    ],
    productVariants: ["GET", "/api/v1/stores/{value}/catalog/products/{value}/variants"],
    createProductVariant: ["POST", "/api/v1/stores/{value}/catalog/products/{value}/variants"],
    productVariant: ["GET", "/api/v1/stores/{value}/catalog/products/{value}/variants/{value}"],
    updateProductVariant: [
      "PATCH",
      "/api/v1/stores/{value}/catalog/products/{value}/variants/{value}",
    ],
    variantInventory: [
      "GET",
      "/api/v1/stores/{value}/catalog/products/{value}/variants/{value}/inventory",
    ],
    updateVariantInventory: [
      "PATCH",
      "/api/v1/stores/{value}/catalog/products/{value}/variants/{value}/inventory",
    ],
  };

  function registryEntry(node: ts.ObjectLiteralExpression): string | undefined {
    let entry: ts.Node = node;
    while (
      ts.isAsExpression(entry.parent) ||
      ts.isSatisfiesExpression(entry.parent) ||
      ts.isParenthesizedExpression(entry.parent)
    )
      entry = entry.parent;
    if (!ts.isPropertyAssignment(entry.parent)) return undefined;
    const property = entry.parent;
    let declaration: ts.Node = property.parent;
    while (
      ts.isAsExpression(declaration.parent) ||
      ts.isSatisfiesExpression(declaration.parent) ||
      ts.isParenthesizedExpression(declaration.parent)
    )
      declaration = declaration.parent;
    return ts.isVariableDeclaration(declaration.parent) &&
      ts.isIdentifier(declaration.parent.name) &&
      declaration.parent.name.text === "merchantContracts"
      ? nameOf(property.name)
      : undefined;
  }

  function contractPath(expression: ts.Expression): string | undefined {
    const node = resolveExpression(expression);
    if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
      if (!ts.isBlock(node.body)) return contractPath(node.body);
      const statements = node.body.statements;
      return statements.length === 1 &&
        ts.isReturnStatement(statements[0]) &&
        statements[0].expression
        ? contractPath(statements[0].expression)
        : undefined;
    }
    if (ts.isTemplateExpression(node))
      return (
        node.head.text + node.templateSpans.map((span) => `{value}${span.literal.text}`).join("")
      );
    return literal(node);
  }

  function inspectContract(node: ts.ObjectLiteralExpression): void {
    const properties = new Map(
      node.properties.flatMap((property) =>
        ts.isPropertyAssignment(property)
          ? [[nameOf(property.name), property.initializer] as const]
          : [],
      ),
    );
    const entry = registryEntry(node);
    if (
      entry === undefined &&
      !(
        properties.has("path") &&
        (properties.has("method") ||
          properties.has("decode") ||
          properties.has("evidence") ||
          node.properties.some(ts.isSpreadAssignment))
      )
    )
      return;
    const expected = entry === undefined ? undefined : verifiedContracts[entry];
    const method = properties.get("method");
    const pathExpression = properties.get("path");
    if (
      path !== "src/lib/backend/contracts.ts" ||
      !expected ||
      !method ||
      literal(method) !== expected[0] ||
      !pathExpression ||
      contractPath(pathExpression) !== expected[1] ||
      (expected[0] === "GET" && properties.has("body")) ||
      (["publishProduct", "unpublishProduct", "archiveProduct"].includes(entry ?? "") &&
        properties.has("body")) ||
      node.properties.some(ts.isSpreadAssignment)
    )
      report("verified-contract-registry", node);
    if (
      (entry === "productInventory" || entry === "updateProductInventory") &&
      (!properties.get("decode") ||
        expressionPath(properties.get("decode")!) !== "decodeProductInventory")
    )
      report("inventory-response-boundary", node);
    if (
      (entry === "variantInventory" || entry === "updateVariantInventory") &&
      (!properties.get("decode") ||
        expressionPath(properties.get("decode")!) !== "decodeVariantInventory")
    )
      report("variant-inventory-response-boundary", node);
    const variantDecoders: Record<string, string> = {
      productOptions: "decodeProductOptions",
      createProductOption: "decodeMerchantProductOption",
      updateProductOption: "decodeMerchantProductOption",
      createProductOptionValue: "decodeMerchantProductOption",
      updateProductOptionValue: "decodeMerchantProductOption",
      productVariants: "decodeProductVariants",
      createProductVariant: "decodeMerchantVariant",
      productVariant: "decodeMerchantVariant",
      updateProductVariant: "decodeMerchantVariant",
    };
    if (
      entry &&
      variantDecoders[entry] &&
      (!properties.get("decode") ||
        expressionPath(properties.get("decode")!) !== variantDecoders[entry])
    )
      report("variant-response-boundary", node);
  }

  function roleDescriptor(expression: ts.Expression): boolean {
    const target = expressionPath(expression);
    return (
      !!target &&
      /(?:^|\.)(?:[A-Za-z_$]*[Rr]ole)\.(?:name|kind)(?:\.|$)|(?:^|\.)(?:roleName|roleKind)$/.test(
        target,
      )
    );
  }

  function containsRoleDescriptor(expression: ts.Expression): boolean {
    let found = false;
    visit(expression, (node) => {
      if (ts.isExpression(node) && roleDescriptor(node)) found = true;
    });
    return found;
  }

  function capabilityName(name: string | undefined): boolean {
    return (
      !!name &&
      /^(?:can[A-Z_]|has(?:Access|Permission|Authority|Membership)|is(?:Allowed|Authorized|Owner|Member)|allowed$|authorized$)/.test(
        name,
      )
    );
  }

  function uuidTruthiness(expression: ts.Expression): boolean {
    const node = resolveExpression(expression);
    if (ts.isArrowFunction(node) && !ts.isBlock(node.body)) return uuidTruthiness(node.body);
    if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.ExclamationToken)
      return uuidTruthiness(node.operand);
    if (
      ts.isCallExpression(node) &&
      expressionPath(node.expression) === "Boolean" &&
      node.arguments[0]
    )
      return uuidTruthiness(node.arguments[0]);
    const target = expressionPath(node);
    return (
      !!target &&
      /(?:^|\.)(?:storeUuid|storeId|store_id|store\.id|productUuid|productId|product_id|product\.id|tenantUuid|tenantId|tenant_id)$/.test(
        target,
      )
    );
  }

  const productResources = new Set(["products", "product", "product-categories"]);
  const mutationSource = path === "src/features/products/mutations.ts";
  const inventorySource = /^src\/features\/inventory\//.test(path);
  const inventoryMutationSource = path === "src/features/inventory/mutations.ts";
  const inventoryQuerySource = path === "src/features/inventory/queries.ts";
  const inventoryDispatches: ts.Node[] = [];
  const variantInventorySource = /^src\/features\/variant-inventory\//.test(path);
  const variantInventoryMutationSource = path === "src/features/variant-inventory/mutations.ts";
  const variantInventoryQuerySource = path === "src/features/variant-inventory/queries.ts";
  const variantInventoryDispatches: ts.Node[] = [];
  const variantSource = /^src\/features\/variants\//.test(path);
  const variantMutationSource = path === "src/features/variants/mutations.ts";
  const variantQuerySource = path === "src/features/variants/queries.ts";
  const variantDispatches = new Map<string, ts.Node[]>();

  function scopedVariantKey(expression: ts.Expression | undefined): boolean {
    if (!expression) return false;
    const key = resolveExpression(expression);
    if (!ts.isCallExpression(key) || !key.arguments[0]) return false;
    const origin = unwrap(key.arguments[0]);
    if (
      !(ts.isIdentifier(origin) && origin.text === "scope") &&
      expressionPath(origin) !== "options.scope"
    )
      return false;
    const target = expressionPath(key.expression) ?? key.expression.getText(file);
    if (["variantKeys.options", "variantKeys.list", "productKeys.detail"].includes(target))
      return key.arguments.length === 2;
    if (target === "variantKeys.detail") return key.arguments.length === 3;
    if (target !== "storeKeys.resource" || !key.arguments[1]) return false;
    const allowed = [
      "product-options",
      "product-variants",
      "product-variant",
      "product",
      "products",
    ];
    const resource = key.arguments[1];
    if (allowed.includes(literal(resource) ?? "")) return true;
    if (ts.isIdentifier(resource)) {
      for (let parent: ts.Node | undefined = key.parent; parent; parent = parent.parent) {
        if (!ts.isForOfStatement(parent) || !ts.isVariableDeclarationList(parent.initializer))
          continue;
        const declaration = parent.initializer.declarations[0];
        if (
          !declaration ||
          !ts.isIdentifier(declaration.name) ||
          declaration.name.text !== resource.text
        )
          continue;
        const entries = resolveExpression(parent.expression);
        return (
          ts.isArrayLiteralExpression(entries) &&
          entries.elements.length > 0 &&
          entries.elements.every((entry) => allowed.includes(literal(entry) ?? ""))
        );
      }
    }
    return false;
  }

  function inspectVariantKeyFactory(node: ts.VariableDeclaration): void {
    if (!ts.isIdentifier(node.name) || node.name.text !== "variantKeys" || !node.initializer)
      return;
    const entries = objectFields(node.initializer);
    if (!entries || entries.size !== 3) {
      report("variant-query-isolation", node);
      return;
    }
    for (const [name, resource, parameters] of [
      ["options", "product-options", ["productUuid"]],
      ["list", "product-variants", ["productUuid"]],
      ["detail", "product-variant", ["productUuid", "variantUuid"]],
    ] as const) {
      const entry = entries.get(name);
      const factory = entry ? resolveExpression(entry) : undefined;
      if (!factory || !ts.isArrowFunction(factory) || ts.isBlock(factory.body)) {
        report("variant-query-isolation", entry ?? node);
        continue;
      }
      const call = unwrap(factory.body);
      const scopeParameter = factory.parameters[0]?.name;
      if (
        !ts.isCallExpression(call) ||
        expressionPath(call.expression) !== "storeKeys.resource" ||
        !scopeParameter ||
        !ts.isIdentifier(scopeParameter) ||
        call.arguments[0]?.getText(file) !== scopeParameter.text ||
        literal(call.arguments[1]) !== resource
      ) {
        report("variant-query-isolation", factory);
        continue;
      }
      const fields = objectFields(call.arguments[2]);
      if (
        !fields ||
        fields.size !== parameters.length ||
        parameters.some(
          (parameter, index) =>
            fields.get(parameter)?.getText(file) !==
            factory.parameters[index + 1]?.name.getText(file),
        )
      )
        report("variant-query-isolation", factory);
    }
  }

  function scopedMutationKey(expression: ts.Expression | undefined): boolean {
    if (!expression) return false;
    const key = resolveExpression(expression);
    if (!ts.isCallExpression(key) || !key.arguments[0]) return false;
    const origin = unwrap(key.arguments[0]);
    if (!ts.isIdentifier(origin) || origin.text !== "scope") return false;
    const target = expressionPath(key.expression);
    if (target === "productKeys.detail") return key.arguments.length === 2;
    return (
      target === "storeKeys.resource" &&
      ["products", "product"].includes(literal(key.arguments[1]) ?? "")
    );
  }

  function objectFields(
    expression: ts.Expression | undefined,
  ): Map<string, ts.Expression> | undefined {
    if (!expression) return undefined;
    const resolved = resolveExpression(expression);
    if (!ts.isObjectLiteralExpression(resolved) || resolved.properties.some(ts.isSpreadAssignment))
      return undefined;
    const fields = new Map<string, ts.Expression>();
    for (const property of resolved.properties) {
      if (ts.isPropertyAssignment(property)) {
        const name = nameOf(property.name);
        if (name) fields.set(name, property.initializer);
      } else if (ts.isShorthandPropertyAssignment(property))
        fields.set(property.name.text, property.name);
    }
    return fields;
  }

  function scopedInventoryKey(expression: ts.Expression | undefined): boolean {
    if (!expression) return false;
    const key = resolveExpression(expression);
    if (!ts.isCallExpression(key) || !key.arguments[0]) return false;
    const origin = unwrap(key.arguments[0]);
    if (
      !(ts.isIdentifier(origin) && origin.text === "scope") &&
      expressionPath(origin) !== "options.scope"
    )
      return false;
    const target = expressionPath(key.expression) ?? key.expression.getText(file);
    if (target === "inventoryKeys.detail" || target === "productKeys.detail")
      return key.arguments.length === 2;
    const resource = key.arguments[1];
    if (target !== "storeKeys.resource" || !resource) return false;
    const allowed = ["products", "product", "product-inventory"];
    if (allowed.includes(literal(resource) ?? "")) return true;
    // The authority-denial cleanup iterates an explicit bounded resource list.
    // An arbitrary variable or dynamic list cannot widen this cache boundary.
    if (ts.isIdentifier(resource)) {
      for (let parent: ts.Node | undefined = key.parent; parent; parent = parent.parent) {
        if (!ts.isForOfStatement(parent) || !ts.isVariableDeclarationList(parent.initializer))
          continue;
        const declaration = parent.initializer.declarations[0];
        if (
          !declaration ||
          !ts.isIdentifier(declaration.name) ||
          declaration.name.text !== resource.text
        )
          continue;
        const entries = resolveExpression(parent.expression);
        return (
          ts.isArrayLiteralExpression(entries) &&
          entries.elements.length > 0 &&
          entries.elements.every((entry) => allowed.includes(literal(entry) ?? ""))
        );
      }
    }
    return false;
  }

  function inspectInventoryKeyFactory(node: ts.VariableDeclaration): void {
    if (!ts.isIdentifier(node.name) || node.name.text !== "inventoryKeys" || !node.initializer)
      return;
    const entries = objectFields(node.initializer);
    const detail = entries?.get("detail");
    const factory = detail ? resolveExpression(detail) : undefined;
    if (
      !entries ||
      entries.size !== 1 ||
      !factory ||
      !ts.isArrowFunction(factory) ||
      ts.isBlock(factory.body)
    ) {
      report("inventory-query-isolation", node);
      return;
    }
    const call = unwrap(factory.body);
    const scopeParameter = factory.parameters[0]?.name;
    const productParameter = factory.parameters[1]?.name;
    const fields = ts.isCallExpression(call) ? objectFields(call.arguments[2]) : undefined;
    const product = fields?.get("productUuid");
    if (
      !ts.isCallExpression(call) ||
      expressionPath(call.expression) !== "storeKeys.resource" ||
      !scopeParameter ||
      !ts.isIdentifier(scopeParameter) ||
      !call.arguments[0] ||
      call.arguments[0].getText(file) !== scopeParameter.text ||
      literal(call.arguments[1]) !== "product-inventory" ||
      !productParameter ||
      !ts.isIdentifier(productParameter) ||
      !fields ||
      fields.size !== 1 ||
      !product ||
      product.getText(file) !== productParameter.text
    )
      report("inventory-query-isolation", factory);
  }

  function quantityReference(expression: ts.Expression): boolean {
    const target = expressionPath(expression);
    return !!target && /(?:^|\.)(?:quantity|currentQuantity|previousQuantity)$/.test(target);
  }

  function scopedVariantInventoryKey(expression: ts.Expression | undefined): boolean {
    if (!expression) return false;
    const key = resolveExpression(expression);
    if (!ts.isCallExpression(key) || !key.arguments[0]) return false;
    const origin = unwrap(key.arguments[0]);
    if (
      !(ts.isIdentifier(origin) && origin.text === "scope") &&
      expressionPath(origin) !== "options.scope"
    )
      return false;
    const target = expressionPath(key.expression) ?? key.expression.getText(file);
    if (target === "variantInventoryKeys.detail" || target === "variantKeys.detail")
      return key.arguments.length === 3;
    if (target === "variantKeys.list" || target === "productKeys.detail")
      return key.arguments.length === 2;
    if (target !== "storeKeys.resource" || !key.arguments[1]) return false;
    const allowed = [
      "variant-inventory",
      "product-variant",
      "product-variants",
      "product",
      "products",
    ];
    const resource = key.arguments[1];
    if (allowed.includes(literal(resource) ?? "")) return true;
    if (ts.isIdentifier(resource)) {
      for (let parent: ts.Node | undefined = key.parent; parent; parent = parent.parent) {
        if (!ts.isForOfStatement(parent) || !ts.isVariableDeclarationList(parent.initializer))
          continue;
        const declaration = parent.initializer.declarations[0];
        if (
          !declaration ||
          !ts.isIdentifier(declaration.name) ||
          declaration.name.text !== resource.text
        )
          continue;
        const entries = resolveExpression(parent.expression);
        return (
          ts.isArrayLiteralExpression(entries) &&
          entries.elements.length > 0 &&
          entries.elements.every((entry) => allowed.includes(literal(entry) ?? ""))
        );
      }
    }
    return false;
  }

  function inspectVariantInventoryKeyFactory(node: ts.VariableDeclaration): void {
    if (
      !ts.isIdentifier(node.name) ||
      node.name.text !== "variantInventoryKeys" ||
      !node.initializer
    )
      return;
    const entries = objectFields(node.initializer);
    const detail = entries?.get("detail");
    const factory = detail ? resolveExpression(detail) : undefined;
    if (
      !entries ||
      entries.size !== 1 ||
      !factory ||
      !ts.isArrowFunction(factory) ||
      ts.isBlock(factory.body)
    ) {
      report("variant-inventory-query-isolation", node);
      return;
    }
    const call = unwrap(factory.body);
    const scopeParameter = factory.parameters[0]?.name;
    const fields = ts.isCallExpression(call) ? objectFields(call.arguments[2]) : undefined;
    if (
      !ts.isCallExpression(call) ||
      expressionPath(call.expression) !== "storeKeys.resource" ||
      !scopeParameter ||
      !ts.isIdentifier(scopeParameter) ||
      call.arguments[0]?.getText(file) !== scopeParameter.text ||
      literal(call.arguments[1]) !== "variant-inventory" ||
      !fields ||
      fields.size !== 2 ||
      ["productUuid", "variantUuid"].some(
        (parameter, index) =>
          fields.get(parameter)?.getText(file) !==
          factory.parameters[index + 1]?.name.getText(file),
      )
    )
      report("variant-inventory-query-isolation", factory);
  }

  function inspectProductKeyFactory(node: ts.VariableDeclaration): void {
    if (!ts.isIdentifier(node.name) || node.name.text !== "productKeys" || !node.initializer)
      return;
    const entries = objectFields(node.initializer);
    if (!entries || entries.size !== 3) {
      report("product-query-isolation", node);
      return;
    }
    for (const [name, resource, parameters] of [
      ["list", "products", ["criteria", "cursor"]],
      ["detail", "product", ["productUuid"]],
      ["categories", "product-categories", ["criteria", "cursor"]],
    ] as const) {
      const entry = entries.get(name);
      const factory = entry ? resolveExpression(entry) : undefined;
      if (!factory || !ts.isArrowFunction(factory) || ts.isBlock(factory.body)) {
        report("product-query-isolation", entry ?? node);
        continue;
      }
      const call = unwrap(factory.body);
      const firstParameter = factory.parameters[0]?.name;
      if (
        !ts.isCallExpression(call) ||
        expressionPath(call.expression) !== "storeKeys.resource" ||
        !firstParameter ||
        !ts.isIdentifier(firstParameter) ||
        !call.arguments[0] ||
        !ts.isIdentifier(unwrap(call.arguments[0])) ||
        call.arguments[0].getText(file) !== firstParameter.text ||
        literal(call.arguments[1]) !== resource
      ) {
        report("product-query-isolation", factory);
        continue;
      }
      const fields = objectFields(call.arguments[2]);
      if (
        !fields ||
        fields.size !== parameters.length ||
        parameters.some((parameter, index) => {
          const field = fields.get(parameter);
          const parameterName = factory.parameters[index + 1]?.name;
          return (
            !field ||
            !parameterName ||
            !ts.isIdentifier(parameterName) ||
            !ts.isIdentifier(unwrap(field)) ||
            field.getText(file) !== parameterName.text
          );
        })
      )
        report("product-query-isolation", factory);
    }
  }

  visit(file, (node) => {
    if (ts.isObjectLiteralExpression(node)) inspectContract(node);
    if (ts.isVariableDeclaration(node)) inspectProductKeyFactory(node);
    if (ts.isVariableDeclaration(node)) inspectInventoryKeyFactory(node);
    if (ts.isVariableDeclaration(node)) inspectVariantKeyFactory(node);
    if (ts.isVariableDeclaration(node)) inspectVariantInventoryKeyFactory(node);
    if ((inventorySource || variantInventorySource) && ts.isBinaryExpression(node)) {
      const operator = node.operatorToken.kind;
      if (
        ([
          ts.SyntaxKind.PlusToken,
          ts.SyntaxKind.MinusToken,
          ts.SyntaxKind.PlusEqualsToken,
          ts.SyntaxKind.MinusEqualsToken,
        ].includes(operator) &&
          (quantityReference(node.left) || quantityReference(node.right))) ||
        ([ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(operator) &&
          quantityReference(node.left) &&
          literal(node.right) === undefined &&
          ts.isNumericLiteral(unwrap(node.right)) &&
          unwrap(node.right).getText(file) === "0")
      )
        report(
          variantInventorySource
            ? "variant-inventory-absolute-quantity"
            : "inventory-absolute-quantity",
          node,
        );
    }
    if (
      (inventorySource || variantInventorySource) &&
      (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
      [ts.SyntaxKind.PlusPlusToken, ts.SyntaxKind.MinusMinusToken].includes(node.operator) &&
      quantityReference(node.operand)
    )
      report(
        variantInventorySource
          ? "variant-inventory-absolute-quantity"
          : "inventory-absolute-quantity",
        node,
      );
    if (
      ts.isBinaryExpression(node) &&
      [
        ts.SyntaxKind.EqualsEqualsToken,
        ts.SyntaxKind.EqualsEqualsEqualsToken,
        ts.SyntaxKind.ExclamationEqualsToken,
        ts.SyntaxKind.ExclamationEqualsEqualsToken,
        ts.SyntaxKind.AmpersandAmpersandToken,
        ts.SyntaxKind.BarBarToken,
      ].includes(node.operatorToken.kind) &&
      (containsRoleDescriptor(node.left) || containsRoleDescriptor(node.right))
    )
      report("role-derived-authority", node);
    if (
      ts.isCallExpression(node) &&
      expressionPath(node.expression)?.endsWith(".includes") &&
      (containsRoleDescriptor(node.expression) || node.arguments.some(containsRoleDescriptor))
    )
      report("role-derived-authority", node);
    if (
      (ts.isIfStatement(node) || ts.isConditionalExpression(node)) &&
      containsRoleDescriptor(ts.isIfStatement(node) ? node.expression : node.condition)
    )
      report("role-derived-authority", node);
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      capabilityName(node.name.text) &&
      node.initializer
    ) {
      if (uuidTruthiness(node.initializer)) report("uuid-derived-authority", node);
      if (containsRoleDescriptor(node.initializer)) report("role-derived-authority", node);
    }
    if (
      ts.isPropertyAssignment(node) &&
      capabilityName(nameOf(node.name)) &&
      uuidTruthiness(node.initializer)
    )
      report("uuid-derived-authority", node);
    if (ts.isReturnStatement(node) && node.expression && uuidTruthiness(node.expression)) {
      let parent: ts.Node | undefined = node.parent;
      while (parent && !ts.isFunctionLike(parent)) parent = parent.parent;
      if (
        parent &&
        (ts.isFunctionDeclaration(parent) || ts.isMethodDeclaration(parent)) &&
        parent.name &&
        capabilityName(nameOf(parent.name))
      )
        report("uuid-derived-authority", node);
    }
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
        target &&
        /\.(?:listProducts|loadProduct|listCategories)$/.test(target) &&
        path !== "src/features/products/queries.ts" &&
        !mutationSource &&
        !inventoryMutationSource &&
        !variantMutationSource &&
        !(variantInventoryMutationSource && target.endsWith(".loadProduct"))
      )
        report("product-query-isolation", node);
      if (
        target &&
        /\.(?:createProduct|updateProduct|publishProduct|unpublishProduct|archiveProduct)$/.test(
          target,
        ) &&
        !mutationSource
      )
        report("product-mutation-boundary", node);
      if (
        target?.endsWith(".loadProductInventory") &&
        !inventoryQuerySource &&
        !inventoryMutationSource
      )
        report("inventory-query-isolation", node);
      if (target?.endsWith(".updateProductInventory") && !inventoryMutationSource)
        report("inventory-mutation-boundary", node);
      if (target?.endsWith(".updateProductInventory") && inventoryMutationSource)
        inventoryDispatches.push(node);
      if (
        target &&
        /\.(?:listProductOptions|listProductVariants|loadProductVariant)$/.test(target) &&
        !variantQuerySource &&
        !variantMutationSource &&
        !(variantInventoryMutationSource && target.endsWith(".loadProductVariant"))
      )
        report("variant-query-isolation", node);
      if (
        target?.endsWith(".loadVariantInventory") &&
        !variantInventoryQuerySource &&
        !variantInventoryMutationSource
      )
        report("variant-inventory-query-isolation", node);
      if (target?.endsWith(".updateVariantInventory")) {
        if (!variantInventoryMutationSource) report("variant-inventory-mutation-boundary", node);
        else variantInventoryDispatches.push(node);
      }
      if (
        variantInventoryMutationSource &&
        target &&
        /^(?:(?:window|globalThis|self)\.)?(?:setTimeout|setInterval|requestAnimationFrame)$/.test(
          target,
        )
      )
        report("variant-inventory-mutation-retry", node);
      if (
        (variantInventoryMutationSource || variantInventoryQuerySource) &&
        ts.isCallExpression(node)
      ) {
        if (target?.endsWith(".setQueryData") && !scopedVariantInventoryKey(node.arguments[0]))
          report("variant-inventory-mutation-isolation", node);
        if (
          /\.(?:invalidateQueries|cancelQueries|removeQueries|resetQueries|refetchQueries|setQueriesData)$/.test(
            target ?? "",
          ) &&
          !scopedVariantInventoryKey(objectFields(node.arguments[0])?.get("queryKey"))
        )
          report("variant-inventory-mutation-isolation", node);
      }
      if (
        target &&
        /\.(?:createProductOption|updateProductOption|createProductOptionValue|updateProductOptionValue|createProductVariant|updateProductVariant)$/.test(
          target,
        )
      ) {
        if (!variantMutationSource) report("variant-mutation-boundary", node);
        else {
          const name = target.split(".").at(-1)!;
          const calls = variantDispatches.get(name) ?? [];
          calls.push(node);
          variantDispatches.set(name, calls);
        }
      }
      if (
        variantMutationSource &&
        target &&
        /^(?:(?:window|globalThis|self)\.)?(?:setTimeout|setInterval|requestAnimationFrame)$/.test(
          target,
        )
      )
        report("variant-mutation-retry", node);
      if ((variantMutationSource || variantQuerySource) && ts.isCallExpression(node)) {
        if (target?.endsWith(".setQueryData") && !scopedVariantKey(node.arguments[0]))
          report("variant-mutation-isolation", node);
        if (
          /\.(?:invalidateQueries|cancelQueries|removeQueries|resetQueries|refetchQueries|setQueriesData)$/.test(
            target ?? "",
          ) &&
          !scopedVariantKey(objectFields(node.arguments[0])?.get("queryKey"))
        )
          report("variant-mutation-isolation", node);
      }
      if (
        inventoryMutationSource &&
        target &&
        /^(?:(?:window|globalThis|self)\.)?(?:setTimeout|setInterval|requestAnimationFrame)$/.test(
          target,
        )
      )
        report("inventory-mutation-retry", node);
      if ((inventoryMutationSource || inventoryQuerySource) && ts.isCallExpression(node)) {
        if (target?.endsWith(".setQueryData") && !scopedInventoryKey(node.arguments[0]))
          report("inventory-mutation-isolation", node);
        if (
          /\.(?:invalidateQueries|cancelQueries|removeQueries|resetQueries|refetchQueries|setQueriesData)$/.test(
            target ?? "",
          ) &&
          !scopedInventoryKey(objectFields(node.arguments[0])?.get("queryKey"))
        )
          report("inventory-mutation-isolation", node);
      }
      if (
        mutationSource &&
        target &&
        /^(?:(?:window|globalThis|self)\.)?(?:setTimeout|setInterval|requestAnimationFrame)$/.test(
          target,
        )
      )
        report("product-mutation-retry", node);
      if (
        mutationSource &&
        ts.isCallExpression(node) &&
        target?.endsWith(".setQueryData") &&
        !scopedMutationKey(node.arguments[0])
      )
        report("product-mutation-isolation", node);
      if (
        mutationSource &&
        ts.isCallExpression(node) &&
        /\.(?:invalidateQueries|cancelQueries|removeQueries|resetQueries|refetchQueries|setQueriesData)$/.test(
          target ?? "",
        ) &&
        !scopedMutationKey(objectFields(node.arguments[0])?.get("queryKey"))
      )
        report("product-mutation-isolation", node);
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
        if (/^x-(?:store|tenant)(?:-id|-uuid)?$/i.test(header ?? ""))
          report("tenant-selector-authority", node);
      }
      if (ts.isNewExpression(node) && target === "Headers") {
        const argument = node.arguments?.[0];
        const entries = argument ? resolveExpression(argument) : undefined;
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
      if (
        name === "retry" &&
        variantInventorySource &&
        resolveExpression(node.initializer).kind !== ts.SyntaxKind.FalseKeyword
      )
        report("variant-inventory-mutation-retry", node);
      if (
        name === "retry" &&
        variantSource &&
        resolveExpression(node.initializer).kind !== ts.SyntaxKind.FalseKeyword
      )
        report("variant-mutation-retry", node);
      if (
        name === "retry" &&
        inventorySource &&
        resolveExpression(node.initializer).kind !== ts.SyntaxKind.FalseKeyword
      )
        report("inventory-mutation-retry", node);
      if (
        name === "retry" &&
        (mutationSource ||
          (path === "src/lib/query/client.ts" &&
            ts.isObjectLiteralExpression(node.parent) &&
            ts.isPropertyAssignment(node.parent.parent) &&
            nameOf(node.parent.parent.name) === "mutations")) &&
        resolveExpression(node.initializer).kind !== ts.SyntaxKind.FalseKeyword
      )
        report("product-mutation-retry", node);
      if (
        name &&
        (/^(?:store_id|tenant_id)$/.test(name) || /^x-(?:store|tenant)(?:-id|-uuid)?$/i.test(name))
      )
        report("tenant-selector-authority", node);
      if (name === "queryKey") {
        const key = resolveExpression(node.initializer);
        if (
          ts.isArrayLiteralExpression(key) &&
          (variantInventorySource ||
            key.elements.some((item) => literal(item) === "variant-inventory"))
        )
          report("variant-inventory-query-isolation", node);
        if (
          ts.isArrayLiteralExpression(key) &&
          (variantSource ||
            key.elements.some((item) =>
              ["product-options", "product-variants", "product-variant"].includes(
                literal(item) ?? "",
              ),
            ))
        )
          report("variant-query-isolation", node);
        if (
          ts.isArrayLiteralExpression(key) &&
          (inventorySource || key.elements.some((item) => literal(item) === "product-inventory"))
        )
          report("inventory-query-isolation", node);
        if (
          ts.isArrayLiteralExpression(key) &&
          (/(^|\/)src\/features\/products\//.test(path) ||
            key.elements.some((item) => productResources.has(literal(item) ?? "")))
        )
          report("product-query-isolation", node);
      }
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
  // There is one deliberate dispatch site in the inventory lifecycle. A second
  // catch/finally retry path must not be introduced alongside it.
  if (inventoryDispatches.length > 1)
    inventoryDispatches.slice(1).forEach((node) => report("inventory-mutation-retry", node));
  variantInventoryDispatches
    .slice(1)
    .forEach((node) => report("variant-inventory-mutation-retry", node));
  for (const calls of variantDispatches.values())
    calls.slice(1).forEach((node) => report("variant-mutation-retry", node));
  return violations;
}
