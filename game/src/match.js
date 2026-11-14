// match.js -- the tactical framework the bounty calls for.
// Two teams of five, rounds decided by elimination or by the charge,
// money earned between rounds and spent during the buy phase, first to
// seven wins. Phase transitions are owned here; bot decisions belong to
// bots.js, the human body to player.js, and gunplay to weapons.js.
//
// The economy uses an escalating loss bonus: a first loss pays $1,900 and
// every additional consecutive loss adds $400, topping out at $3,100. A
// side on a losing run can therefore still force a proper buy every few
// rounds instead of being priced out of the match -- while one loss right
// after a win still hurts, which keeps saving a genuine decision.

import * as THREE from 'three';
import { MAP } from './map.js';
import { state, PHASE, baseActor, emit } from './state.js';
import { newLoadout, giveWeapon, finishReloads, updateGrenades } from './weapons.js';
import { buildActorMesh, poseActorMesh } from './world.js';
import { makeAI, planRound, botBuy } from './bots.js';
import { sfx } from './audio.js';

const SECONDS_ROUND = 100;
const SECONDS_BOMB = 40;
const SECONDS_BUY = 14;
const SECONDS_END = 5;
const SECONDS_PLANT = 3.2;
const SECONDS_DEFUSE = 8;
// Loss bonus shape: a base amount for the first loss, an increment for
// each further consecutive loss, and a cap so a long streak tops out at
// $3,100 in total.
const PAY_LOSS_BASE = 1900;
const PAY_LOSS_STEP = 400;
const PAY_LOSS_EXTRA_CAP = 1200;

const NAMES_BREAKER = ['You', 'Ash', 'Bex', 'Cato', 'Dain'];
const NAMES_WARDEN = ['Vera', 'Holt', 'Ilsa', 'Joren', 'Kett'];

let chargeMesh = null;
let calledSite = 'A';

export function createActors() {
  state.actors = [];
  for (let idx = 0; idx < 5; idx++) {
    const member = baseActor('breaker', idx === 0, NAMES_BREAKER[idx]);
    member.loadout = newLoadout();
    if (!member.isPlayer) {
      member.ai = makeAI('rifle');
      buildActorMesh(member);
    }
    state.actors.push(member);
    if (member.isPlayer) state.player = member;
  }
  for (let idx = 0; idx < 5; idx++) {
    const member = baseActor('warden', false, NAMES_WARDEN[idx]);
    member.loadout = newLoadout();
    member.ai = makeAI('hold');
    buildActorMesh(member);
    state.actors.push(member);
  }
}

export function makeBombMesh() {
  chargeMesh = new THREE.Group();
  const casing = new THREE.Mesh(
    new THREE.BoxGeometry(0.42, 0.3, 0.16),
    new THREE.MeshLambertMaterial({ color: 0x2f2d2b }),
  );
  const keypad = new THREE.Mesh(
    new THREE.BoxGeometry(0.2, 0.06, 0.12),
    new THREE.MeshLambertMaterial({ color: 0xd98a2b, emissive: 0xd98a2b, emissiveIntensity: 0.4 }),
  );
  keypad.position.set(0, 0.18, 0);
  chargeMesh.add(casing, keypad);
  return chargeMesh;
}

function resetActorForRound(actor, spawnPoint, facingYaw) {
  actor.hp = 100;
  actor.alive = true;
  actor.x = spawnPoint[0];
  actor.z = spawnPoint[1];
  actor.y = 0;
  actor.vy = 0;
  actor.velX = 0;
  actor.velZ = 0;
  actor.yaw = facingYaw;
  actor.pitch = 0;
  actor.crouch = false;
  actor.walking = false;
  actor.flashUntil = 0;
  actor.speedNow = 0;
  // Sidearms refresh every round; a primary bought in an earlier round is
  // retained between rounds.
  const keptPrimary = actor.loadout.slots.primary;
  const keptGrenades = actor.loadout.grenades;
  actor.loadout = newLoadout();
  if (keptPrimary) giveWeapon(actor, keptPrimary);
  actor.loadout.grenades = keptGrenades;
  actor.loadout.current = keptPrimary ? 'primary' : 'sidearm';
  if (actor.mesh) {
    actor.mesh.visible = true;
    actor.mesh.rotation.z = 0;
  }
}

