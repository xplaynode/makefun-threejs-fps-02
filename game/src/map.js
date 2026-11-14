// map.js -- the Slagline Yard, a decommissioned coastal smelter, as data.
// This module holds no rendering code: just collision boxes, the visual
// blocks matching them, both bomb sites, the team spawns and the waypoint
// graph bots travel on. world.js converts the data into three.js meshes,
// while player.js and bots.js collide against these same boxes, so the
// geometry you see is precisely the geometry you collide with.
//
// Coordinates are metres, x pointing east and z pointing south. Breakers
// spawn in the west, Wardens in the east.
//   * The northern lane leads to Site A, the Furnace Hall.
//   * Mid is split by the crusher house, with a pass on either side.
//   * The southern lane leads to Site B, the Ore Depot.
// Every hall has a west entrance plus a side entrance, so no site is a
// dead end with a single doorway.

function makeBox(cx, cz, width, depth, height, kind) {
  const entry = {
    cx: cx, cz: cz, w: width, d: depth, h: height, kind: kind,
    minX: cx - width / 2, maxX: cx + width / 2,
    minZ: cz - depth / 2, maxZ: cz + depth / 2,
  };
  return entry;
}

export const MAP = {
  bounds: { minX: -48, maxX: 48, minZ: -32, maxZ: 32 },
  colliders: [],
  sites: {
    A: { name: 'Furnace Hall', cx: 31, cz: -18, minX: 22, maxX: 41, minZ: -25, maxZ: -11 },
    B: { name: 'Ore Depot', cx: 31, cz: 18, minX: 22, maxX: 41, minZ: 11, maxZ: 25 },
  },
  spawns: {
    breaker: [[-42, -4], [-42, 0], [-42, 4], [-40, -7], [-40, 7]],
    warden: [[42, -4], [42, 0], [42, 4], [40, -7], [40, 7]],
  },
};

// The `kind` string selects a material in world.js. Known kinds: wall,
// hall, crate, stack (a double crate), low (crouch-height cover),
// container, furnace, machine and barrel.
const boxes = MAP.colliders;

// Outer perimeter walls.
boxes.push(makeBox(0, -32.5, 100, 2, 6, 'wall'));
boxes.push(makeBox(0, 32.5, 100, 2, 6, 'wall'));
boxes.push(makeBox(-48.5, 0, 2, 68, 6, 'wall'));
boxes.push(makeBox(48.5, 0, 2, 68, 6, 'wall'));

// Fences in the west yard, between spawn and the lanes. The gaps around
// x -30..-27 are where the lanes begin.
boxes.push(makeBox(-20.5, -8, 13, 1.2, 4.5, 'wall'));
boxes.push(makeBox(-20.5, 8, 13, 1.2, 4.5, 'wall'));

// Northern lane: wall at z -23 on the north side; on the south side a
// connector gap at x -10..0, with the lane mouth open west of x -30 next
// to the west container.
boxes.push(makeBox(-9, -23, 54, 1.2, 4.5, 'wall'));
boxes.push(makeBox(-20, -13, 20, 1.2, 4.5, 'wall'));
boxes.push(makeBox(7.5, -13, 15, 1.2, 4.5, 'wall'));
// Southern lane mirrors the northern one.
boxes.push(makeBox(-9, 23, 54, 1.2, 4.5, 'wall'));
boxes.push(makeBox(-20, 13, 20, 1.2, 4.5, 'wall'));
boxes.push(makeBox(7.5, 13, 15, 1.2, 4.5, 'wall'));

// Crusher house in the middle: one solid block, played around either side.
boxes.push(makeBox(3, 0, 10, 10, 6.5, 'machine'));

// Site A (Furnace Hall): the west wall leaves a door at z -21..-15, the
// north and east walls are solid, and the south wall leaves a door at
// x 26..30.
boxes.push(makeBox(20, -24, 1.2, 6, 5, 'hall'));
boxes.push(makeBox(20, -12, 1.2, 6, 5, 'hall'));
boxes.push(makeBox(31, -27, 23, 1.2, 5, 'hall'));
boxes.push(makeBox(42, -18, 1.2, 19, 5, 'hall'));
boxes.push(makeBox(23, -9, 6, 1.2, 5, 'hall'));
boxes.push(makeBox(36, -9, 12, 1.2, 5, 'hall'));
// Site B (Ore Depot) is the mirror image.
boxes.push(makeBox(20, 24, 1.2, 6, 5, 'hall'));
boxes.push(makeBox(20, 12, 1.2, 6, 5, 'hall'));
boxes.push(makeBox(31, 27, 23, 1.2, 5, 'hall'));
boxes.push(makeBox(42, 18, 1.2, 19, 5, 'hall'));
boxes.push(makeBox(23, 9, 6, 1.2, 5, 'hall'));
boxes.push(makeBox(36, 9, 12, 1.2, 5, 'hall'));

