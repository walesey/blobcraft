// ============================================================
// BLOB RTS — Multiplayer Server
// ============================================================

const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));

const PORT = process.env.PORT || 3000;
const TICK_RATE = 30; // server simulation ticks per second
const BROADCAST_RATE = 20; // state broadcasts per second
const TICK_MS = 1000 / TICK_RATE;
const BROADCAST_MS = 1000 / BROADCAST_RATE;

// --- Game constants ---
const WORLD_W = 3200;
const WORLD_H = 3200;
const BASE_RADIUS = 40;
const BABY_SIZE = 8;
const SPAWN_INTERVAL = 3000;
const MAX_UNITS_PER_TEAM = 50;
const NPC_COUNT = 80;
const NPC_RESPAWN_INTERVAL = 6000;
const BLOB_MIN_SPEED = 0.6;
const BLOB_MAX_SPEED = 2.5;
const TEAM_NPC = -1;

const SPAWN_POSITIONS = [
  { x: 400, y: WORLD_H - 400 },
  { x: WORLD_W - 400, y: 400 },
  { x: 400, y: 400 },
  { x: WORLD_W - 400, y: WORLD_H - 400 },
  { x: WORLD_W / 2, y: 300 },
  { x: WORLD_W / 2, y: WORLD_H - 300 },
  { x: 300, y: WORLD_H / 2 },
  { x: WORLD_W - 300, y: WORLD_H / 2 },
];

// --- Utility ---
function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function rand(lo, hi) { return lo + Math.random() * (hi - lo); }
function sizeToArea(r) { return Math.PI * r * r; }
function areaToSize(a) { return Math.sqrt(a / Math.PI); }
function blobSpeed(size) {
  return clamp(BLOB_MAX_SPEED - (size - BABY_SIZE) * 0.04, BLOB_MIN_SPEED, BLOB_MAX_SPEED);
}

// --- Game State ---
let nextBlobId = 0;
let blobs = [];
let bases = [];
let events = []; // events to broadcast then clear
let npcRespawnTimer = 0;
const players = new Map(); // ws -> { team, alive }

function createBlob(x, y, size, team) {
  return {
    id: nextBlobId++,
    x, y, size, team,
    targetX: null, targetY: null,
    attackTarget: null,
    attackMove: false,
    alive: true,
    combatCooldown: 0,
  };
}

function createBase(x, y, team) {
  return { x, y, team, spawnTimer: 0, alive: true, hp: 500, maxHp: 500 };
}

let gameOver = false;
let restartTimer = 0;
const RESTART_DELAY = 5000; // ms before auto-restart

function resetGame() {
  blobs = [];
  bases = [];
  events = [];
  nextBlobId = 0;
  npcRespawnTimer = 0;
  gameOver = false;
  restartTimer = 0;
  spawnNPCs(NPC_COUNT);
}

function restartGame() {
  resetGame();
  // Respawn all connected players
  for (const [ws, player] of players) {
    const team = player.team;
    player.alive = true;
    spawnPlayer(team);
    ws.send(JSON.stringify({ type: 'restart', team }));
  }
  console.log(`Game restarted with ${players.size} players`);
}

function spawnNPCs(count) {
  const existing = blobs.filter(b => b.team === TEAM_NPC && b.alive).length;
  const toSpawn = Math.min(count, NPC_COUNT - existing);
  let attempts = 0;
  for (let i = 0; i < toSpawn && attempts < toSpawn * 5; attempts++) {
    const x = rand(100, WORLD_W - 100);
    const y = rand(100, WORLD_H - 100);
    let tooClose = false;
    for (const base of bases) {
      if (Math.hypot(x - base.x, y - base.y) < 200) { tooClose = true; break; }
    }
    if (tooClose) continue;
    const size = rand(4, 14);
    blobs.push(createBlob(x, y, size, TEAM_NPC));
    i++;
  }
}

