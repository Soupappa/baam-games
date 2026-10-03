import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
let received = null;
let resolveRequest;
const requestReceived = new Promise((resolve) => { resolveRequest = resolve; });
const server = createServer((request, response) => {
  let body = "";
  request.setEncoding("utf8");
  request.on("data", (chunk) => { body += chunk; });
  request.on("end", () => {
    received = { method: request.method, body: JSON.parse(body) };
    response.writeHead(200).end("ok");
    resolveRequest();
  });
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
const child = spawn(process.execPath, [join(scriptDir, "trigger-downstream.js")], {
  env: {
    ...process.env,
    BAAM_DOWNSTREAM_BUILD_HOOK: `http://127.0.0.1:${address.port}/build`,
    BAAM_DOWNSTREAM_REQUIRED: "true"
  },
  stdio: ["ignore", "pipe", "pipe"]
});
let stderr = "";
child.stderr.on("data", (chunk) => { stderr += chunk; });
const exitCode = await new Promise((resolve) => child.on("close", resolve));
await requestReceived;
await new Promise((resolve) => server.close(resolve));

assert.strictEqual(exitCode, 0, stderr);
assert.strictEqual(received.method, "POST");
assert.strictEqual(received.body.source, "baam-games");
assert.match(received.body.builtAt, /^\d{4}-\d{2}-\d{2}T/);
console.log("Test réussi : le hook descendant reçoit la demande de reconstruction.");
