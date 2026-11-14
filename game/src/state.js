// state.js -- central mutable state for the whole match.
// Keeping everything on one object means the simulation never stashes
// hidden state inside closures, and the HUD always renders exactly the
// values the simulation produced. The loop lives in main.js, phase
// transitions live in match.js, and the data itself lives here.

export const PHASE = {
  BUY: 'buy',
  LIVE: 'live',
  PLANTED: 'planted',
  END: 'end',
  OVER: 'over',
};

export const state = {
  phase: PHASE.BUY,
  // Countdown (seconds) for whichever phase is active right now.
  phaseT: 0,
  round: 0,
  // Seven round wins take the match, so at most thirteen rounds are played.
  winsNeeded: 7,
  score: { breaker: 0, warden: 0 },
  // How many rounds each side has dropped in a row. match.js converts a
  // streak into an escalating loss bonus (base 1900, +400 per extra loss,
  // capped) so a side that keeps losing can still buy properly every few
  // rounds instead of being stuck on pistols forever.
  lossStreak: { breaker: 0, warden: 0 },
  lastRoundWinner: null,
  matchOver: false,
  winner: null,
  bomb: {
    // carried | planting | planted | defusing | exploded | defused | dropped
    status: 'carried',
    carrier: null,
    // World coordinates, meaningful once the charge is planted or dropped.
    x: 0,
    z: 0,
    // 'A' | 'B' once planted, otherwise null.
    site: null,
    // Seconds until detonation while the charge is planted.
    timer: 0,
    // Plant / defuse channel progress, normalised to 0..1.
    progress: 0,
    actor: null,
  },
  actors: [],
  player: null,
  // Short-lived visual effects: tracer lines and impact puffs.
  tracers: [],
  // Live smoke clouds, each {mesh, x, z, r, ttl, grow}.
  smokes: [],
  // Grenades currently in flight, each {mesh, vel, kind, owner, fuse}.
  grenades: [],
  // Events queued for one frame; consumed by the HUD and audio layers.
  events: [],
  // Recent gunshot / footstep noises that bots are able to hear.
  noise: [],
  // Simulation clock in seconds.
  time: 0,
  // Speed multiplier; bumped after the player dies so rounds end briskly.
  timeScale: 1,
  // Centre banner text, written by match.js.
  message: '',
  buyOpen: false,
};

export function emit(type, data) {
  const entry = { type };
  Object.assign(entry, data);
  state.events.push(entry);
}

export function makeNoise(x, z, r, team) {
  state.noise.push({ t: state.time, team, r, z, x });
  while (state.noise.length > 24) state.noise.shift();
}

// Shared actor record for the human player and for every bot:
// { team, isPlayer, hp, alive, pos:Vector3-like {x,z}, y (feet), yaw, pitch,
//   crouch, walking (quiet shift-walk), weapon fields filled by weapons.js,
//   ai fields filled by bots.js, mesh parts for hit tests, money, kills,
//   deaths, name }
export function baseActor(team, isPlayer, name) {
  const fresh = {
    team: team,
    isPlayer: isPlayer,
    name: name,
    hp: 100,
    alive: true,
    x: 0,
    z: 0,
    vy: 0,
    y: 0,
    velX: 0,
    velZ: 0,
    yaw: 0,
    pitch: 0,
    crouch: false,
    walking: false,
    grounded: true,
    speedNow: 0,
    money: 800,
    kills: 0,
    deaths: 0,
    loadout: null,
    flashUntil: 0,
    lastDamageFrom: null,
    mesh: null,
    head: null,
    torso: null,
    legs: null,
    ai: null,
  };
  return fresh;
}
