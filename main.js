const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");

const startButton = document.getElementById("startButton");
const overlay = document.getElementById("overlay");
const overlayButton = document.getElementById("overlayButton");
const overlayMessage = document.getElementById("overlayMessage");
const statusBadge = document.getElementById("statusBadge");
const playerNameInput = document.getElementById("playerNameInput");
const shopButton = document.getElementById("shopButton");
const shopPanel = document.getElementById("shopPanel");
const closeShop = document.getElementById("closeShop");
const shopItemsEl = document.getElementById("shopItems");
const menuToggle = document.getElementById("menuToggle");
const mobileLevel = document.getElementById("mobileLevel");
const mobileLoot = document.getElementById("mobileLoot");
const mobileCrocs = document.getElementById("mobileCrocs");
const mobileShopButton = document.getElementById("mobileShopButton");

const levelDisplay = document.getElementById("levelDisplay");
const pelletDisplay = document.getElementById("pelletDisplay");
const crocDisplay = document.getElementById("crocDisplay");
const everDisplay = document.getElementById("everDisplay");
const activeDisplay = document.getElementById("activeDisplay");

const keys = new Set();
let boardWidth = 960;
let boardHeight = 640;
let player;
let npcs = [];
let pellets = [];
let rocks = [];
let chests = [];
let running = false;
let lastTime = 0;
let camera = { x: 0, y: 0 };
let zoom = 1;
let pelletBank = 0;
let everPlayers = 0;
let sessionCounted = false;
let menuOpen = false;

const BASE_RADIUS = 12;
const RADIUS_PER_LEVEL = 0.6; // wider very slowly
const MAX_RADIUS = 80; // desktop visual cap
const BASE_LENGTH = 40;
const LENGTH_PER_LEVEL = 10;
const MAX_EXTRA_LENGTH = 220;
const MAX_LENGTH_LEVEL = 30;
const START_LEVEL = 3;
const HEAD_RADIUS = BASE_RADIUS + START_LEVEL * RADIUS_PER_LEVEL; // lock head/body size to level 3
const HEAD_LENGTH = BASE_LENGTH + START_LEVEL * LENGTH_PER_LEVEL; // visual head/body length stays constant
const PLAYER_SPEED = 255; // 1.5x baseline
const NPC_SPEED = 188; // 1.5x baseline
const SPEED_FALLOFF = 0; // no slowdown on growth
const PELLET_SIZE = 12;
const TARGET_PELLETS = 26;
const TARGET_NPCS = 10;
const TARGET_ROCKS = 8;
const TARGET_CHESTS = 2;
const WORLD_WIDTH = 4800;
const WORLD_HEIGHT = 3200;
const MIN_ZOOM = 0.45;
const MAX_ZOOM = 1.4;
const ROCK_VALUE = 3;
const EVER_KEY = "crocyEverPlayers";

class Croc {
  constructor(x, y, level, color, isPlayer = false, name = "Croc", pattern = "Plain", accessory = null) {
    this.x = x;
    this.y = y;
    this.level = level;
    this.color = color;
    this.isPlayer = isPlayer;
    this.name = name;
    this.pattern = pattern;
    this.accessory = accessory;
    this.effect = null;
    this.hueOffset = Math.random() * 360;
    this.vx = 1;
    this.vy = 0;
    this.dead = false;
    this.wanderTimer = randomRange(1.2, 3.6);
    this.radius = calcRadius(level);
    this.length = calcLength(level);
    this.trail = [];
    this.initTrail();
  }

  maxSpeed() {
    const base = this.isPlayer ? PLAYER_SPEED : NPC_SPEED;
    return base; // no slowdown with growth
  }

  consume(amount) {
    const maxLevel = this.isPlayer ? Infinity : (player ? player.level + 5 : START_LEVEL + 5);
    this.level = Math.min(this.level + amount, maxLevel);
    this.radius = calcRadius(this.level);
    this.length = calcLength(this.level);
    // Extend trail capacity when we grow.
    this.trail.push({ x: this.x, y: this.y });
    if (this.isPlayer) {
      flashStatus("Bulked up!", "live");
    }
  }

  update(dt) {
    if (!this.isPlayer) {
      this.wanderTimer -= dt;
      if (this.wanderTimer <= 0) {
        this.pickDirection();
      }
    }

    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.handleWalls();
    this.updateTrail();
  }

  pickDirection() {
    const slices = 24; // richer set of movement angles
    const angle = Math.floor(Math.random() * slices) * ((Math.PI * 2) / slices);
    const speed = this.maxSpeed();
    this.vx = Math.cos(angle) * speed;
    this.vy = Math.sin(angle) * speed;
    this.wanderTimer = randomRange(1.2, 3.6);
  }

  handleWalls() {
    const r = this.radius;
    if (this.x - r < 0) {
      this.x = r;
      this.vx = Math.abs(this.vx);
    } else if (this.x + r > WORLD_WIDTH) {
      this.x = WORLD_WIDTH - r;
      this.vx = -Math.abs(this.vx);
    }

    if (this.y - r < 0) {
      this.y = r;
      this.vy = Math.abs(this.vy);
    } else if (this.y + r > WORLD_HEIGHT) {
      this.y = WORLD_HEIGHT - r;
      this.vy = -Math.abs(this.vy);
    }
  }

