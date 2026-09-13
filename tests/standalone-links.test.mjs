// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, realpath, rm, stat, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { repairStandaloneLinks } from "../scripts/standalone-links.mjs";

const roots = [];
const artifactRoot = path.resolve("artifacts");
async function fixture() {
  await mkdir(artifactRoot, { recursive: true });
  const parent = await mkdtemp(path.join(artifactRoot, "link-test-"));
  roots.push(parent);
  const root = path.join(parent, "standalone");
  await mkdir(root);
  return { parent, root, url: pathToFileURL(`${root}${path.sep}`) };
}

afterEach(async () => {
  for (const root of roots.splice(0)) {
    const resolved = await realpath(root);
    const relative = path.relative(artifactRoot, resolved);
    if (relative.startsWith("..") || path.isAbsolute(relative))
      throw new Error("Invalid test cleanup path.");
    await rm(resolved, { recursive: true, force: true });
  }
});

describe("standalone packaging directory-link safety", () => {
  it("repairs a traced directory link without changing package contents", async () => {
    const { root, url } = await fixture();
    const target = path.join(root, "package");
    await mkdir(target);
    await writeFile(path.join(target, "sentinel.txt"), "preserved");
    const link = path.join(root, "dependency");
    await symlink("package", link, "file");
    await repairStandaloneLinks(url, "win32");
    expect((await stat(link)).isDirectory()).toBe(true);
    expect(await readFile(path.join(link, "sentinel.txt"), "utf8")).toBe("preserved");
  });

  it("refuses a link outside the generated artifact and leaves its target intact", async () => {
    const { parent, root, url } = await fixture();
    const outside = path.join(parent, "source-package");
    await mkdir(outside);
    await writeFile(path.join(outside, "sentinel.txt"), "source-preserved");
    await symlink(outside, path.join(root, "escape"), "junction");
    await expect(repairStandaloneLinks(url, "win32")).rejects.toThrow(
      "outside its output directory",
    );
    expect(await readFile(path.join(outside, "sentinel.txt"), "utf8")).toBe("source-preserved");
  });
});
