import { randomUUID } from "node:crypto";
import { getStore } from "@netlify/blobs";
import {
  getBatchWindowMs,
  getDeploySource,
  hasValidBatchToken,
  queueBatchedBuild
} from "../../scripts/batch-cascade-core.js";

export default async function queueGamesRebuild(request) {
  if (request.method !== "POST") return;

  if (!hasValidBatchToken(request.url, process.env.BAAM_BATCH_TOKEN)) {
    console.warn("Cascade Games refusée : jeton absent ou invalide.");
    return;
  }

  let payload = {};
  try {
    payload = await request.json();
  } catch {
    // Le contenu de la notification n'est pas requis pour regrouper les builds.
  }

  const source = getDeploySource(payload);
  const store = getStore({ name: "baam-publish-batches", consistency: "strong" });
  const result = await queueBatchedBuild({
    store,
    batchId: randomUUID(),
    source,
    buildHook: process.env.BAAM_GAMES_BUILD_HOOK,
    batchWindowMs: getBatchWindowMs(process.env.BAAM_BATCH_WINDOW_MS)
  });

  if (result.triggered) {
    console.log(`Lot Games déclenché après la fenêtre de regroupement (${source}).`);
  } else {
    console.log(`Notification ${source} absorbée par un lot plus récent.`);
  }
}

export const config = {
  background: true,
  path: "/api/queue-games-rebuild"
};
