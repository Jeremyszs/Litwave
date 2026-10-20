// Behaviour checks for the redesigned desktop scripts (src/static/js/desktop/*), run in a vm.
//   node tests/check_redesign_desktop.js
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const assert = require("assert");

const STATIC = path.join(__dirname, "..", "src", "static");

function el() {
  const e = {
    children: [], style: { setProperty() {} }, dataset: {}, attributes: {}, _text: "", hidden: false, value: "",
    get textContent() { return this._text + this.children.map((c) => c.textContent || "").join(""); },
    set textContent(v) { this._text = String(v); this.children = []; },
    set innerHTML(v) { this._html = String(v); this.children = []; }, get innerHTML() { return this._html || ""; },
    classList: { _s: new Set(), add(...c) { c.forEach((x) => this._s.add(x)); }, remove(...c) { c.forEach((x) => this._s.delete(x)); },
      toggle(c, on) { const v = on === undefined ? !this._s.has(c) : on; v ? this._s.add(c) : this._s.delete(c); return v; }, contains(c) { return this._s.has(c); } },
    setAttribute(k, v) { this.attributes[k] = String(v); }, getAttribute(k) { return this.attributes[k]; }, removeAttribute() {},
    appendChild(c) { this.children.push(c); return c; }, append(...cs) { cs.forEach((c) => this.children.push(typeof c === "string" ? { textContent: c } : c)); },
    addEventListener() {}, querySelector() { return null; }, querySelectorAll() { return []; },
    getBoundingClientRect() { return { left: 0, top: 0, width: 100, height: 20 }; }, getContext() { return null; },
    closest() { return null; }, contains() { return false; }, focus() {}, remove() {}, scrollTo() {},
  };
  return e;
}

function load(files) {
  const byId = {};
  const documentStub = {
    documentElement: el(), body: el(), createElement: el, createElementNS: () => el(),
    addEventListener() {}, querySelector() { return null; }, querySelectorAll() { return []; },
    getElementById(id) { return byId[id] || (byId[id] = el()); },
  };
  const ctx = {
    console, setTimeout, clearTimeout, performance: { now: () => 100000 }, document: documentStub, navigator: {},
    localStorage: { getItem() { return null; }, setItem() {} }, matchMedia: () => ({ matches: false, addEventListener() {} }),
    requestAnimationFrame: () => 0, addEventListener() {}, getComputedStyle: () => ({ getPropertyValue: () => "" }), innerWidth: 1440, innerHeight: 900,
  };
  ctx.window = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);
  for (const f of ["chord_timeline.js", "browser_api.js"]) vm.runInContext(fs.readFileSync(path.join(STATIC, f), "utf8"), ctx, { filename: f });
  for (const f of files) vm.runInContext(fs.readFileSync(path.join(STATIC, f), "utf8"), ctx, { filename: f });
  return ctx;
}

const KIT = ["core.js", "spring.js", "icons.js", "controls.js", "island.js", "sheet.js"].map((f) => "js/kit/" + f);

function run(name, fn) {
  try { fn(); console.log("PASS:", name); } catch (e) { console.error("FAIL:", name, "-", e.message); process.exitCode = 1; }
}

run("telemetry drag guard keeps a dragged fader where the user holds it", () => {
  const ctx = load([...KIT, "js/desktop/state.js", "js/desktop/telemetry.js"]);
  const calls = [];
  ctx.LW.faders.track = { set: (v) => calls.push(v), dragging: false };
  ctx.LW.state.dragging.track = true;
  ctx.renderTelemetry({ audio: { track_volume: 0.2 } });
  assert.strictEqual(calls.length, 0, "fader moved while dragging");
  ctx.LW.state.dragging.track = false;
  ctx.renderTelemetry({ audio: { track_volume: 0.2 } });
  assert.deepStrictEqual(calls, [0.2]);
});

run("telemetry stores song state and notifies listeners", () => {
  const ctx = load([...KIT, "js/desktop/state.js", "js/desktop/telemetry.js"]);
  let seen = null;
  ctx.LW.on("telemetry", (d) => { seen = d; });
  ctx.renderTelemetry({ song: { has_track: true, filename: "a.mp3", current_time_seconds: 3, duration_seconds: 10 } });
  assert.strictEqual(ctx.LW.state.song.filename, "a.mp3");
  assert(seen && seen.song, "listener not called");
});

run("remote-origin scene change raises an island alert, local one does not", () => {
  const ctx = load([...KIT, "js/desktop/state.js", "js/desktop/telemetry.js"]);
  const alerts = [];
  ctx.LW.on("alert", (a) => alerts.push(a));
  ctx.renderTelemetry({ montage: { current_scene: 1 } });
  ctx.renderTelemetry({ montage: { current_scene: 3 } });
  assert.strictEqual(alerts.length, 1, "expected one remote alert");
  assert(/Remote/.test(alerts[0].title), alerts[0].title);
  ctx.LW.local.mark("scene");
  ctx.renderTelemetry({ montage: { current_scene: 4 } });
  assert.strictEqual(alerts.length, 1, "local change should not alert");
});
