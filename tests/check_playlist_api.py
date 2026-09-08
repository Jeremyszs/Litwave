"""
Regression tests for playlist and song API boundary extraction:
- create_playlist_handlers lives in src/api_playlist.py
- Route contract: /api/playlist (GET), /api/playlist/select (POST), /api/upload (POST) registered
- Compatibility wrappers api_playlist, api_playlist_select, api_upload_song exposed in src/server
- Dependency injection of app_state and upload_dir: no circular import, no hardcoded state
- Dummy state tests for listing tracks, selecting songs, and handling uploads
- Zero hardware initialization requirement
"""

import os
import sys
import json
import asyncio
import tempfile
import shutil
from starlette.requests import Request
from starlette.datastructures import Headers, UploadFile

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, REPO_ROOT)


class DummySongPlayer:
    def __init__(self):
        self.filename = None
        self.filepath = None
        self.loaded_files = []

    def load_file(self, path):
        if not os.path.exists(path):
            return False
        self.filepath = path
        self.filename = os.path.basename(path)
        self.loaded_files.append(path)
        return True

    def get_telemetry(self):
        return {
            "filename": self.filename,
            "filepath": self.filepath,
            "is_playing": False,
            "duration": 120.0
        }


class DummyPlaylist:
    def __init__(self):
        self.tracks = [
            {"filename": "test1.mp3", "title": "test1", "key": "C", "bpm": 120.0, "size_mb": 4.5},
            {"filename": "test2.wav", "title": "test2", "key": "G", "bpm": 75.0, "size_mb": 20.1}
        ]
        self.recorded = []

    def get_tracks(self, current_filename=None):
        out = []
        for t in self.tracks:
            item = dict(t)
            item["is_current"] = (current_filename is not None and t.get("filename") == current_filename)
            out.append(item)
        return out

    def record_song(self, filename, key=None, bpm=None):
        self.recorded.append((filename, key, bpm))
        return {"filename": filename, "key": key, "bpm": bpm}


class DummyAudio:
    def __init__(self):
        self.song_player = DummySongPlayer()


class DummyAppState:
    def __init__(self):
        self.audio = DummyAudio()
        self.playlist = DummyPlaylist()


def make_json_request(method="GET", path="/api/playlist", json_body=None):
    scope = {
        "type": "http",
        "method": method,
        "path": path,
        "headers": [(b"content-type", b"application/json")] if json_body is not None else [],
    }

    async def receive():
        if json_body is not None:
            return {
                "type": "http.request",
                "body": json.dumps(json_body).encode("utf-8"),
                "more_body": False
            }
        return {"type": "http.request", "body": b"", "more_body": False}

    return Request(scope, receive)


def test_api_playlist_module_and_contract():
    """Verify module exports, server wrapper, and Starlette route table."""
    import src.api_playlist as api_playlist_mod
    import src.server as server_mod

    assert hasattr(api_playlist_mod, "create_playlist_handlers"), "src.api_playlist must export create_playlist_handlers"
    assert hasattr(server_mod, "api_playlist"), "src.server must export api_playlist"
    assert hasattr(server_mod, "api_playlist_select"), "src.server must export api_playlist_select"
    assert hasattr(server_mod, "api_upload_song"), "src.server must export api_upload_song"

    routes_by_path = {getattr(r, "path", None): r for r in server_mod.routes}

    assert "/api/playlist" in routes_by_path, "Route /api/playlist must be present in server.routes"
    assert "GET" in routes_by_path["/api/playlist"].methods

    assert "/api/playlist/select" in routes_by_path, "Route /api/playlist/select must be present in server.routes"
    assert "POST" in routes_by_path["/api/playlist/select"].methods

    assert "/api/upload" in routes_by_path, "Route /api/upload must be present in server.routes"
    assert "POST" in routes_by_path["/api/upload"].methods

    print("PASS: playlist module structure and route contract verified")


def test_get_playlist_tracks():
    """GET /api/playlist returns all tracks with is_current flag."""
    from src.api_playlist import create_playlist_handlers
    state = DummyAppState()
    state.audio.song_player.filename = "test1.mp3"
    handle_playlist, _, _ = create_playlist_handlers(state)

    req = make_json_request("GET", "/api/playlist")
    resp = asyncio.run(handle_playlist(req))
    assert resp.status_code == 200
    data = json.loads(bytes(resp.body).decode("utf-8"))
    assert "tracks" in data
    assert len(data["tracks"]) == 2
    assert data["tracks"][0]["is_current"] is True
    assert data["tracks"][1]["is_current"] is False
    print("PASS: GET /api/playlist verified")


