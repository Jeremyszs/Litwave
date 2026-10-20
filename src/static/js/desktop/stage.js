/* Stage mode: full-screen performance view. Giant current chord, next chord with countdown, current lyric,
   a runway of upcoming chords, and a floating glass dock (transport, Play/Mix/Pads/Drone/Setlist, panic).
   Falls back to the live keyboard chord when the song has no chord analysis. */
(function (root) {
  const LW = root.LW;
  const $ = (id) => document.getElementById(id);
  const S = () => LW.state;
  const PPS = 56; // runway pixels per second
  let active = false, sheet = null, tabs = null, runwayKey = "", cards = [], openTab = "play";
  let enterSpring = null, frameOff = null;
  const unsub = [];

  function runwayItems(chart, duration, pps) {
    const out = [];
    const TL = root.ChordTimeline;
    (chart || []).forEach((c, i) => {
      if (!TL.playableChord(c)) return;
      const end = Number.isFinite(c.end) ? c.end : Number.isFinite(c.duration) ? c.time + c.duration : (chart[i + 1] ? chart[i + 1].time : duration);
      out.push({ chord: c.chord, nashville: c.nashville && c.nashville !== "-" ? c.nashville : "", time: c.time, end, x: c.time * pps, w: Math.max(0, (end - c.time) * pps) });
    });
    return out;
  }

  function sectionAt(t) {
    const list = [...(S().markers || [])].sort((a, b) => a.time - b.time);
    let cur = null;
    for (const m of list) { if (t >= m.time - 0.05) cur = m; else break; }
    return cur;
  }

  function hero() {
    const c = LW.chords.current();
    return { chord: c.chord, nashville: c.nashville, next: c.next, nextAt: c.nextAt, start: c.start, runway: Boolean(c.fromChart) };
  }

  function buildRunway() {
    const chart = S().chart || [];
    const key = chart.length + ":" + S().duration + ":" + (chart[0] ? chart[0].time : "");
    if (key === runwayKey) return;
    runwayKey = key;
    const track = $("stgTrack");
    track.textContent = "";
    cards = runwayItems(chart, S().duration, PPS).map((it) => {
      const el = LW.h("div", { class: "rc", style: { left: it.x + "px", width: Math.max(44, it.w - 8) + "px" } }, LW.h("b", { text: it.chord }), it.nashville ? LW.h("em", { text: it.nashville }) : null);
      track.append(el);
      return Object.assign(it, { el });
    });
    (S().markers || []).forEach((m) => track.append(LW.h("div", { class: "rs", style: { left: m.time * PPS + 4 + "px" }, text: m.name })));
  }

  function renderStatic() {
    const s = S().song || {};
    const a = S().analysis || {};
    LW.setText($("stgTitle"), S().hasTrack ? (s.filename || "Backing track") : "No track loaded");
    LW.setText($("stgSub"), [a.key || a.key_full ? `Key ${a.key || a.key_full}` : "", a.bpm ? `${Math.round(a.bpm)} BPM` : "", S().hasTrack ? LW.fmt(S().duration) : ""].filter(Boolean).join(" · ") || "Live keyboard");
    $("stgPlay").classList.toggle("on", Boolean(s.is_playing));
    $("stgLoop").setAttribute("aria-pressed", s.has_track && s.loop_enabled ? "true" : "false");
  }

  let lastChord = null, lastNext = null, lastLyric = null, lastSect = null;
  function frame() {
    if (!active) return;
    const t = S().time;
    const h = hero();
    const label = h.chord === "--" ? "—" : h.chord;
    if (label + h.nashville !== lastChord) {
      lastChord = label + h.nashville;
      LW.swap($("stgChord"), label);
    }
    if (h.next !== lastNext) { lastNext = h.next; LW.swap($("stgNext"), h.next || "—"); }
    const inS = h.nextAt != null ? Math.max(0, h.nextAt - t) : null;
    LW.setText($("stgNextIn"), inS == null ? "--" : inS >= 10 ? `${Math.round(inS)}s` : `${inS.toFixed(1)}`);
    let f = 0;
    if (h.nextAt != null && h.start != null && h.nextAt > h.start) f = LW.clamp((t - h.start) / (h.nextAt - h.start), 0, 1);
    const ring = document.querySelector(".stg-next .p");
    if (ring) ring.setAttribute("stroke-dashoffset", (169.6 * (1 - f)).toFixed(1));
    const lyric = LW.lyrics ? LW.lyrics.current() : "";
    if (lyric !== lastLyric) { lastLyric = lyric; LW.swap($("stgLyric"), lyric || " "); }
    const sec = sectionAt(t);
    const sectName = sec ? sec.name : (S().hasTrack ? "Song" : "Live");
    if (sectName !== lastSect) { lastSect = sectName; LW.setText($("stgSect"), sectName); }
    LW.setText($("stgKey"), [S().nashKey ? `Key of ${S().nashKey.replace("#", "♯")}` : "", h.nashville ? `Nashville ${h.nashville}` : ""].filter(Boolean).join(" · "));

    const runway = $("stgRunway");
    runway.hidden = !h.runway;
    if (h.runway) {
      buildRunway();
      const nowX = runway.offsetWidth * 0.28;
      $("stgTrack").style.transform = `translateX(${(nowX - t * PPS).toFixed(1)}px)`;
      runway.querySelector(".rw-now").style.left = nowX + "px";
      for (const c of cards) {
        c.el.classList.toggle("now", t >= c.time && t < c.end);
        c.el.classList.toggle("past", c.end <= t);
      }
    }
  }

  /* Sheets opened from the dock reuse the same controls as Studio. */
  function buildSheet(k) {
    const body = $("stgSheetBody");
    body.textContent = "";
    const titles = { mix: "Mix", pads: "FX Pads", drone: "Drone pad", setlist: "Setlist" };
    LW.setText($("stgSheetTitle"), titles[k] || "");
    if (k === "mix") {
      const grp = LW.h("div", { class: "grp" });
      [["track", "Backing track"], ["synth", "Synth"], ["fx", "FX pads"], ["master", "Master"]].forEach(([ch, label]) => {
        const v = LW.h("span", { class: "v num" });
        const host = LW.h("div", { class: "grow" });
        const sl = LW.ui.slider(host, {
          min: 0, max: LW.mixer.max(ch), value: LW.mixer.get(ch), label,
          onInput: (val) => { S().dragging[ch] = true; LW.setText(v, LW.db(val)); LW.mixer.set(ch, val); },
          onChange: () => setTimeout(() => { S().dragging[ch] = false; }, 250),
        });
        LW.setText(v, LW.db(sl.get()));
        unsub.push(LW.on("fader", (c, val) => { if (c === ch && !sl.dragging) { sl.set(val); LW.setText(v, LW.db(val)); } }));
        grp.append(LW.h("div", { class: "gr" }, LW.h("span", { class: "k", text: label }), host, v));
      });
      const keyHost = LW.h("span");
      LW.ui.stepper(keyHost, { min: -12, max: 12, value: S().pitch || 0, label: "key shift", format: (x) => (x > 0 ? "+" : "") + x + " st", onChange: (x) => LW.song.setPitch(x) });
      grp.append(LW.h("div", { class: "gr" }, LW.h("span", { class: "k", text: "Key shift" }), LW.h("span", { class: "v" }, keyHost)));
      const scenes = LW.h("div", { class: "scenes" });
      const paintScenes = () => {
        scenes.textContent = "";
        for (let n = 1; n <= 8; n++) {
          const b = LW.h("button", { class: "scene" + (n === S().scenes.active ? " on" : ""), type: "button", text: LW.sceneName(n) });
          b.addEventListener("click", () => LW.scenes.select(n));
          scenes.append(b);
        }
      };
      paintScenes();
      unsub.push(LW.on("scenes", paintScenes));
      body.append(grp, LW.h("div", { class: "lbl", text: "Scenes" }), scenes);
    } else if (k === "pads") {
      const seg = LW.h("div", { class: "seg" });
      "ABCDEF".split("").forEach((b) => seg.append(LW.h("button", { class: "tab" + (b === S().fxPads.active_bank ? " on" : ""), type: "button", data: { k: b }, text: `${b} · ${LW.fx.BANK_NAMES[b]}` })));
      const grid = LW.h("div", { class: "fx-grid" });
      const stop = LW.h("button", { class: "btn sm danger", type: "button", text: "Stop all" });
      stop.addEventListener("click", () => LW.fx.stopAll());
      body.append(seg, grid, stop);
      const t = LW.ui.tabs(seg, (i, b) => LW.fx.selectBank(b));
      unsub.push(LW.on("fx-bank", (b) => t.select("ABCDEF".indexOf(b), false)));
      LW.fx.mount(grid);
    } else if (k === "drone") {
      const keys = LW.h("div", { class: "drone-keys" });
      const btn = LW.h("button", { class: "btn primary lgx", type: "button" });
      const paint = (d) => {
        LW.$$(".dkey", keys).forEach((b) => b.classList.toggle("on", b.dataset.k === d.root));
        btn.classList.toggle("on", !!d.active);
        LW.setText(btn, d.active ? `Stop drone pad (${LW.drone.LABEL[d.root] || d.root})` : "Start drone pad");
      };
      LW.drone.ROOTS.forEach((r) => {
        const b = LW.h("button", { class: "dkey", type: "button", data: { k: r }, text: LW.drone.LABEL[r] || r });
        b.addEventListener("click", () => LW.drone.setRoot(r));
        keys.append(b);
      });
      btn.id = "stgDroneToggle";
      btn.addEventListener("click", () => LW.drone.toggle());
      body.append(keys, btn);
      paint(S().drone);
      unsub.push(LW.drone.onChange(paint));
    } else if (k === "setlist") {
      const cur = LW.setlist.active();
      const list = LW.h("div", { class: "list" });
      const songs = (cur && cur.songs) || [];
      if (!songs.length) list.append(LW.h("div", { class: "empty", text: "This setlist is empty. Add songs in Studio." }));
      songs.forEach((song, i) => {
        const row = LW.h("button", { class: "row sl-row" + (song.filename && song.filename === (S().song || {}).filename ? " on" : ""), type: "button" },
          LW.h("span", { class: "no", text: String(i + 1) }),
          LW.h("span", { class: "grow" }, LW.h("b", { text: LW.setlist.songTitle(song) }), LW.h("em", { text: LW.setlist.songSub(song) })));
        row.addEventListener("click", () => { LW.setlist.loadSong(cur.id, song.id); tabs.select(0); });
        list.append(row);
      });
      body.append(LW.h("div", { class: "lbl", text: cur ? cur.name : "No setlist" }), list);
    }
    LW.ui.press(body);
  }

  function closeSheetContent() { while (unsub.length) { const off = unsub.pop(); if (typeof off === "function") off(); } }

  LW.stage = {
    runwayItems, hero,
    get active() { return active; },
    enter() {
      if (active) return;
      active = true;
      document.body.classList.add("staging");
      const st = $("stage");
      st.setAttribute("aria-hidden", "false");
      runwayKey = ""; lastChord = lastNext = lastLyric = lastSect = null;
      renderStatic();
      enterSpring.to(1, { response: 0.5, damping: 0.9 });
      frameOff = LW.onFrame(frame);
      LW.layout.placeIsland();
      LW.alert({ icon: "stage", title: "Stage mode", sub: "Esc to return to Studio" }, 1400);
    },
    exit() {
      if (!active) return;
      active = false;
      if (sheet && sheet.isOpen) sheet.close();
      document.body.classList.remove("staging");
      $("stage").setAttribute("aria-hidden", "true");
      enterSpring.to(0, { response: 0.35, damping: 1 });
      if (frameOff) { frameOff(); frameOff = null; }
      LW.layout.placeIsland();
    },
  };

  LW.on("ready", () => {
    const st = $("stage");
    enterSpring = LW.spring(0, { response: 0.45, damping: 0.9, eps: 0.001 }, (v) => {
      st.style.opacity = LW.clamp(v, 0, 1);
      st.style.transform = `scale(${1.03 - 0.03 * v})`;
      st.style.visibility = v < 0.01 && !active ? "hidden" : "visible";
    });
    enterSpring.set(0);
    $("stgRew").innerHTML = LW.icon("rew");
    $("stgPlay").innerHTML = `<span class="pp">${LW.icon("play")}${LW.icon("pause")}</span>`;
    $("stgLoop").innerHTML = LW.icon("loop");
    $("stgPanic").innerHTML = LW.icon("alert");
    $("stgExit").innerHTML = LW.icon("close");
    LW.hydrateIcons(st);
    $("btnStage").addEventListener("click", () => LW.stage.enter());
    $("stgExit").addEventListener("click", () => LW.stage.exit());
    $("stgRew").addEventListener("click", () => LW.transport.rewind());
    $("stgPlay").addEventListener("click", () => LW.transport.toggle());
    $("stgLoop").addEventListener("click", () => LW.transport.toggleLoop());
    $("stgPanic").addEventListener("click", () => LW.transport.panic());
    sheet = LW.sheet($("stgSheet"), { noScrim: true, onClose: () => { closeSheetContent(); if (tabs && tabs.index !== 0) tabs.select(0, false); openTab = "play"; } });
    tabs = LW.ui.tabs($("stgTabs"), (i, k) => {
      if (k === "play") { if (sheet.isOpen) sheet.close(); return; }
      closeSheetContent();
      buildSheet(k);
      openTab = k;
      const t = $("stgTabs").querySelectorAll(".tab")[i];
      sheet.open(t);
    });
  });

  LW.on("telemetry", () => { if (active) renderStatic(); });
})(window);
