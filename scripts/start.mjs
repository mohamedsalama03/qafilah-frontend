import { access, cp } from "node:fs/promises";
import { repairStandaloneLinks } from "./standalone-links.mjs";

const portFlag = process.argv.indexOf("--port");
const port = portFlag === -1 ? (process.env.PORT ?? "3411") : process.argv[portFlag + 1];
if (!port || !/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
  throw new Error("Provide a valid application port.");
}

const standalone = new URL("../.next/standalone/", import.meta.url);
const server = new URL("server.js", standalone);
try {
  await access(server);
} catch {
  throw new Error("Production output is absent. Run pnpm build before pnpm start.");
}

// Next's standalone artifact omits static assets by design; package the generated
// local output exactly as the production Docker image does. No source is modified.
await cp(new URL("../public/", import.meta.url), new URL("public/", standalone), {
  recursive: true,
  force: true,
});
await cp(new URL("../.next/static/", import.meta.url), new URL(".next/static/", standalone), {
  recursive: true,
  force: true,
});
await repairStandaloneLinks(standalone);
process.env.PORT = port;
process.env.HOSTNAME = process.env.HOSTNAME || "127.0.0.1";
process.env.NEXT_TELEMETRY_DISABLED = "1";
await import(server.href);
