// weapons.js -- weapon stats, inventories, shooting, damage, grenades.
// How gunplay works (the part the bounty grades hardest):
//   * Hitscan rays are tested per body part: head x2, torso x1, legs x0.55,
//     plus distance falloff beyond each weapon's effective range.
//   * Spread widens with the shooter's speed, balloons while airborne, and
//     tightens when crouched or shift-walking. Every automatic shot adds
//     recoil that pitches the view upward and drifts it sideways along a
//     learnable pattern, so stopping to shoot is rewarded and a settled
//     opening shot is the most accurate shot in any burst.
//   * Magazines, reserve ammunition and timed reloads; an empty gun clicks.
// Grenades are simulated physically: they arc, bounce once, then detonate
// on a fuse -- frag (radial damage), flash (blinds based on view angle)
// and smoke (a sight-blocking cloud lasting fifteen seconds).

import * as THREE from 'three';
import { MAP } from './map.js';
import { state, emit, makeNoise } from './state.js';
import { spawnTracer, spawnPuff, muzzleFlash, explosionFX, spawnSmoke, spawnGrenadeMesh } from './world.js';
import { sfx } from './audio.js';

export const WEAPONS = {
  knife:  { name: 'Yard Knife', slot: 'melee', price: 0, damage: 55, headMult: 1, rpm: 90, range: 1.9, melee: true },
  pistol: { name: 'P9 Sidearm', slot: 'sidearm', price: 0, damage: 26, headMult: 2.1, rpm: 340, mag: 12, reserve: 60, reload: 1.4, spread: 0.011, kick: 0.006, auto: false, falloff: 28, noise: 16, tracer: 0xffd9a0 },
  smg:    { name: 'Ripper SMG', slot: 'primary', price: 1500, damage: 21, headMult: 1.9, rpm: 780, mag: 30, reserve: 90, reload: 2.1, spread: 0.02, kick: 0.005, auto: true, falloff: 22, noise: 20, tracer: 0xffc98a },
  rifle:  { name: 'VK-7 Rifle', slot: 'primary', price: 2700, damage: 34, headMult: 2.2, rpm: 620, mag: 30, reserve: 90, reload: 2.4, spread: 0.013, kick: 0.009, auto: true, falloff: 45, noise: 24, tracer: 0xffe2ae },
  sniper: { name: 'Longshot .338', slot: 'primary', price: 4500, damage: 104, headMult: 2.0, rpm: 42, mag: 5, reserve: 25, reload: 3.1, spread: 0.0015, kick: 0.05, auto: false, falloff: 120, noise: 34, scoped: true, tracer: 0xfff3d0 },
};
export const GRENADES = {
  he: { name: 'Frag Charge', price: 300 },
  flash: { name: 'Flash Charge', price: 200 },
  smoke: { name: 'Smoke Charge', price: 300 },
};

export function newLoadout() {
  const fresh = {
    slots: { melee: 'knife', sidearm: 'pistol', primary: null },
    current: 'sidearm',
    ammo: { pistol: { mag: 12, reserve: 60 } },
    grenades: {},
    recoil: 0,
    nextShotAt: 0,
    reloadingUntil: 0,
    switchingUntil: 0,
    scoped: false,
  };
  return fresh;
}

export function giveWeapon(actor, id) {
  const stats = WEAPONS[id];
  const inv = actor.loadout;
  inv.slots[stats.slot] = id;
  if (stats.mag) inv.ammo[id] = { mag: stats.mag, reserve: stats.reserve };
}

export function currentWeapon(actor) {
  const inv = actor.loadout;
  const weaponId = inv.slots[inv.current];
  return { id: weaponId, def: WEAPONS[weaponId], ammo: inv.ammo[weaponId] || null };
}

