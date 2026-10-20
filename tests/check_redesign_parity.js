// Feature-parity guard for the redesigned UI.
// Every feature that existed in the classic UI (src/static/classic/) must have a
// control in the new pages, marked with data-feature="<key>".
//   node tests/check_redesign_parity.js [desktop|remote|all]
const fs = require("fs");
const path = require("path");
const assert = require("assert");

const STATIC_DIR = path.join(__dirname, "..", "src", "static");

const DESKTOP_FEATURES = [
  "engine-status", "engine-popover", "panic", "menu", "sidebar-toggle", "theme", "stage-mode",
  "song-load", "song-analyze", "song-clear", "bookmark-add", "play", "rewind", "timecode",
  "intel-key", "intel-bpm", "intel-meter", "sync-click", "loop-toggle", "loop-a", "loop-b", "loop-reset", "speed",
  "waveform", "markers", "sections", "key-shift", "key-shift-reset",
  "nashville-root", "last-note", "live-chord", "next-chord-attention", "learn-chords", "piano",
  "pedal-sustain", "pedal-expression", "pedal-soft", "pedal-volume",
  "lyrics", "lyrics-font", "lyrics-follow",
  "prog-current", "prog-next", "voice-leading", "measure-grid", "voicing-presets", "voicing-piano", "audition",
  "fader-track", "fader-synth", "fader-fx", "fader-master", "eq-canvas", "eq-flat", "spectrum",
  "warmth-toggle", "warmth-drive", "warmth-mode", "warmth-meter",
  "metro-toggle", "metro-pulse", "tap-tempo", "bpm", "metro-sound", "time-sig", "click-level",
  "scenes", "scene-rename", "scene-save",
  "sheet-ear", "sheet-engine", "sheet-parts", "sheet-fxpads", "fx-bank", "fx-bus", "fx-stop-all", "fx-pad-editor", "fx-sample-upload",
  "sheet-drone", "drone-roots", "drone-voice", "drone-volume", "drone-cutoff", "drone-toggle",
  "sheet-setlist", "setlist-select", "setlist-new", "setlist-add", "setlist-delete", "library", "library-upload",
  "sheet-prefs", "pref-audio", "pref-buffer", "pref-midi", "sheet-remote", "remote-qr", "remote-copy",
  "dialog-bookmark", "dialog-rename-scene", "dialog-confirm", "dialog-new-setlist", "island",
];

const REMOTE_FEATURES = [
  "island", "tab-stage", "tab-pads", "tab-mix", "tab-parts", "tab-song", "play", "more-menu", "install", "refresh",
  "fullscreen", "conn", "key-select", "last-note", "live-chord", "nashville", "next-chord",
  "drone-toggle", "drone-roots", "drone-voice", "drone-volume",
  "fx-bank", "fx-stop-all", "fx-level", "fx-pads", "scenes", "scene-save", "scene-rename", "parts", "part-rename",
  "song-title", "time", "analyze", "seek", "stop", "loop", "bookmarks", "bookmark-add", "key-shift", "key-shift-reset",
  "lyrics", "lyrics-font", "vol-track", "vol-synth", "vol-master", "click-level", "vol-fx",
  "metro-toggle", "metro-sound", "time-sig", "tap-tempo", "bpm", "eq-bands", "eq-flat",
  "sheet-engine", "sheet-ear", "sheet-setlist",
];

function featuresIn(html) {
  const found = new Set();
  const re = /data-feature="([^"]+)"/g;
  let m;
  while ((m = re.exec(html)) !== null) m[1].split(/\s+/).forEach((k) => found.add(k));
  return found;
}

function check(page, keys) {
  const html = fs.readFileSync(path.join(STATIC_DIR, page), "utf8");
  const found = featuresIn(html);
  const missing = keys.filter((k) => !found.has(k));
  assert.strictEqual(missing.length, 0, `${page} is missing ${missing.length} feature(s): ${missing.join(", ")}`);
  console.log(`PASS: ${page} has all ${keys.length} features`);
}

const which = process.argv[2] || "all";
let failed = false;
for (const [name, page, keys] of [["desktop", "index.html", DESKTOP_FEATURES], ["remote", "remote.html", REMOTE_FEATURES]]) {
  if (which !== "all" && which !== name) continue;
  try { check(page, keys); } catch (e) { failed = true; console.error("FAIL:", e.message); }
}
if (failed) process.exit(1);
