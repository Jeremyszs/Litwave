"""Regression checks for native bridge parsing, Panic, and persisted DSP controls."""
import os
import struct
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from src.midi_manager import MidiManager
from src.montage_host import MontageHost, NATIVE_STATUS_FORMAT, NATIVE_STATUS_MAGIC, SPECTRUM_MAGIC


def test_native_status_packet_parses_real_fields():
    host = MontageHost()
    packet = struct.pack(
        NATIVE_STATUS_FORMAT,
        NATIVE_STATUS_MAGIC, 0.14, 0.42, 3, 48000, 128, 2,
        2.6667, 5.3333, 6.6667, 1, 1, 1.35, 0, 0.082,
        b"wasapi\0", b"HD USB Audio Device\0",
    )
    status = host._parse_native_status(packet)
    assert status["reachable"] is True
    assert status["sample_rate"] == 48000
    assert status["buffer_frames"] == 128
    assert status["xruns"] == 3
    assert status["dsp_load_percent"] == 14.0
    assert status["total_latency_ms"] == 6.7
    assert status["analyzer_enabled"] is True
    assert status["warmth"]["enabled"] is True
    assert status["warmth"]["drive"] == 1.35
    assert status["warmth"]["mode"] == 0


def test_spectrum_packet_requires_magic_and_finite_bins():
    host = MontageHost()
    bins = [-90.0 + i * 0.5 for i in range(96)]
    packet = struct.pack("<II96f", SPECTRUM_MAGIC, 96, *bins)
    parsed = host._parse_spectrum(packet)
    assert len(parsed) == 96
    assert parsed[0] == -90.0
    assert parsed[-1] == -42.5
    assert host._parse_spectrum(b"bad") == []


def test_panic_clears_tracked_notes_and_controllers():
    manager = MidiManager()
    try:
        manager.active_notes = {60: 100, 64: 110, 67: 120}
        manager.pedals.update({"sustain": 127, "soft": 127, "sostenuto": 127, "expression": 4, "volume": 8})
        manager.pitch_bend = 10000
        manager.modulation = 91
        notes = manager.panic()
        assert notes == [60, 64, 67]
        snapshot = manager.get_snapshot()
        assert snapshot["active_notes"] == []
        assert snapshot["pedals"] == {"sustain": 0, "expression": 127, "soft": 0, "volume": 127, "sostenuto": 0}
        assert snapshot["pitch_bend"] == 8192
        assert snapshot["modulation"] == 0
    finally:
        manager.close_port()


def test_warmth_and_analyzer_settings_are_persisted():
    with tempfile.TemporaryDirectory() as directory:
        host = MontageHost()
        host.dsp_settings_file = str(Path(directory) / "master_dsp_settings.json")
        sent = []
        host._send_udp = lambda payload, response_size=0: sent.append(payload) or b""
        host.configure_warmth(enabled=True, drive=1.8, mode=1)
        assert host.warmth_enabled is True
        assert host.warmth_drive == 1.8
        assert host.warmth_mode == 1
        assert sent[-1][0] == 0x77

        host.set_analyzer_enabled(False)
        assert sent[-1] == bytes([0x48, 0, 0, 0])
        host.set_analyzer_enabled(True)
        assert sent[-1] == bytes([0x48, 1, 0, 0])

        reloaded = MontageHost()
        reloaded.dsp_settings_file = host.dsp_settings_file
        reloaded._load_dsp_settings()
        assert reloaded.analyzer_enabled is True
        assert reloaded.warmth_enabled is True
        assert reloaded.warmth_drive == 1.8
        assert reloaded.warmth_mode == 1


if __name__ == "__main__":
    test_native_status_packet_parses_real_fields()
    test_spectrum_packet_requires_magic_and_finite_bins()
    test_panic_clears_tracked_notes_and_controllers()
    test_warmth_and_analyzer_settings_are_persisted()
    print("PASS: 4 realtime safety bridge checks")