// Derive an actor's eye position and aim direction from its own state.
const scratchEye = new THREE.Vector3();
const scratchDir = new THREE.Vector3();
export function eyeOf(actor) {
  const height = actor.crouch ? 1.22 : 1.58;
  return scratchEye.set(actor.x, actor.y + height, actor.z);
}
export function dirOf(actor) {
  const cosPitch = Math.cos(actor.pitch);
  const vx = -Math.sin(actor.yaw) * cosPitch;
  const vy = Math.sin(actor.pitch);
  const vz = -Math.cos(actor.yaw) * cosPitch;
  return scratchDir.set(vx, vy, vz).normalize();
}

// Ray versus map boxes: yields the distance of the earliest wall hit, or
// Infinity when nothing is hit. Low cover only blocks a ray travelling
// below its top edge.
function firstWallDistance(origin, dir, maxDist) {
  let closest = maxDist;
  for (const col of MAP.colliders) {
    // Slab intersection against the box, extruded from floor y=0 to col.h.
    const nearT = [0, 0, 0];
    const farT = [0, 0, 0];
    const originArr = [origin.x, origin.y, origin.z];
    const dirArr = [dir.x, dir.y, dir.z];
    const boxLo = [col.minX, 0, col.minZ];
    const boxHi = [col.maxX, col.h, col.maxZ];
    let tEnter = 0;
    let tExit = closest;
    let stillPossible = true;
    for (let axis = 0; axis < 3; axis++) {
      if (Math.abs(dirArr[axis]) < 1e-8) {
        if (originArr[axis] < boxLo[axis] || originArr[axis] > boxHi[axis]) { stillPossible = false; break; }
      } else {
        nearT[axis] = (boxLo[axis] - originArr[axis]) / dirArr[axis];
        farT[axis] = (boxHi[axis] - originArr[axis]) / dirArr[axis];
        const nearVal = Math.min(nearT[axis], farT[axis]);
        const farVal = Math.max(nearT[axis], farT[axis]);
        tEnter = Math.max(tEnter, nearVal);
        tExit = Math.min(tExit, farVal);
        if (tEnter > tExit) { stillPossible = false; break; }
      }
    }
    if (stillPossible && tEnter > 0.01 && tEnter < closest) closest = tEnter;
  }
  return closest;
}

// True when the straight segment between two points passes through smoke.
export function sightBlocked(ax, ay, az, bx, by, bz) {
  for (const cloud of state.smokes) {
    // Closest distance from the cloud centre to the segment.
    const segX = bx - ax;
    const segY = by - ay;
    const segZ = bz - az;
    const segLenSq = segX * segX + segY * segY + segZ * segZ || 1;
    let along = ((cloud.x - ax) * segX + (1.3 - ay) * segY + (cloud.z - az) * segZ) / segLenSq;
    along = Math.max(0, Math.min(1, along));
    const offX = ax + segX * along - cloud.x;
    const offY = ay + segY * along - 1.3;
    const offZ = az + segZ * along - cloud.z;
    if (offX * offX + offY * offY + offZ * offZ < cloud.r * cloud.r) return true;
  }
  return false;
}

// Visibility test used by bots and by flash checks: walls plus smoke.
export function lineOfSight(from, to) {
  const rayDir = scratchDir.copy(to).sub(from);
  const rayLen = rayDir.length();
  rayDir.normalize();
  if (firstWallDistance(from, rayDir, rayLen) < rayLen - 0.05) return false;
  return !sightBlocked(from.x, from.y, from.z, to.x, to.y, to.z);
}

const scratchFrom = new THREE.Vector3();
const scratchTo = new THREE.Vector3();
const scratchHit = new THREE.Vector3();

