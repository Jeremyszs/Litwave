const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const REPO_ROOT = path.resolve(__dirname, "..");
const STATIC_DIR = path.join(REPO_ROOT, "src", "static");

// 1. Script Syntax Checks via Node vm
function testScriptSyntax() {
  const files = [
    "chord_timeline.js",
    "browser_api.js",
    "ws_telemetry.js",
    "sw.js"
  ];

  files.forEach(file => {
    const filePath = path.join(STATIC_DIR, file);
    assert(fs.existsSync(filePath), `Missing static file: ${file}`);
    const code = fs.readFileSync(filePath, "utf8");
    assert.doesNotThrow(() => {
      new vm.Script(code, { filename: file });
    }, `Syntax error in ${file}`);
  });

  // Check inline scripts in index.html and remote.html
  ["index.html", "remote.html"].forEach(htmlFile => {
    const htmlPath = path.join(STATIC_DIR, htmlFile);
    const html = fs.readFileSync(htmlPath, "utf8");
    const scriptRegex = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
    let match;
    let idx = 0;
    while ((match = scriptRegex.exec(html)) !== null) {
      idx++;
      const code = match[1].trim();
      if (!code) continue; // External script tag
      assert.doesNotThrow(() => {
        new vm.Script(code, { filename: `${htmlFile}:script_${idx}` });
      }, `Syntax error in ${htmlFile} inline script ${idx}`);
    }
  });

  console.log("PASS: script syntax checks (files & inline scripts)");
}

// 2. Exported Helper Behavior (CommonJS require)
function testChordTimelineHelpers() {
  const timeline = require("../src/static/chord_timeline.js");
  
  // Existing interval checks
  const chart = [
    { time: 0, end: 2, chord: "C" },
    { time: 2, end: 3, chord: "N" },
    { time: 3, duration: 1, chord: "X" },
    { time: 4, end: 4.5, chord: "G" },
    { time: 4.5, end: 5, chord: "Am" },
  ];
  assert.strictEqual(timeline.chordAtTime(chart, -1), null);
  assert.strictEqual(timeline.chordAtTime(chart, 1.9).chord, "C");
  assert.strictEqual(timeline.playableChord(timeline.chordAtTime(chart, 2.5)), null);
  assert.strictEqual(timeline.nextPlayableChord(chart, 2.5).chord, "G");
  assert.strictEqual(timeline.nextPlayableChord(chart, 5), null);

  // Music theory additions
  assert(Array.isArray(timeline.CHORD_LIBRARY));
  assert(timeline.CHORD_LIBRARY.length >= 24, "CHORD_LIBRARY must contain chord formulas");

  // Advanced chord detection (requires >= 3 detected MIDI key notes)
  assert.strictEqual(timeline.detectAdvancedChord([]), "--");
  assert.strictEqual(timeline.detectAdvancedChord(null), "--");
  assert.strictEqual(timeline.detectAdvancedChord([60]), "--"); // single note returns non-chord sentinel
  assert.strictEqual(timeline.detectAdvancedChord([60, 67]), "--"); // 2-note power chord interval returns non-chord sentinel
  assert.strictEqual(timeline.detectAdvancedChord([60, 64]), "--"); // 2 notes returns non-chord sentinel
  assert.strictEqual(timeline.detectAdvancedChord([60, 60]), "--"); // duplicate pitches under 3 notes
  assert.strictEqual(timeline.detectAdvancedChord([60, 64, 67]), "C"); // C major triad
  assert.strictEqual(timeline.detectAdvancedChord([60, 63, 67]), "Cm"); // C minor triad
  assert.strictEqual(timeline.detectAdvancedChord([62, 65, 69]), "Dm"); // D minor triad
  assert.strictEqual(timeline.detectAdvancedChord([55, 60, 64, 67]), "C/G"); // C major slash G

  // Nashville number mapping
  const cInC = timeline.getChordWithNashville("C", "C");
  assert.strictEqual(cInC.chord, "C");
  assert.strictEqual(cInC.nashville, "[1]");

  const gInC = timeline.getChordWithNashville("G", "C");
  assert.strictEqual(gInC.chord, "G");
  assert.strictEqual(gInC.nashville, "[5]");

  const dmInC = timeline.getChordWithNashville("Dm", "C");
  assert.strictEqual(dmInC.chord, "Dm");
  assert.strictEqual(dmInC.nashville, "[2-]");

  const invalid = timeline.getChordWithNashville("--", "C");
  assert.strictEqual(invalid.chord, "--");

  console.log("PASS: chord_timeline.js helpers and music theory");
}