def test_playlist_select_success_and_failures():
    """POST /api/playlist/select validates filename, checks existence, loads song, and records playlist."""
    from src.api_playlist import create_playlist_handlers
    temp_dir = tempfile.mkdtemp(prefix="litwave_upload_test_")
    try:
        sample_file = os.path.join(temp_dir, "worship_track.mp3")
        with open(sample_file, "wb") as f:
            f.write(b"fake audio stream content")

        state = DummyAppState()
        _, handle_select, _ = create_playlist_handlers(state, upload_dir=temp_dir)

        # 1. Missing filename
        req_missing = make_json_request("POST", "/api/playlist/select", {})
        resp = asyncio.run(handle_select(req_missing))
        assert resp.status_code == 400
        assert json.loads(bytes(resp.body).decode("utf-8")) == {"error": "No filename"}

        # 2. File not found
        req_not_found = make_json_request("POST", "/api/playlist/select", {"filename": "non_existent.mp3"})
        resp = asyncio.run(handle_select(req_not_found))
        assert resp.status_code == 404
        assert json.loads(bytes(resp.body).decode("utf-8")) == {"error": "File not found"}

        # 3. Successful selection
        req_ok = make_json_request("POST", "/api/playlist/select", {"filename": "worship_track.mp3"})
        resp = asyncio.run(handle_select(req_ok))
        assert resp.status_code == 200
        data = json.loads(bytes(resp.body).decode("utf-8"))
        assert data["success"] is True
        assert data["filename"] == "worship_track.mp3"
        assert data["song"]["filename"] == "worship_track.mp3"
        assert ("worship_track.mp3", None, None) in state.playlist.recorded
        assert state.audio.song_player.filepath == sample_file
        print("PASS: POST /api/playlist/select verified (missing, 404, success)")
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)


def test_upload_song_handling():
    """POST /api/upload handles file, saves to disk, loads into song_player, and records playlist."""
    from src.api_playlist import create_playlist_handlers
    temp_dir = tempfile.mkdtemp(prefix="litwave_upload_test2_")
    try:
        state = DummyAppState()
        _, _, handle_upload = create_playlist_handlers(state, upload_dir=temp_dir)

        # Mock multipart form request
        boundary = "---------------------------974767299852498929531610575"
        body = (
            f"--{boundary}\r\n"
            f'Content-Disposition: form-data; name="file"; filename="uploaded_song.wav"\r\n'
            f"Content-Type: audio/wav\r\n\r\n"
            f"RIFF....WAVEfmt ...."
            f"\r\n--{boundary}--\r\n"
        ).encode("latin-1")

        scope = {
            "type": "http",
            "method": "POST",
            "path": "/api/upload",
            "headers": [
                (b"content-type", f"multipart/form-data; boundary={boundary}".encode("latin-1")),
                (b"content-length", str(len(body)).encode("latin-1")),
            ],
        }

        async def receive():
            return {"type": "http.request", "body": body, "more_body": False}

        req = Request(scope, receive)
        resp = asyncio.run(handle_upload(req))
        assert resp.status_code == 200
        data = json.loads(bytes(resp.body).decode("utf-8"))
        assert data["success"] is True
        assert data["filename"] == "uploaded_song.wav"
        assert data["song"]["filename"] == "uploaded_song.wav"

        saved_path = os.path.join(temp_dir, "uploaded_song.wav")
        assert os.path.exists(saved_path)
        with open(saved_path, "rb") as f:
            assert f.read() == b"RIFF....WAVEfmt ...."

        assert ("uploaded_song.wav", None, None) in state.playlist.recorded
        print("PASS: POST /api/upload verified")
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)


def test_upload_empty_form():
    """POST /api/upload with missing file returns 400."""
    from src.api_playlist import create_playlist_handlers
    temp_dir = tempfile.mkdtemp(prefix="litwave_upload_test3_")
    try:
        state = DummyAppState()
        _, _, handle_upload = create_playlist_handlers(state, upload_dir=temp_dir)

        boundary = "---------------------------974767299852498929531610575"
        body = f"--{boundary}--\r\n".encode("latin-1")

        scope = {
            "type": "http",
            "method": "POST",
            "path": "/api/upload",
            "headers": [
                (b"content-type", f"multipart/form-data; boundary={boundary}".encode("latin-1")),
            ],
        }

        async def receive():
            return {"type": "http.request", "body": body, "more_body": False}

        req = Request(scope, receive)
        resp = asyncio.run(handle_upload(req))
        assert resp.status_code == 400
        data = json.loads(bytes(resp.body).decode("utf-8"))
        assert data == {"error": "No file uploaded"}
        print("PASS: POST /api/upload empty form rejected")
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)


if __name__ == "__main__":
    test_api_playlist_module_and_contract()
    test_get_playlist_tracks()
    test_playlist_select_success_and_failures()
    test_upload_song_handling()
    test_upload_empty_form()
    print("\nALL 5 PLAYLIST REGRESSION CHECKS PASSED")