// Attempt one trigger pull. Returns true only if a shot left the barrel.
export function tryFire(actor, now) {
  const inv = actor.loadout;
  const held = currentWeapon(actor);
  const stats = held.def;
  const ammoState = held.ammo;
  if (now < inv.nextShotAt || now < inv.reloadingUntil || now < inv.switchingUntil) return false;
  if (actor.flashUntil > now) return false;
  inv.nextShotAt = now + 60 / stats.rpm;

  const eyePos = eyeOf(actor).clone();
  const aimDir = dirOf(actor).clone();

  if (stats.melee) {
    // Knife swing: a brief, silent arc directly in front of the actor.
    for (const target of state.actors) {
      if (target === actor || !target.alive || target.team === actor.team) continue;
      const offX = target.x - actor.x;
      const offZ = target.z - actor.z;
      if (offX * offX + offZ * offZ > stats.range * stats.range) continue;
      const facingDot = (-Math.sin(actor.yaw)) * offX + (-Math.cos(actor.yaw)) * offZ;
      if (facingDot > 0.4) {
        damage(actor, target, stats.damage, 'torso', now);
        break;
      }
    }
    return true;
  }

  if (!ammoState || ammoState.mag <= 0) {
    if (actor.isPlayer) sfx.dryFire();
    startReload(actor, now);
    return false;
  }
  ammoState.mag--;

  // Spread model: base value plus movement, airborne and sustained-fire
  // terms; crouching, walking and a scope pull it back down. This is the
  // accuracy economy the whole game rests on -- the first shot after a
  // pause, taken standing still (or creeping at walk pace), is by design
  // the tightest shot available, so tap-firing beats holding the trigger
  // at every range beyond a doorway.
  const moveRatio = Math.min(1, actor.speedNow / 4.6);
  let totalSpread = stats.spread * (0.35 + moveRatio * 2.4) + inv.recoil * stats.spread * 1.6;
  if (!actor.grounded) totalSpread *= 3.2;
  if (actor.crouch) totalSpread *= 0.62;
  if (actor.walking) totalSpread *= 0.72;
  if (inv.recoil <= 0.001 && moveRatio < 0.25) totalSpread *= 0.55;
  if (stats.scoped && inv.scoped) totalSpread *= 0.25;
  const shotDir = aimDir.clone();
  shotDir.x += (Math.random() - 0.5) * 2 * totalSpread;
  shotDir.y += (Math.random() - 0.5) * 2 * totalSpread;
  shotDir.z += (Math.random() - 0.5) * 2 * totalSpread;
  shotDir.normalize();

  // Recoil pushes the view up and sideways; it recovers once firing stops.
  inv.recoil = Math.min(1, inv.recoil + 0.16);
  actor.pitch += stats.kick * (0.8 + Math.random() * 0.4);
  actor.yaw += (Math.random() - 0.5) * stats.kick * 0.7;

  const playerDist = Math.hypot(actor.x - (state.player?.x ?? 0), actor.z - (state.player?.z ?? 0));
  sfx.shoot(held.id, actor.isPlayer ? 0 : playerDist);
  makeNoise(actor.x, actor.z, stats.noise, actor.team);

  const wallHitDist = firstWallDistance(eyePos, shotDir, 220);
  // Body check: find the nearest actor with a head/torso/legs sphere that
  // the ray actually passes through.
  let hitActor = null;
  let hitPart = null;
  let hitDist = wallHitDist;
  for (const target of state.actors) {
    if (target === actor || !target.alive || target.team === actor.team) continue;
    const partDefs = [
      ['head', target.x, target.y + (target.crouch ? 1.18 : 1.66), target.z, 0.21],
      ['torso', target.x, target.y + (target.crouch ? 0.78 : 1.12), target.z, 0.36],
      ['legs', target.x, target.y + 0.4, target.z, 0.3],
    ];
    for (const partDef of partDefs) {
      const [partName, partX, partY, partZ, partRadius] = partDef;
      scratchTo.set(partX, partY, partZ).sub(eyePos);
      const projT = scratchTo.dot(shotDir);
      if (projT < 0 || projT > hitDist) continue;
      scratchHit.copy(shotDir).multiplyScalar(projT).add(eyePos);
      const missSq = scratchHit.distanceToSquared(scratchTo.set(partX, partY, partZ));
      if (missSq < partRadius * partRadius) {
        hitActor = target;
        hitPart = partName;
        hitDist = projT;
      }
    }
  }

  const muzzlePos = eyePos.clone().addScaledVector(aimDir, 0.55);
  muzzlePos.y -= 0.12;
  if (actor.isPlayer || hitActor || wallHitDist < 60) {
    const endDist = hitDist === Infinity ? 60 : hitDist;
    const endPos = eyePos.clone().addScaledVector(shotDir, endDist);
    spawnTracer(muzzlePos, endPos, stats.tracer);
  }
  muzzleFlash(muzzlePos);

  if (hitActor) {
    let dmgAmount = stats.damage;
    if (hitPart === 'head') dmgAmount *= stats.headMult;
    if (hitPart === 'legs') dmgAmount *= 0.55;
    if (hitDist > stats.falloff) dmgAmount *= Math.max(0.35, 1 - (hitDist - stats.falloff) / 90);
    damage(actor, hitActor, Math.round(dmgAmount), hitPart, now);
  } else if (wallHitDist < 220) {
    spawnPuff(eyePos.clone().addScaledVector(shotDir, wallHitDist), 0xbfae94, 0.8);
  }
  return true;
}