export function startRound() {
  state.round++;
  state.phase = PHASE.BUY;
  state.phaseT = SECONDS_BUY;
  state.timeScale = 1;
  state.buyOpen = true;
  state.message = '';
  calledSite = Math.random() < 0.5 ? 'A' : 'B';

  const breakerSpawns = MAP.spawns.breaker;
  const wardenSpawns = MAP.spawns.warden;
  state.actors.forEach((actor, idx) => {
    const isBreaker = actor.team === 'breaker';
    const spawnPoint = isBreaker ? breakerSpawns[idx % 5] : wardenSpawns[idx % 5];
    const facing = isBreaker ? -Math.PI / 2 : Math.PI / 2;
    resetActorForRound(actor, spawnPoint, facing);
  });

  // The charge begins with a bot carrier, never with the player, so the
  // pack's plan stays readable; a dead carrier drops it and any teammate
  // may pick it up again.
  const botList = state.actors.filter((entry) => !entry.isPlayer);
  const firstCarrier = botList.find((entry) => entry.team === 'breaker');
  state.bomb.status = 'carried';
  state.bomb.carrier = firstCarrier;
  state.bomb.site = null;
  state.bomb.timer = 0;
  state.bomb.progress = 0;
  state.bomb.planter = null;
  if (chargeMesh) chargeMesh.visible = false;

  for (const bot of botList) botBuy(bot);
  planRound(botList, firstCarrier, calledSite);
  emit('roundstart', { round: state.round });
}

export function startMatch() {
  state.round = 0;
  state.score.breaker = 0;
  state.score.warden = 0;
  state.lossStreak.breaker = 0;
  state.lossStreak.warden = 0;
  state.lastRoundWinner = null;
  state.matchOver = false;
  for (const actor of state.actors) {
    actor.money = 800;
    actor.kills = 0;
    actor.deaths = 0;
    actor.loadout = newLoadout();
  }
  startRound();
}

function anyAliveOn(teamName) {
  return state.actors.some((entry) => entry.team === teamName && entry.alive);
}

// What the losing side is paid for a round, given its loss streak AFTER
// the new loss is counted: streak 1 earns the base, streak 2 earns
// base+step, and so on up to the cap.
export function lossPayFor(streak) {
  const extraLosses = Math.max(0, streak - 1);
  const extraPay = Math.min(PAY_LOSS_EXTRA_CAP, extraLosses * PAY_LOSS_STEP);
  return PAY_LOSS_BASE + extraPay;
}

function finishRound(winnerTeam, reason) {
  state.phase = PHASE.END;
  state.phaseT = SECONDS_END;
  state.buyOpen = false;
  state.score[winnerTeam]++;
  const loserTeam = winnerTeam === 'breaker' ? 'warden' : 'breaker';
  state.lossStreak[winnerTeam] = 0;
  state.lossStreak[loserTeam]++;
  state.lastRoundWinner = winnerTeam;
  // Economy: winners receive round pay, losers receive the streak-scaled
  // loss bonus, detonation / defusal rounds pay their own rate, and kills
  // were already paid at the moment of the kill.
  const loserPay = lossPayFor(state.lossStreak[loserTeam]);
  for (const actor of state.actors) {
    let roundPay = actor.team === winnerTeam ? 2700 : loserPay;
    if (reason === 'detonation' && actor.team === 'breaker') roundPay = 3200;
    if (reason === 'defused' && actor.team === 'warden') roundPay = 3200;
    actor.money = Math.min(16000, actor.money + roundPay);
  }
  if (state.bomb.planter && reason !== 'eliminated') {
    state.bomb.planter.money = Math.min(16000, state.bomb.planter.money + 300);
  }
  const playerSideWon = winnerTeam === state.player.team;
  if (playerSideWon) sfx.roundWin();
  else sfx.roundLose();
  state.message = describeRoundEnd(winnerTeam, reason);
  emit('roundend', { winnerTeam: winnerTeam, reason: reason, lossPay: loserPay });
  if (state.score.breaker >= state.winsNeeded || state.score.warden >= state.winsNeeded) {
    state.matchOver = true;
    state.winner = winnerTeam;
  }
}

