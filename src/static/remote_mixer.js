// Litwave remote/mixer — extracted verbatim from remote.html (see README section 2). Plain classic script, global scope, no modules.
    // Remote 4-Band Master Parametric Equalizer Handlers
    const remoteEqBands = [
      { id: 0, freq: 100.0, gain: 0.0, q: 0.707 },
      { id: 1, freq: 500.0, gain: 0.0, q: 1.0 },
      { id: 2, freq: 2500.0, gain: 0.0, q: 1.0 },
      { id: 3, freq: 8000.0, gain: 0.0, q: 0.707 }
    ];

    async function onRemoteEqChange(bandIdx, gainVal) {
      gainVal = Math.max(-18, Math.min(18, parseFloat(gainVal)));
      remoteEqBands[bandIdx].gain = gainVal;
      const bNum = bandIdx + 1;
      const sign = gainVal > 0 ? "+" : "";
      const text = document.getElementById(`remoteEqB${bNum}Val`);
      if (text) text.innerText = `${sign}${gainVal.toFixed(1)}`;
      const pct = ((gainVal + 18) / 36) * 100;
      const fill = document.getElementById(`remoteEqB${bNum}Fill`);
      const thumb = document.getElementById(`remoteEqB${bNum}Thumb`);
      if (fill) fill.style.width = `${pct}%`;
      if (thumb) thumb.style.left = `${pct}%`;

      try {
        await fetch("/api/mixer", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            equalizer_band: {
              index: bandIdx,
              gain: gainVal,
              freq: remoteEqBands[bandIdx].freq,
              q: remoteEqBands[bandIdx].q
            }
          })
        });
      } catch (e) {}
    }
    async function resetRemoteEqFlat() {
      for (let i = 0; i < 4; i++) {
        remoteEqBands[i].gain = 0.0;
        const bNum = i + 1;
        const text = document.getElementById(`remoteEqB${bNum}Val`);
        if (text) text.innerText = "0.0";
        const fill = document.getElementById(`remoteEqB${bNum}Fill`);
        const thumb = document.getElementById(`remoteEqB${bNum}Thumb`);
        if (fill) fill.style.width = "50%";
        if (thumb) thumb.style.left = "50%";
      }
      showRemoteToast("Master EQ reset to Flat");
      try {
        await fetch("/api/mixer", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ equalizer_reset: true })
        });
      } catch (e) {}
    }
    function initRemoteEqSliders() {
      for (let i = 0; i < 4; i++) {
        const bNum = i + 1;
        const wrap = document.getElementById(`remoteEqB${bNum}Wrap`);
        if (!wrap) continue;
        const bandIdx = i;
        const handleX = (clientX) => {
          const rect = wrap.getBoundingClientRect();
          let ratio = (clientX - rect.left) / rect.width;
          ratio = Math.max(0, Math.min(1, ratio));
          const gain = (ratio * 36) - 18;
          onRemoteEqChange(bandIdx, gain);
        };
        wrap.addEventListener("touchstart", (e) => handleX(e.touches[0].clientX), { passive: true });
        wrap.addEventListener("touchmove", (e) => handleX(e.touches[0].clientX), { passive: true });
        wrap.addEventListener("mousedown", (e) => {
          handleX(e.clientX);
          const onMove = (ev) => handleX(ev.clientX);
          const onUp = () => {
            window.removeEventListener("mousemove", onMove);
            window.removeEventListener("mouseup", onUp);
          };
          window.addEventListener("mousemove", onMove);
          window.addEventListener("mouseup", onUp);
        });
      }
    }

    // Remote VST Engine Modal & State Handlers
    let remoteActiveEngine = "yamaha";
    let remotePendingEngine = "yamaha";

    function openRemoteEngineModal() {
      remotePendingEngine = remoteActiveEngine;
      updateRemoteEngineModalUI();
      const modal = document.getElementById("remoteEngineModal");
      if (modal) modal.style.display = "flex";
    }
    function closeRemoteEngineModal() {
      const modal = document.getElementById("remoteEngineModal");
      if (modal) modal.style.display = "none";
    }
    function chooseRemoteEngine(eng) {
      remotePendingEngine = eng;
      updateRemoteEngineModalUI();
    }
    function updateRemoteEngineModalUI() {
      const optY = document.getElementById("rOptYamaha");
      const optC = document.getElementById("rOptCommunity");
      const rY = document.getElementById("rRadioYamaha");
      const rC = document.getElementById("rRadioCommunity");
      const bY = document.getElementById("rBadgeYamaha");
      const bC = document.getElementById("rBadgeCommunity");
      const stText = document.getElementById("rEngineStatusText");

      if (!optY || !optC) return;
      if (remotePendingEngine === "yamaha") {
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

      if (window.g_remoteEngineRunning) {
        if (bY) bY.style.display = (remoteActiveEngine === "yamaha") ? "inline-block" : "none";
        if (bC) bC.style.display = (remoteActiveEngine === "community") ? "inline-block" : "none";
        if (stText) stText.innerHTML = `<span style="color: var(--success, #4ade80);">● Running (${remoteActiveEngine === 'yamaha' ? 'Yamaha' : 'Community'})</span>`;
      } else {
        if (bY) bY.style.display = "none";
        if (bC) bC.style.display = "none";
        if (stText) stText.innerHTML = `<span style="color: var(--text-dim);">○ Stopped</span>`;
      }
    }
    async function remoteVstActionOpen() {
      remoteActiveEngine = remotePendingEngine;
      closeRemoteEngineModal();
      if (remoteActiveEngine === "yamaha") {
        await fetch("/api/montage/editor", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "show", engine: "yamaha" })
        });
        showRemoteToast("Opened Yamaha MONTAGE M GUI");
      } else {
        await fetch("/api/montage/editor", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "start", engine: "community", hidden: true })
        });
        showRemoteToast("Started Community SoundFont VST");
      }
      renderParts();
    }
    async function remoteVstActionKill() {
      await fetch("/api/montage/editor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "kill" })
      });
      window.g_remoteEngineRunning = false;
      closeRemoteEngineModal();
      showRemoteToast("VST process killed completely");
    }

    // Remote Metronome Controls
    async function toggleRemoteMetronome() {
      try {
        await fetch("/api/mixer", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ toggle_metronome: true })
        });
      } catch (e) {
        console.error("Failed to toggle metronome:", e);
      }
    }
    function handleRemoteTapTempo() {
      const now = performance.now();
      tapTimes.push(now);
      if (tapTimes.length > 4) tapTimes.shift();
      if (tapTimes.length >= 2) {
        let intervals = [];
        for (let i = 1; i < tapTimes.length; i++) {
          intervals.push(tapTimes[i] - tapTimes[i - 1]);
        }
        const avgMs = intervals.reduce((a, b) => a + b) / intervals.length;
        if (avgMs > 200 && avgMs < 2000) {
          const bpm = Math.round(60000.0 / avgMs);
          currentBpm = bpm;
          document.getElementById("remoteBpmText").innerText = `${bpm} BPM`;
          fetch("/api/mixer", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ metronome_bpm: bpm })
          }).catch(console.error);
        }
      }
    }
    function handleRemoteTimeSigChange(val) {
      fetch("/api/mixer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ metronome_time_sig: parseInt(val) })
      }).catch(console.error);
    }
    function handleRemoteMetroSoundChange(val) {
      fetch("/api/mixer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ metronome_profile: val })
      }).catch(console.error);
    }

    // Mix Fader Bindings (Track, Synth, Master, Metronome)
    let activeMixerDrag = null;

    function setupMixerFaders() {
      ['track', 'synth', 'master', 'metro', 'fx', 'top_fx'].forEach(type => {
        const wrap = document.getElementById(`sliderWrap_${type}`);
        if (!wrap) return;

        function update(clientX) {
          const rect = wrap.getBoundingClientRect();
          let ratio = (clientX - rect.left) / rect.width;
          ratio = Math.max(0, Math.min(1, ratio));
          const pct = (ratio * 100).toFixed(1);

          const fill = document.getElementById(`sliderFill_${type}`);
          const thumb = document.getElementById(`sliderThumb_${type}`);
          if (fill) fill.style.width = pct + "%";
          if (thumb) thumb.style.left = pct + "%";

          if (type === 'track') {
            const vol = ratio * 1.0;
            const db = vol > 0 ? (20 * Math.log10(vol)).toFixed(1) : "-inf";
            document.getElementById("remoteTrackVolText").innerText = `${db} dB`;
            fetch("/api/mixer", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ track_volume: vol })
            }).catch(console.error);
          } else if (type === 'synth') {
            const vol = ratio * 1.0;
            const db = vol > 0 ? (20 * Math.log10(vol)).toFixed(1) : "-inf";
            document.getElementById("remoteSynthVolText").innerText = `${db} dB`;
            const vst127 = Math.round(vol * 127);
            fetch("/api/montage/volume", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ master_volume: vst127 })
            }).catch(console.error);
          } else if (type === 'master') {
            const vol = ratio * 1.2;
            const db = vol > 0 ? (20 * Math.log10(vol)).toFixed(1) : "-inf";
            document.getElementById("remoteMasterVolText").innerText = `${db} dB`;
            fetch("/api/mixer", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ master_volume: vol })
            }).catch(console.error);
          } else if (type === 'metro') {
            const vol = ratio * 2.0; // 0 to 2.0x boost
            const pctVal = Math.round(vol * 100);
            document.getElementById("remoteMetroVolText").innerText = vol > 1.0 ? `Boost ${pctVal}%` : `${pctVal}%`;
            fetch("/api/mixer", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ metronome_volume: vol })
            }).catch(console.error);
          } else if (type === 'fx' || type === 'top_fx') {
            const vol = ratio * 1.5;
            const db = vol > 0 ? (20 * Math.log10(vol)).toFixed(1) : "-inf";
            const el1 = document.getElementById("remoteFxVolText");
            if (el1) el1.innerText = `${db} dB`;
            const el2 = document.getElementById("remoteFxTopVolText");
            if (el2) el2.innerText = `${db} dB`;
            
            // Mirror to both sliders on remote
            ['fx', 'top_fx'].forEach(st => {
              const f = document.getElementById(`sliderFill_${st}`);
              const th = document.getElementById(`sliderThumb_${st}`);
              if (f) f.style.width = pct + "%";
              if (th) th.style.left = pct + "%";
            });

            fetch("/api/fx-pads", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "bus", volume: vol })
            }).catch(console.error);
          }
        }

        wrap.addEventListener("touchstart", (e) => { activeMixerDrag = type; update(e.touches[0].clientX); }, { passive: true });
        wrap.addEventListener("touchmove", (e) => { if (activeMixerDrag === type) update(e.touches[0].clientX); }, { passive: true });
        window.addEventListener("touchend", () => { activeMixerDrag = null; });

        wrap.addEventListener("mousedown", (e) => {
          activeMixerDrag = type;
          update(e.clientX);
          const onMv = (m) => { if (activeMixerDrag === type) update(m.clientX); };
          const onUp = () => { activeMixerDrag = null; window.removeEventListener("mousemove", onMv); window.removeEventListener("mouseup", onUp); };
          window.addEventListener("mousemove", onMv);
          window.addEventListener("mouseup", onUp);
        });
      });
    }
