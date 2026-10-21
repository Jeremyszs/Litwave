"""
Regression checks for API input validation. Bad input must be rejected with a 400 and a JSON error
({"success": false, "error": "..."}) instead of crashing with a 500 or being silently accepted:
- malformed JSON, non-object bodies, wrong types, out-of-range numbers, unknown actions/enums
- valid requests keep working
Only invalid requests (which change nothing) plus a few harmless valid ones are sent.
"""

import os
import sys
import isolate_data  # noqa: F401  (tests never touch the real data folder)

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, REPO_ROOT)

import logging  # noqa: E402
from unittest.mock import MagicMock  # noqa: E402
from starlette.testclient import TestClient  # noqa: E402
import src.server as server  # noqa: E402
from src.server import app  # noqa: E402

# The audio engine and hardware hosts only exist while the app's lifespan runs. These checks must never open an audio
# device or talk to the Montage, so the engines are replaced with stubs that just need to survive a valid request.
st = server.state
st.audio = MagicMock()
st.audio.song_player.get_telemetry.return_value = {"has_track": False}
st.audio.get_telemetry.return_value = {}
st.audio.metronome.enabled = False
st.audio.fx_sampler.active_bank = "D"
st.audio.fx_sampler.get_status.return_value = {}
st.midi = MagicMock()
st.midi.get_snapshot.return_value = {}
st.montage = MagicMock()
st.drone_pad = MagicMock()
st.drone_pad.get_status.return_value = {"active": False}

logging.getLogger("litwave.api").setLevel(logging.CRITICAL)  # rejected requests are expected here
JSON = {"Content-Type": "application/json"}
client = TestClient(app, raise_server_exceptions=False)


def post(path, body=None, raw=None):
    if raw is not None:
        return client.post(path, content=raw, headers=JSON)
    return client.post(path, json=body)


def expect_400(path, body=None, raw=None, label=None):
    res = post(path, body, raw)
    desc = label or f"{path} {body if raw is None else raw!r}"
    assert res.status_code == 400, f"{desc}: expected 400, got {res.status_code}"
    data = res.json()
    assert data.get("success") is False, f"{desc}: success must be false: {data}"
    assert isinstance(data.get("error"), str) and data["error"], f"{desc}: needs an error message: {data}"


def test_malformed_bodies_are_400():
    for path in ("/api/transport", "/api/mixer", "/api/drone-pad", "/api/fx-pads", "/api/setlist", "/api/montage/volume"):
        expect_400(path, raw=b"not json", label=f"{path} invalid JSON")
        expect_400(path, raw=b"[]", label=f"{path} array body")
        expect_400(path, raw=b'"text"', label=f"{path} string body")
        expect_400(path, raw=b"123", label=f"{path} number body")


def test_transport_rejects_bad_values():
    for body in (
        {"action": "speed", "speed": None}, {"action": "speed", "speed": "fast"}, {"action": "speed", "speed": "NaN"},
        {"action": "seek", "seconds": "abc"}, {"action": "seek", "seconds": -5},
        {"action": "pitch_shift", "semitones": "x"}, {"action": "pitch_shift", "semitones": 99},
        {"action": "remove_marker", "id": "x"}, {"action": "update_marker", "id": 1, "time": "x"},
        {"action": "volume", "volume": "loud"},
        {"action": "nonsense"}, {"action": 5}, {},
    ):
        expect_400("/api/transport", body)


def test_mixer_rejects_bad_values():
    for body in (
        {"master_volume": "loud"}, {"master_volume": 50}, {"master_volume": -1}, {"track_volume": None}, {"track_volume": 9},
        {"metronome_volume": "x"}, {"metronome_bpm": "x"}, {"metronome_bpm": 5}, {"metronome_bpm": 9000},
        {"metronome_time_sig": "x"}, {"metronome_time_sig": 0},
        {"equalizer_band": {"index": "x"}}, {"equalizer_band": {"index": 99, "gain": 1}}, {"equalizer_band": {"index": -1}},
        {"equalizer_band": "str"},
    ):
        expect_400("/api/mixer", body)


