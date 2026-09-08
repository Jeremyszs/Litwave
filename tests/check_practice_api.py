"""
Regression checks for Practice API boundary extraction:
- Drone pad (/api/drone-pad) actions: start, stop, toggle, set_root, set_volume, set_cutoff, set_voice
- Ear training (/api/ear-training) actions: generate, replay, check
- Dummy state validation without audio/MIDI hardware dependencies
- Preserves public wrappers in src.server
"""

import os
import sys
import json
import asyncio
from starlette.requests import Request

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, REPO_ROOT)

from src.api_practice import create_practice_handlers
import src.server as server


class DummyEarTraining:
    def __init__(self):
        self.replayed = False
        self.current_score = {"correct": 5, "total": 6}

    def replay_current(self):
        self.replayed = True
        return True

    def check_answer(self, ans):
        return {"correct": ans == "Major", "expected": "Major"}

    def generate_exercise(self, module):
        return {"module": module, "notes": [60, 64, 67]}


class DummyDronePad:
    def __init__(self):
        self.is_active = False
        self.current_root = "C"
        self.volume = 95
        self.cutoff = 68
        self.voice = ("soft_pad", 6, 4)

    def start_drone(self, root=None):
        self.is_active = True
        if root:
            self.current_root = root

    def stop_drone(self):
        self.is_active = False

    def set_root(self, root):
        self.current_root = root

    def set_volume(self, vol):
        self.volume = vol

    def set_cutoff(self, cutoff):
        self.cutoff = cutoff

    def set_voice(self, vid, bank, preset):
        self.voice = (vid, bank, preset)

    def get_status(self):
        return {
            "active": self.is_active,
            "root": self.current_root,
            "volume": self.volume,
            "cutoff": self.cutoff,
            "voice": self.voice
        }


class DummyState:
    def __init__(self):
        self.ear_training = DummyEarTraining()
        self.drone_pad = DummyDronePad()


def make_request(method="POST", path="/api/drone-pad", body=None):
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
    handle_ear, handle_drone = create_practice_handlers(state)

    # 1. Ear training generate
    req = make_request("POST", "/api/ear-training", {"action": "generate", "module": "interval"})
    res = await handle_ear(req)
    data = json.loads(bytes(res.body).decode("utf-8"))
    assert res.status_code == 200, f"Expected 200, got {res.status_code}"
    assert data["success"] is True
    assert data["exercise"]["module"] == "interval"
    assert data["score"]["correct"] == 5

    # 2. Ear training replay
    req = make_request("POST", "/api/ear-training", {"action": "replay"})
    res = await handle_ear(req)
    data = json.loads(bytes(res.body).decode("utf-8"))
    assert res.status_code == 200
    assert data["success"] is True
    assert state.ear_training.replayed is True

    # 3. Ear training check
    req = make_request("POST", "/api/ear-training", {"action": "check", "answer": "Major"})
    res = await handle_ear(req)
    data = json.loads(bytes(res.body).decode("utf-8"))
    assert res.status_code == 200
    assert data["correct"] is True

    # 4. Drone pad start & stop
    req = make_request("POST", "/api/drone-pad", {"action": "start", "root": "G"})
    res = await handle_drone(req)
    data = json.loads(bytes(res.body).decode("utf-8"))
    assert res.status_code == 200
    assert state.drone_pad.is_active is True
    assert state.drone_pad.current_root == "G"

    req = make_request("POST", "/api/drone-pad", {"action": "stop"})
    res = await handle_drone(req)
    data = json.loads(bytes(res.body).decode("utf-8"))
    assert res.status_code == 200
    assert state.drone_pad.is_active is False

    # 5. Drone pad toggle
    req = make_request("POST", "/api/drone-pad", {"action": "toggle", "root": "D"})
    res = await handle_drone(req)
    assert state.drone_pad.is_active is True
    assert state.drone_pad.current_root == "D"
    req = make_request("POST", "/api/drone-pad", {"action": "toggle"})
    res = await handle_drone(req)
    assert state.drone_pad.is_active is False

    # 6. Drone parameters: volume, cutoff, voice, root
    await handle_drone(make_request("POST", "/api/drone-pad", {"action": "set_root", "root": "F#"}))
    assert state.drone_pad.current_root == "F#"
    await handle_drone(make_request("POST", "/api/drone-pad", {"action": "set_volume", "volume": 80}))
    assert state.drone_pad.volume == 80
    await handle_drone(make_request("POST", "/api/drone-pad", {"action": "set_cutoff", "cutoff": 50}))
    assert state.drone_pad.cutoff == 50
    await handle_drone(make_request("POST", "/api/drone-pad", {"action": "set_voice", "voice_id": "v1", "bank": 2, "preset": 3}))
    assert state.drone_pad.voice == ("v1", 2, 3)

    # 7. Compatibility public handler exports in server.py
    assert callable(server.api_ear_exercise)
    assert callable(server.api_drone_pad)

    print("ALL PRACTICE & EAR TRAINING API REGRESSION CHECKS PASSED")


if __name__ == "__main__":
    asyncio.run(main())
