// selftest.mjs — SLAGLINE's own checks, run with:
//   node --experimental-vm-modules tools/selftest.mjs
// 1. Every game source file parses as an ES module (the gate's js_parses row).
// 2. The map data is sound: the waypoint graph is connected, every edge is a
//    walkable straight line that clears the tall walls, spawns and sites sit
//    inside the yard, and findPath links the key places bots must reach.
// 3. The economy state starts clean: both loss streaks at zero, so the first
//    loss of a match pays the base loss bonus and no other figure.

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = fileURLToPath(new URL('..', import.meta.url));
let pass = 0, fail = 0;
function check(name, ok, detail = '') {
  if (ok) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name} ${detail}`); }
}

// 1. Parse every source module.
const srcDir = join(root, 'game', 'src');
for (const file of readdirSync(srcDir).filter((f) => f.endsWith('.js'))) {
  const code = readFileSync(join(srcDir, file), 'utf8');
  try {
    new vm.SourceTextModule(code);
    check(`parses: game/src/${file}`, true);
  } catch (err) {
    check(`parses: game/src/${file}`, false, String(err.message).slice(0, 120));
  }
}
for (const file of ['main.ts', 'serve.ts']) {
  const raw = readFileSync(join(root, file), 'utf8');
  try {
    const { stripTypeScriptTypes } = await import('node:module');
    new vm.SourceTextModule(stripTypeScriptTypes(raw));
    check(`parses: ${file}`, true);
  } catch (err) { check(`parses: ${file}`, false, String(err.message).slice(0, 120)); }
}

// 2. Map integrity (map.js is pure data — importable in Node).
const { MAP, NODES, EDGES, ADJ, findPath, nearestNode } = await import(join(root, 'game', 'src', 'map.js'));

check('waypoint graph has nodes and edges', NODES.length >= 24 && EDGES.length >= 30);
let edgesValid = true;
for (const [a, b] of EDGES) {
  if (!NODES[a] || !NODES[b] || !ADJ[a].includes(b) || !ADJ[b].includes(a)) edgesValid = false;
}
check('every edge is bidirectional and in range', edgesValid);

// Connectivity: BFS from node 0 reaches every node.
const seen = new Set([0]);
const queue = [0];
while (queue.length) {
  const cur = queue.shift();
  for (const n of ADJ[cur]) if (!seen.has(n)) { seen.add(n); queue.push(n); }
}
check('waypoint graph is fully connected', seen.size === NODES.length, `reached ${seen.size}/${NODES.length}`);

// Edge clearance: walking each edge's straight line must not pass through any
// collider — bots collide with every box in game, low cover included (sampled
// every 0.2 m, 0.34 m clearance: a bot's radius is 0.42, walls get slid along).
function pointBlocked(x, z) {
  for (const c of MAP.colliders) {
    if (x > c.minX - 0.34 && x < c.maxX + 0.34 && z > c.minZ - 0.34 && z < c.maxZ + 0.34) return c;
  }
  return null;
}
let blockedEdges = [];
for (const [a, b] of EDGES) {
  const [x1, z1] = NODES[a], [x2, z2] = NODES[b];
  const len = Math.hypot(x2 - x1, z2 - z1);
  const steps = Math.ceil(len / 0.2);
  for (let i = 0; i <= steps; i++) {
    const x = x1 + (x2 - x1) * (i / steps), z = z1 + (z2 - z1) * (i / steps);
    const hit = pointBlocked(x, z);
    if (hit) { blockedEdges.push(`${a}->${b} at (${x.toFixed(1)},${z.toFixed(1)}) hits ${hit.kind} (${hit.minX},${hit.minZ})-(${hit.maxX},${hit.maxZ})`); break; }
  }
}
check('every waypoint edge clears tall walls', blockedEdges.length === 0, blockedEdges.slice(0, 4).join(' | '));

// Sites and spawns inside the yard and out of the walls.
let spotsOk = true;
for (const list of [MAP.spawns.breaker, MAP.spawns.warden]) {
  for (const [x, z] of list) if (pointBlocked(x, z)) spotsOk = false;
}
for (const s of Object.values(MAP.sites)) {
  if (s.minX < MAP.bounds.minX || s.maxX > MAP.bounds.maxX) spotsOk = false;
}
check('spawns are unobstructed and sites are in bounds', spotsOk);

// Paths the game depends on: both spawns to both sites, site to site.
const bs = nearestNode(-40, 0), ws = nearestNode(40, 0);
const aNode = 13, bNode = 20;
for (const [from, to, label] of [[bs, aNode, 'breaker spawn -> A'], [bs, bNode, 'breaker spawn -> B'],
  [ws, aNode, 'warden spawn -> A'], [ws, bNode, 'warden spawn -> B'], [aNode, bNode, 'A -> B']]) {
  const path = findPath(from, to);
  check(`path exists: ${label}`, path.length > 1 && path[path.length - 1] === to, `len ${path.length}`);
}

// 3. Economy state starts clean (state.js is pure data — importable in Node).
const { state } = await import(join(root, 'game', 'src', 'state.js'));
check('loss streaks start at zero for both teams',
  state.lossStreak.breaker === 0 && state.lossStreak.warden === 0 && state.lastRoundWinner === null);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
