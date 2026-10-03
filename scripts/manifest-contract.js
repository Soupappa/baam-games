const previewTypes = new Set(["none", "iframe", "svg", "image", "video"]);
const videoTypes = new Set(["video/webm", "video/mp4"]);
const publicStatuses = new Set(["preview", "public", "archived"]);

export const relationVocabulary = Object.freeze({
  "uses": "used-by",
  "used-by": "uses",
  "inspired-by": "inspires",
  "inspires": "inspired-by",
  "derived-from": "has-derivative",
  "has-derivative": "derived-from",
  "part-of": "has-part",
  "has-part": "part-of",
  "related-to": "related-to"
});

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isHttpUrl(value) {
  if (typeof value !== "string") return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function isPreviewUrl(value) {
  return typeof value === "string" && (value.startsWith("/") || isHttpUrl(value));
}

function validatePreview(preview, errors) {
  if (!isObject(preview)) {
    errors.push("preview doit être un objet");
    return;
  }
  if (!previewTypes.has(preview.type)) {
    errors.push(`preview.type inconnu : ${preview.type}`);
    return;
  }
  if (preview.type === "none") return;
  if (preview.type !== "video") {
    if (!isPreviewUrl(preview.url)) errors.push("preview.url doit être une URL HTTP(S) ou un chemin racine");
    return;
  }

  if (!isPreviewUrl(preview.poster)) errors.push("preview.poster est requis pour une vidéo");
  if (typeof preview.alt !== "string" || !preview.alt.trim()) errors.push("preview.alt est requis pour une vidéo");
  if (!Number.isInteger(preview.width) || preview.width <= 0) errors.push("preview.width doit être un entier positif");
  if (!Number.isInteger(preview.height) || preview.height <= 0) errors.push("preview.height doit être un entier positif");
  if (!Array.isArray(preview.sources) || preview.sources.length === 0) {
    errors.push("preview.sources doit contenir au moins une source vidéo");
    return;
  }
  const seenTypes = new Set();
  preview.sources.forEach((source, index) => {
    if (!isObject(source)) {
      errors.push(`preview.sources[${index}] doit être un objet`);
      return;
    }
    if (!videoTypes.has(source.type)) errors.push(`preview.sources[${index}].type doit être video/webm ou video/mp4`);
    if (!isPreviewUrl(source.url)) errors.push(`preview.sources[${index}].url doit être une URL HTTP(S) ou un chemin racine`);
    if (seenTypes.has(source.type)) errors.push(`preview.sources répète le format ${source.type}`);
    seenTypes.add(source.type);
  });
}

export function validateManifest(manifest, expectedId) {
  const errors = [];
  const required = ["schemaVersion", "id", "title", "summary", "type", "status", "territories", "updatedAt"];
  for (const field of required) {
    if (manifest[field] === undefined || manifest[field] === null || manifest[field] === "") {
      errors.push(`champ requis absent : ${field}`);
    }
  }
  if (manifest.schemaVersion !== 1) errors.push("schemaVersion doit valoir 1");
  if (manifest.id !== expectedId) errors.push(`id ${manifest.id} différent de ${expectedId}`);
  if (!publicStatuses.has(manifest.status)) errors.push(`statut public inconnu : ${manifest.status}`);
  if (!Array.isArray(manifest.territories) || !manifest.territories.includes("games")) {
    errors.push("territories doit contenir games");
  }
  if (manifest.url != null && !isHttpUrl(manifest.url)) errors.push("url doit être une URL HTTP(S)");
  if (manifest.status === "public" && !isHttpUrl(manifest.url)) errors.push("un jeu public doit avoir une URL");
  if (!Array.isArray(manifest.tags)) errors.push("tags doit être un tableau");
  if (!Array.isArray(manifest.relations)) errors.push("relations doit être un tableau");
  if (manifest.preview != null) validatePreview(manifest.preview, errors);
  for (const relation of manifest.relations || []) {
    if (!relationVocabulary[relation.type]) errors.push(`relation inconnue : ${relation.type}`);
    if (!relation.target) errors.push("une relation n'a pas de cible");
  }
  if (errors.length) throw new Error(`${expectedId} : ${errors.join(" ; ")}`);
}
