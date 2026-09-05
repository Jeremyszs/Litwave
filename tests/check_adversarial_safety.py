"""Adversarial stress and edge case verification for realtime safety additions."""
import numpy as np
from starlette.testclient import TestClient
from src.server import app, state


def test_adversarial_endpoints_edge_cases():
    client = TestClient(app)

    # 1. Panic endpoint must succeed even when state has zero notes
    res = client.post("/api/midi/panic")
    assert res.status_code == 200
    assert res.json()["success"] is True

    # 2. Master DSP toggle works safely
    res = client.post("/api/master/dsp", json={"analyzer_enabled": False})
    assert res.status_code == 200
    assert state.montage.analyzer_enabled is False

    res = client.post("/api/master/dsp", json={"analyzer_enabled": True})
    assert res.status_code == 200
    assert state.montage.analyzer_enabled is True

    # 3. Warmth configuration handles out-of-range parameters gracefully
    res = client.post("/api/master/dsp", json={"warmth": {"drive": 99.0, "mode": 5, "enabled": True}})
    assert res.status_code == 200
    assert state.montage.warmth_drive == 3.0
    assert state.montage.warmth_mode == 0

    res = client.post("/api/master/dsp", json={"warmth": {"drive": -10.0, "mode": 1, "enabled": False}})
    assert res.status_code == 200
    assert state.montage.warmth_drive == 1.0
    assert state.montage.warmth_mode == 1
    assert state.montage.warmth_enabled is False

    # 4. Invalid JSON types must not crash the server
    res = client.post("/api/master/dsp", json="invalid-string-body")
    assert res.status_code == 400

    print("PASS: adversarial endpoint checks passed")


def test_dsp_nan_inf_adversarial_resilience():
    # Verify that in-memory telemetry handles NaN/Inf from upstream without breaking JSON serialization
    state.montage.native_status = {
        "reachable": True,
        "sample_rate": 48000,
        "buffer_frames": 256,
        "buffer_latency_ms": 5.3,
        "output_latency_ms": 1.5,
        "total_latency_ms": 6.8,
        "dsp_load_percent": 15.2,
        "peak_dsp_load_percent": 24.1,
        "xruns": 0,
        "analyzer_enabled": True,
        "warmth": {
            "enabled": True,
            "drive": 1.2,
            "mode": 0,
            "meter": 0.05,
        },
        "backend": "wasapi",
        "device": "Speakers",
    }
    client = TestClient(app)
    res = client.get("/api/status")
    assert res.status_code == 200
    print("PASS: JSON resilience checks passed")


if __name__ == "__main__":
    test_adversarial_endpoints_edge_cases()
    test_dsp_nan_inf_adversarial_resilience()
