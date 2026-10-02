import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";

const root = join(process.cwd(), "public");
const port = 8090;
const types = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8",
  ".webp": "image/webp"
};

createServer((request, response) => {
  const rawPath = decodeURIComponent((request.url || "/").split("?")[0]);
  const requested = rawPath === "/" ? "/index.html" : rawPath;
  const clean = normalize(requested).replace(/^(\.\.[/\\])+/, "");
  let file = join(root, clean);

  if (!file.startsWith(root) || !existsSync(file) || statSync(file).isDirectory()) {
    file = join(root, "index.html");
  }

  response.writeHead(200, {
    "Content-Type": types[extname(file).toLowerCase()] || "application/octet-stream",
    "Cache-Control": extname(file) === ".html" ? "no-cache" : "public, max-age=60"
  });
  createReadStream(file).pipe(response);
}).listen(port, "127.0.0.1", () => {
  console.log(`BAAM.Games : http://127.0.0.1:${port}/`);
});

