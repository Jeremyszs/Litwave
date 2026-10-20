# Litwave Entire Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the desktop studio and phone remote UIs with the approved Studio + Stage + Phone design while keeping every existing feature working against the unchanged backend.

**Architecture:** New `index.html` / `remote.html` shells with markup only, styled by `css/*.css`, driven by classic scripts that share one `window.LW` namespace (`js/kit/*` for the reusable design-system pieces, `js/desktop/*` and `js/remote/*` for features ported from today's inline scripts). Old pages move to `static/classic/`. No backend, API or telemetry changes.

**Tech Stack:** Plain HTML/CSS/JS (no build), existing UMD modules `chord_timeline.js`, `browser_api.js`, `ws_telemetry.js`; Node `assert`/`vm` tests (`tests/check_*.js`); Python tests (`tests/check_*.py`); Chrome DevTools Protocol screenshot script for visual verification.

**Spec:** `docs/superpowers/specs/2026-10-20-entire-redesign-design.md`

## Global Constraints

- No changes under `src/*.py`, `cpp_host/`, or to any `/api/*` request/response or `/ws` payload.
- Script order on both pages: `/static/chord_timeline.js` → `/static/browser_api.js` → `/static/ws_telemetry.js` → an inline `<script>` → kit → feature files.
- No external URLs in pages, CSS or scripts (offline). Font: `/static/fonts/inter-latin-wght-normal.woff2` (+ `OFL.txt`).
- Dark tokens: `--bg #000 --s1 #0F0F11 --s2 #1C1C1E --s3 #2C2C2E`, accent `#0A84FF`; light: `--bg #FFFFFF --s1 #F5F5F7 --s2 #E8E8ED --s3 #DCDCE1`, accent `#0071E3`. No gradients except functional masks/grid lines; no glow shadows.
- Glass (`.lg`) only on: Stage dock (transport capsule, tab bar, panic), phone tab bar and play button, and thumbs/droplets while dragged.
- All user-controlled strings rendered via `LW.esc()` or `textContent`.
- Honour `prefers-reduced-motion` and `prefers-reduced-transparency`.
- Theme: `data-theme` on `<html>`, follows OS until set; stored in `localStorage['lw-theme']` inside try/catch.
- Keyboard (desktop): Space play/pause, `[` set A, `]` set B, `L` loop, `Esc` (exit Stage → close sheet → stop & rewind), `T` tap tempo, `B` bookmark, `F12` panic, `P` Stage mode. Ignored while typing in inputs; modifier keys ignored.
- Every feature control carries `data-feature="<key>"` from the parity list in Task 1.

## Review Focus

1. Telemetry arriving while the user drags a fader/slider must not snap the control back (keep today's drag guards and optimistic-UI windows: drone 600 ms, warmth 1200 ms, fader `draggingFader`).
2. No song loaded / no analysis chart / no lyrics: every panel shows an empty state, Stage falls back to the live MIDI chord, nothing throws.
3. WebSocket drops and reconnects (server restart): island shows "Connection lost" then "Reconnected", UI resyncs from the next telemetry frame.
4. Names containing HTML (`<b>x</b>` as track, marker, part, setlist, pad label) render as text everywhere, including the island.
5. Narrow desktop windows (1180–1360 px) and phones (375 px): no horizontal scroll, sidebar/inspector collapse rules from the spec apply, tap targets ≥ 44 px on phone.

Tests pinning these: Task 2 (`island escapes`, `spring settles`), Task 3 (`telemetry drag guard`), Task 5 (`empty states`), Task 9 (`remote parity` + 375 px screenshot), Task 10 (`ws reconnect alert` manual check + screenshots at 1280/1440 and 375).

---

### Task 1: Move classic UI, add font, parity test scaffold

**Files:**
- Move: `src/static/index.html` → `src/static/classic/index.html`, `src/static/remote.html` → `src/static/classic/remote.html`
- Create: `src/static/fonts/inter-latin-wght-normal.woff2`, `src/static/fonts/OFL.txt`
- Create: `tests/check_redesign_parity.js`
- Create (placeholders replaced in later tasks): `src/static/index.html`, `src/static/remote.html`

**Interfaces:**
- Produces: `tests/check_redesign_parity.js` exporting nothing; run with `node tests/check_redesign_parity.js [desktop|remote|all]`. It lists `DESKTOP_FEATURES` and `REMOTE_FEATURES` arrays of `data-feature` keys and asserts each appears in the page (`data-feature="key"`).

- [ ] **Step 1:** `git mv` both pages into `src/static/classic/`. Classic pages keep their absolute `/static/...` script paths, so they work unchanged at `/static/classic/index.html` and `/static/classic/remote.html`.
- [ ] **Step 2:** Download `https://cdn.jsdelivr.net/npm/@fontsource-variable/inter@5.1.0/files/inter-latin-wght-normal.woff2` and the OFL text into `src/static/fonts/` (user approved).
- [ ] **Step 3: Write the parity test.** Keys (desktop): `engine-status, engine-popover, panic, menu, sidebar-toggle, theme, stage-mode, song-load, song-analyze, song-clear, bookmark-add, play, rewind, timecode, intel-key, intel-bpm, intel-meter, sync-click, loop-toggle, loop-a, loop-b, loop-reset, speed, waveform, markers, sections, key-shift, key-shift-reset, nashville-root, last-note, live-chord, next-chord-attention, learn-chords, piano, pedal-sustain, pedal-expression, pedal-soft, pedal-volume, lyrics, lyrics-font, lyrics-follow, prog-current, prog-next, voice-leading, measure-grid, voicing-presets, voicing-piano, audition, fader-track, fader-synth, fader-fx, fader-master, eq-canvas, eq-flat, spectrum, warmth-toggle, warmth-drive, warmth-mode, warmth-meter, metro-toggle, metro-pulse, tap-tempo, bpm, metro-sound, time-sig, click-level, scenes, scene-rename, scene-save, sheet-ear, sheet-engine, sheet-parts, sheet-fxpads, fx-bank, fx-bus, fx-stop-all, fx-pad-editor, fx-sample-upload, sheet-drone, drone-roots, drone-voice, drone-volume, drone-cutoff, drone-toggle, sheet-setlist, setlist-select, setlist-new, setlist-add, setlist-delete, library, library-upload, sheet-prefs, pref-audio, pref-buffer, pref-midi, sheet-remote, remote-qr, remote-copy, dialog-bookmark, dialog-rename-scene, dialog-confirm, dialog-new-setlist, island`. Keys (remote): `island, tab-stage, tab-pads, tab-mix, tab-parts, tab-song, play, more-menu, install, refresh, fullscreen, conn, key-select, last-note, live-chord, nashville, next-chord, drone-toggle, drone-roots, drone-voice, drone-volume, fx-bank, fx-stop-all, fx-level, fx-pads, scenes, scene-save, scene-rename, parts, part-rename, song-title, time, analyze, seek, stop, loop, bookmarks, bookmark-add, key-shift, key-shift-reset, lyrics, lyrics-font, vol-track, vol-synth, vol-master, click-level, vol-fx, metro-toggle, metro-sound, time-sig, tap-tempo, bpm, eq-bands, eq-flat, sheet-engine, sheet-ear, sheet-setlist`.
- [ ] **Step 4:** Run `node tests/check_redesign_parity.js all` → FAIL listing missing keys (placeholders have none).
- [ ] **Step 5:** Commit `chore(redesign): move classic UI, bundle Inter, add parity test`.

### Task 2: Design kit (tokens, components, springs, island)

**Files:**
- Create: `src/static/css/tokens.css`, `src/static/css/kit.css`
- Create: `src/static/js/kit/core.js` (namespace, esc, fmt, db, events, api, theme), `js/kit/spring.js`, `js/kit/icons.js`, `js/kit/controls.js`, `js/kit/island.js`, `js/kit/sheet.js`
- Create: `tests/check_redesign_kit.js`

**Interfaces (Produces):**
- `LW.esc(s): string`; `LW.fmt(sec): "m:ss"`; `LW.fmtMs(sec)`; `LW.db(lin): "x.x dB"|"-inf dB"`
- `LW.on(evt, fn)`, `LW.emit(evt, ...args)`; events used later: `telemetry(data)`, `bar`, `theme(mode)`, `view(name)`
- `LW.api.get(path)`, `LW.api.post(path, body)` → Promise of JSON; on failure emit island alert `{tone:'bad', title:'Request failed', sub: path}` and rethrow.
- `LW.theme.set('light'|'dark'|'system')`, `LW.theme.current()`
- `LW.spring(x, {response, damping, eps}, cb)` → `{to(target,{velocity,response,damping}), set(x), x, v, target}`; `LW.project(v, rate)`; `LW.rubber(over, dim)`; frame loop `LW.onFrame(fn(dt))`
- `LW.ui.press(root)`, `LW.ui.tabs(el, onChange(i,key), {draggable})` → `{select(i)}`, `LW.ui.slider(el, {min,max,value,onInput,onChange,vertical})` → `{set(v,{silent}), get(), dragging}`, `LW.ui.toggle(el, on, onChange)` → `{set(on)}`, `LW.ui.stepper(el, {min,max,value,onChange,format})`, `LW.ui.menu(button, items)`
- `LW.island.create(el, bubbleEl, {sizes, hover})` → `{alert({icon,tone,title,sub,right}, ms), update({title, sub, chord, next, pos, progress, t0, t1, playing}), bubble(on), go(state)}`; text always set via `textContent`.
- `LW.sheet(el, {onClose})` → `{open(originEl), close(), isOpen}`; `LW.dialog(el)` → `{open(), close()}`; Esc closes the top-most.

- [ ] **Step 1: Write failing tests** in `tests/check_redesign_kit.js` (load kit files in a `vm` context with a minimal `window`/`document` stub): `esc('<b>&"\'')` → `&lt;b&gt;&amp;&quot;&#39;`; `fmt(75.4)` → `"1:15"`; `db(1)` → `"0.0 dB"`, `db(0)` → `"-inf dB"`; spring from 0 to 100 with `{response:.4,damping:1}` stepped 2 s reaches 100±0.5 without overshoot >1; with `damping:.6` overshoots >100; island `update({title:'<i>x</i>'})` leaves the title node's `textContent === '<i>x</i>'` (stub records textContent assignments).
- [ ] **Step 2:** Run `node tests/check_redesign_kit.js` → FAIL (files missing).
- [ ] **Step 3:** Implement kit files, porting `lg2.css` / `lg2-core.js` from the prototype (springs, press, tabs with drag + projection + `.live` glass while dragging, slider white-thumb/glass-while-dragging, toggle, sheet, island with configurable sizes and bubble), plus `LW.api` wrapping `BrowserApi.requestJson`, `LW.theme`, `LW.ui.stepper`, `LW.ui.menu`, `LW.dialog`. `@font-face` for Inter in `tokens.css` with `font-display: swap`.
- [ ] **Step 4:** Run `node tests/check_redesign_kit.js` → PASS.
- [ ] **Step 5:** Commit `feat(redesign): design kit (tokens, springs, island, controls)`.

### Task 3: Desktop shell, telemetry hub, transport & arrangement

**Files:**
- Create: `src/static/index.html` (Studio markup for toolbar, sidebar, song header, arrangement, panels, inspector, keyboard; sheets/dialogs added in Task 7), `css/studio.css`
- Create: `js/desktop/state.js`, `js/desktop/telemetry.js` (contains `function renderTelemetry(data)`; `let lastRecordedChord`, `let lastRecordedChordTime` declared at file top, before it), `js/desktop/transport.js`, `js/desktop/waveform.js`, `js/desktop/markers.js`, `js/desktop/song.js`, `js/desktop/app.js`
- Modify: `tests/check_architecture_slice1.py` (point the chord-debounce test at `src/static/js/desktop/telemetry.js`)

**Interfaces:**
- Consumes: Task 2 kit.
- Produces: `LW.state` = `{ song, audio, midi, montage, engine, fxPads, drone, chart, lyrics, markers, scenes, activeScene }` updated by `renderTelemetry`; `LW.transport.action(name, payload)` (POST `/api/transport` with today's bodies: `toggle`, `seek {seconds}`, `toggle_loop`, `loop_a`, `loop_b`, `clear_loop`, `speed {speed}`, `stop`); `LW.song.upload(file)`, `LW.song.clear()`, `LW.song.analyze()`; `LW.markers.add(name, scene)`, `.jump(id)`, `.remove(id)`.
- Island compact shows chart chord at playhead (via `ChordTimeline.chordAtTime`) else live MIDI chord; expanded shows song/section/progress/transport.
- `LW.local.mark(key)` records a local action time; `renderTelemetry` diffs `scene`, `drone.active/root`, `song.playing`, `song.loop`, `song.filename` and shows island alert `Remote · <change>` when the key wasn't marked in the last 1500 ms.

- [ ] **Step 1: Write failing test** `telemetry drag guard` in `tests/check_redesign_desktop.js`: load `state.js` + `telemetry.js` in vm with stubbed `LW.ui` sliders; set `LW.state.dragging.track = true`; call `renderTelemetry({audio:{track_volume:.2}})`; assert track slider `set` not called; with `dragging.track=false` assert called with `.2`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Port from `classic/index.html`: `connectWS`, `renderTelemetry`, `transportAction`, `drawWaveform`, `handleWaveformClick`, loop overlay, playhead, markers (`renderMarkersUI`, `startMarkerDrag`, `jumpToMarker`, `deleteMarker`, `checkMarkerAutoSceneTrigger`), `uploadSong`, `clearSongTrack`, `triggerTrackAnalysis`, `displayTrackIntelligence`, `syncMetronomeToTrack`, key shift (`stepTrackPitch`, `setTrackPitch`, `updatePitchUI`), speed; rebind to new markup; replace `showAppToast` calls with island alerts; keyboard shortcuts per Global Constraints; engine status (`updateEngineStatusUi`) → sidebar footer row + popover; `triggerMidiPanic` → toolbar Panic; toolbar ⋯ menu (tools, theme, Stage, classic UI link); remote-origin alerts via `LW.local`. Arrangement adds a chord lane rendered from the analysis chart and a sections lane from markers.
- [ ] **Step 4:** Run desktop test → PASS; `python -m pytest tests/check_architecture_slice1.py -q` → PASS; `node tests/check_redesign_parity.js desktop` shows the Task-3 keys present.
- [ ] **Step 5:** Start the server (`.venv/Scripts/python -m src.main` in background), open `http://127.0.0.1:8080/`, load a track, play/seek/loop/A-B/speed/bookmark/drag marker/analyze; zero console errors.
- [ ] **Step 6:** Commit `feat(redesign): Studio shell, telemetry hub, transport and arrangement`.

### Task 4: Keyboard, MIDI and chord intelligence

**Files:** Create `js/desktop/keyboard.js` (piano build + live notes, pedals, last note, Nashville root, Learn Chords), `js/desktop/progression.js` (current/next, countdown, voice leading, 4-bar grid), `js/desktop/voicing.js` (presets, formula, mini piano SVG, audition), `js/desktop/lyrics.js` (render, follow, font size, highlight, click-to-seek).

**Interfaces:** Consumes `LW.state`, `LW.on('telemetry')`. Produces `LW.chords.current()` → `{chord, nashville, next, nextIn}` (used by island + Stage).

- [ ] **Step 1: Failing test** in `tests/check_redesign_desktop.js`: `empty states` — with `LW.state.chart = []`, `LW.state.lyrics = null`, calling `LW.progression.render(0)` and `LW.lyrics.render()` does not throw and sets empty-state text nodes; `LW.chords.current()` with no chart returns the live MIDI chord from `LW.state.midi`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Port `buildPiano`, `handleLiveMidiEvent`, `detectAdvancedChord`/`getChordWithNashville` usage, `onNashvilleKeyChange`, `toggleRecordChords`, `updateNextChordHUD`, `updateSongChordTracker`, `calculateVoiceLeading`, `selectVoicingExtension`, `getExtendedVoicing`, `renderMiniVoicingPiano`, `auditionCurrentVoicing`, `renderLyricsSheet`, `changeLyricsFontSize`, `toggleLyricsFollow`, `updateLyricsHighlight`, `scrollToActiveLyricLine`, `seekToSongTime`. Panels get Collapse and Expand (spring expand to fill main area, Esc returns).
- [ ] **Step 4:** Run tests → PASS; parity keys for this task present.
- [ ] **Step 5:** Browser check with real MIDI or the telemetry stream: live notes light keys, chord + Nashville update, Learn Chords records, lyrics follow and click-to-seek.
- [ ] **Step 6:** Commit `feat(redesign): keyboard, chord intelligence, voicing, lyrics`.

### Task 5: Inspector — mixer, EQ, warmth, metronome, scenes

**Files:** Create `js/desktop/mixer.js` (faders Track/Synth/FX/Master + meters incl. L/R), `js/desktop/eq.js` (contains `function drawEqSpline()` followed by `function renderEqInspectors()`; colours resolved via `BrowserApi.resolveCssToken`, never `var(--…)` in canvas calls), `js/desktop/warmth.js`, `js/desktop/metronome.js`, `js/desktop/scenes.js`. Modify `tests/check_architecture_slice1.py` (canvas-EQ test → `src/static/js/desktop/eq.js`).

**Interfaces:** Consumes `LW.ui.slider` (vertical), `LW.state`. Produces `LW.mixer.set(channel, lin)`, `LW.scenes.select(n)`, `.save()`, `.rename(n, label)` (used by Stage Mix sheet and markers' auto-scene).

- [ ] **Step 1:** Port `startFaderDrag`/`updateMixer`/`renderCustomFaders` semantics (same `/api/mixer` and `/api/montage/volume` bodies, same 0–1.5 FX range, synth 0–127), EQ (`computeEqResponseAtFreq`, `drawEqSpline`, band dragging, `resetEqFlat`, `toggleSpectrumAnalyzer` via `/api/master/dsp`), warmth (`toggleStageWarmth`, `onWarmthDriveInput`, `setWarmthMode`, debounce, 1200 ms guard), metronome (`toggleMetronome`, `handleTapTempo`, BPM 40–280, sound, time signature, click level 0–2.0 with "Boost" label), scenes (`renderScenesUI`, `selectScene`, `saveCurrentScene`, rename dialog).
- [ ] **Step 2:** Run `python -m pytest tests/check_architecture_slice1.py -q` → PASS; parity keys present.
- [ ] **Step 3:** Browser check: drag each fader while telemetry streams (no snap-back), EQ band drag + flat + FFT, warmth, click/tap/BPM/sound/sig/level, scene select/save/rename; inspector tabs spring; collapse rule at 1280 px.
- [ ] **Step 4:** Commit `feat(redesign): inspector mixer, EQ, warmth, metronome, scenes`.

### Task 6: Sheets — tools

**Files:** Create `js/desktop/fxpads.js`, `js/desktop/drone.js`, `js/desktop/parts.js`, `js/desktop/engine.js`, `js/desktop/ear.js`, `js/desktop/setlist.js`, `js/desktop/prefs.js`, `js/desktop/remoteqr.js`; add the sheet/dialog markup to `index.html`.

**Interfaces:** Consumes `LW.sheet`, `LW.dialog`, `LW.api`. Produces `LW.sheets.open(name)` for names `fxpads|drone|parts|engine|ear|setlist|prefs|remote` (used by sidebar, toolbar menu and Stage dock); `LW.drone.toggle()`, `LW.drone.setRoot(i)`; `LW.fx.trigger(padId)`; `LW.setlist.loadSong(idx)`.

- [ ] **Step 1:** Port each modal's logic unchanged in protocol: FX pads (`selectFxBank`, `triggerFxPad`, `stopAllFxPads`, `renderDesktopFxPads`, editor fields, `assignFxPadSound`, `uploadCustomFxSample`, bus fader), drone (600 ms guard, roots, voice, volume, cutoff, start/stop; island bubble on while active), parts (`renderDesktopParts` volume/reverb/params/voice catalog/mute/solo/rename via `/api/montage/names`), engine (`chooseEngine`, open GUI, kill, status badges), ear training (4 modules, score/streak, replay, choices), setlist & library (all CRUD, reorder, confirm dialog, load & apply snapshot, quick add, upload), preferences (`loadDevices`, audio device, buffer, MIDI device, hot-plug refresh, shortcut list, theme selector), remote QR (`/api/remote-info`, copy URL).
- [ ] **Step 2:** `node tests/check_redesign_parity.js desktop` → PASS (all desktop keys).
- [ ] **Step 3:** Browser check every sheet and dialog in light and dark; Esc and drag-to-dismiss close sheets; untrusted-name check: rename a part and a marker to `<b>x</b>` and confirm literal text everywhere including island.
- [ ] **Step 4:** Commit `feat(redesign): tool sheets (pads, drone, parts, engine, ear, setlist, prefs, remote)`.

### Task 7: Stage mode

**Files:** Create `css/stage.css`, `js/desktop/stage.js`; Stage overlay markup in `index.html`.

**Interfaces:** Consumes `LW.chords.current()`, `LW.state.chart`, `LW.sheets`, `LW.mixer`, `LW.scenes`, `LW.fx`, `LW.drone`, `LW.setlist`. Produces `LW.stage.enter()`, `.exit()`, `.active`.

- [ ] **Step 1:** Build overlay per spec (song chip, hero chord + Nashville + lyric line, next card with ring, runway from chart with section labels and now-line, glass dock: transport capsule, tab bar Play/Mix/Pads/Drone/Setlist opening solid sheets anchored above the dock with drag-to-dismiss, Panic). Fallback to live MIDI chord with runway hidden when chart is empty. `P` toggles, `Esc` exits; entering/exiting animates (materialise, no blocking).
- [ ] **Step 2:** Browser check with and without an analysed song; sheets operate the same backend actions as Studio.
- [ ] **Step 3:** Commit `feat(redesign): Stage performance mode`.

### Task 8: Phone remote

**Files:** Create `src/static/remote.html`, `css/remote.css`, `js/remote/app.js`, `js/remote/stage.js`, `js/remote/pads.js`, `js/remote/mix.js`, `js/remote/parts.js`, `js/remote/song.js`, `js/remote/sheets.js` (engine, ear, setlist, bookmark, rename part/scene). `js/remote/stage.js` declares `let g_lastRemoteDroneInteraction = 0;` at top before any use. Modify `tests/check_architecture_slice1.py` remote-drone test → `src/static/js/remote/stage.js`.

**Interfaces:** Consumes kit. Mirrors the classic remote's endpoints/bodies exactly (see `classic/remote.html` functions listed in the spec's phone map).

- [ ] **Step 1:** Port the classic remote's logic per tab (Stage: key select, last note, chord/Nashville/next, drone; Pads; Mix: volumes, metronome, EQ bands; Parts: scenes + parts 1–8 with params and voice assign; Song: title/time/seek/stop/play/loop/bookmarks/key shift/analyze/lyrics + font size). Tab bar with draggable droplet, round play button, pages on a spring + swipe, "⋯" menu (engine, ear, setlist, refresh, fullscreen, install via `beforeinstallprompt`), phone island alerts for every action, connection status in island + menu.
- [ ] **Step 2:** `node tests/check_redesign_parity.js remote` → PASS; `python -m pytest tests/check_architecture_slice1.py -q` → PASS.
- [ ] **Step 3:** Browser check at 375×812 (mobile emulation) light/dark: every tab and sheet, tap targets ≥ 44 px, no horizontal scroll; desktop island shows "Remote" alerts for phone-originated changes.
- [ ] **Step 4:** Commit `feat(redesign): phone remote`.

### Task 9: PWA, tests, docs, full verification

**Files:** Modify `src/static/sw.js` (cache name `litwave-remote-v3`; precache new remote shell, css/js/kit, `js/remote/*`, font), `src/static/manifest.json` (theme/background colours `#000000`), `tests/check_frontend_extraction.js` (syntax-check new `js/**` files), `README.md` (frontend section: new file layout, classic fallback paths, script order).

- [ ] **Step 1:** Update files above; keep `/api/`, `/ws`, `/static/uploads/` network bypass.
- [ ] **Step 2:** Run all: `node tests/check_frontend_extraction.js`, `node tests/check_chord_timeline.js`, `node tests/check_redesign_kit.js`, `node tests/check_redesign_desktop.js`, `node tests/check_redesign_parity.js all`, `.venv/Scripts/python -m pytest tests -q -k "not realtime and not adversarial"` → all PASS (report any hardware-only skips).
- [ ] **Step 3:** Screenshot pass with the CDP script at 1280×800, 1440×900 (Studio, Stage, each sheet) and 375×812 (each phone tab), light and dark; restart the server mid-session to verify island "Connection lost"/"Reconnected".
- [ ] **Step 4:** Commit `chore(redesign): PWA cache, tests, docs`.
