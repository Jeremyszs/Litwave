// Hermetic end-to-end harness: a tiny Node server stands in for Litwave (static UI, fixture GETs, recorded POSTs,
// a minimal WebSocket telemetry feed) and real Chrome drives the real pages with real mouse/touch/keyboard input.
// No Python server, no audio hardware, and nothing that can touch the user's data files.
import http from 'node:http';
import crypto from 'node:crypto';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const STATIC = path.resolve(HERE, '..', '..', 'src', 'static');
const FIX = JSON.parse(fs.readFileSync(path.join(HERE, 'fixtures', 'api.json'), 'utf8'));
const TELEMETRY = JSON.parse(fs.readFileSync(path.join(HERE, 'fixtures', 'telemetry.json'), 'utf8'));
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.txt': 'text/plain' };
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clone = (o) => JSON.parse(JSON.stringify(o));

/* ---------------------------------------------------------------- fake Litwave server */
function wsFrame(str) {
  const payload = Buffer.from(str);
  const len = payload.length;
  let head;
  if (len < 126) head = Buffer.from([0x81, len]);
  else if (len < 65536) { head = Buffer.alloc(4); head[0] = 0x81; head[1] = 126; head.writeUInt16BE(len, 2); }
  else { head = Buffer.alloc(10); head[0] = 0x81; head[1] = 127; head.writeBigUInt64BE(BigInt(len), 2); }
  return Buffer.concat([head, payload]);
}

export async function startServer() {
  const state = { calls: [], stubs: [], telemetry: clone(TELEMETRY), sockets: new Set(), api: clone(FIX) };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const send = (code, type, body) => { res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' }); res.end(body); };
    const json = (code, obj) => send(code, 'application/json', JSON.stringify(obj));
    if (url.pathname.startsWith('/api/')) {
      if (req.method === 'GET') {
        const body = state.api[url.pathname];
        return body === undefined ? json(404, { error: 'no fixture for ' + url.pathname }) : json(200, body);
      }
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let body = raw;
        try { body = JSON.parse(raw); } catch (_) { if ((req.headers['content-type'] || '').startsWith('multipart')) body = '[form]'; }
        state.calls.push({ method: req.method, url: url.pathname, body });
        const stub = state.stubs.find((s) => s.re.test(url.pathname));
        const out = stub ? stub.fn(body) : { success: true };
        if (out && out.__status) return json(out.__status, out.body || {});
        json(200, out);
      });
      return;
    }
    let file = null;
    if (url.pathname === '/') file = 'index.html';
    else if (url.pathname === '/remote') file = 'remote.html';
    else if (url.pathname === '/sw.js') file = 'sw.js';
    else if (url.pathname === '/manifest.json') file = 'manifest.json';
    else if (url.pathname.startsWith('/static/')) file = decodeURIComponent(url.pathname.slice('/static/'.length));
    if (!file) return send(404, 'text/plain', 'not found');
    const full = path.resolve(STATIC, file);
    if (!full.startsWith(STATIC) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) return send(404, 'text/plain', 'not found');
    send(200, MIME[path.extname(full)] || 'application/octet-stream', fs.readFileSync(full));
  });
  server.on('upgrade', (req, socket) => {
    if (req.url !== '/ws') { socket.destroy(); return; }
    const accept = crypto.createHash('sha1').update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    state.sockets.add(socket);
    socket.on('data', () => {});
    socket.on('close', () => state.sockets.delete(socket));
    socket.on('error', () => state.sockets.delete(socket));
    socket.write(wsFrame(JSON.stringify(state.telemetry)));
  });
  const tick = setInterval(() => { const f = wsFrame(JSON.stringify(state.telemetry)); for (const s of state.sockets) s.write(f); }, 250);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  return {
    port, url: `http://127.0.0.1:${port}`,
    get calls() { return state.calls; },
    clearCalls() { state.calls.length = 0; },
    /** Answer POSTs whose path matches `re` with fn(body); return {__status, body} for errors. */
    stub(re, fn) { state.stubs.push({ re, fn }); },
    /** Change what the telemetry feed (and the API status) reports. */
    setTelemetry(fn) { fn(state.telemetry); },
    setApi(pathname, body) { state.api[pathname] = body; },
    broadcast(obj) { const f = wsFrame(JSON.stringify(obj)); for (const s of state.sockets) s.write(f); },
    dropSockets() { for (const s of state.sockets) s.destroy(); state.sockets.clear(); },
    reset() { state.calls.length = 0; state.stubs.length = 0; state.telemetry = clone(TELEMETRY); state.api = clone(FIX); },
    async close() { clearInterval(tick); this.dropSockets(); await new Promise((r) => server.close(r)); },
  };
}