  draw() {
    const heading = Math.atan2(this.vy || 0.0001, this.vx || 1);
    const color = getCrocColor(this);
    const segments = getSegmentsForCroc(this);
    drawCrocBody(ctx, segments, this.radius, color);
    drawCrocShape(ctx, this.screenX, this.screenY, this.radius, HEAD_LENGTH, color, heading);

    // Level badge on body
    ctx.fillStyle = "#0f1326";
    ctx.font = `${Math.max(11, this.radius)}px Space Grotesk`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(this.level.toString(), this.screenX, this.screenY);

    drawNameTag(ctx, this.name, this.screenX, this.screenY - this.radius - 16);
  }

  updateTrail() {
    this.trail.push({ x: this.x, y: this.y });
    const spacing = this.radius * 1.25;
    const targetSegments = Math.max(8, Math.floor(this.length / spacing) + 6);
    const maxTrailPoints = targetSegments * 8;
    if (this.trail.length > maxTrailPoints) {
      this.trail = this.trail.slice(this.trail.length - maxTrailPoints);
    }
  }

  initTrail() {
    const seed = Math.max(12, Math.floor(this.length / (this.radius * 1.25)) + 8);
    this.trail = [];
    for (let i = 0; i < seed; i++) {
      this.trail.push({ x: this.x, y: this.y });
    }
  }
}

function calcRadius(level) {
  // Keep head size consistent; only tail grows.
  const radius = HEAD_RADIUS;
  const mobileCap = isMobile() ? BASE_RADIUS + 14 * RADIUS_PER_LEVEL : MAX_RADIUS;
  return Math.min(radius, mobileCap);
}

function calcLength(level) {
  const effective = Math.min(level, MAX_LENGTH_LEVEL);
  const extra = Math.min(MAX_EXTRA_LENGTH, effective * LENGTH_PER_LEVEL);
  return BASE_LENGTH + extra;
}

function randomRange(min, max) {
  return min + Math.random() * (max - min);
}

function randomPoint(radius = 20) {
  return {
    x: randomRange(radius, WORLD_WIDTH - radius),
    y: randomRange(radius, WORLD_HEIGHT - radius),
  };
}

function resizeCanvas() {
  boardWidth = window.innerWidth;
  boardHeight = window.innerHeight;
  canvas.width = boardWidth;
  canvas.height = boardHeight;
  if (!player) {
    camera.x = WORLD_WIDTH / 2;
    camera.y = WORLD_HEIGHT / 2;
  } else {
    updateCamera();
  }
  updateMobileUi();
}

function buildNpcs() {
  npcs = [];
  let attempts = 0;
  while (npcs.length < getNpcTarget() && attempts < 500) {
    attempts += 1;
    const candidate = new Croc(0, 0, START_LEVEL, randomColor(), false, randomName(), randomPattern());
    const point = randomPoint(candidate.radius * 2);
    candidate.x = point.x;
    candidate.y = point.y;
    candidate.pickDirection();

    if (isSpawnSafe(candidate)) {
      npcs.push(candidate);
    }
  }
}

function buildPellets() {
  pellets = [];
  while (pellets.length < TARGET_PELLETS) {
    pellets.push(randomPoint(PELLET_SIZE * 2));
  }
}

function buildRocks() {
  rocks = [];
  while (rocks.length < TARGET_ROCKS) {
    rocks.push(randomPoint(PELLET_SIZE * 2));
  }
}

function buildChests() {
  chests = [];
  while (chests.length < TARGET_CHESTS) {
    chests.push(randomPoint(PELLET_SIZE * 3));
  }
}

function startGame() {
  resizeCanvas();
  const chosenName = (playerNameInput?.value || "").trim().slice(0, 14);
  player = new Croc(
    WORLD_WIDTH / 2,
    WORLD_HEIGHT / 2,
    START_LEVEL,
    ownedItem?.color || "#5af18c",
    true,
    chosenName || "You",
    ownedItem?.pattern || "Plain",
    ownedAccessory
  );
  player.effect = ownedEffect;
  const speed = player.maxSpeed();
  player.vx = speed;
  player.vy = 0;
  if (!sessionCounted) {
    everPlayers += 1;
    sessionCounted = true;
    try {
      localStorage.setItem(EVER_KEY, everPlayers.toString());
    } catch (err) {
      // ignore storage errors
    }
  }
  buildNpcs();
  buildPellets();
  buildRocks();
  buildChests();
  pelletBank = 0;
  running = true;
  overlay.classList.add("hidden");
  statusBadge.textContent = "Live";
  statusBadge.className = "badge badge-live";
  lastTime = 0;
  requestAnimationFrame(gameLoop);
  updateStats();
  updateMobileUi();
}

function handleInputs() {
  if (!player) return;
  const up = keys.has("ArrowUp") || keys.has("KeyW");
  const down = keys.has("ArrowDown") || keys.has("KeyS");
  const left = keys.has("ArrowLeft") || keys.has("KeyA");
  const right = keys.has("ArrowRight") || keys.has("KeyD");

  let dx = 0;
  let dy = 0;
  if (up) dy -= 1;
  if (down) dy += 1;
  if (left) dx -= 1;
  if (right) dx += 1;

  if (dx === 0 && dy === 0) {
    return; // keep heading, always moving forward
  }
  const len = Math.hypot(dx, dy);
  const speed = player.maxSpeed();
  player.vx = (dx / len) * speed;
  player.vy = (dy / len) * speed;
}

function update(dt) {
  handleInputs();
  [...npcs, player].forEach((actor) => actor.update(dt));
  handlePellets();
  handleRocks();
  handleChests();
  applyMagnet();
  handleCollisions();
  spawnMissing();
  updateCamera();
}