function findNearestEnemy(blob, range) {
  let best = null, bestD = range;
  for (const other of blobs) {
    if (!other.alive || other.team === blob.team) continue;
    const d = dist(blob, other);
    if (d < bestD) { bestD = d; best = other; }
  }
  return best;
}

function allocateTeam() {
  const usedTeams = new Set();
  for (const p of players.values()) usedTeams.add(p.team);
  for (let t = 0; t < SPAWN_POSITIONS.length; t++) {
    if (!usedTeams.has(t)) return t;
  }
  return -1; // full
}

function spawnPlayer(team) {
  const pos = SPAWN_POSITIONS[team];
  if (!pos) return;

  const base = createBase(pos.x, pos.y, team);
  bases.push(base);

  for (let i = 0; i < 5; i++) {
    blobs.push(createBlob(
      pos.x + rand(-60, 60),
      pos.y + rand(-60, 60),
      BABY_SIZE, team
    ));
  }
}

function removePlayer(team) {
  // Remove their base and blobs
  for (const base of bases) {
    if (base.team === team) base.alive = false;
  }
  bases = bases.filter(b => b.team !== team);
  blobs = blobs.filter(b => b.team !== team);
}

// --- Simulation ---
function moveBlob(b) {
  if (!b.alive) return;
  b.combatCooldown = Math.max(0, b.combatCooldown - 1);

  if (b.attackTarget !== null) {
    const target = blobs.find(t => t.id === b.attackTarget);
    if (!target || !target.alive) {
      b.attackTarget = null;
    } else {
      b.targetX = target.x;
      b.targetY = target.y;
    }
  }

  if (b.targetX === null) return;

  const dx = b.targetX - b.x;
  const dy = b.targetY - b.y;
  const d = Math.hypot(dx, dy);
  const speed = blobSpeed(b.size);

  if (d < 2) {
    b.targetX = null;
    b.targetY = null;
    if (b.attackMove) {
      const nearest = findNearestEnemy(b, 200);
      if (nearest) b.attackTarget = nearest.id;
      b.attackMove = false;
    }
    return;
  }

  const mx = (dx / d) * speed;
  const my = (dy / d) * speed;
  b.x = clamp(b.x + mx, b.size, WORLD_W - b.size);
  b.y = clamp(b.y + my, b.size, WORLD_H - b.size);

  if (b.attackMove && b.attackTarget === null) {
    const nearest = findNearestEnemy(b, 150);
    if (nearest) b.attackTarget = nearest.id;
  }
}

function resolveCombat(a, b) {
  if (!a.alive || !b.alive) return;
  if (a.team === b.team) return;

  const d = dist(a, b);
  const touchDist = (a.size + b.size) * 1.15;
  if (d > touchDist) return;

  if (a.combatCooldown > 0 || b.combatCooldown > 0) return;

  const aArea = sizeToArea(a.size);
  const bArea = sizeToArea(b.size);
  const total = aArea + bArea;

  // Apply group bonus — each nearby ally adds a multiplier
  const aEffective = aArea * (1 + (a.groupBonus || 0));
  const bEffective = bArea * (1 + (b.groupBonus || 0));

  // NPCs are easier to beat — players get a configurable bonus to effective mass vs NPCs
  const npcDebuff = config.npcCombatDisadvantage;
  let pAWins;
  if (b.team === TEAM_NPC) {
    pAWins = (aEffective * npcDebuff) / (aEffective * npcDebuff + bEffective);
  } else if (a.team === TEAM_NPC) {
    pAWins = aEffective / (aEffective + bEffective * npcDebuff);
  } else {
    pAWins = aEffective / (aEffective + bEffective);
  }

  if (Math.random() < pAWins) {
    a.size = areaToSize(aArea + bArea * 0.8);
    b.alive = false;
    events.push({ type: 'kill', x: b.x, y: b.y, team: b.team });
    a.combatCooldown = config.combatCooldown || 15;
  } else {
    b.size = areaToSize(bArea + aArea * 0.8);
    a.alive = false;
    events.push({ type: 'kill', x: a.x, y: a.y, team: a.team });
    b.combatCooldown = config.combatCooldown || 15;
  }
}

