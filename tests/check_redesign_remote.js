// Behaviour checks for the redesigned phone remote (src/static/js/remote/*), run in a vm.
//   node tests/check_redesign_remote.js
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const assert = require("assert");

const STATIC = path.join(__dirname, "..", "src", "static");

function el() {
  return {
    children: [], style: { setProperty() {} }, dataset: {}, attributes: {}, _text: "", hidden: false, value: "",
    get textContent() { return this._text + this.children.map((c) => c.textContent || "").join(""); },
    set textContent(v) { this._text = String(v); this.children = []; },
    set innerHTML(v) { this._html = String(v); this.children = []; }, get innerHTML() { return this._html || ""; },
    classList: { _s: new Set(), add(...c) { c.forEach((x) => this._s.add(x)); }, remove(...c) { c.forEach((x) => this._s.delete(x)); },
      toggle(c, on) { const v = on === undefined ? !this._s.has(c) : on; v ? this._s.add(c) : this._s.delete(c); return v; }, contains(c) { return this._s.has(c); } },
    setAttribute(k, v) { this.attributes[k] = String(v); }, getAttribute(k) { return this.attributes[k]; }, removeAttribute() {},
    appendChild(c) { this.children.push(c); return c; }, append(...cs) { cs.forEach((c) => this.children.push(typeof c === "string" ? { textContent: c } : c)); },
    addEventListener() {}, querySelector() { return null; }, querySelectorAll() { return []; },
    getBoundingClientRect() { return { left: 0, top: 0, width: 100, height: 20 }; }, closest() { return null; }, contains() { return false; }, focus() {}, remove() {},
  };
}

function load(files) {
  const byId = {};
  const documentStub = {
    documentElement: el(), body: el(), createElement: el, createElementNS: () => el(), visibilityState: "visible",
    addEventListener() {}, querySelector() { return null; }, querySelectorAll() { return []; },
    getElementById(id) { return byId[id] || (byId[id] = el()); },
  };
  const ctx = {
    console, setTimeout, clearTimeout, setInterval() { return 0; }, performance: { now: () => 100000 }, document: documentStub, navigator: {},
    localStorage: { getItem() { return null; }, setItem() {} }, matchMedia: () => ({ matches: false, addEventListener() {} }),
    requestAnimationFrame: () => 0, addEventListener() {}, getComputedStyle: () => ({ getPropertyValue: () => "" }), innerWidth: 390, innerHeight: 844, location: { reload() {} },
  };
  ctx.window = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);
  for (const f of ["chord_timeline.js", "browser_api.js"]) vm.runInContext(fs.readFileSync(path.join(STATIC, f), "utf8"), ctx, { filename: f });
  for (const f of files) vm.runInContext(fs.readFileSync(path.join(STATIC, f), "utf8"), ctx, { filename: f });
  return ctx;
}

const KIT = ["core.js", "spring.js", "icons.js", "controls.js", "island.js", "sheet.js"].map((f) => "js/kit/" + f);
const R = [...KIT, "js/remote/state.js", "js/remote/stage.js", "js/remote/pads.js", "js/remote/mix.js", "js/remote/parts.js", "js/remote/song.js"];

function run(name, fn) {
  try { fn(); console.log("PASS:", name); } catch (e) { console.error("FAIL:", name, "-", e.message); process.exitCode = 1; }
}

run("play button sends play when stopped and pause when playing", () => {
  const ctx = load(R);
  ctx.LW.R.state.song = { is_playing: false };
  assert.strictEqual(ctx.LW.R.playAction(), "play");
  ctx.LW.R.state.song = { is_playing: true };
  assert.strictEqual(ctx.LW.R.playAction(), "pause");
});

run("EQ band sliders map 0..1 to -18..+18 dB", () => {
  const ctx = load(R);
  assert.strictEqual(ctx.LW.R.mix.eqGain(0.5), 0);
  assert.strictEqual(ctx.LW.R.mix.eqGain(1), 18);
  assert.strictEqual(ctx.LW.R.mix.eqGain(0), -18);
});

run("phone drone keeps the user's choice for 600 ms against telemetry", () => {
  const ctx = load(R);
  ctx.LW.R.drone.setRoot("F");
  ctx.LW.R.ingest({ type: "telemetry", drone_pad: { active: false, root: "C", volume: 95, cutoff: 68 } });
  assert.strictEqual(ctx.LW.R.state.drone.root, "F");
});

run("phone live chord falls back to MIDI chord and Nashville from the song key", () => {
  const ctx = load(R);
  ctx.LW.R.state.key = "G";
  const c = ctx.LW.R.chordFromNotes([62, 66, 69]);
  assert.strictEqual(c.chord, "D");
  assert.strictEqual(c.nashville, "[5]");
});

run("phone seek drag sends at most one seek per 100 ms, then the exact release position", () => {
  const ctx = load(R);
  const sent = [];
  ctx.LW.R.transport = (a, b) => { sent.push([a, b && b.seconds]); return Promise.resolve(); };
  ctx.LW.R.state.song = { duration_seconds: 200 };
  for (let i = 1; i <= 30; i++) ctx.LW.R.song.scrub(i / 60);
  ctx.LW.R.song.scrub(0.5, true);
  assert(sent.length <= 2, `a fast drag sent ${sent.length} seeks`);
  assert.deepStrictEqual(sent[sent.length - 1], ["seek", 100]);
});
