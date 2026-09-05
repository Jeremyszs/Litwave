(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ChordTimeline = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  function chordEnd(chart, index) {
    const chord = chart[index];
    if (Number.isFinite(chord.end)) return chord.end;
    if (Number.isFinite(chord.duration)) return chord.time + chord.duration;
    return index + 1 < chart.length ? chart[index + 1].time : Infinity;
  }

  function chordAtTime(chart, seconds) {
    if (!Array.isArray(chart)) return null;
    for (let index = chart.length - 1; index >= 0; index -= 1) {
      const chord = chart[index];
      if (seconds >= chord.time && seconds < chordEnd(chart, index)) return chord;
    }
    return null;
  }

  function playableChord(chord) {
    return chord && chord.chord !== "N" && chord.chord !== "X" ? chord : null;
  }

  function nextPlayableChord(chart, seconds) {
    if (!Array.isArray(chart)) return null;
    return chart.find(chord => chord.time > seconds + Number.EPSILON && playableChord(chord)) || null;
  }

  return { chordAtTime, nextPlayableChord, playableChord };
});
