/* Master 4-band EQ: spline canvas with draggable bands (drag = freq/gain, wheel = Q), FFT spectrum
   behind the curve, Flat reset. Canvas colours come from theme tokens via LW.token, never var(--x). */
(function (root) {
  const LW = root.LW;
  const $ = (id) => document.getElementById(id);
  const S = () => LW.state;

  const bands = [
    { id: 1, type: "lowshelf", freq: 100.0, gain: 0.0, q: 0.707 },
    { id: 2, type: "peaking", freq: 500.0, gain: 0.0, q: 1.0 },
    { id: 3, type: "peaking", freq: 2500.0, gain: 0.0, q: 1.0 },
    { id: 4, type: "highshelf", freq: 8000.0, gain: 0.0, q: 0.707 },
  ];
  let dragged = null, lastBandEdit = 0, lastSpectrum = 0;
  const MIN = Math.log10(20), MAX = Math.log10(20000), DB = 18;

  const freqToX = (f, w) => ((Math.log10(LW.clamp(f, 20, 20000)) - MIN) / (MAX - MIN)) * w;
  const xToFreq = (x, w) => Math.pow(10, MIN + LW.clamp(x / w, 0, 1) * (MAX - MIN));
  const gainToY = (g, h) => h / 2 - (g / DB) * (h / 2) * 0.85;
  const yToGain = (y, h) => LW.clamp(((h / 2 - y) / ((h / 2) * 0.85)) * DB, -DB, DB);

  function responseAt(f) {
    let total = 0;
    for (const b of bands) {
      if (Math.abs(b.gain) < 0.05) continue;
      const lr = Math.abs(Math.log2(f / b.freq));
      if (b.type === "peaking") total += b.gain * Math.exp(-Math.pow(lr / ((1 / b.q) * 0.7), 2));
      else if (b.type === "lowshelf") total += f <= b.freq ? b.gain : b.gain * Math.exp(-Math.pow(lr / 0.5, 2));
      else if (b.type === "highshelf") total += f >= b.freq ? b.gain : b.gain * Math.exp(-Math.pow(lr / 0.5, 2));
    }
    return total;
  }

  function drawEqSpline() {
    const canvas = $("eqCanvas");
    if (!canvas) return;
    const r = canvas.getBoundingClientRect();
    if (!r.width) return;
    const dpr = root.devicePixelRatio || 1;
    if (canvas.width !== Math.round(r.width * dpr) || canvas.height !== Math.round(r.height * dpr)) {
      canvas.width = Math.round(r.width * dpr); canvas.height = Math.round(r.height * dpr);
    }
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const w = r.width, h = r.height;
    const bg = LW.token("--canvas-bg", "#0F0F11");
    const grid = LW.token("--sep", "rgba(255,255,255,.08)");
    const ink3 = LW.token("--ink3", "#888");
    const accent = LW.token("--accent", "#0A84FF");
    const tint = LW.token("--tint", "rgba(10,132,255,.16)");
    const ink = LW.token("--ink", "#fff");
    const knob = LW.token("--sheet", "#1C1C1E");
    ctx.fillStyle = LW.theme.current() === "dark" ? "#141416" : bg;
    ctx.fillRect(0, 0, w, h);

    const spec = S().spectrum || [];
    if (S().analyzerEnabled && spec.length > 1) {
      ctx.beginPath();
      for (let i = 0; i < spec.length; i++) {
        const px = (i / (spec.length - 1)) * w;
        const py = h - ((LW.clamp(spec[i], -90, 0) + 90) / 90) * (h - 6);
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.closePath();
      ctx.fillStyle = tint;
      ctx.fill();
    }

    ctx.lineWidth = 1;
    ctx.strokeStyle = grid;
    [50, 100, 200, 500, 1000, 2000, 5000, 10000].forEach((f) => {
      const gx = Math.round(freqToX(f, w)) + 0.5;
      ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, h); ctx.stroke();
    });
    const y0 = Math.round(gainToY(0, h)) + 0.5;
    ctx.beginPath(); ctx.moveTo(0, y0); ctx.lineTo(w, y0); ctx.stroke();

    ctx.beginPath();
    for (let px = 0; px <= w; px += 2) {
      const py = gainToY(responseAt(xToFreq(px, w)), h);
      if (px === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.strokeStyle = accent;
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.font = "600 10px Inter, system-ui, sans-serif";
    bands.forEach((b, i) => {
      const bx = freqToX(b.freq, w), by = gainToY(b.gain, h);
      ctx.beginPath();
      ctx.arc(bx, by, dragged === i ? 8 : 6.5, 0, Math.PI * 2);
      ctx.fillStyle = dragged === i ? accent : knob;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = dragged === i ? ink : accent;
      ctx.stroke();
      ctx.fillStyle = ink3;
      ctx.fillText(String(b.id), bx - 3, by - 11);
    });
  }

  function renderEqInspectors() {
    const box = $("eqBands");
    if (!box) return;
    if (!box.children.length) bands.forEach(() => box.append(LW.h("div", { class: "eq-band" }, LW.h("span", { class: "faint" }), LW.h("b"), LW.h("span", { class: "faint" }))));
    bands.forEach((b, i) => {
      const el = box.children[i];
      el.children[0].textContent = ["Low", "Low-mid", "High-mid", "High"][i];
      el.children[1].textContent = `${b.gain >= 0 ? "+" : ""}${b.gain.toFixed(1)} dB`;
      el.children[2].textContent = `${b.freq >= 1000 ? (b.freq / 1000).toFixed(1) + "k" : Math.round(b.freq)} · Q ${b.q.toFixed(2)}`;
    });
  }

  function visible() { const c = $("eqCanvas"); return c && c.offsetParent !== null && c.closest(".ip.on"); }

  function bind() {
    const canvas = $("eqCanvas");
    const pick = (e) => {
      const r = canvas.getBoundingClientRect();
      const mx = e.clientX - r.left, my = e.clientY - r.top;
      let best = null, bd = 26;
      bands.forEach((b, i) => { const d = Math.hypot(freqToX(b.freq, r.width) - mx, gainToY(b.gain, r.height) - my); if (d < bd) { bd = d; best = i; } });
      return { best, mx, my, r };
    };
    canvas.addEventListener("pointerdown", (e) => {
      const p = pick(e);
      if (p.best === null) return;
      canvas.setPointerCapture(e.pointerId);
      dragged = p.best;
      drawEqSpline();
    });
    canvas.addEventListener("pointermove", (e) => {
      if (dragged === null) return;
      const r = canvas.getBoundingClientRect();
      const b = bands[dragged];
      b.freq = Math.round(xToFreq(e.clientX - r.left, r.width));
      b.gain = parseFloat(yToGain(e.clientY - r.top, r.height).toFixed(1));
      lastBandEdit = performance.now();
      drawEqSpline(); renderEqInspectors();
    });
    const up = () => {
      if (dragged === null) return;
      const b = bands[dragged];
      dragged = null;
      lastBandEdit = performance.now();
      drawEqSpline();
      LW.api.post("/api/mixer", { equalizer_band: { index: b.id - 1, freq: b.freq, gain: b.gain, q: b.q } }).catch(() => {});
    };
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("pointercancel", up);
    canvas.addEventListener("wheel", (e) => {
      const p = pick(e);
      if (p.best === null) return;
      e.preventDefault();
      const b = bands[p.best];
      b.q = LW.clamp(b.q + (e.deltaY < 0 ? 0.15 : -0.15), 0.2, 8);
      lastBandEdit = performance.now();
      drawEqSpline(); renderEqInspectors();
      LW.api.post("/api/mixer", { equalizer_band: { index: b.id - 1, q: b.q } }).catch(() => {});
    }, { passive: false });
  }

  function setAnalyzerButton() {
    const b = $("btnSpectrum");
    if (b) b.setAttribute("aria-pressed", S().analyzerEnabled ? "true" : "false");
  }

  LW.eq = {
    bands, responseAt, draw: drawEqSpline,
    async flat() {
      bands.forEach((b) => { b.gain = 0; });
      lastBandEdit = performance.now();
      drawEqSpline(); renderEqInspectors();
      LW.alert({ icon: "flat", title: "EQ flat", sub: "All four bands at 0 dB" }, 1100);
      await LW.api.post("/api/mixer", { equalizer_reset: true }).catch(() => {});
    },
    async toggleSpectrum() {
      S().analyzerEnabled = !S().analyzerEnabled;
      setAnalyzerButton();
      drawEqSpline();
      await LW.api.post("/api/master/dsp", { analyzer_enabled: S().analyzerEnabled, analyzer_visible: S().analyzerEnabled && !!visible() }).catch(() => {});
    },
    setVisible(v) { LW.api.post("/api/master/dsp", { analyzer_visible: !!v && S().analyzerEnabled }).catch(() => {}); if (v) setTimeout(drawEqSpline, 60); },
  };

  LW.on("ready", () => {
    bind();
    $("btnEqFlat").addEventListener("click", () => LW.eq.flat());
    $("btnSpectrum").addEventListener("click", () => LW.eq.toggleSpectrum());
    renderEqInspectors();
    setTimeout(drawEqSpline, 100);
    LW.on("theme", () => setTimeout(drawEqSpline, 30));
    LW.on("layout", () => setTimeout(drawEqSpline, 30));
    root.addEventListener("resize", () => setTimeout(drawEqSpline, 120));
  });

  LW.on("telemetry", (d) => {
    if (d.engine && d.engine.analyzer_enabled !== undefined) setAnalyzerButton();
    const eqT = d.audio && d.audio.equalizer;
    if (eqT && Array.isArray(eqT.bands) && dragged === null && performance.now() - lastBandEdit > 1500) {
      let changed = false;
      eqT.bands.forEach((tb, i) => {
        const b = bands[i];
        if (!b) return;
        for (const k of ["freq", "gain", "q"]) if (tb[k] !== undefined && Math.abs(tb[k] - b[k]) > 0.01) { b[k] = tb[k]; changed = true; }
      });
      if (changed) { renderEqInspectors(); if (visible()) drawEqSpline(); }
    }
    if (Array.isArray(d.spectrum) && S().analyzerEnabled && visible()) {
      const now = performance.now();
      if (now - lastSpectrum > 90) { lastSpectrum = now; root.requestAnimationFrame(drawEqSpline); }
    }
  });
})(window);
