const assert = require("assert");
const {
  chordAtTime,
  nextPlayableChord,
  playableChord,
  detectAdvancedChord,
} = require("../src/static/chord_timeline.js");

const chart = [
  { time: 0, end: 2, chord: "C" },
  { time: 2, end: 3, chord: "N" },
  { time: 3, duration: 1, chord: "X" },
  { time: 4, end: 4.5, chord: "G" },
  { time: 4.5, end: 5, chord: "Am" },
];

assert.strictEqual(chordAtTime(chart, -1), null);
assert.strictEqual(chordAtTime(chart, 1.9).chord, "C");
assert.strictEqual(playableChord(chordAtTime(chart, 2.5)), null);
assert.strictEqual(chordAtTime(chart, 5), null);
assert.strictEqual(nextPlayableChord(chart, 2.5).chord, "G");
assert.strictEqual(nextPlayableChord(chart, 3.95).chord, "G");
assert.strictEqual(nextPlayableChord(chart, 4.1).chord, "Am");
assert.strictEqual(nextPlayableChord(chart, 5), null);

const legacy = [{ time: 1, chord: "Dm" }, { time: 3, chord: "F" }];
assert.strictEqual(chordAtTime(legacy, 2.5).chord, "Dm");
assert.strictEqual(chordAtTime(legacy, 99).chord, "F");

const manualOverride = [
  { time: 0, end: 4, chord: "C", source: "btc" },
  { time: 2, chord: "Dm", source: "manual" },
];
assert.strictEqual(chordAtTime(manualOverride, 3).chord, "Dm");

// Chord detector: minimum 3 detected MIDI key notes required before chord detection
assert.strictEqual(detectAdvancedChord(null), "--");
assert.strictEqual(detectAdvancedChord([]), "--");
assert.strictEqual(detectAdvancedChord([60]), "--");
assert.strictEqual(detectAdvancedChord([60, 67]), "--");
assert.strictEqual(detectAdvancedChord([60, 64]), "--");
assert.strictEqual(detectAdvancedChord([60, 64, 67]), "C");
assert.strictEqual(detectAdvancedChord([60, 63, 67]), "Cm");

console.log("PASS: chord timeline interval and detector checks");
