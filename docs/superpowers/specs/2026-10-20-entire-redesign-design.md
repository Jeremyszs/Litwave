# Litwave entire redesign: design

Date: 2026-10-20 · Branch: `entire-redesign` (from `main` @ 579e6b2)

## Intent

Litwave's desktop studio (`src/static/index.html`) and phone remote (`src/static/remote.html`) work, but they look like a dense debug panel: small mono text, inline styles everywhere, floating windows, menus of modals. The owner wants a complete visual and interaction redesign that feels like a modern Apple product (Liquid Glass era, Dynamic Island, physical spring motion) while still reading as a DAW. The approved direction is the "v2" prototype in `.superpowers/brainstorm/…/content/litwave-v2.html`: pitch black / white surfaces, a single Apple-blue accent, glass only for floating controls, a Dynamic Island for status and feedback, springs everywhere.

Success: every feature that exists today still works, from both desktop and phone, and the app looks and moves like the prototype.

## Goals

1. Replace the desktop UI with **Studio** (DAW layout) plus a full-screen **Stage** performance mode (toggle with a toolbar button or `P`, leave with `Esc`).
2. Replace the phone remote with the prototype's phone design (tab bar + separate play button + its own Dynamic Island).
3. **Feature parity**: every control, readout, modal, shortcut and live behaviour in the inventory below exists in the new UI (§ Feature map).
4. Light and dark themes. Dark = `#000` background; light = `#FFFFFF` with Apple grey `#F5F5F7` cards. Follows the OS setting by default, with a manual override that is remembered.
5. Dynamic Island on both desktop and phone: live chord/position when idle, expands to a now-playing card, and shows short alerts for every meaningful action or state change (replaces today's toast banner).
6. Keep the current UI reachable as a fallback at `/static/classic/index.html` and `/static/classic/remote.html`.

## Non-goals

- No backend changes. Every `/api/*` endpoint, request body and the `/ws` telemetry payload stay exactly as they are. The new UI speaks the same protocol as today's UI.
- No build step, framework or bundler. Plain HTML/CSS/JS served from `src/static/`, like today.
- No new product features beyond what the redesign needs (the island, Stage mode, theme toggle). Things the prototypes faked (e.g. "Your playing" MIDI lane, analysis confidence %) are only included if the data already exists.

## Anti-goals (would make this a failure even if it "works")

- Any existing feature missing or harder to reach on stage than today (e.g. Panic more than one click/key away).
- Heavy glass, glossy reflections, gradients, glows, or bright wallpaper backgrounds (explicitly rejected).
- Glass on content surfaces (panels, tiles, lists, sheets). Glass is only for controls that float over content.
- Motion that blocks input or can't be interrupted; jank on the 25 fps telemetry stream.
- Breaking offline use (fonts and assets must be local).

## Constraints

- Windows desktop, Chromium-based browsers for desktop; phone remote on iOS Safari / Android Chrome as a PWA (`manifest.json`, `sw.js`).
- Offline at venues: Inter is bundled as a local `woff2` (SIL OFL) under `src/static/fonts/`; no CDN links anywhere.
- The three shared modules stay and load first, in this order, on both pages: `/static/chord_timeline.js` → `/static/browser_api.js` → `/static/ws_telemetry.js`, followed by an inline `<script>` (asserted by `tests/check_frontend_extraction.js` and `tests/check_doc_and_quality.py`).
- Untrusted strings (track names, marker names, part names, setlist names, lyrics) must keep going through `escapeHtml` / `textContent` exactly as `main` now does.
- `prefers-reduced-motion` and `prefers-reduced-transparency` must be honoured.

## Decisions made with the owner

| Topic | Decision |
|---|---|
| Desktop layout | Studio is the main workspace; Stage is a full-screen performance mode toggled from Studio |
| Base branch | `main` (has the escaping / API-error / WS-reconnect fixes) |
| Font | Inter, bundled locally |
| Old UI | Kept as a fallback under `/static/classic/` |
| Colour | Pitch black dark theme, white light theme, Apple system blue (`#0A84FF` dark / `#0071E3` light) as the only accent, no gradients |
| Glass | Only floating controls (Stage dock, phone tab bar + play button); slider thumbs and tab droplets turn to glass only while dragged |
| Island | Loved; used for all interaction feedback on desktop and phone |

## Design language

Tokens (from `lg2.css` in the prototype):

- Dark: `--bg #000`, `--s1 #0F0F11` (cards), `--s2 #1C1C1E` (controls), `--s3 #2C2C2E`, ink `#F5F5F7` / 62% / 34%, separators `rgba(255,255,255,.08)`.
- Light: `--bg #FFF`, `--s1 #F5F5F7`, `--s2 #E8E8ED`, `--s3 #DCDCE1`, ink `#1D1D1F` / `#6E6E73` / `#A1A1A6`.
- Accent: one blue; tints at 10–16% and 20–30% for selected states. Status colours: green `#30D158` (ok/on), red `#FF453A` (panic, errors, delete), yellow `#FFD60A` (solo), orange `#FF9F0A` (recording / Learn Chords).
- Type: Inter (variable), tabular numerals for all numbers; tight tracking on large display numbers (chords), body ~13–15px. Monospace is dropped except where alignment needs it (timecode uses tabular Inter).
- Radii: concentric; controls 8–12px, cards 18–26px, sheets 30px, capsules fully round.
- Motion: one spring engine (damping ratio + response, Apple-style): defaults damping 1 / response .35–.45; bounce (damping ~.75) only for momentum or "arrival" moments (island expansion, tab droplet, toggles). All animations interruptible; animate transform/opacity; reduced-motion swaps to cross-fades.

Reusable UI kit (ported from the prototype `lg2-core.js`): spring engine, press feedback, Dynamic Island + secondary bubble, liquid tab bar / segmented control (draggable droplet), slider (white thumb, glass while dragged), vertical fader, switch, stepper, sheet (materialises from its trigger, drag to dismiss), modal sheet (centred, solid, dims background), menu/popover, rolling text, toast→island adapter.

## Desktop: Studio

```
┌ sidebar ─────────┐┌ toolbar: [☰] [⏮ ▶ ⟲ A B ✕] [click]   ▣ ISLAND ▣   [speed] [Perform] [📱] [⚠ Panic] [⋯] ┐
│ search           │├──────────────────────────────────────────────────────────────┬ inspector ───────────┤
│ Setlist ▾  + ⋯   ││ Song header: title · key · BPM · meter [Sync click]          │ [Mix | EQ | Click]   │
│  1 Song  E·120   ││   [Load] [Analyze] [+ Bookmark] [Clear]                      │                      │
│  2 …             ││ Arrangement: time ruler + loop band                           │ Mix: Track/Synth/    │
│ Library          ││   waveform (canvas) + markers + playhead                      │  FX/Master faders,   │
│ Instruments      ││   chord lane (analysis chart)                                 │  meters, Key shift   │
│  Drone Pad   (◉) ││   sections lane (bookmarks)                                   │ EQ: spline canvas,   │
│  FX Pads      ›  ││ ┌ Chord panel ──────────────┐┌ Lyrics ───────────────┐     │  FFT, Stage Warmth   │
│  Parts Mixer  ›  ││ │ now / next / countdown,   ││ follow · font size    │     │ Click: metronome,    │
│  Sound Engine ›  ││ │ 4-bar grid, voicing, mini ││ synced lines          │     │  tap, sig, sound,    │
│  Ear Training ›  ││ └───────────────────────────┘└───────────────────────┘     │  level; Scenes 1–8   │
│ ● Audio status   ││ Keyboard: live chord · Nashville root · Learn · piano · pedals│                      │
└──────────────────┘└──────────────────────────────────────────────────────────────┴──────────────────────┘
```

- Sidebar and inspector are solid cards that collapse with a spring (sidebar toggle; inspector collapses from its header). Panel content is solid; nothing in Studio is glass except dragged thumbs/droplets.
- Today's "Float" windows and accordion minimise become: collapsible sidebar/inspector, collapsible chord/lyrics/keyboard panels, and an **Expand** action on the chord, lyrics and keyboard panels that grows the panel to fill the main area (Deck-style spring expand; `Esc` returns). *(Builder's call recorded below; owner may override.)*
- Instrument rows open their tools as **solid sheets** (FX Pads, Parts Mixer, Sound Engine, Ear Training, Drone Pad detail, Setlist management, Preferences, Phone remote QR). Small confirmations (new setlist, rename, bookmark, delete confirm) are compact centred dialogs.
- The audio-engine popover opens from the sidebar status row and from the island's expanded view.

