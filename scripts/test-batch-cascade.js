import assert from "node:assert/strict";
import {
  DEFAULT_BATCH_WINDOW_MS,
  getBatchWindowMs,
  getDeploySource,
  hasValidBatchToken,
  queueBatchedBuild
} from "./batch-cascade-core.js";

function createStore() {
  let entry = null;
  let version = 0;

  return {
    async set(_key, data, options = {}) {
      if (options.onlyIfMatch && entry?.etag !== options.onlyIfMatch) {
        return { modified: false };
      }
      version += 1;
      entry = {
        data,
        metadata: options.metadata,
        etag: `etag-${version}`
      };
      return { modified: true, etag: entry.etag };
    },
    async getWithMetadata() {
      return entry ? { ...entry } : null;
    }
  };
}

assert.equal(getBatchWindowMs(), DEFAULT_BATCH_WINDOW_MS);
assert.equal(getBatchWindowMs("120000"), 120000);
assert.throws(() => getBatchWindowMs("999"));
assert.equal(hasValidBatchToken("https://games.baam.pro/api?token=secret", "secret"), true);
assert.equal(hasValidBatchToken("https://games.baam.pro/api?token=wrong", "secret"), false);
assert.equal(getDeploySource({ name: "baam-ninja-worms" }), "baam-ninja-worms");

const store = createStore();
const sleepers = [];
const wait = () => new Promise((resolve) => sleepers.push(resolve));
const requests = [];
const fetchFn = async (_url, options) => {
  requests.push(JSON.parse(options.body));
  return new Response(null, { status: 200 });
};

const first = queueBatchedBuild({
  store,
  batchId: "first",
  source: "asym",
  buildHook: "https://example.test/build",
  batchWindowMs: 1_000,
  fetchFn,
  wait
});

while (sleepers.length < 1) await Promise.resolve();

const second = queueBatchedBuild({
  store,
  batchId: "second",
  source: "ninja",
  buildHook: "https://example.test/build",
  batchWindowMs: 1_000,
  fetchFn,
  wait
});

while (sleepers.length < 2) await Promise.resolve();

sleepers[0]();
assert.deepEqual(await first, { triggered: false, reason: "superseded" });
sleepers[1]();
assert.deepEqual(await second, { triggered: true, recorded: true });
assert.equal(requests.length, 1);
assert.equal(requests[0].queuedBy, "ninja");

console.log("Test réussi : plusieurs déploiements proches déclenchent un seul build Games.");
