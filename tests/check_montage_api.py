"""
Regression tests for Montage M & Native Host API boundary extraction:
- create_montage_handlers lives in src/api_montage.py
- Route contract:
    /api/montage/editor (POST)
    /api/montage/voices (GET)
    /api/montage/assign_voice (POST)
    /api/montage/volume (POST)
    /api/montage/scene (POST)
    /api/montage/names (GET, POST)
    /api/montage/audition (POST)
    /api/master/dsp (POST)
    /api/montage/license (POST)
- Compatibility re-exports / handlers present in src.server
- Dependency injection of app_state and catalog_path (no circular imports)
- Zero hardware initialization requirement (using dummy state)
- Tests editor (kill, switch, hide/show, start), voices catalog, assign_voice,
  part/master volumes, CC sends, scene (select, save, recall), custom names (GET/POST),
  master DSP (warmth, analyzer), audition (play_voicing), license manager.
"""

import os
import sys
import json
import asyncio
from starlette.requests import Request

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, REPO_ROOT)


class DummyMontage:
    def __init__(self):
        self.engine_type = "yamaha"
        self.native_status = {"reachable": True, "engine": "yamaha"}
        self.master_vst_volume = 100
        self.part_volumes = {i: 100 for i in range(1, 9)}
        self.part_reverbs = {i: 40 for i in range(1, 9)}
        self.part_mutes = {i: False for i in range(1, 9)}
        self.part_solos = {i: False for i in range(1, 9)}
        self.part_names = {i: f"Part {i}" for i in range(1, 9)}
        self.scene_names = {i: f"Scene {i}" for i in range(1, 9)}
        self.part_pans = {i: 64 for i in range(1, 9)}
        self.part_cutoffs = {i: 64 for i in range(1, 9)}
        self.part_resonances = {i: 64 for i in range(1, 9)}
        self.part_attacks = {i: 64 for i in range(1, 9)}
        self.part_releases = {i: 64 for i in range(1, 9)}
        self.part_chorus = {i: 0 for i in range(1, 9)}
        self.current_scene = 1
        self.saved_scenes = {i: {"part_volumes": dict(self.part_volumes)} for i in range(1, 9)}

        # Tracking calls
        self.killed = False
        self.opened_editor = []
        self.toggled_windows = []
        self.assigned_voices = []
        self.saved_custom_names_called = False
        self.sent_ccs = []
        self.warmth_config = {}
        self.analyzer_enabled = True
        self.license_manager_opened = False

    def is_engine_running(self):
        return not self.killed

    def kill_vst_engine(self):
        self.killed = True
        return True

    def open_vst_editor(self, hidden=False, engine=None):
        if engine:
            self.engine_type = engine
        self.killed = False
        self.opened_editor.append((hidden, engine))
        return True

    def toggle_vst_window(self, action):
        self.toggled_windows.append(action)
        return True

    def assign_part_voice(self, part, bank, preset):
        self.assigned_voices.append((part, bank, preset))
        return True

    def save_custom_names(self, parts=None, scenes=None):
        self.saved_custom_names_called = True
        if parts:
            for k, v in parts.items():
                self.part_names[int(k)] = v
        if scenes:
            for k, v in scenes.items():
                self.scene_names[int(k)] = v
        return True

    def set_master_vst_volume(self, val):
        self.master_vst_volume = val
        return True

    def set_part_reverb(self, part, rev):
        self.part_reverbs[part] = rev
        return True

    def set_part_mute(self, part, mute):
        self.part_mutes[part] = mute
        return True

    def toggle_part_solo(self, part):
        self.part_solos[part] = not self.part_solos[part]
        return True

    def send_part_cc(self, part, cc, val):
        self.sent_ccs.append((part, cc, val))
        return True

    def set_part_volume(self, part, vol):
        self.part_volumes[part] = vol
        return True

    def select_scene(self, scene):
        self.current_scene = scene
        return True

    def save_scene_snapshot(self, scene):
        self.saved_scenes[scene] = {"part_volumes": dict(self.part_volumes)}
        return True

    def recall_saved_scene(self, scene):
        self.current_scene = scene
        return True

    def configure_warmth(self, enabled=None, drive=None, mode=None):
        self.warmth_config = {"enabled": enabled, "drive": drive, "mode": mode}
        return True

    def set_analyzer_enabled(self, enabled):
        self.analyzer_enabled = enabled
        return True

    def query_native_status(self):
        return dict(self.native_status)

    def open_license_manager(self):
        self.license_manager_opened = True
        return True


