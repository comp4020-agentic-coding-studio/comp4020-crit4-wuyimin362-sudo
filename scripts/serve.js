#!/usr/bin/env node
// Minimal zero-dependency static server for local viewing. Serves the repo
// root, so what you look at is the source, not a build artefact.
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";

const PORT = Number(process.argv[2] ?? 4173);
/** @type {Record<string, string>} */
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  let path = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, "");
  if (path.endsWith("/")) path = join(path, "index.html");
  const file = join(process.cwd(), path);
  try {
    const info = await stat(file);
    if (!info.isFile()) throw new Error("not a file");
    // Content-Length matters more than it looks: without it the response is
    // close-delimited, Chrome cannot reuse the connection, and every
    // subresource pays a fresh handshake. Measuring a throttled load against a
    // server that does this measures the server, not the page.
    res.writeHead(200, {
      "content-type": TYPES[extname(file)] ?? "application/octet-stream",
      "content-length": info.size,
      "cache-control": "no-store",
    });
    createReadStream(file).pipe(res);
  } catch {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("404");
  }
}).listen(PORT, () => console.log(`serving ${process.cwd()} at http://localhost:${PORT}/`));