function describeRoundEnd(winnerTeam, reason) {
  const winnerName = winnerTeam === 'breaker' ? 'Breakers' : 'Wardens';
  if (reason === 'detonation') return 'Charge detonated — Breakers take the round';
  if (reason === 'defused') return 'Charge defused — Wardens take the round';
  if (reason === 'time') return 'Time expired — Wardens take the round';
  return winnerName + ' eliminated the other team';
}

export function updateMatch(dt, now, inputFrame) {
  finishReloads(now);
  updateGrenades(dt, now);
  const bombState = state.bomb;

  // Charge visuals: ride with the carrier, rest where dropped, sit planted.
  if (chargeMesh) {
    if (bombState.status === 'carried' && bombState.carrier) {
      chargeMesh.visible = true;
      chargeMesh.position.set(bombState.carrier.x, 0.95, bombState.carrier.z + 0.1);
      chargeMesh.rotation.y = -bombState.carrier.yaw;
    } else if (bombState.status === 'dropped' || bombState.status === 'planted') {
      chargeMesh.visible = true;
      chargeMesh.position.set(bombState.x, 0.16, bombState.z);
    }
  }

  // Pickup: any living Breaker, the player included, who walks over a
  // dropped charge picks it up.
  if (bombState.status === 'dropped' && state.phase === PHASE.LIVE) {
    for (const actor of state.actors) {
      if (actor.team !== 'breaker' || !actor.alive) continue;
      const gap = Math.hypot(actor.x - bombState.x, actor.z - bombState.z);
      if (gap < 1.3) {
        bombState.status = 'carried';
        bombState.carrier = actor;
        if (actor.ai) actor.ai.mode = 'advance';
        emit('bombpickup', { actor: actor });
        break;
      }
    }
  }

  switch (state.phase) {
    case PHASE.BUY: {
      state.phaseT -= dt;
      if (state.phaseT <= 0) {
        state.phase = PHASE.LIVE;
        state.phaseT = SECONDS_ROUND;
        state.buyOpen = false;
        emit('roundlive', {});
      }
      break;
    }
    case PHASE.LIVE: {
      state.phaseT -= dt;
      updatePlantChannel(dt, now, inputFrame);
      if (bombState.status === 'planted') {
        // The phase transition itself happens inside the plant channel.
      } else if (!anyAliveOn('warden')) finishRound('breaker', 'eliminated');
      else if (!anyAliveOn('breaker')) finishRound('warden', 'eliminated');
      else if (state.phaseT <= 0) finishRound('warden', 'time');
      break;
    }
    case PHASE.PLANTED: {
      bombState.timer -= dt;
      state.phaseT = bombState.timer;
      updateDefuseChannel(dt, now);
      if (bombState.status === 'defused') finishRound('warden', 'defused');
      else if (!anyAliveOn('warden')) finishRound('breaker', 'eliminated');
      else if (bombState.timer <= 0) {
        bombState.status = 'exploded';
        detonateCharge(now);
        finishRound('breaker', 'detonation');
      }
      // Even when every Breaker dies after the plant, the round continues:
      // the Wardens may still defuse, otherwise the charge detonates. That
      // is Counter-Strike's rule, and the fair one.
      break;
    }
    case PHASE.END: {
      state.phaseT -= dt;
      if (state.phaseT <= 0) {
        if (state.matchOver) {
          state.phase = PHASE.OVER;
          emit('matchover', { winner: state.winner });
        } else {
          startRound();
        }
      }
      break;
    }
    default: break;
  }

  // Spectating pace: after the player dies the world runs faster, so the
  // round resolves in a few seconds of real time rather than a minute of
  // watching.
  const playerDead = state.player && !state.player.alive;
  state.timeScale = playerDead && state.phase !== PHASE.OVER ? 2.6 : 1;

  // Sync every bot's rendered body with its actor position.
  for (const actor of state.actors) {
    if (actor.mesh) poseActorMesh(actor);
  }
}

function isInsideSite(actor, siteKey) {
  const siteBox = MAP.sites[siteKey];
  const insideX = actor.x > siteBox.minX && actor.x < siteBox.maxX;
  const insideZ = actor.z > siteBox.minZ && actor.z < siteBox.maxZ;
  return insideX && insideZ;
}

