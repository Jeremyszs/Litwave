// Litwave desktop/midi — extracted verbatim from index.html (see README section 2). Plain classic script, global scope, no modules.
    // Ear Training Modal Handlers
    let activeLyricsSheet = [];
    let activeLyricIndex = -1;

    function renderLyricsSheet(sheet) {
      activeLyricsSheet = sheet || [];
      const container = document.getElementById("lyricsContainer");
      if (!container) return;

      if (!activeLyricsSheet || activeLyricsSheet.length === 0) {
        container.innerHTML = `
          <div style="color: var(--text-faint); font-size: 11px; text-align: center; margin-top: 36px;">
            No lyrics found for this track. Song chords will continue updating live on the right.
          </div>
        `;
        return;
      }

      container.innerHTML = "";
      activeLyricsSheet.forEach((row, idx) => {
        const lineDiv = document.createElement("div");
        lineDiv.className = "lyric-line-row";
        lineDiv.id = `lyricLine_${idx}`;
        lineDiv.style.padding = "3px 8px";
        lineDiv.style.borderRadius = "4px";
        lineDiv.style.cursor = "pointer";
        lineDiv.style.transition = "all 0.15s ease";
        lineDiv.onclick = () => seekToSongTime(row.time);

        lineDiv.innerHTML = `
          <div class="lyric-text" style="font-size: 13px; font-weight: 500; color: var(--text-dim); line-height: 1.4;">
            ${row.text}
          </div>
        `;
        container.appendChild(lineDiv);
      });
    }

    // Music Theory Chord Voicing Spellings
    const CHORD_SPELLINGS = {
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
      "B": ["B", "D#", "F#"], "Bm": ["B", "D", "F#"], "B7": ["B", "D#", "F#", "A"], "BMaj7": ["B", "D#", "F#", "A#"], "Bm7": ["B", "D", "F#", "A"], "Bsus4": ["B", "E", "F#"]
    };

    function getChordNotes(chordName) {
      if (!chordName || chordName === "--") return [];
      const clean = chordName.split("/")[0].trim();
      if (CHORD_SPELLINGS[clean]) return CHORD_SPELLINGS[clean];
      // Basic root lookup fallback
      const root = clean.length > 1 && (clean[1] === "#" || clean[1] === "b") ? clean.slice(0, 2) : clean.slice(0, 1);
      return [root];
    }
    function calculateVoiceLeading(fromChord, toChord) {
      if (!fromChord || !toChord || fromChord === "--" || toChord === "--") return "Smooth step";
      const notes1 = getChordNotes(fromChord);
      const notes2 = getChordNotes(toChord);
      const common = notes1.filter(n => notes2.includes(n));
      if (common.length > 0) {
        return `Hold [${common.join(", ")}]`;
      }
      return `Step ${fromChord} to ${toChord}`;
    }

    let selectedVoicingExt = "root"; // "root", "inv1", "inv2", "ext1", "ext2"
    let currentVoicingChord = "";

    function selectVoicingExtension(extType) {
      selectedVoicingExt = extType;
      ['root', 'inv1', 'inv2', 'ext1', 'ext2'].forEach(k => {
        const b = document.getElementById(`extBtn_${k}`);
        if (b) b.classList.toggle("btn-active", k === extType);
      });
      refreshVoicingVisualizer();
    }
    function getExtendedVoicing(chordName, extType) {
      if (!chordName || chordName === "--") return { name: "--", notes: [], formula: "None" };
      const root = chordName.length > 1 && (chordName[1] === "#" || chordName[1] === "b") ? chordName.slice(0, 2) : chordName.slice(0, 1);
      const isMinor = chordName.includes("m") && !chordName.includes("maj") && !chordName.includes("Maj");
      const baseNotes = getChordNotes(chordName);

      if (extType === "root") {
        return {
          name: chordName,
          notes: baseNotes,
          formula: isMinor ? `Minor Triad [1 - b3 - 5]` : `Major Triad [1 - 3 - 5]`
        };
      } else if (extType === "inv1") {
        // 1st Inversion (3 in bass): e.g. [E, G, C]
        if (baseNotes.length >= 3) {
          const invNotes = [...baseNotes.slice(1), baseNotes[0]];
          return {
            name: `${chordName}/${baseNotes[1]}`,
            notes: invNotes,
            formula: `1st Inversion [3 - 5 - 1]`
          };
        }
        return { name: chordName, notes: baseNotes, formula: "1st Inversion" };
      } else if (extType === "inv2") {
        // 2nd Inversion (5 in bass): e.g. [G, C, E]
        if (baseNotes.length >= 3) {
          const invNotes = [...baseNotes.slice(2), ...baseNotes.slice(0, 2)];
          return {
            name: `${chordName}/${baseNotes[2]}`,
            notes: invNotes,
            formula: `2nd Inversion [5 - 1 - 3]`
          };
        }
        return { name: chordName, notes: baseNotes, formula: "2nd Inversion" };
      } else if (extType === "ext1") {
        // 7th extension
        const chord7 = isMinor ? `${root}m7` : `${root}Maj7`;
        const notes = getChordNotes(chord7);
        return {
          name: chord7,
          notes: notes.length > 0 ? notes : baseNotes,
          formula: isMinor ? `Minor 7th [1 - b3 - 5 - b7]` : `Major 7th [1 - 3 - 5 - 7]`
        };
      } else {
        // 9th or Add9 extension
        const chord9 = isMinor ? `${root}m9` : `${root}add9`;
        let notes = isMinor ? getChordNotes(`${root}m7`) : getChordNotes(root);
        // Compute 9th pitch (2 semitones above root)
        const noteScale = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
        const normRoot = root.replace("Db", "C#").replace("Eb", "D#").replace("Gb", "F#").replace("Ab", "G#").replace("Bb", "A#");
        const rIdx = noteScale.indexOf(normRoot);
        const nineth = rIdx >= 0 ? noteScale[(rIdx + 2) % 12] : "D";
        const combined = [...new Set([...notes, nineth])];
        return {
          name: chord9,
          notes: combined,
          formula: isMinor ? `Minor 9th [1 - b3 - 5 - b7 - 9]` : `Add9 Voicing [1 - 3 - 5 - 9]`
        };
      }
    }
    async function auditionCurrentVoicing() {
      const chord = currentVoicingChord || "C";
      const v = getExtendedVoicing(chord, selectedVoicingExt);
      const notes = v.notes && v.notes.length > 0 ? v.notes : getChordNotes(chord);
      if (!notes || notes.length === 0) return;

      const btn = document.getElementById("auditionVoicingBtn");
      if (btn) {
        btn.classList.add("btn-active");
        setTimeout(() => btn.classList.remove("btn-active"), 800);
      }

      try {
        await fetch("/api/montage/audition", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chord: chord, notes: notes })
        });
      } catch (e) {
        console.error("Failed to audition voicing:", e);
      }
    }
    function renderMiniVoicingPiano(notes) {
      const svg = document.getElementById("miniVoicingPianoSvg");
      if (!svg) return;
      
      const whiteKeys = ["C", "D", "E", "F", "G", "A", "B", "C", "D", "E", "F", "G", "A", "B"];
      const blackKeys = [
        { note: "C#", pos: 0.7 }, { note: "D#", pos: 1.7 },
        { note: "F#", pos: 3.7 }, { note: "G#", pos: 4.7 }, { note: "A#", pos: 5.7 },
        { note: "C#", pos: 7.7 }, { note: "D#", pos: 8.7 },
        { note: "F#", pos: 10.7 }, { note: "G#", pos: 11.7 }, { note: "A#", pos: 12.7 }
      ];

      const normNotes = (notes || []).map(n => n.replace("Db", "C#").replace("Eb", "D#").replace("Gb", "F#").replace("Ab", "G#").replace("Bb", "A#"));
      const keyWidth = 12;

      let html = "";
      // Render White keys (14 keys = 2 octaves)
      whiteKeys.forEach((wk, i) => {
        const isHeld = normNotes.includes(wk);
        const fill = isHeld ? "var(--accent)" : "#16191f";
        const stroke = "#0b0d11";
        html += `<rect x="${i * keyWidth}" y="0" width="${keyWidth - 1}" height="44" fill="${fill}" stroke="${stroke}" stroke-width="1" rx="1" />`;
        if (isHeld) {
          // Add touch marker dot for clean readability
          html += `<circle cx="${i * keyWidth + (keyWidth - 1) / 2}" cy="36" r="2.5" fill="#ffffff" />`;
        }
      });

      // Render Black keys
      blackKeys.forEach(bk => {
        const isHeld = normNotes.includes(bk.note);
        const fill = isHeld ? "#ffffff" : "#0a0c0f";
        const stroke = isHeld ? "var(--accent)" : "#1e222a";
        html += `<rect x="${bk.pos * keyWidth}" y="0" width="7" height="26" fill="${fill}" stroke="${stroke}" stroke-width="1" rx="1" />`;
        if (isHeld) {
          html += `<circle cx="${bk.pos * keyWidth + 3.5}" cy="20" r="2" fill="var(--accent)" />`;
        }
      });

      svg.innerHTML = html;
    }
    function refreshVoicingVisualizer() {
      if (!currentVoicingChord || currentVoicingChord === "--") {
        document.getElementById("voicingFormulaText").innerText = "Root Position [1 - 3 - 5]";
        document.getElementById("voicingNotesList").innerText = "--";
        renderMiniVoicingPiano([]);
        return;
      }
      const v = getExtendedVoicing(currentVoicingChord, selectedVoicingExt);
      document.getElementById("voicingFormulaText").innerText = `${v.name}: ${v.formula}`;
      document.getElementById("voicingNotesList").innerText = v.notes.join(" - ");
      renderMiniVoicingPiano(v.notes);
    }
    function updateSongChordTracker(currentSeconds) {
      const curNameEl = document.getElementById("liveSongCurrentChord");
      const curNashEl = document.getElementById("liveSongCurrentNash");
      const curTimeEl = document.getElementById("currentChordTimecode");
      const curNotesEl = document.getElementById("currentVoicingNotes");
      const nextNameEl = document.getElementById("liveSongNextChord");
      const nextCdEl = document.getElementById("liveSongNextCountdown");
      const leadTipEl = document.getElementById("voiceLeadingTip");
      const grid = document.getElementById("harmonicMeasureGrid");
      const clearCurrent = () => {
        if (currentVoicingChord !== "") {
          currentVoicingChord = "";
          refreshVoicingVisualizer();
        }
        if (curNameEl) curNameEl.innerText = "--";
        if (curNashEl) curNashEl.innerText = "";
        if (curTimeEl) curTimeEl.innerText = formatTime(currentSeconds);
        if (curNotesEl) curNotesEl.innerText = "--";
      };

      const renderGridPlaceholders = () => {
        if (!grid) return;
        let html = "";
        for (let b = 1; b <= 4; b++) {
          html += `
            <div class="measure-bar-cell" style="background: var(--bg-sunken); border: 1px dashed var(--border-subtle); padding: 4px 6px; border-radius: 4px; text-align: center; display: flex; flex-direction: column; justify-content: space-between; opacity: 0.5;">
              <div style="font-size: 8px; font-weight: 700; color: var(--text-faint); font-family: var(--font-mono);">BAR ${b}</div>
              <div style="font-size: 14px; font-weight: 800; color: var(--text-faint); font-family: var(--font-mono); margin: 2px 0;">--</div>
              <div style="font-size: 8px; font-family: var(--font-mono); color: var(--text-faint);">-</div>
              <div style="font-size: 8px; font-family: var(--font-mono); color: var(--text-faint); margin-top: 2px;">--:--</div>
            </div>
          `;
        }
        grid.innerHTML = html;
      };

      if (!activeChordChart || activeChordChart.length === 0) {
        clearCurrent();
        if (nextNameEl) nextNameEl.innerText = "--";
        if (nextCdEl) nextCdEl.innerText = "--";
        if (leadTipEl) leadTipEl.innerText = "No chord analysis";
        renderGridPlaceholders();
        return;
      }

      const rawChord = ChordTimeline.chordAtTime(activeChordChart, currentSeconds);
      const curChord = ChordTimeline.playableChord(rawChord);
      if (curChord) {
        if (curChord.chord !== currentVoicingChord) {
          currentVoicingChord = curChord.chord;
          refreshVoicingVisualizer();
        }
        if (curNameEl) curNameEl.innerText = curChord.chord;
        if (curNashEl) curNashEl.innerText = curChord.nashville && curChord.nashville !== "-" ? `[${curChord.nashville}]` : "";
        if (curTimeEl) curTimeEl.innerText = formatTime(curChord.time);
        if (curNotesEl) {
          const notes = getChordNotes(curChord.chord);
          curNotesEl.innerHTML = notes.map(n => `<span style="background: rgba(56, 189, 248, 0.15); padding: 1px 4px; border-radius: 2px;">${n}</span>`).join("");
        }
      } else {
        clearCurrent();
      }

      const nextChord = ChordTimeline.nextPlayableChord(activeChordChart, currentSeconds);
      if (nextChord) {
        const diff = (nextChord.time - currentSeconds).toFixed(1);
        if (nextNameEl) nextNameEl.innerText = nextChord.chord;
        if (nextCdEl) nextCdEl.innerText = `in ${diff}s`;
        if (leadTipEl) leadTipEl.innerText = curChord ? calculateVoiceLeading(curChord.chord, nextChord.chord) : "Waiting for harmony";
      } else {
        if (nextNameEl) nextNameEl.innerText = "--";
        if (nextCdEl) nextCdEl.innerText = "--";
        if (leadTipEl) leadTipEl.innerText = "End of track";
      }

      // Render the next four playable chord events; this is not a detected bar grid.
      if (grid) {
        const playable = activeChordChart.filter(ChordTimeline.playableChord);
        const gridStart = curChord ? playable.indexOf(curChord) : playable.findIndex(c => c.time > currentSeconds);
        if (gridStart < 0) {
          renderGridPlaceholders();
          return;
        }
        const barChords = playable.slice(gridStart, gridStart + 4);
        let html = "";
        for (let b = 0; b < 4; b++) {
          const item = barChords[b];
          const isNow = (b === 0);
          const isNext = (b === 1);
          const bg = isNow ? "rgba(56, 189, 248, 0.15)" : (isNext ? "rgba(56, 189, 248, 0.08)" : "var(--bg-sunken)");
          const border = isNow ? "var(--accent)" : (isNext ? "rgba(56, 189, 248, 0.4)" : "var(--border-subtle)");
          const title = isNow ? "NOW" : (isNext ? "NEXT" : `BAR +${b}`);
          const cText = item ? item.chord : "--";
          const nash = item && item.nashville ? `[${item.nashville}]` : "";
          const tCode = item ? formatTime(item.time) : "--:--";

          html += `
            <div class="measure-bar-cell" style="background: ${bg}; border: 1px solid ${border}; padding: 4px 6px; border-radius: 4px; text-align: center; display: flex; flex-direction: column; justify-content: space-between;">
              <div style="font-size: 8px; font-weight: 700; color: ${isNow ? 'var(--accent)' : 'var(--text-faint)'}; font-family: var(--font-mono);">${title}</div>
              <div style="font-size: 14px; font-weight: 800; color: ${isNow ? '#ffffff' : (item ? 'var(--text-main)' : 'var(--text-faint)')}; font-family: var(--font-mono); margin: 2px 0;">${cText}</div>
              <div style="font-size: 8px; font-family: var(--font-mono); color: var(--accent-secondary);">${nash}</div>
              <div style="font-size: 8px; font-family: var(--font-mono); color: var(--text-faint); margin-top: 2px;">${tCode}</div>
            </div>
          `;
        }
        grid.innerHTML = html;
      }
    }

    let lyricsFollowEnabled = false;
    let lyricsFontSize = 13;

    function changeLyricsFontSize(delta) {
      lyricsFontSize = Math.max(10, Math.min(24, lyricsFontSize + delta));
      const txt = document.getElementById("lyricsFontSizeText");
      if (txt) txt.innerText = `${lyricsFontSize}px`;
      const lines = document.querySelectorAll("#lyricsContainer .lyric-text");
      lines.forEach(l => l.style.fontSize = `${lyricsFontSize}px`);
    }
    function toggleLyricsFollow() {
      lyricsFollowEnabled = !lyricsFollowEnabled;
      const btn = document.getElementById("toggleLyricsFollowBtn");
      if (btn) {
        btn.innerText = lyricsFollowEnabled ? "Follow: On" : "Follow: Off";
        btn.classList.toggle("btn-active", lyricsFollowEnabled);
      }
      if (lyricsFollowEnabled && activeLyricIndex >= 0) {
        scrollToActiveLyricLine();
      }
    }
    function updateLyricsHighlight(currentSeconds) {
      if (!activeLyricsSheet || activeLyricsSheet.length === 0) return;

      let currentIndex = -1;
      // Precision matching against official synchronized timestamps
      for (let i = 0; i < activeLyricsSheet.length; i++) {
        const nextTime = (i + 1 < activeLyricsSheet.length) ? activeLyricsSheet[i + 1].time : 999999.0;
        if (currentSeconds >= activeLyricsSheet[i].time && currentSeconds < nextTime) {
          currentIndex = i;
          break;
        }
      }

      if (currentIndex !== activeLyricIndex && currentIndex !== -1) {
        if (activeLyricIndex >= 0) {
          const prevEl = document.getElementById(`lyricLine_${activeLyricIndex}`);
          if (prevEl) {
            prevEl.style.background = "transparent";
            prevEl.style.borderLeft = "none";
            const textEl = prevEl.querySelector(".lyric-text");
            if (textEl) {
              textEl.style.color = "var(--text-dim)";
              textEl.style.fontWeight = "500";
            }
          }
        }

        activeLyricIndex = currentIndex;

        if (activeLyricIndex >= 0) {
          const curEl = document.getElementById(`lyricLine_${activeLyricIndex}`);
          if (curEl) {
            curEl.style.background = "rgba(56, 189, 248, 0.12)";
            curEl.style.borderLeft = "3px solid var(--accent)";
            const textEl = curEl.querySelector(".lyric-text");
            if (textEl) {
              textEl.style.color = "#ffffff";
              textEl.style.fontWeight = "700";
            }
            // Auto scroll container smoothly ONLY if user enabled Follow mode
            if (lyricsFollowEnabled) {
              const container = document.getElementById("lyricsContainer");
              if (container) {
                const topPos = curEl.offsetTop - container.offsetTop - 60;
                container.scrollTo({ top: Math.max(0, topPos), behavior: "smooth" });
              }
            }
          }
        }
      }
    }
    function scrollToActiveLyricLine() {
      if (activeLyricIndex >= 0) {
        const curEl = document.getElementById(`lyricLine_${activeLyricIndex}`);
        if (curEl) curEl.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }
    function buildPiano() {
      const container = document.getElementById("pianoWrapper");
      container.innerHTML = "";
      const isBlack = [false, true, false, true, false, false, true, false, true, false, true, false];

      // Count total white keys between START_KEY (21 = A0) and END_KEY (108 = C8)
      let whiteKeyCount = 0;
      for (let n = START_KEY; n <= END_KEY; n++) {
        if (!isBlack[n % 12]) whiteKeyCount++;
      }

      const whiteWidthPct = 100 / whiteKeyCount;
      const blackWidthPct = whiteWidthPct * 0.65;

      let currentWhiteIdx = 0;
      // Pass 1: Render all white keys firmly anchored in the DOM
      for (let note = START_KEY; note <= END_KEY; note++) {
        if (!isBlack[note % 12]) {
          const key = document.createElement("div");
          key.className = "piano-white-key";
          key.id = `key-${note}`;
          key.style.left = `${currentWhiteIdx * whiteWidthPct}%`;
          key.style.width = `${whiteWidthPct}%`;
          container.appendChild(key);
          currentWhiteIdx++;
        }
      }

      // Pass 2: Position black keys centered on the boundaries between white keys
      currentWhiteIdx = 0;
      for (let note = START_KEY; note <= END_KEY; note++) {
        if (isBlack[note % 12]) {
          const key = document.createElement("div");
          key.className = "piano-black-key";
          key.id = `key-${note}`;
          // Center black key over boundary of currentWhiteIdx
          const centerPos = currentWhiteIdx * whiteWidthPct;
          key.style.left = `${centerPos - (blackWidthPct / 2)}%`;
          key.style.width = `${blackWidthPct}%`;
          container.appendChild(key);
        } else {
          currentWhiteIdx++;
        }
      }
    }

    let userNashvilleKey = 'C';
    function onNashvilleKeyChange(val) {
      userNashvilleKey = val;
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

    // Nashville Number System Generator for Detected Chord against Key Center
    function getChordWithNashville(chordName, keyRootName = 'C') {
      if (!chordName || chordName === "--") return { chord: "--", nashville: "--" };
      const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
      const NASHVILLE_DEGREES = ['1', 'b2', '2', 'b3', '3', '4', '#4', '5', 'b6', '6', 'b7', '7'];
      
      const keyIdx = NAMES.indexOf(keyRootName);
      if (keyIdx === -1) return { chord: chordName, nashville: "" };

      // Parse root from chordName (e.g. "F#m7/C#" -> root "F#")
      const match = chordName.match(/^([A-G][#b]?)(.*)/);
      if (!match) return { chord: chordName, nashville: "" };

      const root = match[1];
      const suffix = match[2];
      const rootIdx = NAMES.indexOf(root);
      if (rootIdx === -1) return { chord: chordName, nashville: "" };

      const interval = (rootIdx - keyIdx + 12) % 12;
      const deg = NASHVILLE_DEGREES[interval];

      // Format clean Nashville notation
      let nash = deg;
      if (suffix.startsWith("m") && !suffix.startsWith("maj")) {
        nash += "-"; // Nashville minor designation
      } else if (suffix.includes("dim")) {
        nash += "°";
      } else if (suffix.includes("sus")) {
        nash += "sus";
      } else if (suffix.includes("7") && !suffix.includes("Maj7")) {
        nash += "7";
      }

      return { chord: chordName, nashville: `[${nash}]` };
    }
    function handleLiveMidiEvent(data) {
      if (data.type === "note_on") {
        const velInfo = data.raw_velocity ? `VEL ${data.velocity} (${data.raw_velocity})` : `VEL ${data.velocity}`;
        document.getElementById("lastNoteDisplay").innerText = `NOTE ${data.note_name} · ${velInfo}`;
      }
      if (data.active_notes) {
        const cName = detectAdvancedChord(data.active_notes);
        const nashObj = getChordWithNashville(cName, userNashvilleKey);
        document.getElementById("chordNameDisplay").innerText = cName;
        document.getElementById("chordNashvilleDisplay").innerText = nashObj.nashville;
        if (data.active_note_names && data.active_note_names.length > 0) {
          document.getElementById("chordNotesDisplay").innerText = data.active_note_names.join(" ");
        } else {
          document.getElementById("chordNotesDisplay").innerText = "READY";
        }
        const container = document.getElementById("pianoWrapper");
        if (container) {
          const currentActives = container.querySelectorAll(".active");
          currentActives.forEach(el => el.classList.remove("active"));
          data.active_notes.forEach(note => {
            const el = document.getElementById(`key-${note}`);
            if (el) el.classList.add("active");
          });
        }
      }
    }
    async function loadDevices(prefetchedData = null) {
      let data = prefetchedData;
      if (!data) {
        try {
          const res = await fetch("/api/status");
          data = await res.json();
        } catch (e) {
          return;
        }
      }
      if (!data || !data.devices) return;

      const prefAudioSelect = document.getElementById("prefAudioSelect");
      if (prefAudioSelect) {
        const currentSelected = prefAudioSelect.value;
        prefAudioSelect.innerHTML = "";
        data.devices.audio_outputs.forEach(d => {
          const opt = document.createElement("option");
          opt.value = d.id;
          opt.innerText = `${d.is_asio ? "[ASIO] " : ""}${d.name} (${d.hostapi})`;
          if (data.audio && d.id === data.audio.device_id) opt.selected = true;
          else if (!data.audio && String(d.id) === String(currentSelected)) opt.selected = true;
          prefAudioSelect.appendChild(opt);
        });
      }

      const prefMidiSelect = document.getElementById("prefMidiSelect");
      if (prefMidiSelect) {
        prefMidiSelect.innerHTML = "";
        if (!data.devices.midi_inputs || data.devices.midi_inputs.length === 0) {
          prefMidiSelect.innerHTML = "<option value=\"\">No MIDI Input Connected</option>";
        } else {
          data.devices.midi_inputs.forEach((port, idx) => {
            const opt = document.createElement("option");
            opt.value = port;
            opt.innerText = port;
            if (data.midi && port === data.midi.port_name) opt.selected = true;
            prefMidiSelect.appendChild(opt);
          });
        }
      }

      if (data.audio && data.audio.blocksize) {
        const bufSelect = document.getElementById("prefBufferSelect");
        if (bufSelect) bufSelect.value = data.audio.blocksize;
      }
    }
    async function changeAudioDevice(devId) {
      await fetch("/api/audio/device", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ device_id: parseInt(devId) })
      });
      loadDevices();
    }
    async function changeBufferSize(bs) {
      const res = await fetch("/api/status");
      const data = await res.json();
      await fetch("/api/audio/device", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ device_id: data.audio.device_id, blocksize: parseInt(bs) })
      });
    }
    async function changeMidiDevice(port) {
      if (!port) return;
      await fetch("/api/midi/device", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ port: port })
      });
      loadDevices();
    }