// Cover pieces scattered through lanes, yards and sites.
const coverPieces = [
  [-36, -8, 'container'], [-36, 8, 'container'], [38, 6, 'stack'], [38, -6, 'crate'],
  [-18, -20.5, 'crate'], [2, -20, 'stack'], [14, -16, 'crate'], [-18, 20.5, 'crate'],
  [2, 20, 'stack'], [14, 16, 'crate'], [-18, -3, 'low'], [-18, 3, 'low'],
  [18, -3, 'low'], [17, 2, 'low'], [-4, -20.5, 'crate'], [-4, 20.5, 'crate'],
  [25, -13.5, 'crate'], [37, -13, 'stack'], [25, 13.5, 'crate'], [37, 13, 'stack'],
  [26, -23, 'crate'], [26, 23, 'crate'], [-27, -5, 'low'], [-27, 5, 'low'],
];
for (const piece of coverPieces) {
  const [px, pz, pkind] = piece;
  if (pkind === 'container') boxes.push(makeBox(px, pz, 7, 2.6, 2.7, pkind));
  else if (pkind === 'stack') boxes.push(makeBox(px, pz, 2.2, 2.2, 2.3, pkind));
  else if (pkind === 'low') boxes.push(makeBox(px, pz, 4.2, 0.9, 1.1, pkind));
  else boxes.push(makeBox(px, pz, 2.2, 2.2, 1.15, pkind));
}
// Site A's furnace is drawn as a cylinder but collides as its bounding
// box; Site B has the ore hopper in the equivalent spot.
boxes.push(makeBox(34, -21, 5, 5, 6, 'furnace'));
boxes.push(makeBox(34, 21, 5, 5, 5, 'machine'));
// Barrels render round and collide square; at this size nobody can tell.
const barrelSpots = [[16, -20], [-24, 20], [24, -6], [1, 9], [44, 12], [-44, -14]];
for (const spot of barrelSpots) {
  boxes.push(makeBox(spot[0], spot[1], 0.9, 0.9, 1.2, 'barrel'));
}

// Waypoints: [x, z] nodes plus edges given as index pairs. Bots navigate
// on this graph; every lane, doorway and site appears on it, and each edge
// is a straight walk that stays clear of the walls.
export const NODES = [
  [-40, 0], [-30, 0], [-12, 0], [0, -7], [0, 7], [14, -7], [14, 7], [28, 0], [40, 0],
  [-31, -18], [-20, -18], [-8, -18], [20, -18], [30, -18], [30, -25], [28, -6],
  [-31, 18], [-20, 18], [-8, 18], [20, 18], [30, 18], [30, 25], [28, 6],
  [0, -11], [0, 11], [36, -18], [36, 18], [12, -18], [12, 18],
];
export const EDGES = [
  [0, 1], [1, 2], [2, 3], [2, 4], [3, 5], [4, 6], [5, 7], [6, 7], [7, 8],
  [1, 9], [9, 10], [10, 11], [11, 27], [27, 12], [12, 13], [13, 14], [13, 25],
  [13, 15], [15, 7], [11, 23], [23, 3], [23, 2],
  [1, 16], [16, 17], [17, 18], [18, 28], [28, 19], [19, 20], [20, 21], [20, 26],
  [20, 22], [22, 7], [18, 24], [24, 4], [24, 2],
  [5, 12], [6, 19], [14, 13], [21, 20],
];
export const ADJ = NODES.map(() => []);
for (const pair of EDGES) {
  ADJ[pair[0]].push(pair[1]);
  ADJ[pair[1]].push(pair[0]);
}

// Places with tactical meaning: where holders sit, which doors they watch,
// and the mid posts.
export const HOLD = {
  A: [14, 25, 13], B: [21, 26, 20], mid: [7, 5, 6],
};
export const SITE_NODE = { A: 13, B: 20 };

// Breadth-first search across the waypoint graph. The result lists node
// indices and includes both the start and the destination.
export function findPath(from, to) {
  if (from === to) return [from];
  const cameFrom = new Array(NODES.length).fill(-1);
  const visited = new Array(NODES.length).fill(false);
  const frontier = [from];
  visited[from] = true;
  while (frontier.length > 0) {
    const current = frontier.shift();
    for (const neighbour of ADJ[current]) {
      if (visited[neighbour]) continue;
      visited[neighbour] = true;
      cameFrom[neighbour] = current;
      if (neighbour === to) {
        const route = [to];
        let cursor = to;
        while (cursor !== from) {
          cursor = cameFrom[cursor];
          route.unshift(cursor);
        }
        return route;
      }
      frontier.push(neighbour);
    }
  }
  return [from];
}

export function nearestNode(x, z) {
  let winner = 0;
  let winnerDist = Infinity;
  for (let idx = 0; idx < NODES.length; idx++) {
    const offsetX = NODES[idx][0] - x;
    const offsetZ = NODES[idx][1] - z;
    const distSq = offsetX * offsetX + offsetZ * offsetZ;
    if (distSq < winnerDist) {
      winnerDist = distSq;
      winner = idx;
    }
  }
  return winner;
}

// Circle collision against the whole map, shared by the player and all
// bots: shove a circle of radius r out of each collider (even the lowest
// cover stands 1.1 m tall, too high to step over) and then clamp the
// result inside the yard bounds. Deciding whether a *shot* passes over
// low cover is combat's job and depends on collider height at the hit
// point, so it is deliberately not handled here.
export function collide(pos, r) {
  const bounds = MAP.bounds;
  pos.x = Math.max(bounds.minX + r, Math.min(bounds.maxX - r, pos.x));
  pos.z = Math.max(bounds.minZ + r, Math.min(bounds.maxZ - r, pos.z));
  for (const col of MAP.colliders) {
    const overlaps = pos.x > col.minX - r && pos.x < col.maxX + r
      && pos.z > col.minZ - r && pos.z < col.maxZ + r;
    if (!overlaps) continue;
    const exitLeft = pos.x - (col.minX - r);
    const exitRight = (col.maxX + r) - pos.x;
    const exitUp = pos.z - (col.minZ - r);
    const exitDown = (col.maxZ + r) - pos.z;
    const smallest = Math.min(exitLeft, exitRight, exitUp, exitDown);
    if (smallest === exitLeft) pos.x = col.minX - r;
    else if (smallest === exitRight) pos.x = col.maxX + r;
    else if (smallest === exitUp) pos.z = col.minZ - r;
    else pos.z = col.maxZ + r;
  }
  return pos;
}
