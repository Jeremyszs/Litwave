"""
HTTP & WebSocket Server for Montage Practice DAW
Connects the backend audio/MIDI engine to the Impeccable studio frontend
"""

import os
import json
import asyncio
import logging
from contextlib import asynccontextmanager
from typing import List
from starlette.applications import Starlette
from starlette.responses import JSONResponse, HTMLResponse, FileResponse, Response
from starlette.routing import Route, WebSocketRoute, Mount
from starlette.staticfiles import StaticFiles
from starlette.websockets import WebSocket, WebSocketDisconnect

# Single source of truth for valid FX pad banks (A-F) re-exported from runtime
from src.runtime import AppState, create_lifespan, SUPPORTED_FX_BANKS
from src.api_fx_pads import create_fx_pads_handler
from src.api_playlist import create_playlist_handlers
from src.api_montage import create_montage_handlers
from src.api_practice import create_practice_handlers
from src.api_setlist import create_setlist_handler
from src.api_analysis import create_analysis_handler

logger = logging.getLogger("litwave")

STATIC_DIR = os.path.join(os.path.dirname(__file__), "static")
os.makedirs(STATIC_DIR, exist_ok=True)

state = AppState()

# Compatibility helper
def _get_analyzer_track():
    from src.analyzer import analyze_track
    return analyze_track

# REST Endpoints
async def api_status(request):
    telemetry = {
        "audio": state.audio.get_telemetry(),
        "midi": state.midi.get_snapshot(),
        "song": state.audio.song_player.get_telemetry(),
        "montage": state.montage.check_installation(),
        "engine": state.montage.native_status,
        "fx_pads": state.audio.fx_sampler.get_status(),
        "devices": {
            "audio_outputs": state.audio.get_output_devices(force_refresh=True),
            "midi_inputs": state.midi.get_available_ports(force_refresh=True)
        }
    }
    return JSONResponse(telemetry)

async def api_transport(request):
    body = await request.json()
    action = body.get("action")
    sp = state.audio.song_player
    
    if action == "play":
        sp.play()
        # Align metronome phase ONCE at play/seek trigger
        if state.audio.metronome.enabled:
            downbeat = sp.get_beat_origin()
            cur_sec = sp.current_frame / float(state.audio.samplerate)
            state.audio.metronome.sync_to_playhead(cur_sec, downbeat)
    elif action == "pause":
        sp.pause()
    elif action == "stop":
        sp.stop()
        if state.audio.metronome.enabled:
            downbeat = sp.get_beat_origin()
            state.audio.metronome.sync_to_playhead(0.0, downbeat)
    elif action == "toggle":
        sp.toggle_play()
        if sp.is_playing and state.audio.metronome.enabled:
            downbeat = sp.get_beat_origin()
            cur_sec = sp.current_frame / float(state.audio.samplerate)
            state.audio.metronome.sync_to_playhead(cur_sec, downbeat)
    elif action == "seek":
        sec = float(body.get("seconds", 0.0))
        sp.seek_seconds(sec)
        if state.audio.metronome.enabled:
            downbeat = sp.get_beat_origin()
            state.audio.metronome.sync_to_playhead(sec, downbeat)
    elif action == "loop_a":
        sec = body.get("seconds")
        sp.set_loop_a(float(sec) if sec is not None else None)
    elif action == "loop_b":
        sec = body.get("seconds")
        sp.set_loop_b(float(sec) if sec is not None else None)
    elif action == "toggle_loop":
        sp.toggle_loop()
    elif action == "clear_loop":
        sp.clear_loop()
    elif action == "clear_track":
        sp.clear_track()
    elif action == "add_marker":
        name = body.get("name")
        sec = body.get("time")
        scene = body.get("scene")
        sp.add_marker(name, sec, scene)
    elif action == "remove_marker":
        m_id = int(body.get("id", 0))
        sp.remove_marker(m_id)
    elif action == "update_marker":
        m_id = int(body.get("id", 0))
        new_time = float(body["time"]) if "time" in body else None
        name = body.get("name")
        scene = body.get("scene")
        sp.update_marker(m_id, new_sec=new_time, name=name, scene=scene)
    elif action == "clear_markers":
        sp.clear_markers()
    elif action == "record_chord":
        c_name = body.get("chord")
        nash = body.get("nashville", "")
        sec = body.get("time")
        if c_name:
            sp.record_chord(c_name, nash, float(sec) if sec is not None else None)
    elif action == "clear_chords":
        sp.clear_chord_chart()
    elif action == "speed":
        spd = float(body.get("speed", 1.0))
        sp.set_speed(spd)
    elif action == "pitch_shift":
        semi = int(body.get("semitones", 0))
        sp.set_pitch_shift(semi)
    elif action == "volume":
        vol = float(body.get("volume", 0.8))
        sp.set_volume(vol)
        state.audio.track_volume = vol
        
    telem = sp.get_telemetry()
    telem["success"] = True
    return JSONResponse(telem)

