# SLAGLINE — a three.js tactical FPS

An original round-based tactical shooter in the Counter-Strike mould, built on
three.js 0.187.0: two teams of five, short rounds won by elimination or by the
bomb, money between rounds, and gunplay where stopping to aim beats spraying
on the move. Everything — map, names, art, sounds — is original: the game is
set in **the Slagline Yard**, a decommissioned coastal smelter at dusk, where
the **Breakers** attack and the **Wardens** defend two sites, the **Furnace
Hall** (A) and the **Ore Depot** (B).

This is the threejs-fps-02 build of SLAGLINE, re-authored in its own entry
window with four refinements over the first build: a quiet shift-walk, a
streak-scaled loss bonus, bots with hearing memory and hurt-bot caution, and
a HUD that shows both teams' alive counts and names the buy you can afford.

## Play it

```sh
node serve.ts            # then open http://localhost:8080 in desktop Chrome
```

No build step, no network: `game/` is plain static files and ES modules, with
three.js vendored under `game/vendor/three/`. Single-player against nine bots.

Hand it in (the entry program) with:

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
```

`main.ts` copies `game/` and `screenshots/` to the output directory and writes
`dossier.json` with the kit's `vendor/makefun-threejs.ts`.

## The game

- **Rounds and the bomb.** 14 s buy phase, 100 s rounds, first to 7. A bot
  carries the charge; it drops when he falls, anyone on the team can pick it
  up, planting takes 3.2 s on a site, the charge ticks 40 s, a defuse takes
  8 s — and if every Breaker dies post-plant, the round still plays out.
- **Economy.** Kills pay $300, round wins $2,700–$3,200, plant and defuse
  bonuses $300. Losses pay a **streak-scaled loss bonus**: $1,900 for a first
  loss, +$400 per consecutive loss up to $3,100, so a team on a bad run can
  still force a real buy every few rounds. Buy with the number keys during
  the buy phase: VK-7 Rifle $2,700 · Ripper SMG $1,500 · Longshot .338 $4,500 ·
  Frag / Flash / Smoke charges $300 / $200 / $300. Bots shop on the same
  rules — and save a round longer while their team's streak is deep.
- **Gunplay.** Hitscan with per-part damage (head ×~2, torso ×1, legs ×0.55)
  and distance falloff. Spread grows with your speed, triples airborne,
  shrinks crouched or shift-walking; a settled first shot after a pause is
  the tightest shot of a burst, and every automatic shot adds recoil that
  kicks the view up and walks sideways until you stop firing. Magazines,
  reserve ammo, timed reloads, a scoped Longshot (right-click).
- **Movement.** Acceleration and friction, crouch, jump — and a **quiet
  shift-walk**: half pace, near-silent steps that barely carry to bot ears,
  and a steadier aim. Walking is how you cross a held angle unheard.
- **Grenades.** Physical arcs with a bounce and a fuse: frag (radius damage
  through line of sight), flash (blindness scaled by whether you faced the
  pop), smoke (a 15 s cloud that genuinely blocks sight lines — the bots'
  vision checks pass through it).
- **Bots.** Nine AI yard-hands with a vision cone, line of sight through the
  real map geometry, hearing for gunfire and footsteps, reaction delays and
  burst discipline. Hearing now has **memory and restraint**: a holder who
  investigates noise remembers its home post and returns when the trail goes
  cold, on a cooldown so footsteps cannot yo-yo it between angles. **Hurt
  bots fight hurt**: under 35 hp they crouch between shorter bursts and take
  longer pauses. Wardens hold both sites and mid, investigate noise, and
  retake together on a plant — the nearest works the defuse while the
  carrier's team sets up the post-plant. Breakers run a called site behind
  the carrier. When you die, the round fast-forwards from a teammate's
  shoulder.
- **HUD.** Health, money, ammo (amber before it runs dry, not after), round
  timer, team score, and a live **alive count for both teams** on the top
  line; the round-start banner names the buy you can afford — full, force
  or eco, with the growing loss bonus called out.
- **The map.** Three lanes (north to the Furnace Hall, a crusher house
  splitting mid, south to the Ore Depot), two doors per site, cover placed for
  crossfires, and a 29-node waypoint graph every bot route follows.
- **Sound.** Fully synthesised WebAudio — no audio files: gunfire with
  distance falloff, reload clicks, hit ticks, the plant beep, explosions.

### Controls

| Keys | Action |
| --- | --- |
| W A S D / mouse | Move / look (pointer lock) |
| Shift (hold) | Walk quietly — silent steps, steadier aim |
| Click / R | Fire / reload |
| Ctrl or C / Space | Crouch / jump |
| 1 2 3 | Primary / sidearm / knife (buy menu during the buy phase: 1–6) |
| G | Throw a grenade |
| Right-click | Scope (Longshot) |
| E (hold) | Plant, when you carry the charge on a site |

## Layout

```
main.ts                  the entry program (copies game/ + screenshots/, writes the dossier)
serve.ts                 local dev server for game/
shots.json               the screenshot scenes (game supports ?shot=start|play|site|end)
game/index.html          page, HUD DOM and styling, the import map
game/src/main.js         boot + fixed-step (1/120 s) loop, apart from rendering
game/src/state.js        all match state, in one object
game/src/match.js        phases, rounds, streak-scaled economy, plant/defuse channels
game/src/player.js       mouse look, acceleration movement, crouch, shift-walk, collision
game/src/bots.js         bot senses with hearing memory, waypoint routes, roles, burst fire
game/src/weapons.js      weapon data, spread/recoil model, damage, grenades
game/src/world.js        three.js scene from the map data, bodies, effects
game/src/hud.js          HUD, alive counts, buy menu, banners, killfeed, scope, flash
game/src/audio.js        synthesised sound effects
game/src/map.js          the yard: colliders, sites, spawns, waypoint graph
game/src/palette.js      the dusk-smelter palette and team colours
game/vendor/three/       three.js 0.187.0, byte for byte as the kit ships it
vendor/makefun-threejs.ts  the kit's dossier library, unchanged
tools/selftest.mjs       parse + map-graph + economy-state checks
tools/shots.mjs          takes screenshots/ in headless Chromium (real renders)
tools/smoke.mjs          hands-off match smoke test in headless Chromium
```
