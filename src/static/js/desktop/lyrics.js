/* Synced lyrics: render, highlight the current line, follow mode, font size, click a line to seek. */
(function (root) {
  const LW = root.LW;
  const $ = (id) => document.getElementById(id);
  const S = () => LW.state;
  let renderedKey = null, active = -1, follow = false, size = 15;

  function indexAt(sheet, t) {
    if (!sheet || !sheet.length) return -1;
    for (let i = 0; i < sheet.length; i++) {
      const next = i + 1 < sheet.length ? sheet[i + 1].time : Infinity;
      if (t >= sheet[i].time && t < next) return i;
    }
    return -1;
  }

  function render() {
    const box = $("lyrics");
    const sheet = S().lyrics || [];
    const key = sheet.length + ":" + (sheet[0] ? sheet[0].time + sheet[0].text : "");
    if (key === renderedKey) return;
    renderedKey = key;
    active = -1;
    box.textContent = "";
    if (!sheet.length) {
      box.append(LW.h("div", { class: "empty", text: S().hasTrack ? "No lyrics for this track yet. Analyze it to fetch synced lyrics." : "Load and analyze a backing track to see synced lyrics." }));
      return;
    }
    sheet.forEach((row, i) => {
      const line = LW.h("button", { class: "lyr-line", type: "button", data: { i: String(i) }, title: `Jump to ${LW.fmt(row.time)}` }, row.text == null ? "" : String(row.text));
      line.addEventListener("click", () => LW.transport.action("seek", { position: row.time }));
      box.append(line);
    });
  }

  function highlight(t) {
    const sheet = S().lyrics || [];
    const i = indexAt(sheet, t);
    if (i === active || i < 0) return;
    const box = $("lyrics");
    const prev = box.querySelector(".lyr-line.on");
    if (prev) prev.classList.remove("on");
    active = i;
    const cur = box.children[i];
    if (!cur) return;
    cur.classList.add("on");
    if (follow) box.scrollTo({ top: Math.max(0, cur.offsetTop - box.offsetTop - 60), behavior: LW.reducedMotion() ? "auto" : "smooth" });
    LW.emit("lyric", sheet[i].text);
  }

  LW.lyrics = {
    indexAt, render,
    current() { const sheet = S().lyrics || []; const i = indexAt(sheet, S().time); return i >= 0 ? sheet[i].text : ""; },
    setFollow(v) {
      follow = !!v;
      $("btnFollow").setAttribute("aria-pressed", follow ? "true" : "false");
      LW.setText($("btnFollow"), follow ? "Following" : "Follow");
      if (follow && active >= 0) { const el = $("lyrics").children[active]; if (el) el.scrollIntoView({ behavior: "smooth", block: "center" }); }
    },
  };

  LW.on("ready", () => {
    LW.ui.stepper($("lyricsFont"), {
      min: 10, max: 28, value: size, label: "lyrics size", format: (v) => `${v}px`,
      onChange: (v) => { size = v; $("lyrics").style.setProperty("--lyr", v + "px"); },
    });
    $("btnFollow").addEventListener("click", () => LW.lyrics.setFollow(!follow));
    render();
  });
  LW.on("telemetry", (d) => { if (!d.song) return; render(); highlight(S().time); });
  LW.on("analysis", () => { renderedKey = null; render(); });
})(window);