async def api_mixer(request):
    body = await request.json()
    if "master_volume" in body:
        mv = float(body["master_volume"])
        state.audio.master_volume = mv
        state.montage.set_master_output_gain(mv)
    if "track_volume" in body:
        v = float(body["track_volume"])
        state.audio.track_volume = v
        state.audio.song_player.set_volume(v)
    if "metronome_volume" in body:
        state.audio.metronome_volume = float(body["metronome_volume"])
    if "metronome_profile" in body:
        state.audio.metronome.set_sound_profile(str(body["metronome_profile"]))
    if "metronome_bpm" in body:
        state.audio.metronome.set_bpm(float(body["metronome_bpm"]))
    if "metronome_time_sig" in body:
        state.audio.metronome.set_time_sig(int(body["metronome_time_sig"]))
    if "toggle_metronome" in body:
        state.audio.metronome.toggle()
        # Immediately lock phase to backing track if song is playing
        if state.audio.metronome.enabled and state.audio.song_player.is_playing:
            sp = state.audio.song_player
            downbeat = sp.get_beat_origin()
            cur_sec = sp.current_frame / float(state.audio.samplerate)
            state.audio.metronome.sync_to_playhead(cur_sec, downbeat)
        
    if "equalizer_band" in body:
        b_info = body["equalizer_band"]
        idx = int(b_info.get("index", 0))
        freq = float(b_info["freq"]) if "freq" in b_info else None
        gain = float(b_info["gain"]) if "gain" in b_info else None
        q = float(b_info["q"]) if "q" in b_info else None
        state.audio.equalizer.update_band(idx, freq=freq, gain=gain, q=q)
        # Simultaneously update native montage_live_engine C++ VST host
        b_obj = state.audio.equalizer.bands[idx]
        t_code = 0 if b_obj["type"] == "lowshelf" else (1 if b_obj["type"] == "peaking" else 2)
        state.montage.update_vst_equalizer(idx, t_code, b_obj["freq"], b_obj["gain"], b_obj["q"])
    if "equalizer_enabled" in body:
        state.audio.equalizer.enabled = bool(body["equalizer_enabled"])
    if "equalizer_reset" in body or "reset_equalizer_flat" in body:
        state.audio.equalizer.reset_flat()
        for idx in range(4):
            b_obj = state.audio.equalizer.bands[idx]
            t_code = 0 if b_obj["type"] == "lowshelf" else (1 if b_obj["type"] == "peaking" else 2)
            state.montage.update_vst_equalizer(idx, t_code, b_obj["freq"], 0.0, b_obj["q"])
        
    telem = state.audio.get_telemetry()
    telem["success"] = True
    return JSONResponse(telem)

async def api_audio_device(request):
    body = await request.json()
    dev_id = int(body.get("device_id", 0))
    sr = body.get("samplerate")
    bs = body.get("blocksize")
    ok = state.audio.start_stream(device_id=dev_id, samplerate=sr, blocksize=bs)
    return JSONResponse({"success": ok, "telemetry": state.audio.get_telemetry()})

async def api_midi_device(request):
    body = await request.json()
    if "port" in body:
        port = body.get("port")
        state.midi.open_port(port)
    return JSONResponse({"success": True, "snapshot": state.midi.get_snapshot()})

api_playlist, api_playlist_select, api_upload_song = create_playlist_handlers(
    state,
    upload_dir=os.path.join(STATIC_DIR, "uploads")
)

