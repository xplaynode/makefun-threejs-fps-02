// shots.mjs — takes SLAGLINE's screenshots the honest way: serves game/ locally,
// opens each ?shot= scene from shots.json in headless Chromium (WebGL via
// SwiftShader), waits for real frames, and saves what the browser rendered.
// Console errors and page exceptions are printed, so a broken scene is loud.
//   node tools/shots.mjs
// Output: screenshots/<name from shots.json> at 1280x800, JPEG quality 82.

import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const CHROME = process.env.CHROME_BIN || `${process.env.HOME}/.cache/puppeteer/chrome/linux-157.0.8103.50/chrome-linux64/chrome`;
const PORT = 8137;
const DEBUG_PORT = 9223;
const shots = JSON.parse(readFileSync(join(root, 'shots.json'), 'utf8'));

const server = spawn('node', [join(root, 'serve.ts'), '--port', String(PORT)], { stdio: 'pipe' });
const chrome = spawn(CHROME, [
  '--headless=new', '--no-sandbox', '--disable-dev-shm-usage',
  '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  `--remote-debugging-port=${DEBUG_PORT}`, '--window-size=1280,800',
  'about:blank',
], { stdio: 'pipe' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function pageSocket() {
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`);
      const list = await res.json();
      const page = list.find((t) => t.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    } catch { /* not up yet */ }
    await sleep(250);
  }
  throw new Error('chromium debugging endpoint never came up');
}

let msgId = 0;
const pending = new Map();
let consoleProblems = [];
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
        if (msg.error) rej2(new Error(msg.error.message));
        else res2(msg.result);
      }
      if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
        consoleProblems.push(msg.params.args.map((a) => a.value || a.description || '').join(' '));
      }
      if (msg.method === 'Runtime.exceptionThrown') {
        consoleProblems.push('exception: ' + (msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text));
      }
    };
  });
}

try {
  await sleep(600);
  const cdp = await connect(await pageSocket());
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  mkdirSync(join(root, 'screenshots'), { recursive: true });
  for (const shot of shots) {
    consoleProblems = [];
    await cdp.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/${shot.query}` });
    await sleep(5200); // module load + yard build + several rendered frames (SwiftShader is slow)
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 82 });
    const bytes = Buffer.from(data, 'base64');
    writeFileSync(join(root, 'screenshots', shot.name), bytes);
    console.log(`${shot.name}: ${bytes.length} bytes${consoleProblems.length ? ' — CONSOLE PROBLEMS: ' + consoleProblems.join(' ;; ') : ' — clean console'}`);
  }
  cdp.close();
} finally {
  chrome.kill('SIGKILL');
  server.kill('SIGKILL');
}
