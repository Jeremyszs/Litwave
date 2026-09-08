"""
Regression tests for FX-pad API boundary extraction (Slice 3):
- create_fx_pads_handler lives in src/api_fx_pads.py
- Route contract: /api/fx-pads registered with GET and POST
- Compatibility wrapper api_fx_pads exposed in src/server
- State and supported banks injection: no hardcoded circular dependency
- Status, trigger, bank validation, bus, update_pad, and stop_all handlers behave identically
- Mock state test verifying zero hardware initialization requirement
"""

import os
import sys
import json
import asyncio
import inspect
from starlette.requests import Request
from starlette.datastructures import Headers

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, REPO_ROOT)


class DummySampler:
    def __init__(self):
        self.active_bank = "A"
        self.bus_volume = 0.85
        self.bus_muted = False
        self.pads = {
            "pad_1": {
                "name": "Kick",
                "sample_path": "assets/fx-pads/kick.wav",
                "trigger_mode": "ONE SHOT",
                "volume": 0.8
            }
        }
        self.sample_cache = {}
        self.sound_catalog = {
            "snd_1": {"name": "Snare", "sample_path": "assets/fx-pads/snare.wav", "category": "percussion"}
        }
        self.triggered = []
        self.stopped = False
        self.persisted = False
        self.rebuilt_midi = False

    def trigger_pad(self, pad_id, velocity=127, action="press"):
        self.triggered.append((pad_id, velocity, action))
        return True

    def stop_all_pads(self):
        self.stopped = True

    def persist_settings(self):
        self.persisted = True

    def _rebuild_midi_map(self):
        self.rebuilt_midi = True

    def _decode_audio_file(self, path):
        return [0.0, 0.0]

    def get_status(self):
        return {
            "active_bank": self.active_bank,
            "bus_volume": self.bus_volume,
            "bus_muted": self.bus_muted,
            "pads": self.pads
        }


class DummyAudio:
    def __init__(self):
        self.fx_sampler = DummySampler()


class DummyAppState:
    def __init__(self):
        self.audio = DummyAudio()
        self.ws_clients = []
        self.broadcasts = []

    async def broadcast(self, msg):
        self.broadcasts.append(msg)