(
    api_open_editor,
    api_voices_catalog,
    api_assign_voice,
    api_montage_volume,
    api_montage_scene,
    api_custom_names,
    api_play_voicing,
    api_master_dsp,
    api_launch_license_manager,
    api_soundfonts_status,
) = create_montage_handlers(state)

async def index(request):
    html_path = os.path.join(STATIC_DIR, "index.html")
    if os.path.exists(html_path):
        with open(html_path, "r", encoding="utf-8") as f:
            return HTMLResponse(f.read())
    return HTMLResponse("<h1>Montage Practice DAW is starting...</h1>")

class CustomJSONEncoder(json.JSONEncoder):
    def default(self, obj):
        import numpy as np
        if isinstance(obj, (np.bool_, np.bool)):
            return bool(obj)
        if isinstance(obj, (np.integer, np.int64, np.int32)):
            return int(obj)
        if isinstance(obj, (np.floating, np.float32, np.float64)):
            return float(obj)
        if isinstance(obj, np.ndarray):
            return obj.tolist()
        return super().default(obj)

async def ws_telemetry(websocket: WebSocket):
    await websocket.accept()
    state.ws_clients.append(websocket)
    state._loop = asyncio.get_event_loop()
    tick = 0
    try:
        while True:
            tick += 1
            # Every 25 ticks (~1.0s), include refreshed device lists in telemetry
            include_devices = (tick % 25 == 0)
            telemetry = {
                "type": "telemetry",
                "audio": state.audio.get_telemetry(),
                "song": state.audio.song_player.get_telemetry(),
                "midi": state.midi.get_snapshot(),
                "engine": state.montage.native_status,
                "spectrum": state.montage.spectrum_bins if state.analyzer_visible_clients > 0 else [],
                "montage": {
                    "engine_type": state.montage.engine_type,
                    "is_running": state.montage.native_status.get("reachable", False),
                    "master_volume": state.montage.master_vst_volume,
                    "part_volumes": state.montage.part_volumes,
                    "part_reverbs": state.montage.part_reverbs,
                    "part_mutes": state.montage.part_mutes,
                    "part_solos": state.montage.part_solos,
                    "part_names": state.montage.part_names,
                    "scene_names": state.montage.scene_names,
                    "part_pans": state.montage.part_pans,
                    "part_cutoffs": state.montage.part_cutoffs,
                    "part_resonances": state.montage.part_resonances,
                    "part_attacks": state.montage.part_attacks,
                    "part_releases": state.montage.part_releases,
                    "part_chorus": state.montage.part_chorus,
                    "current_scene": state.montage.current_scene
                },
                "drone_pad": state.drone_pad.get_status(),
                "fx_pads": state.audio.fx_sampler.get_status()
            }
            if include_devices:
                telemetry["devices"] = {
                    "audio_outputs": state.audio.get_output_devices(),
                    "midi_inputs": state.midi.get_available_ports()
                }
            await websocket.send_text(json.dumps(telemetry, cls=CustomJSONEncoder))
            await asyncio.sleep(0.04) # 25fps refresh
    except (WebSocketDisconnect, asyncio.CancelledError, RuntimeError):
        pass
    finally:
        if websocket in state.ws_clients:
            state.ws_clients.remove(websocket)

async def api_remote_info(request):
    """Provides local LAN IP and public tunnel URL for phone pairing QR code"""
    import socket, json
    hostname = socket.gethostname()
    lan_ip = "127.0.0.1"
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(('8.8.8.8', 80))
        lan_ip = s.getsockname()[0]
        s.close()
    except Exception:
        pass

    # Check litwave tunnel state first, then fallback to 9router tunnel state
    tunnel_url = None
    litwave_tunnel_file = os.path.expandvars(r"%LOCALAPPDATA%\litwave\tunnel_state.json")
    ninerouter_tunnel_file = os.path.expandvars(r"%APPDATA%\9router\tunnel\state.json")
    for t_file in [litwave_tunnel_file, ninerouter_tunnel_file]:
        if os.path.exists(t_file):
            try:
                with open(t_file, "r", encoding="utf-8") as f:
                    tdata = json.load(f)
                    if tdata.get("tunnelUrl"):
                        tunnel_url = tdata.get("tunnelUrl")
                        break
            except Exception:
                pass

    return JSONResponse({
        "lan_ip": lan_ip,
        "port": 8080,
        "local_url": f"http://{lan_ip}:8080/remote",
        "tunnel_url": f"{tunnel_url}/remote" if tunnel_url else None,
        "preferred_url": f"{tunnel_url}/remote" if tunnel_url else f"http://{lan_ip}:8080/remote"
    })