/* ---------------------------------------------------------------- Chrome */
export function findChrome() {
  const env = process.env.CHROME_PATH;
  const cands = [env,
    'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe'),
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].filter(Boolean);
  for (const c of cands) if (fs.existsSync(c)) return c;
  for (const n of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']) {
    const r = spawnSync(process.platform === 'win32' ? 'where' : 'which', [n], { encoding: 'utf8' });
    if (r.status === 0 && r.stdout.trim()) return r.stdout.trim().split(/\r?\n/)[0];
  }
  return null;
}

const freePort = () => new Promise((res) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });

export async function launchBrowser() {
  const exe = findChrome();
  if (!exe) return null;
  const port = await freePort();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'litwave-e2e-'));
  const proc = spawn(exe, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--hide-scrollbars', '--no-sandbox',
    '--disable-gpu', '--no-first-run', '--autoplay-policy=no-user-gesture-required', 'about:blank'], { stdio: 'ignore' });
  for (let i = 0; i < 100; i++) { try { await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); break; } catch (_) { await sleep(150); } }
  const browser = {
    async newPage({ width = 1440, height = 900, mobile = false } = {}) {
      const t = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
      return openPage(t, port, { width, height, mobile });
    },
    close() { try { proc.kill(); } catch (_) {} try { fs.rmSync(profile, { recursive: true, force: true }); } catch (_) {} },
  };
  return browser;
}

