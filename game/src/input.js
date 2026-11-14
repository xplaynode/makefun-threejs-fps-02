// input.js -- raw keyboard / mouse / pointer-lock handling.
// Everything is funnelled into a single polled object. The simulation only
// ever reads `input` during a fixed step and never registers DOM listeners
// of its own, which keeps the fixed-step loop deterministic.

export const input = {
  keys: Object.create(null),
  // Pointer movement gathered since the previous fixed step.
  mouseDX: 0,
  mouseDY: 0,
  firing: false,
  locked: false,
  // Edge-triggered presses: true for exactly one step following keydown.
  pressed: Object.create(null),
};

function hostElement() {
  return document.getElementById('game');
}

export function initInput(onLockChange) {
  const hostEl = hostElement();
  document.addEventListener('keydown', (ev) => {
    input.keys[ev.code] = true;
    if (!ev.repeat) input.pressed[ev.code] = true;
    if (ev.code === 'Space') ev.preventDefault();
  });
  document.addEventListener('keyup', (ev) => {
    input.keys[ev.code] = false;
  });
  document.addEventListener('mousemove', (ev) => {
    if (!input.locked) return;
    input.mouseDX += ev.movementX || 0;
    input.mouseDY += ev.movementY || 0;
  });
  document.addEventListener('mousedown', (ev) => {
    if (ev.button === 0 && input.locked) input.firing = true;
  });
  document.addEventListener('mouseup', (ev) => {
    if (ev.button === 0) input.firing = false;
  });
  document.addEventListener('pointerlockchange', () => {
    const active = document.pointerLockElement;
    input.locked = active === hostEl || active === document.body;
    if (input.locked === false) input.firing = false;
    if (onLockChange) onLockChange(input.locked);
  });
  hostEl.addEventListener('click', () => {
    if (!input.locked) tryLock(hostEl);
  });
}

// Requesting pointer lock is allowed to fail (no trusted gesture, iframe
// without permission, user just hit Esc). That is routine, so any rejection
// is quietly swallowed here rather than logged.
function tryLock(el) {
  try {
    const pending = el.requestPointerLock();
    if (pending && typeof pending.catch === 'function') pending.catch(() => {});
  } catch {
    // Not locked; clicking the overlay will attempt it again.
  }
}

export function lockPointer() {
  const hostEl = hostElement();
  if (hostEl && !input.locked) tryLock(hostEl);
}

// Drain the edge-triggered presses and accumulated mouse deltas for a step.
export function stepInput() {
  const snapshot = {
    keys: input.keys,
    pressed: input.pressed,
    dx: input.mouseDX,
    dy: input.mouseDY,
    firing: input.firing,
  };
  input.mouseDX = 0;
  input.mouseDY = 0;
  input.pressed = Object.create(null);
  return snapshot;
}

export function moveAxes(keys) {
  const strafe = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0);
  const forward = (keys.KeyS ? 1 : 0) - (keys.KeyW ? 1 : 0);
  return { x: strafe, z: forward };
}
