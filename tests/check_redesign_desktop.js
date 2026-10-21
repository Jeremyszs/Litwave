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

function load(files, opts) {
  const byId = {};
  const documentStub = {
    readyState: (opts && opts.readyState) || undefined, documentElement: el(), body: el(), createElement: el, createElementNS: () => el(),
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

const KIT = ["core.js", "spring.js", "icons.js", "controls.js", "island.js", "sheet.js", "undo.js"].map((f) => "js/kit/" + f);

function run(name, fn) {
  const fail = (e) => { console.error("FAIL:", name, "-", e.message); process.exitCode = 1; };
  try {
    const r = fn();
    if (r && typeof r.then === "function") r.then(() => console.log("PASS:", name), fail); // async tests report when they settle
    else console.log("PASS:", name);
  } catch (e) { fail(e); }
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

const T4 = [...KIT, "js/desktop/state.js", "js/desktop/telemetry.js", "js/desktop/song.js", "js/desktop/keyboard.js", "js/desktop/progression.js", "js/desktop/voicing.js", "js/desktop/lyrics.js"];

run("empty states: no chart and no lyrics render without errors", () => {
  const ctx = load(T4);
  ctx.LW.state.chart = [];
  ctx.LW.state.lyrics = null;
  ctx.LW.progression.render(0);
  ctx.LW.lyrics.render();
  const meta = ctx.document.getElementById("progMeta").textContent;
  assert(/analysis/i.test(meta), `progress meta was "${meta}"`);
  assert(/lyrics/i.test(ctx.document.getElementById("lyrics").textContent), "lyrics empty state missing");
});

run("chords.current falls back to the live MIDI chord when there is no chart", () => {
  const ctx = load(T4);
  ctx.LW.state.chart = [];
  ctx.LW.state.midi = { active_notes: [60, 64, 67], active_note_names: ["C4", "E4", "G4"] };
  assert.strictEqual(ctx.LW.chords.current().chord, "C");
});

run("voicing presets spell inversions and extensions", () => {
  const ctx = load(T4);
  assert.deepStrictEqual(Array.from(ctx.LW.voicing.get("C", "root").notes), ["C", "E", "G"]);
  assert.deepStrictEqual(Array.from(ctx.LW.voicing.get("C", "inv1").notes), ["E", "G", "C"]);
  assert.strictEqual(ctx.LW.voicing.get("Am", "ext1").name, "Am7");
  assert(Array.from(ctx.LW.voicing.get("C", "ext2").notes).includes("D"), "add9 needs D");
});

run("lyric line lookup finds the line playing at a time", () => {
  const ctx = load(T4);
  const sheet = [{ time: 0, text: "a" }, { time: 5, text: "b" }, { time: 9, text: "c" }];
  assert.strictEqual(ctx.LW.lyrics.indexAt(sheet, 6), 1);
  assert.strictEqual(ctx.LW.lyrics.indexAt(sheet, 12), 2);
  assert.strictEqual(ctx.LW.lyrics.indexAt([], 3), -1);
});

const T5 = [...KIT, "js/desktop/state.js", "js/desktop/telemetry.js", "js/desktop/mixer.js", "js/desktop/eq.js", "js/desktop/metronome.js", "js/desktop/scenes.js"];

run("EQ response is flat at 0 dB and follows a peaking band", () => {
  const ctx = load(T5);
  assert.strictEqual(ctx.LW.eq.responseAt(1000), 0);
  ctx.LW.eq.bands[2].gain = 6; ctx.LW.eq.bands[2].freq = 1000;
  const r = ctx.LW.eq.responseAt(1000);
  assert(r > 5.9 && r < 6.1, `got ${r}`);
});

run("tap tempo averages taps into BPM and ignores long gaps", () => {
  const ctx = load(T5);
  assert.strictEqual(ctx.LW.metronome.bpmFromTaps([0, 500, 1000, 1500]), 120);
  assert.strictEqual(ctx.LW.metronome.bpmFromTaps([0, 3000]), null);
});

run("scene telemetry updates the active scene and names", () => {
  const ctx = load(T5);
  ctx.renderTelemetry({ montage: { current_scene: 5, scene_names: { 5: "<i>Bridge</i>" } } });
  assert.strictEqual(ctx.LW.state.scenes.active, 5);
  assert.strictEqual(ctx.LW.sceneName(5), "<i>Bridge</i>");
});

const T6 = [...KIT, "js/desktop/state.js", "js/desktop/telemetry.js", "js/desktop/fxpads.js", "js/desktop/drone.js", "js/desktop/parts.js", "js/desktop/setlist.js"];

run("fx pads for a bank are filtered and ordered by pad index", () => {
  const ctx = load(T6);
  ctx.LW.state.fxPads.pads = { b2: { id: "b2", bank: "B", pad_index: 1 }, a1: { id: "a1", bank: "A", pad_index: 0 }, b1: { id: "b1", bank: "B", pad_index: 0 } };
  assert.deepStrictEqual(Array.from(ctx.LW.fx.padsForBank("B")).map((p) => p.id), ["b1", "b2"]);
});

run("drone keeps the user's choice for 600 ms against incoming telemetry", () => {
  const ctx = load(T6);
  ctx.LW.drone.setRoot("D");
  ctx.renderTelemetry({ drone_pad: { active: false, root: "C", volume: 95, cutoff: 68 } });
  assert.strictEqual(ctx.LW.state.drone.root, "D");
});

run("parts telemetry merges names and mixer values", () => {
  const ctx = load(T6);
  ctx.renderTelemetry({ montage: { part_names: { 3: "<b>Strings</b>" }, part_volumes: { 3: 77 }, part_mutes: { 2: true } } });
  const p = ctx.LW.parts.state;
  assert.strictEqual(p[2].name, "<b>Strings</b>");
  assert.strictEqual(p[2].val, 77);
  assert.strictEqual(p[1].mute, true);
});

run("setlist song subtitle shows key, pad root and engine", () => {
  const ctx = load(T6);
  const t = ctx.LW.setlist.songSub({ key: "E", patch_snapshot: { drone_root: "E", engine_type: "community" } });
  assert(/E/.test(t) && /community/i.test(t), t);
});

const T7 = [...KIT, "js/desktop/state.js", "js/desktop/telemetry.js", "js/desktop/song.js", "js/desktop/stage.js"];

run("stage runway lays out playable chart chords by time", () => {
  const ctx = load(T7);
  const items = ctx.LW.stage.runwayItems([{ time: 0, chord: "N" }, { time: 2, chord: "C", nashville: "1" }, { time: 4, chord: "G" }], 10, 50);
  assert.strictEqual(items.length, 2);
  assert.strictEqual(items[0].x, 100);
  assert.strictEqual(items[0].w, 100);
  assert.strictEqual(items[1].w, 300);
});

run("stage hero falls back to the live MIDI chord without a chart", () => {
  const ctx = load(T7);
  ctx.LW.state.chart = [];
  ctx.LW.state.midi = { active_notes: [57, 60, 64], active_note_names: ["A3", "C4", "E4"] };
  assert.strictEqual(ctx.LW.stage.hero().chord, "Am");
  assert.strictEqual(ctx.LW.stage.hero().runway, false);
});

run("Escape closes the top sheet even while a text field has focus, and never rewinds then", () => {
  const ctx = load([...KIT, "js/desktop/app.js"], { readyState: "loading" });
  const LW = ctx.LW;
  let closed = 0, seeks = 0, blurred = 0;
  LW.sheets = { closeTop() { closed++; return true; } };
  LW.transport = { seek() { seeks++; }, toggle() { seeks += 100; } };
  LW.layout = {};
  const input = { tagName: "INPUT", blur() { blurred++; }, getAttribute() { return null; }, closest() { return null; } };
  const ev = (key, target) => ({ key, code: key, target, preventDefault() {} });
  LW.keys.handle(ev("Escape", input));
  assert.strictEqual(closed, 1, "Escape in an input must close the open dialog");
  assert.strictEqual(seeks, 0, "Escape in an input must not rewind");
  LW.sheets.closeTop = () => false;
  LW.keys.handle(ev("Escape", input));
  assert.strictEqual(seeks, 0, "Escape in an input with nothing open must not rewind");
  LW.keys.handle({ key: " ", code: "Space", target: input, preventDefault() {} });
  assert.strictEqual(seeks, 0, "Space typed into a field must not toggle playback");
});

run("drone sliders send to the server only on release; dragging just previews", () => {
  const ctx = load([...KIT, "js/desktop/state.js", "js/desktop/drone.js"]);
  const LW = ctx.LW;
  const posts = [];
  LW.api.post = (u, b) => { posts.push(b); return Promise.resolve({}); };
  const sliders = [];
  LW.ui.slider = (el, o) => { sliders.push(o); return { set() {}, get dragging() { return false; } }; };
  LW.registerSheet = () => {}; LW.sheet = () => ({});
  LW.emit("ready");
  assert.strictEqual(sliders.length, 2, "volume and cutoff sliders");
  sliders.forEach((o) => { o.onInput(40); o.onInput(80); });
  assert.strictEqual(posts.length, 0, "dragging must not post");
  assert.strictEqual(LW.state.drone.volume, 80, "dragging still updates the live value");
  assert.strictEqual(LW.state.drone.cutoff, 80);
  sliders[0].onChange(80); sliders[1].onChange(50);
  assert.strictEqual(JSON.stringify(posts), JSON.stringify([{ action: "set_volume", volume: 80 }, { action: "set_cutoff", cutoff: 50 }]));
});

const T_UNDO = [...KIT, "js/desktop/state.js", "js/desktop/telemetry.js", "js/desktop/transport.js", "js/desktop/markers.js", "js/desktop/song.js"];
const settle = () => new Promise((r) => setImmediate(r));

run("Ctrl/Cmd+Z undoes the latest destructive action, but never steals Undo inside a text field", () => {
  const ctx = load([...KIT, "js/desktop/app.js"], { readyState: "loading" });
  const LW = ctx.LW;
  let undone = 0;
  LW.sheets = { closeTop() { return false; } }; LW.transport = {}; LW.layout = {};
  LW.undo = { available: true, run() { undone++; return true; } };
  const plain = { tagName: "DIV", getAttribute() { return null; }, closest() { return null; } };
  const input = { tagName: "INPUT", getAttribute() { return null; }, closest() { return null; } };
  let prevented = 0;
  const key = (target, extra) => ({ key: "z", code: "KeyZ", target, preventDefault() { prevented++; }, ...extra });
  LW.keys.handle(key(plain, { ctrlKey: true }));
  LW.keys.handle(key(plain, { metaKey: true }));
  assert.strictEqual(undone, 2, "Ctrl+Z and Cmd+Z both undo");
  assert.strictEqual(prevented, 2);
  LW.keys.handle(key(input, { ctrlKey: true }));
  assert.strictEqual(undone, 2, "inside a text field the browser's own undo wins");
  LW.undo.available = false;
  prevented = 0;
  LW.keys.handle(key(plain, { ctrlKey: true }));
  assert.strictEqual(prevented, 0, "with nothing to undo the key is left alone");
  LW.keys.handle(key(plain, { ctrlKey: true, shiftKey: true }));
  assert.strictEqual(undone, 2, "Ctrl+Shift+Z is not undo");
});

run("deleting a section can be undone: the same name, time and scene come back", async () => {
  const ctx = load(T_UNDO);
  const LW = ctx.LW;
  const calls = [];
  LW.transport.action = (a, b) => { calls.push([a, b]); return Promise.resolve({}); };
  LW.state.markers = [{ id: 3, name: "Verse", time: 40, scene: 2 }, { id: 4, name: "Chorus", time: 80, scene: null }];
  await LW.markers.remove(3);
  assert.strictEqual(JSON.stringify(calls), JSON.stringify([["remove_marker", { id: 3 }]]));
  assert.strictEqual(LW.undo.available, true, "an undo should be on offer");
  calls.length = 0;
  LW.undo.run();
  await settle();
  assert.strictEqual(JSON.stringify(calls), JSON.stringify([["add_marker", { name: "Verse", time: 40, scene: 2 }]]));
  calls.length = 0;
  await LW.markers.remove(4);
  LW.undo.run(); await settle();
  assert.strictEqual(JSON.stringify(calls[1]), JSON.stringify(["add_marker", { name: "Chorus", time: 80, scene: null }]));
});

run("deleting a section that is not in the list sends the delete and offers no undo", async () => {
  const ctx = load(T_UNDO);
  const LW = ctx.LW;
  const calls = [];
  LW.transport.action = (a, b) => { calls.push([a, b]); return Promise.resolve({}); };
  LW.state.markers = [];
  await LW.markers.remove(9);
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(LW.undo.available, false);
});

run("clearing the song can be undone: the file reloads and position, speed, key shift and loop come back", async () => {
  const ctx = load(T_UNDO);
  const LW = ctx.LW;
  const log = [];
  LW.transport.action = (a, b) => { log.push(["action", a, b]); return Promise.resolve({}); };
  LW.api.post = (u, b) => { log.push(["post", u, b]); return Promise.resolve({ success: true }); };
  Object.assign(LW.state, { hasTrack: true, song: { filename: "Demo Song.mp3", current_time_seconds: 61.5, speed: 0.75, pitch_shift: 2, loop_a: 30, loop_b: 60, loop_enabled: true } });
  await LW.song.clear();
  assert.strictEqual(JSON.stringify(log[0]), JSON.stringify(["action", "clear_track", undefined]));
  assert.strictEqual(LW.undo.available, true);
  log.length = 0;
  LW.undo.run();
  await settle(); await settle();
  assert.strictEqual(JSON.stringify(log), JSON.stringify([
    ["post", "/api/playlist/select", { filename: "Demo Song.mp3" }],
    ["action", "speed", { speed: 0.75 }],
    ["action", "pitch_shift", { semitones: 2 }],
    ["action", "loop_a", { seconds: 30 }],
    ["action", "loop_b", { seconds: 60 }],
    ["action", "toggle_loop", undefined],
    ["action", "seek", { seconds: 61.5 }],
  ]));
});

run("clearing when no song is loaded offers nothing to undo", async () => {
  const ctx = load(T_UNDO);
  const LW = ctx.LW;
  LW.transport.action = () => Promise.resolve({});
  Object.assign(LW.state, { hasTrack: false, song: {} });
  await LW.song.clear();
  assert.strictEqual(LW.undo.available, false);
});

run("mixer faders never send null/NaN, even when a throttled update is overdue (stale timer after an immediate send)", () => {
  const ctx = load([...KIT, "js/desktop/state.js", "js/desktop/mixer.js"]);
  const LW = ctx.LW;
  let now = 1000;
  ctx.performance.now = () => now;
  const timers = [];
  ctx.setTimeout = (fn) => { timers.push(fn); return timers.length; };
  ctx.clearTimeout = (id) => { if (id) timers[id - 1] = null; };
  const posts = [];
  LW.api.post = (u, b) => { posts.push(b); return Promise.resolve({}); };
  const sliders = {};
  LW.ui.slider = (el, o) => { sliders[o.label] = o; return { set() {}, get() { return 0.5; } }; };
  LW.emit("ready");
  const master = sliders["master volume"];
  now = 1100; master.onInput(0.9); // first update goes out at once
  now = 1110; master.onInput(0.8); // too soon: waits on a timer
  now = 1300; master.onInput(0.7); // the wait is long over: goes out at once, the timer is now stale
  timers.forEach((fn) => fn && fn()); // ...and fires late
  const sent = posts.map((p) => p.master_volume);
  assert(sent.every((v) => typeof v === "number" && Number.isFinite(v)), `a fader sent ${JSON.stringify(sent)}`);
  assert.strictEqual(JSON.stringify(sent), JSON.stringify([0.9, 0.7]));
});