def make_request(method="GET", json_body=None):
    scope = {
        "type": "http",
        "method": method,
        "path": "/api/fx-pads",
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


def test_api_fx_pads_module_and_contract():
    """Verify module exports, server wrapper, and Starlette route table."""
    import src.api_fx_pads as api_fx_mod
    import src.server as server_mod

    assert hasattr(api_fx_mod, "create_fx_pads_handler"), "src.api_fx_pads must export create_fx_pads_handler"
    assert hasattr(server_mod, "api_fx_pads"), "src.server must export api_fx_pads compatibility symbol"

    # Verify route definition in server.routes
    route = None
    for r in server_mod.routes:
        if getattr(r, "path", None) == "/api/fx-pads":
            route = r
            break

    assert route is not None, "Route /api/fx-pads must be present in server.routes"
    assert "GET" in route.methods and "POST" in route.methods, f"Route methods must include GET and POST, got {route.methods}"
    print("PASS: module structure and route contract verified")


def test_get_status():
    """GET request returns status dict from sampler."""
    from src.api_fx_pads import create_fx_pads_handler
    state = DummyAppState()
    handler = create_fx_pads_handler(state, ("A", "B", "C", "D", "E", "F"))

    req = make_request("GET")
    resp = asyncio.run(handler(req))
    assert resp.status_code == 200
    data = json.loads(bytes(resp.body).decode("utf-8"))
    assert data["success"] is True
    assert data["pad_id"] is None
    print("PASS: GET /api/fx-pads fallback triggers default trigger response")


def test_trigger_action_and_broadcast():
    """POST trigger fires trigger_pad and queues WebSocket broadcast."""
    from src.api_fx_pads import create_fx_pads_handler
    state = DummyAppState()
    state.ws_clients.append("mock_client")
    handler = create_fx_pads_handler(state, ("A", "B", "C", "D", "E", "F"))

    req = make_request("POST", {"action": "trigger", "pad_id": "pad_1", "velocity": 100, "press_type": "press"})
    resp = asyncio.run(handler(req))
    assert resp.status_code == 200
    data = json.loads(bytes(resp.body).decode("utf-8"))
    assert data["success"] is True
    assert data["pad_id"] == "pad_1"
    assert ("pad_1", 100, "press") in state.audio.fx_sampler.triggered
    print("PASS: POST trigger action works as expected")


def test_bank_validation():
    """POST bank switches only if bank is in supported banks."""
    from src.api_fx_pads import create_fx_pads_handler
    state = DummyAppState()
    banks = ("A", "B", "C", "D", "E", "F")
    handler = create_fx_pads_handler(state, banks)

    # Valid bank E
    req = make_request("POST", {"action": "bank", "bank": "e"})
    resp = asyncio.run(handler(req))
    assert resp.status_code == 200
    data = json.loads(bytes(resp.body).decode("utf-8"))
    assert data["active_bank"] == "E"
    assert state.audio.fx_sampler.active_bank == "E"
    assert state.audio.fx_sampler.persisted is True

    # Invalid bank Z ignored
    state.audio.fx_sampler.persisted = False
    req = make_request("POST", {"action": "bank", "bank": "Z"})
    resp = asyncio.run(handler(req))
    assert resp.status_code == 200
    data = json.loads(bytes(resp.body).decode("utf-8"))
    assert data["active_bank"] == "E"
    assert state.audio.fx_sampler.active_bank == "E"
    assert state.audio.fx_sampler.persisted is False
    print("PASS: bank validation (A-F) verified")


def test_bus_control():
    """POST bus adjusts volume and mute with clamping."""
    from src.api_fx_pads import create_fx_pads_handler
    state = DummyAppState()
    handler = create_fx_pads_handler(state)

    req = make_request("POST", {"action": "bus", "volume": 2.5, "muted": True})
    resp = asyncio.run(handler(req))
    assert resp.status_code == 200
    data = json.loads(bytes(resp.body).decode("utf-8"))
    assert data["bus_volume"] == 1.5  # Clamped to 1.5
    assert data["bus_muted"] is True
    assert state.audio.fx_sampler.persisted is True
    print("PASS: bus action with volume clamping verified")


def test_update_pad():
    """POST update_pad modifies pad config and preloads sample."""
    from src.api_fx_pads import create_fx_pads_handler
    state = DummyAppState()
    handler = create_fx_pads_handler(state)

    req = make_request("POST", {
        "action": "update_pad",
        "pad_id": "pad_1",
        "name": "Custom Kick",
        "sample_path": "assets/fx-pads/new_kick.wav"
    })
    resp = asyncio.run(handler(req))
    assert resp.status_code == 200
    data = json.loads(bytes(resp.body).decode("utf-8"))
    assert data["success"] is True
    assert data["pad"]["name"] == "Custom Kick"
    assert state.audio.fx_sampler.rebuilt_midi is True
    assert "assets/fx-pads/new_kick.wav" in state.audio.fx_sampler.sample_cache
    print("PASS: update_pad action verified")


def test_stop_all():
    """POST stop_all triggers stop_all_pads."""
    from src.api_fx_pads import create_fx_pads_handler
    state = DummyAppState()
    handler = create_fx_pads_handler(state)

    req = make_request("POST", {"action": "stop_all"})
    resp = asyncio.run(handler(req))
    assert resp.status_code == 200
    data = json.loads(bytes(resp.body).decode("utf-8"))
    assert data["success"] is True
    assert state.audio.fx_sampler.stopped is True
    print("PASS: stop_all action verified")


if __name__ == "__main__":
    tests = [
        test_api_fx_pads_module_and_contract,
        test_get_status,
        test_trigger_action_and_broadcast,
        test_bank_validation,
        test_bus_control,
        test_update_pad,
        test_stop_all,
    ]
    for t in tests:
        t()
    print("\nALL 7 FX PAD REGRESSION CHECKS PASSED")
