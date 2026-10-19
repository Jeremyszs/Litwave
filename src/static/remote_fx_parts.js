// Litwave remote/fx — extracted verbatim from remote.html (see README section 2). Plain classic script, global scope, no modules.
    // Render Remote Scene Selectors
    let remoteActiveScene = 1;
    let remoteSceneNames = { 1: "Scene 1", 2: "Scene 2", 3: "Scene 3", 4: "Scene 4", 5: "Scene 5", 6: "Scene 6", 7: "Scene 7", 8: "Scene 8" };

    function renderRemoteScenes() {
      const el = document.getElementById("stageScenesGrid");
      if (!el) return;
      el.innerHTML = "";
      for (let s = 1; s <= 8; s++) {
        const name = remoteSceneNames[s] || `Scene ${s}`;
        const btn = document.createElement("button");
        btn.className = `btn ${s === remoteActiveScene ? 'is-active-loop' : ''}`;
        btn.style.padding = "6px 4px";
        btn.style.fontSize = "11px";
        btn.style.fontWeight = "700";
        btn.style.overflow = "hidden";
        btn.style.textOverflow = "ellipsis";
        btn.style.whiteSpace = "nowrap";
        btn.innerText = name;
        btn.id = `stageSceneBtn_${s}`;
        btn.onclick = () => selectRemoteScene(s);
        el.appendChild(btn);
      }
    }
    async function selectRemoteScene(sceneNum) {
      remoteActiveScene = sceneNum;
      const sName = remoteSceneNames[sceneNum] || `Scene ${sceneNum}`;
      const sText = document.getElementById("stageActiveSceneText");
      if (sText) sText.innerText = sName;

      for (let s = 1; s <= 8; s++) {
        const sb = document.getElementById(`stageSceneBtn_${s}`);
        if (sb) sb.classList.toggle("is-active-loop", s === sceneNum);
      }
      renderRemoteScenes();
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
            if (partsState[partIdx]) {
              const val = data.snapshot.parts[p];
              partsState[partIdx].val = val;
              const pct = ((val / 127) * 100).toFixed(1);
              const fill = document.getElementById(`sliderFill_${p}`);
              const thumb = document.getElementById(`sliderThumb_${p}`);
              const text = document.getElementById(`partValText_${p}`);
              if (fill) fill.style.width = pct + "%";
              if (thumb) thumb.style.left = pct + "%";
              if (text) text.innerText = `Vol: ${val}`;
            }
          }
        }
      } catch (e) {
        console.error("Failed to recall scene:", e);
      }
    }

    // Mobile Rename Part Handlers
    let renamingPartTarget = 1;
    function openRemoteRenamePartModal(partNum) {
      renamingPartTarget = partNum;
      const cur = partsState[partNum - 1].name || `Part ${partNum}`;
      document.getElementById("remoteRenamePartTitle").innerText = `Rename Part ${partNum}`;
      const inp = document.getElementById("remoteRenamePartInput");
      inp.value = cur;
      document.getElementById("remoteRenamePartModal").style.display = "flex";
      setTimeout(() => inp.focus(), 50);
    }
    function closeRemoteRenamePartModal() {
      document.getElementById("remoteRenamePartModal").style.display = "none";
    }
    async function confirmRemoteRenamePart() {
      const inp = document.getElementById("remoteRenamePartInput");
      const newName = (inp.value.trim() || `Part ${renamingPartTarget}`).slice(0, 24);
      closeRemoteRenamePartModal();
      partsState[renamingPartTarget - 1].name = newName;
      renderParts();
      showRemoteToast(`Renamed Part ${renamingPartTarget} to ${newName}`);
      await fetch("/api/montage/names", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parts: { [renamingPartTarget]: newName } })
      });
    }
    function openRemoteRenameSceneModal() {
      const cur = remoteSceneNames[remoteActiveScene] || `Scene ${remoteActiveScene}`;
      document.getElementById("remoteRenameSceneTitle").innerText = `Rename Scene ${remoteActiveScene}`;
      const inp = document.getElementById("remoteRenameSceneInput");
      inp.value = cur;
      document.getElementById("remoteRenameSceneModal").style.display = "flex";
      setTimeout(() => inp.focus(), 50);
    }
    function closeRemoteRenameSceneModal() {
      document.getElementById("remoteRenameSceneModal").style.display = "none";
    }
    async function confirmRemoteRenameScene() {
      const inp = document.getElementById("remoteRenameSceneInput");
      const newName = (inp.value.trim() || `Scene ${remoteActiveScene}`).slice(0, 24);
      closeRemoteRenameSceneModal();
      remoteSceneNames[remoteActiveScene] = newName;
      renderRemoteScenes();
      const sText = document.getElementById("stageActiveSceneText");
      if (sText) sText.innerText = newName;
      await fetch("/api/montage/names", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scenes: { [remoteActiveScene]: newName } })
      });
    }
    async function saveRemoteCurrentScene() {
      const btn = document.getElementById("remoteSaveSceneBtn");
      try {
        const res = await fetch("/api/montage/scene", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "save", scene: remoteActiveScene })
        });
        const data = await res.json();
        if (data.success) {
          const sName = remoteSceneNames[remoteActiveScene] || `Scene ${remoteActiveScene}`;
          showRemoteToast(`Saved mix to ${sName}`);
          const orig = btn.innerHTML;
          btn.innerHTML = `<span style="color: var(--success); display: inline-flex; align-items: center; gap: 4px;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> Saved to ${sName}!</span>`;
          setTimeout(() => { btn.innerHTML = orig; }, 1500);
        }
      } catch (e) {
        console.error("Failed to save scene:", e);
      }
    }

    // Render Parts
    function renderParts() {
      initRemoteMasterTweakSliders();
      const isCommunity = (remoteActiveEngine === "community");
      const stageBadge = document.getElementById("stagePartsEngineBadge");
      if (stageBadge) {
        stageBadge.innerText = isCommunity ? "Community VST" : "MONTAGE M";
      }

      const container = document.getElementById("stagePartsGrid");
      if (!container) return;
      container.innerHTML = "";

      partsState.forEach((p) => {
        const pctVol = ((p.val / 127) * 100).toFixed(1);
        const pctRev = (((p.rev || 40) / 127) * 100).toFixed(1);

        let voiceSelectorHtml = "";
        if (isCommunity && window.g_remoteVoices) {
          let voiceOptions = `<option value="">-- Voice Preset --</option>`;
          const cats = {};
          window.g_remoteVoices.forEach(v => {
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
          voiceSelectorHtml = `
            <select style="background: var(--bg-surface); border: 1px solid var(--border-dim); border-radius: 4px; color: var(--accent); font-size: 10px; padding: 2px 4px; outline: none; width: 120px;" onchange="assignRemoteVoice(${p.part}, this.value)">
              ${voiceOptions}
            </select>
          `;
        }

        const row = document.createElement("div");
        row.className = "part-row";
        row.style.flexDirection = "column";
        row.style.gap = "6px";
        row.style.padding = "8px 0";
        row.style.borderBottom = "1px solid var(--border-dim)";

        row.innerHTML = `
          <!-- Safe Touch-Scroll Handle (Prevents Accidental Fader Drag) -->
          <div class="part-scroll-handle" title="Touch and drag here to scroll page">
            <div style="display: flex; align-items: center; gap: 5px;">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="opacity: 0.5;"><circle cx="9" cy="5" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="19" r="1"/></svg>
              <span style="font-size: 9px; font-weight: 700; color: var(--text-faint); letter-spacing: 0.5px;"></span>
            </div>
            <span style="font-size: 9px; font-family: var(--font-mono); color: var(--text-faint);">PART ${p.part}</span>
          </div>

          <div style="display: flex; align-items: center; justify-content: space-between; width: 100%;">
            <div style="display: flex; align-items: center; gap: 6px;">
              <span class="part-num" style="font-size: 13px; font-weight: 700; color: ${p.mute ? 'var(--text-faint)' : 'var(--text-main)'}; font-family: var(--font-sans); cursor: pointer; display: inline-flex; align-items: center; gap: 4px;" onclick="openRemoteRenamePartModal(${p.part})" title="Tap to rename part">
                <span>${p.name}</span>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="opacity: 0.6;"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>
              </span>
              ${voiceSelectorHtml}
              <button class="btn ${p.mute ? 'btn-danger' : ''}" style="padding: 2px 6px; font-size: 9px; font-weight: 700; border-radius: 3px; border-color: ${p.mute ? 'var(--danger)' : 'var(--border-subtle)'};" onclick="toggleRemoteMute(${p.part})">M</button>
              <button class="btn ${p.solo ? 'btn-active' : ''}" style="padding: 2px 6px; font-size: 9px; font-weight: 700; border-radius: 3px; border-color: ${p.solo ? 'var(--accent)' : 'var(--border-subtle)'};" onclick="toggleRemoteSolo(${p.part})">S</button>
            </div>
            <div style="display: flex; align-items: center; gap: 12px; font-family: var(--font-mono); font-size: 11px;">
              <span id="partValText_${p.part}" style="color: ${p.mute ? 'var(--text-faint)' : 'var(--accent)'}; font-weight: 700;">Vol: ${p.val}</span>
              <span id="partRevText_${p.part}" style="color: var(--accent-secondary); font-weight: 700;">Rev: ${p.rev || 40}</span>
            </div>
          </div>

          <!-- Volume Fader -->
          <div class="part-slider-wrap" id="sliderWrap_${p.part}" style="opacity: ${p.mute ? '0.4' : '1.0'};">
            <div class="part-slider-fill" id="sliderFill_${p.part}" style="width: ${pctVol}%;"></div>
            <div class="part-slider-thumb" id="sliderThumb_${p.part}" style="left: ${pctVol}%;"></div>
          </div>

          <!-- Reverb Secondary Fader -->
          <div style="display: flex; align-items: center; gap: 8px; width: 100%; padding-left: 2px;">
            <span style="font-size: 10px; font-weight: 700; color: var(--text-main); font-family: var(--font-mono); width: 28px;">REV</span>
            <div class="part-slider-wrap" id="reverbWrap_${p.part}" style="height: 14px; flex: 1; background: var(--bg-sunken);">
              <div class="part-slider-fill" id="reverbFill_${p.part}" style="width: ${pctRev}%; background: linear-gradient(90deg, rgba(30, 58, 138, 0.4), rgba(96, 165, 250, 0.65)); border-right: 2px solid #60a5fa;"></div>
              <div class="part-slider-thumb" id="reverbThumb_${p.part}" style="left: ${pctRev}%; width: 10px; height: 10px; top: -1px; background: #ffffff;"></div>
            </div>
          </div>

          <!-- Extended Sculpting Controls on Remote (Pan, Cutoff, Resonance, Attack, Release, Chorus) -->
          <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; padding-top: 6px; border-top: 1px solid var(--border-subtle);">
            <div style="display: flex; flex-direction: column; gap: 2px;">
              <div style="display: flex; justify-content: space-between; font-size: 9px; font-weight: 700; font-family: var(--font-mono); color: var(--text-main);">
                <span>PAN</span><span id="remotePanVal_${p.part}" style="color: var(--accent);">${p.pan !== undefined ? p.pan : 64}</span>
              </div>
              <div class="part-slider-wrap" id="remotePanWrap_${p.part}" style="height: 14px; background: var(--bg-sunken);">
                <div class="part-slider-fill" id="remotePanFill_${p.part}" style="width: ${(((p.pan !== undefined ? p.pan : 64) / 127) * 100).toFixed(1)}%;"></div>
                <div class="part-slider-thumb" id="remotePanThumb_${p.part}" style="left: ${(((p.pan !== undefined ? p.pan : 64) / 127) * 100).toFixed(1)}%; width: 10px; height: 10px; top: -1px;"></div>
              </div>
            </div>

            <div style="display: flex; flex-direction: column; gap: 2px;">
              <div style="display: flex; justify-content: space-between; font-size: 9px; font-weight: 700; font-family: var(--font-mono); color: var(--text-main);">
                <span>CUTOFF</span><span id="remoteCutVal_${p.part}" style="color: var(--accent);">${p.cutoff !== undefined ? p.cutoff : 64}</span>
              </div>
              <div class="part-slider-wrap" id="remoteCutWrap_${p.part}" style="height: 14px; background: var(--bg-sunken);">
                <div class="part-slider-fill" id="remoteCutFill_${p.part}" style="width: ${(((p.cutoff !== undefined ? p.cutoff : 64) / 127) * 100).toFixed(1)}%;"></div>
                <div class="part-slider-thumb" id="remoteCutThumb_${p.part}" style="left: ${(((p.cutoff !== undefined ? p.cutoff : 64) / 127) * 100).toFixed(1)}%; width: 10px; height: 10px; top: -1px;"></div>
              </div>
            </div>

            <div style="display: flex; flex-direction: column; gap: 2px;">
              <div style="display: flex; justify-content: space-between; font-size: 9px; font-weight: 700; font-family: var(--font-mono); color: var(--text-main);">
                <span>RESON</span><span id="remoteResVal_${p.part}" style="color: var(--accent);">${p.resonance !== undefined ? p.resonance : 64}</span>
              </div>
              <div class="part-slider-wrap" id="remoteResWrap_${p.part}" style="height: 14px; background: var(--bg-sunken);">
                <div class="part-slider-fill" id="remoteResFill_${p.part}" style="width: ${(((p.resonance !== undefined ? p.resonance : 64) / 127) * 100).toFixed(1)}%;"></div>
                <div class="part-slider-thumb" id="remoteResThumb_${p.part}" style="left: ${(((p.resonance !== undefined ? p.resonance : 64) / 127) * 100).toFixed(1)}%; width: 10px; height: 10px; top: -1px;"></div>
              </div>
            </div>

            <div style="display: flex; flex-direction: column; gap: 2px;">
              <div style="display: flex; justify-content: space-between; font-size: 9px; font-weight: 700; font-family: var(--font-mono); color: var(--text-main);">
                <span>ATTACK</span><span id="remoteAttVal_${p.part}" style="color: var(--accent);">${p.attack !== undefined ? p.attack : 64}</span>
              </div>
              <div class="part-slider-wrap" id="remoteAttWrap_${p.part}" style="height: 14px; background: var(--bg-sunken);">
                <div class="part-slider-fill" id="remoteAttFill_${p.part}" style="width: ${(((p.attack !== undefined ? p.attack : 64) / 127) * 100).toFixed(1)}%;"></div>
                <div class="part-slider-thumb" id="remoteAttThumb_${p.part}" style="left: ${(((p.attack !== undefined ? p.attack : 64) / 127) * 100).toFixed(1)}%; width: 10px; height: 10px; top: -1px;"></div>
              </div>
            </div>

            <div style="display: flex; flex-direction: column; gap: 2px;">
              <div style="display: flex; justify-content: space-between; font-size: 9px; font-weight: 700; font-family: var(--font-mono); color: var(--text-main);">
                <span>RELEASE</span><span id="remoteRelVal_${p.part}" style="color: var(--accent);">${p.release !== undefined ? p.release : 64}</span>
              </div>
              <div class="part-slider-wrap" id="remoteRelWrap_${p.part}" style="height: 14px; background: var(--bg-sunken);">
                <div class="part-slider-fill" id="remoteRelFill_${p.part}" style="width: ${(((p.release !== undefined ? p.release : 64) / 127) * 100).toFixed(1)}%;"></div>
                <div class="part-slider-thumb" id="remoteRelThumb_${p.part}" style="left: ${(((p.release !== undefined ? p.release : 64) / 127) * 100).toFixed(1)}%; width: 10px; height: 10px; top: -1px;"></div>
              </div>
            </div>

            <div style="display: flex; flex-direction: column; gap: 2px;">
              <div style="display: flex; justify-content: space-between; font-size: 9px; font-weight: 700; font-family: var(--font-mono); color: var(--text-main);">
                <span>CHORUS</span><span id="remoteChoVal_${p.part}" style="color: var(--accent);">${p.chorus !== undefined ? p.chorus : 0}</span>
              </div>
              <div class="part-slider-wrap" id="remoteChoWrap_${p.part}" style="height: 14px; background: var(--bg-sunken);">
                <div class="part-slider-fill secondary" id="remoteChoFill_${p.part}" style="width: ${(((p.chorus !== undefined ? p.chorus : 0) / 127) * 100).toFixed(1)}%;"></div>
                <div class="part-slider-thumb" id="remoteChoThumb_${p.part}" style="left: ${(((p.chorus !== undefined ? p.chorus : 0) / 127) * 100).toFixed(1)}%; width: 10px; height: 10px; top: -1px;"></div>
              </div>
            </div>
          </div>
        `;

        container.appendChild(row);

        const wrapVol = row.querySelector(`#sliderWrap_${p.part}`);
        bindSliderDrag(wrapVol, p.part);

        const wrapRev = row.querySelector(`#reverbWrap_${p.part}`);
        bindReverbSliderDrag(wrapRev, p.part);

        ['pan', 'cut', 'res', 'att', 'rel', 'cho'].forEach((paramShort) => {
          const mapParam = { pan: 'pan', cut: 'cutoff', res: 'resonance', att: 'attack', rel: 'release', cho: 'chorus' };
          const pName = mapParam[paramShort];
          const wrapEl = row.querySelector(`#remote${paramShort.charAt(0).toUpperCase() + paramShort.slice(1)}Wrap_${p.part}`);
          if (wrapEl) {
            bindRemoteParamSliderDrag(wrapEl, p.part, pName, paramShort);
          }
        });
      });
    }
    function bindRemoteParamSliderDrag(element, partNum, paramName, paramShort) {
      function updateFromX(clientX) {
        const rect = element.getBoundingClientRect();
        let ratio = (clientX - rect.left) / rect.width;
        ratio = Math.max(0, Math.min(1, ratio));
        const val = Math.round(ratio * 127);

        partsState[partNum - 1][paramName] = val;
        const pct = (ratio * 100).toFixed(1);
        const pCap = paramShort.charAt(0).toUpperCase() + paramShort.slice(1);
        const fill = document.getElementById(`remote${pCap}Fill_${partNum}`);
        const thumb = document.getElementById(`remote${pCap}Thumb_${partNum}`);
        const text = document.getElementById(`remote${pCap}Val_${partNum}`);
        if (fill) fill.style.width = pct + "%";
        if (thumb) thumb.style.left = pct + "%";
        if (text) text.innerText = val;

        fetch("/api/montage/volume", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ part: partNum, tweak: { type: paramName, val: val } })
        });
      }

      element.addEventListener("touchstart", (e) => {
        updateFromX(e.touches[0].clientX);
      }, { passive: true });

      element.addEventListener("touchmove", (e) => {
        updateFromX(e.touches[0].clientX);
      }, { passive: true });

      element.addEventListener("mousedown", (e) => {
        updateFromX(e.clientX);
        const onMove = (ev) => updateFromX(ev.clientX);
        const onUp = () => {
          window.removeEventListener("mousemove", onMove);
          window.removeEventListener("mouseup", onUp);
        };
        window.addEventListener("mousemove", onMove);
        window.addEventListener("mouseup", onUp);
      });
    }
    function bindReverbSliderDrag(element, partNum) {
      let isDragging = false;

      function updateFromX(clientX) {
        const rect = element.getBoundingClientRect();
        let ratio = (clientX - rect.left) / rect.width;
        ratio = Math.max(0, Math.min(1, ratio));
        const val = Math.round(ratio * 127);

        partsState[partNum - 1].rev = val;

        const pct = (ratio * 100).toFixed(1);
        const fill = document.getElementById(`reverbFill_${partNum}`);
        const thumb = document.getElementById(`reverbThumb_${partNum}`);
        const text = document.getElementById(`partRevText_${partNum}`);
        if (fill) fill.style.width = pct + "%";
        if (thumb) thumb.style.left = pct + "%";
        if (text) text.innerText = `Rev: ${val}`;

        fetch("/api/montage/volume", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ part: partNum, reverb: val })
        }).catch(console.error);
      }

      element.addEventListener("touchstart", (e) => {
        isDragging = true;
        updateFromX(e.touches[0].clientX);
      }, { passive: true });

      element.addEventListener("touchmove", (e) => {
        if (!isDragging) return;
        updateFromX(e.touches[0].clientX);
      }, { passive: true });

      window.addEventListener("touchend", () => { isDragging = false; });

      element.addEventListener("mousedown", (e) => {
        isDragging = true;
        updateFromX(e.clientX);
        const onMove = (mv) => { if (isDragging) updateFromX(mv.clientX); };
        const onUp = () => { isDragging = false; window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
        window.addEventListener("mousemove", onMove);
        window.addEventListener("mouseup", onUp);
      });
    }
    async function assignRemoteVoice(partNum, val) {
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
          partsState[partNum - 1].name = name;
          renderParts();
          showRemoteToast(`Part ${partNum}: ${name}`);
        }
      } catch(e) {
        console.error("Failed to assign voice:", e);
      }
    }
    async function toggleRemoteMute(partNum) {
      const p = partsState[partNum - 1];
      const newMute = !p.mute;
      p.mute = newMute;
      renderParts();
      try {
        await fetch("/api/montage/volume", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ part: partNum, tweak: { type: paramName, val: val } })
        });
      } catch (e) {
        console.error("Failed to set mute:", e);
      }
    }
    async function toggleRemoteSolo(partNum) {
      const p = partsState[partNum - 1];
      p.solo = !p.solo;
      try {
        const res = await fetch("/api/montage/volume", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ part: partNum, solo: true })
        });
        const data = await res.json();
        if (data.solos) {
          for (let s = 1; s <= 8; s++) {
            partsState[s - 1].solo = Boolean(data.solos[s]);
            partsState[s - 1].mute = Boolean(data.mutes[s]);
          }
        }
        renderParts();
      } catch (e) {
        console.error("Failed to toggle solo:", e);
      }
    }

    let g_activePartFaderDrag = null;

    function bindSliderDrag(element, partNum) {
      function updateFromX(clientX) {
        const rect = element.getBoundingClientRect();
        let ratio = (clientX - rect.left) / rect.width;
        ratio = Math.max(0, Math.min(1, ratio));
        const val = Math.round(ratio * 127);

        partsState[partNum - 1].val = val;

        const pct = (ratio * 100).toFixed(1);
        const fill = document.getElementById(`sliderFill_${partNum}`);
        const thumb = document.getElementById(`sliderThumb_${partNum}`);
        const text = document.getElementById(`partValText_${partNum}`);
        if (fill) fill.style.width = pct + "%";
        if (thumb) thumb.style.left = pct + "%";
        if (text) text.innerText = `Vol: ${val}`;

        sendPartVolume(partNum, val);
      }

      element.addEventListener("touchstart", (e) => {
        g_activePartFaderDrag = partNum;
        updateFromX(e.touches[0].clientX);
      }, { passive: true });

      element.addEventListener("touchmove", (e) => {
        if (g_activePartFaderDrag === partNum) updateFromX(e.touches[0].clientX);
      }, { passive: true });

      window.addEventListener("touchend", () => { g_activePartFaderDrag = null; });
      element.addEventListener("mousedown", (e) => {
        g_activePartFaderDrag = partNum;
        updateFromX(e.clientX);
        const onMove = (mv) => { if (g_activePartFaderDrag === partNum) updateFromX(mv.clientX); };
        const onUp = () => { g_activePartFaderDrag = null; window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
        window.addEventListener("mousemove", onMove);
        window.addEventListener("mouseup", onUp);
      });
    }

    function initRemoteMasterTweakSliders() {
      ['cut', 'res', 'att', 'rel'].forEach((paramShort) => {
        const mapParam = { cut: 'cutoff', res: 'resonance', att: 'attack', rel: 'release' };
        const pName = mapParam[paramShort];
        const pCap = paramShort.charAt(0).toUpperCase() + paramShort.slice(1);
        const wrapEl = document.getElementById(`remoteMaster${pCap}Wrap`);
        if (!wrapEl) return;

        function updateFromX(clientX) {
          const rect = wrapEl.getBoundingClientRect();
          let ratio = (clientX - rect.left) / rect.width;
          ratio = Math.max(0, Math.min(1, ratio));
          const val = Math.round(ratio * 127);

          const pct = (ratio * 100).toFixed(1);
          const fill = document.getElementById(`remoteMaster${pCap}Fill`);
          const thumb = document.getElementById(`remoteMaster${pCap}Thumb`);
          const text = document.getElementById(`remoteMaster${pCap}Val`);
          if (fill) fill.style.width = pct + "%";
          if (thumb) thumb.style.left = pct + "%";
          if (text) text.innerText = val;

          fetch("/api/montage/volume", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ master_tweak: { [pName]: val } })
          }).catch(console.error);
        }

        wrapEl.addEventListener("touchstart", (e) => {
          updateFromX(e.touches[0].clientX);
        }, { passive: true });

        wrapEl.addEventListener("touchmove", (e) => {
          updateFromX(e.touches[0].clientX);
        }, { passive: true });

        wrapEl.addEventListener("mousedown", (e) => {
          updateFromX(e.clientX);
          const onMove = (ev) => updateFromX(ev.clientX);
          const onUp = () => {
            window.removeEventListener("mousemove", onMove);
            window.removeEventListener("mouseup", onUp);
          };
          window.addEventListener("mousemove", onMove);
          window.addEventListener("mouseup", onUp);
        });
      });
    }
    function sendPartVolume(part, volume) {
      fetch("/api/montage/volume", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ part: part, volume: volume })
      }).catch(err => console.error("Volume send failed:", err));
    }
    // ==========================================
    // Performance FX Pads Mobile State & Handlers
    // ==========================================
    // 8 Vivid Hardware MPC/SP-404 Style RGB Pad Colors (Index 0..7)
    const FX_PAD_PALETTE = [
      { bg: "linear-gradient(135deg, rgba(239, 68, 68, 0.28) 0%, rgba(185, 28, 28, 0.45) 100%)", border: "#ef4444", glow: "rgba(239, 68, 68, 0.5)" },     // 1: Red
      { bg: "linear-gradient(135deg, rgba(249, 115, 22, 0.28) 0%, rgba(194, 65, 12, 0.45) 100%)", border: "#f97316", glow: "rgba(249, 115, 22, 0.5)" },   // 2: Orange
      { bg: "linear-gradient(135deg, rgba(234, 179, 8, 0.28) 0%, rgba(161, 98, 7, 0.45) 100%)", border: "#eab308", glow: "rgba(234, 179, 8, 0.5)" },      // 3: Amber/Gold
      { bg: "linear-gradient(135deg, rgba(34, 197, 94, 0.28) 0%, rgba(21, 128, 61, 0.45) 100%)", border: "#22c55e", glow: "rgba(34, 197, 94, 0.5)" },     // 4: Green
      { bg: "linear-gradient(135deg, rgba(6, 182, 212, 0.28) 0%, rgba(14, 116, 144, 0.45) 100%)", border: "#06b6d4", glow: "rgba(6, 182, 212, 0.5)" },     // 5: Cyan
      { bg: "linear-gradient(135deg, rgba(59, 130, 246, 0.28) 0%, rgba(29, 78, 216, 0.45) 100%)", border: "#3b82f6", glow: "rgba(59, 130, 246, 0.5)" },     // 6: Blue
      { bg: "linear-gradient(135deg, rgba(168, 85, 247, 0.28) 0%, rgba(126, 34, 206, 0.45) 100%)", border: "#a855f7", glow: "rgba(168, 85, 247, 0.5)" },   // 7: Purple
      { bg: "linear-gradient(135deg, rgba(236, 72, 153, 0.28) 0%, rgba(190, 24, 93, 0.45) 100%)", border: "#ec4899", glow: "rgba(236, 72, 153, 0.5)" }     // 8: Pink / Magenta
    ];

    let g_rFxPadsState = {
      bus_volume: 0.85,
      bus_muted: false,
      active_bank: "A",
      pad_indicators: {},
      pads: {}
    };

    function selectRemoteFxBank(bank) {
      g_rFxPadsState.active_bank = bank;
      ["A", "B", "C", "D", "E", "F"].forEach(b => {
        const btn = document.getElementById(`rFxBankBtn_${b}`);
        if (btn) btn.classList.toggle("btn-active", b === bank);
      });
      renderRemoteFxPads();
      fetch("/api/fx-pads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "bank", bank: bank })
      }).catch(() => {});
    }
    function triggerRemoteFxPad(padId, pressType = "press") {
      const el = document.getElementById(`rFxPad_${padId}`);
      const p = g_rFxPadsState.pads ? g_rFxPadsState.pads[padId] : null;
      if (el && pressType === "press" && p) {
        const padColor = FX_PAD_PALETTE[p.pad_index % FX_PAD_PALETTE.length];
        el.style.background = padColor.border;
        el.style.boxShadow = `0 0 20px ${padColor.glow}`;
        setTimeout(() => {
          if (el) {
            el.style.background = padColor.bg;
            el.style.boxShadow = "none";
          }
        }, 140);
      }
      fetch("/api/fx-pads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "trigger", pad_id: padId, velocity: 127, press_type: pressType })
      }).catch(console.error);
    }
    function stopAllRemoteFxPads() {
      fetch("/api/fx-pads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "stop_all" })
      }).catch(console.error);
    }
    function renderRemoteFxPads() {
      const container = document.getElementById("remoteFxPadsGrid");
      if (!container) return;
      container.innerHTML = "";

      const activeBank = g_rFxPadsState.active_bank || "A";
      const padList = Object.values(g_rFxPadsState.pads || {}).filter(p => p.bank === activeBank);
      padList.sort((a, b) => a.pad_index - b.pad_index);

      padList.forEach(p => {
        const isPlaying = Boolean(g_rFxPadsState.pad_indicators && g_rFxPadsState.pad_indicators[p.id]);
        const padColor = FX_PAD_PALETTE[p.pad_index % FX_PAD_PALETTE.length];

        const padBtn = document.createElement("button");
        padBtn.id = `rFxPad_${p.id}`;
        padBtn.type = "button";
        padBtn.className = `btn ${isPlaying ? 'r-fx-pad-triggered' : ''}`;
        padBtn.style.background = isPlaying ? padColor.border : padColor.bg;
        padBtn.style.border = `1.5px solid ${padColor.border}`;
        padBtn.style.borderRadius = "8px";
        padBtn.style.display = "flex";
        padBtn.style.flexDirection = "column";
        padBtn.style.alignItems = "center";
        padBtn.style.justifyContent = "center";
        padBtn.style.gap = "4px";
        padBtn.style.padding = "12px 6px";
        padBtn.style.touchAction = "manipulation";
        padBtn.style.userSelect = "none";
        padBtn.style.webkitUserSelect = "none";
        padBtn.style.boxShadow = isPlaying ? `0 0 16px ${padColor.glow}` : "none";
        padBtn.style.transition = "transform 0.05s ease, background-color 0.1s ease";

        padBtn.innerHTML = `
          <span style="font-size: 11px; font-family: var(--font-mono); color: #ffffff; font-weight: 800; text-shadow: 0 1px 2px #000;">${p.bank}${p.pad_index + 1}</span>
          <span style="font-size: 14px; font-weight: 800; color: #ffffff; text-align: center; line-height: 1.15; padding: 0 4px; text-shadow: 0 1px 3px rgba(0,0,0,0.8);">${p.name}</span>
          <span style="font-size: 9px; font-family: var(--font-mono); color: #e2e8f0; text-shadow: 0 1px 2px #000;">${p.trigger_mode.toUpperCase()}</span>
        `;

        padBtn.addEventListener("touchstart", (e) => {
          e.preventDefault();
          triggerRemoteFxPad(p.id, "press");
        }, { passive: false });

        padBtn.addEventListener("touchend", (e) => {
          e.preventDefault();
          triggerRemoteFxPad(p.id, "release");
        }, { passive: false });

        padBtn.onmousedown = (e) => {
          e.preventDefault();
          triggerRemoteFxPad(p.id, "press");
        };

        padBtn.onmouseup = () => {
          triggerRemoteFxPad(p.id, "release");
        };

        container.appendChild(padBtn);
      });
    }
