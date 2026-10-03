const arena = document.querySelector("#physics-arena");
const layer = document.querySelector("#card-layer");
const template = document.querySelector("#game-card-template");
const arenaCanvas = document.querySelector("#arena-canvas");
const arenaContext = arenaCanvas.getContext("2d");
const seedControl = document.querySelector("#seed-control");
const seedValue = document.querySelector("#seed-value");
const gravityControl = document.querySelector("#gravity-control");
const gravityValue = document.querySelector("#gravity-value");
const soundControl = document.querySelector("#sound-control");
const soundValue = document.querySelector("#sound-value");
const motionControl = document.querySelector("#motion-control");
const motionLabel = document.querySelector("#motion-label");
const motionValue = document.querySelector("#motion-value");
const speedMeter = document.querySelector("#speed-meter");
const speedValue = document.querySelector("#speed-value");
const speedFill = document.querySelector("#speed-fill");
const buildStatus = document.querySelector("#build-status");
const worldLayer = document.querySelector("#world-layer");

const typeLabels = {
  "game": "Jeu numérique",
  "game-engine": "Moteur de jeu",
  "board-game": "Jeu de plateau"
};

const statusLabels = {
  "public": "Jouable",
  "preview": "Preview",
  "prototype": "Prototype",
  "active": "Actif"
};

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const saveData = Boolean(navigator.connection?.saveData);
const gravityLevels = [0.2, 0.65, 1, 1.8, 3.2];
let gravityLevel = 2;
let pointerGravity = 0;
let gravityVectorX = 0;
let gravityVectorY = 1;
let worldAngle = 0;
let worldTurning = false;
let lastCycleFrame = performance.now();
let rotationSpeed = 1;
let targetRotationSpeed = 1;
let wheelFlashTimer = 0;
let bodies = [];
let links = [];
let sparks = [];
let activeDrag = null;
let lastFrame = performance.now();
let arenaWidth = 1;
let arenaHeight = 1;
let random = Math.random;
let currentSeed = getInitialSeed();
let audioContext = null;
let soundEnabled = localStorage.getItem("baam-games-sound") !== "off";
let isPaused = false;
let pausedAt = 0;
let accumulatedPause = 0;
const bodyByNode = new WeakMap();

function getInitialSeed() {
  const fromUrl = Number(new URLSearchParams(location.search).get("seed"));
  if (Number.isInteger(fromUrl) && fromUrl > 0) return fromUrl >>> 0;
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  return values[0] || 2026;
}

function mulberry32(seed) {
  return function seededRandom() {
    let value = seed += 0x6D2B79F5;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}

function rand(min, max) {
  return min + random() * (max - min);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function updateWorldCycle(time) {
  if (reducedMotion) {
    worldAngle = 0;
    worldTurning = false;
    lastCycleFrame = time;
  } else {
    const rotationDuration = 96000;
    const elapsed = clamp(time - lastCycleFrame, 0, 64);
    lastCycleFrame = time;
    const easing = 1 - Math.exp(-elapsed / 220);
    rotationSpeed += (targetRotationSpeed - rotationSpeed) * easing;
    worldAngle = (worldAngle + elapsed / rotationDuration * Math.PI * 2 * rotationSpeed) % (Math.PI * 2);
    worldTurning = rotationSpeed > 0.01;
  }

  // The frame rotates, not gravity. Transforming this local vector through the
  // frame rotation always produces the same screen vector: straight down.
  gravityVectorX = Math.sin(worldAngle);
  gravityVectorY = Math.cos(worldAngle);
  worldLayer.style.transform = `translate(-50%, -50%) rotate(${worldAngle}rad)`;
}

function cardSize(index, open = false) {
  if (open) {
    return {
      width: Math.min(arenaWidth - 28, arenaWidth < 720 ? 430 : 610),
      height: arenaWidth < 720 ? 405 : 390
    };
  }
  const widthBias = [24, -8, 9, -18][index % 4];
  const heightBias = [12, -5, 4, -9][index % 4];
  return {
    width: Math.min(arenaWidth - 24, (arenaWidth < 560 ? 265 : 310) + widthBias),
    height: (arenaWidth < 560 ? 174 : 196) + heightBias
  };
}

function createLink(item, label, disabled = false) {
  if (disabled) {
    const span = document.createElement("span");
    span.className = "card-link is-disabled";
    span.textContent = label;
    return span;
  }
  const anchor = document.createElement("a");
  anchor.className = "card-link";
  anchor.href = item;
  anchor.target = "_blank";
  anchor.rel = "noreferrer";
  anchor.textContent = label;
  return anchor;
}

function createVideoPreview(item, node) {
  if (item.preview?.type !== "video") return null;
  const container = node.querySelector(".card-preview");
  const video = document.createElement("video");
  video.className = "card-preview-video";
  video.poster = item.preview.poster;
  video.muted = true;
  video.autoplay = true;
  video.loop = true;
  video.playsInline = true;
  video.preload = "none";
  video.setAttribute("muted", "");
  video.setAttribute("playsinline", "");
  video.setAttribute("role", "img");
  video.setAttribute("aria-label", item.preview.alt);
  if (!reducedMotion && !saveData) {
    for (const media of item.preview.sources || []) {
      const source = document.createElement("source");
      source.src = media.url;
      source.type = media.type;
      video.append(source);
    }
  }
  container.append(video);
  node.classList.add("has-video-preview");
  return video;
}

function syncPreviewPlayback(body) {
  if (!body.video) return;
  const shouldPlay = body.open
    && body.inViewport
    && !reducedMotion
    && !saveData
    && !isPaused
    && document.visibilityState === "visible";
  if (!shouldPlay) {
    body.video.pause();
    return;
  }
  const playback = body.video.play();
  if (playback) playback.catch(() => {});
}

const previewObserver = "IntersectionObserver" in window
  ? new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const body = bodyByNode.get(entry.target);
        if (!body) continue;
        body.inViewport = entry.isIntersecting && entry.intersectionRatio >= 0.2;
        syncPreviewPlayback(body);
      }
    }, { threshold: [0, 0.2, 0.6] })
  : null;

