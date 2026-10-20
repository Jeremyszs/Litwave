/* Keyboard input panel: 88-key piano with live notes, chord + Nashville, last note, pedals,
   next-chord attention, Learn Chords recording toggle. */
(function (root) {
  const LW = root.LW;
  const $ = (id) => document.getElementById(id);
  const S = () => LW.state;
  const START = 21, END = 108;
  const BLACK = [false, true, false, true, false, false, true, false, true, false, true, false];
  let lit = new Set();

  function build() {
    const box = $("piano");
    box.textContent = "";
    let whites = 0;
    for (let n = START; n <= END; n++) if (!BLACK[n % 12]) whites++;
    const ww = 100 / whites, bw = ww * 0.62;
    let wi = 0;
    for (let n = START; n <= END; n++) {
      if (BLACK[n % 12]) continue;
      box.append(LW.h("div", { class: "wk", id: `key-${n}`, style: { left: wi * ww + "%", width: ww + "%" } }));
      wi++;
    }
    wi = 0;
    for (let n = START; n <= END; n++) {
      if (!BLACK[n % 12]) { wi++; continue; }
      box.append(LW.h("div", { class: "bk", id: `key-${n}`, style: { left: wi * ww - bw / 2 + "%", width: bw + "%" } }));
    }
  }

  function lightKeys(notes) {
    const next = new Set(notes || []);
    lit.forEach((n) => { if (!next.has(n)) { const k = $(`key-${n}`); if (k) k.classList.remove("on"); } });
    next.forEach((n) => { if (!lit.has(n)) { const k = $(`key-${n}`); if (k) k.classList.add("on"); } });
    lit = next;
  }

  function showChord(notes, names) {
    const TL = root.ChordTimeline;
    if (notes && notes.length && names && names.length) {
      const c = TL.detectAdvancedChord(notes);
      LW.swap($("liveChord"), c);
      LW.setText($("liveNash"), c && c !== "--" ? TL.getChordWithNashville(c, S().nashKey).nashville : "");
      LW.setText($("liveNotes"), names.join(" "));
    } else {
      LW.swap($("liveChord"), "--");
      LW.setText($("liveNash"), "");
      LW.setText($("liveNotes"), "Ready");
    }
  }

  function pedal(id, val, kind) {
    const v = Math.max(0, Math.min(127, Number(val) || 0));
    const bar = $(id), label = $(id + "V");
    if (bar) bar.style.clipPath = `inset(0 ${100 - (v / 127) * 100}% 0 0)`;
    if (!label) return;
    if (kind === "switch") { LW.setText(label, v >= 64 ? "On" : "Off"); label.classList.toggle("on", v >= 64); }
    else LW.setText(label, `${Math.round((v / 127) * 100)}%`);
  }

  function nextAttention(t) {
    const chart = S().chart || [];
    const box = $("nextAttention");
    if (!chart.length || !S().hasTrack) { box.hidden = true; return; }
    const n = chart.find((c) => c.time > t + 0.3 && c.time <= t + 8 && root.ChordTimeline.playableChord(c));
    box.hidden = !n;
    if (n) { LW.setText($("nextAttName"), n.chord); LW.setText($("nextAttIn"), `in ${(n.time - t).toFixed(1)}s`); }
  }

  LW.keyboard = {
    setLearning(on) {
      S().recordingChords = !!on;
      $("btnLearn").setAttribute("aria-pressed", on ? "true" : "false");
      LW.setText($("btnLearnTxt"), on ? "Recording chords…" : "Learn chords");
      LW.alert(on ? { icon: "record", tone: "rec", title: "Learning chords", sub: "Chords you play are written into the song" } : { icon: "check", title: "Chord recording stopped" }, 1600);
    },
  };

  LW.on("ready", () => {
    build();
    $("btnLearn").addEventListener("click", () => LW.keyboard.setLearning(!S().recordingChords));
    showChord([], []);
  });
  LW.on("panic", () => lightKeys([]));
  LW.on("telemetry", (d) => {
    const m = d.midi;
    if (m) {
      const p = m.pedals || {};
      pedal("pedSustain", p.sustain, "switch");
      pedal("pedExpr", p.expression, "level");
      pedal("pedSoft", p.soft, "switch");
      pedal("pedVol", p.volume, "level");
      lightKeys(m.active_notes || []);
      if (m.active_notes && m.active_notes.length && m.active_note_names) LW.setText($("lastNote"), `Note ${m.active_note_names[m.active_note_names.length - 1]}`);
      showChord(m.active_notes, m.active_note_names);
    }
    if (d.song) nextAttention(S().time);
  });
  LW.on("midi_event", (data) => {
    if (data.type === "note_on") LW.setText($("lastNote"), `Note ${data.note_name} · vel ${data.velocity}${data.raw_velocity ? ` (${data.raw_velocity})` : ""}`);
    if (data.active_notes) { lightKeys(data.active_notes); showChord(data.active_notes, data.active_note_names || []); }
  });
  LW.on("nash-key", () => { const m = S().midi; if (m) showChord(m.active_notes, m.active_note_names); });
})(window);
