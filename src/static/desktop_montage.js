// Litwave desktop/montage — extracted verbatim from index.html (see README section 2). Plain classic script, global scope, no modules.
    // Parts Mixer Modal Handlers
    const desktopPartsState = [
      { part: 1, name: "Part 1", val: 100, rev: 40, mute: false, solo: false },
      { part: 2, name: "Part 2", val: 100, rev: 40, mute: false, solo: false },
      { part: 3, name: "Part 3", val: 90, rev: 40, mute: false, solo: false },
      { part: 4, name: "Part 4", val: 95, rev: 40, mute: false, solo: false },
      { part: 5, name: "Part 5", val: 105, rev: 40, mute: false, solo: false },
      { part: 6, name: "Part 6", val: 85, rev: 40, mute: false, solo: false },
      { part: 7, name: "Part 7", val: 100, rev: 40, mute: false, solo: false },
      { part: 8, name: "Part 8", val: 95, rev: 40, mute: false, solo: false }
    ];

    let desktopMasterTweakState = {
      cutoff: 64,
      resonance: 64,
      attack: 64,
      release: 64
    };

    async function onDesktopMasterTweakChange(type, val) {
      val = Math.max(0, Math.min(127, parseInt(val)));
      desktopMasterTweakState[type] = val;
      const typeCap = type.charAt(0).toUpperCase() + type.slice(1, 3);
      const valEl = document.getElementById(`dtMaster${typeCap}Val`);
      if (valEl) valEl.innerText = val;
      const pct = (val / 127) * 100;
      const fill = document.getElementById(`dtMaster${typeCap}Fill`);
      const thumb = document.getElementById(`dtMaster${typeCap}Thumb`);
      if (fill) fill.style.width = `${pct}%`;
      if (thumb) thumb.style.left = `${pct}%`;

      await fetch("/api/montage/volume", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ master_tweak: { [type]: val } })
      });
    }

    function startDesktopMasterTweakDrag(type, e) {
      const wrap = e.currentTarget;
      if (!wrap) return;
      const onMove = (ev) => {
        const rect = wrap.getBoundingClientRect();
        const ratio = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
        const val = Math.round(ratio * 127);
        onDesktopMasterTweakChange(type, val);
      };
      const onUp = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
      onMove(e);
      e.preventDefault();
    }

    function openPartsModal() {
      document.getElementById("partsModal").style.display = "flex";
      if (!window.g_voicesCatalog) {
        fetch("/api/montage/voices")
          .then(r => r.ok ? r.json() : [])
          .then(data => { window.g_voicesCatalog = data; renderDesktopParts(); })
          .catch(() => {});
      }
      renderDesktopParts();
    }
    function closePartsModal() {
      document.getElementById("partsModal").style.display = "none";
    }
    function renderDesktopParts() {
      const container = document.getElementById("desktopPartsGrid");
      if (!container) return;
      container.innerHTML = "";

      const isCommunity = (activeEngine === "community");
      const modalTitle = document.querySelector("#partsModal .modal-title");
      if (modalTitle) {
        modalTitle.innerText = isCommunity ? "Litwave Community SoundFont Parts 1–8 Mixer" : "Yamaha MONTAGE M Parts 1–8 Mixer";
      }

      desktopPartsState.forEach((p) => {
        const row = document.createElement("div");
        row.style.background = "var(--bg-panel)";
        row.style.border = "1px solid var(--border-dim)";
        row.style.borderRadius = "6px";
        row.style.padding = "10px 12px";
        row.style.display = "flex";
        row.style.flexDirection = "column";
        row.style.gap = "8px";

        const pctVol = ((p.val / 127) * 100).toFixed(1);
        const pctRev = (((p.rev || 40) / 127) * 100).toFixed(1);

        let voiceSelectorHtml = "";
        if (isCommunity) {
          let voiceOptions = `<option value="">-- Voice Preset --</option>`;
          if (window.g_voicesCatalog) {
            const cats = {};
            window.g_voicesCatalog.forEach(v => {
              if (!cats[v.category]) cats[v.category] = [];
              cats[v.category].push(v);
            });
            for (const c in cats) {
              voiceOptions += `<optgroup label="${c}">`;
              cats[c].forEach(v => {
                voiceOptions += `<option value="${v.bank}:${v.preset}:${v.name}">${v.name}</option>`;
              });
              voiceOptions += `</optgroup>`;
            }
          }
          voiceSelectorHtml = `
            <select class="modal-input" style="padding: 1px 4px; font-size: 10px; font-weight: 600; width: 140px; height: 22px; background: var(--bg-surface); border: 1px solid var(--border-dim); border-radius: 4px; color: var(--accent);" onchange="assignVoicePreset(${p.part}, this.value)" title="Switch Community soundfont voice">
              ${voiceOptions}
            </select>
          `;
        }

        row.innerHTML = `
          <div style="display: flex; align-items: center; justify-content: space-between;">
            <div style="display: flex; align-items: center; gap: 6px;">
              <input type="text" value="${p.name}" class="modal-input" style="padding: 2px 6px; font-size: 11px; font-weight: 600; width: ${isCommunity ? '100px' : '135px'}; height: 22px; background: var(--bg-sunken); border: 1px solid var(--border-dim); border-radius: 4px; color: var(--text-main);" onchange="renamePart(${p.part}, this.value)" title="Click to rename part">
              ${voiceSelectorHtml}
              <button class="btn ${p.mute ? 'btn-danger' : ''}" style="padding: 2px 7px; font-size: 10px; font-weight: 700; border-color: ${p.mute ? 'var(--danger)' : 'var(--border-subtle)'};" onclick="toggleDesktopMute(${p.part})">M</button>
              <button class="btn ${p.solo ? 'btn-active' : ''}" style="padding: 2px 7px; font-size: 10px; font-weight: 700; border-color: ${p.solo ? 'var(--accent)' : 'var(--border-subtle)'};" onclick="toggleDesktopSolo(${p.part})">S</button>
            </div>
            <div style="display: flex; align-items: center; gap: 10px; font-family: var(--font-mono); font-size: 10px;">
              <span id="dtPartVal_${p.part}" style="color: ${p.mute ? 'var(--text-faint)' : 'var(--accent)'};">Vol: ${p.val}</span>
              <span id="dtPartRev_${p.part}" style="color: var(--accent-secondary);">Rev: ${p.rev || 40}</span>
            </div>
          </div>

          <div style="display: flex; align-items: center; gap: 12px; opacity: ${p.mute ? '0.4' : '1.0'};">
            <span style="font-size: 10px; font-weight: 700; font-family: var(--font-mono); color: var(--text-main); width: 28px;">VOL</span>
            <div class="slider-rect-wrap" id="dtVolWrap_${p.part}" style="flex: 1; height: 20px;" onmousedown="startDesktopPartFaderDrag(${p.part}, 'vol', event)">
              <div class="slider-rect-fill" id="dtVolFill_${p.part}" style="width: ${pctVol}%;"></div>
              <div class="slider-rect-thumb" id="dtVolThumb_${p.part}" style="left: ${pctVol}%;"></div>
            </div>
          </div>

          <div style="display: flex; align-items: center; gap: 12px;">
            <span style="font-size: 10px; font-weight: 700; font-family: var(--font-mono); color: var(--text-main); width: 28px;">REV</span>
            <div class="slider-rect-wrap" id="dtRevWrap_${p.part}" style="flex: 1; height: 16px;" onmousedown="startDesktopPartFaderDrag(${p.part}, 'rev', event)">
              <div class="slider-rect-fill secondary" id="dtRevFill_${p.part}" style="width: ${pctRev}%;"></div>
              <div class="slider-rect-thumb" id="dtRevThumb_${p.part}" style="left: ${pctRev}%;"></div>
            </div>
          </div>

          <!-- Extended Sound Sculpting Controls (Point 2, 3, 4: Pan, Filter Cutoff/Resonance, Envelope Attack/Release, Chorus) -->
          <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; padding-top: 6px; border-top: 1px solid var(--border-subtle);">
            <div style="display: flex; flex-direction: column; gap: 2px;">
              <div style="display: flex; justify-content: space-between; font-size: 9px; font-weight: 700; font-family: var(--font-mono); color: var(--text-main);">
                <span>PAN</span><span id="dtPanVal_${p.part}" style="color: var(--accent);">${p.pan !== undefined ? p.pan : 64}</span>
              </div>
              <div class="slider-rect-wrap" style="height: 14px;" onmousedown="startDesktopParamDrag(${p.part}, 'pan', event)">
                <div class="slider-rect-fill" id="dtPanFill_${p.part}" style="width: ${(((p.pan !== undefined ? p.pan : 64) / 127) * 100).toFixed(1)}%;"></div>
                <div class="slider-rect-thumb" id="dtPanThumb_${p.part}" style="left: ${(((p.pan !== undefined ? p.pan : 64) / 127) * 100).toFixed(1)}%;"></div>
              </div>
            </div>

            <div style="display: flex; flex-direction: column; gap: 2px;">
              <div style="display: flex; justify-content: space-between; font-size: 9px; font-weight: 700; font-family: var(--font-mono); color: var(--text-main);">
                <span>CUTOFF</span><span id="dtCutVal_${p.part}" style="color: var(--accent);">${p.cutoff !== undefined ? p.cutoff : 64}</span>
              </div>
              <div class="slider-rect-wrap" style="height: 14px;" onmousedown="startDesktopParamDrag(${p.part}, 'cutoff', event)">
                <div class="slider-rect-fill" id="dtCutFill_${p.part}" style="width: ${(((p.cutoff !== undefined ? p.cutoff : 64) / 127) * 100).toFixed(1)}%;"></div>
                <div class="slider-rect-thumb" id="dtCutThumb_${p.part}" style="left: ${(((p.cutoff !== undefined ? p.cutoff : 64) / 127) * 100).toFixed(1)}%;"></div>
              </div>
            </div>

            <div style="display: flex; flex-direction: column; gap: 2px;">
              <div style="display: flex; justify-content: space-between; font-size: 9px; font-weight: 700; font-family: var(--font-mono); color: var(--text-main);">
                <span>RESON</span><span id="dtResVal_${p.part}" style="color: var(--accent);">${p.resonance !== undefined ? p.resonance : 64}</span>
              </div>
              <div class="slider-rect-wrap" style="height: 14px;" onmousedown="startDesktopParamDrag(${p.part}, 'resonance', event)">
                <div class="slider-rect-fill" id="dtResFill_${p.part}" style="width: ${(((p.resonance !== undefined ? p.resonance : 64) / 127) * 100).toFixed(1)}%;"></div>
                <div class="slider-rect-thumb" id="dtResThumb_${p.part}" style="left: ${(((p.resonance !== undefined ? p.resonance : 64) / 127) * 100).toFixed(1)}%;"></div>
              </div>
            </div>

            <div style="display: flex; flex-direction: column; gap: 2px;">
              <div style="display: flex; justify-content: space-between; font-size: 9px; font-weight: 700; font-family: var(--font-mono); color: var(--text-main);">
                <span>ATTACK</span><span id="dtAttVal_${p.part}" style="color: var(--accent);">${p.attack !== undefined ? p.attack : 64}</span>
              </div>
              <div class="slider-rect-wrap" style="height: 14px;" onmousedown="startDesktopParamDrag(${p.part}, 'attack', event)">
                <div class="slider-rect-fill" id="dtAttFill_${p.part}" style="width: ${(((p.attack !== undefined ? p.attack : 64) / 127) * 100).toFixed(1)}%;"></div>
                <div class="slider-rect-thumb" id="dtAttThumb_${p.part}" style="left: ${(((p.attack !== undefined ? p.attack : 64) / 127) * 100).toFixed(1)}%;"></div>
              </div>
            </div>

            <div style="display: flex; flex-direction: column; gap: 2px;">
              <div style="display: flex; justify-content: space-between; font-size: 9px; font-weight: 700; font-family: var(--font-mono); color: var(--text-main);">
                <span>RELEASE</span><span id="dtRelVal_${p.part}" style="color: var(--accent);">${p.release !== undefined ? p.release : 64}</span>
              </div>
              <div class="slider-rect-wrap" style="height: 14px;" onmousedown="startDesktopParamDrag(${p.part}, 'release', event)">
                <div class="slider-rect-fill" id="dtRelFill_${p.part}" style="width: ${(((p.release !== undefined ? p.release : 64) / 127) * 100).toFixed(1)}%;"></div>
                <div class="slider-rect-thumb" id="dtRelThumb_${p.part}" style="left: ${(((p.release !== undefined ? p.release : 64) / 127) * 100).toFixed(1)}%;"></div>
              </div>
            </div>

            <div style="display: flex; flex-direction: column; gap: 2px;">
              <div style="display: flex; justify-content: space-between; font-size: 9px; font-weight: 700; font-family: var(--font-mono); color: var(--text-main);">
                <span>CHORUS</span><span id="dtChoVal_${p.part}" style="color: var(--accent);">${p.chorus !== undefined ? p.chorus : 0}</span>
              </div>
              <div class="slider-rect-wrap" style="height: 14px;" onmousedown="startDesktopParamDrag(${p.part}, 'chorus', event)">
                <div class="slider-rect-fill secondary" id="dtChoFill_${p.part}" style="width: ${(((p.chorus !== undefined ? p.chorus : 0) / 127) * 100).toFixed(1)}%;"></div>
                <div class="slider-rect-thumb" id="dtChoThumb_${p.part}" style="left: ${(((p.chorus !== undefined ? p.chorus : 0) / 127) * 100).toFixed(1)}%;"></div>
              </div>
            </div>
          </div>
        `;
        container.appendChild(row);
      });
    }
    async function onDesktopVolChange(partNum, val) {
      desktopPartsState[partNum - 1].val = parseInt(val);
      const text = document.getElementById(`dtPartVal_${partNum}`);
      if (text) text.innerText = `Volume: ${val}`;
      const pct = (parseInt(val) / 127) * 100;
      const fill = document.getElementById(`dtVolFill_${partNum}`);
      const thumb = document.getElementById(`dtVolThumb_${partNum}`);
      if (fill) fill.style.width = `${pct}%`;
      if (thumb) thumb.style.left = `${pct}%`;
      await fetch("/api/montage/volume", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ part: partNum, volume: parseInt(val) })
      });
    }
    async function onDesktopRevChange(partNum, val) {
      desktopPartsState[partNum - 1].rev = parseInt(val);
      const text = document.getElementById(`dtPartRev_${partNum}`);
      if (text) text.innerText = `Reverb: ${val}`;
      const pct = (parseInt(val) / 127) * 100;
      const fill = document.getElementById(`dtRevFill_${partNum}`);
      const thumb = document.getElementById(`dtRevThumb_${partNum}`);
      if (fill) fill.style.width = `${pct}%`;
      if (thumb) thumb.style.left = `${pct}%`;
      await fetch("/api/montage/volume", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ part: partNum, reverb: parseInt(val) })
      });
    }
    async function renamePart(partNum, newName) {
      newName = (newName || `Part ${partNum}`).trim();
      desktopPartsState[partNum - 1].name = newName;
      await fetch("/api/montage/names", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parts: { [partNum]: newName } })
      });
    }
    async function onDesktopParamChange(partNum, paramType, val) {
      val = Math.max(0, Math.min(127, parseInt(val)));
      desktopPartsState[partNum - 1][paramType] = val;
      const text = document.getElementById(`dt${paramType.charAt(0).toUpperCase() + paramType.slice(1, 3)}Val_${partNum}`);
      if (text) text.innerText = val;
      const pct = (val / 127) * 100;
      const fill = document.getElementById(`dt${paramType.charAt(0).toUpperCase() + paramType.slice(1, 3)}Fill_${partNum}`);
      const thumb = document.getElementById(`dt${paramType.charAt(0).toUpperCase() + paramType.slice(1, 3)}Thumb_${partNum}`);
      if (fill) fill.style.width = `${pct}%`;
      if (thumb) thumb.style.left = `${pct}%`;

      await fetch("/api/montage/volume", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ part: partNum, tweak: { type: paramType, val: val } })
      });
    }
    function startDesktopParamDrag(partNum, paramType, e) {
      const pId = paramType.charAt(0).toUpperCase() + paramType.slice(1, 3);
      const wrap = e.currentTarget;
      if (!wrap) return;
      const onMove = (ev) => {
        const rect = wrap.getBoundingClientRect();
        const ratio = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
        const val = Math.round(ratio * 127);
        onDesktopParamChange(partNum, paramType, val);
      };
      const onUp = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
      onMove(e);
      e.preventDefault();
    }

    let g_activeDtPartDrag = null;

    function startDesktopPartFaderDrag(partNum, type, e) {
      const wrapId = type === 'vol' ? `dtVolWrap_${partNum}` : `dtRevWrap_${partNum}`;
      const wrap = document.getElementById(wrapId);
      if (!wrap) return;
      g_activeDtPartDrag = `${type}_${partNum}`;
      const onMove = (ev) => {
        const rect = wrap.getBoundingClientRect();
        const ratio = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
        const val = Math.round(ratio * 127);
        if (type === 'vol') onDesktopVolChange(partNum, val);
        else onDesktopRevChange(partNum, val);
      };
      const onUp = () => {
        g_activeDtPartDrag = null;
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
      onMove(e);
      e.preventDefault();
    }
    async function assignVoicePreset(partNum, val) {
      if (!val) return;
      const parts = val.split(":");
      const bank = parseInt(parts[0]);
      const preset = parseInt(parts[1]);
      const name = parts[2];
      try {
        const res = await fetch("/api/montage/assign_voice", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ part: partNum, bank: bank, preset: preset, name: name })
        });
        if (res.ok) {
          desktopPartsState[partNum - 1].name = name;
          renderDesktopParts();
          showAppToast(`Part ${partNum} assigned to ${name}`);
        }
      } catch(e) {
        console.error("Failed to assign voice:", e);
      }
    }

    // SoundFonts Manager Modal Handlers
    async function openSoundFontsModal() {
      const modal = document.getElementById("soundfontsModal");
      if (modal) modal.classList.add("modal-open");
      loadSoundFontsList();
    }
    function closeSoundFontsModal() {
      const modal = document.getElementById("soundfontsModal");
      if (modal) modal.classList.remove("modal-open");
    }
    async function loadSoundFontsList() {
      const container = document.getElementById("soundfontsListContainer");
      if (!container) return;
      container.innerHTML = `<div style="font-size: 11px; color: var(--text-dim); padding: 12px; text-align: center;">Loading soundbanks...</div>`;

      try {
        const res = await fetch("/api/montage/soundfonts");
        const data = await res.json();
        if (!data.soundfonts) return;

        let html = "";
        data.soundfonts.forEach(sf => {
          const statusBadge = sf.installed 
            ? `<span style="font-size: 9px; font-weight: 700; color: var(--success); background: rgba(34, 197, 94, 0.15); padding: 2px 6px; border-radius: 4px; border: 1px solid var(--success);">INSTALLED</span>`
            : `<span style="font-size: 9px; font-weight: 700; color: var(--text-dim); background: var(--bg-sunken); padding: 2px 6px; border-radius: 4px; border: 1px solid var(--border-dim);">OPTIONAL PACK</span>`;

          const actionBtn = sf.installed
            ? `<span style="font-size: 10px; color: var(--text-dim); font-family: var(--font-mono);">${sf.size_mb.toFixed(1)} MB</span>`
            : `<a href="https://github.com/Jeremyszs/Litwave/releases" target="_blank" class="btn btn-secondary" style="padding: 2px 8px; font-size: 10px; text-decoration: none; display: inline-flex; align-items: center; gap: 4px; border-color: var(--accent); color: var(--accent);">Get Pack (${sf.size_mb.toFixed(0)} MB)</a>`;

          html += `
            <div style="background: var(--bg-panel); border: 1px solid var(--border-dim); border-radius: 6px; padding: 10px 12px; display: flex; align-items: center; justify-content: space-between;">
              <div style="display: flex; flex-direction: column; gap: 2px;">
                <div style="display: flex; align-items: center; gap: 8px;">
                  <span style="font-size: 12px; font-weight: 700; color: var(--text-main);">${sf.name}</span>
                  ${statusBadge}
                </div>
                <div style="font-size: 10px; font-family: var(--font-mono); color: var(--text-dim);">${sf.filename}</div>
              </div>
              <div>${actionBtn}</div>
            </div>
          `;
        });
        container.innerHTML = html;
      } catch(e) {
        container.innerHTML = `<div style="font-size: 11px; color: var(--danger); padding: 12px;">Failed to load soundfonts list.</div>`;
      }
    }
    async function toggleDesktopMute(partNum) {
      const p = desktopPartsState[partNum - 1];
      const newMute = !p.mute;
      p.mute = newMute;
      renderDesktopParts();
      await fetch("/api/montage/volume", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ part: partNum, mute: newMute })
      });
    }
    async function toggleDesktopSolo(partNum) {
      const p = desktopPartsState[partNum - 1];
      p.solo = !p.solo;
      const res = await fetch("/api/montage/volume", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ part: partNum, solo: true })
      });
      const data = await res.json();
      if (data.solos) {
        for (let s = 1; s <= 8; s++) {
          desktopPartsState[s - 1].solo = Boolean(data.solos[s]);
          desktopPartsState[s - 1].mute = Boolean(data.mutes[s]);
        }
      }
      renderDesktopParts();
    }
    // Render Scene Selectors & Renameable Labels
    let activeScene = 1;
    let desktopSceneNames = { 1: "Scene 1", 2: "Scene 2", 3: "Scene 3", 4: "Scene 4", 5: "Scene 5", 6: "Scene 6", 7: "Scene 7", 8: "Scene 8" };
    function renderScenesUI() {
      const grid = document.getElementById("desktopScenesGrid");
      grid.innerHTML = "";
      for (let s = 1; s <= 8; s++) {
        const name = desktopSceneNames[s] || `Scene ${s}`;
        const btn = document.createElement("button");
        btn.className = `btn ${s === activeScene ? 'btn-active' : ''}`;
        btn.style.padding = "2px 4px";
        btn.style.fontSize = "9px";
        btn.style.fontWeight = "600";
        btn.style.overflow = "hidden";
        btn.style.textOverflow = "ellipsis";
        btn.style.whiteSpace = "nowrap";
        btn.innerText = name !== `Scene ${s}` ? `S${s}: ${name}` : `S${s}`;
        btn.title = `Scene ${s}: ${name}`;
        btn.id = `sceneBtn_${s}`;
        btn.onclick = () => selectScene(s);
        grid.appendChild(btn);
      }
    }

    let renamingSceneTarget = 1;
    function openRenameSceneModal(sceneNum) {
      renamingSceneTarget = sceneNum;
      const cur = desktopSceneNames[sceneNum] || `Scene ${sceneNum}`;
      document.getElementById("renameSceneModalTitle").innerText = `Rename Scene ${sceneNum}`;
      const inp = document.getElementById("renameSceneInput");
      inp.value = cur;
      document.getElementById("renameSceneModal").style.display = "flex";
      setTimeout(() => inp.focus(), 50);
    }
    function closeRenameSceneModal() {
      document.getElementById("renameSceneModal").style.display = "none";
    }
    async function confirmRenameScene() {
      const inp = document.getElementById("renameSceneInput");
      const newName = (inp.value.trim() || `Scene ${renamingSceneTarget}`).slice(0, 24);
      closeRenameSceneModal();
      desktopSceneNames[renamingSceneTarget] = newName;
      renderScenesUI();
      if (activeScene === renamingSceneTarget) {
        document.getElementById("activeSceneText").innerText = newName;
      }
      await fetch("/api/montage/names", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scenes: { [renamingSceneTarget]: newName } })
      });
    }
    async function selectScene(sceneNum) {
      activeScene = sceneNum;
      const sName = desktopSceneNames[sceneNum] || `Scene ${sceneNum}`;
      document.getElementById("activeSceneText").innerText = sName;
      for (let s = 1; s <= 8; s++) {
        const b = document.getElementById(`sceneBtn_${s}`);
        if (b) b.classList.toggle("btn-active", s === sceneNum);
      }
      renderScenesUI();
      try {
        const res = await fetch("/api/montage/scene", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "recall", scene: sceneNum })
        });
        const data = await res.json();
        if (data.snapshot && data.snapshot.parts) {
          for (const p in data.snapshot.parts) {
            const partIdx = parseInt(p) - 1;
            if (desktopPartsState[partIdx]) {
              const val = data.snapshot.parts[p];
              desktopPartsState[partIdx].val = val;
              const t = document.getElementById(`dtPartVal_${p}`);
              if (t) t.innerText = `Volume: ${val}`;
              const pct = ((val / 127) * 100).toFixed(1);
              const fill = document.getElementById(`dtVolFill_${p}`);
              const thumb = document.getElementById(`dtVolThumb_${p}`);
              if (fill) fill.style.width = `${pct}%`;
              if (thumb) thumb.style.left = `${pct}%`;
            }
          }
        }
      } catch (e) {
        console.error("Failed to recall scene:", e);
      }
    }
    async function saveCurrentScene() {
      const btn = document.getElementById("saveSceneBtn");
      try {
        const res = await fetch("/api/montage/scene", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "save", scene: activeScene })
        });
        const data = await res.json();
        if (data.success) {
          const sName = desktopSceneNames[activeScene] || `Scene ${activeScene}`;
          showAppToast(`Saved mix to ${sName}`);
          const originalText = btn.innerHTML;
          btn.innerHTML = `<span style="color: var(--success); display: inline-flex; align-items: center; gap: 4px;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> Saved to ${sName}!</span>`;
          setTimeout(() => { btn.innerHTML = originalText; }, 1500);
        }
      } catch (e) {
        console.error("Failed to save scene:", e);
      }
    }

    // Yamaha VST Window State Cycling:
    // State 0: Not Running / Initial -> Click 1: Starts in background / Hides (Running in Background)
    // State 1: Running in Background -> Click 2: Show GUI Window
    // State 2: GUI Visible -> Click 3: Kill / Delete GUI & Process Completely
    // VST Engine Manager State & Handlers
    let activeEngine = localStorage.getItem("litwave_active_engine") || "yamaha"; // "yamaha" or "community"
    let pendingEngineChoice = activeEngine;

    function updateEngineModalUI() {
      const optY = document.getElementById("engineOptYamaha");
      const optC = document.getElementById("engineOptCommunity");
      const rY = document.getElementById("radioYamaha");
      const rC = document.getElementById("radioCommunity");
      const bY = document.getElementById("badgeYamahaActive");
      const bC = document.getElementById("badgeCommunityActive");
      const stText = document.getElementById("engineRunningStatusText");

      if (!optY || !optC) return;
      if (pendingEngineChoice === "yamaha") {
        optY.style.borderColor = "var(--accent)";
        optY.style.background = "var(--bg-panel-hover, #1e293b)";
        optC.style.borderColor = "var(--border-dim)";
        optC.style.background = "var(--bg-panel)";
        if (rY) rY.checked = true;
      } else {
        optC.style.borderColor = "var(--accent)";
        optC.style.background = "var(--bg-panel-hover, #1e293b)";
        optY.style.borderColor = "var(--border-dim)";
        optY.style.background = "var(--bg-panel)";
        if (rC) rC.checked = true;
      }

      if (window.g_nativeEngineRunning) {
        if (bY) bY.style.display = (activeEngine === "yamaha") ? "inline-block" : "none";
        if (bC) bC.style.display = (activeEngine === "community") ? "inline-block" : "none";
        if (stText) stText.innerHTML = `<span style="color: var(--success, #4ade80);">● Running (${activeEngine === 'yamaha' ? 'Yamaha' : 'Community'})</span>`;
      } else {
        if (bY) bY.style.display = "none";
        if (bC) bC.style.display = "none";
        if (stText) stText.innerHTML = `<span style="color: var(--text-dim);">○ Stopped</span>`;
      }
    }
    function chooseEngine(eng) {
      pendingEngineChoice = eng;
      updateEngineModalUI();
    }
    function closeEngineModal() {
      document.getElementById("engineSelectModal").style.display = "none";
    }

    // Open GUI action for selected engine
    async function vstActionOpenGUI() {
      activeEngine = pendingEngineChoice;
      localStorage.setItem("litwave_active_engine", activeEngine);
      closeEngineModal();

      if (activeEngine === "yamaha") {
        await fetch("/api/montage/editor", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "show", engine: "yamaha" })
        });
        window.g_nativeEngineRunning = true;
        showAppToast("Opened Yamaha MONTAGE M GUI");
      } else {
        await fetch("/api/montage/editor", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "start", engine: "community", hidden: true })
        });
        window.g_nativeEngineRunning = true;
        showAppToast("Opened Community SoundFont Mixer");
        openPartsModal();
      }
    }

    // Kill action
    async function vstActionKill() {
      await fetch("/api/montage/editor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "kill" })
      });
      window.g_nativeEngineRunning = false;
      closePartsModal();
      closeEngineModal();
      showAppToast("VST engine process killed completely");
    }

    // Clicking the VST Engine header button opens the management window
    function openSynthEditor() {
      pendingEngineChoice = activeEngine || "yamaha";
      updateEngineModalUI();
      document.getElementById("engineSelectModal").style.display = "flex";
    }
