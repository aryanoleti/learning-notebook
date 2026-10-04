/* Minimal static server for local previews: node tools/serve.mjs [port] */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.argv[2] || process.env.PORT || 4410);
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml" };

createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^([/\\])+/, "");
  const file = join(root, path || "index.html");
  if (!file.startsWith(root)) return res.writeHead(403).end();
  try {
    const body = await readFile(file.endsWith("\\") || file.endsWith("/") ? join(file, "index.html") : file);
    res.writeHead(200, { "content-type": types[extname(file)] || "application/octet-stream", "cache-control": "no-store" }).end(body);
  } catch {
    res.writeHead(404).end("Not found");
  }
}).listen(port, () => console.log(`Serving ${root} on http://localhost:${port}`));
