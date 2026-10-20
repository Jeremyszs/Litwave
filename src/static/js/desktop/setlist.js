/* Setlists and the song library: sidebar lists + management sheet, create/delete setlists, add/move/remove songs,
   load a song with its saved sound-engine snapshot, upload tracks. Same /api/setlist and /api/playlist bodies as classic. */
(function (root) {
  const LW = root.LW;
  const $ = (id) => document.getElementById(id);
  let setlists = [], activeId = "sunday_morning", tracks = [];
  let sheet = null, dlgNew = null, dlgAdd = null, dlgConfirm = null, pendingConfirm = null, tabs = null;
  try { activeId = root.localStorage.getItem("lw-setlist") || activeId; } catch (_) {}

  const post = (body) => LW.api.post("/api/setlist", body);
  const active = () => setlists.find((s) => s.id === activeId) || null;
  const songTitle = (s) => s.title || s.filename || "Untitled";
  const songSub = (s) => {
    const snap = s.patch_snapshot || {};
    return [`Key ${s.key || "--"}`, `Pad ${snap.drone_root || "--"}`, snap.engine_type === "community" ? "Community" : "MONTAGE M"].join(" · ");
  };
  const current = () => (LW.state.song && LW.state.song.filename) || "";

  function setActive(id) {
    activeId = id;
    try { root.localStorage.setItem("lw-setlist", id); } catch (_) {}
    renderSelects(); renderSongs();
  }

  function renderSelects() {
    ["sbSetlistSelect", "slSelect"].forEach((id) => {
      const sel = $(id);
      if (!sel) return;
      sel.textContent = "";
      if (!setlists.length) { sel.append(LW.h("option", { value: "", text: "No setlists yet" })); return; }
      setlists.forEach((s) => {
        const o = LW.h("option", { value: s.id, text: `${s.name} (${(s.songs || []).length})` });
        if (s.id === activeId) o.selected = true;
        sel.append(o);
      });
    });
  }

  function renderSongs() {
    const cur = active();
    const songs = (cur && cur.songs) || [];
    const sb = $("sbSongs");
    if (sb) {
      sb.textContent = "";
      if (!songs.length) sb.append(LW.h("div", { class: "empty", text: "No songs in this setlist yet." }));
      songs.forEach((song, i) => {
        const row = LW.h("button", { class: "row" + (song.filename && song.filename === current() ? " on" : ""), type: "button", title: `Load ${songTitle(song)}` },
          LW.h("span", { class: "no", text: String(i + 1) }),
          LW.h("span", { class: "grow" }, LW.h("b", { text: songTitle(song) }), LW.h("em", { text: `Key ${song.key || "--"}` })));
        row.addEventListener("click", () => LW.setlist.loadSong(cur.id, song.id));
        sb.append(row);
      });
    }
    const list = $("slSongs");
    if (list) {
      list.textContent = "";
      if (!songs.length) list.append(LW.h("div", { class: "empty", text: "No songs in this setlist yet. Use Add song, or add tracks from the Library tab." }));
      songs.forEach((song, i) => {
        const up = LW.h("button", { class: "ib sm", type: "button", "aria-label": "Move song up", html: LW.icon("up") });
        const down = LW.h("button", { class: "ib sm", type: "button", "aria-label": "Move song down", html: LW.icon("down") });
        const load = LW.h("button", { class: "btn sm primary", type: "button", text: "Load" });
        const del = LW.h("button", { class: "ib sm danger", type: "button", "aria-label": "Remove song from setlist", html: LW.icon("trash") });
        up.disabled = i === 0; down.disabled = i === songs.length - 1;
        up.addEventListener("click", () => LW.setlist.move(cur.id, song.id, "up"));
        down.addEventListener("click", () => LW.setlist.move(cur.id, song.id, "down"));
        load.addEventListener("click", () => LW.setlist.loadSong(cur.id, song.id));
        del.addEventListener("click", () => LW.setlist.confirmRemove(cur.id, song.id, songTitle(song)));
        list.append(LW.h("div", { class: "row sl-row" + (song.filename && song.filename === current() ? " on" : "") },
          LW.h("span", { class: "no", text: String(i + 1) }),
          LW.h("span", { class: "grow" }, LW.h("b", { text: songTitle(song) }), LW.h("em", { text: songSub(song) })),
          LW.h("span", { class: "acts" }, up, down, load, del)));
      });
    }
  }

  function renderLibrary() {
    const cur = current();
    const sb = $("sbLibrary");
    if (sb) {
      sb.textContent = "";
      if (!tracks.length) sb.append(LW.h("div", { class: "empty", text: "Upload a track to start your library." }));
      tracks.forEach((t) => {
        const isCur = t.filename === cur || t.is_current;
        const add = LW.h("span", { class: "ib sm", role: "button", tabindex: "0", "aria-label": `Add ${t.title || t.filename} to the setlist`, html: LW.icon("plus") });
        add.addEventListener("click", (e) => { e.stopPropagation(); LW.setlist.quickAdd(t.filename); });
        const row = LW.h("button", { class: "row" + (isCur ? " on" : ""), type: "button", title: `Load ${t.filename}` },
          LW.h("span", { class: "play-ic", html: LW.icon(isCur ? "play" : "note") }),
          LW.h("span", { class: "grow" }, LW.h("b", { text: t.title || t.filename }), LW.h("em", { text: `${t.key && t.key !== "--" ? "Key " + t.key + " · " : ""}${t.size_mb || 0} MB` })),
          add);
        row.addEventListener("click", () => LW.setlist.loadTrack(t.filename));
        sb.append(row);
      });
    }
    const lib = $("slLibrary");
    if (lib) {
      lib.textContent = "";
      if (!tracks.length) lib.append(LW.h("div", { class: "empty", text: "No audio files yet. Upload one to start." }));
      tracks.forEach((t) => {
        const load = LW.h("button", { class: "btn sm primary", type: "button", text: "Load" });
        const add = LW.h("button", { class: "btn sm", type: "button", text: "Add to setlist" });
        load.addEventListener("click", () => { LW.setlist.loadTrack(t.filename); sheet.close(); });
        add.addEventListener("click", () => LW.setlist.quickAdd(t.filename));
        lib.append(LW.h("div", { class: "row sl-row" + (t.filename === cur ? " on" : "") },
          LW.h("span", { class: "grow" }, LW.h("b", { text: t.title || t.filename }), LW.h("em", { text: `${t.size_mb || 0} MB${t.key && t.key !== "--" ? " · Key " + t.key : ""}` })),
          LW.h("span", { class: "acts" }, load, add)));
      });
    }
    const pick = $("asList");
    if (pick) {
      pick.textContent = "";
      if (!tracks.length) pick.append(LW.h("div", { class: "empty", text: "No audio tracks found. Upload one first." }));
      tracks.forEach((t) => {
        const add = LW.h("button", { class: "btn sm primary", type: "button", text: "Add" });
        add.addEventListener("click", () => { dlgAdd.close(); LW.setlist.addTrack(t.filename, t.title || t.filename, t.key && t.key !== "--" ? t.key : "C"); });
        pick.append(LW.h("div", { class: "row" }, LW.h("span", { class: "grow" }, LW.h("b", { text: t.title || t.filename }), LW.h("em", { text: `Key ${t.key || "--"} · ${t.size_mb || 0} MB` })), add));
      });
    }
  }

  function confirm(title, msg, label, fn) {
    LW.setText($("dlgCfTitle"), title);
    LW.setText($("cfMsg"), msg);
    LW.setText($("cfOk"), label || "Confirm");
    pendingConfirm = fn;
    dlgConfirm.open();
  }
  LW.confirm = confirm;

  LW.setlist = {
    songSub,
    async refresh() {
      try {
        const d = await LW.api.get("/api/setlist");
        if (d && d.setlists) {
          setlists = d.setlists;
          if (!setlists.some((s) => s.id === activeId) && setlists.length) activeId = setlists[0].id;
          renderSelects(); renderSongs();
          LW.emit("setlists", setlists, activeId);
        }
      } catch (_) {}
    },
    async refreshLibrary() {
      try { const d = await LW.api.get("/api/playlist"); tracks = (d && d.tracks) || []; renderLibrary(); } catch (_) {}
    },
    active, songTitle,
    get setlists() { return setlists; },
    async loadTrack(filename, quiet) {
      LW.local.mark("song");
      try {
        const d = await LW.api.post("/api/playlist/select", { filename });
        if (d && d.success) {
          if (d.song && d.song.waveform_peaks) { LW.state.peaks = d.song.waveform_peaks; if (LW.waveform) LW.waveform.draw(true); }
          if (!quiet) LW.alert({ icon: "note", tone: "ok", title: "Track loaded", sub: filename }, 1600);
        }
      } catch (_) {}
    },
    async loadSong(setlistId, songId) {
      const sl = setlists.find((s) => s.id === setlistId);
      const song = sl && (sl.songs || []).find((s) => s.id === songId);
      if (!song) return;
      if (song.filename) await LW.setlist.loadTrack(song.filename, true);
      if (song.patch_snapshot) await post({ action: "apply_song_patch", patch_snapshot: song.patch_snapshot }).catch(() => {});
      LW.alert({ icon: "check", tone: "ok", title: songTitle(song), sub: `Loaded with its sound settings · Key ${song.key || "C"}`, right: song.key || "" }, 1900);
      if (sheet && sheet.isOpen) sheet.close();
      renderSongs();
    },
    async addTrack(filename, title, key) {
      try {
        const d = await post({ action: "add_song", setlist_id: activeId, song_data: { title: title || filename, filename, key: key || "C" } });
        if (d && d.setlists) { setlists = d.setlists; renderSelects(); renderSongs(); LW.alert({ icon: "plus", tone: "ok", title: "Added to setlist", sub: title || filename }, 1500); }
      } catch (_) {}
    },
    quickAdd(filename) { return LW.setlist.addTrack(filename, filename, "C"); },
    async move(setlistId, songId, direction) {
      try { const d = await post({ action: "move_song", setlist_id: setlistId, song_id: songId, direction }); if (d && d.setlists) { setlists = d.setlists; renderSongs(); } } catch (_) {}
    },
    confirmRemove(setlistId, songId, title) {
      confirm("Remove song", `Remove "${title}" from this setlist?`, "Remove", async () => {
        try { const d = await post({ action: "remove_song", setlist_id: setlistId, song_id: songId }); if (d && d.setlists) { setlists = d.setlists; renderSelects(); renderSongs(); LW.alert({ icon: "trash", title: "Song removed", sub: title }, 1300); } } catch (_) {}
      });
    },
    openNew(origin) { $("nsName").value = `Setlist ${setlists.length + 1}`; dlgNew.open(origin); setTimeout(() => { $("nsName").focus(); $("nsName").select(); }, 80); },
    async create() {
      const name = $("nsName").value.trim() || `Setlist ${setlists.length + 1}`;
      dlgNew.close();
      try {
        const d = await post({ action: "create_setlist", name });
        if (d && d.setlist) { activeId = d.setlist.id; await LW.setlist.refresh(); setActive(activeId); LW.alert({ icon: "list", tone: "ok", title: "Setlist created", sub: name }, 1500); }
      } catch (_) {}
    },
    confirmDelete() {
      const cur = active();
      if (!cur) return;
      confirm("Delete setlist", `Delete "${cur.name}"? This can't be undone.`, "Delete setlist", async () => {
        try {
          const d = await post({ action: "delete_setlist", setlist_id: cur.id });
          if (d && d.setlists) { setlists = d.setlists; setActive((setlists[0] && setlists[0].id) || "sunday_morning"); LW.alert({ icon: "trash", title: "Setlist deleted", sub: cur.name }, 1500); }
        } catch (_) {}
      });
    },
    openAdd(origin) { renderLibrary(); dlgAdd.open(origin); LW.setlist.refreshLibrary(); },
    open(tab, origin) { LW.openSheet("setlist", origin); if (tabs) tabs.select(tab === "library" ? 1 : 0); },
  };

  LW.on("ready", () => {
    sheet = LW.sheet($("sheetSetlist"));
    LW.registerSheet("setlist", sheet, () => { LW.setlist.refresh(); LW.setlist.refreshLibrary(); });
    dlgNew = LW.dialog($("dlgNewSetlist"));
    dlgAdd = LW.dialog($("dlgAddSong"));
    dlgConfirm = LW.dialog($("dlgConfirm"), { onClose: () => { pendingConfirm = null; } });
    $("cfOk").addEventListener("click", async () => { const fn = pendingConfirm; pendingConfirm = null; dlgConfirm.close(); if (fn) await fn(); });
    tabs = LW.ui.tabs($("setlistTabs"), (i) => { $("slPaneSetlist").hidden = i !== 0; $("slPaneLibrary").hidden = i !== 1; });
    $("sbSetlistSelect").addEventListener("change", (e) => setActive(e.target.value));
    $("slSelect").addEventListener("change", (e) => setActive(e.target.value));
    $("sbNewSetlist").addEventListener("click", (e) => LW.setlist.openNew(e.currentTarget));
    $("slNew").addEventListener("click", (e) => LW.setlist.openNew(e.currentTarget));
    $("sbSetlistManage").addEventListener("click", (e) => LW.setlist.open("setlist", e.currentTarget));
    $("sbAddSong").addEventListener("click", (e) => LW.setlist.openAdd(e.currentTarget));
    $("slAdd").addEventListener("click", (e) => LW.setlist.openAdd(e.currentTarget));
    $("slDelete").addEventListener("click", () => LW.setlist.confirmDelete());
    $("nsSave").addEventListener("click", () => LW.setlist.create());
    $("nsName").addEventListener("keydown", (e) => { if (e.key === "Enter") LW.setlist.create(); });
    $("slUpload").addEventListener("click", () => $("songFileInput").click());
    LW.setlist.refresh();
    LW.setlist.refreshLibrary();
  });
  LW.on("library-changed", () => LW.setlist.refreshLibrary());
  LW.on("song-changed", () => { renderSongs(); renderLibrary(); });
})(window);
