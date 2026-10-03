const hook = process.env.BAAM_DOWNSTREAM_BUILD_HOOK;
const required = process.env.BAAM_DOWNSTREAM_REQUIRED === "true";

if (!hook) {
  console.log("Cascade BAAM inactive : BAAM_DOWNSTREAM_BUILD_HOOK non configuré.");
  process.exit(0);
}

try {
  const response = await fetch(hook, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ source: "baam-games", builtAt: new Date().toISOString() })
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  console.log("Cascade BAAM déclenchée : reconstruction de BAAM.pro demandée.");
} catch (error) {
  console.error(`Cascade BAAM en échec : ${error.message}`);
  if (required) process.exitCode = 1;
}