async def remote_page(request):
    path = os.path.join(STATIC_DIR, "remote.html")
    if os.path.exists(path):
        with open(path, "r", encoding="utf-8") as f:
            return HTMLResponse(f.read())
    return HTMLResponse("<h1>Remote page not found</h1>", status_code=404)

async def service_worker_file(request):
    path = os.path.join(STATIC_DIR, "sw.js")
    if os.path.exists(path):
        with open(path, "r", encoding="utf-8") as f:
            return Response(f.read(), media_type="application/javascript", headers={"Service-Worker-Allowed": "/"})
    return Response("Not found", status_code=404)

async def manifest_file(request):
    path = os.path.join(STATIC_DIR, "manifest.json")
    if os.path.exists(path):
        with open(path, "r", encoding="utf-8") as f:
            return Response(f.read(), media_type="application/manifest+json")
    return Response("Not found", status_code=404)

async def api_midi_panic(request):
    """Stop stuck notes across Litwave and every native plugin MIDI channel."""
    active_notes = state.midi.panic()
    state.montage.panic(active_notes)
    return JSONResponse({"success": True, "released_notes": len(active_notes)})


# Compatibility wrapper & default route handler
api_fx_pads = create_fx_pads_handler(state, SUPPORTED_FX_BANKS)

# Practice and Ear Training handlers
api_ear_exercise, api_drone_pad = create_practice_handlers(state)

# Deep MIR song analysis and lyrics handler
api_analyze_song = create_analysis_handler(state, upload_dir=os.path.join(STATIC_DIR, "uploads"))

# Setlist and Patch Management handler
api_setlist = create_setlist_handler(state, SUPPORTED_FX_BANKS)

@asynccontextmanager
async def _lifespan(app):
    state.boot()
    yield
    state.shutdown()

routes = [
    Route("/", index),
    Route("/remote", remote_page),
    Route("/sw.js", service_worker_file),
    Route("/manifest.json", manifest_file),
    Route("/api/remote-info", api_remote_info, methods=["GET"]),
    Route("/api/status", api_status, methods=["GET"]),
    Route("/api/transport", api_transport, methods=["POST"]),
    Route("/api/mixer", api_mixer, methods=["POST"]),
    Route("/api/audio/device", api_audio_device, methods=["POST"]),
    Route("/api/midi/device", api_midi_device, methods=["POST"]),
    Route("/api/upload", api_upload_song, methods=["POST"]),
    Route("/api/playlist", api_playlist, methods=["GET"]),
    Route("/api/playlist/select", api_playlist_select, methods=["POST"]),
    Route("/api/analyze", api_analyze_song, methods=["GET", "POST"]),
    Route("/api/montage/editor", api_open_editor, methods=["POST"]),
    Route("/api/montage/voices", api_voices_catalog, methods=["GET"]),
    Route("/api/montage/assign_voice", api_assign_voice, methods=["POST"]),
    Route("/api/montage/volume", api_montage_volume, methods=["POST"]),
    Route("/api/montage/scene", api_montage_scene, methods=["POST"]),
    Route("/api/montage/soundfonts", api_soundfonts_status, methods=["GET"]),
    Route("/api/montage/names", api_custom_names, methods=["GET", "POST"]),
    Route("/api/montage/audition", api_play_voicing, methods=["POST"]),
    Route("/api/midi/panic", api_midi_panic, methods=["POST"]),
    Route("/api/master/dsp", api_master_dsp, methods=["POST"]),
    Route("/api/drone-pad", api_drone_pad, methods=["POST"]),
    Route("/api/fx-pads", api_fx_pads, methods=["GET", "POST"]),
    Route("/api/setlist", api_setlist, methods=["GET", "POST"]),
    Route("/api/ear-training", api_ear_exercise, methods=["GET", "POST"]),
    Route("/api/montage/license", api_launch_license_manager, methods=["POST"]),
    WebSocketRoute("/ws", ws_telemetry),
    Mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
]

app = Starlette(routes=routes, lifespan=_lifespan)