class DummyEarTraining:
    def __init__(self):
        self.played_voicings = []

    def play_voicing(self, root_midi, intervals, duration=1.5):
        self.played_voicings.append((root_midi, intervals, duration))


class DummyAppState:
    def __init__(self):
        self.montage = DummyMontage()
        self.ear_training = DummyEarTraining()
        self.ws_clients = []
        self.broadcasts = []
        self.analyzer_visible_clients = 1

    def set_analyzer_visible(self, visible):
        self.analyzer_visible_clients = 1 if visible else 0

    async def broadcast(self, msg):
        self.broadcasts.append(msg)


def get_json(resp):
    body = resp.body
    if isinstance(body, memoryview):
        body = bytes(body)
    return json.loads(body.decode("utf-8"))


def make_request(method="GET", path="/", json_body=None):
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


def test_montage_module_and_contract():
    """Verify factory in src/api_montage.py and compatibility exports in src/server.py."""
    import src.api_montage as montage_api
    import src.server as server_mod

    assert hasattr(montage_api, "create_montage_handlers")

    required_handlers = [
        "api_open_editor",
        "api_voices_catalog",
        "api_assign_voice",
        "api_montage_volume",
        "api_montage_scene",
        "api_custom_names",
        "api_play_voicing",
        "api_master_dsp",
        "api_launch_license_manager",
    ]

    for handler_name in required_handlers:
        assert hasattr(server_mod, handler_name), f"server.py missing {handler_name}"

    route_table = {r.path: r for r in server_mod.routes if hasattr(r, "path")}

    expected_routes = {
        "/api/montage/editor": {"POST"},
        "/api/montage/voices": {"GET", "HEAD"},
        "/api/montage/assign_voice": {"POST"},
        "/api/montage/volume": {"POST"},
        "/api/montage/scene": {"POST"},
        "/api/montage/names": {"GET", "HEAD", "POST"},
        "/api/montage/audition": {"POST"},
        "/api/master/dsp": {"POST"},
        "/api/montage/license": {"POST"},
    }

    for path, methods in expected_routes.items():
        assert path in route_table, f"Route {path} not registered in server"
        route = route_table[path]
        assert route.methods == methods, f"Route {path} methods {route.methods} != {methods}"

    print("PASS: montage API module structure and route contract verified")


def test_open_editor_actions():
    """Verify open_editor handler actions: start, hide, show, kill, switch."""
    import src.api_montage as montage_api
    app_state = DummyAppState()
    handlers = montage_api.create_montage_handlers(app_state)
    handle_open_editor = handlers[0]

    # Test start
    req = make_request("POST", "/api/montage/editor", {"action": "start", "engine": "community", "hidden": False})
    resp = asyncio.run(handle_open_editor(req))
    data = get_json(resp)
    assert data["success"] is True
    assert data["action"] == "started"
    assert data["engine"] == "community"

    # Test hide/show toggle
    req = make_request("POST", "/api/montage/editor", {"action": "minimize"})
    resp = asyncio.run(handle_open_editor(req))
    data = get_json(resp)
    assert data["action"] == "minimize"
    assert "minimize" in app_state.montage.toggled_windows

    # Test kill
    req = make_request("POST", "/api/montage/editor", {"action": "kill"})
    resp = asyncio.run(handle_open_editor(req))
    data = get_json(resp)
    assert data["action"] == "kill"
    assert app_state.montage.killed is True

    # Test switch
    req = make_request("POST", "/api/montage/editor", {"action": "switch", "engine": "yamaha"})
    resp = asyncio.run(handle_open_editor(req))
    data = get_json(resp)
    assert data["action"] == "switched"
    assert data["engine"] == "yamaha"

    print("PASS: open_editor actions verified")


