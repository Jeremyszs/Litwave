/* Song chords panel: current chord, next chord with countdown ring, voice leading, the next four chords. */
(function (root) {
  const LW = root.LW;
  const $ = (id) => document.getElementById(id);
  const S = () => LW.state;
  let gridKey = "", metaKey = "";

  function renderMeta() {
    const chart = S().chart || [];
    const a = S().analysis || {};
    const txt = chart.length
      ? [a.key || a.key_full ? `Key ${a.key || a.key_full}` : "Analyzed", a.bpm ? `${Math.round(a.bpm)} BPM` : ""].filter(Boolean).join(" · ")
      : "No analysis";
    if (txt !== metaKey) { metaKey = txt; LW.setText($("progMeta"), txt); }
  }

  function renderGrid(playable, startIdx) {
    const grid = $("measureGrid");
    if (!grid) return;
    const items = startIdx >= 0 ? playable.slice(startIdx, startIdx + 4) : [];
    const key = items.map((c) => c.time + c.chord).join("|") || "empty";
    if (key === gridKey) return;
    gridKey = key;
    grid.textContent = "";
    for (let i = 0; i < 4; i++) {
      const c = items[i];
      const cls = "mcell" + (!c ? " ph" : i === 0 ? " now" : i === 1 ? " next" : "");
      grid.append(LW.h("div", { class: cls },
        LW.h("div", { class: "lbl", text: i === 0 ? "Now" : i === 1 ? "Next" : `+${i}` }),
        LW.h("b", { text: c ? c.chord : "--" }),
        LW.h("em", { text: c ? `${c.nashville && c.nashville !== "-" ? c.nashville + " · " : ""}${LW.fmt(c.time)}` : "--:--" })));
    }
  }

  function setNotes(chord) {
    const box = $("progNowNotes");
    if (!box) return;
    const key = chord || "";
    if (box._k === key) return;
    box._k = key;
    box.textContent = "";
    (chord && chord !== "--" ? LW.voicing.notesOf(chord) : []).forEach((n) => box.append(LW.h("span", { text: n })));
  }

  function render(t) {
    const chart = S().chart || [];
    const TL = root.ChordTimeline;
    renderMeta();
    if (!chart.length) {
      LW.swap($("progNow"), "--");
      LW.setText($("progNowNash"), "");
      LW.setText($("progNowTime"), LW.fmt(t));
      LW.swap($("progNext"), "--");
      LW.setText($("progNextIn"), "--");
      LW.setText($("voiceLead"), "No chord analysis yet");
      setNotes("");
      const ring = document.querySelector && document.querySelector("#progRing .p");
      if (ring) ring.setAttribute("stroke-dashoffset", "144.5");
      renderGrid([], -1);
      if (LW.voicing) LW.voicing.setChord("");
      return;
    }
    const cur = TL.playableChord(TL.chordAtTime(chart, t));
    const nxt = TL.nextPlayableChord(chart, t);
    LW.swap($("progNow"), cur ? cur.chord : "--");
    LW.setText($("progNowNash"), cur && cur.nashville && cur.nashville !== "-" ? cur.nashville : "");
    LW.setText($("progNowTime"), LW.fmt(cur ? cur.time : t));
    setNotes(cur ? cur.chord : "");
    if (LW.voicing) LW.voicing.setChord(cur ? cur.chord : "");
    LW.swap($("progNext"), nxt ? nxt.chord : "--");
    LW.setText($("progNextIn"), nxt ? `${Math.max(0, nxt.time - t).toFixed(1)}s` : "--");
    LW.setText($("voiceLead"), nxt ? (cur ? LW.voicing.lead(cur.chord, nxt.chord) : "Waiting for harmony") : "End of track");
    const ring = document.querySelector && document.querySelector("#progRing .p");
    if (ring) {
      let f = 0;
      if (cur && nxt && nxt.time > cur.time) f = LW.clamp((t - cur.time) / (nxt.time - cur.time), 0, 1);
      ring.setAttribute("stroke-dashoffset", (144.5 * (1 - f)).toFixed(1));
    }
    const playable = chart.filter(TL.playableChord);
    const start = cur ? playable.indexOf(cur) : playable.findIndex((c) => c.time > t);
    renderGrid(playable, start);
  }

  LW.progression = { render };
  LW.on("telemetry", (d) => { if (d.song) render(S().time); });
  LW.on("analysis", () => { gridKey = ""; metaKey = ""; render(S().time); });
  LW.on("ready", () => render(0));
})(window);
