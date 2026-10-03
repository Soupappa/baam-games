import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validateManifest } from "./manifest-contract.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

for (const file of ["asymmetric-war", "Doctrine Engine", "NinjaWorms", "SpiderVsAnts"]) {
  const manifest = JSON.parse(await readFile(join(root, "..", file, "baam.json"), "utf8"));
  assert.doesNotThrow(() => validateManifest(manifest, manifest.id));
}

const validVideo = {
  schemaVersion: 1,
  id: "video-test",
  title: "Video Test",
  summary: "Une boucle de gameplay.",
  type: "game",
  status: "preview",
  territories: ["games"],
  url: "https://video.games.baam.pro/",
  updatedAt: "2026-10-03",
  tags: ["test"],
  relations: [],
  preview: {
    type: "video",
    poster: "https://video.games.baam.pro/preview.webp",
    width: 1280,
    height: 720,
    alt: "Une partie en cours.",
    sources: [
      { url: "https://video.games.baam.pro/preview.webm", type: "video/webm" },
      { url: "https://video.games.baam.pro/preview.mp4", type: "video/mp4" }
    ]
  }
};

assert.doesNotThrow(() => validateManifest(validVideo, validVideo.id));
assert.throws(
  () => validateManifest({ ...validVideo, preview: { ...validVideo.preview, poster: null } }, validVideo.id),
  /preview.poster est requis/
);
assert.throws(
  () => validateManifest({ ...validVideo, preview: { ...validVideo.preview, sources: [{ url: "https://video.games.baam.pro/preview.mov", type: "video\/quicktime" }] } }, validVideo.id),
  /video\/webm ou video\/mp4/
);

console.log("Tests réussis : manifests actuels valides, contrat vidéo accepté, variantes invalides refusées.");
