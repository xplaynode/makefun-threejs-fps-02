// smoke.mjs — plays SLAGLINE hands-off in headless Chromium and reports whether
// a match actually happens: clicks Play, then samples the live game state
// (window.__slagline) while the buy phase ends and the bots fight a round.
//   node tools/smoke.mjs
// A healthy run: phases advance BUY -> LIVE, bots leave their spawns, shots are
// fired (noise events), somebody's hp drops, and the console stays clean.

import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const CHROME = process.env.CHROME_BIN || `${process.env.HOME}/.cache/puppeteer/chrome/linux-157.0.8103.50/chrome-linux64/chrome`;
const PORT = 8138;
const DEBUG_PORT = 9224;

const server = spawn('node', [join(root, 'serve.ts'), '--port', String(PORT)], { stdio: 'pipe' });
const chrome = spawn(CHROME, [
  '--headless=new', '--no-sandbox', '--disable-dev-shm-usage',
  '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  `--remote-debugging-port=${DEBUG_PORT}`, '--window-size=1280,800', 'about:blank',
], { stdio: 'pipe' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let msgId = 0;
const pending = new Map();
const problems = [];

async function pageSocket() {
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`);
      const page = (await res.json()).find((t) => t.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    } catch { /* retry */ }
    await sleep(250);
  }
  throw new Error('no debug endpoint');
}

function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.onopen = () => resolve({
      send(method, params = {}) {
        const id = ++msgId;
        ws.send(JSON.stringify({ id, method, params }));
        return new Promise((res2, rej2) => pending.set(id, { res2, rej2 }));
      },
      close() { ws.close(); },
    });
    ws.onerror = reject;
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && pending.has(msg.id)) {
        const { res2, rej2 } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) rej2(new Error(msg.error.message)); else res2(msg.result);
      }
      if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
        problems.push(msg.params.args.map((a) => a.value || a.description || '').join(' '));
      }
      if (msg.method === 'Runtime.exceptionThrown') {
        problems.push('exception: ' + (msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text));
      }
    };
  });
}

const snapshot = `(() => {
  const s = window.__slagline;
  if (!s) return { ready: false };
  const moved = s.actors.filter(a => !a.isPlayer && (Math.abs(a.x) > 0.01 || Math.abs(a.z) > 0.01)).length;
  return {
    ready: true, phase: s.phase, round: s.round, time: Math.round(s.time),
    score: [s.score.breaker, s.score.warden],
    alive: [s.actors.filter(a => a.team === 'breaker' && a.alive).length,
            s.actors.filter(a => a.team === 'warden' && a.alive).length],
    hurt: s.actors.filter(a => a.hp < 100).map(a => a.name + ':' + Math.ceil(a.hp)),
    bomb: s.bomb.status,
    actorsMovedFromSpawn: s.actors.filter(a => !a.isPlayer).filter(a => {
      const sp = a.team === 'breaker' ? [-42, -40] : [40, 42];
      return !(sp.includes(Math.round(a.x)) && Math.abs(a.z) <= 7);
    }).length,
  };
})()`;

try {
  await sleep(600);
  const cdp = await connect(await pageSocket());
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/` });
  await sleep(3000);
  await cdp.send('Runtime.evaluate', { expression: `document.getElementById('play').click()` });
  console.log('clicked play; sampling the match (SwiftShader runs slow — sim time lags real time)');
  await sleep(9000);
  let r = await cdp.send('Runtime.evaluate', { expression: snapshot, returnByValue: true });
  console.log(JSON.stringify(r.result.value));
  // Skip the rest of the buy phase so the samples reach live combat in
  // reasonable real time; the round itself then runs untouched.
  await cdp.send('Runtime.evaluate', { expression: `window.__slagline.phaseT = 0.3` });
  for (const wait of [30000, 40000]) {
    await sleep(wait);
    r = await cdp.send('Runtime.evaluate', { expression: snapshot, returnByValue: true });
    console.log(JSON.stringify(r.result.value));
  }
  console.log(problems.length ? `CONSOLE PROBLEMS: ${problems.join(' ;; ')}` : 'console clean throughout');
  cdp.close();
} finally {
  chrome.kill('SIGKILL');
  server.kill('SIGKILL');
}