function attackBase(blob, base) {
  if (!blob.alive || !base.alive || blob.team === base.team) return;
  const d = Math.hypot(blob.x - base.x, blob.y - base.y);
  if (d < BASE_RADIUS + blob.size) {
    if (blob.combatCooldown <= 0) {
      base.hp -= blob.size * 0.5;
      blob.combatCooldown = config.baseCombatCooldown || 30;
      events.push({ type: 'baseHit', x: base.x + rand(-20, 20), y: base.y + rand(-20, 20), team: base.team });
      if (base.hp <= 0) {
        base.alive = false;
        events.push({ type: 'baseDestroyed', x: base.x, y: base.y, team: base.team });
      }
    }
  }
}

function buildGrid(cellSize) {
  const grid = {};
  for (const b of blobs) {
    if (!b.alive) continue;
    const cx = Math.floor(b.x / cellSize);
    const cy = Math.floor(b.y / cellSize);
    const key = `${cx},${cy}`;
    if (!grid[key]) grid[key] = [];
    grid[key].push(b);
  }
  return grid;
}

function getCellNeighbors(grid, cx, cy) {
  const result = [];
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      const key = `${cx + dx},${cy + dy}`;
      if (grid[key]) result.push(...grid[key]);
    }
  }
  return result;
}

function updateBases(dt) {
  for (const base of bases) {
    if (!base.alive) continue;
    base.spawnTimer += dt;
    const teamCount = blobs.filter(b => b.alive && b.team === base.team).length;
    if (base.spawnTimer >= SPAWN_INTERVAL && teamCount < MAX_UNITS_PER_TEAM) {
      base.spawnTimer = 0;
      const angle = Math.random() * Math.PI * 2;
      const r = BASE_RADIUS + 15;
      blobs.push(createBlob(
        base.x + Math.cos(angle) * r,
        base.y + Math.sin(angle) * r,
        BABY_SIZE, base.team
      ));
    }
  }
}

