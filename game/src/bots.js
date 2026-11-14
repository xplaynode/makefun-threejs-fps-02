// bots.js -- the nine AI yard-hands.
// Every bot perceives the world through the same channels the player plays
// against: a vision cone with line-of-sight through the real map geometry,
// hearing for gunfire and footsteps, a reaction delay, and burst
// discipline. Movement follows the waypoint graph from map.js: Wardens
// hold the sites and mid, Breakers attack a called site behind the bomb
// carrier, and both sides rotate once the charge is planted -- the
// planter's team sets a crossfire while the other team pushes the retake
// and the nearest Warden attempts the defuse.
//
// Two behaviours were sharpened in this build:
//   * Hearing now has memory and restraint. A holder that hears enemy
//     noise leaves its spot to investigate, remembers where home was, and
//     returns once the trail goes cold -- instead of abandoning the site
//     for the rest of the round or chasing every footstep across the
//     yard. A cooldown prevents two noises in a row from yo-yoing a
//     holder back and forth between angles.
//   * Wounded bots fight wounded. Below 35 hp a bot crouches between
//     bursts, pauses longer and fires shorter bursts: it exchanges damage
//     output for survival, so an injured holder becomes a smaller, harder
//     target rather than a free kill standing in the open.

import * as THREE from 'three';
import { NODES, findPath, nearestNode, collide, MAP } from './map.js';
import { state, PHASE, makeNoise } from './state.js';
import { eyeOf, lineOfSight, tryFire, startReload, throwGrenade, currentWeapon, WEAPONS, giveWeapon } from './weapons.js';

const BOT_RUN_SPEED = 4.35;
const SENSE_INTERVAL = 0.12;

export function makeAI(role) {
  const brain = {
    role: role,
    // Multiplier for aim quality and reaction speed.
    skill: 0.75 + Math.random() * 0.45,
    node: 0,
    path: [],
    pathI: 0,
    // Current movement destination.
    tx: 0,
    tz: 0,
    // advance | hold | engage | plant | defuse | pickup
    mode: 'advance',
    enemy: null,
    seenAt: -9,
    lastSeenX: 0,
    lastSeenZ: 0,
    senseAt: Math.random() * SENSE_INTERVAL,
    reactAt: 0,
    burstUntil: 0,
    pauseUntil: 0,
    strafeDir: 1,
    strafeAt: 0,
    scanYaw: 0,
    scanAt: 0,
    planSite: 'A',
    grenadeAt: 0,
    stepAcc: 0,
    // Hearing memory (see header): the home spot, how long an
    // investigation may last, and when the bot may leave again.
    homeNode: -1,
    investigateUntil: 0,
    hearCooldownUntil: 0,
  };
  return brain;
}

// Round setup: the Wardens split 2/2/1 over A, B and mid, while the
// Breakers pick one site and attack it as a pack behind the carrier.
export function planRound(bots, carrier, siteCall) {
  const wardenBots = bots.filter((entry) => entry.team === 'warden');
  const breakerBots = bots.filter((entry) => entry.team === 'breaker');
  const wardenAssignments = [
    { nodes: [14, 25], site: 'A' }, { nodes: [25, 13], site: 'A' },
    { nodes: [21, 26], site: 'B' }, { nodes: [26, 20], site: 'B' },
    { nodes: [7], site: 'mid' },
  ];
  wardenBots.forEach((bot, idx) => {
    const brain = bot.ai;
    const assignment = wardenAssignments[idx % wardenAssignments.length];
    brain.role = 'hold';
    brain.retakeSet = false;
    brain.crouchHold = Math.random() < 0.45;
    brain.planSite = assignment.site;
    brain.homeNode = assignment.nodes[0];
    brain.investigateUntil = 0;
    brain.hearCooldownUntil = 0;
    setPathTo(bot, brain.homeNode);
    brain.mode = 'advance';
    brain.thenHold = true;
  });
  breakerBots.forEach((bot) => {
    const brain = bot.ai;
    brain.retakeSet = false;
    brain.crouchHold = false;
    brain.planSite = siteCall;
    brain.homeNode = -1;
    brain.investigateUntil = 0;
    brain.role = bot === carrier ? 'carrier' : 'rifle';
    // Spread entries across doors so the pack does not queue at one doorway.
    const doorNodes = siteCall === 'A' ? [13, 25, 15, 14] : [20, 26, 22, 21];
    const packIndex = breakerBots.indexOf(bot);
    setPathTo(bot, doorNodes[packIndex % doorNodes.length]);
    brain.mode = 'advance';
    brain.thenHold = false;
  });
}

