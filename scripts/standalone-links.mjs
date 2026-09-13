import { lstat, readdir, readlink, realpath, stat, symlink, unlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Next's Windows tracer can emit file symlinks for pnpm package directories.
 * Recreate only generated, internally resolved directory links as junctions.
 * Source node_modules and anything outside this standalone artifact stay untouched.
 */
export async function repairStandaloneLinks(directoryUrl, platform = process.platform) {
  if (platform !== "win32") return;
  const root = await realpath(fileURLToPath(directoryUrl));
  const isInside = (target) => {
    const relative = path.relative(root, target);
    return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
  };
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const location = path.resolve(directory, entry.name);
      if (!isInside(location)) throw new Error("Standalone path escaped its output directory.");
      if (entry.isSymbolicLink()) {
        const target = path.resolve(directory, await readlink(location));
        if (!isInside(target))
          throw new Error("Standalone link points outside its output directory.");
        const resolved = await realpath(target);
        if (!isInside(resolved))
          throw new Error("Standalone link resolves outside its output directory.");
        if ((await stat(resolved)).isDirectory()) {
          // unlink removes the link itself; it never recursively removes the target.
          if (!(await lstat(location)).isSymbolicLink())
            throw new Error("Standalone link changed during preparation.");
          await unlink(location);
          await symlink(resolved, location, "junction");
        }
      } else if (entry.isDirectory()) {
        await visit(location);
      }
    }
  }
  await visit(root);
}