function testBrowserApiHelpers() {
  const api = require("../src/static/browser_api.js");

  // Palette
  assert(Array.isArray(api.FX_PAD_PALETTE));
  assert.strictEqual(api.FX_PAD_PALETTE.length, 8);
  api.FX_PAD_PALETTE.forEach(p => {
    assert(p.bg && p.border && p.glow);
  });

  // Time format
  assert.strictEqual(api.formatTime(0), "00:00");
  assert.strictEqual(api.formatTime(65), "01:05");
  assert.strictEqual(api.formatTime(3665), "61:05");
  assert.strictEqual(api.formatTime(-5), "00:00");
  assert.strictEqual(api.formatTime(null), "00:00");
  assert.strictEqual(api.formatTime(65.43, { showMs: true }), "01:05.43");
  assert.strictEqual(api.formatTimeWithMs(65.43), "01:05.43");
  assert.strictEqual(api.formatTimeWithMs(0), "00:00.00");

  // CSS Token Resolution
  assert.strictEqual(api.resolveCssToken("var(--accent, #e2e8f0)"), "#e2e8f0");
  assert.strictEqual(api.resolveCssToken("var(--accent)", "#e2e8f0"), "#e2e8f0");
  assert.strictEqual(api.resolveCssToken("#123456"), "#123456");
  assert.strictEqual(api.resolveCssToken(null, "fallback"), "fallback");

  // animateFxPadPulse mock
  const mockPad = { style: { background: "", boxShadow: "" } };
  api.animateFxPadPulse(mockPad, 0, api.FX_PAD_PALETTE, 10);
  assert.strictEqual(mockPad.style.background, api.FX_PAD_PALETTE[0].border);
  assert(mockPad.style.boxShadow.includes(api.FX_PAD_PALETTE[0].glow));

  // createToastHelper mock
  const mockRoot = {};
  const mockElem = { innerText: "", style: { opacity: "0" } };
  const origDoc = global.document;
  const origWin = global.window;
  try {
    global.document = { getElementById: () => mockElem };
    global.window = mockRoot;
    const showToast = api.createToastHelper("notice", "_testTimer");
    showToast("Hello DAW", 100);
    assert.strictEqual(mockElem.innerText, "Hello DAW");
    assert.strictEqual(mockElem.style.opacity, "1");
    assert(mockRoot._testTimer !== undefined);
    clearTimeout(mockRoot._testTimer);
  } finally {
    global.document = origDoc;
    global.window = origWin;
  }

  console.log("PASS: browser_api.js helpers (palette, time, css token, pulse, toast)");
}

async function testBrowserApiNetwork() {
  const api = require("../src/static/browser_api.js");

  // Mock global fetch
  const originalFetch = global.fetch;
  try {
    // 1. Successful GET
    global.fetch = async (url, opts) => {
      assert.strictEqual(url, "/api/test");
      assert.strictEqual(opts.method, "GET");
      return {
        ok: true,
        status: 200,
        headers: { get: () => "application/json" },
        json: async () => ({ status: "ok" })
      };
    };
    const resGet = await api.getJson("/api/test");
    assert.deepStrictEqual(resGet, { status: "ok" });

    // 2. Successful POST with JSON serialization
    global.fetch = async (url, opts) => {
      assert.strictEqual(url, "/api/post");
      assert.strictEqual(opts.method, "POST");
      assert.strictEqual(opts.headers["Content-Type"], "application/json");
      assert.strictEqual(opts.body, JSON.stringify({ action: "play" }));
      return {
        ok: true,
        status: 200,
        headers: { get: () => "application/json" },
        json: async () => ({ executed: true })
      };
    };
    const resPost = await api.postJson("/api/post", { action: "play" });
    assert.deepStrictEqual(resPost, { executed: true });

    // 3. HTTP Error handling
    global.fetch = async (url, opts) => {
      return {
        ok: false,
        status: 400,
        statusText: "Bad Request",
        headers: { get: () => "application/json" },
        json: async () => ({ error: "Invalid parameter" })
      };
    };
    let threw = false;
    try {
      await api.getJson("/api/fail");
    } catch (err) {
      threw = true;
      assert.strictEqual(err.status, 400);
      assert.strictEqual(err.message, "Invalid parameter");
      assert.deepStrictEqual(err.data, { error: "Invalid parameter" });
    }
    assert(threw, "getJson must throw on HTTP error");
  } finally {
    global.fetch = originalFetch;
  }

  console.log("PASS: browser_api.js requestJson / getJson / postJson error handling");
}