function createBody(item, index) {
  const node = template.content.firstElementChild.cloneNode(true);
  const accent = item.presentation?.accent || "#dfff00";
  const initial = cardSize(index);
  node.dataset.game = item.id;
  node.style.setProperty("--accent", accent);
  node.setAttribute("aria-label", `Ouvrir ${item.title}`);
  node.querySelector(".card-index").textContent = item.presentation?.index || String(index + 1).padStart(2, "0");
  node.querySelector(".card-status").textContent = statusLabels[item.status] || item.status;
  node.querySelector(".card-type").textContent = typeLabels[item.type] || item.type;
  node.querySelector(".card-title").textContent = item.title;
  node.querySelector(".card-summary").textContent = item.summary;

  const tags = node.querySelector(".card-tags");
  for (const tag of item.tags || []) {
    const chip = document.createElement("span");
    chip.textContent = tag;
    tags.append(chip);
  }

  const linksNode = node.querySelector(".card-links");
  const localHost = location.hostname === "127.0.0.1" || location.hostname === "localhost";
  if (item.url) linksNode.append(createLink(item.url, "Jouer ↗"));
  else if (localHost && item.localUrl) linksNode.append(createLink(item.localUrl, "Lancer local ↗"));
  else linksNode.append(createLink("", "Bientôt jouable", true));

  const body = {
    id: item.id,
    item,
    index,
    node,
    interfaceNode: node.querySelector(".card-interface"),
    canvas: node.querySelector(".card-sim"),
    context: node.querySelector(".card-sim").getContext("2d"),
    x: arenaWidth * (0.2 + index * 0.19),
    y: -130 - index * 185,
    w: initial.width,
    h: initial.height,
    targetW: initial.width,
    targetH: initial.height,
    vx: rand(-90, 90),
    vy: rand(-10, 35),
    angle: rand(-0.18, 0.18),
    av: rand(-0.34, 0.34),
    mass: 1,
    open: false,
    dragging: false,
    sleeping: false,
    supported: false,
    restTime: 0,
    entered: false,
    visualSeed: Math.floor(random() * 100000),
    lastImpact: 0,
    video: createVideoPreview(item, node),
    inViewport: previewObserver == null
  };
  bodyByNode.set(node, body);
  updateMass(body);
  bindCard(body);
  layer.append(node);
  previewObserver?.observe(node);
  syncPreviewPlayback(body);
  return body;
}

function updateMass(body) {
  body.mass = Math.max(0.8, (body.w * body.h) / 56000);
}

function wake(body, impulse = 0) {
  body.sleeping = false;
  body.restTime = 0;
  if (impulse) body.vy -= impulse;
}

function getAudioContext() {
  if (!audioContext) {
    const Context = window.AudioContext || window.webkitAudioContext;
    if (!Context) return null;
    audioContext = new Context();
  }
  if (audioContext.state === "suspended") audioContext.resume();
  return audioContext;
}

