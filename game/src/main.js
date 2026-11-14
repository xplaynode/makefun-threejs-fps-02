// main.js -- startup and the main loop.
// The simulation advances in fixed steps of 1/120 s, driven by an
// accumulator that is capped so a stalled tab cannot spiral, and it is
// kept separate from rendering: the renderer simply draws whatever the
// most recent steps produced. A single step runs, in order, the player's
// body and trigger, then every bot, then the match phases and channels,
// after which the viewmodel and camera are posed for rendering.
//
// URL modes (used by the screenshot tooling, and handy for players):
//   ?shot=start|play|site|end&seed=n -- pose a deterministic screenshot scene
//   ?auto=1                          -- let a bot drive the player (demo)

import { initWorld, scene, camera, buildViewmodel, updateEffects, render } from './world.js';
import { initInput, input, lockPointer } from './input.js';
import { initAudio, resumeAudio } from './audio.js';
import { state, PHASE } from './state.js';
import { createActors, startMatch, updateMatch, makeBombMesh, playerBuy } from './match.js';
import { updatePlayer, poseCamera } from './player.js';
import { updateBot } from './bots.js';
import { tryFire } from './weapons.js';
import { initHud, updateHud, consumeEvents, showOverlay, hideOverlay, hideBanner } from './hud.js';
import { currentWeapon } from './weapons.js';

const FIXED_STEP = 1 / 120;
let stepAccumulator = 0;
let previousStamp = 0;
let hasStarted = false;
let isPaused = false;
let viewmodelState = null;
let viewKick = 0;
let requestedShot = null;

const queryParams = new URLSearchParams(location.search);
requestedShot = queryParams.get('shot');

initWorld();
createActors();
// Expose the live state for the maker's smoke tests (tools/smoke.mjs).
window.__slagline = state;
scene.add(makeBombMesh());
viewmodelState = buildViewmodel();
initHud();
initInput(handleLockChange);
startMatch();

if (requestedShot) setupShot(requestedShot);
else {
  showOverlay(
    'SLAGLINE',
    'A tactical shooter in a dusk smelter yard. Breakers plant the charge; Wardens hold the yard. First to 7 rounds. Click to take the yard.',
    'Click to play',
  );
}
document.getElementById('play').addEventListener('click', () => {
  initAudio();
  resumeAudio();
  if (state.phase === PHASE.OVER || state.matchOver) startMatch();
  hideOverlay();
  hasStarted = true;
  isPaused = false;
  lockPointer();
});

function handleLockChange(nowLocked) {
  if (!nowLocked && hasStarted && !state.matchOver && !requestedShot) {
    isPaused = true;
    showOverlay('Paused', 'The yard waits. Click to jump back in.', 'Resume');
  }
  if (nowLocked) isPaused = false;
}

// Buy-menu number keys are handled here, because player.js deliberately
// leaves the number row free while the buy phase is running.
const BUY_KEY_MAP = { Digit1: 'rifle', Digit2: 'smg', Digit3: 'sniper', Digit4: 'he', Digit5: 'flash', Digit6: 'smoke' };

function simulateStep(dt) {
  const stepNow = state.time + dt;
  state.time = stepNow;
  const human = state.player;
  let inputFrame = null;

  if (requestedShot) {
    // Screenshot poses: the match clock and the charge still advance, so
    // the HUD and the planted charge read truthfully, but nobody moves --
    // the pose itself is the picture.
    updateMatch(dt, stepNow, null);
    consumeEvents(dt);
    return;
  }

  const maySimulate = !isPaused && state.phase !== PHASE.OVER;
  if (maySimulate) {
    inputFrame = updatePlayer(human, dt, stepNow);
    // Trigger handling: automatics keep firing while the button is held;
    // semi-automatics are rate-limited inside tryFire, so holding the
    // button is safe for them as well.
    if (inputFrame && human.alive && input.locked && inputFrame.firing) {
      if (tryFire(human, stepNow)) viewKick = 1;
    }
    if (inputFrame && state.buyOpen) {
      for (const mapping of Object.entries(BUY_KEY_MAP)) {
        if (inputFrame.pressed[mapping[0]]) playerBuy(mapping[1]);
      }
    }
    for (const actor of state.actors) {
      if (!actor.isPlayer && actor.alive && state.phase !== PHASE.BUY) {
        updateBot(actor, dt, stepNow);
      }
    }
  }
  updateMatch(dt, stepNow, inputFrame);
  consumeEvents(dt);
}