## Desktop: Stage mode

Full-screen overlay on pitch black/white:

- Island at top, song chip (title, key, BPM) top-left, Exit (and theme) top-right.
- Hero: section chip + key, giant current chord with Nashville, current synced lyric line.
- Next card with beat/second countdown ring and the next chord.
- Chord runway: the real analysis chord chart scrolling past a now-line, section labels above.
- Floating glass dock: transport capsule (rewind, play/pause, loop), liquid tab bar (Play · Mix · Pads · Drone · Setlist) whose tabs open solid sheets anchored above the dock (drag down to close), and a Panic button.
- When no analysis chart exists, Stage shows the live MIDI chord as the hero and hides the runway.

## Phone remote

- iPhone-style shell: status-safe top area, its own Dynamic Island, large titles, floating glass tab bar with five tabs plus a separate round glass play/pause button.
- Tabs: **Stage**, **Pads**, **Mix**, **Parts**, **Song**. A top-right "⋯" menu holds Sound Engine, Ear Training, Setlist, Refresh, Fullscreen, Install App.
- Pages slide horizontally on a spring when switching tabs; swiping between tabs still works.
- Every phone action gives island feedback on the phone. The desktop island shows an alert when a state change arrives over telemetry that the desktop itself did not initiate (scene, drone on/off/root, pad trigger, transport, song loaded, loop), labelled "Remote".

