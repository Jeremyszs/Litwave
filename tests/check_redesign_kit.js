// Unit checks for the redesign UI kit (src/static/js/kit/*), run in a vm with a tiny DOM stub.
//   node tests/check_redesign_kit.js
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const assert = require("assert");

const KIT = path.join(__dirname, "..", "src", "static", "js", "kit");

function fakeElement(tag) {
  const el = {
    tagName: String(tag).toUpperCase(), children: [], style: { setProperty() {} }, dataset: {}, attributes: {},
    _text: "", _listeners: {}, parentNode: null, offsetWidth: 0, offsetHeight: 0,
    get textContent() { return this._text + this.children.map((c) => (c.textContent != null ? c.textContent : c._text)).join(""); },
    set textContent(v) { this._text = String(v); this.children = []; },
    set innerHTML(v) { this._html = String(v); }, get innerHTML() { return this._html || ""; },
    classList: {
      _s: new Set(),
      add(...c) { c.forEach((x) => this._s.add(x)); }, remove(...c) { c.forEach((x) => this._s.delete(x)); },
      toggle(c, on) { const v = on === undefined ? !this._s.has(c) : on; v ? this._s.add(c) : this._s.delete(c); return v; },
      contains(c) { return this._s.has(c); },
    },
    setAttribute(k, v) { this.attributes[k] = String(v); }, getAttribute(k) { return this.attributes[k]; },
    removeAttribute(k) { delete this.attributes[k]; },
    appendChild(c) { c.parentNode = this; this.children.push(c); return c; },
    append(...cs) { cs.forEach((c) => (typeof c === "string" ? this.children.push({ _text: c }) : this.appendChild(c))); },
    addEventListener(t, f) { (this._listeners[t] ||= []).push(f); }, removeEventListener() {},
    querySelector() { return null; }, querySelectorAll() { return []; },
    getBoundingClientRect() { return { left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0 }; },
    closest() { return null; }, contains() { return false; }, focus() {}, remove() {},
  };
  return el;
}

function loadKit() {
  const documentStub = {
    documentElement: fakeElement("html"), body: fakeElement("body"),
    createElement: fakeElement, createElementNS: (_ns, t) => fakeElement(t),
    addEventListener() {}, querySelector() { return null; }, querySelectorAll() { return []; }, getElementById() { return null; },
  };
  const ctx = {
    console, setTimeout, clearTimeout, performance: { now: () => 0 },
    document: documentStub, navigator: {}, localStorage: { getItem() { return null; }, setItem() {} },
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    requestAnimationFrame: () => 0, addEventListener() {},
  };
  ctx.window = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);
  for (const f of ["core.js", "spring.js", "icons.js", "controls.js", "island.js", "sheet.js"]) {
    vm.runInContext(fs.readFileSync(path.join(KIT, f), "utf8"), ctx, { filename: f });
  }
  return ctx.LW;
}

function run(name, fn) {
  try { fn(); console.log("PASS:", name); } catch (e) { console.error("FAIL:", name, "-", e.message); process.exitCode = 1; }
}

let LW;
try { LW = loadKit(); } catch (e) { console.error("FAIL: kit failed to load -", e.message); process.exit(1); }

run("esc escapes HTML", () => {
  assert.strictEqual(LW.esc(`<b>&"'`), "&lt;b&gt;&amp;&quot;&#39;");
  assert.strictEqual(LW.esc(null), "");
});

run("fmt formats seconds as m:ss", () => {
  assert.strictEqual(LW.fmt(75.4), "1:15");
  assert.strictEqual(LW.fmt(0), "0:00");
  assert.strictEqual(LW.fmt(NaN), "0:00");
});

run("db converts linear gain", () => {
  assert.strictEqual(LW.db(1), "0.0 dB");
  assert.strictEqual(LW.db(0), "-inf dB");
});

run("spring settles without overshoot when critically damped", () => {
  let max = 0;
  const s = LW.spring(0, { response: 0.4, damping: 1 }, (v) => { max = Math.max(max, v); });
  s.to(100);
  for (let i = 0; i < 120; i++) s.step(1 / 60);
  assert(Math.abs(s.x - 100) < 0.5, `ended at ${s.x}`);
  assert(max < 101, `overshot to ${max}`);
});

run("spring overshoots when under-damped", () => {
  let max = 0;
  const s = LW.spring(0, { response: 0.4, damping: 0.6 }, (v) => { max = Math.max(max, v); });
  s.to(100);
  for (let i = 0; i < 120; i++) s.step(1 / 60);
  assert(max > 100, `max ${max}`);
});

run("island escapes untrusted text", () => {
  const host = fakeElement("div");
  const isl = LW.island.create(host, null, {});
  isl.update({ title: "<i>x</i>", chord: "<b>C</b>" });
  assert.strictEqual(isl.refs.title.textContent, "<i>x</i>");
  assert.strictEqual(isl.refs.chord.textContent, "<b>C</b>");
  isl.alert({ title: "<img src=x>", sub: "s" }, 10);
  assert.strictEqual(isl.refs.a1.textContent, "<img src=x>");
});

function fakeTabBar() {
  const bar = fakeElement("div");
  const tabs = [0, 1, 2].map((i) => {
    const t = fakeElement("button");
    t.dataset.k = "k" + i; t.offsetLeft = i * 100; t.offsetWidth = 100;
    t.closest = (s) => (s === ".tab" ? t : null);
    return t;
  });
  tabs[0].classList.add("on");
  const cap = { on: false, calls: 0 };
  Object.assign(bar, {
    querySelectorAll: () => tabs, contains: () => true, offsetWidth: 300, scrollWidth: 300,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 300, height: 40 }),
    setPointerCapture() { cap.on = true; cap.calls++; }, hasPointerCapture: () => cap.on, releasePointerCapture() { cap.on = false; },
  });
  const fire = (t, e) => (bar._listeners[t] || []).forEach((f) => f(e));
  return { bar, tabs, cap, fire };
}

run("tabs: a plain click selects and never captures the pointer (capture would retarget the click to the bar)", () => {
  const { bar, tabs, cap, fire } = fakeTabBar();
  const picked = [];
  LW.ui.tabs(bar, (i) => picked.push(i));
  fire("pointerdown", { target: tabs[2], pointerId: 1, clientX: 250 });
  fire("pointerup", { target: tabs[2], pointerId: 1, clientX: 250 });
  assert.strictEqual(cap.calls, 0, "pointer captured on a plain press");
  fire("click", { target: tabs[2] });
  assert.deepStrictEqual(picked, [2]);
});

run("tabs: dragging the selected droplet past the threshold captures the pointer once and swallows the click", () => {
  const { bar, tabs, cap, fire } = fakeTabBar();
  const picked = [];
  LW.ui.tabs(bar, (i) => picked.push(i));
  fire("pointerdown", { target: tabs[0], pointerId: 1, clientX: 50 });
  fire("pointermove", { target: tabs[0], pointerId: 1, clientX: 54 });
  assert.strictEqual(cap.calls, 0, "captured before the 8 px threshold");
  fire("pointermove", { target: tabs[0], pointerId: 1, clientX: 160 });
  fire("pointermove", { target: tabs[0], pointerId: 1, clientX: 170 });
  assert.strictEqual(cap.calls, 1, "should capture exactly once when the drag starts");
  fire("pointerup", { target: bar, pointerId: 1, clientX: 170 });
  const afterDrag = picked.length;
  fire("click", { target: tabs[1] });
  assert.strictEqual(picked.length, afterDrag, "the click that ends a drag must not select again");
  assert.strictEqual(cap.on, false, "capture released on pointerup");
});