function poseViewmodel(dt) {
  const human = state.player;
  if (!viewmodelState) return;
  viewKick = Math.max(0, viewKick - dt * 9);
  const gunGroup = viewmodelState.group;
  const isReloading = human.loadout && human.loadout.reloadingUntil > state.time;
  const desiredY = isReloading ? -0.34 : -0.22;
  const desiredTilt = isReloading ? 0.7 : 0;
  gunGroup.position.y += (desiredY - gunGroup.position.y) * Math.min(1, dt * 10);
  gunGroup.rotation.x += (desiredTilt - gunGroup.rotation.x) * Math.min(1, dt * 10);
  gunGroup.position.z = -0.45 + viewKick * 0.07;
  gunGroup.rotation.x += viewKick * 0.06;
  // One stylised gun model serves every weapon; scaling it by the weapon
  // in hand makes a sidearm read smaller than the Longshot.
  if (human.loadout) {
    const heldId = currentWeapon(human).id;
    let scaleFactor = 1;
    if (heldId === 'pistol') scaleFactor = 0.74;
    else if (heldId === 'sniper') scaleFactor = 1.18;
    else if (heldId === 'knife') scaleFactor = 0.5;
    gunGroup.scale.setScalar(scaleFactor);
  }
  const isScoped = human.loadout && human.loadout.scoped;
  gunGroup.visible = !(isScoped && human.alive);
  // Spectating: ride on the shoulder of the first living teammate.
  if (!human.alive && state.phase !== PHASE.OVER) {
    const livingMate = state.actors.find((entry) => entry.team === human.team && entry.alive);
    if (livingMate) {
      camera.position.set(livingMate.x, livingMate.y + 1.58, livingMate.z);
      camera.rotation.set(livingMate.pitch || 0, livingMate.yaw || 0, 0);
      gunGroup.visible = false;
    }
  }
}

function frameLoop(stamp) {
  requestAnimationFrame(frameLoop);
  if (!previousStamp) previousStamp = stamp;
  let elapsed = Math.min(0.1, (stamp - previousStamp) / 1000);
  previousStamp = stamp;
  if (hasStarted) {
    const scaledElapsed = elapsed * state.timeScale;
    stepAccumulator += scaledElapsed;
    let stepsRun = 0;
    while (stepAccumulator >= FIXED_STEP && stepsRun < 14) {
      simulateStep(FIXED_STEP);
      stepAccumulator -= FIXED_STEP;
      stepsRun++;
    }
    if (stepsRun === 14) stepAccumulator = 0;
    const overlayHidden = document.getElementById('overlay').hidden;
    if (state.phase === PHASE.OVER && overlayHidden) {
      const playerSideWon = state.winner === state.player.team;
      showOverlay(
        playerSideWon ? 'Your team takes the yard' : 'The yard is lost',
        'Final score — Breakers ' + state.score.breaker + ', Wardens ' + state.score.warden + '.',
        'Play again',
      );
    }
  }
  if (state.player && state.player.alive) poseCamera(state.player, camera, elapsed);
  poseViewmodel(elapsed);
  updateEffects(elapsed);
  updateHud(elapsed);
  render();
}