function testWsTelemetryHelpers() {
  const ws = require("../src/static/ws_telemetry.js");

  // getWsUrl fallback
  const url = ws.getWsUrl("/custom-ws");
  assert.strictEqual(url, "ws://localhost/custom-ws");

  // calculateBackoff monotonic / bounded
  let lastDelay = 0;
  for (let i = 0; i < 6; i++) {
    const delay = ws.calculateBackoff(i, 1000, 8000, 1.5);
    assert(delay >= 1000, "delay must be at least base delay");
    assert(delay <= 8000 * 1.2, "delay must be bounded by maxMs plus jitter");
  }

  // createWsClient lifecycle with mock WebSocket
  class MockWebSocket {
    constructor(targetUrl) {
      this.url = targetUrl;
      this.readyState = 1;
      this.listeners = {};
      setTimeout(() => {
        if (this.onopen) this.onopen({ type: "open" });
      }, 5);
    }
    close() {
      this.readyState = 3;
      if (this.onclose) this.onclose({ type: "close" });
    }
  }

  const origWin = global.window;
  try {
    global.window = {
      location: { protocol: "http:", host: "127.0.0.1:8000" },
      WebSocket: MockWebSocket
    };

    let opened = false;
    let telemetryMsg = null;
    let customMsg = null;

    const client = ws.createWsClient({
      path: "/ws",
      onOpen: () => { opened = true; },
      handlers: {
        telemetry: (msg) => { telemetryMsg = msg; }
      },
      onMessage: (msg) => { customMsg = msg; }
    });

    const sock = client.getSocket();
    assert(sock instanceof MockWebSocket);
    assert.strictEqual(sock.url, "ws://127.0.0.1:8000/ws");

    // Route registered handler
    sock.onmessage({ data: JSON.stringify({ type: "telemetry", song: { bpm: 128 } }) });
    assert.deepStrictEqual(telemetryMsg, { type: "telemetry", song: { bpm: 128 } });

    // Route fallback handler
    sock.onmessage({ data: JSON.stringify({ type: "unknown", foo: "bar" }) });
    assert.deepStrictEqual(customMsg, { type: "unknown", foo: "bar" });

    // Disconnect
    assert(client.isConnected());
    client.close();
    assert(!client.isConnected());
  } finally {
    global.window = origWin;
  }

  console.log("PASS: ws_telemetry.js backoff, client lifecycle, and message routing");
}

// 3. UMD / Browser Global Emulation
function testBrowserGlobalsEmulation() {
  const chordCode = fs.readFileSync(path.join(STATIC_DIR, "chord_timeline.js"), "utf8");
  const browserCode = fs.readFileSync(path.join(STATIC_DIR, "browser_api.js"), "utf8");
  const wsCode = fs.readFileSync(path.join(STATIC_DIR, "ws_telemetry.js"), "utf8");

  const ctx = {
    console: console,
    setTimeout: setTimeout,
    clearTimeout: clearTimeout,
    location: { protocol: "https:", host: "studio.litwave.local" },
    document: { documentElement: {} }
  };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  vm.createContext(ctx);

  vm.runInContext(chordCode, ctx);
  vm.runInContext(browserCode, ctx);
  vm.runInContext(wsCode, ctx);

  // Namespaces exist
  assert(ctx.ChordTimeline, "ChordTimeline namespace missing");
  assert(ctx.BrowserApi, "BrowserApi namespace missing");
  assert(ctx.WsTelemetry, "WsTelemetry namespace missing");

  // Backward-compatible flat globals exist
  assert(typeof ctx.chordAtTime === "function" || typeof ctx.ChordTimeline.chordAtTime === "function");
  assert(typeof ctx.detectAdvancedChord === "function");
  assert(typeof ctx.getChordWithNashville === "function");
  assert(Array.isArray(ctx.CHORD_LIBRARY));
  assert(Array.isArray(ctx.FX_PAD_PALETTE));
  assert(typeof ctx.formatTime === "function");
  assert(typeof ctx.requestJson === "function");
  assert(typeof ctx.createWsClient === "function");
  assert.strictEqual(ctx.getWsUrl("/ws"), "wss://studio.litwave.local/ws");

  console.log("PASS: UMD factory exports both namespaces and compatible globals");
}

