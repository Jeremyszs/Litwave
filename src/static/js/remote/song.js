/* Phone · Song tab: track title and time, seek, stop, loop, analyze, bookmarks (jump + add with scene),
   key shift, lyrics with size control and live highlight. Bookmarks with a scene recall it during playback. */
(function (root) {
  const LW = root.LW;
  const R = LW.R;
  const $ = (id) => document.getElementById(id);
  const S = R.state;
  let pitch = null, marksKey = "", lyricsKey = "", activeLine = -1, dlg = null, analyzing = false;
  let lastTriggered = null, lastCheck = -1, size = 15, seekLast = 0, seekTimer = null, seekTo = 0, seekSent = -1;

  const song = () => S.song || {};
  const sorted = () => [...(song().markers || [])].sort((a, b) => a.time - b.time);

  function renderMarks() {
    const list = sorted();
    const key = JSON.stringify([list, S.scenes.names]);
    if (key === marksKey) return;
    marksKey = key;
    const box = $("marks");
    box.textContent = "";
    if (!list.length) { box.append(LW.h("div", { class: "empty", text: song().has_track ? "No bookmarks yet." : "Load a song to add bookmarks." })); return; }
    list.forEach((m) => {
      const sc = m.scene ? parseInt(m.scene, 10) : null;
      const b = LW.h("button", { class: "mark", type: "button", "data-press": "sink" },
        LW.h("b", { text: m.name }),
        sc ? LW.h("span", { class: "chip accent", text: R.sceneName(sc) }) : null,
        LW.h("em", { class: "num", text: LW.fmt(m.time) }));
      b.addEventListener("click", () => R.song.jump(m));
      box.append(b);
    });
    LW.ui.press(box);
  }

  function renderLyrics() {
    const sheet = song().lyrics_sheet || [];
    const key = JSON.stringify(sheet.map((l) => l.text));
    if (key === lyricsKey) return;
    lyricsKey = key; activeLine = -1;
    const box = $("lyrics");
    box.textContent = "";
    if (!sheet.length) { box.append(LW.h("div", { class: "empty", text: "Tap Analyze to load synced lyrics." })); return; }
    sheet.forEach((l) => box.append(LW.h("div", { class: "lyr", text: l.text == null ? "" : String(l.text) })));
  }

  function highlight(t) {
    const sheet = song().lyrics_sheet || [];
    let idx = -1;
    for (let i = 0; i < sheet.length; i++) { const nx = i + 1 < sheet.length ? sheet[i + 1].time : Infinity; if (t >= sheet[i].time && t < nx) { idx = i; break; } }
    if (idx === activeLine || idx < 0) return;
    const box = $("lyrics");
    if (box.children[activeLine]) box.children[activeLine].classList.remove("on");
    activeLine = idx;
    const el = box.children[idx];
    if (el) { el.classList.add("on"); box.scrollTo({ top: Math.max(0, el.offsetTop - box.offsetTop - 40), behavior: LW.reducedMotion() ? "auto" : "smooth" }); }
  }

  function autoScene(t) {
    const list = sorted();
    if (!list.length) return;
    if (t < lastCheck - 0.5) lastTriggered = null;
    lastCheck = t;
    let act = null;
    for (const m of list) { if (t >= m.time - 0.05) act = m; else break; }
    if (act && act.scene) {
      const n = parseInt(act.scene, 10);
      if (n >= 1 && n <= 8 && act.id !== lastTriggered) { lastTriggered = act.id; if (R.parts) R.parts.selectScene(n); }
    }
  }

  R.song = {
    /* Scrubbing sends at most one seek per 100 ms; the release always lands on the exact spot. */
    scrubBegin() { seekSent = -1; seekLast = 0; },
    scrub(fraction, final) {
      const d = song().duration_seconds || 0;
      if (!d) return;
      seekTo = LW.clamp(fraction, 0, 1) * d;
      const fire = () => { seekTimer = null; if (seekTo === seekSent) return; seekSent = seekTo; seekLast = Date.now(); R.transport("seek", { seconds: seekTo }); };
      const remain = 100 - (Date.now() - seekLast);
      if (final || remain <= 0) { clearTimeout(seekTimer); fire(); } else if (!seekTimer) seekTimer = setTimeout(fire, remain);
    },
    async jump(m) {
      const sc = m.scene ? parseInt(m.scene, 10) : null;
      if (sc >= 1 && sc <= 8 && R.parts) R.parts.selectScene(sc);
      await R.transport("seek", { seconds: m.time });
      LW.alert({ icon: "bookmark", title: m.name, sub: `Jumped to ${LW.fmt(m.time)}` }, 1000);
    },
    openBookmark() {
      if (!(song().duration_seconds > 0)) { LW.alert({ icon: "info", title: "Load a song first", sub: "Bookmarks need a backing track" }, 1500); return; }
      $("bmName").value = `Section ${(song().markers || []).length + 1}`;
      const sel = $("bmScene");
      sel.textContent = "";
      sel.append(LW.h("option", { value: "", text: "None (keep the current scene)" }));
      for (let n = 1; n <= 8; n++) { const nm = R.sceneName(n); sel.append(LW.h("option", { value: String(n), text: nm !== `Scene ${n}` ? `Scene ${n} (${nm})` : nm })); }
      dlg.open();
      setTimeout(() => { $("bmName").focus(); $("bmName").select(); }, 80);
    },
    async saveBookmark() {
      const name = $("bmName").value.trim() || "Section";
      const v = $("bmScene").value;
      dlg.close();
      LW.alert({ icon: "bookmark", tone: "ok", title: "Bookmark added", sub: name }, 1200);
      await R.transport("add_marker", { name, scene: v ? parseInt(v, 10) : null, time: song().current_time_seconds || 0 });
    },
    async analyze() {
      if (analyzing) return;
      analyzing = true;
      $("btnAnalyze").disabled = true;
      LW.setText($("btnAnalyzeTxt"), "Analyzing…");
      LW.alert({ icon: "sparkle", title: "Analyzing song…", sub: "Key, tempo, chords, lyrics" }, 60000);
      try {
        const d = await LW.api.post("/api/analyze", {});
        if (d && d.success && d.result) { LW.alert({ icon: "check", tone: "ok", title: "Analysis done", sub: `${d.result.key || "Unknown key"} · ${d.result.bpm ? Math.round(d.result.bpm) + " BPM" : ""}` }, 2000); LW.setText($("btnAnalyzeTxt"), "Analyzed"); }
        else { LW.alert({ icon: "alert", tone: "bad", title: "Analysis failed", sub: (d && d.error) || "Existing chart kept" }, 2000); LW.setText($("btnAnalyzeTxt"), "Analyze"); }
      } catch (_) { LW.setText($("btnAnalyzeTxt"), "Analyze"); }
      finally { analyzing = false; setTimeout(() => { $("btnAnalyze").disabled = false; }, 3000); }
    },
  };

  LW.on("r-ready", () => {
    $("songArt").innerHTML = LW.icon("note");
    dlg = LW.dialog($("dlgBookmark"));
    $("btnBookmark").addEventListener("click", () => R.song.openBookmark());
    $("bmSave").addEventListener("click", () => R.song.saveBookmark());
    $("bmName").addEventListener("keydown", (e) => { if (e.key === "Enter") R.song.saveBookmark(); });
    $("btnStop").addEventListener("click", () => { R.transport("stop"); LW.alert({ icon: "stop", title: "Stopped" }, 800); });
    $("btnLoop").addEventListener("click", () => { const on = $("btnLoop").getAttribute("aria-pressed") !== "true"; $("btnLoop").setAttribute("aria-pressed", on ? "true" : "false"); R.transport("toggle_loop"); LW.alert({ icon: "loop", title: on ? "Loop on" : "Loop off" }, 900); });
    $("btnAnalyze").addEventListener("click", () => R.song.analyze());
    pitch = LW.ui.stepper($("keyShift"), {
      min: -12, max: 12, value: 0, label: "key shift", format: (v) => (v > 0 ? "+" : "") + v + " st",
      onChange: (v) => { R.transport("pitch_shift", { semitones: v }); LW.alert({ icon: "key", title: `Key shift ${v > 0 ? "+" : ""}${v}`, sub: "Backing track transposed" }, 1000); },
    });
    $("keyReset").addEventListener("click", () => { pitch.set(0); R.transport("pitch_shift", { semitones: 0 }); });
    LW.ui.stepper($("lyricsFont"), { min: 10, max: 26, value: size, label: "lyrics size", format: (v) => `${v}px`, onChange: (v) => { size = v; $("lyrics").style.fontSize = v + "px"; } });
    $("lyrics").style.fontSize = size + "px";
    // Seek: tap or drag along the bar.
    const seek = $("seek");
    const at = (e) => { const r = seek.getBoundingClientRect(); return (e.clientX - r.left) / r.width; };
    seek.addEventListener("pointerdown", (e) => { seek.setPointerCapture(e.pointerId); seek.classList.add("live"); R.song.scrubBegin(); R.song.scrub(at(e)); });
    seek.addEventListener("pointermove", (e) => { if (seek.hasPointerCapture(e.pointerId)) R.song.scrub(at(e)); });
    seek.addEventListener("pointerup", (e) => { seek.classList.remove("live"); R.song.scrub(at(e), true); });
    seek.addEventListener("pointercancel", () => seek.classList.remove("live"));
    LW.hydrateIcons && LW.hydrateIcons($("pagesWrap"));
  });

  LW.on("r-telemetry", (msg) => {
    const s = msg.song;
    if (!s) return;
    const t = s.current_time_seconds || 0, d = s.duration_seconds || 0;
    LW.setText($("songTitle"), s.has_track ? (s.filename || "Backing track") : "No track loaded");
    LW.setText($("songTime"), `${LW.fmt(t)} / ${LW.fmt(d)}`);
    const p = d > 0 ? LW.clamp(t / d, 0, 1) * 100 : 0;
    $("seekFill").style.width = p + "%";
    $("seekThumb").style.left = p + "%";
    $("btnLoop").setAttribute("aria-pressed", s.loop_enabled && s.loop_a != null && s.loop_b != null ? "true" : "false");
    if (s.pitch_shift !== undefined && pitch) pitch.set(s.pitch_shift);
    renderMarks();
    renderLyrics();
    highlight(t);
    if (s.is_playing) autoScene(t);
  });
})(window);
