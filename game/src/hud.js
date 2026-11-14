// hud.js -- everything rendered on top of the canvas.
// That includes health, the tactical readouts (money, ammunition, round
// clock, team score, and how many players per side are still standing),
// the buy menu, round banners, the killfeed, hit / hurt feedback, the
// bomb channel bar, the sniper scope and the flash white-out. This file
// only reads state.js plus the event queue filled by match.js and
// weapons.js; it never writes back into the simulation.
//
// Readability choices in this build: the top line shows a live alive
// count for both teams, because that is the most-called information in a
// clutch; the round-start banner names the buy tier the player can
// actually afford (full, force or eco, loss bonus included); and the
// ammunition readout turns amber early, before the magazine runs dry.

import { state, PHASE } from './state.js';
import { currentWeapon } from './weapons.js';
import { playerBuy } from './match.js';
import { MAP } from './map.js';

const byId = (id) => document.getElementById(id);
const dom = {};
let feedEntries = [];
let hitTimer = 0;
let hurtTimer = 0;
let flashTimer = 0;
let bannerTimer = 0;

export function initHud() {
  const wantedIds = ['health', 'healthbar', 'ammo-mag', 'ammo-reserve', 'weapon-name', 'money',
    'timer', 'score-b', 'score-w', 'round-label', 'alive-line', 'banner', 'banner-sub', 'feed', 'hitmarker',
    'hurt', 'flash', 'scope', 'buymenu', 'overlay', 'overlay-title', 'overlay-copy', 'play',
    'bombbar', 'bombfill', 'bomblabel', 'crosshair', 'keys-help', 'nade-count', 'spectate'];
  for (const id of wantedIds) dom[id] = byId(id);
  dom.bannerSub = dom['banner-sub'];
  const buyButtons = document.querySelectorAll('[data-buy]');
  buyButtons.forEach((button) => {
    button.addEventListener('click', () => playerBuy(button.getAttribute('data-buy')));
  });
}

function formatClock(totalSecs) {
  const clamped = Math.max(0, Math.ceil(totalSecs));
  const mins = Math.floor(clamped / 60);
  const secs = String(clamped % 60).padStart(2, '0');
  return mins + ':' + secs;
}

export function showBanner(title, sub, seconds = 2.6) {
  dom.banner.textContent = title;
  dom.bannerSub.textContent = sub || '';
  dom.banner.style.opacity = 1;
  dom.bannerSub.style.opacity = 1;
  bannerTimer = seconds;
}

export function hideBanner() {
  bannerTimer = 0;
  if (dom.banner) {
    dom.banner.style.opacity = 0;
    dom.bannerSub.style.opacity = 0;
  }
}

export function showOverlay(title, copy, button) {
  dom['overlay-title'].textContent = title;
  dom['overlay-copy'].textContent = copy;
  dom.play.textContent = button;
  dom.overlay.hidden = false;
}
export function hideOverlay() { dom.overlay.hidden = true; }

function pushFeed(html, cls) {
  feedEntries.push({ html: html, cls: cls, t: 5 });
  const node = document.createElement('div');
  node.className = 'feed-item ' + (cls || '');
  node.innerHTML = html;
  dom.feed.appendChild(node);
  while (dom.feed.children.length > 5) {
    dom.feed.removeChild(dom.feed.firstChild);
    // Keep the bookkeeping array in step with the DOM nodes.
    feedEntries.shift();
  }
}

// A single plain sentence describing the buy the player can afford this
// round, so the buy phase opens with the decision already framed: a full
// buy, a force buy on SMG money, or an eco that banks for the next round
// (naming the quietly growing loss bonus when one exists).
function affordableBuyHint() {
  const player = state.player;
  const streak = state.lossStreak[player.team] || 0;
  if (player.loadout.slots.primary) return 'Primary in hand — number keys add grenades';
  if (player.money >= 2700) return 'Full buy available — number keys buy';
  if (player.money >= 1500) return 'Force buy: Ripper SMG money — number keys buy';
  if (streak >= 2) return 'Economy round — loss bonus growing (streak ' + streak + '), bank for next round';
  return 'Economy round — number keys buy, or bank for next round';
}

export function consumeEvents(dt) {
  for (const event of state.events) {
    switch (event.type) {
      case 'hitmarker':
        hitTimer = 0.18;
        dom.hitmarker.classList.toggle('head', !!event.head);
        break;
      case 'playerhurt': hurtTimer = 0.35; break;
      case 'flashed': flashTimer = Math.max(flashTimer, event.strength * 2.2); break;
      case 'kill': {
        const attackerHtml = '<b class="' + event.attacker.team + '">' + event.attacker.name + '</b>';
        const victimHtml = '<b class="' + event.victim.team + '">' + event.victim.name + '</b>';
        const highlight = event.attacker.isPlayer || event.victim.isPlayer ? 'big' : '';
        pushFeed(attackerHtml + ' ▸ ' + victimHtml + (event.head ? ' — headshot' : ''), highlight);
        break;
      }
      case 'roundstart':
        showBanner('Round ' + event.round, affordableBuyHint(), 2.2);
        break;
      case 'roundend':
        showBanner(state.message, 'Breakers ' + state.score.breaker + ' — ' + state.score.warden + ' Wardens', 3.6);
        break;
      case 'planted':
        showBanner('Charge planted', 'Site ' + event.site + ' — ' + MAP.sites[event.site].name, 2.4);
        break;
      case 'bombpickup':
        if (event.actor.isPlayer) showBanner('You have the charge', 'Carry it to a site and hold E to plant', 2.2);
        break;
      case 'explosion':
        flashTimer = Math.max(flashTimer, 0.5);
        break;
      default: break;
    }
  }
  state.events.length = 0;
}