function handlePellets() {
  pellets = pellets.filter((pellet) => {
    const actors = [player, ...npcs];
    for (const actor of actors) {
      if (actor.dead) continue;
      const points = getCollisionPoints(actor);
      for (const p of points) {
        const d = Math.hypot(p.x - pellet.x, p.y - pellet.y);
        if (d < p.r + PELLET_SIZE) {
          actor.consume(1);
          if (actor.isPlayer) {
            pelletBank += 1;
          }
          updateStats();
          return false;
        }
      }
    }
    return true;
  });
}

function handleRocks() {
  rocks = rocks.filter((rock) => {
    const actors = [player, ...npcs];
    for (const actor of actors) {
      if (actor.dead) continue;
      const points = getCollisionPoints(actor);
      for (const p of points) {
        const d = Math.hypot(p.x - rock.x, p.y - rock.y);
        if (d < p.r + PELLET_SIZE + 4) {
          actor.consume(ROCK_VALUE);
          if (actor.isPlayer) {
            pelletBank += ROCK_VALUE;
          }
          updateStats();
          return false;
        }
      }
    }
    return true;
  });
}

function handleChests() {
  chests = chests.filter((chest) => {
    const actors = [player, ...npcs];
    for (const actor of actors) {
      if (actor.dead) continue;
      const points = getCollisionPoints(actor);
      for (const p of points) {
        const d = Math.hypot(p.x - chest.x, p.y - chest.y);
        if (d < p.r + PELLET_SIZE * 1.5) {
          const rocksInside = Math.floor(randomRange(2, 6));
          const value = rocksInside * ROCK_VALUE;
          actor.consume(value);
          if (actor.isPlayer) {
            pelletBank += value;
          }
          updateStats();
          return false;
        }
      }
    }
    return true;
  });
}

function handleCollisions() {
  const actors = [player, ...npcs].filter((a) => !a.dead);
  for (let i = 0; i < actors.length; i++) {
    for (let j = i + 1; j < actors.length; j++) {
      const a = actors[i];
      const b = actors[j];
      if (a.dead || b.dead) continue;

      if (!crocsTouch(a, b)) continue;
      let winner;
      let loser;
      if (a.level === b.level) {
        // Equal level: both are eliminated to keep touch lethal.
        a.dead = true;
        b.dead = true;
      } else {
        winner = a.level > b.level ? a : b;
        loser = winner === a ? b : a;
      }
      if (winner && loser) {
        winner.consume(loser.level);
        loser.dead = true;
        if (loser === player) {
          triggerGameOver(winner.level);
          return;
        }
      }
    }
  }

  npcs = npcs.filter((n) => !n.dead);
}

function separate(a, b, dist) {
  const overlap = a.radius + b.radius - dist;
  if (overlap <= 0 || !isFinite(overlap)) return;
  const nx = (a.x - b.x) / dist || 1;
  const ny = (a.y - b.y) / dist || 0;
  const push = overlap / 2;
  a.x += nx * push;
  a.y += ny * push;
  b.x -= nx * push;
  b.y -= ny * push;
}

function spawnMissing() {
  let attempts = 0;
  while (npcs.length < getNpcTarget() && attempts < 200) {
    attempts += 1;
    const croc = new Croc(0, 0, START_LEVEL, randomColor(), false, randomName(), randomPattern());
    const point = randomPoint(croc.radius * 2);
    croc.x = point.x;
    croc.y = point.y;
    croc.pickDirection();
    if (isSpawnSafe(croc)) {
      npcs.push(croc);
    }
    if (npcs.length >= getNpcTarget()) break;
  }

  while (pellets.length < TARGET_PELLETS) {
    pellets.push(randomPoint(PELLET_SIZE * 2));
  }

  while (rocks.length < TARGET_ROCKS) {
    rocks.push(randomPoint(PELLET_SIZE * 2));
  }

  while (chests.length < TARGET_CHESTS) {
    chests.push(randomPoint(PELLET_SIZE * 3));
  }
}

function draw() {
  ctx.clearRect(0, 0, boardWidth, boardHeight);
  ctx.save();
  ctx.translate(boardWidth / 2, boardHeight / 2);
  ctx.scale(zoom, zoom);
  ctx.translate(-camera.x, -camera.y);

  drawGrid();
  drawPellets();
  drawRocks();
  drawChests();
  const actors = [player, ...npcs].filter(Boolean);
  actors.forEach((actor) => {
    actor.screenX = actor.x;
    actor.screenY = actor.y;
    actor.draw();
  });
  ctx.restore();
}

function drawGrid() {
  ctx.strokeStyle = "rgba(255,255,255,0.04)";
  ctx.lineWidth = 1;
  const spacing = 48;
  const spanX = boardWidth / zoom;
  const spanY = boardHeight / zoom;
  const startX = Math.floor((camera.x - spanX / 2) / spacing) * spacing;
  const endX = camera.x + spanX / 2 + spacing;
  for (let x = startX; x <= endX; x += spacing) {
    const sx = x;
    ctx.beginPath();
    ctx.moveTo(sx, camera.y - spanY / 2);
    ctx.lineTo(sx, camera.y + spanY / 2);
    ctx.stroke();
  }
  const startY = Math.floor((camera.y - spanY / 2) / spacing) * spacing;
  const endY = camera.y + spanY / 2 + spacing;
  for (let y = startY; y <= endY; y += spacing) {
    const sy = y;
    ctx.beginPath();
    ctx.moveTo(camera.x - spanX / 2, sy);
    ctx.lineTo(camera.x + spanX / 2, sy);
    ctx.stroke();
  }
}