function tick(dt) {
  updateBases(dt);

  for (const b of blobs) moveBlob(b);

  // Collision separation
  const cellSize = 60;
  const grid = buildGrid(cellSize);
  for (let iter = 0; iter < 3; iter++) {
    for (const b of blobs) {
      if (!b.alive) continue;
      const cx = Math.floor(b.x / cellSize);
      const cy = Math.floor(b.y / cellSize);
      const neighbors = getCellNeighbors(grid, cx, cy);
      for (const other of neighbors) {
        if (other.id <= b.id || !other.alive) continue;
        const dx = other.x - b.x;
        const dy = other.y - b.y;
        const d = Math.hypot(dx, dy) || 0.1;
        const minDist = b.size + other.size;
        if (d < minDist) {
          const overlap = (minDist - d) / 2;
          const nx = dx / d;
          const ny = dy / d;
          b.x -= nx * overlap;
          b.y -= ny * overlap;
          other.x += nx * overlap;
          other.y += ny * overlap;
          b.x = clamp(b.x, b.size, WORLD_W - b.size);
          b.y = clamp(b.y, b.size, WORLD_H - b.size);
          other.x = clamp(other.x, other.size, WORLD_W - other.size);
          other.y = clamp(other.y, other.size, WORLD_H - other.size);
        }
      }
    }
  }

  // Compute group bonus for each blob (number of same-team allies nearby)
  const groupRadius = config.groupBonusRadius || 80;
  for (const b of blobs) {
    if (!b.alive) { b.groupBonus = 0; continue; }
    let allies = 0;
    const cx = Math.floor(b.x / cellSize);
    const cy = Math.floor(b.y / cellSize);
    // Check wider area for group radius
    const cells = Math.ceil(groupRadius / cellSize);
    for (let dx = -cells; dx <= cells; dx++) {
      for (let dy = -cells; dy <= cells; dy++) {
        const key = `${cx + dx},${cy + dy}`;
        if (!grid[key]) continue;
        for (const other of grid[key]) {
          if (other.id === b.id || !other.alive || other.team !== b.team) continue;
          if (dist(b, other) <= groupRadius) allies++;
        }
      }
    }
    b.groupBonus = Math.min(allies * (config.groupBonusPerAlly || 0.1), (config.groupBonusMax || 2.0));
  }

  // Combat
  for (const b of blobs) {
    if (!b.alive) continue;
    const cx = Math.floor(b.x / cellSize);
    const cy = Math.floor(b.y / cellSize);
    const neighbors = getCellNeighbors(grid, cx, cy);
    for (const other of neighbors) {
      if (other.id <= b.id) continue;
      if (other.team === b.team) continue;
      resolveCombat(b, other);
    }
    for (const base of bases) {
      if (base.alive) attackBase(b, base);
    }
  }

  // Remove dead blobs
  const deadIds = new Set();
  blobs = blobs.filter(b => {
    if (!b.alive) deadIds.add(b.id);
    return b.alive;
  });
  for (const b of blobs) {
    if (b.attackTarget !== null && deadIds.has(b.attackTarget)) {
      b.attackTarget = null;
    }
  }

  // NPC respawn
  npcRespawnTimer += dt;
  if (npcRespawnTimer >= NPC_RESPAWN_INTERVAL) {
    npcRespawnTimer = 0;
    spawnNPCs(3);
  }

  // Check for eliminated players
  for (const [ws, player] of players) {
    if (!player.alive) continue;
    const base = bases.find(b => b.team === player.team && b.alive);
    const units = blobs.filter(b => b.team === player.team).length;
    if (!base && units === 0) {
      player.alive = false;
      events.push({ type: 'eliminated', team: player.team });
    }
  }

  // Check for winner (only one team with units/base remaining)
  const aliveTeams = new Set();
  for (const base of bases) {
    if (base.alive) aliveTeams.add(base.team);
  }
  for (const b of blobs) {
    if (b.team !== TEAM_NPC) aliveTeams.add(b.team);
  }
  if (players.size >= 2 && aliveTeams.size === 1 && !gameOver) {
    const winner = [...aliveTeams][0];
    events.push({ type: 'victory', team: winner });
    gameOver = true;
    restartTimer = 0;
  }

  // Auto-restart after game over
  if (gameOver) {
    restartTimer += dt;
    if (restartTimer >= RESTART_DELAY) {
      restartGame();
    }
  }
}

// --- Handle client commands ---
function handleCommand(ws, msg) {
  const player = players.get(ws);
  if (!player || !player.alive) return;

  const team = player.team;

  // Validate that the player owns the blob IDs
  const ownedIds = new Set(blobs.filter(b => b.team === team && b.alive).map(b => b.id));

  switch (msg.type) {
    case 'move': {
      const x = Number(msg.x);
      const y = Number(msg.y);
      if (!isFinite(x) || !isFinite(y)) return;
      const ids = (msg.ids || []).filter(id => ownedIds.has(id));
      const count = ids.length;
      for (const id of ids) {
        const b = blobs.find(bl => bl.id === id);
        if (!b) continue;
        const angle = Math.random() * Math.PI * 2;
        const spread = Math.sqrt(count) * 8;
        b.targetX = clamp(x + Math.cos(angle) * rand(0, spread), 0, WORLD_W);
        b.targetY = clamp(y + Math.sin(angle) * rand(0, spread), 0, WORLD_H);
        b.attackTarget = null;
        b.attackMove = false;
      }
      break;
    }
    case 'attack': {
      const targetId = Number(msg.targetId);
      const target = blobs.find(b => b.id === targetId && b.alive && b.team !== team);
      if (!target) return;
      const ids = (msg.ids || []).filter(id => ownedIds.has(id));
      for (const id of ids) {
        const b = blobs.find(bl => bl.id === id);
        if (!b) continue;
        b.attackTarget = targetId;
        b.attackMove = false;
      }
      break;
    }
    case 'attackMove': {
      const x = Number(msg.x);
      const y = Number(msg.y);
      if (!isFinite(x) || !isFinite(y)) return;
      const ids = (msg.ids || []).filter(id => ownedIds.has(id));
      for (const id of ids) {
        const b = blobs.find(bl => bl.id === id);
        if (!b) continue;
        b.targetX = clamp(x, 0, WORLD_W);
        b.targetY = clamp(y, 0, WORLD_H);
        b.attackTarget = null;
        b.attackMove = true;
      }
      break;
    }
    case 'stop': {
      const ids = (msg.ids || []).filter(id => ownedIds.has(id));
      for (const id of ids) {
        const b = blobs.find(bl => bl.id === id);
        if (!b) continue;
        b.targetX = null;
        b.targetY = null;
        b.attackTarget = null;
        b.attackMove = false;
      }
      break;
    }
  }
}