function playCardSound(opening) {
  if (!soundEnabled) return;
  const context = getAudioContext();
  if (!context) return;
  const now = context.currentTime;
  const master = context.createGain();
  master.gain.setValueAtTime(0.0001, now);
  master.gain.exponentialRampToValueAtTime(opening ? 0.075 : 0.09, now + 0.008);
  master.gain.exponentialRampToValueAtTime(0.0001, now + (opening ? 0.22 : 0.14));
  master.connect(context.destination);

  const tone = context.createOscillator();
  tone.type = opening ? "triangle" : "square";
  tone.frequency.setValueAtTime(opening ? 115 : 215, now);
  tone.frequency.exponentialRampToValueAtTime(opening ? 245 : 82, now + (opening ? 0.2 : 0.11));
  const toneGain = context.createGain();
  toneGain.gain.setValueAtTime(0.7, now);
  toneGain.gain.exponentialRampToValueAtTime(0.03, now + (opening ? 0.2 : 0.11));
  tone.connect(toneGain).connect(master);
  tone.start(now);
  tone.stop(now + 0.23);

  const noiseLength = Math.floor(context.sampleRate * 0.055);
  const noiseBuffer = context.createBuffer(1, noiseLength, context.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  for (let index = 0; index < noiseLength; index += 1) {
    data[index] = (Math.random() * 2 - 1) * (1 - index / noiseLength);
  }
  const noise = context.createBufferSource();
  noise.buffer = noiseBuffer;
  const filter = context.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = opening ? 820 : 460;
  filter.Q.value = 1.4;
  const noiseGain = context.createGain();
  noiseGain.gain.value = opening ? 0.34 : 0.48;
  noise.connect(filter).connect(noiseGain).connect(master);
  noise.start(now + (opening ? 0.025 : 0));
}

function bindCard(body) {
  const close = body.node.querySelector(".card-close");
  close.addEventListener("pointerdown", (event) => event.stopPropagation());
  close.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleCard(body, false);
  });

  body.node.addEventListener("keydown", (event) => {
    if (event.target.closest("a, button")) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      toggleCard(body);
    }
  });

  body.node.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || event.target.closest("a, button")) return;
    event.preventDefault();
    const point = arenaPoint(event);
    activeDrag = {
      body,
      pointerId: event.pointerId,
      offsetX: point.x - body.x,
      offsetY: point.y - body.y,
      startX: event.clientX,
      startY: event.clientY,
      lastX: point.x,
      lastY: point.y,
      lastTime: performance.now(),
      moved: false
    };
    body.dragging = true;
    wake(body);
    body.vx = 0;
    body.vy = 0;
    body.node.classList.add("is-dragging");
    body.node.style.zIndex = "40";
    body.node.setPointerCapture(event.pointerId);
  });

  body.node.addEventListener("pointermove", (event) => {
    if (!activeDrag || activeDrag.body !== body || activeDrag.pointerId !== event.pointerId) return;
    const point = arenaPoint(event);
    const now = performance.now();
    const dt = Math.max(0.008, (now - activeDrag.lastTime) / 1000);
    const nextX = point.x - activeDrag.offsetX;
    const nextY = point.y - activeDrag.offsetY;
    body.vx = (nextX - body.x) / dt;
    body.vy = (nextY - body.y) / dt;
    body.av += (point.x - activeDrag.lastX) * 0.00045;
    body.x = nextX;
    body.y = nextY;
    activeDrag.lastX = point.x;
    activeDrag.lastY = point.y;
    activeDrag.lastTime = now;
    if (Math.hypot(event.clientX - activeDrag.startX, event.clientY - activeDrag.startY) > 7) {
      activeDrag.moved = true;
    }
  });

  const release = (event) => {
    if (!activeDrag || activeDrag.body !== body || activeDrag.pointerId !== event.pointerId) return;
    const wasMoved = activeDrag.moved;
    body.dragging = false;
    body.node.classList.remove("is-dragging");
    body.node.style.zIndex = body.open ? "20" : String(5 + body.index);
    activeDrag = null;
    if (!wasMoved) toggleCard(body);
  };
  body.node.addEventListener("pointerup", release);
  body.node.addEventListener("pointercancel", release);
}

function arenaPoint(event) {
  const rect = worldLayer.getBoundingClientRect();
  const dx = event.clientX - (rect.left + rect.width / 2);
  const dy = event.clientY - (rect.top + rect.height / 2);
  const cosine = Math.cos(worldAngle);
  const sine = Math.sin(worldAngle);
  return {
    x: arenaWidth / 2 + cosine * dx + sine * dy,
    y: arenaHeight / 2 - sine * dx + cosine * dy
  };
}

function toggleCard(body, force) {
  body.open = force ?? !body.open;
  playCardSound(body.open);
  const size = cardSize(body.index, body.open);
  body.targetW = size.width;
  body.targetH = size.height;
  body.node.classList.toggle("is-open", body.open);
  body.node.setAttribute("aria-expanded", String(body.open));
  body.node.setAttribute("aria-label", `${body.open ? "Refermer" : "Ouvrir"} ${body.item.title}`);
  body.node.style.zIndex = body.open ? "20" : String(5 + body.index);
  body.vy -= body.open ? 430 : 160;
  body.vx += rand(-90, 90);
  body.av += rand(-0.32, 0.32);
  wake(body);
  links = links.filter((link) => link.a !== body && link.b !== body);
  syncPreviewPlayback(body);
  if (reducedMotion) layoutReduced();
}

function rotatedExtents(body) {
  const cosine = Math.abs(Math.cos(body.angle));
  const sine = Math.abs(Math.sin(body.angle));
  return {
    x: cosine * body.w / 2 + sine * body.h / 2,
    y: sine * body.w / 2 + cosine * body.h / 2
  };
}