// 4. Source Integration Checks
function testSourceIntegration() {
  const indexHtml = fs.readFileSync(path.join(STATIC_DIR, "index.html"), "utf8");
  const remoteHtml = fs.readFileSync(path.join(STATIC_DIR, "remote.html"), "utf8");
  const swJs = fs.readFileSync(path.join(STATIC_DIR, "sw.js"), "utf8");

  // Script tags in index.html
  assert(indexHtml.includes('<script src="/static/chord_timeline.js"></script>'), "index.html missing chord_timeline.js");
  assert(indexHtml.includes('<script src="/static/browser_api.js"></script>'), "index.html missing browser_api.js");
  assert(indexHtml.includes('<script src="/static/ws_telemetry.js"></script>'), "index.html missing ws_telemetry.js");

  const idxChord = indexHtml.indexOf('<script src="/static/chord_timeline.js"></script>');
  const idxBrowser = indexHtml.indexOf('<script src="/static/browser_api.js"></script>');
  const idxWs = indexHtml.indexOf('<script src="/static/ws_telemetry.js"></script>');
  const idxInline = indexHtml.indexOf("<script>", idxWs);

  assert(idxChord < idxBrowser, "chord_timeline must load before browser_api in index.html");
  assert(idxBrowser < idxWs, "browser_api must load before ws_telemetry in index.html");
  assert(idxWs < idxInline, "modules must load before inline script in index.html");

  // Script tags in remote.html
  assert(remoteHtml.includes('<script src="/static/chord_timeline.js"></script>'), "remote.html missing chord_timeline.js");
  assert(remoteHtml.includes('<script src="/static/browser_api.js"></script>'), "remote.html missing browser_api.js");
  assert(remoteHtml.includes('<script src="/static/ws_telemetry.js"></script>'), "remote.html missing ws_telemetry.js");

  const rChord = remoteHtml.indexOf('<script src="/static/chord_timeline.js"></script>');
  const rBrowser = remoteHtml.indexOf('<script src="/static/browser_api.js"></script>');
  const rWs = remoteHtml.indexOf('<script src="/static/ws_telemetry.js"></script>');
  const rInline = remoteHtml.indexOf("<script>", rWs);

  assert(rChord < rBrowser, "chord_timeline must load before browser_api in remote.html");
  assert(rBrowser < rWs, "browser_api must load before ws_telemetry in remote.html");
  assert(rWs < rInline, "modules must load before inline script in remote.html");

  // Service Worker caching
  assert(swJs.includes('"/static/chord_timeline.js"'), "sw.js must cache chord_timeline.js");
  assert(swJs.includes('"/static/browser_api.js"'), "sw.js must cache browser_api.js");
  assert(swJs.includes('"/static/ws_telemetry.js"'), "sw.js must cache ws_telemetry.js");

  console.log("PASS: source integration (script loading order and SW caching)");
}

async function runAll() {
  console.log("Starting Frontend Extraction Regression Tests...\n");
  testScriptSyntax();
  testChordTimelineHelpers();
  testBrowserApiHelpers();
  await testBrowserApiNetwork();
  testWsTelemetryHelpers();
  testBrowserGlobalsEmulation();
  testSourceIntegration();
  console.log("\n============================================================");
  console.log("ALL FRONTEND EXTRACTION CHECKS PASSED");
}

runAll().catch(err => {
  console.error("FAIL:", err);
  process.exit(1);
});
