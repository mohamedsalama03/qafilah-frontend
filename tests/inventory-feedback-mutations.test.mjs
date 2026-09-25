import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import ts from "typescript";
import {
  inventoryFeedbackSources,
  transformInventoryFeedbackSource,
} from "./inventory-feedback-mutations.mjs";

const path = inventoryFeedbackSources[1];
const inventoryImport =
  'import { ProductInventoryPanel } from "@/features/inventory/components/product-inventory-panel";';
const inventory =
  "<ProductInventoryPanel productReadPending={query.isFetching} productReadFailed={!!query.error} />";
const media = "<MediaPanel productReadFailed={!!query.error} />";
const fixture = (panel = inventory, imports = inventoryImport) => `${imports}
import { MediaPanel } from "@/features/media/components/media-panel";
export function render(query) { return <>${panel}${media}</>; }`;
const mutate = (source) =>
  transformInventoryFeedbackSource(source, path, "pending-refresh-failure");

// Execute tiny JSX fixtures with distinct component identities, rather than assert text matches.
function render(source, query) {
  const compiled = ts.transpileModule(source, {
    compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exports = {};
  const components = { ProductInventoryPanel: "inventory", MediaPanel: "media" };
  new Function("require", "exports", "React", compiled)(() => components, exports, {
    Fragment: "fragment",
    createElement: (type, props, ...children) => ({ type, props, children }),
  });
  return exports.render(query).children;
}

describe("Inventory feedback mutation targeting", () => {
  it("changes Inventory behavior while identical Media props, comments and strings stay intact", () => {
    const decoys = `// ${inventory}\nconst decoy = ${JSON.stringify(inventory)};\n`;
    const source = decoys + fixture();
    const mutated = mutate(source);
    expect(mutated).toContain(decoys);
    expect(mutated).toContain(media);
    const query = { error: null, isFetching: true };
    expect(render(source, query).map((node) => node.props.productReadFailed)).toEqual([
      false,
      false,
    ]);
    expect(render(mutated, query).map((node) => node.props.productReadFailed)).toEqual([
      true,
      false,
    ]);
    expect(
      render(mutated, { error: null, isFetching: false }).map(
        (node) => node.props.productReadFailed,
      ),
    ).toEqual([false, false]);
  });

  it("handles aliases, paired tags, reordered props and multiline equivalent expressions", () => {
    const source = fixture(
      `<Inventory
        productReadFailed={ /* read failure only */ Boolean(query.error) }
        productReadPending={
          query.isFetching === true
        }
      ></Inventory>`,
      inventoryImport.replace(
        "{ ProductInventoryPanel }",
        "{ ProductInventoryPanel as Inventory }",
      ),
    );
    expect(
      render(mutate(source), { error: null, isFetching: true }).map(
        (node) => node.props.productReadFailed,
      ),
    ).toEqual([true, false]);
  });

  it("resolves the import identity without mutating a same-named shadowed component", () => {
    const shadow = `function unrelated(ProductInventoryPanel, query) { return ${inventory}; }\n`;
    const result = mutate(shadow + fixture());
    expect(result).toContain(shadow);
    expect(render(result, { error: null, isFetching: true })[0].props.productReadFailed).toBe(true);
  });

  it("targets the current Product screen despite its legitimate second Media integration", () => {
    const source = readFileSync(path, "utf8").replaceAll("\r\n", "\n");
    const result = mutate(source);
    function panels(text) {
      const file = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      const matches = {};
      function visit(node) {
        if (
          ts.isJsxSelfClosingElement(node) &&
          ["ProductInventoryPanel", "MediaPanel"].includes(node.tagName.getText(file))
        )
          matches[node.tagName.getText(file)] = node.getText(file);
        ts.forEachChild(node, visit);
      }
      visit(file);
      return matches;
    }
    const before = panels(source);
    const after = panels(result);
    expect(after.MediaPanel).toBe(before.MediaPanel);
    expect(after.ProductInventoryPanel).not.toBe(before.ProductInventoryPanel);
    expect(after.ProductInventoryPanel).toContain("(!!query.error) || (query.isFetching)");
  });

  it.each([
    ["missing import", fixture(inventory, "")],
    ["type-only import", fixture(inventory, inventoryImport.replace("import {", "import type {"))],
    ["wrong module", fixture(inventory, inventoryImport.replace("/inventory/", "/media/"))],
    ["missing invocation", fixture("")],
    ["duplicate invocation", fixture(inventory + inventory)],
    [
      "shadowed-only invocation",
      `${inventoryImport}\nexport function render(ProductInventoryPanel, query) { return ${inventory}; }`,
    ],
    [
      "spread before props",
      fixture(inventory.replace("<ProductInventoryPanel ", "<ProductInventoryPanel {...other} ")),
    ],
    ["spread after props", fixture(inventory.replace(" />", " {...other} />"))],
    ["missing failure", fixture("<ProductInventoryPanel productReadPending={query.isFetching} />")],
    ["missing pending", fixture("<ProductInventoryPanel productReadFailed={!!query.error} />")],
    ["duplicate failure", fixture(inventory.replace(" />", " productReadFailed={false} />"))],
    ["duplicate pending", fixture(inventory.replace(" />", " productReadPending={false} />"))],
    ["string failure", fixture(inventory.replace("{!!query.error}", '"false"'))],
    [
      "bare failure",
      fixture(inventory.replace("productReadFailed={!!query.error}", "productReadFailed")),
    ],
    ["empty expression", fixture(inventory.replace("{!!query.error}", "{/* no expression */}"))],
    ["malformed syntax", fixture(inventory).replace("return <>", "return <")],
  ])(
    "fails closed for %s rather than crediting a broken harness as an operative RED",
    (_name, source) => {
      expect(() => mutate(source)).toThrow();
    },
  );
});