export function updateHud(dt) {
  const player = state.player;
  if (!player) return;
  hitTimer = Math.max(0, hitTimer - dt);
  hurtTimer = Math.max(0, hurtTimer - dt);
  flashTimer = Math.max(0, flashTimer - dt * 0.55);
  bannerTimer = Math.max(0, bannerTimer - dt);
  dom.hitmarker.style.opacity = hitTimer > 0 ? 1 : 0;
  dom.hurt.style.opacity = hurtTimer > 0 ? Math.min(0.55, hurtTimer) : 0;
  dom.flash.style.opacity = flashTimer > 0 ? Math.min(1, flashTimer) : 0;
  if (bannerTimer <= 0) {
    dom.banner.style.opacity = 0;
    dom.bannerSub.style.opacity = 0;
  }

  for (let idx = feedEntries.length - 1; idx >= 0; idx--) {
    feedEntries[idx].t -= dt;
    if (feedEntries[idx].t <= 0) {
      feedEntries.splice(idx, 1);
      if (dom.feed.children[idx]) dom.feed.removeChild(dom.feed.children[idx]);
    }
  }

  dom.health.textContent = Math.max(0, Math.ceil(player.hp));
  dom.healthbar.style.width = Math.max(0, player.hp) + '%';
  dom.healthbar.style.background = player.hp > 35 ? 'var(--accent)' : '#e2483a';
  const weaponNow = currentWeapon(player);
  const def = weaponNow.def;
  const ammo = weaponNow.ammo;
  dom['weapon-name'].textContent = def.name;
  dom['ammo-mag'].textContent = ammo ? ammo.mag : '—';
  dom['ammo-reserve'].textContent = ammo ? '/ ' + ammo.reserve : '';
  dom['ammo-mag'].parentElement.classList.toggle('empty', !!ammo && ammo.mag === 0);
  // Early amber warning: at a quarter magazine (or with an empty reserve)
  // it is time to plan a reload, rather than discovering an empty gun in
  // the middle of a fight.
  const quarterMag = Math.ceil(def.mag / 4);
  const runningLow = !!ammo && def.mag > 0 && (ammo.mag <= quarterMag || ammo.reserve === 0) && ammo.mag > 0;
  dom['ammo-mag'].style.color = runningLow ? '#e8a33d' : '';
  dom.money.textContent = '$' + player.money;
  const nadeParts = Object.entries(player.loadout.grenades)
    .filter((pair) => pair[1] > 0)
    .map((pair) => pair[0].toUpperCase() + ' ×' + pair[1]);
  dom['nade-count'].textContent = nadeParts.length ? 'G — ' + nadeParts.join('  ') : '';

  const clockValue = state.phase === PHASE.PLANTED ? state.bomb.timer : state.phaseT;
  dom.timer.textContent = formatClock(clockValue);
  const clockDanger = state.phaseT < 11 || (state.phase === PHASE.PLANTED && state.bomb.timer < 11);
  dom.timer.classList.toggle('danger', clockDanger);
  dom['score-b'].textContent = state.score.breaker;
  dom['score-w'].textContent = state.score.warden;
  dom['round-label'].textContent = state.matchOver
    ? 'Match over'
    : 'Round ' + state.round + ' of 13 — first to ' + state.winsNeeded;
  // Alive counts sit on the top line because pips beat names in a clutch:
  // "3 v 2" is the call that decides whether to hunt or to hold.
  if (dom['alive-line']) {
    let breakerAlive = 0;
    let wardenAlive = 0;
    for (const actor of state.actors) {
      if (!actor.alive) continue;
      if (actor.team === 'breaker') breakerAlive++;
      else wardenAlive++;
    }
    dom['alive-line'].textContent = state.phase === PHASE.BUY ? '' : breakerAlive + ' v ' + wardenAlive + ' standing';
  }

  dom.scope.style.opacity = player.loadout.scoped && player.alive ? 1 : 0;
  dom.crosshair.style.opacity = player.loadout.scoped ? 0 : 1;
  dom.spectate.style.opacity = !player.alive && state.phase !== PHASE.OVER ? 1 : 0;

  // Buy menu availability plus the bomb channel progress bar.
  dom.buymenu.hidden = !(state.buyOpen && player.alive);
  document.querySelectorAll('[data-buy]').forEach((button) => {
    const priceTable = { rifle: 2700, smg: 1500, sniper: 4500, he: 300, flash: 200, smoke: 300 };
    const itemKey = button.getAttribute('data-buy');
    const alreadyOwned = itemKey === player.loadout.slots.primary || player.loadout.grenades[itemKey] > 0;
    button.classList.toggle('cant', alreadyOwned || player.money < (priceTable[itemKey] || 0));
    button.classList.toggle('owned', alreadyOwned);
  });
  const barVisible = state.bomb.progress > 0;
  dom.bombbar.style.opacity = barVisible ? 1 : 0;
  if (barVisible) {
    dom.bombfill.style.width = Math.min(100, state.bomb.progress * 100) + '%';
    dom.bomblabel.textContent = state.phase === PHASE.PLANTED ? 'Defusing…' : 'Planting…';
  }
}
