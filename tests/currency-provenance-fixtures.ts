import ts from "typescript";

export const controllerFile = "src/lib/stores/controller.ts";
/** Replace the actual publication expression, preserving every declaration before
 * it (especially the awaited context and conditional snapshot). The injected
 * value flows into freezeContext, the query cache and StoreState publication.
 */
export const controllerCases = {
  "F2-controller-previous-store-inference": {
    setup: "",
    expression:
      "context.store.currency === undefined && previous ? { ...context, store: { ...context.store, currency: previous.store.currency } } : context",
    reason: "retained-currency-snapshot",
  },
  "controller-r3": {
    setup: "const currency = context.store.currency;",
    expression:
      "currency === undefined && previous ? {...context, store: {...context.store, currency: previous.store.currency}} : context",
    reason: "retained-currency-snapshot",
  },
  "controller-ternary": {
    setup: "const x = context.store.currency;",
    expression:
      "{...context, store: {...context.store, currency: x ? x : previous!.store.currency}}",
    reason: "retained-currency-snapshot",
  },
  "controller-assignment": {
    setup:
      "const store = {...context.store}; if (store.currency === undefined) { store.currency = previous?.store.currency; }",
    expression: "{...context, store}",
    reason: "retained-currency-snapshot",
  },
  "controller-nullish-reuse": {
    setup: "",
    expression:
      "{...context, store: {...context.store, currency: context.store.currency ?? previous?.store.currency}}",
    reason: "currency-fallback",
  },
  "controller-authoritative": {
    setup: "const {currency: code} = context.store; const currency = code ?? null;",
    expression: "{...context, store: {...context.store, currency}}",
  },
  "controller-authoritative-alias": {
    setup:
      "const alias = context; const {store: selected} = alias; const currency = selected.currency ?? null;",
    expression: "{...context, store: {...context.store, currency}}",
  },
  "controller-comparison": {
    setup: "const changed = previous?.store.currency !== context.store.currency; void changed;",
    expression: "context",
  },
} as const;

export function mutateController(source: string, name: keyof typeof controllerCases): string {
  const variant = controllerCases[name];
  const tree = ts.createSourceFile(controllerFile, source, ts.ScriptTarget.Latest, true);
  const candidates: ts.CallExpression[] = [];
  function visit(node: ts.Node) {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === "verified" &&
      node.initializer &&
      ts.isCallExpression(node.initializer) &&
      node.initializer.expression.getText(tree) === "freezeContext" &&
      node.initializer.arguments.length === 1 &&
      node.initializer.arguments[0]!.getText(tree) === "context"
    )
      candidates.push(node.initializer);
    ts.forEachChild(node, visit);
  }
  visit(tree);
  if (candidates.length !== 1) throw new Error("Expected one verified context publication");
  const call = candidates[0]!;
  const argument = call.arguments[0]!;
  const statement = call.parent.parent.parent;
  if (!ts.isVariableStatement(statement)) throw new Error("Expected publication declaration");
  const output =
    source.slice(0, statement.getStart(tree)) +
    (variant.setup ? variant.setup + "\n" : "") +
    source.slice(statement.getStart(tree), argument.getStart(tree)) +
    variant.expression +
    source.slice(argument.end);
  const parsed = ts.createSourceFile(controllerFile, output, ts.ScriptTarget.Latest, true);
  // Public TS API exposes syntactic diagnostics through a transpile operation.
  const result = ts.transpileModule(parsed.text, { reportDiagnostics: true });
  if (result.diagnostics?.length)
    throw new Error("Controller mutation must remain valid TypeScript");
  return output;
}