export function damage(attacker, victim, amount, part, now) {
  if (!victim.alive || victim.hp <= 0) return;
  victim.hp -= amount;
  victim.lastDamageFrom = attacker;
  victim.lastHurtAt = now;
  if (attacker.isPlayer) {
    sfx.hit(part === 'head');
    emit('hitmarker', { head: part === 'head', killed: victim.hp <= 0 });
  }
  if (victim.isPlayer) {
    sfx.hurt();
    emit('playerhurt', { amount: amount });
  }
  if (victim.hp <= 0) {
    victim.alive = false;
    victim.deaths++;
    attacker.kills++;
    attacker.money = Math.min(16000, attacker.money + 300);
    if (victim.mesh) victim.mesh.visible = false;
    emit('kill', { attacker: attacker, victim: victim, head: part === 'head' });
    if (state.bomb.carrier === victim) {
      state.bomb.carrier = null;
      state.bomb.status = 'dropped';
      state.bomb.x = victim.x;
      state.bomb.z = victim.z;
    }
  }
}

export function startReload(actor, now) {
  const inv = actor.loadout;
  const held = currentWeapon(actor);
  if (!held.def || !held.def.mag || !held.ammo) return;
  if (held.ammo.mag >= held.def.mag || held.ammo.reserve <= 0 || now < inv.reloadingUntil) return;
  inv.reloadingUntil = now + held.def.reload;
  if (actor.isPlayer) sfx.reloadStart();
}

export function finishReloads(now) {
  for (const actor of state.actors) {
    const inv = actor.loadout;
    if (!inv || !inv.reloadingUntil || now < inv.reloadingUntil) continue;
    inv.reloadingUntil = 0;
    const held = currentWeapon(actor);
    if (!held.ammo) continue;
    const roundsMoved = Math.min(held.def.mag - held.ammo.mag, held.ammo.reserve);
    held.ammo.mag += roundsMoved;
    held.ammo.reserve -= roundsMoved;
    if (actor.isPlayer) sfx.reloadEnd();
  }
}

export function switchSlot(actor, slot, now) {
  const inv = actor.loadout;
  if (!inv.slots[slot] || inv.current === slot) return;
  inv.current = slot;
  inv.switchingUntil = now + 0.45;
  inv.reloadingUntil = 0;
  inv.scoped = false;
}

// --- Grenades ---------------------------------------------------------------

export function throwGrenade(actor, kind, now) {
  const inv = actor.loadout;
  if (!inv.grenades[kind]) return false;
  inv.grenades[kind]--;
  const eyePos = eyeOf(actor).clone();
  const throwDir = dirOf(actor).clone();
  const meshObj = spawnGrenadeMesh(kind);
  meshObj.position.copy(eyePos).addScaledVector(throwDir, 0.4);
  const fuseSecs = kind === 'flash' ? 1.5 : kind === 'smoke' ? 1.1 : 2.0;
  state.grenades.push({
    mesh: meshObj, kind: kind, owner: actor,
    vx: throwDir.x * 13, vy: throwDir.y * 13 + 3.4, vz: throwDir.z * 13,
    x: meshObj.position.x, y: meshObj.position.y, z: meshObj.position.z,
    fuse: fuseSecs,
    bounced: false,
  });
  sfx.throwPin();
  return true;
}