// --- Broadcast state ---
function broadcastState() {
  if (players.size === 0) return;

  // Build compact blob data
  const blobData = blobs.map(b => ({
    id: b.id, x: Math.round(b.x * 10) / 10, y: Math.round(b.y * 10) / 10,
    size: Math.round(b.size * 10) / 10, team: b.team,
    gb: Math.round((b.groupBonus || 0) * 100) / 100,
  }));

  const baseData = bases.filter(b => b.alive).map(b => ({
    team: b.team, x: b.x, y: b.y, hp: Math.round(b.hp), maxHp: b.maxHp,
  }));

  const playerList = [];
  for (const p of players.values()) {
    playerList.push({ team: p.team, alive: p.alive });
  }

  const stateMsg = JSON.stringify({
    type: 'state',
    blobs: blobData,
    bases: baseData,
    players: playerList,
    events: events,
  });

  events = [];

  for (const [ws] of players) {
    if (ws.readyState === 1) { // OPEN
      ws.send(stateMsg);
    }
  }
}

// --- HTTP server to serve client ---
const server = http.createServer((req, res) => {
  if (req.url === '/' || req.url === '/index.html') {
    const filePath = path.join(__dirname, 'index.html');
    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(500);
        res.end('Error loading game');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(data);
    });
  } else {
    res.writeHead(404);
    res.end('Not found');
  }
});

// --- WebSocket server ---
const wss = new WebSocketServer({ server });

wss.on('connection', (ws, req) => {
  const team = allocateTeam();
  if (team === -1) {
    ws.send(JSON.stringify({ type: 'full' }));
    ws.close();
    return;
  }

  const player = { team, alive: true };
  players.set(ws, player);
  spawnPlayer(team);

  const ip = req.socket.remoteAddress;
  console.log(`Player joined: team ${team} from ${ip} (${players.size} players)`);

  ws.send(JSON.stringify({
    type: 'welcome',
    team,
    worldW: WORLD_W,
    worldH: WORLD_H,
  }));

  // Notify all players
  const joinMsg = JSON.stringify({ type: 'playerJoined', team, totalPlayers: players.size });
  for (const [other] of players) {
    if (other.readyState === 1 && other !== ws) other.send(joinMsg);
  }

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw);
      handleCommand(ws, msg);
    } catch (e) {
      // ignore malformed messages
    }
  });

  ws.on('close', () => {
    const p = players.get(ws);
    if (p) {
      console.log(`Player left: team ${p.team} (${players.size - 1} players)`);
      removePlayer(p.team);
      players.delete(ws);

      const leaveMsg = JSON.stringify({ type: 'playerLeft', team: p.team, totalPlayers: players.size });
      for (const [other] of players) {
        if (other.readyState === 1) other.send(leaveMsg);
      }
    }
  });
});

// --- Game loop ---
resetGame();

setInterval(() => {
  tick(TICK_MS);
}, TICK_MS);

setInterval(() => {
  broadcastState();
}, BROADCAST_MS);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Blob RTS server running on http://0.0.0.0:${PORT}`);
  console.log(`Share your IP with friends — they connect to http://<your-ip>:${PORT}`);
});
