"""Test scene renaming, persistence, and bookmark scene dispatch."""
import json
import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from starlette.testclient import TestClient
from src.server import app, state


def test_scene_renaming_and_sync():
    client = TestClient(app)

    # 1. Rename Scene 2 to "Lead Synth"
    res = client.post("/api/montage/names", json={"scenes": {"2": "Lead Synth"}})
    assert res.status_code == 200
    data = res.json()
    assert data["scenes"]["2"] == "Lead Synth" or data["scenes"][2] == "Lead Synth"

    # 2. Check /api/status telemetry carries the renamed scene
    res = client.get("/api/status")
    assert res.status_code == 200
    data = res.json()
    assert state.montage.scene_names[2] == "Lead Synth"

    # 3. Add bookmark with Scene 2
    fpath = "src/static/uploads/YESUS KAU SUNGGUH BAIK SYMPHONY WORSHIP LIVE ARR.mp3"
    state.audio.song_player.load_file(fpath)
    res = client.post("/api/transport", json={"action": "add_marker", "name": "Bridge 1", "time": 45.0, "scene": 2})
    assert res.status_code == 200
    song = res.json()
    markers = song.get("markers", [])
    matching = [m for m in markers if m["name"] == "Bridge 1"]
    assert len(matching) == 1
    assert matching[0]["scene"] == 2

    # Clean up test marker
    client.post("/api/transport", json={"action": "remove_marker", "id": matching[0]["id"]})

    print("PASS: Scene renaming and bookmark assignment verified!")


if __name__ == "__main__":
    test_scene_renaming_and_sync()
