// Litwave desktop/pads — extracted verbatim from index.html (see README section 2). Plain classic script, global scope, no modules.
    let currentEarModule = "chord_quality";
    let activeEarExercise = null;
    let earLocked = false;

    function openEarModal() {
      document.getElementById("earModal").style.display = "flex";
      loadEarExercise();
    }
    function closeEarModal() {
      document.getElementById("earModal").style.display = "none";
    }
    function setEarModule(mod) {
      currentEarModule = mod;
      ['chord', 'prog', 'mel', 'rel'].forEach(k => {
        const b = document.getElementById(`earTab_${k}`);
        if (b) b.classList.remove("btn-active");
      });
      if (mod === "chord_quality") document.getElementById("earTab_chord").classList.add("btn-active");
      else if (mod === "progression") document.getElementById("earTab_prog").classList.add("btn-active");
      else if (mod === "melodic_response") document.getElementById("earTab_mel").classList.add("btn-active");
      else if (mod === "relative_interval") document.getElementById("earTab_rel").classList.add("btn-active");
      loadEarExercise();
    }
    async function loadEarExercise() {
      earLocked = false;
      document.getElementById("earFeedbackText").innerText = "";
      const qText = document.getElementById("earQuestionText");
      qText.innerText = "Generating exercise in MONTAGE M...";
      const grid = document.getElementById("earChoicesGrid");
      grid.innerHTML = "";

      try {
        const res = await fetch("/api/ear-training", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "generate", module: currentEarModule })
        });
        const data = await res.json();
        if (data.exercise) {
          activeEarExercise = data.exercise;
          qText.innerText = data.exercise.question;
          updateEarScore(data.score);

          if (data.exercise.choices) {
            grid.innerHTML = data.exercise.choices.map(c => `
              <button class="btn" style="padding: 10px 12px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px;" onclick="submitEarAnswer('${c.id}')">
                <span style="font-weight: 600; font-size: 12px;">${c.label || c.nashville || c.id}</span>
                <span style="font-size: 10px; color: var(--text-dim); font-family: var(--font-mono);">${c.abbr || c.roman || c.deg || ''}</span>
              </button>
            `).join("");
          } else if (currentEarModule === "melodic_response") {
            grid.innerHTML = `
              <div style="grid-column: span 2; text-align: center; padding: 12px; font-size: 11px; color: var(--accent); display: flex; align-items: center; justify-content: center; gap: 6px;">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                <span>Listen to the lick, then play it on your CASIO keyboard keys!</span>
              </div>
            `;
          }
        }
      } catch (e) {
        qText.innerText = `Error: ${e}`;
      }
    }
    async function replayEarSound() {
      await fetch("/api/ear-training", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "replay" })
      });
    }
    async function submitEarAnswer(answerId) {
      if (earLocked) return;
      earLocked = true;
      try {
        const res = await fetch("/api/ear-training", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "check", answer: answerId })
        });
        const data = await res.json();
        const fb = document.getElementById("earFeedbackText");
        if (data.is_correct) {
          fb.innerHTML = `<span style="color: var(--success); font-weight: 600; display: inline-flex; align-items: center; gap: 4px;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> Correct! Excellent ear.</span>`;
          } else {
          fb.innerHTML = `<span style="color: var(--danger); font-weight: 600; display: inline-flex; align-items: center; gap: 4px;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg> Not quite. Correct answer: ${data.correct_answer}</span>`;
          }
        updateEarScore(data.score);
      } catch (e) {
        console.error("Failed to check answer:", e);
      }
    }
    function updateEarScore(score) {
      if (!score) return;
      document.getElementById("earScoreText").innerText = `Score: ${score.correct}/${score.total} (Streak: ${score.streak})`;
    }
    function nextEarExercise() {
      loadEarExercise();
    }


    // ==========================================
    // Continuous Worship Drone Pad Controller
    // ==========================================
    // ==========================================
    // Performance FX Pads Desktop State & Handlers
    // ==========================================
    // 8 Vivid Hardware MPC/SP-404 Style RGB Pad Colors (Index 0..7)
    const FX_PAD_PALETTE = [
      { bg: "linear-gradient(135deg, rgba(239, 68, 68, 0.25) 0%, rgba(185, 28, 28, 0.4) 100%)", border: "#ef4444", glow: "rgba(239, 68, 68, 0.4)" },     // 1: Red
      { bg: "linear-gradient(135deg, rgba(249, 115, 22, 0.25) 0%, rgba(194, 65, 12, 0.4) 100%)", border: "#f97316", glow: "rgba(249, 115, 22, 0.4)" },   // 2: Orange
      { bg: "linear-gradient(135deg, rgba(234, 179, 8, 0.25) 0%, rgba(161, 98, 7, 0.4) 100%)", border: "#eab308", glow: "rgba(234, 179, 8, 0.4)" },      // 3: Amber/Gold
      { bg: "linear-gradient(135deg, rgba(34, 197, 94, 0.25) 0%, rgba(21, 128, 61, 0.4) 100%)", border: "#22c55e", glow: "rgba(34, 197, 94, 0.4)" },     // 4: Green
      { bg: "linear-gradient(135deg, rgba(6, 182, 212, 0.25) 0%, rgba(14, 116, 144, 0.4) 100%)", border: "#06b6d4", glow: "rgba(6, 182, 212, 0.4)" },     // 5: Cyan
      { bg: "linear-gradient(135deg, rgba(59, 130, 246, 0.25) 0%, rgba(29, 78, 216, 0.4) 100%)", border: "#3b82f6", glow: "rgba(59, 130, 246, 0.4)" },     // 6: Blue
      { bg: "linear-gradient(135deg, rgba(168, 85, 247, 0.25) 0%, rgba(126, 34, 206, 0.4) 100%)", border: "#a855f7", glow: "rgba(168, 85, 247, 0.4)" },   // 7: Purple
      { bg: "linear-gradient(135deg, rgba(236, 72, 153, 0.25) 0%, rgba(190, 24, 93, 0.4) 100%)", border: "#ec4899", glow: "rgba(236, 72, 153, 0.4)" }     // 8: Pink / Magenta
    ];

    let g_fxPadsState = {
      bus_volume: 0.85,
      bus_muted: false,
      active_bank: "A",
      pad_indicators: {},
      pads: {}
    };
    let g_editingFxPadId = null;

    function toggleFxPadsModal() {
      const modal = document.getElementById("fxPadsModal");
      const isVisible = (modal.style.display === "flex");
      modal.style.display = isVisible ? "none" : "flex";
      if (!isVisible) {
        renderDesktopFxPads();
      }
    }
    function selectFxBank(bank) {
      g_fxPadsState.active_bank = bank;
      ["A", "B", "C", "D", "E", "F"].forEach(b => {
        const btn = document.getElementById(`fxBankBtn_${b}`);
        if (btn) btn.classList.toggle("btn-active", b === bank);
      });
      renderDesktopFxPads();
      fetch("/api/fx-pads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "bank", bank: bank })
      }).catch(() => {});
    }
    function triggerFxPad(padId, pressType = "press") {
      // Optimistic visual feedback immediately
      const padEl = document.getElementById(`dtFxPad_${padId}`);
      const p = g_fxPadsState.pads ? g_fxPadsState.pads[padId] : null;
      if (padEl && pressType === "press" && p) {
        const padColor = FX_PAD_PALETTE[p.pad_index % FX_PAD_PALETTE.length];
        padEl.style.background = padColor.border;
        padEl.style.boxShadow = `0 0 20px ${padColor.glow}`;
        setTimeout(() => {
          if (padEl) {
            padEl.style.background = padColor.bg;
            padEl.style.boxShadow = "none";
          }
        }, 140);
      }
      fetch("/api/fx-pads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "trigger", pad_id: padId, velocity: 127, press_type: pressType })
      }).catch(console.error);
    }
    function stopAllFxPads() {
      fetch("/api/fx-pads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "stop_all" })
      }).catch(console.error);
    }
    function renderDesktopFxPads() {
      const container = document.getElementById("desktopFxPadsGrid");
      if (!container) return;
      container.innerHTML = "";

      const activeBank = g_fxPadsState.active_bank || "A";
      const padList = Object.values(g_fxPadsState.pads || {}).filter(p => p.bank === activeBank);
      padList.sort((a, b) => a.pad_index - b.pad_index);

      padList.forEach(p => {
        const isPlaying = Boolean(g_fxPadsState.pad_indicators && g_fxPadsState.pad_indicators[p.id]);
        const modeBadge = p.trigger_mode !== 'oneshot' ? `<span style="font-size: 8px; color: var(--accent);">${p.trigger_mode.toUpperCase()}</span>` : '';
        const chokeBadge = p.choke_group > 0 ? `<span style="font-size: 8px; color: var(--accent-secondary);">CH${p.choke_group}</span>` : '';

        // Hardware color mapping by pad_index (0..7)
        const padColor = FX_PAD_PALETTE[p.pad_index % FX_PAD_PALETTE.length];

        const padDiv = document.createElement("div");
        padDiv.id = `dtFxPad_${p.id}`;
        padDiv.className = `fx-pad-btn ${isPlaying ? 'is-playing' : ''}`;
        padDiv.style.background = isPlaying ? padColor.border : padColor.bg;
        padDiv.style.border = `1px solid ${padColor.border}`;
        padDiv.style.borderRadius = "6px";
        padDiv.style.padding = "10px 8px";
        padDiv.style.display = "flex";
        padDiv.style.flexDirection = "column";
        padDiv.style.justifyContent = "space-between";
        padDiv.style.height = "76px";
        padDiv.style.cursor = "pointer";
        padDiv.style.userSelect = "none";
        padDiv.style.boxShadow = isPlaying ? `0 0 16px ${padColor.glow}` : "none";
        padDiv.style.transition = "all 0.1s ease";

        padDiv.innerHTML = `
          <div style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
            <span style="font-size: 9px; font-family: var(--font-mono); color: #ffffff; font-weight: 800; text-shadow: 0 1px 2px #000;">${p.bank}${p.pad_index + 1}</span>
            <div style="display: flex; gap: 4px; align-items: center;">
              ${modeBadge}
              ${chokeBadge}
              <button class="btn" style="padding: 1px 4px; font-size: 8px; background: rgba(0,0,0,0.5); border-color: rgba(255,255,255,0.2);" onclick="event.stopPropagation(); openFxPadEditor('${p.id}')" title="Configure and assign sound">Assign</button>
            </div>
          </div>
          <div style="font-size: 11px; font-weight: 800; color: #ffffff; text-align: center; line-height: 1.2; word-break: break-word; text-shadow: 0 1px 3px rgba(0,0,0,0.8);">
            ${p.name}
          </div>
          <div style="display: flex; justify-content: space-between; align-items: center; font-size: 9px; font-family: var(--font-mono); color: #e2e8f0; text-shadow: 0 1px 2px #000;">
            <span>VOL</span>
            <span>${p.volume}%</span>
          </div>
        `;

        // Support both mouse and touch
        padDiv.onmousedown = (e) => { e.preventDefault(); triggerFxPad(p.id, "press"); };
        padDiv.onmouseup = () => { triggerFxPad(p.id, "release"); };
        container.appendChild(padDiv);
      });
    }
    function openFxPadEditor(padId) {
      g_editingFxPadId = padId;
      const card = document.getElementById("fxPadEditorCard");
      const p = g_fxPadsState.pads[padId];
      if (!card || !p) return;
      card.style.display = "flex";
      document.getElementById("fxEditorTitle").innerText = `Configure & Assign Pad [${p.bank}${p.pad_index + 1}]`;
      document.getElementById("fxEditorName").value = p.name;
      document.getElementById("fxEditorMode").value = p.trigger_mode;
      document.getElementById("fxEditorChoke").value = p.choke_group;
      document.getElementById("fxEditorPitch").value = p.pitch;

      // Populate Sound Selector with all 48 factory voices grouped by category
      const soundSel = document.getElementById("fxEditorSoundSelect");
      if (soundSel && g_fxPadsState.sound_catalog) {
        let optHtml = "";
        const categories = {
          percussion: "Acoustic & Electronic Percussion",
          hits: "Impacts, Hits & 808 Bass Drops",
          transitions: "Whooshes, Risers & Sweeps",
          special: "Atmospheres, Swells & Vocal Chops"
        };
        for (const cat in categories) {
          optHtml += `<optgroup label="${categories[cat]}">`;
          for (const sid in g_fxPadsState.sound_catalog) {
            const sc = g_fxPadsState.sound_catalog[sid];
            if (sc.category === cat) {
              const sel = (p.sound_id === sid || p.sample_path === sc.sample_path) ? 'selected' : '';
              optHtml += `<option value="${sid}" ${sel}>${sc.name}</option>`;
            }
          }
          optHtml += `</optgroup>`;
        }
        soundSel.innerHTML = optHtml;
      }

      const spEl = document.getElementById("fxEditorSamplePath");
      if (spEl) spEl.innerText = p.sample_path ? p.sample_path.split(/[\\/]/).pop() : "None";
    }
    function assignFxPadSound(soundId) {
      if (!g_editingFxPadId || !g_fxPadsState.sound_catalog || !g_fxPadsState.sound_catalog[soundId]) return;
      const s_meta = g_fxPadsState.sound_catalog[soundId];
      const p = g_fxPadsState.pads[g_editingFxPadId];
      p.sound_id = soundId;
      p.name = s_meta.name;
      p.sample_path = s_meta.sample_path;
      p.category = s_meta.category;
      document.getElementById("fxEditorName").value = p.name;
      const spEl = document.getElementById("fxEditorSamplePath");
      if (spEl) spEl.innerText = s_meta.sample_path.split(/[\\/]/).pop();
      renderDesktopFxPads();
      fetch("/api/fx-pads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "update_pad", pad_id: g_editingFxPadId, sound_id: soundId })
      }).catch(console.error);
    }
    async function uploadCustomFxSample(inputEl) {
      if (!inputEl.files || !inputEl.files[0] || !g_editingFxPadId) return;
      const file = inputEl.files[0];
      const formData = new FormData();
      formData.append("file", file);
      formData.append("pad_id", g_editingFxPadId);

      try {
        showAppToast("Uploading custom sample...");
        const res = await fetch("/api/upload", {
          method: "POST",
          body: formData
        });
        const data = await res.json();
        if (data.success && data.filename) {
          const samplePath = `assets/fx-pads/custom/${data.filename}`;
          saveFxPadField("sample_path", samplePath);
          showAppToast(`Loaded ${data.filename} for ${g_editingFxPadId}`);
          const spEl = document.getElementById("fxEditorSamplePath");
          if (spEl) spEl.innerText = data.filename;
        }
      } catch (e) {
        showAppToast("Upload failed: " + e);
      }
      inputEl.value = "";
    }
    function closeFxPadEditor() {
      const card = document.getElementById("fxPadEditorCard");
      if (card) card.style.display = "none";
      g_editingFxPadId = null;
    }
    function saveFxPadField(field, val) {
      if (!g_editingFxPadId || !g_fxPadsState.pads[g_editingFxPadId]) return;
      g_fxPadsState.pads[g_editingFxPadId][field] = val;
      renderDesktopFxPads();
      fetch("/api/fx-pads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "update_pad", pad_id: g_editingFxPadId, [field]: val })
      }).catch(console.error);
    }

    const DRONE_ROOT_KEYS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
    let g_dronePadState = { active: false, root: "C", volume: 95, cutoff: 68 };
    let g_lastDroneUserInteraction = 0;

    function toggleDronePadModal() {
      const modal = document.getElementById("dronePadModal");
      const isVisible = (modal.style.display === "flex");
      modal.style.display = isVisible ? "none" : "flex";
      if (!isVisible) {
        renderDroneKeys();
        syncDroneModalUi();
      }
    }
    function renderDroneKeys() {
      const grid = document.getElementById("droneKeysGrid");
      if (!grid) return;
      grid.innerHTML = DRONE_ROOT_KEYS.map(k => {
        const isActive = (g_dronePadState.root === k);
        return `
          <button type="button" class="btn ${isActive ? 'btn-active' : ''}" 
                  style="padding: 8px 4px; font-weight: 700; font-size: 12px; font-family: var(--font-mono); border: 1px solid ${isActive ? 'var(--accent)' : 'var(--border-dim)'}; cursor: pointer;"
                  onclick="selectDroneRoot('${k}')">
            ${k}
          </button>
        `;
      }).join("");
    }
    function syncDroneModalUi() {
      const dot = document.getElementById("droneModalStatusDot");
      const btn = document.getElementById("dronePadToggleActionBtn");
      const label = document.getElementById("dronePadBtnLabel");
      const hdrBtn = document.getElementById("dronePadHeaderBtn");
      if (dot) dot.style.background = g_dronePadState.active ? "var(--success)" : "var(--text-muted)";
      if (btn) {
        btn.innerText = g_dronePadState.active ? `Stop Pad (${g_dronePadState.root})` : "Start Ambient Pad";
        btn.className = g_dronePadState.active ? "btn btn-danger" : "btn btn-primary";
      }
      if (hdrBtn) hdrBtn.classList.toggle("btn-active", g_dronePadState.active);
      if (label) label.innerText = g_dronePadState.active ? `Pad: ${g_dronePadState.root}` : "Drone Pad";

      const volVal = document.getElementById("droneVolValue");
      const volSlider = document.getElementById("droneVolSlider");
      if (volVal && volSlider) {
        volVal.innerText = `${Math.round((g_dronePadState.volume / 127) * 100)}%`;
        volSlider.value = g_dronePadState.volume;
      }

      const cutVal = document.getElementById("droneCutoffValue");
      const cutSlider = document.getElementById("droneCutoffSlider");
      if (cutVal && cutSlider) {
        cutVal.innerText = `${Math.round((g_dronePadState.cutoff / 127) * 100)}%`;
        cutSlider.value = g_dronePadState.cutoff;
      }
      renderDroneKeys();
    }
    async function toggleDroneActiveState() {
      g_lastDroneUserInteraction = performance.now();
      const action = g_dronePadState.active ? "stop" : "start";
      try {
        const res = await fetch("/api/drone-pad", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: action, root: g_dronePadState.root })
        });
        const data = await res.json();
        if (data.drone_pad) {
          g_dronePadState = data.drone_pad;
          syncDroneModalUi();
        }
      } catch (e) {
        console.error("Drone toggle failed:", e);
      }
    }
    async function selectDroneRoot(key) {
      g_lastDroneUserInteraction = performance.now();
      g_dronePadState.root = key;
      renderDroneKeys();
      const dot = document.getElementById("droneModalStatusDot");
      const btn = document.getElementById("dronePadToggleActionBtn");
      const label = document.getElementById("dronePadBtnLabel");
      if (btn && g_dronePadState.active) {
        btn.innerText = `Stop Pad (${key})`;
      }
      if (label && g_dronePadState.active) {
        label.innerText = `Pad: ${key}`;
      }
      try {
        const res = await fetch("/api/drone-pad", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "set_root", root: key })
        });
        const data = await res.json();
        if (data.drone_pad) {
          g_dronePadState = data.drone_pad;
          syncDroneModalUi();
        }
      } catch (e) {
        console.error("Drone root change failed:", e);
      }
    }
    function changeDroneVoice(val) {
      const parts = val.split(":");
      const bank = parseInt(parts[0]);
      const preset = parseInt(parts[1]);
      fetch("/api/drone-pad", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "set_voice", bank: bank, preset: preset })
      }).catch(e => console.error("Drone voice change error:", e));
    }
    async function setDroneVolume(val) {
      g_lastDroneUserInteraction = performance.now();
      g_dronePadState.volume = parseInt(val);
      document.getElementById("droneVolValue").innerText = `${Math.round((val / 127) * 100)}%`;
      fetch("/api/drone-pad", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "set_volume", volume: parseInt(val) })
      }).catch(e => console.error("Drone volume change error:", e));
    }
    async function setDroneCutoff(val) {
      g_lastDroneUserInteraction = performance.now();
      g_dronePadState.cutoff = parseInt(val);
      document.getElementById("droneCutoffValue").innerText = `${Math.round((val / 127) * 100)}%`;
      fetch("/api/drone-pad", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "set_cutoff", cutoff: parseInt(val) })
      }).catch(e => console.error("Drone cutoff change error:", e));
    }