def test_voices_catalog_and_assign():
    """Verify voice catalog reading and voice assignment to parts."""
    import src.api_montage as montage_api
    app_state = DummyAppState()
    handlers = montage_api.create_montage_handlers(app_state)
    handle_voices_catalog = handlers[1]
    handle_assign_voice = handlers[2]

    # Test voices catalog
    req = make_request("GET", "/api/montage/voices")
    resp = asyncio.run(handle_voices_catalog(req))
    data = get_json(resp)
    assert isinstance(data, list)
    assert len(data) > 0
    assert data[0]["name"] == "Nord Stage 3 Romantic Grand"

    # Test assign voice
    req = make_request("POST", "/api/montage/assign_voice", {
        "part": 2, "bank": 6, "preset": 0, "name": "Custom Chateau"
    })
    resp = asyncio.run(handle_assign_voice(req))
    data = get_json(resp)
    assert data["success"] is True
    assert data["part"] == 2
    assert data["name"] == "Custom Chateau"
    assert (2, 6, 0) in app_state.montage.assigned_voices
    assert app_state.montage.part_names[2] == "Custom Chateau"
    assert app_state.montage.saved_custom_names_called is True

    print("PASS: voices catalog and voice assignment verified")


def test_montage_volume_and_cc_controls():
    """Verify master volume and Part mixer / CC controls."""
    import src.api_montage as montage_api
    app_state = DummyAppState()
    handlers = montage_api.create_montage_handlers(app_state)
    handle_montage_volume = handlers[3]

    # Master volume
    req = make_request("POST", "/api/montage/volume", {"master_volume": 115})
    resp = asyncio.run(handle_montage_volume(req))
    data = get_json(resp)
    assert data["success"] is True
    assert app_state.montage.master_vst_volume == 115

    # Part volume
    req = make_request("POST", "/api/montage/volume", {"part": 3, "volume": 85})
    resp = asyncio.run(handle_montage_volume(req))
    data = get_json(resp)
    assert data["success"] is True
    assert app_state.montage.part_volumes[3] == 85

    # Reverb
    req = make_request("POST", "/api/montage/volume", {"part": 3, "reverb": 55})
    resp = asyncio.run(handle_montage_volume(req))
    data = get_json(resp)
    assert data["success"] is True
    assert app_state.montage.part_reverbs[3] == 55

    # Mute
    req = make_request("POST", "/api/montage/volume", {"part": 3, "mute": True})
    resp = asyncio.run(handle_montage_volume(req))
    data = get_json(resp)
    assert data["success"] is True
    assert app_state.montage.part_mutes[3] is True

    # Solo toggle
    req = make_request("POST", "/api/montage/volume", {"part": 3, "solo": True})
    resp = asyncio.run(handle_montage_volume(req))
    data = get_json(resp)
    assert data["success"] is True
    assert data["solos"]["3"] is True or data["solos"].get(3) is True

    # CC parameters: pan, cutoff, resonance, attack, release, chorus
    cc_checks = [
        ("pan", 80, 10),
        ("cutoff", 95, 74),
        ("resonance", 45, 71),
        ("attack", 30, 73),
        ("release", 70, 72),
        ("chorus", 25, 93),
    ]
    for param, val, expected_cc in cc_checks:
        req = make_request("POST", "/api/montage/volume", {"part": 4, param: val})
        resp = asyncio.run(handle_montage_volume(req))
        data = get_json(resp)
        assert data["success"] is True
        assert (4, expected_cc, val) in app_state.montage.sent_ccs

    print("PASS: montage volume and CC controls verified")