function solveBounds(body) {
  const extents = rotatedExtents(body);
  const left = 10 + extents.x;
  const right = arenaWidth - 10 - extents.x;
  const top = 5 + extents.y;
  const bottom = arenaHeight - 10 - extents.y;
  const bounce = (speed, supporting) => {
    if (speed < 90) return 0;
    if (supporting) return speed > 420 ? 0.19 : speed > 180 ? 0.1 : 0.03;
    return speed > 320 ? 0.16 : 0.08;
  };

  if (body.x < left) {
    const speed = Math.max(0, -body.vx);
    const supporting = gravityVectorX < -0.36;
    body.x = left;
    if (body.vx < 0) body.vx = speed * bounce(speed, supporting);
    if (supporting) {
      body.supported = true;
      body.vy *= 0.82;
      body.av *= 0.52;
    } else {
      body.vy *= 0.96;
      body.av *= 0.74;
    }
    body.av += Math.abs(body.vy) * 0.00005;
    impact(body.x - extents.x, body.y, body, speed);
  } else if (body.x > right) {
    const speed = Math.max(0, body.vx);
    const supporting = gravityVectorX > 0.36;
    body.x = right;
    if (body.vx > 0) body.vx = -speed * bounce(speed, supporting);
    if (supporting) {
      body.supported = true;
      body.vy *= 0.82;
      body.av *= 0.52;
    } else {
      body.vy *= 0.96;
      body.av *= 0.74;
    }
    body.av -= Math.abs(body.vy) * 0.00005;
    impact(body.x + extents.x, body.y, body, speed);
  }

  if (body.y > bottom) {
    const speed = Math.max(0, body.vy);
    const supporting = gravityVectorY > 0.36;
    body.y = bottom;
    if (body.vy > 0) body.vy = -speed * bounce(speed, supporting);
    if (supporting) {
      body.supported = true;
      body.vx *= 0.82;
      body.av *= 0.52;
    } else {
      body.vx *= 0.96;
      body.av *= 0.74;
    }
    impact(body.x, body.y + extents.y, body, speed);
  }
  if (body.entered && body.y < top) {
    const speed = Math.max(0, -body.vy);
    const supporting = gravityVectorY < -0.36;
    body.y = top;
    if (body.vy < 0) body.vy = speed * bounce(speed, supporting);
    if (supporting) {
      body.supported = true;
      body.vx *= 0.82;
      body.av *= 0.52;
    } else {
      body.vx *= 0.96;
      body.av *= 0.74;
    }
    impact(body.x, body.y - extents.y, body, speed);
  }
}

function solvePair(a, b) {
  if (a.dragging && b.dragging) return;
  const ea = rotatedExtents(a);
  const eb = rotatedExtents(b);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const overlapX = ea.x + eb.x - Math.abs(dx);
  const overlapY = ea.y + eb.y - Math.abs(dy);
  if (overlapX <= 0 || overlapY <= 0) return;

  let nx = 0;
  let ny = 0;
  let overlap = 0;

  if (overlapY < overlapX) {
    ny = dy >= 0 ? 1 : -1;
    overlap = overlapY;
  } else {
    nx = dx >= 0 ? 1 : -1;
    overlap = overlapX;
  }

  const normalAlongGravity = nx * gravityVectorX + ny * gravityVectorY;
  if (normalAlongGravity > 0.48) a.supported = true;
  if (normalAlongGravity < -0.48) b.supported = true;

  const relative = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
  if (Math.abs(relative) > 90) {
    if (a.sleeping) wake(a);
    if (b.sleeping) wake(b);
  }
  const invA = a.dragging || a.sleeping ? 0 : 1 / a.mass;
  const invB = b.dragging || b.sleeping ? 0 : 1 / b.mass;
  const invTotal = invA + invB;
  if (!invTotal) return;

  const correction = Math.max(0, overlap - 0.8) * 0.76;
  a.x -= nx * correction * invA / invTotal;
  a.y -= ny * correction * invA / invTotal;
  b.x += nx * correction * invB / invTotal;
  b.y += ny * correction * invB / invTotal;

  if (relative < 0) {
    const restitution = Math.abs(relative) > 280 ? 0.2 : Math.abs(relative) > 120 ? 0.1 : 0.03;
    const impulseValue = -(1 + restitution) * relative / invTotal;
    const ix = impulseValue * nx;
    const iy = impulseValue * ny;
    a.vx -= ix * invA;
    a.vy -= iy * invA;
    b.vx += ix * invB;
    b.vy += iy * invB;

    const tx = -ny;
    const ty = nx;
    const tangentSpeed = (b.vx - a.vx) * tx + (b.vy - a.vy) * ty;
    const frictionLimit = Math.abs(impulseValue) * 0.22;
    const frictionImpulse = clamp(-tangentSpeed / invTotal, -frictionLimit, frictionLimit);
    a.vx -= tx * frictionImpulse * invA;
    a.vy -= ty * frictionImpulse * invA;
    b.vx += tx * frictionImpulse * invB;
    b.vy += ty * frictionImpulse * invB;
    if (Math.abs(relative) > 105) impact((a.x + b.x) / 2, (a.y + b.y) / 2, a, Math.abs(relative));
  }

  if (!a.open && !b.open && links.length < 2 && Math.abs(relative) < 24 && random() < 0.002) {
    const exists = links.some((link) => (link.a === a && link.b === b) || (link.a === b && link.b === a));
    if (!exists) links.push({ a, b, rest: Math.hypot(dx, dy), phase: rand(0, Math.PI * 2) });
  }
}

function applyLinks(dt, time) {
  links = links.filter((link) => {
    const dx = link.b.x - link.a.x;
    const dy = link.b.y - link.a.y;
    const distance = Math.hypot(dx, dy) || 1;
    if (distance > link.rest * 1.85 || link.a.open || link.b.open) return false;
    const stretch = distance - link.rest;
    const pulse = 1 + Math.sin(time * 0.002 + link.phase) * 0.08;
    const force = stretch * 10 * pulse;
    const nx = dx / distance;
    const ny = dy / distance;
    if (!link.a.dragging && !link.a.sleeping) {
      link.a.vx += nx * force / link.a.mass * dt;
      link.a.vy += ny * force / link.a.mass * dt;
    }
    if (!link.b.dragging && !link.b.sleeping) {
      link.b.vx -= nx * force / link.b.mass * dt;
      link.b.vy -= ny * force / link.b.mass * dt;
    }
    return true;
  });
}