function updatePlantChannel(dt, now, inputFrame) {
  const bombState = state.bomb;
  if (bombState.status !== 'carried' || !bombState.carrier) {
    bombState.progress = 0;
    return;
  }
  const carrier = bombState.carrier;
  let siteKey = null;
  if (isInsideSite(carrier, 'A')) siteKey = 'A';
  else if (isInsideSite(carrier, 'B')) siteKey = 'B';
  if (!siteKey) {
    bombState.progress = 0;
    return;
  }
  const playerWantsPlant = inputFrame && inputFrame.keys.KeyE;
  const botWantsPlant = carrier.ai && carrier.ai.mode === 'plant';
  const wantsPlant = carrier.isPlayer ? Boolean(playerWantsPlant) : Boolean(botWantsPlant);
  if (!wantsPlant || !carrier.alive) {
    bombState.progress = 0;
    return;
  }
  bombState.site = siteKey;
  bombState.progress += dt / SECONDS_PLANT;
  if (carrier.isPlayer && Math.random() < dt * 2) sfx.plantBeep();
  if (bombState.progress >= 1) {
    bombState.status = 'planted';
    bombState.x = carrier.x;
    bombState.z = carrier.z;
    bombState.timer = SECONDS_BOMB;
    bombState.planter = carrier;
    bombState.carrier = null;
    bombState.progress = 0;
    state.phase = PHASE.PLANTED;
    emit('planted', { site: siteKey });
  }
}

function updateDefuseChannel(dt, now) {
  const bombState = state.bomb;
  if (bombState.status !== 'planted') return;
  // Whoever is the nearest living Warden to the charge works on it, and
  // anyone working on it can be shot off it.
  let worker = null;
  let workerDist = Infinity;
  for (const actor of state.actors) {
    if (actor.team !== 'warden' || !actor.alive) continue;
    const gap = Math.hypot(actor.x - bombState.x, actor.z - bombState.z);
    if (gap < workerDist) {
      workerDist = gap;
      worker = actor;
    }
  }
  const workerEngaged = worker && workerDist < 1.7 && (worker.ai?.mode === 'defuse' || worker.isPlayer);
  if (workerEngaged) {
    bombState.progress += dt / SECONDS_DEFUSE;
    if (Math.random() < dt * 2) sfx.defuseWire();
    if (bombState.progress >= 1) {
      bombState.status = 'defused';
      bombState.progress = 0;
      worker.money = Math.min(16000, worker.money + 300);
    }
  } else {
    bombState.progress = Math.max(0, bombState.progress - dt / SECONDS_DEFUSE);
  }
}

function detonateCharge(now) {
  const bombState = state.bomb;
  emit('explosion', { x: bombState.x, z: bombState.z });
  for (const actor of state.actors) {
    if (!actor.alive) continue;
    const gap = Math.hypot(actor.x - bombState.x, actor.z - bombState.z);
    if (gap < 9) {
      actor.hp = 0;
      actor.alive = false;
      if (actor.mesh) actor.mesh.visible = false;
    }
  }
  void now;
}

// --- Player purchases, invoked by the HUD -----------------------------------

export function playerBuy(item) {
  const buyer = state.player;
  if (!state.buyOpen || !buyer.alive) return false;
  const inv = buyer.loadout;
  const priceTable = { rifle: 2700, smg: 1500, sniper: 4500, he: 300, flash: 200, smoke: 300, ammo: 0 };
  if (!(item in priceTable)) return false;
  const isPrimary = item === 'rifle' || item === 'smg' || item === 'sniper';
  if (isPrimary) {
    if (inv.slots.primary === item) { sfx.denied(); return false; }
    if (buyer.money < priceTable[item]) { sfx.denied(); return false; }
    buyer.money -= priceTable[item];
    giveWeapon(buyer, item);
    inv.current = 'primary';
  } else {
    if (inv.grenades[item]) { sfx.denied(); return false; }
    if (buyer.money < priceTable[item]) { sfx.denied(); return false; }
    buyer.money -= priceTable[item];
    inv.grenades[item] = 1;
  }
  sfx.buy();
  emit('buy', { item: item });
  return true;
}
