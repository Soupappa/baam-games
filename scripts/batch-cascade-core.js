const BATCH_KEY = "games";
export const DEFAULT_BATCH_WINDOW_MS = 5 * 60 * 1000;

export function getBatchWindowMs(rawValue) {
  if (rawValue === undefined || rawValue === "") return DEFAULT_BATCH_WINDOW_MS;

  const value = Number(rawValue);
  if (!Number.isFinite(value) || value < 1_000 || value > 15 * 60 * 1000) {
    throw new Error("BAAM_BATCH_WINDOW_MS doit être compris entre 1000 et 900000 ms.");
  }

  return Math.round(value);
}

export function hasValidBatchToken(requestUrl, expectedToken) {
  if (!expectedToken) return false;
  const suppliedToken = new URL(requestUrl).searchParams.get("token");
  return suppliedToken === expectedToken;
}

export function getDeploySource(payload) {
  const candidate = payload?.name || payload?.site_name || payload?.url || "unknown-game";
  return String(candidate).slice(0, 160);
}

export async function queueBatchedBuild({
  store,
  batchId,
  source,
  buildHook,
  batchWindowMs = DEFAULT_BATCH_WINDOW_MS,
  fetchFn = fetch,
  wait = (delay) => new Promise((resolve) => setTimeout(resolve, delay)),
  now = () => Date.now()
}) {
  if (!buildHook) throw new Error("BAAM_GAMES_BUILD_HOOK non configuré.");

  const queuedAt = now();
  await store.set(BATCH_KEY, batchId, {
    metadata: { status: "queued", source, queuedAt }
  });

  await wait(batchWindowMs);

  const pending = await store.getWithMetadata(BATCH_KEY, {
    consistency: "strong",
    type: "text"
  });

  if (!pending || pending.data !== batchId || pending.metadata?.status !== "queued") {
    return { triggered: false, reason: "superseded" };
  }

  const response = await fetchFn(buildHook, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ source: "baam-games-batch", queuedBy: source, queuedAt })
  });

  if (!response.ok) throw new Error(`Build hook Games en échec : HTTP ${response.status}`);

  const update = await store.set(BATCH_KEY, batchId, {
    metadata: {
      status: "triggered",
      source,
      queuedAt,
      triggeredAt: now()
    },
    onlyIfMatch: pending.etag
  });

  return { triggered: true, recorded: update.modified === true };
}