def test_scenes_and_custom_names():
    """Verify montage scenes selection/save/recall and custom names GET/POST."""
    import src.api_montage as montage_api
    app_state = DummyAppState()
    app_state.ws_clients = ["dummy_ws"]  # trigger broadcast branch
    handlers = montage_api.create_montage_handlers(app_state)
    handle_montage_scene = handlers[4]
    handle_custom_names = handlers[5]

    # Select scene
    req = make_request("POST", "/api/montage/scene", {"action": "select", "scene": 4})
    resp = asyncio.run(handle_montage_scene(req))
    data = get_json(resp)
    assert data["success"] is True
    assert data["scene"] == 4
    assert app_state.montage.current_scene == 4

    # Save scene
    req = make_request("POST", "/api/montage/scene", {"action": "save", "scene": 4})
    resp = asyncio.run(handle_montage_scene(req))
    data = get_json(resp)
    assert data["action"] == "save"

    # Recall scene
    req = make_request("POST", "/api/montage/scene", {"action": "recall", "scene": 4})
    resp = asyncio.run(handle_montage_scene(req))
    data = get_json(resp)
    assert data["action"] == "recall"

    # Custom names GET
    req = make_request("GET", "/api/montage/names")
    resp = asyncio.run(handle_custom_names(req))
    data = get_json(resp)
    assert "parts" in data
    assert "scenes" in data

    # Custom names POST
    req = make_request("POST", "/api/montage/names", {
        "parts": {"1": "My Grand"},
        "scenes": {"1": "Intro"}
    })
    resp = asyncio.run(handle_custom_names(req))
    data = get_json(resp)
    assert data["success"] is True
    assert app_state.montage.part_names[1] == "My Grand"
    assert app_state.montage.scene_names[1] == "Intro"

    print("PASS: montage scene and custom names verified")


def test_master_dsp_audition_and_license():
    """Verify master DSP, audition voicing, and license manager endpoints."""
    import src.api_montage as montage_api
    app_state = DummyAppState()
    handlers = montage_api.create_montage_handlers(app_state)
    handle_play_voicing = handlers[6]
    handle_master_dsp = handlers[7]
    handle_launch_license_manager = handlers[8]

    # Master DSP
    req = make_request("POST", "/api/master/dsp", {
        "warmth": {"enabled": True, "drive": 0.35, "mode": "tube"},
        "analyzer_enabled": True,
        "analyzer_visible": False,
    })
    resp = asyncio.run(handle_master_dsp(req))
    data = get_json(resp)
    assert data["success"] is True
    assert app_state.montage.warmth_config["drive"] == 0.35
    assert app_state.analyzer_visible_clients == 0

    # Master DSP bad body
    req = make_request("POST", "/api/master/dsp", "invalid")
    resp = asyncio.run(handle_master_dsp(req))
    assert resp.status_code == 400

    # Audition voicing
    req = make_request("POST", "/api/montage/audition", {
        "chord": "Cmaj7",
        "notes": ["C", "E", "G", "B"]
    })
    resp = asyncio.run(handle_play_voicing(req))
    data = get_json(resp)
    assert data["success"] is True
    assert len(app_state.ear_training.played_voicings) == 1
    root_midi, intervals, _ = app_state.ear_training.played_voicings[0]
    assert root_midi == 60
    assert intervals == [0, 4, 7, 11]

    # Audition without notes
    req = make_request("POST", "/api/montage/audition", {"chord": "C", "notes": []})
    resp = asyncio.run(handle_play_voicing(req))
    assert resp.status_code == 400

    # License manager
    req = make_request("POST", "/api/montage/license")
    resp = asyncio.run(handle_launch_license_manager(req))
    data = get_json(resp)
    assert data["success"] is True
    assert app_state.montage.license_manager_opened is True

    print("PASS: master DSP, audition voicing, and license manager verified")


if __name__ == "__main__":
    test_montage_module_and_contract()
    test_open_editor_actions()
    test_voices_catalog_and_assign()
    test_montage_volume_and_cc_controls()
    test_scenes_and_custom_names()
    test_master_dsp_audition_and_license()
    print("\nALL 6 MONTAGE API REGRESSION CHECKS PASSED")