function drawPellets() {
  ctx.fillStyle = "#ffeb3b";
  pellets.forEach((p) => {
    const spanX = boardWidth / zoom;
    const spanY = boardHeight / zoom;
    if (p.x < camera.x - spanX / 2 - 30 || p.x > camera.x + spanX / 2 + 30 || p.y < camera.y - spanY / 2 - 30 || p.y > camera.y + spanY / 2 + 30) {
      return;
    }
    ctx.beginPath();
    ctx.arc(p.x, p.y, PELLET_SIZE, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.25)";
    ctx.lineWidth = 2;
    ctx.stroke();
  });
}

function drawCrocBody(context, segments, radius, color) {
  const bodyRadius = Math.max(6, radius * 0.75);
  context.fillStyle = shadeColor(color, -6);
  context.strokeStyle = "rgba(0,0,0,0.2)";
  context.lineWidth = 1;
  for (let i = 0; i < segments.length - 1; i++) {
    const p = segments[i];
    context.beginPath();
    context.arc(p.x, p.y, bodyRadius, 0, Math.PI * 2);
    context.fill();
    context.stroke();
  }
}

function drawRocks() {
  rocks.forEach((r) => {
    const spanX = boardWidth / zoom;
    const spanY = boardHeight / zoom;
    if (r.x < camera.x - spanX / 2 - 30 || r.x > camera.x + spanX / 2 + 30 || r.y < camera.y - spanY / 2 - 30 || r.y > camera.y + spanY / 2 + 30) {
      return;
    }
    ctx.fillStyle = "#b8bec7";
    ctx.strokeStyle = "#6e7680";
    ctx.lineWidth = 2;
    ctx.beginPath();
    const size = PELLET_SIZE + 6;
    for (let i = 0; i < 6; i++) {
      const angle = (Math.PI / 3) * i;
      const x = r.x + Math.cos(angle) * size;
      const y = r.y + Math.sin(angle) * size;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  });
}

function drawChests() {
  chests.forEach((c) => {
    const spanX = boardWidth / zoom;
    const spanY = boardHeight / zoom;
    if (c.x < camera.x - spanX / 2 - 30 || c.x > camera.x + spanX / 2 + 30 || c.y < camera.y - spanY / 2 - 30 || c.y > camera.y + spanY / 2 + 30) {
      return;
    }
    const w = PELLET_SIZE * 3;
    const h = PELLET_SIZE * 2.2;
    ctx.fillStyle = "#c48a3a";
    ctx.strokeStyle = "#6a4a1b";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.rect(c.x - w / 2, c.y - h / 2, w, h);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#f9d78a";
    ctx.fillRect(c.x - w / 2, c.y - h / 2 + h * 0.25, w, h * 0.15);
    ctx.fillStyle = "#6a4a1b";
    ctx.fillRect(c.x - 4, c.y - h / 2, 8, h);
    ctx.fillStyle = "#d9b45b";
    ctx.beginPath();
    ctx.arc(c.x, c.y + h * 0.1, 5, 0, Math.PI * 2);
    ctx.fill();
  });
}

function randomColor() {
  const palette = ["#7cdcff", "#67f0ff", "#9ef2c4", "#9fd3ff", "#c6ff8f", "#7ee4c8"];
  return palette[Math.floor(Math.random() * palette.length)];
}

function randomPattern() {
  const patterns = ["Plain", "Spots", "Stripes", "Camouflage", "Lava", "Aurora", "Polka", "Harlequin"];
  return patterns[Math.floor(Math.random() * patterns.length)];
}

function randomName() {
  const names = [
    "Snap",
    "Chomp",
    "Ripple",
    "Toothy",
    "Gnash",
    "Marsh",
    "Delta",
    "Swampy",
    "Bitey",
    "Lagoon",
    "Jaws",
    "Current",
    "Gator",
    "Caiman",
    "Gulper",
    "Floater",
    "Splash",
    "Pebble",
    "Creek",
  ];
  return names[Math.floor(Math.random() * names.length)];
}

const SHOP_ITEMS = [
  { id: "jade", name: "Jade Scale", cost: 8, color: "#5af18c", pattern: "Plain", preview: "#5af18c" },
  { id: "sunset", name: "Sunset Fade", cost: 10, color: "#ff9f68", pattern: "Spots", preview: "radial-gradient(circle,#ff9f68 35%,#ff6b6b 70%)" },
  { id: "midnight", name: "Midnight Stripe", cost: 12, color: "#4c6fff", pattern: "Stripes", preview: "repeating-linear-gradient(45deg,#141833 0 12px,#4c6fff 12px 24px)" },
  { id: "ember", name: "Ember Glow", cost: 14, color: "#ff6b6b", pattern: "Lava", preview: "radial-gradient(circle at 30% 30%,#ff9f68,#ff6b6b,#241313)" },
  { id: "aurora", name: "Aurora Swirl", cost: 16, color: "#7ce0ff", pattern: "Aurora", preview: "radial-gradient(circle,#7ce0ff,#8f7dff)" },
  { id: "rainbow", name: "Rainbow Ripple", cost: 18, color: "#f6c", pattern: "Rainbow", preview: "linear-gradient(90deg,#ff6b6b,#ffdf6b,#7cf27d,#7ce0ff,#b57cff)" },
  { id: "disco", name: "Disco Flash", cost: 20, color: "#ffffff", pattern: "Disco", preview: "linear-gradient(90deg,#ff6b6b,#ffdf6b,#7cf27d,#7ce0ff,#b57cff)" , effect: "disco"},
  { id: "magnet", name: "Magnet Skin", cost: 22, color: "#7ee4c8", pattern: "Plain", preview: "linear-gradient(135deg,#d7dbe0,#7ee4c8)", effect: "magnet" },
  { id: "void", name: "Nebula Black", cost: 20, color: "#1b1c2e", pattern: "Nebula", preview: "radial-gradient(circle at 30% 30%,#6a5dff,#1b1c2e,#0a0c1f)" },
  { id: "polka", name: "Polka Dot Party", cost: 16, color: "#7ce0ff", pattern: "Polka", preview: "radial-gradient(circle,#fff 15%,#7ce0ff 16%)" },
  { id: "crown", name: "Royal Crown", cost: 18, color: "#5af18c", pattern: "Plain", preview: "#f6c343", accessory: "crown" },
  { id: "jester", name: "Jester Cap", cost: 18, color: "#ff6b6b", pattern: "Harlequin", preview: "repeating-linear-gradient(45deg,#ff6b6b 0 10px,#7ce0ff 10px 20px)", accessory: "jester" },
];

let ownedItem = SHOP_ITEMS[0];
let ownedAccessory = null;
let ownedEffect = SHOP_ITEMS[0].effect || null;

function renderShop() {
  if (!shopItemsEl) return;
  shopItemsEl.innerHTML = "";
  SHOP_ITEMS.forEach((item) => {
    const div = document.createElement("div");
    div.className = "shop-item";
    div.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;">
        <div style="width:18px;height:18px;border-radius:50%;background:${item.color};border:1px solid rgba(255,255,255,0.25)"></div>
        <strong>${item.name}</strong>
      </div>
      <span class="muted">${item.pattern}</span>
      <div class="shop-preview" style="background:${item.preview || item.color};"></div>
      <div class="shop-chip"><span>●</span>${item.cost} pellets</div>
      <button class="secondary" data-id="${item.id}" ${ownedItem.id === item.id && ownedAccessory === item.accessory && ownedEffect === (item.effect || null) ? "disabled" : ""}>${ownedItem.id === item.id && ownedAccessory === item.accessory && ownedEffect === (item.effect || null) ? "Equipped" : "Buy"}</button>
    `;
    shopItemsEl.appendChild(div);
  });

  shopItemsEl.querySelectorAll("button[data-id]").forEach((btn) => {
    const handler = (e) => {
      e.preventDefault();
      const id = btn.getAttribute("data-id");
      const item = SHOP_ITEMS.find((i) => i.id === id);
      if (!item) return;
      if (pelletBank < item.cost) {
        flashStatus("Not enough pellets", "warn");
        return;
      }
      pelletBank -= item.cost;
      ownedItem = item;
      ownedAccessory = item.accessory || null;
      ownedEffect = item.effect || null;
      if (player) {
        player.color = item.color;
        player.pattern = item.pattern;
        player.accessory = item.accessory || null;
        player.effect = item.effect || null;
      }
      flashStatus("Equipped!", "live");
      renderShop();
      updateStats();
    };
    btn.addEventListener("click", handler);
    btn.addEventListener("touchend", handler, { passive: false });
  });
}

function getCrocColor(croc) {
  if (croc.effect === "disco") {
    const t = (performance.now ? performance.now() : Date.now()) * 0.06 + croc.hueOffset;
    return `hsl(${t % 360}, 80%, 60%)`;
  }
  return croc.color;
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function triggerGameOver(enemyLevel) {
  running = false;
  overlay.classList.remove("hidden");
  overlayMessage.textContent = `A level ${enemyLevel} croc swallowed you.`;
  statusBadge.textContent = "Defeated";
  statusBadge.className = "badge";
  updateStats();
  updateMobileUi();
}

function worldToScreen(x, y) {
  return { x, y };
}

function updateCamera() {
  if (!player) return;
  const spanX = boardWidth / zoom;
  const spanY = boardHeight / zoom;
  const halfW = spanX / 2;
  const halfH = spanY / 2;
  if (WORLD_WIDTH <= spanX) {
    camera.x = WORLD_WIDTH / 2;
  } else {
    camera.x = clamp(player.x, halfW, WORLD_WIDTH - halfW);
  }
  if (WORLD_HEIGHT <= spanY) {
    camera.y = WORLD_HEIGHT / 2;
  } else {
    camera.y = clamp(player.y, halfH, WORLD_HEIGHT - halfH);
  }

  let zoomFactor = 1.1 - player.radius / 140;
  if (isMobile()) {
    zoomFactor *= 0.82; // zoom out further on mobile so crocs feel smaller
  }
  zoom = clamp(zoomFactor, MIN_ZOOM, MAX_ZOOM);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function drawCrocShape(context, cx, cy, radius, length, color, heading = 0) {
  const len = length;
  const tailWidth = radius * 0.7;
  const headWidth = radius * 1.3;
  const bodyWidth = radius * 1.5;
  const bellyColor = shadeColor(color, -28);
  const scuteColor = shadeColor(color, 14);

  context.save();
  context.translate(cx, cy);
  context.rotate(heading);

  // Tail (tapered)
  context.beginPath();
  context.moveTo(-len * 0.55, 0);
  context.bezierCurveTo(-len * 0.8, tailWidth, -len * 0.8, -tailWidth, -len * 0.55, 0);
  context.closePath();
  context.fillStyle = shadeColor(color, -10);
  context.fill();

  // Body (rounded rectangle)
  context.beginPath();
  roundedRect(context, -len * 0.55, -bodyWidth / 2, len * 0.7, bodyWidth, bodyWidth * 0.45);
  // Body fill with optional patterns
  if (ownedItem.pattern === "Polka" || ownedItem.pattern === "Harlequin") {
    const patternCanvas = document.createElement("canvas");
    const size = ownedItem.pattern === "Polka" ? 60 : 80;
    patternCanvas.width = size;
    patternCanvas.height = size;
    const pctx = patternCanvas.getContext("2d");
    pctx.fillStyle = color;
    pctx.fillRect(0, 0, size, size);
    if (ownedItem.pattern === "Polka") {
      pctx.fillStyle = "#ffffff";
      for (let x = 10; x < size; x += 20) {
        for (let y = 10; y < size; y += 20) {
          pctx.beginPath();
          pctx.arc(x, y, 4, 0, Math.PI * 2);
          pctx.fill();
        }
      }
    } else if (ownedItem.pattern === "Harlequin") {
      pctx.fillStyle = shadeColor(color, 30);
      pctx.beginPath();
      pctx.moveTo(size / 2, 0);
      pctx.lineTo(size, size / 2);
      pctx.lineTo(size / 2, size);
      pctx.lineTo(0, size / 2);
      pctx.closePath();
      pctx.fill();
    }
    const pat = context.createPattern(patternCanvas, "repeat");
    context.fillStyle = pat;
  } else {
    context.fillStyle = color;
  }
  context.fill();

  // Belly stripe
  context.beginPath();
  roundedRect(context, -len * 0.52, -bodyWidth * 0.25, len * 0.66, bodyWidth * 0.5, bodyWidth * 0.25);
  context.fillStyle = bellyColor;
  context.fill();

  // Legs (simple ovals)
  context.fillStyle = shadeColor(color, -6);
  const legW = radius * 0.7;
  const legH = radius * 0.35;
  const legOffsetX = len * 0.18;
  const legOffsetY = bodyWidth * 0.55;
  drawEllipse(context, -legOffsetX, -legOffsetY, legW, legH);
  drawEllipse(context, legOffsetX, -legOffsetY, legW, legH);
  drawEllipse(context, -legOffsetX, legOffsetY, legW, legH);
  drawEllipse(context, legOffsetX, legOffsetY, legW, legH);

  // Head + snout
  context.beginPath();
  context.moveTo(len * 0.15, -headWidth * 0.55);
  context.lineTo(len * 0.7, -headWidth * 0.3);
  context.lineTo(len * 0.78, 0);
  context.lineTo(len * 0.7, headWidth * 0.3);
  context.lineTo(len * 0.15, headWidth * 0.55);
  context.closePath();
  context.fillStyle = shadeColor(color, 8);
  context.fill();

  // Mouth line
  context.strokeStyle = "#0f1326";
  context.lineWidth = Math.max(1.2, radius * 0.08);
  context.beginPath();
  context.moveTo(len * 0.18, headWidth * 0.18);
  context.lineTo(len * 0.7, headWidth * 0.05);
  context.stroke();

  // Teeth (cartoon triangles along top jaw)
  context.fillStyle = "#f8f9fb";
  const teethCount = 4;
  for (let i = 0; i < teethCount; i++) {
    const t = i / (teethCount - 1);
    const tx = len * 0.2 + t * (len * 0.45);
    const ty = -headWidth * 0.05 - (i % 2 === 0 ? headWidth * 0.08 : headWidth * 0.05);
    context.beginPath();
    context.moveTo(tx, ty);
    context.lineTo(tx + headWidth * 0.06, ty + headWidth * 0.16);
    context.lineTo(tx - headWidth * 0.06, ty + headWidth * 0.16);
    context.closePath();
    context.fill();
  }

  // Eye
  context.fillStyle = "#fefefe";
  context.beginPath();
  context.arc(len * 0.12, -headWidth * 0.2, Math.max(3, radius * 0.2), 0, Math.PI * 2);
  context.fill();
  context.fillStyle = "#0f1326";
  context.beginPath();
  context.arc(len * 0.14, -headWidth * 0.2, Math.max(1.8, radius * 0.1), 0, Math.PI * 2);
  context.fill();

  // Nostril
  context.fillStyle = "#0f1326";
  drawEllipse(context, len * 0.55, -headWidth * 0.05, radius * 0.12, radius * 0.08);

  // Accessory (crown or jester)
  if (ownedItem.accessory === "crown") {
    context.fillStyle = "#f6c343";
    context.strokeStyle = "#d49b2d";
    context.lineWidth = 1.5;
    context.beginPath();
    context.moveTo(len * 0.05, -bodyWidth * 0.9);
    context.lineTo(len * 0.15, -headWidth * 1.2);
    context.lineTo(len * 0.25, -bodyWidth * 0.9);
    context.lineTo(len * 0.35, -headWidth * 1.2);
    context.lineTo(len * 0.45, -bodyWidth * 0.9);
    context.lineTo(len * 0.45, -bodyWidth * 0.65);
    context.lineTo(len * 0.05, -bodyWidth * 0.65);
    context.closePath();
    context.fill();
    context.stroke();
  } else if (ownedItem.accessory === "jester") {
    context.fillStyle = "#ff6b6b";
    context.strokeStyle = "#0f1326";
    context.lineWidth = 1.2;
    context.beginPath();
    context.moveTo(len * 0.05, -bodyWidth * 0.85);
    context.quadraticCurveTo(len * 0.15, -headWidth * 1.3, len * 0.25, -bodyWidth * 0.85);
    context.quadraticCurveTo(len * 0.35, -headWidth * 1.3, len * 0.45, -bodyWidth * 0.85);
    context.lineTo(len * 0.45, -bodyWidth * 0.65);
    context.lineTo(len * 0.05, -bodyWidth * 0.65);
    context.closePath();
    context.fill();
    context.stroke();

    // Bells
    context.fillStyle = "#ffd166";
    context.beginPath();
    context.arc(len * 0.25, -headWidth * 1.3, 4, 0, Math.PI * 2);
    context.fill();
    context.beginPath();
    context.arc(len * 0.35, -headWidth * 1.3, 4, 0, Math.PI * 2);
    context.fill();
  }

  // Back scutes
  context.fillStyle = scuteColor;
  const scutes = Math.max(3, Math.floor(len / 45));
  for (let i = 0; i < scutes; i++) {
    const t = i / (scutes - 1);
    const sx = -len * 0.45 + t * (len * 0.75);
    context.beginPath();
    roundedRect(context, sx - radius * 0.25, -bodyWidth * 0.65, radius * 0.5, radius * 0.45, radius * 0.15);
    context.fill();
  }

  context.restore();
}

function drawEllipse(context, x, y, rx, ry) {
  context.beginPath();
  context.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  context.fill();
}

function roundedRect(context, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  context.moveTo(x + radius, y);
  context.arcTo(x + w, y, x + w, y + h, radius);
  context.arcTo(x + w, y + h, x, y + h, radius);
  context.arcTo(x, y + h, x, y, radius);
  context.arcTo(x, y, x + w, y, radius);
}

function drawNameTag(context, text, x, y) {
  const paddingX = 8;
  const paddingY = 4;
  context.font = "12px Space Grotesk";
  const textWidth = context.measureText(text).width;
  const boxWidth = textWidth + paddingX * 2;
  const boxHeight = 18 + paddingY;
  const left = x - boxWidth / 2;
  const top = y - boxHeight / 2;

  context.fillStyle = "rgba(10, 15, 31, 0.78)";
  context.strokeStyle = "rgba(90, 241, 140, 0.65)";
  context.lineWidth = 2;
  context.beginPath();
  roundedRect(context, left, top, boxWidth, boxHeight, 10);
  context.fill();
  context.stroke();

  context.fillStyle = "#e8f2ff";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(text, x, y + 1);
}

function getSegmentsForCroc(croc) {
  // Returns points from tail to head.
  const spacing = croc.radius * 1.25;
  const desired = Math.max(8, Math.floor(croc.length / spacing) + 6);
  const points = [];
  let accumulated = 0;
  const trail = (croc.trail && croc.trail.length ? croc.trail : [{ x: croc.x, y: croc.y }]).slice();
  for (let i = trail.length - 1; i > 0 && points.length < desired; i--) {
    const p = trail[i];
    const prev = trail[i - 1];
    const dx = p.x - prev.x;
    const dy = p.y - prev.y;
    const dist = Math.hypot(dx, dy);
    accumulated += dist;
    while (accumulated >= spacing && points.length < desired) {
      const t = 1 - (accumulated - spacing) / dist;
      const sx = prev.x + dx * t;
      const sy = prev.y + dy * t;
      points.push({ x: sx, y: sy });
      accumulated -= spacing;
    }
  }
  points.push({ x: croc.x, y: croc.y });
  while (points.length < desired) {
    points.unshift(points[0]);
  }
  return points.reverse();
}

function getCollisionPoints(croc) {
  const segments = getSegmentsForCroc(croc);
  const points = [];
  const bodyR = Math.max(6, croc.radius * 0.75);
  for (let i = 0; i < segments.length - 1; i++) {
    points.push({ x: segments[i].x, y: segments[i].y, r: bodyR });
  }
  const head = segments[segments.length - 1];
  points.push({ x: head.x, y: head.y, r: croc.radius });
  return points;
}

function crocsTouch(a, b) {
  const pointsA = getCollisionPoints(a);
  const pointsB = getCollisionPoints(b);
  for (const pa of pointsA) {
    for (const pb of pointsB) {
      if (Math.hypot(pa.x - pb.x, pa.y - pb.y) < pa.r + pb.r) {
        return true;
      }
    }
  }
  return false;
}

function setHeadingTowards(worldX, worldY) {
  if (!player) return;
  const angle = Math.atan2(worldY - player.y, worldX - player.x);
  const speed = player.maxSpeed();
  player.vx = Math.cos(angle) * speed;
  player.vy = Math.sin(angle) * speed;
}

function isSpawnSafe(candidate) {
  const margin = candidate.radius * 4;
  const viewMarginX = boardWidth / zoom * 0.6;
  const viewMarginY = boardHeight / zoom * 0.6;
  // avoid spawning right in the camera view to reduce instant collisions
  if (
    camera &&
    candidate.x > camera.x - viewMarginX &&
    candidate.x < camera.x + viewMarginX &&
    candidate.y > camera.y - viewMarginY &&
    candidate.y < camera.y + viewMarginY
  ) {
    return false;
  }
  const points = getCollisionPoints(candidate);
  const actors = [player, ...npcs].filter(Boolean);
  for (const actor of actors) {
    const otherPoints = getCollisionPoints(actor);
    for (const p of points) {
      for (const op of otherPoints) {
        if (Math.hypot(p.x - op.x, p.y - op.y) < p.r + op.r + margin) {
          return false;
        }
      }
    }
  }
  return true;
}

function shadeColor(color, percent) {
  const num = parseInt(color.replace("#", ""), 16);
  const r = (num >> 16) + percent;
  const g = ((num >> 8) & 0x00ff) + percent;
  const b = (num & 0x0000ff) + percent;
  const newColor = (0x1000000 + (clamp(r, 0, 255) << 16) + (clamp(g, 0, 255) << 8) + clamp(b, 0, 255)).toString(16).slice(1);
  return `#${newColor}`;
}

function gameLoop(timestamp) {
  if (!running) {
    draw();
    return;
  }

  if (!lastTime) lastTime = timestamp;
  const dt = Math.min((timestamp - lastTime) / 1000, 0.033);
  lastTime = timestamp;

  update(dt);
  draw();
  updateStats();
  requestAnimationFrame(gameLoop);
}

function updateStats() {
  levelDisplay.textContent = player ? player.level : "-";
  pelletDisplay.textContent = pelletBank.toString();
  crocDisplay.textContent = npcs.length.toString();
  everDisplay.textContent = everPlayers.toString();
  activeDisplay.textContent = running ? "1" : "0";
  if (mobileLevel) mobileLevel.textContent = levelDisplay.textContent;
  if (mobileLoot) mobileLoot.textContent = pelletDisplay.textContent;
  if (mobileCrocs) mobileCrocs.textContent = crocDisplay.textContent;
}

function isMobile() {
  return window.matchMedia("(max-width: 840px)").matches;
}

function getNpcTarget() {
  return isMobile() ? Math.ceil(TARGET_NPCS * 1.1) : TARGET_NPCS;
}

function updateMobileUi() {
  if (running && !menuOpen) {
    document.body.classList.add("mobile-running");
    document.body.classList.remove("mobile-menu-open");
  } else if (menuOpen) {
    document.body.classList.add("mobile-menu-open");
    document.body.classList.remove("mobile-running");
  } else {
    document.body.classList.remove("mobile-running");
    document.body.classList.remove("mobile-menu-open");
  }
}

function flashStatus(message, tone) {
  statusBadge.textContent = message;
  statusBadge.className = `badge ${tone === "live" ? "badge-live" : ""}`;
  setTimeout(() => {
    statusBadge.textContent = running ? "Live" : "Paused";
    statusBadge.className = running ? "badge badge-live" : "badge";
  }, 1000);
}

function applyMagnet() {
  if (!player || player.effect !== "magnet") return;
  const radius = 260;
  const pull = 180;
  const applyPull = (arr, factor) => {
    for (const obj of arr) {
      const dx = player.x - obj.x;
      const dy = player.y - obj.y;
      const d = Math.hypot(dx, dy);
      if (d > radius || d === 0) continue;
      const step = Math.min(pull * (1 - d / radius), d);
      const nx = dx / d;
      const ny = dy / d;
      obj.x += nx * step * factor;
      obj.y += ny * step * factor;
    }
  };
  applyPull(pellets, 0.05);
  applyPull(rocks, 0.04);
  applyPull(chests, 0.03);
}

// Event wiring
window.addEventListener("resize", resizeCanvas);
window.addEventListener("keydown", (e) => {
  keys.add(e.code);
});
window.addEventListener("keyup", (e) => {
  keys.delete(e.code);
});
window.addEventListener("touchstart", (e) => {
  if (!player || e.touches.length === 0) return;
  const touch = e.touches[0];
  const rect = canvas.getBoundingClientRect();
  const tx = (touch.clientX - rect.left) / rect.width * boardWidth;
  const ty = (touch.clientY - rect.top) / rect.height * boardHeight;
  const worldX = camera.x - (boardWidth / (2 * zoom)) + tx / zoom;
  const worldY = camera.y - (boardHeight / (2 * zoom)) + ty / zoom;
  setHeadingTowards(worldX, worldY);
});
canvas.addEventListener("touchmove", (e) => {
  e.preventDefault();
}, { passive: false });

canvas.addEventListener("mousedown", (e) => {
  if (!player) return;
  const rect = canvas.getBoundingClientRect();
  const mx = (e.clientX - rect.left) / rect.width * boardWidth;
  const my = (e.clientY - rect.top) / rect.height * boardHeight;
  const worldX = camera.x - (boardWidth / (2 * zoom)) + mx / zoom;
  const worldY = camera.y - (boardHeight / (2 * zoom)) + my / zoom;
  setHeadingTowards(worldX, worldY);
});

startButton.addEventListener("click", startGame);
overlayButton.addEventListener("click", startGame);
shopButton?.addEventListener("click", () => {
  menuOpen = true;
  updateMobileUi();
  shopPanel.classList.remove("hidden");
  renderShop();
});
closeShop?.addEventListener("click", () => {
  shopPanel.classList.add("hidden");
  menuOpen = false;
  updateMobileUi();
});
menuToggle?.addEventListener("click", () => {
  menuOpen = !menuOpen;
  updateMobileUi();
});
mobileShopButton?.addEventListener("click", () => {
  menuOpen = true;
  updateMobileUi();
  shopPanel.classList.remove("hidden");
  renderShop();
  if (isMobile()) {
    menuOpen = true;
    updateMobileUi();
  }
});

// Extra mobile-friendly bindings for start/restart
startButton.addEventListener("touchend", (e) => {
  e.preventDefault();
  startGame();
}, { passive: false });
overlayButton.addEventListener("touchend", (e) => {
  e.preventDefault();
  startGame();
}, { passive: false });

// Kick off idle render so the board is visible before starting.
resizeCanvas();
try {
  const savedEver = parseInt(localStorage.getItem(EVER_KEY) || "0", 10);
  if (!Number.isNaN(savedEver)) {
    everPlayers = savedEver;
  }
} catch (err) {
  everPlayers = 0;
}
draw();
updateStats();