async function openPage(target, port, { width, height, mobile }) {
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0; const pending = new Map(); const errors = [];
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') errors.push('EXC ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push('ERR ' + m.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
  };
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });
  if (mobile) await send('Emulation.setTouchEmulationEnabled', { enabled: true });

  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) throw new Error('eval: ' + (r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text));
    return r.result?.result?.value;
  };
  const q = JSON.stringify;
  /** Centre of an element if it is really hittable (not hidden, not covered by something else). */
  const rect = async (sel) => ev(`(() => { const e = document.querySelector(${q(sel)}); if (!e) return null; e.scrollIntoView({block:'center',inline:'center'});
    const r = e.getBoundingClientRect(); if (!(r.width && r.height) || getComputedStyle(e).visibility === 'hidden') return {hidden:true};
    const t = document.elementFromPoint(r.left + r.width/2, r.top + r.height/2);
    if (!t || !(e === t || e.contains(t) || t.contains(e))) return {hidden:true, covered: t ? t.tagName + '.' + t.className + '#' + t.id : 'nothing'};
    return {x:r.left, y:r.top, w:r.width, h:r.height}; })()`);
  const hit = async (sel) => {
    const r = await rect(sel);
    if (!r) throw new Error('no element ' + sel);
    if (r.hidden) throw new Error(`${sel} is not clickable${r.covered ? ' (covered by ' + r.covered + ')' : ''}`);
    return r;
  };
  const mouse = (type, x, y, extra = {}) => send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1, ...extra });
  const touch = (type, pts) => send('Input.dispatchTouchEvent', { type, touchPoints: pts });

  const page = {
    errors, send, ev, sleep, lastTouch: 0,
    async goto(p) { await send('Page.navigate', { url: page.base + p }); await sleep(300); await page.waitFor(`document.readyState === 'complete' && window.LW && LW.ui`, 8000); await sleep(400); },
    async waitFor(expr, timeout = 4000, label) {
      const t0 = Date.now();
      while (Date.now() - t0 < timeout) { try { if (await ev(`!!(${expr})`)) return true; } catch (_) {} await sleep(40); }
      throw new Error('timed out waiting for ' + (label || expr));
    },
    async click(sel, fx = 0.5, fy = 0.5) {
      const r = await hit(sel); const x = r.x + r.w * fx, y = r.y + r.h * fy;
      await mouse('mouseMoved', x, y, { buttons: 0 }); await mouse('mousePressed', x, y); await sleep(30); await mouse('mouseReleased', x, y);
    },
    async clickAt(x, y) { await mouse('mouseMoved', x, y, { buttons: 0 }); await mouse('mousePressed', x, y); await sleep(30); await mouse('mouseReleased', x, y); },
    async drag(sel, f0, f1, { vertical = false, steps = 8 } = {}) {
      const r = await hit(sel);
      const pt = (f) => (vertical ? [r.x + r.w / 2, r.y + r.h * (1 - f)] : [r.x + r.w * f, r.y + r.h / 2]);
      const [x0, y0] = pt(f0); await mouse('mouseMoved', x0, y0, { buttons: 0 }); await mouse('mousePressed', x0, y0);
      for (let i = 1; i <= steps; i++) { const [x, y] = pt(f0 + ((f1 - f0) * i) / steps); await mouse('mouseMoved', x, y); await sleep(12); }
      const [x1, y1] = pt(f1); await mouse('mouseReleased', x1, y1);
    },
    /** Mouse drag that you can pause mid-way: returns {move(f), release()} */
    async dragHold(sel, f0, f1, { steps = 8 } = {}) {
      const r = await hit(sel); const at = (f) => [r.x + r.w * f, r.y + r.h / 2];
      const [x0, y0] = at(f0); await mouse('mouseMoved', x0, y0, { buttons: 0 }); await mouse('mousePressed', x0, y0);
      for (let i = 1; i <= steps; i++) { const [x, y] = at(f0 + ((f1 - f0) * i) / steps); await mouse('mouseMoved', x, y); await sleep(12); }
      return { async release() { const [x, y] = at(f1); await mouse('mouseReleased', x, y); } };
    },
    async tap(sel, fx = 0.5, fy = 0.5) {
      // Space taps like a person does: Chrome reads two taps inside ~300 ms as a double-tap and drops the second click.
      const wait = 350 - (Date.now() - page.lastTouch);
      if (wait > 0) await sleep(wait);
      const r = await hit(sel); const x = r.x + r.w * fx, y = r.y + r.h * fy;
      await touch('touchStart', [{ x, y, id: 1 }]); await sleep(60); await touch('touchEnd', []);
      page.lastTouch = Date.now();
    },
    async touchDrag(sel, f0, f1, { steps = 8 } = {}) {
      const r = await hit(sel); const at = (f) => [r.x + r.w * f, r.y + r.h / 2];
      const [x0, y0] = at(f0); await touch('touchStart', [{ x: x0, y: y0, id: 1 }]);
      for (let i = 1; i <= steps; i++) { const [x, y] = at(f0 + ((f1 - f0) * i) / steps); await touch('touchMove', [{ x, y, id: 1 }]); await sleep(30); }
      await touch('touchEnd', []);
    },
    async key(k, opts = {}) {
      const map = { Space: ['Space', ' ', 32], Escape: ['Escape', 'Escape', 27], Enter: ['Enter', 'Enter', 13], F12: ['F12', 'F12', 123] };
      const [code, key, vk] = map[k] || [k.length === 1 ? 'Key' + k.toUpperCase() : k, k, k.length === 1 ? k.toUpperCase().charCodeAt(0) : 0];
      await send('Input.dispatchKeyEvent', { type: 'keyDown', code, key, windowsVirtualKeyCode: vk, text: key.length === 1 ? key : undefined, ...opts });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', code, key, windowsVirtualKeyCode: vk, ...opts });
    },
    async type(sel, text) { await ev(`(() => { const i = document.querySelector(${q(sel)}); i.focus(); i.value = ${q(text)}; i.dispatchEvent(new Event('input', {bubbles:true})); })()`); },
    async select(sel, value) { await ev(`(() => { const s = document.querySelector(${q(sel)}); s.value = ${q(value)}; s.dispatchEvent(new Event('input', {bubbles:true})); s.dispatchEvent(new Event('change', {bubbles:true})); })()`); },
    text: (sel) => ev(`(document.querySelector(${q(sel)}) || {}).textContent`),
    count: (sel) => ev(`document.querySelectorAll(${q(sel)}).length`),
    openSheets: () => ev(`[...document.querySelectorAll('.sheet.open')].map(s => s.id)`),
    async shot(file) { const r = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(file, Buffer.from(r.result.data, 'base64')); },
    async close() { try { ws.close(); } catch (_) {} try { await fetch(`http://127.0.0.1:${port}/json/close/${target.id}`); } catch (_) {} },
  };
  return page;
}
