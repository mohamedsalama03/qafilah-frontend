// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { inspectArchitecture, type ArchitectureRule } from "./architecture-policy";
const query = "src/features/media/queries.ts",
  mutation = "src/features/media/mutations.ts",
  component = "src/features/media/components/media-panel.tsx",
  registry = "src/lib/backend/contracts.ts";
describe("media executable architecture boundaries", () => {
  it.each([
    query,
    mutation,
    registry,
    "src/features/media/model.ts",
    "src/lib/media-url.ts",
    "src/lib/api/client.ts",
    "src/lib/backend/client.ts",
    "src/proxy.ts",
  ])("accepts pristine source %s", (file) =>
    expect(inspectArchitecture(file, readFileSync(file, "utf8"))).toEqual([]),
  );
  it.each([
    ["scope", 'storeKeys.resource(target, "media", target)'],
    ["complete target", 'storeKeys.resource(scope, "media", { productUuid: target.productUuid })'],
    [
      "kind",
      'storeKeys.resource(scope, "media", { productUuid: target.productUuid, variantUuid: target.variantUuid })',
    ],
    ["global key", '["media", target]'],
  ])("rejects operative key mutant removing %s", (_name, replacement) => {
    const source = readFileSync(query, "utf8");
    const mutant = source.replace('storeKeys.resource(scope, "media", target)', replacement);
    expect(mutant).not.toBe(source);
    expect(inspectArchitecture(query, mutant).map((item) => item.rule)).toContain(
      "media-query-isolation",
    );
  });
  it.each([
    "createProductMedia",
    "updateProductMedia",
    "deleteProductMedia",
    "createVariantMedia",
    "updateVariantMedia",
    "deleteVariantMedia",
  ])("requires scoped lifecycle and one dispatch site for %s", (method) => {
    expect(
      inspectArchitecture(component, `api.${method}(input);`).map((item) => item.rule),
    ).toContain("media-mutation-boundary");
    expect(inspectArchitecture(mutation, `api.${method}(input);`)).toEqual([]);
    expect(
      inspectArchitecture(mutation, `api.${method}(input); api.${method}(input);`).map(
        (item) => item.rule,
      ),
    ).toContain("media-mutation-retry");
  });
  it.each(["listProductMedia", "listVariantMedia"])(
    "requires scoped collection reads for %s",
    (method) => {
      expect(
        inspectArchitecture(component, `api.${method}(input);`).map((item) => item.rule),
      ).toContain("media-query-isolation");
      expect(inspectArchitecture(query, `api.${method}(input);`)).toEqual([]);
    },
  );
  it.each([
    ["retry policy", "media-mutation-retry", "useMutation({retry: 1, mutationFn:write});"],
    [
      "scheduled replay",
      "media-mutation-retry",
      "setTimeout(()=>api.createProductMedia(input),1);",
    ],
    ["unscoped publication", "media-mutation-isolation", "cache.setQueryData(['media'], data);"],
    [
      "unscoped invalidation",
      "media-mutation-isolation",
      "cache.invalidateQueries({queryKey:['media']});",
    ],
    [
      "missing scope",
      "media-mutation-isolation",
      "cache.setQueryData(mediaKeys.list(target), data);",
    ],
    [
      "discarded kind",
      "media-mutation-isolation",
      "cache.setQueryData(mediaKeys.list(scope, { productUuid }), data);",
    ],
    ["component FormData", "media-multipart-boundary", "const body = new FormData();"],
    [
      "manual boundary",
      "media-multipart-boundary",
      'headers.set("Content-Type", "multipart/form-data");',
    ],
    ["document URL resolution", "media-url-boundary", "new URL(media.url, document.origin);"],
    [
      "direct transport",
      "central-api-boundary",
      'fetch("/api/v1/media", {method:"POST", body:file});',
    ],
    ["role authority", "role-derived-authority", 'const canEdit = context.role.name === "Owner";'],
    ["persistent upload", "browser-persistence", 'localStorage.setItem("upload", file);'],
    [
      "persistent intent",
      "browser-persistence",
      'sessionStorage.setItem("media-attempt", JSON.stringify(intent));',
    ],
  ] as [string, ArchitectureRule, string][])("rejects %s", (_name, rule, source) =>
    expect(inspectArchitecture(mutation, source).map((item) => item.rule)).toContain(rule),
  );
  it.each([
    ["productMedia", "GET", "decodeProductMediaList", 200, ""],
    ["createProductMedia", "POST", "decodeProductMedia", 201, ""],
    ["updateProductMedia", "PATCH", "decodeProductMedia", 200, "/{value}"],
    ["deleteProductMedia", "DELETE", "decodeDeletedMedia", 204, "/{value}"],
    ["variantMedia", "GET", "decodeVariantMediaList", 200, ""],
    ["createVariantMedia", "POST", "decodeVariantMedia", 201, ""],
    ["updateVariantMedia", "PATCH", "decodeVariantMedia", 200, "/{value}"],
    ["deleteVariantMedia", "DELETE", "decodeDeletedMedia", 204, "/{value}"],
  ])(
    "requires strict response decoder and status for %s",
    (name, method, decoder, status, suffix) => {
      const path = `/api/v1/stores/{value}/catalog/products/{value}${String(name).toLowerCase().includes("variant") ? "/variants/{value}" : ""}/media${suffix}`;
      const source = `export const merchantContracts = { ${name}: { method: "${method}", successStatus: ${status}, path: () => "${path}", decode: payload => payload.data as Resource } };`;
      expect(inspectArchitecture(registry, source).map((item) => item.rule)).toContain(
        "media-response-boundary",
      );
      expect(
        inspectArchitecture(
          registry,
          source
            .replace("payload => payload.data as Resource", String(decoder))
            .replace(`successStatus: ${status}`, "successStatus: 202"),
        ).map((item) => item.rule),
      ).toContain("media-response-boundary");
    },
  );
  it.each(["Product", "Variant"])("requires explicit central multipart for %s uploads", (kind) => {
    const source = `export const merchantContracts={create${kind}Media:{method:"POST",successStatus:201,path:()=>"/api/v1/stores/{value}/catalog/products/{value}${kind === "Variant" ? "/variants/{value}" : ""}/media",body:input=>input.data,decode:decode${kind}Media}};`;
    expect(inspectArchitecture(registry, source).map((item) => item.rule)).toContain(
      "media-multipart-boundary",
    );
  });
  it.each([
    "pricing",
    "upload-url",
    "presigned",
    "media-library",
    "media/bulk",
    "media/attach",
    "media/reorder",
  ])("rejects deferred %s route", (suffix) => {
    const source = `export const merchantContracts={productMedia:{method:"GET",successStatus:200,path:()=>"/api/v1/stores/{value}/catalog/products/{value}/${suffix}",decode:decodeProductMediaList}};`;
    expect(inspectArchitecture(registry, source).map((item) => item.rule)).toContain(
      "verified-contract-registry",
    );
  });
  it("accepts scoped publication and executable comment/string decoys", () => {
    expect(
      inspectArchitecture(
        mutation,
        `
      cache.setQueryData(mediaKeys.list(scope,target),collection);
      cache.invalidateQueries({queryKey:productKeys.detail(scope,productUuid)});
      // setTimeout(()=>api.createProductMedia(input),1); localStorage.setItem("upload",file);
      const copy="new URL(media.url, document.origin); retry: true;";
    `,
      ),
    ).toEqual([]);
  });
});