function impact(x, y, body, speed) {
  const now = performance.now();
  if (speed < 90 || now - body.lastImpact < 100) return;
  body.lastImpact = now;
  const count = Math.min(7, 2 + Math.floor(speed / 130));
  for (let index = 0; index < count; index += 1) {
    sparks.push({
      x, y,
      vx: rand(-95, 95),
      vy: rand(-115, 35),
      life: rand(0.25, 0.62),
      size: rand(2, 6),
      color: body.item.presentation?.accent || "#dfff00"
    });
  }
  if (sparks.length > 90) sparks.splice(0, sparks.length - 90);
}

function updatePhysics(dt, time) {
  const steps = 3;
  const step = Math.min(dt, 0.04) / steps;
  for (let pass = 0; pass < steps; pass += 1) {
    for (const body of bodies) body.supported = false;
    applyLinks(step, time);
    for (const body of bodies) {
      body.w += (body.targetW - body.w) * Math.min(1, step * 10);
      body.h += (body.targetH - body.h) * Math.min(1, step * 10);
      updateMass(body);
      if (!body.dragging && !body.sleeping) {
        const gravityForce = 1180 * gravityLevels[gravityLevel];
        // Mouse influence also remains screen-horizontal while the frame turns.
        const pointerX = Math.cos(worldAngle) * pointerGravity;
        const pointerY = -Math.sin(worldAngle) * pointerGravity;
        body.vx += (gravityVectorX * gravityForce + pointerX) * step;
        body.vy += (gravityVectorY * gravityForce + pointerY) * step;
        const ballastStrength = body.open ? 9.5 : 6.8;
        const ballastError = Math.atan2(Math.sin(body.angle), Math.cos(body.angle));
        body.av += -ballastError * ballastStrength * step;
        body.x += body.vx * step;
        body.y += body.vy * step;
        body.angle += body.av * step;
        body.angle = Math.atan2(Math.sin(body.angle), Math.cos(body.angle));
        if (body.y > 0) body.entered = true;
        body.vx *= 0.994;
        body.vy *= 0.999;
        body.av *= body.open ? 0.965 : 0.978;
        body.vx = clamp(body.vx, -1600, 1600);
        body.vy = clamp(body.vy, -1600, 1600);
        body.av = clamp(body.av, -7, 7);
      }
      solveBounds(body);
    }
    for (let iteration = 0; iteration < 5; iteration += 1) {
      for (let i = 0; i < bodies.length; i += 1) {
        for (let j = i + 1; j < bodies.length; j += 1) solvePair(bodies[i], bodies[j]);
      }
      for (const body of bodies) solveBounds(body);
    }
  }

  for (const body of bodies) {
    if (body.dragging || body.sleeping) continue;
    const speed = Math.hypot(body.vx, body.vy);
    const uprightError = Math.abs(Math.atan2(Math.sin(body.angle), Math.cos(body.angle)));
    const settled = !worldTurning && body.supported && speed < 16 && Math.abs(body.av) < 0.07 && uprightError < 0.045;
    if (settled) {
      body.restTime += dt;
      body.vx *= 0.72;
      body.vy *= 0.5;
      body.av *= 0.58;
      body.angle *= Math.max(0, 1 - dt * 6);
      if (body.restTime > 0.58) {
        body.sleeping = true;
        body.x = Math.round(body.x * 2) / 2;
        body.y = Math.round(body.y * 2) / 2;
        body.angle = 0;
        body.vx = 0;
        body.vy = 0;
        body.av = 0;
      }
    } else {
      body.restTime = 0;
    }
  }
}

function renderBodies(time) {
  const interfaceQuarter = Math.round(worldAngle / (Math.PI / 2));
  const interfaceAngle = -interfaceQuarter * Math.PI / 2;
  const interfaceIsVertical = Math.abs(interfaceQuarter) % 2 === 1;
  for (const body of bodies) {
    body.node.style.width = `${body.w}px`;
    body.node.style.height = `${body.h}px`;
    body.node.style.transform = `translate3d(${body.x - body.w / 2}px, ${body.y - body.h / 2}px, 0) rotate(${body.angle}rad)`;
    body.interfaceNode.style.width = `${interfaceIsVertical ? body.h : body.w}px`;
    body.interfaceNode.style.height = `${interfaceIsVertical ? body.w : body.h}px`;
    body.interfaceNode.style.setProperty("--interface-angle", `${interfaceAngle}rad`);
    drawCardSimulation(body, time);
  }
}

function resizeMiniCanvas(body) {
  const ratio = Math.min(1.5, window.devicePixelRatio || 1);
  const width = Math.max(1, Math.round(body.w * ratio));
  const height = Math.max(1, Math.round(body.h * ratio));
  if (Math.abs(body.canvas.width - width) > 4 || Math.abs(body.canvas.height - height) > 4) {
    body.canvas.width = width;
    body.canvas.height = height;
  }
  body.context.setTransform(ratio, 0, 0, ratio, 0, 0);
}

