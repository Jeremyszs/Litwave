/* Phone remote bootstrap: island, liquid tab bar + sliding pages (tap or swipe), play button,
   live connection with stale-feed watchdog and wake-up reconnect, offline service worker. */
(function (root) {
  const LW = root.LW;
  const R = LW.R;
  const $ = (id) => document.getElementById(id);
  const S = R.state;
  const PAGES = ["stage", "pads", "mix", "parts", "song"];
  const TITLES = { stage: "Stage", pads: "Pads", mix: "Mix", parts: "Parts", song: "Song" };
  let page = 0, tabs = null, px = null, client = null;

  function width() { return $("pagesWrap").offsetWidth || root.innerWidth; }
  function goTo(i, velocity) {
    page = LW.clamp(i, 0, PAGES.length - 1);
    px.to(-page * width(), velocity != null ? { velocity, response: 0.42, damping: 0.86 } : { response: 0.42, damping: 0.92 });
    LW.swap($("pageTitle"), TITLES[PAGES[page]]);
    LW.$$(".page").forEach((p, j) => p.setAttribute("aria-hidden", j === page ? "false" : "true"));
  }

  /* Horizontal swipe between pages; vertical scrolling and slider drags are left alone. */
  function swipe() {
    const wrap = $("pagesWrap");
    let sx = 0, sy = 0, base = 0, mode = null, hist = [];
    wrap.addEventListener("pointerdown", (e) => {
      if (e.pointerType === "mouse") return;
      if (e.target.closest(".sl, .pad, .scrub, .tabbar, .seg, select, input, .roots")) return;
      sx = e.clientX; sy = e.clientY; base = px.x; mode = null; hist = [[e.clientX, performance.now()]];
    });
    wrap.addEventListener("pointermove", (e) => {
      if (!hist.length) return;
      const dx = e.clientX - sx, dy = e.clientY - sy;
      if (!mode) {
        if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
        mode = Math.abs(dx) > Math.abs(dy) * 1.2 ? "x" : "y";
        if (mode === "x") try { wrap.setPointerCapture(e.pointerId); } catch (_) {}
      }
      if (mode !== "x") return;
      hist.push([e.clientX, performance.now()]); if (hist.length > 5) hist.shift();
      const min = -(PAGES.length - 1) * width();
      let x = base + dx;
      if (x > 0) x = LW.rubber(x, width());
      if (x < min) x = min + LW.rubber(x - min, width());
      px.set(x);
    });
    const end = () => {
      if (mode === "x" && hist.length > 1) {
        const a = hist[0], b = hist[hist.length - 1];
        const v = ((b[0] - a[0]) / Math.max(1, b[1] - a[1])) * 1000;
        const proj = px.x + LW.project(v, 0.99);
        const i = LW.clamp(Math.round(-proj / width()), page - 1, page + 1);
        tabs.select(i, false);
        goTo(i, v);
      }
      hist = []; mode = null;
    };
    wrap.addEventListener("pointerup", end);
    wrap.addEventListener("pointercancel", end);
  }

  function connection(on) {
    S.connected = on;
    $("connDot").className = "dot" + (on ? " ok" : " bad");
    LW.setText($("connTxt"), on ? "Live" : "Offline");
    $("conn").classList.toggle("ok", on);
  }

  function boot() {
    LW.hydrateIcons(document);
    $("btnMore").innerHTML = LW.icon("more");
    $("btnPlay").innerHTML = `<span class="pp">${LW.icon("play")}${LW.icon("pause")}</span>`;
    LW.$$("[data-close]").forEach((b) => { if (b.classList.contains("ib")) b.innerHTML = LW.icon("close"); });
    $("bubble").innerHTML = LW.icon("wave");

    R.isl = LW.island.create($("island"), $("bubble"), {
      hover: false,
      sizes: { compact: { w: 196, h: 36 }, expanded: { w: Math.min(360, root.innerWidth - 24), h: 150, r: 40 }, alert: { w: Math.min(340, root.innerWidth - 32), h: 54 } },
      onAction: (a) => {
        if (a === "play") R.transport(R.playAction());
        const list = [...((S.song || {}).markers || [])].sort((x, y) => x.time - y.time);
        const t = (S.song || {}).current_time_seconds || 0;
        if (a === "prev") { const p = list.filter((m) => m.time < t - 1.5).pop(); R.transport("seek", { seconds: p ? p.time : 0 }); }
        if (a === "next") { const n = list.find((m) => m.time > t + 0.25); if (n) R.transport("seek", { seconds: n.time }); }
      },
      onSeek: (f) => { const d = (S.song || {}).duration_seconds || 0; if (d) R.transport("seek", { seconds: f * d }); },
      onBubble: () => { tabs.select(0); },
    });
    LW.on("alert", (a, ms) => R.isl.alert(a, ms));

    px = LW.spring(0, { response: 0.42, damping: 0.92, eps: 0.3 }, (v) => { $("pages").style.transform = `translateX(${v}px)`; });
    tabs = LW.ui.tabs($("tabs"), (i) => goTo(i));
    goTo(0);
    swipe();
    root.addEventListener("resize", () => px.set(-page * width()));

    $("btnPlay").addEventListener("click", () => {
      const act = R.playAction();
      LW.local.mark("play");
      R.transport(act);
      R.isl.alert({ icon: act === "play" ? "play" : "pause", title: act === "play" ? "Playing" : "Paused", sub: (S.song || {}).filename || "" }, 900);
    });

    LW.emit("r-ready");
    LW.ui.press(document);

    // Live connection: reconnect with backoff, and force a reconnect if the feed goes quiet for 5 s
    // while the socket still claims to be open, or when the phone wakes up.
    client = root.WsTelemetry.createWsClient({
      path: "/ws",
      minReconnectDelayMs: 2000,
      maxReconnectDelayMs: 15000,
      onMessage: (msg) => R.ingest(msg),
      handlers: { telemetry: (m) => R.ingest(m), midi_event: (m) => R.ingest(m), fx_pad_pulse: (m) => R.ingest(m) },
      onOpen: () => { const was = S.wasConnected; connection(true); if (was) LW.alert({ icon: "check", tone: "ok", title: "Reconnected" }, 1200); else LW.alert({ icon: "phone", tone: "ok", title: "Connected to Litwave", sub: root.location.host }, 1600); S.wasConnected = true; },
      onClose: () => { if (S.connected) LW.alert({ icon: "alert", tone: "bad", title: "Connection lost", sub: "Reconnecting…" }, 2000); connection(false); },
    });
    root.setInterval(() => {
      const sock = client.getSocket();
      if (sock && sock.readyState === 1 && Date.now() - S.lastMessageAt > 5000) { try { sock.close(); } catch (_) {} }
    }, 1000);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && !client.isConnected()) client.connect();
    });

    if ("serviceWorker" in root.navigator) {
      root.navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {});
    }

    // Island content follows the song.
    LW.on("r-telemetry", (msg) => {
      const s = S.song || {};
      const c = R.current();
      const d = s.duration_seconds || 0, t = s.current_time_seconds || 0;
      const a = s.analysis || {};
      R.isl.update({
        title: s.has_track ? (s.filename || "Backing track") : "No track loaded",
        sub: [a.key ? `Key ${a.key}` : "", a.bpm ? `${Math.round(a.bpm)} BPM` : ""].filter(Boolean).join(" · ") || (s.has_track ? "Ready" : "Litwave remote"),
        chord: c.chord === "--" ? (s.has_track ? LW.fmt(t) : "Litwave") : c.chord,
        next: c.next || "--", pos: s.has_track ? LW.fmt(t) : "", t0: LW.fmt(t), t1: LW.fmt(d),
        progress: d > 0 ? t / d : 0,
        ring: c.nextAt != null && c.start != null && c.nextAt > c.start ? LW.clamp((t - c.start) / (c.nextAt - c.start), 0, 1) : (d > 0 ? t / d : 0),
        playing: Boolean(s.is_playing),
      });
      $("btnPlay").classList.toggle("on", Boolean(s.is_playing));
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})(window);
