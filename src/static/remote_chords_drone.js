// Litwave remote/chords — extracted verbatim from remote.html (see README section 2). Plain classic script, global scope, no modules.
    let g_lastRemoteDroneInteraction = 0;
    function onRemoteNashvilleKeyChange(val) {
      remoteNashvilleKey = val;
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

    // Advanced Chord Detection (Precision scoring & exact match with jazz extensions)
    function detectAdvancedChord(notes) {
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

    // Nashville Number System Generator for Detected Chord against Key Center
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

    const REMOTE_DRONE_KEYS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
    let g_rDroneState = { active: false, root: "C", volume: 95, cutoff: 68 };
    let g_stageCurrentPage = 1;

    const STAGE_PAGE_TITLES = {
      1: "STAGE: CHORDS & PAD",
      2: "STAGE: FX PADS",
      3: "STAGE: PART 1-8 FADERS",
      4: "STAGE: SONG MANAGER",
      5: "STAGE: MIXER"
    };

    function renderRemoteDroneRoots() {
      const grid = document.getElementById("stageDroneRoots");
      if (!grid) return;
      grid.innerHTML = REMOTE_DRONE_KEYS.map(k => `
        <button class="btn ${g_rDroneState.root === k ? 'btn-active' : ''}" 
                style="padding: 6px 2px; font-weight: 700; font-size: 11px; font-family: var(--font-mono); border: 1px solid ${g_rDroneState.root === k ? 'var(--accent)' : 'var(--border-dim)'};"
                onclick="selectDroneRootRemote('${k}')">
          ${k}
        </button>
      `).join("");
    }
    function syncRemoteDroneUI() {
      const dot = document.getElementById("rDroneDot");
      const stBtn = document.getElementById("stageDronePadToggleBtn");
      if (dot) dot.style.background = g_rDroneState.active ? "var(--success)" : "var(--text-muted)";
      if (stBtn) {
        stBtn.innerText = g_rDroneState.active ? `STOP (${g_rDroneState.root})` : "START";
        stBtn.className = g_rDroneState.active ? "btn btn-danger" : "btn btn-primary";
      }
      const vText = document.getElementById("rDroneVolText");
      const vSlider = document.getElementById("rDroneVolSlider");
      if (vText && vSlider) {
        vText.innerText = `${Math.round((g_rDroneState.volume / 127) * 100)}%`;
        vSlider.value = g_rDroneState.volume;
      }
      renderRemoteDroneRoots();
    }
    function changeDroneVoiceRemote(val) {
      const parts = val.split(":");
      const bank = parseInt(parts[0]);
      const preset = parseInt(parts[1]);
      fetch("/api/drone-pad", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "set_voice", bank: bank, preset: preset })
      }).catch(e => console.error("Remote drone voice error:", e));
    }
    function setDroneVolumeRemote(val) {
      g_lastRemoteDroneInteraction = performance.now();
      g_rDroneState.volume = parseInt(val);
      const vText = document.getElementById("rDroneVolText");
      if (vText) vText.innerText = `${Math.round((val / 127) * 100)}%`;
      fetch("/api/drone-pad", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "set_volume", volume: parseInt(val) })
      }).catch(() => {});
    }
    async function toggleDroneActiveRemote() {
      g_lastRemoteDroneInteraction = performance.now();
      const action = g_rDroneState.active ? "stop" : "start";
      try {
        const res = await fetch("/api/drone-pad", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: action, root: g_rDroneState.root })
        });
        const data = await res.json();
        if (data.drone_pad) {
          g_rDroneState = data.drone_pad;
          syncRemoteDroneUI();
        }
      } catch (e) {
        console.error("Failed to toggle drone:", e);
      }
    }
    async function selectDroneRootRemote(k) {
      g_lastRemoteDroneInteraction = performance.now();
      g_rDroneState.root = k;
      renderRemoteDroneRoots();
      try {
        const res = await fetch("/api/drone-pad", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "set_root", root: k })
        });
        const data = await res.json();
        if (data.drone_pad) {
          g_rDroneState = data.drone_pad;
          syncRemoteDroneUI();
        }
      } catch (e) {
        console.error("Failed to set drone root:", e);
      }
    }
    function syncStageChordDisplays() {
      // Direct live mapping handled in telemetry
    }
