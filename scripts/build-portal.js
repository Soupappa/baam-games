import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const root = resolve(scriptDir, "..");
const publicDir = join(root, "public");
const config = JSON.parse(await readFile(join(root, "portal.config.json"), "utf8"));
const checkOnly = process.argv.includes("--check");

const relationVocabulary = {
  "uses": "used-by",
  "used-by": "uses",
  "inspired-by": "inspires",
  "inspires": "inspired-by",
  "derived-from": "has-derivative",
  "has-derivative": "derived-from",
  "part-of": "has-part",
  "has-part": "part-of",
  "related-to": "related-to"
};

function validate(manifest, expectedId) {
  const errors = [];
  const required = ["schemaVersion", "id", "title", "summary", "type", "status", "territories", "updatedAt"];
  for (const field of required) {
    if (manifest[field] === undefined || manifest[field] === null || manifest[field] === "") {
      errors.push(`champ requis absent : ${field}`);
    }
  }
  if (manifest.id !== expectedId) errors.push(`id ${manifest.id} différent de ${expectedId}`);
  if (!Array.isArray(manifest.territories) || !manifest.territories.includes("games")) {
    errors.push("territories doit contenir games");
  }
  if (!Array.isArray(manifest.tags)) errors.push("tags doit être un tableau");
  if (!Array.isArray(manifest.relations)) errors.push("relations doit être un tableau");
  for (const relation of manifest.relations || []) {
    if (!relationVocabulary[relation.type]) errors.push(`relation inconnue : ${relation.type}`);
    if (!relation.target) errors.push("une relation n'a pas de cible");
  }
  if (errors.length) throw new Error(`${expectedId} : ${errors.join(" ; ")}`);
}

async function fromFile(path) {
  const absolute = isAbsolute(path) ? path : resolve(root, path);
  return JSON.parse(await readFile(absolute, "utf8"));
}

async function fromRemote(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3500);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function loadSource(source) {
  const attempts = [];
  if (source.file) attempts.push(["local", () => fromFile(source.file)]);
  if (source.url) attempts.push(["remote", () => fromRemote(source.url)]);
  if (source.cache) attempts.push(["cache", () => fromFile(source.cache)]);

  for (const [origin, load] of attempts) {
    try {
      const manifest = await load();
      validate(manifest, source.id);
      return { manifest, origin };
    } catch (error) {
      console.warn(`[${source.id}] ${origin} indisponible : ${error.message}`);
    }
  }
  throw new Error(`${source.id} : aucune source valide`);
}

function uniqueRelations(relations) {
  const seen = new Set();
  return relations.filter((relation) => {
    const key = `${relation.type}:${relation.target}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const loaded = [];
for (const source of config.sources) {
  const result = await loadSource(source);
  loaded.push({ ...result.manifest, sourceOrigin: result.origin });
  if (!checkOnly && source.cache && result.origin !== "cache") {
    const cachePath = resolve(root, source.cache);
    await mkdir(dirname(cachePath), { recursive: true });
    await writeFile(cachePath, `${JSON.stringify(result.manifest, null, 2)}\n`);
  }
}

const byId = new Map(loaded.map((item) => [item.id, item]));
for (const item of loaded) {
  item.relations = uniqueRelations(item.relations || []);
  for (const relation of item.relations) {
    const target = byId.get(relation.target);
    if (!target) throw new Error(`${item.id} pointe vers une cible absente : ${relation.target}`);
    const inverse = { type: relationVocabulary[relation.type], target: item.id, inferred: true };
    target.relations = uniqueRelations([...(target.relations || []), inverse]);
  }
}

const rank = new Map(config.featured.map((id, index) => [id, index]));
loaded.sort((a, b) => (rank.get(a.id) ?? 999) - (rank.get(b.id) ?? 999));

const latestContentDate = loaded
  .map((item) => item.updatedAt)
  .sort()
  .at(-1) || "1970-01-01";
const builtAt = process.env.BAAM_BUILD_TIME || `${latestContentDate}T00:00:00.000Z`;
const registry = {
  schemaVersion: 1,
  builtAt,
  territory: config.territory,
  assets: loaded
};

const graph = {
  schemaVersion: 1,
  builtAt,
  nodes: loaded.map(({ id, title, summary, type, status, territories, url, repository, updatedAt, tags, preview, presentation }) => ({
    id, title, summary, type, status, territories, url, repository, updatedAt, tags, preview, presentation
  })),
  edges: loaded.flatMap((item) => (item.relations || []).map((relation) => ({
    source: item.id,
    target: relation.target,
    type: relation.type,
    inferred: Boolean(relation.inferred)
  })))
};

const graphLd = {
  "@context": {
    "@vocab": "https://schema.org/",
    "baam": "https://baam.pro/ns#",
    "relationType": "baam:relationType"
  },
  "@graph": loaded.map((item) => ({
    "@id": item.url || `${config.territory.url}#${item.id}`,
    "@type": item.type === "board-game" ? "Game" : "SoftwareApplication",
    "name": item.title,
    "description": item.summary,
    "dateModified": item.updatedAt,
    "keywords": item.tags,
    "isPartOf": { "@id": config.territory.url, "name": config.territory.title },
    "baam:relations": (item.relations || []).map((relation) => ({
      "@id": byId.get(relation.target)?.url || `${config.territory.url}#${relation.target}`,
      "relationType": relation.type
    }))
  }))
};

const portalManifest = {
  schemaVersion: 1,
  id: "baam-games",
  title: "BAAM.GAMES",
  summary: config.territory.summary,
  type: "territory",
  status: "public",
  territories: ["games"],
  url: config.territory.url,
  updatedAt: builtAt.slice(0, 10),
  tags: ["games", "portal", "physics"],
  relations: loaded.map((item) => ({ type: "has-part", target: item.id }))
};

if (checkOnly) {
  console.log(`OK — ${loaded.length} manifestes, ${graph.edges.length} relations compilées.`);
  process.exit(0);
}

await mkdir(join(publicDir, "data"), { recursive: true });
await mkdir(join(publicDir, ".well-known"), { recursive: true });
await writeFile(join(publicDir, "data", "registry.json"), `${JSON.stringify(registry, null, 2)}\n`);
await writeFile(join(publicDir, "data", "graph.json"), `${JSON.stringify(graph, null, 2)}\n`);
await writeFile(join(publicDir, "data", "graph.jsonld"), `${JSON.stringify(graphLd, null, 2)}\n`);
await writeFile(join(publicDir, ".well-known", "baam.json"), `${JSON.stringify(portalManifest, null, 2)}\n`);
await writeFile(join(publicDir, "sitemap.xml"), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>${config.territory.url}</loc><lastmod>${builtAt.slice(0, 10)}</lastmod></url>\n</urlset>\n`);

console.log(`BAAM.GAMES compilé — ${loaded.length} jeux, ${graph.edges.length} relations.`);
