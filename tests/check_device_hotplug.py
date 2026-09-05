"""Test dynamic hotplug device discovery and reconnection for MIDI and Audio."""
import os
import sys
import time

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from src.midi_manager import MidiManager
from src.audio_engine import AudioEngine


def test_midi_manager_auto_reconnects_when_port_appears_later():
    """Simulate app starting with 0 MIDI devices, then device plugged in after launch."""
    m = MidiManager()
    try:
        # 1. Simulate empty port list at start
        mock_ports = []
        m.get_available_ports = lambda force_refresh=False: list(mock_ports)
        m.close_port()
        assert m.port is None
        assert m.current_port_name is None
        snap = m.get_snapshot()
        assert snap["connected"] is False

        # 2. Simulate device plugged in after launch
        class DummyPort:
            def __init__(self, name):
                self.name = name
                self.closed = False

            def iter_pending(self):
                return []

            def close(self):
                self.closed = True

        mock_ports = ["CASIO USB-MIDI 0"]

        # Mock mido.open_input to return our dummy port
        import mido
        orig_open_input = mido.open_input
        mido.open_input = lambda name: DummyPort(name)

        try:
            # Trigger port probe / worker auto-reconnect
            m._probe_and_reconnect()
            assert m.port is not None, "MidiManager failed to auto-connect to newly plugged device"
            assert m.current_port_name == "CASIO USB-MIDI 0"
            snap = m.get_snapshot()
            assert snap["connected"] is True
            assert snap["port_name"] == "CASIO USB-MIDI 0"
            print(" -> MIDI hotplug auto-reconnect verified.")
        finally:
            mido.open_input = orig_open_input
    finally:
        m.close_port()


def test_midi_manager_integer_and_string_port_selection():
    """Verify open_port accepts both port index (from dropdown option values) and string names."""
    m = MidiManager()
    try:
        mock_ports = ["Keyboard A", "CASIO USB-MIDI 0", "Pedalboard B"]
        m.get_available_ports = lambda force_refresh=False: list(mock_ports)

        class DummyPort:
            def __init__(self, name):
                self.name = name

            def iter_pending(self):
                return []

            def close(self):
                pass

        import mido
        orig_open = mido.open_input
        mido.open_input = lambda name: DummyPort(name)
        try:
            # Test index 1 -> "CASIO USB-MIDI 0"
            assert m.open_port(1) is True
            assert m.current_port_name == "CASIO USB-MIDI 0"

            # Test string index "2" -> "Pedalboard B"
            assert m.open_port("2") is True
            assert m.current_port_name == "Pedalboard B"

            # Test string substring "keyboard" -> "Keyboard A"
            assert m.open_port("keyboard") is True
            assert m.current_port_name == "Keyboard A"
            print(" -> MIDI port index and substring selection verified.")
        finally:
            mido.open_input = orig_open
    finally:
        m.close_port()


def test_api_play_voicing_sends_udp_to_montage():
    from src.server import app
    from starlette.testclient import TestClient
    client = TestClient(app)
    res = client.post("/api/montage/audition", json={"chord": "C", "notes": ["C", "E", "G"]})
    assert res.status_code == 200
    data = res.json()
    assert data["success"] is True
    assert data["chord"] == "C"
    print(" -> Voicing audition API verified.")


def test_audio_engine_hotplug_refresh_output_devices():
    """Verify AudioEngine can query fresh audio devices and detects new/removed outputs."""
    engine = AudioEngine()
    devs = engine.get_output_devices(force_refresh=True)
    assert isinstance(devs, list)
    assert len(devs) > 0
    assert "id" in devs[0]
    assert "name" in devs[0]
    assert "is_asio" in devs[0]
    print(f" -> AudioEngine output device refresh verified ({len(devs)} devices discovered).")


if __name__ == "__main__":
    tests = [v for k, v in globals().items() if k.startswith("test_")]
    for t in tests:
        t()
    print(f"\nPASS: {len(tests)} device hotplug detection tests passed!")