function drawCardSimulation(body, time) {
  resizeMiniCanvas(body);
  const context = body.context;
  const w = body.w;
  const h = body.h;
  context.clearRect(0, 0, w, h);
  context.lineCap = "square";
  context.lineJoin = "miter";
  if (body.id === "asymmetric-wars") drawFronts(context, w, h, time, body.visualSeed);
  if (body.id === "doctrine-engine") drawDoctrine(context, w, h, time, body.visualSeed);
  if (body.id === "ninja-worms") drawRope(context, w, h, time, body.visualSeed);
  if (body.id === "spider-vs-ants") drawWeb(context, w, h, time, body.visualSeed);
}

function drawFronts(context, w, h, time, seed) {
  context.strokeStyle = "rgba(10,10,10,.58)";
  context.lineWidth = 2;
  const phase = time * 0.00045 + seed;
  for (let row = 0; row < 8; row += 1) {
    context.beginPath();
    for (let x = -10; x <= w + 10; x += 12) {
      const y = h * 0.14 + row * h * 0.1 + Math.sin(x * 0.024 + phase + row * 0.7) * (8 + row * 1.5);
      if (x === -10) context.moveTo(x, y);
      else context.lineTo(x, y);
    }
    context.stroke();
  }
  context.fillStyle = "rgba(242,240,233,.88)";
  for (let index = 0; index < 22; index += 1) {
    const x = (index * 79 + seed * 0.13 + time * 0.025 * (index % 2 ? 1 : -1)) % (w + 30) - 15;
    const y = h * (0.18 + ((index * 37) % 70) / 100);
    context.fillRect(x, y, 3 + index % 3, 3 + index % 3);
  }
}

function drawDoctrine(context, w, h, time, seed) {
  const phase = time * 0.0007;
  const points = [];
  for (let index = 0; index < 24; index += 1) {
    const ring = 24 + (index % 6) * 17;
    const angle = index * 2.399 + phase * (index % 2 ? 1 : -0.7) + seed;
    points.push({ x: w * 0.63 + Math.cos(angle) * ring, y: h * 0.48 + Math.sin(angle) * ring * 0.58 });
  }
  context.strokeStyle = "rgba(8,8,8,.28)";
  context.lineWidth = 1;
  for (let index = 0; index < points.length; index += 1) {
    const target = points[(index * 5 + 7) % points.length];
    context.beginPath();
    context.moveTo(points[index].x, points[index].y);
    context.lineTo(target.x, target.y);
    context.stroke();
  }
  context.fillStyle = "rgba(8,8,8,.85)";
  points.forEach((point, index) => context.fillRect(point.x - 2, point.y - 2, index % 4 === 0 ? 8 : 4, index % 4 === 0 ? 8 : 4));
}

function drawRope(context, w, h, time, seed) {
  const phase = time * 0.0012 + seed;
  context.fillStyle = "rgba(8,8,8,.78)";
  context.beginPath();
  context.moveTo(0, h * 0.74);
  for (let x = 0; x <= w; x += 12) {
    context.lineTo(x, h * 0.72 + Math.sin(x * 0.045 + seed) * 13 + Math.sin(x * 0.011) * 19);
  }
  context.lineTo(w, h);
  context.lineTo(0, h);
  context.closePath();
  context.fill();
  const wormX = w * (0.42 + Math.sin(phase * 0.7) * 0.08);
  const wormY = h * 0.55 + Math.sin(phase) * 11;
  const hookX = w * (0.75 + Math.cos(phase * 0.6) * 0.08);
  const hookY = h * 0.19 + Math.sin(phase * 0.8) * 9;
  context.strokeStyle = "rgba(242,240,233,.9)";
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(wormX, wormY);
  context.quadraticCurveTo((wormX + hookX) / 2, h * 0.05, hookX, hookY);
  context.stroke();
  context.fillStyle = "rgba(242,240,233,.95)";
  context.fillRect(wormX - 5, wormY - 4, 12, 8);
  context.strokeRect(hookX - 4, hookY - 4, 8, 8);
}

