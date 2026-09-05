"""Regression checks for chart identity, manual edits, and persistence."""
import json
import os
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from src.song_player import SongPlayer


def result(chords=None):
    return {
        "bpm": 100.0,
        "key": "C",
        "time_sig": None,
        "first_beat_seconds": 0.25,
        "model": {"id": "test", "revision": "1", "vocabulary": "large"},
        "pipeline_version": 2,
        "chords": chords or [{"time": 0.0, "end": 4.0, "duration": 4.0, "chord": "C", "nashville": "1"}],
    }


def player_in(directory, filename="song.wav"):
    player = SongPlayer()
    player.filename = filename
    player.filepath = str(Path(directory) / filename)
    return player


def test_analysis_for_a_different_song_is_rejected_without_changes():
    with tempfile.TemporaryDirectory() as directory:
        player = player_in(directory)
        player.chord_chart = [{"time": 1.0, "chord": "Dm", "source": "manual"}]
        before = list(player.chord_chart)
        assert player.apply_analysis("other.wav", result()) is False
        assert player.chord_chart == before
        assert player.analysis_data is None


def test_reanalysis_preserves_legacy_and_marked_manual_chords():
    with tempfile.TemporaryDirectory() as directory:
        player = player_in(directory)
        player.chord_chart = [
            {"time": 0.0, "chord": "G", "duration": 8.0},
            {"time": 2.0, "chord": "Dm", "nashville": "2m"},
            {"time": 4.0, "chord": "Em", "nashville": "3m", "source": "manual"},
        ]
        chords = [
            {"time": 0.0, "end": 4.0, "duration": 4.0, "chord": "C", "nashville": "1"},
            {"time": 4.0, "end": 8.0, "duration": 4.0, "chord": "F", "nashville": "4"},
        ]
        assert player.apply_analysis("song.wav", result(chords)) is True
        assert [(c["time"], c.get("end"), c["chord"], c["source"]) for c in player.chord_chart] == [
            (0.0, 2.0, "C", "btc"),
            (2.0, 4.0, "Dm", "manual"),
            (4.0, 8.0, "Em", "manual"),
        ]


def test_analysis_updates_lyrics_only_for_the_matching_song():
    with tempfile.TemporaryDirectory() as directory:
        player = player_in(directory)
        player.lyrics_sheet = [{"time": 0.0, "text": "old"}]
        assert player.apply_analysis("song.wav", result(), [{"time": 1.0, "text": "new"}]) is True
        assert player.lyrics_sheet == [{"time": 1.0, "text": "new"}]
        assert player.apply_analysis("other.wav", result(), [{"time": 2.0, "text": "wrong"}]) is False
        assert player.lyrics_sheet == [{"time": 1.0, "text": "new"}]


def test_beat_origin_uses_new_metadata_with_legacy_fallback():
    player = SongPlayer()
    player.analysis_data = {"first_beat_seconds": 1.25, "first_downbeat_seconds": 9.0}
    assert player.get_beat_origin() == 1.25
    player.analysis_data = {"first_downbeat_seconds": 2.5}
    assert player.get_beat_origin() == 2.5
    player.analysis_data = None
    assert player.get_beat_origin() == 0.0


def test_recorded_chord_is_marked_manual():
    with tempfile.TemporaryDirectory() as directory:
        player = player_in(directory)
        player.record_chord("F", "4", 1.5)
        assert player.chord_chart == [{"time": 1.5, "chord": "F", "nashville": "4", "source": "manual"}]


def test_failed_persistence_rolls_back_in_memory_analysis():
    with tempfile.TemporaryDirectory() as directory:
        player = player_in(directory)
        player.chord_chart = [{"time": 0.0, "chord": "Dm", "source": "manual"}]
        player.analysis_data = {"pipeline_version": 1}
        player.lyrics_sheet = [{"time": 0.0, "text": "old"}]
        before = (list(player.chord_chart), dict(player.analysis_data), list(player.lyrics_sheet))
        player._persist_chart = lambda backup=False: False
        assert player.apply_analysis("song.wav", result(), [{"time": 1.0, "text": "new"}]) is False
        assert (player.chord_chart, player.analysis_data, player.lyrics_sheet) == before


def test_analysis_backs_up_old_chart_and_writes_valid_versioned_json():
    with tempfile.TemporaryDirectory() as directory:
        player = player_in(directory)
        chart_file = Path(str(player.filepath) + ".chords.json")
        old = {"filename": "song.wav", "chord_chart": [{"time": 0, "chord": "G"}]}
        chart_file.write_text(json.dumps(old), encoding="utf-8")
        assert player.apply_analysis("song.wav", result()) is True
        assert json.loads(Path(str(chart_file) + ".bak").read_text(encoding="utf-8")) == old
        saved = json.loads(chart_file.read_text(encoding="utf-8"))
        assert saved["schema_version"] == 2
        assert saved["analysis"]["pipeline_version"] == 2
        assert not list(Path(directory).glob("*.tmp"))


if __name__ == "__main__":
    tests = [value for name, value in globals().copy().items() if name.startswith("test_")]
    for test in tests:
        test()
    print(f"PASS: {len(tests)} song-player regression checks")