## Dynamic Island behaviour (both clients)

- Compact: live chord (song chart chord while playing, otherwise live MIDI chord), bar.beat or time, progress ring.
- Expanded (desktop hover/click, phone tap): song title, section · key · BPM, now chord, progress + times, prev-section / play / next-section, next chord.
- Alerts (1.2–2.4 s): device/engine connected or lost, MIDI panic, song loaded, analysis started/finished/failed, bookmark added, scene recalled/saved, setlist changes, pad triggered (phone), API errors (red). Replaces `showAppToast` / `showRemoteToast`.
- Secondary bubble: drone pad running (tap opens Drone).

## Feature map (parity checklist)

Everything below exists today and must exist after. "→" says where it lives in the new UI.

### Desktop
- Engine status pill + popover (driver/host, device, sample rate, buffer, latency, DSP load/peak, XRUNs, stable/warning) → sidebar footer row + popover; island alert on state change.
- Panic (button + F12) → toolbar + Stage dock.
- Tools menu (Ear Training, Parts Mixer, FX Pads, Drone Pad, Live Setlist, Phone Remote QR, VST Sound Engine, Preferences) → sidebar Instruments + toolbar ⋯ menu.
- Backing track: status, filename, Load (mp3/wav/flac/ogg/m4a upload), Analyze, Clear, + Bookmark (B), Play/Pause (Space), Rewind, Stop & rewind (Esc in Studio when not in a sheet/Stage), timecode, intel badge (key, BPM, meter, Sync Click), Loop toggle (L), Set A ([), Set B (]), Reset loop, Speed 0.75/0.85/1.0/1.15/1.25 → toolbar + song header.
- Waveform canvas, click to seek, loop overlay, playhead, empty state, marker flags draggable, sections ribbon (jump, delete, auto-scene trigger on playback) → arrangement.
- Input telemetry: MIDI status, Nashville root select, last note, chord name + Nashville, next-chord attention + countdown, Learn Chords (record) toggle, chord notes, piano keyboard with live notes, pedals CC64/CC11/CC67/CC7 → keyboard panel.
- Lyrics: font size −/+, Follow toggle, synced highlight, click a line to seek, auto-scroll → lyrics panel.
- Song progression: current chord + timecode + Nashville + voicing notes; next chord + countdown + voice-leading tip; 4-bar harmonic grid; voicing presets Root/1st/2nd/7th/Add9, formula, notes, mini piano, Audition → chord panel.
- Key shift −12…+12, step, Reset → inspector Mix.
- Output mixer: Track, Synth, FX Pads, Master (L/R meters) faders with dB, EQ Flat → inspector Mix.
- Master EQ: 4-band spline canvas with draggable bands, FFT spectrum toggle, frequency axis, band legend → inspector EQ.
- Stage Warmth: on/off, drive 1.0–2.5, Tape/Crisp, saturation meter → inspector EQ.
- Metronome: on/off, pulse, Tap (T), BPM 40–280, sound (treble/woodblock/beep), time signature (4/4 3/4 6/8 5/4 7/8 2/4), click level 0–200 % → inspector Click (+ toolbar click toggle).
- Scenes 1–8: select, rename, save mix → inspector Click & Scenes (and Stage Mix sheet).
- Ear Training: modules chord quality / progressions / melody / intervals, question, replay, feedback, choices, next, score + streak → sheet.
- Sound Engine: Yamaha / Community choice, running badges, status, Launch/Open GUI, Kill → sheet.
- Parts Mixer 1–8: volume, reverb, rename, attack/release/cutoff/resonance/chorus/pan, voice preset assign (catalog), mute, solo → sheet.
- Bookmark dialog: name, auto-trigger scene → dialog.
- Phone Remote: QR, URL, copy → sheet.
- Rename scene → dialog.
- FX Pads: Stop All, banks A–F (Perc/Hits/Trans/Special/Wide/Live), bus level, 8 pads per bank with live playing state, pad editor (sound from catalog, trigger mode one-shot/gate/toggle, label, choke group, pitch, sample path, replace sample upload) → sheet (+ Stage Pads sheet).
- Drone Pad: status, 12 roots, voice (10 presets), volume, cutoff/warmth, start/stop → sheet + sidebar switch + island bubble (+ Stage Drone sheet).
- Setlist & Library: setlist select, new, add current song, delete, song list (load & apply snapshot, move up/down, remove), library list (load, quick add to setlist, upload new), confirm dialog → sidebar + sheet (+ Stage Setlist sheet).
- Preferences: audio device, buffer size, MIDI input (hot-plug refresh), shortcut list (plus theme) → sheet.
- Telemetry-driven sync of all of the above (faders, metronome, warmth, analyzer, drone, pads, scenes, transport, MIDI, devices).