function drawWeb(context, w, h, time, seed) {
  const centerX = w * 0.7;
  const centerY = h * 0.44;
  const pulse = 1 + Math.sin(time * 0.0018 + seed) * 0.035;
  context.strokeStyle = "rgba(8,8,8,.42)";
  context.lineWidth = 1.3;
  for (let spoke = 0; spoke < 12; spoke += 1) {
    const angle = spoke / 12 * Math.PI * 2;
    context.beginPath();
    context.moveTo(centerX, centerY);
    context.lineTo(centerX + Math.cos(angle) * w * 0.44, centerY + Math.sin(angle) * h * 0.7);
    context.stroke();
  }
  for (let ring = 1; ring <= 5; ring += 1) {
    context.beginPath();
    for (let spoke = 0; spoke <= 12; spoke += 1) {
      const angle = spoke / 12 * Math.PI * 2;
      const radiusX = ring * w * 0.075 * pulse;
      const radiusY = ring * h * 0.105 * pulse;
      const x = centerX + Math.cos(angle) * radiusX;
      const y = centerY + Math.sin(angle) * radiusY;
      if (spoke === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    }
    context.stroke();
  }
  context.fillStyle = "rgba(242,240,233,.86)";
  for (let ant = 0; ant < 9; ant += 1) {
    const progress = (time * 0.000035 * (1 + ant % 3) + ant * 0.13 + seed * 0.001) % 1;
    const x = w * progress;
    const y = h * (0.2 + (ant * 0.097) % 0.66) + Math.sin(progress * 14 + ant) * 8;
    context.fillRect(x, y, 5, 3);
  }
}

function drawArena(dt) {
  const ratio = Math.min(1.5, window.devicePixelRatio || 1);
  if (arenaCanvas.width !== Math.round(arenaWidth * ratio) || arenaCanvas.height !== Math.round(arenaHeight * ratio)) {
    arenaCanvas.width = Math.round(arenaWidth * ratio);
    arenaCanvas.height = Math.round(arenaHeight * ratio);
  }
  arenaContext.setTransform(ratio, 0, 0, ratio, 0, 0);
  arenaContext.clearRect(0, 0, arenaWidth, arenaHeight);
  const boundaryGlow = [
    { alpha: Math.max(0, gravityVectorY), x1: 10, y1: arenaHeight - 10, x2: arenaWidth - 10, y2: arenaHeight - 10 },
    { alpha: Math.max(0, gravityVectorX), x1: arenaWidth - 10, y1: 5, x2: arenaWidth - 10, y2: arenaHeight - 10 },
    { alpha: Math.max(0, -gravityVectorY), x1: 10, y1: 5, x2: arenaWidth - 10, y2: 5 },
    { alpha: Math.max(0, -gravityVectorX), x1: 10, y1: 5, x2: 10, y2: arenaHeight - 10 }
  ];
  arenaContext.save();
  arenaContext.lineCap = "square";
  for (const boundary of boundaryGlow) {
    if (boundary.alpha < 0.015) continue;
    arenaContext.globalAlpha = 0.24 + boundary.alpha * 0.7;
    arenaContext.strokeStyle = boundary.alpha > 0.72 ? "#dfff00" : "#ff5038";
    arenaContext.lineWidth = 1.5 + boundary.alpha * 3;
    arenaContext.shadowColor = arenaContext.strokeStyle;
    arenaContext.shadowBlur = 7 + boundary.alpha * 9;
    arenaContext.beginPath();
    arenaContext.moveTo(boundary.x1, boundary.y1);
    arenaContext.lineTo(boundary.x2, boundary.y2);
    arenaContext.stroke();
  }
  arenaContext.restore();
  arenaContext.save();
  arenaContext.setLineDash([3, 6]);
  for (const link of links) {
    arenaContext.strokeStyle = "rgba(223,255,0,.62)";
    arenaContext.lineWidth = 1;
    arenaContext.beginPath();
    arenaContext.moveTo(link.a.x, link.a.y);
    arenaContext.lineTo(link.b.x, link.b.y);
    arenaContext.stroke();
    arenaContext.fillStyle = "#dfff00";
    arenaContext.fillRect((link.a.x + link.b.x) / 2 - 2, (link.a.y + link.b.y) / 2 - 2, 4, 4);
  }
  arenaContext.restore();

  sparks = sparks.filter((spark) => {
    spark.life -= dt;
    if (spark.life <= 0) return false;
    spark.vy += 260 * dt;
    spark.x += spark.vx * dt;
    spark.y += spark.vy * dt;
    arenaContext.globalAlpha = Math.min(1, spark.life * 2.4);
    arenaContext.fillStyle = spark.color;
    arenaContext.fillRect(spark.x, spark.y, spark.size, spark.size);
    return true;
  });
  arenaContext.globalAlpha = 1;
}

function frame(time) {
  const dt = isPaused ? 0 : Math.min(0.045, (time - lastFrame) / 1000 || 0.016);
  lastFrame = time;
  if (!isPaused) {
    updateWorldCycle(time);
    if (!reducedMotion) updatePhysics(dt, time);
  }
  const visualTime = (isPaused ? pausedAt : time) - accumulatedPause;
  renderBodies(visualTime);
  drawArena(dt);
  requestAnimationFrame(frame);
}

function reset(seed = currentSeed) {
  currentSeed = seed >>> 0 || 1;
  random = mulberry32(currentSeed);
  seedValue.textContent = String(currentSeed % 10000).padStart(4, "0");
  const url = new URL(location.href);
  url.searchParams.set("seed", currentSeed);
  history.replaceState(null, "", url);
  links = [];
  sparks = [];
  lastCycleFrame = performance.now();
  worldAngle = 0;
  worldTurning = false;
  gravityVectorX = 0;
  gravityVectorY = 1;
  worldLayer.style.transform = "translate(-50%, -50%) rotate(0rad)";
  accumulatedPause = 0;
  if (isPaused) pausedAt = lastCycleFrame;
  bodies.forEach((body, index) => {
    const size = cardSize(index, body.open);
    body.w = size.width;
    body.h = size.height;
    body.targetW = size.width;
    body.targetH = size.height;
    body.x = arenaWidth * (0.16 + random() * 0.68);
    body.y = -120 - index * rand(145, 230);
    body.vx = rand(-120, 120);
    body.vy = rand(0, 42);
    body.angle = rand(-0.22, 0.22);
    body.av = rand(-0.5, 0.5);
    body.sleeping = false;
    body.supported = false;
    body.restTime = 0;
    body.entered = false;
    body.visualSeed = Math.floor(random() * 100000);
  });
  if (reducedMotion) layoutReduced();
}

function layoutReduced() {
  const gap = 14;
  const columns = arenaWidth > 760 ? 2 : 1;
  bodies.forEach((body, index) => {
    const size = cardSize(index, body.open);
    body.w = body.targetW = size.width;
    body.h = body.targetH = size.height;
    body.angle = 0;
    body.x = columns === 2
      ? arenaWidth * (index % 2 ? 0.7 : 0.3)
      : arenaWidth / 2;
    const row = columns === 2 ? Math.floor(index / 2) : index;
    body.y = 320 + row * (body.h + gap);
  });
}

function resize() {
  arenaWidth = worldLayer.clientWidth;
  arenaHeight = worldLayer.clientHeight;
  for (const body of bodies) {
    const size = cardSize(body.index, body.open);
    body.targetW = size.width;
    body.targetH = size.height;
    body.x = Math.min(arenaWidth - 20, Math.max(20, body.x));
  }
  if (reducedMotion) layoutReduced();
}

arena.addEventListener("pointermove", (event) => {
  if (activeDrag) return;
  const rect = arena.getBoundingClientRect();
  pointerGravity = ((event.clientX - rect.left) / rect.width - 0.5) * 260;
});

arena.addEventListener("pointerleave", () => {
  if (!activeDrag) pointerGravity = 0;
});

gravityControl.addEventListener("click", () => {
  gravityLevel = (gravityLevel + 1) % gravityLevels.length;
  gravityValue.textContent = `×${gravityLevels[gravityLevel].toFixed(2).replace(/0$/, "")}`;
  for (const body of bodies) {
    wake(body);
    body.vx -= gravityVectorX * 75;
    body.vy -= gravityVectorY * 75;
  }
});

function renderSpeedMeter() {
  const normalized = (targetRotationSpeed - 0.1) / 4.9;
  speedValue.textContent = `×${targetRotationSpeed.toFixed(2)}`;
  speedFill.style.transform = `scaleX(${clamp(normalized, 0, 1)})`;
  speedMeter.setAttribute("aria-label", `Vitesse de rotation : fois ${targetRotationSpeed.toFixed(2)}`);
}

function nudgeRotationSpeed(deltaY) {
  if (!Number.isFinite(deltaY) || deltaY === 0 || reducedMotion) return;
  const impulse = Math.sign(deltaY) * Math.min(0.5, Math.max(0.05, Math.abs(deltaY) * 0.0025));
  targetRotationSpeed = Math.round(clamp(targetRotationSpeed + impulse, 0.1, 5) * 100) / 100;
  renderSpeedMeter();
  speedMeter.classList.add("is-changing");
  window.clearTimeout(wheelFlashTimer);
  wheelFlashTimer = window.setTimeout(() => speedMeter.classList.remove("is-changing"), 320);
}

window.addEventListener("wheel", (event) => {
  if (event.ctrlKey) return;
  event.preventDefault();
  nudgeRotationSpeed(event.deltaY);
}, { passive: false });

function renderSoundControl() {
  soundControl.setAttribute("aria-pressed", String(soundEnabled));
  soundControl.setAttribute("aria-label", soundEnabled ? "Couper les sons" : "Activer les sons");
  soundValue.textContent = soundEnabled ? "ON" : "OFF";
}

soundControl.addEventListener("click", () => {
  soundEnabled = !soundEnabled;
  localStorage.setItem("baam-games-sound", soundEnabled ? "on" : "off");
  renderSoundControl();
  if (soundEnabled) playCardSound(true);
});

function renderMotionControl() {
  motionControl.setAttribute("aria-pressed", String(isPaused));
  motionControl.setAttribute("aria-label", isPaused ? "Relancer le jeu" : "Mettre le jeu en pause");
  motionLabel.textContent = isPaused ? "PLAY" : "PAUSE";
  motionValue.textContent = isPaused ? "▶" : "Ⅱ";
}

motionControl.addEventListener("click", () => {
  const now = performance.now();
  if (isPaused) {
    accumulatedPause += now - pausedAt;
    lastCycleFrame = now;
    lastFrame = now;
    isPaused = false;
  } else {
    pausedAt = now;
    isPaused = true;
  }
  renderMotionControl();
  bodies.forEach(syncPreviewPlayback);
});

document.addEventListener("visibilitychange", () => bodies.forEach(syncPreviewPlayback));

seedControl.addEventListener("click", () => {
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  reset(values[0]);
});

window.addEventListener("resize", resize);
renderSoundControl();
renderMotionControl();
renderSpeedMeter();

async function boot() {
  resize();
  try {
    const response = await fetch("/data/registry.json", { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const registry = await response.json();
    random = mulberry32(currentSeed);
    bodies = registry.assets.map(createBody);
    buildStatus.textContent = `REGISTRE VIVANT · ${bodies.length} SOURCES`;
    reset(currentSeed);
    requestAnimationFrame(frame);
  } catch (error) {
    buildStatus.textContent = "REGISTRE HORS LIGNE";
    document.querySelector(".live-dot").style.background = "#ff5038";
    console.error(error);
  }
}

boot();