// Deterministic scenes for the maker's screenshots: a given seed always
// poses the same yard, so cover images are reproducible renders of the
// real game rather than one-off captures.
function setupShot(kind) {
  hasStarted = true;
  const human = state.player;
  hideOverlay();
  document.getElementById('overlay').hidden = true;
  // Flush the boot round-start event, then clear its banner: the pose is
  // the whole picture.
  consumeEvents(0);
  hideBanner();
  if (kind === 'start') {
    // Buy phase at Breaker spawn, two pack members in view, menu open.
    state.phase = PHASE.BUY;
    state.phaseT = 12;
    state.buyOpen = true;
    human.x = -40;
    human.z = 0;
    human.yaw = -Math.PI / 2;
    human.pitch = 0.02;
    const packMates = state.actors.filter((entry) => entry.team === 'breaker' && !entry.isPlayer);
    packMates[0].x = -36.5;
    packMates[0].z = -3.5;
    packMates[0].yaw = -Math.PI / 2;
    packMates[1].x = -36.5;
    packMates[1].z = 3.5;
    packMates[1].yaw = -Math.PI / 2;
  } else if (kind === 'play') {
    // Mid-fight in the northern lane, Wardens ahead at fighting distance.
    state.phase = PHASE.LIVE;
    state.phaseT = 47;
    state.buyOpen = false;
    human.x = -14;
    human.z = -18;
    human.yaw = -Math.PI / 2;
    human.pitch = 0.0;
    human.loadout.slots.primary = 'rifle';
    human.loadout.current = 'sidearm';
    const wardenList = state.actors.filter((entry) => entry.team === 'warden');
    wardenList[0].x = 0;
    wardenList[0].z = -19.5;
    wardenList[0].yaw = Math.PI / 2;
    wardenList[1].x = 5;
    wardenList[1].z = -15;
    wardenList[1].yaw = Math.PI / 2;
    wardenList[2].x = 11;
    wardenList[2].z = -20.5;
    wardenList[2].yaw = Math.PI / 2;
    const packMates = state.actors.filter((entry) => entry.team === 'breaker' && !entry.isPlayer);
    packMates[0].x = -17;
    packMates[0].z = -15.5;
    packMates[0].yaw = -Math.PI / 2;
    packMates[1].x = -18.5;
    packMates[1].z = -20.5;
    packMates[1].yaw = -Math.PI / 2;
  } else if (kind === 'site') {
    // The other site, for range: approaching the Ore Depot's west door
    // along the southern lane, with a Warden holder on site and a mate at
    // the shoulder.
    state.phase = PHASE.LIVE;
    state.phaseT = 63;
    state.buyOpen = false;
    state.score.breaker = 2;
    state.score.warden = 3;
    state.round = 6;
    human.x = 8;
    human.z = 18;
    human.yaw = -Math.PI / 2;
    human.pitch = 0.0;
    human.loadout.slots.primary = 'rifle';
    human.loadout.current = 'sidearm';
    const wardenList = state.actors.filter((entry) => entry.team === 'warden');
    wardenList[0].x = 24;
    wardenList[0].z = 16.5;
    wardenList[0].yaw = Math.PI / 2;
    wardenList[1].x = 30;
    wardenList[1].z = 22;
    wardenList[1].yaw = Math.PI / 2;
    wardenList[1].crouch = true;
    const packMates = state.actors.filter((entry) => entry.team === 'breaker' && !entry.isPlayer);
    packMates[0].x = 5.5;
    packMates[0].z = 15.2;
    packMates[0].yaw = -Math.PI / 2;
  } else {
    // Post-plant at the Furnace: the planted charge in view, timer running.
    state.phase = PHASE.PLANTED;
    state.phaseT = 18;
    state.buyOpen = false;
    state.bomb.status = 'planted';
    state.bomb.x = 30;
    state.bomb.z = -17;
    state.bomb.site = 'A';
    state.bomb.timer = 18;
    state.score.breaker = 5;
    state.score.warden = 4;
    state.round = 10;
    human.x = 26.5;
    human.z = -14.6;
    human.yaw = -1.0;
    human.pitch = -0.16;
    const wardenList = state.actors.filter((entry) => entry.team === 'warden');
    wardenList[0].x = 21.5;
    wardenList[0].z = -19;
    wardenList[0].yaw = -Math.PI / 2;
    wardenList[0].hp = 64;
  }
  poseCamera(human, camera, 0.016);
}

requestAnimationFrame(frameLoop);