### Phone
- Header: prev/next page, page title + dots, Install App (PWA), Refresh, VST engine, Fullscreen, connection status → tab bar + "⋯" menu + island.
- Page 1 Chords & Drone: song key select, MIDI last note, giant chord, Nashville, next + countdown, drone start/stop, 12 roots, voice, volume → **Stage** tab.
- Page 2 FX Pads: banks A–F, Stop All, level, 8 pads with live state → **Pads** tab.
- Page 3 Scenes + Parts 1–8: select, save mix, rename; part volume, reverb, params, voice assign, mute, solo, rename, engine badge → **Parts** tab.
- Page 4 Backing track: time, title, Analyze, Ear, Setlist, seek, Stop, Play, Loop, bookmarks jump + add (with auto-scene), key shift ±/Reset; lyrics with font size → **Song** tab.
- Page 5 Output: track, synth, master, click level, FX level, metronome toggle, sound, time signature, Tap, BPM, 4-band EQ sliders, EQ Flat → **Mix** tab.
- Dialogs: engine, bookmark, rename part, rename scene, setlist (setlist + library), ear training (chords/progressions/intervals) → sheets.
- Toast → phone island.

## Architecture

```
src/static/
  index.html            Studio + Stage shell (markup only + inline bootstrap)
  remote.html           Phone shell
  fonts/inter-latin-wght-normal.woff2   (+ OFL license file)
  css/tokens.css        themes, type, radii
  css/kit.css           shared components (buttons, sliders, island, sheets, tabs…)
  css/studio.css        desktop layout
  css/stage.css         Stage mode
  css/remote.css        phone layout
  js/kit/*.js           springs, island, controls, sheets, icons, theme, escape
  js/desktop/*.js       one file per feature area (transport, waveform, markers,
                        lyrics, progression, voicing, keyboard/midi, mixer, eq,
                        warmth, metronome, scenes, parts, fxpads, drone, setlist,
                        ear, engine, prefs, remote-qr, telemetry, stage, app)
  js/remote/*.js        phone feature files + app
  classic/index.html    today's main UI, unchanged except asset paths
  classic/remote.html
  chord_timeline.js, browser_api.js, ws_telemetry.js   (unchanged)
  sw.js, manifest.json  (cache list updated, cache version bumped)
```

- Scripts are classic `<script>` tags sharing one namespace object `window.LW` (no ES modules, so the pages keep working when opened the same way as today). Load order: the three shared modules, then the inline bootstrap, then kit, then feature files, then `app.js`.
- Feature logic (API calls, state, telemetry handling) is ported from today's inline scripts with the same endpoints and payloads, re-bound to the new markup. Where the existing logic has known-good guards (optimistic-UI windows, drag guards, debounces, escaping), they are kept.
- `tests/check_architecture_slice1.py` structural checks are retargeted to the files that now hold `renderTelemetry`, `drawEqSpline`/`renderEqInspectors`, the chord debounce variables, and the remote drone-interaction variable; the invariants stay the same.

## Verification

- Existing test suites run green (`tests/*.py` that don't need audio hardware, `node tests/check_*.js`).
- Each page loads with no console errors against the real server; every feature in the parity checklist is exercised by hand in the browser (desktop + phone viewport), light and dark, with screenshots.
- A small "fake telemetry" dev harness is allowed (behind a query flag) to exercise the UI without hardware.

## Calls made by the builder (owner may override)

1. Floating windows → collapsible panels + "Expand to fill" (no free-floating draggable windows).
2. Phone tabs are Stage / Pads / Mix / Parts / Song with a "⋯" menu for the rest.
3. Desktop island labels phone-originated changes as "Remote" (the server doesn't say which client acted).
4. Theme follows the OS until the user picks one.
5. Classic UI lives at `/static/classic/…` (no new server routes, so no backend change).
6. Stage mode shortcut `P`; `Esc` exits Stage first, otherwise keeps today's meaning (stop & rewind).
7. Desktop target is 1280 px wide and up; below ~1360 px the inspector starts collapsed and below ~1180 px the sidebar does too (both reopen as overlays). The phone layout is used under 760 px and is centred with a max width on tablets.

## Left to the builder

File split inside `js/desktop` and `js/remote`, exact spacing, icon drawings, copy wording, spring constants within the stated ranges, and the fake-telemetry harness shape.
