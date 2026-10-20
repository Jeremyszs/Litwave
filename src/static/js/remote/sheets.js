/* Phone sheets: More (engine, ear, setlist, appearance, full screen, install, refresh), Sound engine,
   Ear training, Setlist & library. */
(function (root) {
  const LW = root.LW;
  const R = LW.R;
  const $ = (id) => document.getElementById(id);
  const S = R.state;
  let more, engine, ear, setlist, pendingEngine = "yamaha", earMod = "chord_quality", earLocked = false;
  let setlists = [], activeSl = "sunday_morning", slTabs = null, installPrompt = null;

  /* ---------- engine ---------- */
  function paintEngine() {
    LW.$$("#sheetEngine .eng").forEach((b) => b.classList.toggle("sel-on", b.dataset.engine === pendingEngine));
    LW.$$("#sheetEngine [data-badge]").forEach((b) => { b.hidden = !(S.engineRunning && b.dataset.badge === S.engineType); });
    LW.setText($("engStatus"), S.engineRunning ? `Running · ${S.engineType === "community" ? "Community" : "MONTAGE M"}` : "Stopped");
    $("engStatus").style.color = S.engineRunning ? "var(--ok)" : "var(--ink2)";
    LW.setText($("mEngineSub"), `${S.engineType === "community" ? "Community" : "MONTAGE M"}${S.engineRunning ? " · on" : ""}`);
  }

  /* ---------- ear training ---------- */
  async function loadEar() {
    earLocked = false;
    LW.setText($("earFb"), ""); $("earFb").className = "ear-fb";
    LW.setText($("earQ"), "Playing on the sound engine…");
    const grid = $("earChoices");
    grid.textContent = "";
    try {
      const d = await LW.api.post("/api/ear-training", { action: "generate", module: earMod });
      if (!d || !d.exercise) return;
      LW.setText($("earQ"), d.exercise.question || "Listen and choose");
      if (d.score) LW.setText($("earScore"), `${d.score.correct}/${d.score.total}`);
      (d.exercise.choices || []).forEach((c) => {
        const b = LW.h("button", { class: "ear-choice", type: "button", "data-press": "sink" }, LW.h("b", { text: c.label || c.nashville || c.id }), LW.h("em", { text: c.abbr || c.roman || c.deg || "" }));
        b.addEventListener("click", () => checkEar(c.id));
        grid.append(b);
      });
      LW.ui.press(grid);
    } catch (_) { LW.setText($("earQ"), "Couldn't create an exercise."); }
  }
  async function checkEar(id) {
    if (earLocked) return;
    earLocked = true;
    try {
      const d = await LW.api.post("/api/ear-training", { action: "check", answer: id });
      const fb = $("earFb");
      if (d.is_correct) { fb.className = "ear-fb ok"; LW.setText(fb, "Correct!"); }
      else { fb.className = "ear-fb bad"; LW.setText(fb, `The answer was ${d.correct_answer}`); }
      if (d.score) LW.setText($("earScore"), `${d.score.correct}/${d.score.total}`);
    } catch (_) { earLocked = false; }
  }

  /* ---------- setlist & library ---------- */
  async function loadSetlists() {
    try {
      const d = await LW.api.get("/api/setlist");
      setlists = (d && d.setlists) || [];
      if (!setlists.some((s) => s.id === activeSl) && setlists.length) activeSl = setlists[0].id;
      const sel = $("slSelect");
      sel.textContent = "";
      setlists.forEach((s) => { const o = LW.h("option", { value: s.id, text: `${s.name} (${(s.songs || []).length})` }); if (s.id === activeSl) o.selected = true; sel.append(o); });
      renderSongs();
    } catch (_) {}
  }
  function renderSongs() {
    const box = $("slSongs");
    box.textContent = "";
    const cur = setlists.find((s) => s.id === activeSl);
    const songs = (cur && cur.songs) || [];
    if (!songs.length) { box.append(LW.h("div", { class: "empty", text: "No songs in this setlist. Add tracks from the Library tab." })); return; }
    songs.forEach((s, i) => {
      const row = LW.h("button", { class: "row sl-row", type: "button" },
        LW.h("span", { class: "no", text: String(i + 1) }),
        LW.h("span", { class: "grow" }, LW.h("b", { text: s.title || s.filename }), LW.h("em", { text: `Key ${s.key || "--"} · Pad ${(s.patch_snapshot && s.patch_snapshot.drone_root) || "--"}` })));
      row.addEventListener("click", () => loadSong(cur.id, s.id));
      box.append(row);
    });
  }
  async function loadSong(slId, songId) {
    const cur = setlists.find((s) => s.id === slId);
    const song = cur && (cur.songs || []).find((x) => x.id === songId);
    if (!song) return;
    if (song.filename) await LW.api.post("/api/playlist/select", { filename: song.filename }).catch(() => {});
    if (song.patch_snapshot) await LW.api.post("/api/setlist", { action: "apply_song_patch", patch_snapshot: song.patch_snapshot }).catch(() => {});
    LW.alert({ icon: "check", tone: "ok", title: song.title || song.filename, sub: "Loaded on the desktop", right: song.key || "" }, 1700);
    setlist.close();
  }
  async function loadLibrary() {
    const box = $("slLib");
    box.textContent = "";
    try {
      const d = await LW.api.get("/api/playlist");
      const tracks = (d && d.tracks) || [];
      if (!tracks.length) { box.append(LW.h("div", { class: "empty", text: "No audio tracks found." })); return; }
      tracks.forEach((t) => {
        const play = LW.h("button", { class: "btn sm primary", type: "button", text: "Load" });
        const add = LW.h("button", { class: "btn sm", type: "button", text: "+ Setlist" });
        play.addEventListener("click", async () => { await LW.api.post("/api/playlist/select", { filename: t.filename }).catch(() => {}); LW.alert({ icon: "note", tone: "ok", title: "Track loaded", sub: t.filename }, 1500); setlist.close(); });
        add.addEventListener("click", async () => {
          try {
            const r = await LW.api.post("/api/setlist", { action: "add_song", setlist_id: activeSl, song_data: { title: t.filename, filename: t.filename, key: "C" } });
            if (r && r.setlists) { setlists = r.setlists; LW.alert({ icon: "plus", tone: "ok", title: "Added to setlist", sub: t.filename }, 1300); slTabs.select(0); }
          } catch (_) {}
        });
        box.append(LW.h("div", { class: "row sl-row" + (t.is_current ? " on" : "") }, LW.h("span", { class: "grow" }, LW.h("b", { text: t.title || t.filename }), LW.h("em", { text: `${t.size_mb || 0} MB` })), play, add));
      });
    } catch (_) {}
  }

  R.sheets = {
    openMore: () => more.open($("btnMore")),
    openEngine: () => { pendingEngine = S.engineType; paintEngine(); engine.open(); },
    openEar: () => { ear.open(); loadEar(); },
    openSetlist: (tab) => { setlist.open(); slTabs.select(tab === "library" ? 1 : 0); loadSetlists(); },
  };

  LW.on("r-ready", () => {
    more = LW.sheet($("sheetMore"));
    engine = LW.sheet($("sheetEngine"));
    ear = LW.sheet($("sheetEar"));
    setlist = LW.sheet($("sheetSetlist"));
    $("btnMore").addEventListener("click", () => R.sheets.openMore());
    const go = (fn) => () => { more.close(); setTimeout(fn, 180); };
    $("mEngine").addEventListener("click", go(R.sheets.openEngine));
    $("mEar").addEventListener("click", go(R.sheets.openEar));
    $("mSetlist").addEventListener("click", go(() => R.sheets.openSetlist("setlist")));
    $("mTheme").addEventListener("click", () => LW.theme.toggle());
    const paintTheme = () => {
      const dark = LW.theme.current() === "dark";
      LW.setText($("mThemeTxt"), dark ? "Light appearance" : "Dark appearance");
      const ic = $("mTheme").querySelector("[data-icon]");
      if (ic) ic.innerHTML = LW.icon(dark ? "sun" : "moon");
    };
    LW.on("theme", paintTheme); paintTheme();
    $("mFull").addEventListener("click", () => {
      const d = document, el = d.documentElement;
      if (!d.fullscreenElement && !d.webkitFullscreenElement) { (el.requestFullscreen ? el.requestFullscreen() : el.webkitRequestFullscreen && el.webkitRequestFullscreen()); }
      else if (d.exitFullscreen) d.exitFullscreen().catch(() => {}); else if (d.webkitExitFullscreen) d.webkitExitFullscreen();
      more.close();
    });
    $("mRefresh").addEventListener("click", () => root.location.reload());
    $("mInstall").addEventListener("click", async () => {
      if (!installPrompt) return;
      installPrompt.prompt();
      const choice = await installPrompt.userChoice;
      if (choice.outcome === "accepted") $("mInstall").hidden = true;
      installPrompt = null;
    });
    root.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); installPrompt = e; $("mInstall").hidden = false; });

    LW.$$("#sheetEngine .eng").forEach((b) => b.addEventListener("click", () => { pendingEngine = b.dataset.engine; paintEngine(); }));
    $("engOpen").addEventListener("click", async () => {
      engine.close();
      if (pendingEngine === "yamaha") { await LW.api.post("/api/montage/editor", { action: "show", engine: "yamaha" }).catch(() => {}); LW.alert({ icon: "synth", tone: "ok", title: "MONTAGE M opened" }, 1400); }
      else { await LW.api.post("/api/montage/editor", { action: "start", engine: "community", hidden: true }).catch(() => {}); LW.alert({ icon: "synth", tone: "ok", title: "Community engine started" }, 1400); }
      S.engineType = pendingEngine;
      if (R.parts) R.parts.render();
    });
    $("engKill").addEventListener("click", async () => { await LW.api.post("/api/montage/editor", { action: "kill" }).catch(() => {}); S.engineRunning = false; engine.close(); LW.alert({ icon: "power", tone: "bad", title: "Sound engine stopped" }, 1400); });

    LW.ui.tabs($("earTabs"), (i, k) => { earMod = k; loadEar(); });
    $("earReplay").addEventListener("click", () => LW.api.post("/api/ear-training", { action: "replay" }).catch(() => {}));
    $("earNext").addEventListener("click", loadEar);

    slTabs = LW.ui.tabs($("slTabs"), (i) => { $("slPaneSet").hidden = i !== 0; $("slPaneLib").hidden = i !== 1; if (i === 1) loadLibrary(); else renderSongs(); });
    $("slSelect").addEventListener("change", (e) => { activeSl = e.target.value; renderSongs(); });
  });

  let lastEng = "";
  LW.on("r-telemetry", () => { const k = S.engineType + S.engineRunning; if (k !== lastEng) { lastEng = k; paintEngine(); } });
})(window);