def test_device_and_midi_reject_bad_values():
    expect_400("/api/audio/device", {"device_id": "x"})
    expect_400("/api/audio/device", {"device_id": 1, "blocksize": "x"})
    expect_400("/api/audio/device", {"device_id": 1, "blocksize": 7})
    expect_400("/api/midi/velocity", {"curve": "nope"})
    expect_400("/api/midi/velocity", {"scale": "x"})


def test_drone_rejects_bad_values():
    for body in (
        {"action": "set_volume", "volume": "x"}, {"action": "set_cutoff", "cutoff": None},
        {"action": "set_root", "root": "H"}, {"action": "start", "root": "H"}, {"action": "set_root", "root": 5},
        {"action": "set_voice", "bank": "x"}, {"action": "nonsense"}, {},
    ):
        expect_400("/api/drone-pad", body)


def test_fx_pads_and_montage_reject_bad_values():
    expect_400("/api/fx-pads", {"action": "bank", "bank": "Z"})
    expect_400("/api/fx-pads", {"action": "trigger", "pad_id": 123})
    expect_400("/api/fx-pads", {"action": "trigger"})
    expect_400("/api/fx-pads", {"action": "nonsense"})
    expect_400("/api/montage/volume", {"part": 99, "volume": 10})
    expect_400("/api/montage/volume", {"part": 0, "volume": 10})
    expect_400("/api/montage/volume", {"part": "x", "volume": 10})


def test_setlist_rejects_bad_values():
    expect_400("/api/setlist", {"action": "add_song"})
    expect_400("/api/setlist", {"action": "add_song", "setlist_id": "s", "song_data": "str"})
    expect_400("/api/setlist", {"action": "add_song", "setlist_id": "s", "song_data": {}})


def test_seek_accepts_seconds_and_the_classic_position_alias():
    sp = st.audio.song_player
    sp.seek_seconds.reset_mock()
    assert post("/api/transport", {"action": "seek", "seconds": 42.5}).status_code == 200
    sp.seek_seconds.assert_called_with(42.5)
    # The classic lyrics view sent "position"; it used to be ignored, so clicking a lyric line jumped to 0:00.
    assert post("/api/transport", {"action": "seek", "position": 12.5}).status_code == 200
    sp.seek_seconds.assert_called_with(12.5)


def test_valid_requests_still_work():
    assert post("/api/transport", {"action": "speed", "speed": 1.0}).status_code == 200
    assert post("/api/transport", {"action": "stop"}).status_code == 200
    assert post("/api/mixer", {}).status_code == 200
    assert post("/api/mixer", {"metronome_bpm": 120, "metronome_time_sig": 4}).status_code == 200
    assert post("/api/mixer", {"equalizer_band": {"index": 1, "freq": 500, "gain": 0, "q": 1}}).status_code == 200
    assert post("/api/drone-pad", {"action": "stop"}).status_code == 200
    assert post("/api/fx-pads", {"action": "bank", "bank": "D"}).status_code == 200
    assert post("/api/fx-pads", {"action": "stop_all"}).status_code == 200
    res = post("/api/setlist", {"action": "create_setlist", "name": "Validation probe"})
    assert res.status_code == 200 and res.json().get("success") is True


if __name__ == "__main__":
    test_malformed_bodies_are_400()
    test_transport_rejects_bad_values()
    test_mixer_rejects_bad_values()
    test_device_and_midi_reject_bad_values()
    test_drone_rejects_bad_values()
    test_fx_pads_and_montage_reject_bad_values()
    test_setlist_rejects_bad_values()
    test_seek_accepts_seconds_and_the_classic_position_alias()
    test_valid_requests_still_work()
    print("ALL API VALIDATION CHECKS PASSED")
