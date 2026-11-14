// player.js -- the human player's physical body.
// Pointer-lock mouse look, acceleration-and-friction movement, crouching,
// a quiet shift-walk, jumping and map collision all live here. Movement
// speed is fed into weapon spread by weapons.js, so locomotion and
// gunplay form one coupled system: sprint and your shots bloom, walk or
// stand still and they settle. Shift-walk is the stealth option -- half
// pace, footsteps the bots can barely hear, and a steadier aim. It is the
// classic tactical exchange of speed for information and accuracy.

import { collide } from './map.js';
import { input, stepInput, moveAxes } from './input.js';
import { currentWeapon, switchSlot, startReload, throwGrenade, decayRecoil } from './weapons.js';
import { state, makeNoise } from './state.js';
import { sfx } from './audio.js';

const SPEED_RUN = 4.6;
const SPEED_WALK = 2.45;
const SPEED_CROUCH = 2.2;
const ACCELERATION = 42;
const GROUND_FRICTION = 11;
const GRAVITY_PULL = 22;
const JUMP_SPEED = 7.4;
const EYE_HEIGHT_STAND = 1.58;
const EYE_HEIGHT_CROUCH = 1.2;

let timeSinceStep = 0;
let bobClock = 0;
let landingDip = 0;

export function updatePlayer(actor, dt, now) {
  const frame = stepInput();
  if (!actor.alive) return frame;

  // Mouse look: yaw about Y with pitch clamped. Sensitivity drops while
  // the player is scoped in.
  const inv = actor.loadout;
  const lookScale = inv && inv.scoped ? 0.0009 : 0.0021;
  actor.yaw -= frame.dx * lookScale;
  actor.pitch -= frame.dy * lookScale;
  actor.pitch = Math.max(-1.45, Math.min(1.45, actor.pitch));

  actor.crouch = Boolean(frame.keys.ControlLeft || frame.keys.ControlRight || frame.keys.KeyC);
  actor.walking = !actor.crouch && Boolean(frame.keys.ShiftLeft || frame.keys.ShiftRight);

  // Build the wish direction from the keys and rotate it by yaw. In (x, z)
  // terms forward is (-sin, -cos) and right is (cos, -sin), so world
  // movement equals right*ax + forward*(-az).
  const axes = moveAxes(frame.keys);
  const sinYaw = Math.sin(actor.yaw);
  const cosYaw = Math.cos(actor.yaw);
  let wishX = axes.x * cosYaw + axes.z * sinYaw;
  let wishZ = -axes.x * sinYaw + axes.z * cosYaw;
  const wishLength = Math.hypot(wishX, wishZ) || 1;
  wishX /= wishLength;
  wishZ /= wishLength;
  const hasInput = axes.x !== 0 || axes.z !== 0;
  let speedCap = SPEED_RUN;
  if (actor.crouch) speedCap = SPEED_CROUCH;
  else if (actor.walking) speedCap = SPEED_WALK;

  if (hasInput && actor.grounded) {
    actor.velX += wishX * ACCELERATION * dt;
    actor.velZ += wishZ * ACCELERATION * dt;
  }
  // Apply friction first, then enforce the cap, because one frame of
  // acceleration is allowed to overshoot the cap slightly.
  const frictionFactor = actor.grounded ? Math.max(0, 1 - GROUND_FRICTION * dt) : 0.995;
  actor.velX *= frictionFactor;
  actor.velZ *= frictionFactor;
  const currentSpeed = Math.hypot(actor.velX, actor.velZ);
  if (currentSpeed > speedCap) {
    actor.velX = actor.velX / currentSpeed * speedCap;
    actor.velZ = actor.velZ / currentSpeed * speedCap;
  }
  actor.speedNow = Math.hypot(actor.velX, actor.velZ);

  // Jump plus gravity. Walking and crouching both keep the feet planted:
  // a jump is loud and committal, never a free escape from stealth.
  const wantsJump = actor.grounded && frame.keys.Space && !actor.walking && !actor.crouch;
  if (wantsJump) {
    actor.vy = JUMP_SPEED;
    actor.grounded = false;
    sfx.jump();
  }
  if (!actor.grounded) {
    actor.vy -= GRAVITY_PULL * dt;
    actor.y += actor.vy * dt;
    if (actor.y <= 0) {
      actor.y = 0;
      actor.vy = 0;
      actor.grounded = true;
      landingDip = 0.09;
    }
  }

  actor.x += actor.velX * dt;
  actor.z += actor.velZ * dt;
  const resolved = collide({ x: actor.x, z: actor.z }, 0.42);
  actor.x = resolved.x;
  actor.z = resolved.z;

  // Footsteps are audible to bots and to the player alike. A crouched or
  // shift-walked step carries almost nowhere, whereas a running step can
  // pull a holder off its angle exactly the way gunfire does. Walking is
  // how a held angle gets crossed without being heard.
  timeSinceStep -= dt;
  const shouldStep = hasInput && actor.grounded && actor.speedNow > 1 && timeSinceStep <= 0;
  if (shouldStep) {
    const isQuiet = actor.crouch || actor.walking;
    timeSinceStep = actor.crouch ? 0.55 : actor.walking ? 0.48 : 0.36;
    sfx.step(0, !isQuiet);
    actor.lastStepAt = now;
    makeNoise(actor.x, actor.z, isQuiet ? 2.5 : 10, actor.team);
  }

  // Weapon keys. While the buy phase is running the number row belongs to
  // the buy menu (main.js handles those presses), so slot switching is
  // suspended until the round actually starts.
  if (frame.pressed.KeyR) startReload(actor, now);
  if (!state.buyOpen) {
    if (frame.pressed.Digit1) switchSlot(actor, 'primary', now);
    if (frame.pressed.Digit2) switchSlot(actor, 'sidearm', now);
    if (frame.pressed.Digit3) switchSlot(actor, 'melee', now);
  }
  if (frame.pressed.KeyG) {
    const throwOrder = ['he', 'flash', 'smoke'];
    const chosen = throwOrder.find((kindName) => actor.loadout.grenades[kindName] > 0);
    if (chosen) throwGrenade(actor, chosen, now);
  }
  // Right mouse button scopes the Longshot.
  const scopeHeld = Boolean(frame.keys.MouseRight);
  if (actor.loadout) {
    actor.loadout.scoped = scopeHeld && currentWeapon(actor).def.scoped === true;
  }
  decayRecoil(actor, dt, frame.firing);

  return frame;
}

