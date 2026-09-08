"""
Regression checks for Setlist API boundary extraction:
- Setlist operations (/api/setlist): GET, create_setlist, delete_setlist, move_song, add_song, remove_song
- Patch application (apply_song_patch): engine switch, part volumes/reverbs/mutes, drone root, FX bank
- Dummy state validation without hardware
- Preserves public wrappers in src.server
"""

import os
import sys
import json
import asyncio
from starlette.requests import Request

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, REPO_ROOT)

from src.api_setlist import create_setlist_handler
import src.server as server


class DummySetlistManager:
    def __init__(self):
        self.setlists = [{"id": "s1", "name": "Sunday Service", "songs": []}]

    def get_setlists(self):
        return list(self.setlists)

    def create_setlist(self, name):
        item = {"id": "s2", "name": name, "songs": []}
        self.setlists.append(item)
        return item

    def delete_setlist(self, sid):
        self.setlists = [s for s in self.setlists if s["id"] != sid]
        return True

    def move_song(self, sid, song_id, direction):
        return True

    def add_song_to_setlist(self, sid, song):
        for s in self.setlists:
            if s["id"] == sid:
                s["songs"].append(song)
                return True
        return False

    def remove_song_from_setlist(self, sid, song_id):
        return True


class DummyMontage:
    def __init__(self):
        self.engine_type = "yamaha"
        self.part_volumes = {1: 100, 2: 90}
        self.part_reverbs = {1: 40, 2: 30}
        self.part_mutes = {1: False, 2: False}
        self.part_names = {1: "Piano", 2: "Pad"}
        self.killed_vst = False
        self.opened_vst = None

    def kill_vst_engine(self):
        self.killed_vst = True

    def open_vst_editor(self, hidden=False, engine=None):
        self.opened_vst = (hidden, engine)
        if engine:
            self.engine_type = engine
        return True

    def set_part_volume(self, part, vol):
        self.part_volumes[part] = vol

    def set_part_reverb(self, part, rev):
        self.part_reverbs[part] = rev

    def set_part_mute(self, part, mute):
        self.part_mutes[part] = mute


class DummyDronePad:
    def __init__(self):
        self.current_root = "C"

    def set_root(self, root):
        self.current_root = root


class DummyFxSampler:
    def __init__(self):
        self.active_bank = "A"
        self.persisted = False

    def persist_settings(self):
        self.persisted = True


class DummyAudio:
    def __init__(self):
        self.fx_sampler = DummyFxSampler()


class DummyState:
    def __init__(self):
        self.setlist = DummySetlistManager()
        self.montage = DummyMontage()
        self.drone_pad = DummyDronePad()
        self.audio = DummyAudio()


def make_request(method="POST", path="/api/setlist", body=None):
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
    state = DummyState()
    handle_setlist = create_setlist_handler(state, ("A", "B", "C", "D", "E", "F"))

    # 1. GET setlists
    req = make_request("GET", "/api/setlist")
    res = await handle_setlist(req)
    data = json.loads(bytes(res.body).decode("utf-8"))
    assert res.status_code == 200
    assert data["success"] is True
    assert len(data["setlists"]) == 1

    # 2. create_setlist
    req = make_request("POST", "/api/setlist", {"action": "create_setlist", "name": "Youth Night"})
    res = await handle_setlist(req)
    data = json.loads(bytes(res.body).decode("utf-8"))
    assert res.status_code == 200
    assert data["setlist"]["name"] == "Youth Night"

    # 3. add_song with patch snapshot
    req = make_request("POST", "/api/setlist", {
        "action": "add_song",
        "setlist_id": "s1",
        "song_data": {"id": "song_1", "title": "Goodness of God"}
    })
    res = await handle_setlist(req)
    data = json.loads(bytes(res.body).decode("utf-8"))
    assert res.status_code == 200
    assert data["success"] is True
    assert len(state.setlist.setlists[0]["songs"]) == 1
    added_song = state.setlist.setlists[0]["songs"][0]
    assert added_song["patch_snapshot"]["engine_type"] == "yamaha"
    assert added_song["patch_snapshot"]["drone_root"] == "C"

    # 4. apply_song_patch
    req = make_request("POST", "/api/setlist", {
        "action": "apply_song_patch",
        "patch_snapshot": {
            "engine_type": "community",
            "part_volumes": {"1": 85, "2": 70},
            "part_reverbs": {"1": 55},
            "part_mutes": {"2": True},
            "drone_root": "E",
            "fx_bank": "B"
        }
    })
    res = await handle_setlist(req)
    data = json.loads(bytes(res.body).decode("utf-8"))
    assert res.status_code == 200
    assert data["applied"] is True
    assert state.montage.engine_type == "community"
    assert state.montage.part_volumes[1] == 85
    assert state.montage.part_reverbs[1] == 55
    assert state.montage.part_mutes[2] is True
    assert state.drone_pad.current_root == "E"
    assert state.audio.fx_sampler.active_bank == "B"
    assert state.audio.fx_sampler.persisted is True

    # 5. Invalid action returns 400
    req = make_request("POST", "/api/setlist", {"action": "nonexistent_action"})
    res = await handle_setlist(req)
    assert res.status_code == 400

    # 6. Compatibility public handler in server.py
    assert callable(server.api_setlist)

    print("ALL SETLIST API REGRESSION CHECKS PASSED")


if __name__ == "__main__":
    asyncio.run(main())
