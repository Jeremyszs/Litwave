(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else {
    root.ChordTimeline = api;
    // ponytail: top-level exports for backwards compatibility with inline scripts; namespace when adopting modules
    if (!root.CHORD_LIBRARY) root.CHORD_LIBRARY = api.CHORD_LIBRARY;
    if (!root.detectAdvancedChord) root.detectAdvancedChord = api.detectAdvancedChord;
    if (!root.getChordWithNashville) root.getChordWithNashville = api.getChordWithNashville;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  function chordEnd(chart, index) {
    const chord = chart[index];
    if (Number.isFinite(chord.end)) return chord.end;
    if (Number.isFinite(chord.duration)) return chord.time + chord.duration;
    return index + 1 < chart.length ? chart[index + 1].time : Infinity;
  }

  function chordAtTime(chart, seconds) {
    if (!Array.isArray(chart)) return null;
    for (let index = chart.length - 1; index >= 0; index -= 1) {
      const chord = chart[index];
      if (seconds >= chord.time && seconds < chordEnd(chart, index)) return chord;
    }
    return null;
  }

  function playableChord(chord) {
    return chord && chord.chord !== "N" && chord.chord !== "X" ? chord : null;
  }

  function nextPlayableChord(chart, seconds) {
    if (!Array.isArray(chart)) return null;
    return chart.find(chord => chord.time > seconds + Number.EPSILON && playableChord(chord)) || null;
  }

  const CHORD_LIBRARY = [
    // 13ths & Altered
    { name: '13',       intervals: [0, 4, 7, 10, 2, 9] },
    { name: 'Maj13',    intervals: [0, 4, 7, 11, 2, 9] },
    { name: 'm13',      intervals: [0, 3, 7, 10, 2, 9] },
    { name: '7#11',     intervals: [0, 4, 7, 10, 6] },
    { name: '7b13',     intervals: [0, 4, 7, 10, 8] },
    { name: '7b9',      intervals: [0, 4, 7, 10, 1] },
    { name: '7#9',      intervals: [0, 4, 10, 3] },

    // 11ths
    { name: 'm11',      intervals: [0, 3, 7, 10, 2, 5] },
    { name: '11',       intervals: [0, 4, 7, 10, 2, 5] },
    { name: 'Maj11',    intervals: [0, 4, 7, 11, 2, 5] },

    // 9ths & Add9
    { name: 'Maj9',     intervals: [0, 4, 7, 11, 2] },
    { name: 'm9',       intervals: [0, 3, 7, 10, 2] },
    { name: '9',        intervals: [0, 4, 7, 10, 2] },
    { name: '9sus4',    intervals: [0, 5, 7, 10, 2] },
    { name: '6/9',      intervals: [0, 4, 7, 9, 2] },
    { name: 'add9',     intervals: [0, 4, 7, 2] },
    { name: 'm(add9)',  intervals: [0, 3, 7, 2] },

    // 7ths
    { name: 'Maj7',     intervals: [0, 4, 7, 11] },
    { name: 'm7',       intervals: [0, 3, 7, 10] },
    { name: '7',        intervals: [0, 4, 7, 10] },
    { name: 'm(Maj7)',  intervals: [0, 3, 7, 11] },
    { name: 'm7b5',     intervals: [0, 3, 6, 10] },
    { name: 'dim7',     intervals: [0, 3, 6, 9] },
    { name: '7#5',      intervals: [0, 4, 8, 10] },
    { name: '7b5',      intervals: [0, 4, 6, 10] },
    { name: '7sus4',    intervals: [0, 5, 7, 10] },

    // 6ths & Suspended
    { name: '6',        intervals: [0, 4, 7, 9] },
    { name: 'm6',       intervals: [0, 3, 7, 9] },
    { name: 'sus4',     intervals: [0, 5, 7] },
    { name: 'sus2',     intervals: [0, 2, 7] },

    // Triads
    { name: '',         intervals: [0, 4, 7] },
    { name: 'm',        intervals: [0, 3, 7] },
    { name: 'dim',      intervals: [0, 3, 6] },
    { name: 'aug',      intervals: [0, 4, 8] },
    { name: '5',        intervals: [0, 7] }
  ];

  function detectAdvancedChord(notes) {
    // Require at least 3 detected MIDI key notes before chord formation to reduce latency on non-chord input.
    // Duplicate raw key entries count toward detected keys per input collection semantics, while unique pitches form harmonic intervals below.
    if (!notes || notes.length < 3) return "--";
    const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

    const sortedNotes = [...notes].sort((a, b) => a - b);
    const bassPitch = sortedNotes[0] % 12;
    const uniqueSemitones = [...new Set(notes.map(n => n % 12))];

    let candidates = [];

    for (const root of uniqueSemitones) {
      const presentIntervals = new Set(uniqueSemitones.map(p => (p - root + 12) % 12));

      for (const formula of CHORD_LIBRARY) {
        const fSet = new Set(formula.intervals);

        let matched = 0;
        for (const req of formula.intervals) {
          if (presentIntervals.has(req)) matched++;
        }

        let extra = 0;
        for (const p of presentIntervals) {
          if (!fSet.has(p)) extra++;
        }

        // Exact match
        if (extra === 0 && matched === formula.intervals.length) {
          candidates.push({
            name: NAMES[root] + formula.name,
            root: NAMES[root],
            rootIdx: root,
            isExact: true,
            matchedRatio: 1.0,
            notesCount: formula.intervals.length,
            isBassRoot: (root === bassPitch)
          });
        }
        // Omitted 5th in 7th/9th jazz voicings
        else if (extra === 0 && fSet.has(7) && !presentIntervals.has(7) && matched === (formula.intervals.length - 1) && formula.intervals.length >= 4) {
          candidates.push({
            name: NAMES[root] + formula.name,
            root: NAMES[root],
            rootIdx: root,
            isExact: false,
            matchedRatio: 0.95,
            notesCount: formula.intervals.length,
            isBassRoot: (root === bassPitch)
          });
        }
        // Near match
        else if (extra === 0 && matched >= 3 && (matched / formula.intervals.length) >= 0.75) {
          candidates.push({
            name: NAMES[root] + formula.name,
            root: NAMES[root],
            rootIdx: root,
            isExact: false,
            matchedRatio: matched / formula.intervals.length,
            notesCount: formula.intervals.length,
            isBassRoot: (root === bassPitch)
          });
        }
      }
    }

    if (candidates.length === 0) {
      return `${NAMES[bassPitch]} Poly`;
    }

    // Prioritize: Exact match -> Bass root -> Matched ratio -> Harmonic richness
    candidates.sort((a, b) => {
      if (a.isExact !== b.isExact) return a.isExact ? -1 : 1;
      if (a.isBassRoot !== b.isBassRoot) return a.isBassRoot ? -1 : 1;
      if (Math.abs(a.matchedRatio - b.matchedRatio) > 0.05) return b.matchedRatio - a.matchedRatio;
      return b.notesCount - a.notesCount;
    });

    const best = candidates[0];
    const slash = (best.rootIdx !== bassPitch) ? `/${NAMES[bassPitch]}` : "";
    return best.name + slash;
  }

  function getChordWithNashville(chordName, keyRootName = 'C') {
    if (!chordName || chordName === "--") return { chord: "--", nashville: "--" };
    const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    const NASHVILLE_DEGREES = ['1', 'b2', '2', 'b3', '3', '4', '#4', '5', 'b6', '6', 'b7', '7'];

    const keyIdx = NAMES.indexOf(keyRootName);
    if (keyIdx === -1) return { chord: chordName, nashville: "" };

    const match = chordName.match(/^([A-G][#b]?)(.*)/);
    if (!match) return { chord: chordName, nashville: "" };

    const root = match[1];
    const suffix = match[2];
    const rootIdx = NAMES.indexOf(root);
    if (rootIdx === -1) return { chord: chordName, nashville: "" };

    const interval = (rootIdx - keyIdx + 12) % 12;
    const deg = NASHVILLE_DEGREES[interval];

    let nash = deg;
    if (suffix.startsWith("m") && !suffix.startsWith("maj")) {
      nash += "-";
    } else if (suffix.includes("dim")) {
      nash += "°";
    } else if (suffix.includes("sus")) {
      nash += "sus";
    } else if (suffix.includes("7") && !suffix.includes("Maj7")) {
      nash += "7";
    }

    return { chord: chordName, nashville: `[${nash}]` };
  }

  return {
    chordEnd,
    chordAtTime,
    nextPlayableChord,
    playableChord,
    CHORD_LIBRARY,
    detectAdvancedChord,
    getChordWithNashville
  };
});