function setPathTo(bot, targetNode) {
  const brain = bot.ai;
  const startNode = nearestNode(bot.x, bot.z);
  brain.path = findPath(startNode, targetNode);
  brain.pathI = 0;
  advanceWaypoint(bot);
}

function advanceWaypoint(bot) {
  const brain = bot.ai;
  if (brain.pathI >= brain.path.length) {
    brain.tx = bot.x;
    brain.tz = bot.z;
    return;
  }
  const waypoint = NODES[brain.path[brain.pathI]];
  brain.tx = waypoint[0];
  brain.tz = waypoint[1];
}

// Bots shop like players do: occasionally a sniper for a rich bot, a rifle
// when rich, an SMG on a save round, and a grenade when spare money
// remains. A bot on a team with a loss streak waits one extra round before
// forcing an SMG, mirroring the streak-scaled loss bonus in match.js -- the
// economy reads identically on both sides of the buy menu.
export function botBuy(bot) {
  const inv = bot.loadout;
  const teamStreak = state.lossStreak[bot.team] || 0;
  if (!inv.slots.primary) {
    if (bot.money >= WEAPONS.sniper.price && Math.random() < 0.3) {
      bot.money -= WEAPONS.sniper.price;
      giveWeapon(bot, 'sniper');
    } else if (bot.money >= WEAPONS.rifle.price) {
      bot.money -= WEAPONS.rifle.price;
      giveWeapon(bot, 'rifle');
    } else if (bot.money >= WEAPONS.smg.price && bot.ai.roundsSinceBuy > 1 && teamStreak < 2) {
      bot.money -= WEAPONS.smg.price;
      giveWeapon(bot, 'smg');
    }
  }
  if (Math.random() < 0.4 && bot.money > 600) {
    const kinds = ['he', 'flash', 'smoke'];
    const pickedKind = kinds[Math.floor(Math.random() * 3)];
    bot.money -= pickedKind === 'flash' ? 200 : 300;
    inv.grenades[pickedKind] = 1;
  }
  bot.ai.roundsSinceBuy = inv.slots.primary ? 0 : (bot.ai.roundsSinceBuy || 0) + 1;
  inv.current = inv.slots.primary ? 'primary' : 'sidearm';
}

const scratchOrigin = new THREE.Vector3();
const scratchTarget = new THREE.Vector3();

function runSense(bot, now) {
  const brain = bot.ai;
  const eyePos = eyeOf(bot);
  scratchOrigin.set(eyePos.x, eyePos.y, eyePos.z);
  let nearestFoe = null;
  let nearestFoeDist = Infinity;
  for (const other of state.actors) {
    if (other === bot || !other.alive || other.team === bot.team) continue;
    const offX = other.x - bot.x;
    const offZ = other.z - bot.z;
    const gap = Math.hypot(offX, offZ);
    if (gap > 58) continue;
    // Vision cone of 150 degrees, forgiving at point-blank range.
    if (gap > 3) {
      const facingX = -Math.sin(bot.yaw);
      const facingZ = -Math.cos(bot.yaw);
      const towardDot = (offX * facingX + offZ * facingZ) / (gap || 1);
      if (towardDot < -0.25) continue;
    }
    scratchTarget.set(other.x, other.y + 1.25, other.z);
    if (!lineOfSight(scratchOrigin, scratchTarget)) continue;
    if (gap < nearestFoeDist) {
      nearestFoeDist = gap;
      nearestFoe = other;
    }
  }
  if (nearestFoe) {
    if (brain.enemy !== nearestFoe) brain.reactAt = now + 0.34 / brain.skill;
    brain.enemy = nearestFoe;
    brain.seenAt = now;
    brain.lastSeenX = nearestFoe.x;
    brain.lastSeenZ = nearestFoe.z;
  }
  // Hearing: fresh enemy noise draws a holder off its spot to investigate,
  // but only off cooldown, and the excursion is time-boxed -- updateBot
  // sends the bot home once investigateUntil passes without contact, so
  // one distant footstep can no longer remove a site holder for good.
  // Gunfire (wide noise radius) is always worth checking; quiet footsteps
  // only draw a holder whose own site is being crept on (short radius).
  const mayInvestigate = brain.mode === 'hold' && now >= brain.hearCooldownUntil && brain.homeNode >= 0;
  if (mayInvestigate) {
    for (const noiseEntry of state.noise) {
      if (noiseEntry.team === bot.team || now - noiseEntry.t < 0.4) continue;
      const noiseGap = Math.hypot(noiseEntry.x - bot.x, noiseEntry.z - bot.z);
      if (noiseGap < noiseEntry.r) {
        brain.mode = 'advance';
        setPathTo(bot, nearestNode(noiseEntry.x, noiseEntry.z));
        brain.thenHold = true;
        brain.investigateUntil = now + 5.5;
        brain.hearCooldownUntil = now + 9;
        break;
      }
    }
  }
}

