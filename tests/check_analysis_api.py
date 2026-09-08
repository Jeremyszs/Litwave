"""
Regression checks for Song Analysis & Synced Lyrics API boundary extraction:
- /api/analyze: missing song, mismatch active song, missing file, successful analysis & lyrics
- Lazy analyzer loading & background thread executor injection
- Metronome and playlist library updates
- Dummy state validation without audio hardware or heavy analyzer models
- Preserves public wrappers in src.server
"""

import os
import sys
import json
import asyncio
from starlette.requests import Request

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, REPO_ROOT)

from src.api_analysis import create_analysis_handler
import src.server as server


class DummySongPlayer:
    def __init__(self, filename=None):
        self.filename = filename
        self.total_frames = 48000 * 60
        self.target_samplerate = 48000
        self.applied = []

    def apply_analysis(self, filename, analysis_res, lyrics):
        self.applied.append((filename, analysis_res, lyrics))
        return True

    def get_telemetry(self):
        return {
            "filename": self.filename,
            "has_analysis": len(self.applied) > 0
        }


class DummyMetronome:
    def __init__(self):
        self.bpm = 120.0

    def set_bpm(self, bpm):
        self.bpm = bpm


class DummyAudio:
    def __init__(self, filename=None):
        self.song_player = DummySongPlayer(filename)
        self.metronome = DummyMetronome()


class DummyPlaylist:
    def __init__(self):
        self.recorded = []

    def record_song(self, raw_name, key=None, bpm=None):
        self.recorded.append((raw_name, key, bpm))


class DummyState:
    def __init__(self, filename=None):
        self.audio = DummyAudio(filename)
        self.playlist = DummyPlaylist()


def make_request(method="POST", path="/api/analyze", body=None):
    scope = {
        "type": "http",
        "method": method,
        "path": path,
        "headers": [(b"content-type", b"application/json")] if body is not None else [],
    }

    async def receive():
        payload = json.dumps(body).encode("utf-8") if body is not None else b""
        return {"type": "http.request", "body": payload, "more_body": False}

    return Request(scope, receive=receive)


async def main():
    test_upload_dir = os.path.join(REPO_ROOT, "src", "static", "uploads")

    analyzer_called = []
    def dummy_analyzer(path):
        analyzer_called.append(path)
        return {"bpm": 128.0, "key": "G Major", "chords": ["G", "C", "D"]}

    async def dummy_run_in_executor(fn, *args):
        return fn(*args)

    lyrics_called = []
    def dummy_fetch_lyrics(filename, duration=None, audio_path=None):
        lyrics_called.append((filename, duration, audio_path))
        return {"lines": [{"time": 0.0, "text": "Amazing grace"}]}

    # 1. No active song loaded
    state = DummyState(filename=None)
    handle_analyze = create_analysis_handler(
        state,
        upload_dir=test_upload_dir,
        get_analyzer_fn=lambda: dummy_analyzer,
        run_executor_fn=dummy_run_in_executor,
        fetch_lyrics_fn=dummy_fetch_lyrics
    )
    res = await handle_analyze(make_request("POST", "/api/analyze", {}))
    assert res.status_code == 400

    # 2. Mismatched song requested
    state = DummyState(filename="active_song.mp3")
    handle_analyze = create_analysis_handler(
        state,
        upload_dir=test_upload_dir,
        get_analyzer_fn=lambda: dummy_analyzer,
        run_executor_fn=dummy_run_in_executor,
        fetch_lyrics_fn=dummy_fetch_lyrics
    )
    res = await handle_analyze(make_request("POST", "/api/analyze", {"filename": "different_song.mp3"}))
    assert res.status_code == 409

    # 3. File not found in upload dir
    res = await handle_analyze(make_request("POST", "/api/analyze", {"filename": "active_song.mp3"}))
    assert res.status_code == 404

    # 4. Successful analysis on an existing file
    existing_files = [f for f in os.listdir(test_upload_dir) if not f.startswith(".")]
    if existing_files:
        test_file = existing_files[0]
        state = DummyState(filename=test_file)
        handle_analyze = create_analysis_handler(
            state,
            upload_dir=test_upload_dir,
            get_analyzer_fn=lambda: dummy_analyzer,
            run_executor_fn=dummy_run_in_executor,
            fetch_lyrics_fn=dummy_fetch_lyrics
        )
        res = await handle_analyze(make_request("POST", "/api/analyze", {"filename": test_file}))
        data = json.loads(bytes(res.body).decode("utf-8"))
        assert res.status_code == 200
        assert data["success"] is True
        assert data["result"]["bpm"] == 128.0
        assert state.audio.metronome.bpm == 128.0
        assert len(state.playlist.recorded) == 1
        assert state.playlist.recorded[0] == (test_file, "G Major", 128.0)
        assert len(lyrics_called) == 1

    # 5. Compatibility public handler export in server.py
    assert callable(server.api_analyze_song)

    print("ALL ANALYSIS & LYRICS API REGRESSION CHECKS PASSED")


if __name__ == "__main__":
    asyncio.run(main())
