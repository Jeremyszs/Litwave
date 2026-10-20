/* Voicing recommendations: spellings, inversions/extensions, mini piano, audition on the sound engine. */
(function (root) {
  const LW = root.LW;
  const $ = (id) => document.getElementById(id);

  const SPELL = {
    "C": ["C", "E", "G"], "Cm": ["C", "Eb", "G"], "C7": ["C", "E", "G", "Bb"], "CMaj7": ["C", "E", "G", "B"], "Cm7": ["C", "Eb", "G", "Bb"],
    "C#": ["C#", "F", "G#"], "C#m": ["C#", "E", "G#"], "C#7": ["C#", "F", "G#", "B"], "C#Maj7": ["C#", "F", "G#", "C"], "C#m7": ["C#", "E", "G#", "B"],
    "D": ["D", "F#", "A"], "Dm": ["D", "F", "A"], "D7": ["D", "F#", "A", "C"], "DMaj7": ["D", "F#", "A", "C#"], "Dm7": ["D", "F", "A", "C"], "Dsus2": ["D", "E", "A"], "Dsus4": ["D", "G", "A"],
    "D#": ["Eb", "G", "Bb"], "D#m": ["Eb", "Gb", "Bb"], "Eb": ["Eb", "G", "Bb"], "Ebm": ["Eb", "Gb", "Bb"], "EbMaj7": ["Eb", "G", "Bb", "D"], "Ebm7": ["Eb", "Gb", "Bb", "Db"],
    "E": ["E", "G#", "B"], "Em": ["E", "G", "B"], "E7": ["E", "G#", "B", "D"], "EMaj7": ["E", "G#", "B", "D#"], "Em7": ["E", "G", "B", "D"], "Esus4": ["E", "A", "B"],
    "F": ["F", "A", "C"], "Fm": ["F", "Ab", "C"], "F7": ["F", "A", "C", "Eb"], "FMaj7": ["F", "A", "C", "E"], "Fm7": ["F", "Ab", "C", "Eb"],
    "F#": ["F#", "A#", "C#"], "F#m": ["F#", "A", "C#"], "F#7": ["F#", "A#", "C#", "E"], "F#Maj7": ["F#", "A#", "C#", "F"], "F#m7": ["F#", "A", "C#", "E"],
    "G": ["G", "B", "D"], "Gm": ["G", "Bb", "D"], "G7": ["G", "B", "D", "F"], "GMaj7": ["G", "B", "D", "F#"], "Gm7": ["G", "Bb", "D", "F"], "Gsus4": ["G", "C", "D"],
    "G#": ["Ab", "C", "Eb"], "G#m": ["G#", "B", "D#"], "G#Maj7": ["Ab", "C", "Eb", "G"], "G#m7": ["G#", "B", "D#", "F#"], "Ab": ["Ab", "C", "Eb"],
    "A": ["A", "C#", "E"], "Am": ["A", "C", "E"], "A7": ["A", "C#", "E", "G"], "AMaj7": ["A", "C#", "E", "G#"], "Am7": ["A", "C", "E", "G"], "Asus4": ["A", "D", "E"], "Amaj6": ["A", "C#", "E", "F#"],
    "A#": ["Bb", "D", "F"], "A#m": ["Bb", "Db", "F"], "Bb": ["Bb", "D", "F"], "Bbm": ["Bb", "Db", "F"], "BbMaj7": ["Bb", "D", "F", "A"], "Bbm7": ["Bb", "Db", "F", "Ab"], "A#Maj7": ["Bb", "D", "F", "A"],
    "B": ["B", "D#", "F#"], "Bm": ["B", "D", "F#"], "B7": ["B", "D#", "F#", "A"], "BMaj7": ["B", "D#", "F#", "A#"], "Bm7": ["B", "D", "F#", "A"], "Bsus4": ["B", "E", "F#"],
  };
  const SCALE = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const norm = (n) => n.replace("Db", "C#").replace("Eb", "D#").replace("Gb", "F#").replace("Ab", "G#").replace("Bb", "A#");
  const rootOf = (c) => (c.length > 1 && (c[1] === "#" || c[1] === "b") ? c.slice(0, 2) : c.slice(0, 1));

  function notesOf(chord) {
    if (!chord || chord === "--") return [];
    const clean = chord.split("/")[0].trim();
    return SPELL[clean] ? SPELL[clean].slice() : [rootOf(clean)];
  }

  function lead(from, to) {
    if (!from || !to || from === "--" || to === "--") return "Smooth step";
    const a = notesOf(from), b = notesOf(to);
    const common = a.filter((n) => b.includes(n));
    return common.length ? `Hold ${common.join(", ")}` : `Step ${from} → ${to}`;
  }

  function get(chord, ext) {
    if (!chord || chord === "--") return { name: "--", notes: [], formula: "None" };
    const r = rootOf(chord);
    const minor = chord.includes("m") && !chord.includes("maj") && !chord.includes("Maj");
    const base = notesOf(chord);
    if (ext === "inv1") {
      return base.length >= 3 ? { name: `${chord}/${base[1]}`, notes: [...base.slice(1), base[0]], formula: "1st inversion [3 - 5 - 1]" } : { name: chord, notes: base, formula: "1st inversion" };
    }
    if (ext === "inv2") {
      return base.length >= 3 ? { name: `${chord}/${base[2]}`, notes: [...base.slice(2), ...base.slice(0, 2)], formula: "2nd inversion [5 - 1 - 3]" } : { name: chord, notes: base, formula: "2nd inversion" };
    }
    if (ext === "ext1") {
      const c7 = minor ? `${r}m7` : `${r}Maj7`;
      const n = notesOf(c7);
      return { name: c7, notes: n.length > 1 ? n : base, formula: minor ? "Minor 7th [1 - b3 - 5 - b7]" : "Major 7th [1 - 3 - 5 - 7]" };
    }
    if (ext === "ext2") {
      const notes = minor ? notesOf(`${r}m7`) : notesOf(r);
      const i = SCALE.indexOf(norm(r));
      const ninth = i >= 0 ? SCALE[(i + 2) % 12] : "D";
      return { name: minor ? `${r}m9` : `${r}add9`, notes: [...new Set([...notes, ninth])], formula: minor ? "Minor 9th [1 - b3 - 5 - b7 - 9]" : "Add9 [1 - 3 - 5 - 9]" };
    }
    return { name: chord, notes: base, formula: minor ? "Minor triad [1 - b3 - 5]" : "Major triad [1 - 3 - 5]" };
  }

  let ext = "root", chord = "";

  function renderMini(notes) {
    const svg = $("miniPiano");
    if (!svg) return;
    const held = (notes || []).map(norm);
    const w = LW.token("--key-w", "#E8E8ED"), b = LW.token("--key-b", "#000"), acc = LW.token("--accent", "#0A84FF");
    const whites = ["C", "D", "E", "F", "G", "A", "B", "C", "D", "E", "F", "G", "A", "B"];
    const blacks = [["C#", 0.7], ["D#", 1.7], ["F#", 3.7], ["G#", 4.7], ["A#", 5.7], ["C#", 7.7], ["D#", 8.7], ["F#", 10.7], ["G#", 11.7], ["A#", 12.7]];
    let html = "";
    whites.forEach((k, i) => { html += `<rect x="${i * 12}" y="0" width="11" height="44" rx="1.5" fill="${held.includes(k) ? acc : w}"/>`; });
    blacks.forEach(([k, p]) => { html += `<rect x="${p * 12}" y="0" width="7" height="26" rx="1" fill="${held.includes(k) ? acc : b}"/>`; });
    svg.innerHTML = html; // generated from fixed key names and theme colours only
  }

  function refresh() {
    if (!$("voicingFormula")) return;
    if (!chord || chord === "--") {
      LW.setText($("voicingFormula"), "Root position [1 - 3 - 5]");
      LW.setText($("voicingNotes"), "--");
      renderMini([]);
      return;
    }
    const v = get(chord, ext);
    LW.setText($("voicingFormula"), `${v.name} · ${v.formula}`);
    LW.setText($("voicingNotes"), v.notes.join(" – "));
    renderMini(v.notes);
  }

  LW.voicing = {
    get, notesOf, lead,
    setChord(c) { if (c === chord) return; chord = c || ""; refresh(); },
    setExt(e) { ext = e; refresh(); },
    async audition() {
      const c = chord || "C";
      const v = get(c, ext);
      const notes = v.notes.length ? v.notes : notesOf(c);
      if (!notes.length) return;
      LW.alert({ icon: "play", title: `Audition ${v.name}`, sub: notes.join(" – ") }, 1300);
      try { await LW.api.post("/api/montage/audition", { chord: c, notes }); } catch (_) {}
    },
  };

  LW.on("ready", () => {
    LW.ui.tabs($("voicingSeg"), (i, k) => LW.voicing.setExt(k));
    $("btnAudition").addEventListener("click", () => LW.voicing.audition());
    LW.on("theme", refresh);
    refresh();
  });
})(window);