export function updateBot(bot, dt, now) {
  const brain = bot.ai;
  if (!bot.alive) return;
  // Blinded bots stand still and sway until the flash wears off.
  if (bot.flashUntil > now) {
    bot.speedNow = 0;
    return;
  }

  brain.senseAt -= dt;
  if (brain.senseAt <= 0) {
    brain.senseAt = SENSE_INTERVAL;
    runSense(bot, now);
  }

  const hasContact = brain.enemy && brain.enemy.alive && now - brain.seenAt < 0.25;
  const currentPhase = state.phase;
  let desiredX = brain.tx;
  let desiredZ = brain.tz;
  let desiredSpeed = BOT_RUN_SPEED;
  let facingX = null;
  let facingZ = null;

  // An investigation that turned up nothing is over: head home and hold
  // again. Only contact (hasContact, or fresher noise extending the box
  // inside runSense) keeps a bot out beyond its investigateUntil.
  const investigationExpired = brain.investigateUntil && now > brain.investigateUntil && !hasContact
    && brain.mode === 'advance' && brain.homeNode >= 0 && currentPhase === PHASE.LIVE;
  if (investigationExpired) {
    brain.investigateUntil = 0;
    setPathTo(bot, brain.homeNode);
    brain.thenHold = true;
  }
  if (hasContact) brain.investigateUntil = 0;

  // Bomb duties outrank wandering. After a plant the Wardens retake
  // together (their path is assigned once) and the Breakers settle onto
  // the site to hold the post-plant.
  if (currentPhase === PHASE.PLANTED && bot.team === 'warden' && brain.mode !== 'defuse' && !brain.retakeSet) {
    brain.retakeSet = true;
    setPathTo(bot, nearestNode(state.bomb.x, state.bomb.z));
    brain.mode = 'advance';
    brain.thenHold = false;
  }
  if (currentPhase === PHASE.PLANTED && bot.team === 'breaker' && brain.pathI >= brain.path.length) {
    brain.mode = 'hold';
    brain.crouchHold = Math.random() < 0.5;
  }
  if (currentPhase === PHASE.PLANTED && bot.team === 'warden') {
    const bombGap = Math.hypot(state.bomb.x - bot.x, state.bomb.z - bot.z);
    if (bombGap < 1.7) brain.mode = 'defuse';
  }
  if (currentPhase === PHASE.LIVE && bot.team === 'breaker' && state.bomb.status === 'dropped' && brain.mode !== 'pickup') {
    if (bot === nearestBreakerToBomb()) {
      setPathTo(bot, nearestNode(state.bomb.x, state.bomb.z));
      brain.mode = 'pickup';
    }
  }
  if (brain.mode === 'pickup' && state.bomb.status === 'carried') brain.mode = 'advance';
  if (brain.mode === 'defuse') {
    desiredX = state.bomb.x;
    desiredZ = state.bomb.z;
    desiredSpeed = 0;
  }

  // The carrier plants on reaching the site; match.js runs the channel.
  if (bot === state.bomb.carrier && currentPhase === PHASE.LIVE && brain.mode !== 'plant') {
    const siteBox = MAP.sites[brain.planSite];
    const insideSite = bot.x > siteBox.minX && bot.x < siteBox.maxX && bot.z > siteBox.minZ && bot.z < siteBox.maxZ;
    if (insideSite) brain.mode = 'plant';
  }
  if (brain.mode === 'plant') desiredSpeed = 0;

  if (hasContact) {
    const foe = brain.enemy;
    facingX = foe.x;
    facingZ = foe.z;
    const foeGap = Math.hypot(foe.x - bot.x, foe.z - bot.z);
    // Combat movement: close to mid range, strafe between bursts, and hold
    // ground up close. A wounded bot (under 35 hp) stops strafing wide and
    // crouches in place between bursts instead -- a smaller target that
    // still covers the angle.
    const isHurt = bot.hp < 35;
    brain.strafeAt -= dt;
    if (brain.strafeAt <= 0) {
      brain.strafeAt = 0.6 + Math.random() * 0.9;
      brain.strafeDir = Math.random() < 0.5 ? -1 : 1;
    }
    const dirToFoeX = (foe.x - bot.x) / (foeGap || 1);
    const dirToFoeZ = (foe.z - bot.z) / (foeGap || 1);
    if (foeGap > 16) {
      desiredX = foe.x;
      desiredZ = foe.z;
      desiredSpeed = BOT_RUN_SPEED;
      bot.crouch = false;
    } else if (foeGap < 5) {
      desiredX = bot.x - dirToFoeX * 2;
      desiredZ = bot.z - dirToFoeZ * 2;
      desiredSpeed = 2.4;
      bot.crouch = isHurt;
    } else if (isHurt) {
      desiredX = bot.x;
      desiredZ = bot.z;
      desiredSpeed = 0;
      bot.crouch = true;
    } else {
      desiredX = bot.x + -dirToFoeZ * brain.strafeDir * 2.2;
      desiredZ = bot.z + dirToFoeX * brain.strafeDir * 2.2;
      desiredSpeed = 2.6;
      bot.crouch = false;
    }
    faceAndFire(bot, foe, now, foeGap);
  } else if (brain.enemy && now - brain.seenAt < 2.6) {
    // Contact lost moments ago: push toward the last seen position.
    desiredX = brain.lastSeenX;
    desiredZ = brain.lastSeenZ;
    desiredSpeed = BOT_RUN_SPEED;
    facingX = brain.lastSeenX;
    facingZ = brain.lastSeenZ;
  } else if (brain.mode === 'hold' || (brain.mode === 'advance' && brain.pathI >= brain.path.length && brain.thenHold)) {
    brain.mode = 'hold';
    desiredSpeed = 0;
    brain.scanAt -= dt;
    if (brain.scanAt <= 0) {
      brain.scanAt = 1.6 + Math.random() * 2;
      brain.scanYaw = bot.yaw + (Math.random() - 0.5) * 1.8;
    }
    bot.yaw += wrapAngle(brain.scanYaw - bot.yaw) * Math.min(1, dt * 3);
    bot.crouch = brain.crouchHold;
  }
  if (brain.mode !== 'hold' && !hasContact) bot.crouch = false;

  moveBot(bot, desiredX, desiredZ, desiredSpeed, dt, facingX, facingZ);
}

