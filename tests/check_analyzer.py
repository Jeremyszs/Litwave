"""Focused regression checks for chord analysis post-processing."""
import math
import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import numpy as np
import src.analyzer as analyzer
from src.analyzer import chord_duration_totals, clean_chord_name, estimate_key, postprocess_chords


def test_silent_chroma_has_no_defensible_key():
    assert estimate_key(np.zeros(12)) is None


def test_key_weighting_uses_real_duration_and_normalized_roots():
    totals = chord_duration_totals([
        {"start": 0.0, "end": 8.0, "chord": "Bb"},
        {"start": 8.0, "end": 9.0, "chord": "A#"},
        {"start": 9.0, "end": 12.0, "chord": "Gm7"},
        {"start": 12.0, "end": 14.0, "chord": "N"},
    ])
    assert totals == {"A#": 9.0, "Gm7": 3.0}


def _run_stub_analysis(model):
    saved = (
        analyzer.get_btc_model,
        analyzer.librosa.load,
        analyzer.librosa.get_duration,
        analyzer.librosa.onset.onset_strength,
        analyzer.librosa.beat.beat_track,
        analyzer.librosa.frames_to_time,
        analyzer.librosa.feature.chroma_cqt,
    )
    try:
        analyzer.get_btc_model = lambda: model
        analyzer.librosa.load = lambda *args, **kwargs: (np.zeros(22050, dtype=np.float32), 22050)
        analyzer.librosa.get_duration = lambda **kwargs: 1.0
        analyzer.librosa.onset.onset_strength = lambda **kwargs: np.zeros(1)
        analyzer.librosa.beat.beat_track = lambda **kwargs: (np.array([0.0]), np.array([], dtype=int))
        analyzer.librosa.frames_to_time = lambda *args, **kwargs: np.array([])
        analyzer.librosa.feature.chroma_cqt = lambda **kwargs: np.ones((12, 1))
        return analyzer.analyze_track(__file__)
    finally:
        (
            analyzer.get_btc_model,
            analyzer.librosa.load,
            analyzer.librosa.get_duration,
            analyzer.librosa.onset.onset_strength,
            analyzer.librosa.beat.beat_track,
            analyzer.librosa.frames_to_time,
            analyzer.librosa.feature.chroma_cqt,
        ) = saved


def test_unavailable_model_fails_instead_of_fabricating_c_major():
    try:
        _run_stub_analysis(None)
    except RuntimeError as error:
        assert "unavailable" in str(error).lower()
    else:
        raise AssertionError("Unavailable BTC model fabricated a chord chart")


def test_zero_tempo_does_not_divide_by_zero():
    class Model:
        def predict(self, _audio):
            return [{"start": 0.0, "end": 1.0, "chord": "C"}]

    result = _run_stub_analysis(Model())
    assert result["bpm"] == 0.0
    assert result["chords"] == [{"time": 0.0, "end": 1.0, "chord": "C", "nashville": "1", "duration": 1.0}]


def test_no_chord_and_unknown_labels_remain_distinct():
    assert clean_chord_name("N") == "N"
    assert clean_chord_name("X") == "X"


def test_every_btc_large_vocabulary_quality_has_practice_notation():
    expected = {
        "min": "Cm", "maj": "C", "dim": "Cdim", "aug": "Caug",
        "min6": "Cm6", "maj6": "C6", "min7": "Cm7", "minmaj7": "CmMaj7",
        "maj7": "CMaj7", "7": "C7", "dim7": "Cdim7", "hdim7": "Cm7b5",
        "sus2": "Csus2", "sus4": "Csus4",
    }
    assert {quality: clean_chord_name(f"C:{quality}") for quality in expected} == expected


def test_short_chords_are_preserved():
    raw = [
        {"start": 0.0, "end": 2.0, "chord": "C"},
        {"start": 2.0, "end": 2.5, "chord": "G"},
        {"start": 2.5, "end": 3.0, "chord": "Am"},
        {"start": 3.0, "end": 5.0, "chord": "F"},
    ]
    assert [c["chord"] for c in postprocess_chords(raw, 5.0)] == ["C", "G", "Am", "F"]


def test_no_chord_and_unknown_are_distinct_and_preserved():
    raw = [
        {"start": 0.0, "end": 2.0, "chord": "C"},
        {"start": 2.0, "end": 3.0, "chord": "N"},
        {"start": 3.0, "end": 4.0, "chord": "X"},
        {"start": 4.0, "end": 6.0, "chord": "C"},
    ]
    assert [c["chord"] for c in postprocess_chords(raw, 6.0)] == ["C", "N", "X", "C"]


def test_only_touching_identical_segments_merge():
    raw = [
        {"start": 0.0, "end": 1.0, "chord": "C"},
        {"start": 1.0, "end": 2.0, "chord": "C"},
        {"start": 2.5, "end": 3.0, "chord": "C"},
    ]
    assert postprocess_chords(raw, 3.0) == [
        {"start": 0.0, "end": 2.0, "chord": "C"},
        {"start": 2.5, "end": 3.0, "chord": "C"},
    ]


def test_final_model_frame_is_clamped_to_track_duration():
    assert postprocess_chords([
        {"start": 0.0, "end": 2.08, "chord": "C"},
    ], 2.0) == [{"start": 0.0, "end": 2.0, "chord": "C"}]


def test_invalid_intervals_fail_explicitly():
    invalid = [
        {"start": 1.0, "end": 0.5, "chord": "C"},
        {"start": math.nan, "end": 1.0, "chord": "C"},
        {"start": 0.0, "end": 20.0, "chord": "C"},
    ]
    for segment in invalid:
        try:
            postprocess_chords([segment], 2.0)
        except ValueError:
            pass
        else:
            raise AssertionError(f"Invalid segment was accepted: {segment}")


if __name__ == "__main__":
    tests = [value for name, value in globals().copy().items() if name.startswith("test_")]
    for test in tests:
        test()
    print(f"PASS: {len(tests)} analyzer regression checks")