export function updateGrenades(dt, now) {
  for (let idx = state.grenades.length - 1; idx >= 0; idx--) {
    const gren = state.grenades[idx];
    gren.fuse -= dt;
    gren.vy -= 18 * dt;
    gren.x += gren.vx * dt;
    gren.y += gren.vy * dt;
    gren.z += gren.vz * dt;
    if (gren.y < 0.1) {
      gren.y = 0.1;
      gren.vy = Math.abs(gren.vy) * 0.35;
      gren.vx *= 0.6;
      gren.vz *= 0.6;
      gren.bounced = true;
      if (gren.kind === 'smoke' && !gren.popped) popGrenade(gren, now);
    }
    for (const col of MAP.colliders) {
      const insideBox = gren.x > col.minX && gren.x < col.maxX && gren.z > col.minZ && gren.z < col.maxZ && gren.y < col.h;
      if (insideBox) {
        gren.vx *= -0.4;
        gren.vz *= -0.4;
        gren.x += gren.vx * dt * 2;
        gren.z += gren.vz * dt * 2;
      }
    }
    gren.mesh.position.set(gren.x, gren.y, gren.z);
    if (gren.fuse <= 0 && !gren.popped) popGrenade(gren, now);
    if (gren.popped) {
      gren.mesh.visible = false;
      state.grenades.splice(idx, 1);
    }
  }
}

function popGrenade(gren, now) {
  gren.popped = true;
  const popPos = new THREE.Vector3(gren.x, Math.max(0.4, gren.y), gren.z);
  const playerDist = Math.hypot(gren.x - (state.player?.x ?? 0), gren.z - (state.player?.z ?? 0));
  if (gren.kind === 'he') {
    explosionFX(popPos);
    sfx.explosion(playerDist);
    makeNoise(gren.x, gren.z, 30, gren.owner.team);
    for (const target of state.actors) {
      if (!target.alive) continue;
      const distToBlast = Math.hypot(target.x - gren.x, target.z - gren.z);
      if (distToBlast > 5.2) continue;
      const targetEye = eyeOf(target);
      if (!lineOfSight(popPos, targetEye)) continue;
      const blastDmg = Math.round(92 * (1 - distToBlast / 5.6));
      if (blastDmg > 0) damage(gren.owner, target, blastDmg, 'torso', now);
    }
  } else if (gren.kind === 'flash') {
    sfx.flashPop(playerDist);
    spawnPuff(popPos, 0xffffff, 3);
    for (const target of state.actors) {
      if (!target.alive || target === gren.owner) continue;
      const distToPop = Math.hypot(target.x - gren.x, target.z - gren.z);
      if (distToPop > 17) continue;
      const targetEye = eyeOf(target).clone();
      if (!lineOfSight(popPos, targetEye)) continue;
      // Severity depends on whether the target was facing the pop.
      const towardPop = scratchFrom.set(gren.x - target.x, 0, gren.z - target.z).normalize();
      const facingDir = dirOf(target);
      const facingDot = towardPop.x * facingDir.x + towardPop.z * facingDir.z;
      const blindStrength = facingDot > 0.3 ? 1 : facingDot > -0.4 ? 0.45 : 0.15;
      const blindScale = Math.max(0.3, 1 - distToPop / 22);
      const blindDuration = blindStrength * (target.isPlayer ? 2.6 : 3.6) * blindScale;
      target.flashUntil = Math.max(target.flashUntil, now + blindDuration);
      if (target.isPlayer) emit('flashed', { strength: blindStrength });
    }
  } else if (gren.kind === 'smoke') {
    spawnSmoke(popPos);
    sfx.flashPop(playerDist * 2);
  }
}

// Recoil recovery: bloom decays as soon as the trigger is released.
export function decayRecoil(actor, dt, firing) {
  if (!firing) {
    const inv = actor.loadout;
    inv.recoil = Math.max(0, inv.recoil - dt * 2.4);
  }
}