function nearestBreakerToBomb() {
  let closestBot = null;
  let closestDist = Infinity;
  for (const actor of state.actors) {
    if (actor.team !== 'breaker' || !actor.alive || actor.isPlayer) continue;
    const gap = Math.hypot(actor.x - state.bomb.x, actor.z - state.bomb.z);
    if (gap < closestDist) {
      closestDist = gap;
      closestBot = actor;
    }
  }
  return closestBot;
}

function moveBot(bot, targetX, targetZ, speed, dt, faceX, faceZ) {
  const brain = bot.ai;
  let deltaX = targetX - bot.x;
  let deltaZ = targetZ - bot.z;
  let remaining = Math.hypot(deltaX, deltaZ);
  // Reaching a waypoint advances the bot to the next one on its path.
  if (brain.mode === 'advance' && remaining < 1.1 && brain.pathI < brain.path.length) {
    brain.pathI++;
    advanceWaypoint(bot);
    deltaX = brain.tx - bot.x;
    deltaZ = brain.tz - bot.z;
  }
  if (speed > 0 && remaining > 0.25) {
    const stepSize = Math.min(speed * dt, remaining);
    bot.x += deltaX / (remaining || 1) * stepSize;
    bot.z += deltaZ / (remaining || 1) * stepSize;
  }
  const resolved = collide({ x: bot.x, z: bot.z }, 0.42);
  bot.x = resolved.x;
  bot.z = resolved.z;
  bot.speedNow = speed > 0 && remaining > 0.25 ? Math.min(speed, remaining) : 0;

  // Facing priority: the enemy while fighting, otherwise the direction of
  // travel, otherwise the current scan heading.
  let desiredYaw = bot.yaw;
  if (faceX !== null) desiredYaw = Math.atan2(-(faceX - bot.x), -(faceZ - bot.z));
  else if (remaining > 0.4 && speed > 0) desiredYaw = Math.atan2(-deltaX, -deltaZ);
  bot.yaw += wrapAngle(desiredYaw - bot.yaw) * Math.min(1, dt * 9);

  // Running feet generate noise the opposing team can hear and investigate.
  brain.stepAcc -= dt;
  if (bot.speedNow > 2 && brain.stepAcc <= 0) {
    brain.stepAcc = 0.38;
    makeNoise(bot.x, bot.z, 9, bot.team);
  }
}