// Position the camera at the player's eyes, adding walk bob and the dip
// that follows a landing.
export function poseCamera(actor, camera, dt) {
  landingDip = Math.max(0, landingDip - dt * 0.5);
  if (actor.speedNow > 0.6 && actor.grounded) bobClock += dt * actor.speedNow * 1.6;
  const speedRatio = Math.min(1, actor.speedNow / SPEED_RUN);
  const bobOffsetY = Math.sin(bobClock * 2) * 0.028 * speedRatio;
  const bobOffsetX = Math.cos(bobClock) * 0.016 * speedRatio;
  const eyeHeight = actor.crouch ? EYE_HEIGHT_CROUCH : EYE_HEIGHT_STAND;
  camera.position.set(
    actor.x + bobOffsetX * Math.cos(actor.yaw),
    actor.y + eyeHeight + bobOffsetY - landingDip,
    actor.z - bobOffsetX * Math.sin(actor.yaw),
  );
  camera.rotation.set(actor.pitch, actor.yaw, 0);
}

// Right-button tracking: input.js reaches mouse buttons via this bridge.
if (typeof document !== 'undefined') {
  document.addEventListener('mousedown', (ev) => {
    if (ev.button === 2) input.keys.MouseRight = true;
  });
  document.addEventListener('mouseup', (ev) => {
    if (ev.button === 2) input.keys.MouseRight = false;
  });
  document.addEventListener('contextmenu', (ev) => ev.preventDefault());
}