function faceAndFire(bot, enemy, now, dist) {
  const brain = bot.ai;
  // Aim at the chest with no leading (the weapon is hitscan). Error is
  // scaled by skill and shrinks the longer the target has been tracked.
  const trackQuality = Math.min(1, (now - brain.seenAt + 0.3) * 2);
  const aimError = (1 - trackQuality) * 0.12 + 0.018 / brain.skill;
  const aimPointX = enemy.x + (Math.random() - 0.5) * aimError * dist;
  const aimPointZ = enemy.z + (Math.random() - 0.5) * aimError * dist;
  bot.yaw = Math.atan2(-(aimPointX - bot.x), -(aimPointZ - bot.z));
  const chestHeight = enemy.y + (enemy.crouch ? 0.85 : 1.2);
  bot.pitch = Math.atan2(chestHeight - (bot.y + 1.5), dist) * 0.9;

  const held = currentWeapon(bot);
  const heldDef = held.def;
  const heldAmmo = bot.loadout.ammo[bot.loadout.slots[bot.loadout.current]];
  if (heldAmmo?.mag === 0) startReload(bot, now);
  if (now < brain.reactAt) return;

  // Occasionally open a fight with a grenade, when carrying one.
  if (brain.grenadeAt < now && dist > 8 && dist < 20 && Math.random() < 0.006) {
    const throwableKinds = ['flash', 'he'];
    const pickedKind = throwableKinds.find((kindName) => bot.loadout.grenades[kindName] > 0);
    if (pickedKind) {
      bot.pitch = 0.42;
      throwGrenade(bot, pickedKind, now);
      brain.grenadeAt = now + 9;
      bot.pitch = 0;
      return;
    }
  }

  // Burst discipline: automatic weapons fire 3-5 round bursts separated by
  // a thinking pause, while the sniper takes single deliberate shots.
  // Movement between bursts keeps bot spread honest, because tryFire reads
  // speedNow exactly as it does for the player. A wounded bot shortens its
  // bursts and lengthens its pauses (see header): it is playing to survive
  // the round rather than win a damage race it is already losing.
  if (now < brain.pauseUntil) return;
  if (brain.burstUntil < now) {
    const isHurt = bot.hp < 35;
    if (heldDef.auto) {
      brain.burstUntil = now + (isHurt ? 0.2 : 0.32) + Math.random() * 0.3;
      brain.pauseUntil = brain.burstUntil + (isHurt ? 0.75 : 0.4) + Math.random() * 0.5;
    } else {
      brain.burstUntil = now + 0.05;
      brain.pauseUntil = brain.burstUntil + 1.1 / brain.skill;
    }
  }
  tryFire(bot, now);
}

function wrapAngle(angle) {
  let result = angle;
  while (result > Math.PI) result -= Math.PI * 2;
  while (result < -Math.PI) result += Math.PI * 2;
  return result;
}
