"""
Montage M & Native Host API boundary endpoints.
Extracted from src/server.py for modularity and isolation.
Preserves route paths, HTTP methods, request/response JSON shapes, status codes,
validation, persistence, and UDP/native-host command behavior without circular imports.
"""

import os
import json
import asyncio
import time
from typing import Optional
from starlette.responses import JSONResponse


class CustomJSONEncoder(json.JSONEncoder):
    """Encodes NumPy types if present when serializing telemetry payloads."""
    def default(self, o):
        try:
            import numpy as np
            if isinstance(o, (getattr(np, "bool_", bool), bool)):
                return bool(o)
            if isinstance(o, (getattr(np, "integer", int), getattr(np, "int64", int), getattr(np, "int32", int))):
                return int(o)
            if isinstance(o, (getattr(np, "floating", float), getattr(np, "float32", float), getattr(np, "float64", float))):
                return float(o)
            if isinstance(o, getattr(np, "ndarray", (list, tuple))):
                return o.tolist()
        except ImportError:
            pass
        return super().default(o)


def create_montage_handlers(app_state, catalog_path: Optional[str] = None):
    """
    Factory creating Montage M and native host endpoint handlers with injected state.
    Avoids circular imports and enables decoupled testing with mock/dummy state.
    """
    if catalog_path is None:
        catalog_path = os.path.join(os.path.dirname(__file__), "voice_catalog.json")

    async def handle_open_editor(request):
        """Controls VST editor launch, minimization, hiding, and engine switching."""
        try:
            data = await request.json() if request.method == "POST" else {}
            action = data.get("action")
            engine = data.get("engine")  # "yamaha" or "community"
            if action == "kill":
                ok = app_state.montage.kill_vst_engine()
                return JSONResponse({"success": ok, "action": "kill"})
            elif action == "switch":
                app_state.montage.kill_vst_engine()
                time.sleep(0.3)
                ok = app_state.montage.open_vst_editor(hidden=False, engine=engine)
                return JSONResponse({"success": ok, "action": "switched", "engine": app_state.montage.engine_type})
            elif action in ("hide", "show", "minimize"):
                # Check if running first
                if not app_state.montage.is_engine_running():
                    ok = app_state.montage.open_vst_editor(hidden=(action == "hide"), engine=engine)
                    return JSONResponse({"success": ok, "action": "started_fresh", "engine": app_state.montage.engine_type})
                ok = app_state.montage.toggle_vst_window(action)
                return JSONResponse({"success": ok, "action": action, "engine": app_state.montage.engine_type})
            elif action == "start":
                hidden = bool(data.get("hidden", True))
                ok = app_state.montage.open_vst_editor(hidden=hidden, engine=engine)
                return JSONResponse({"success": ok, "action": "started", "engine": app_state.montage.engine_type})
        except Exception:
            pass
        ok = app_state.montage.open_vst_editor()
        return JSONResponse({"success": ok, "engine": app_state.montage.engine_type})

    async def handle_voices_catalog(request):
        """Return available voice presets in Community SoundFont VST catalog."""
        if os.path.exists(catalog_path):
            try:
                with open(catalog_path, "r", encoding="utf-8") as f:
                    return JSONResponse(json.load(f))
            except Exception:
                pass
        return JSONResponse([])

    async def handle_assign_voice(request):
        """Assign a soundfont voice to a part in Community VST."""
        try:
            data = await request.json()
            part = int(data.get("part", 1))
            bank = int(data.get("bank", 0))
            preset = int(data.get("preset", 0))
            name = data.get("name")
            ok = app_state.montage.assign_part_voice(part, bank, preset)
            if name:
                app_state.montage.part_names[part] = name
                app_state.montage.save_custom_names()
            return JSONResponse({"success": ok, "part": part, "bank": bank, "preset": preset, "name": name})
        except Exception as e:
            return JSONResponse({"success": False, "error": str(e)}, status_code=500)

    async def handle_montage_volume(request):
        """Controls master volume and Part 1-8 mixer parameters (vol, pan, rev, cutoff, res, atk, rel, cho, mute, solo)."""
        try:
            data = await request.json()
            if "master_volume" in data:
                val = int(data["master_volume"])
                ok = app_state.montage.set_master_vst_volume(val)
                return JSONResponse({"success": ok, "master_volume": val})
            part = int(data.get("part", 1))
            if "reverb" in data:
                rev = int(data["reverb"])
                ok = app_state.montage.set_part_reverb(part, rev)
                return JSONResponse({"success": ok, "part": part, "reverb": rev})
            if "mute" in data:
                m = bool(data["mute"])
                ok = app_state.montage.set_part_mute(part, m)
                return JSONResponse({"success": ok, "part": part, "mute": m})
            if "solo" in data:
                ok = app_state.montage.toggle_part_solo(part)
                return JSONResponse({"success": ok, "part": part, "solos": app_state.montage.part_solos, "mutes": app_state.montage.part_mutes})
            if "pan" in data:
                pan = int(data["pan"])
                app_state.montage.part_pans[part] = pan
                ok = app_state.montage.send_part_cc(part, 10, pan)  # CC#10 Pan
                return JSONResponse({"success": ok, "part": part, "pan": pan})
            if "cutoff" in data:
                cut = int(data["cutoff"])
                app_state.montage.part_cutoffs[part] = cut
                ok = app_state.montage.send_part_cc(part, 74, cut)  # CC#74 Brightness / Cutoff
                return JSONResponse({"success": ok, "part": part, "cutoff": cut})
            if "resonance" in data:
                res = int(data["resonance"])
                app_state.montage.part_resonances[part] = res
                ok = app_state.montage.send_part_cc(part, 71, res)  # CC#71 Harmonic / Resonance
                return JSONResponse({"success": ok, "part": part, "resonance": res})
            if "attack" in data:
                att = int(data["attack"])
                app_state.montage.part_attacks[part] = att
                ok = app_state.montage.send_part_cc(part, 73, att)  # CC#73 Attack Time
                return JSONResponse({"success": ok, "part": part, "attack": att})
            if "release" in data:
                rel = int(data["release"])
                app_state.montage.part_releases[part] = rel
                ok = app_state.montage.send_part_cc(part, 72, rel)  # CC#72 Release Time
                return JSONResponse({"success": ok, "part": part, "release": rel})
            if "chorus" in data:
                cho = int(data["chorus"])
                app_state.montage.part_chorus[part] = cho
                ok = app_state.montage.send_part_cc(part, 93, cho)  # CC#93 Chorus Send
                return JSONResponse({"success": ok, "part": part, "chorus": cho})
            volume = int(data.get("volume", 100))  # 0 - 127
            ok = app_state.montage.set_part_volume(part, volume)
            return JSONResponse({"success": ok, "part": part, "volume": volume})
        except Exception as e:
            return JSONResponse({"error": str(e)}, status_code=400)

    async def handle_montage_scene(request):
        """Handles selecting, saving, and recalling Montage scenes, broadcasting updates to WS clients."""
        try:
            data = await request.json()
            action = data.get("action", "select")
            scene = int(data.get("scene", 1))
            if action == "save":
                ok = app_state.montage.save_scene_snapshot(scene)
                res_payload = {"success": ok, "action": "save", "scene": scene, "snapshot": app_state.montage.saved_scenes[scene]}
            elif action == "recall":
                ok = app_state.montage.recall_saved_scene(scene)
                res_payload = {"success": ok, "action": "recall", "scene": scene, "snapshot": app_state.montage.saved_scenes[scene]}
            else:
                ok = app_state.montage.select_scene(scene)
                res_payload = {"success": ok, "action": "select", "scene": scene}

            # Broadcast instant scene & parts update to all active WebSocket clients (desktop & remote)
            if app_state.ws_clients:
                sync_msg = json.dumps({
                    "type": "telemetry",
                    "montage": {
                        "current_scene": app_state.montage.current_scene,
                        "master_volume": app_state.montage.master_vst_volume,
                        "part_volumes": app_state.montage.part_volumes,
                        "part_reverbs": app_state.montage.part_reverbs,
                        "part_mutes": app_state.montage.part_mutes,
                        "part_solos": app_state.montage.part_solos,
                        "scene_names": app_state.montage.scene_names
                    }
                }, cls=CustomJSONEncoder)
                asyncio.create_task(app_state.broadcast(sync_msg))

            return JSONResponse(res_payload)
        except Exception as e:
            return JSONResponse({"error": str(e)}, status_code=400)

    async def handle_custom_names(request):
        """Saves and retrieves custom user labels for MONTAGE M Parts 1-8 and Scenes 1-8."""
        try:
            if request.method == "POST":
                data = await request.json()
                parts = data.get("parts")
                scenes = data.get("scenes")
                ok = app_state.montage.save_custom_names(parts, scenes)
                return JSONResponse({"success": ok, "parts": app_state.montage.part_names, "scenes": app_state.montage.scene_names})
            else:
                return JSONResponse({"parts": app_state.montage.part_names, "scenes": app_state.montage.scene_names})
        except Exception as e:
            return JSONResponse({"error": str(e)}, status_code=400)

    async def handle_play_voicing(request):
        """Audition a chord voicing directly to MONTAGE M via UDP."""
        try:
            data = await request.json()
            chord_name = data.get("chord", "C")
            notes = data.get("notes", [])
            if not notes:
                return JSONResponse({"success": False, "error": "No notes provided"}, status_code=400)

            # Convert pitch note names (e.g. ['C', 'E', 'G']) to MIDI note numbers
            note_map = {'C': 0, 'C#': 1, 'Db': 1, 'D': 2, 'D#': 3, 'Eb': 3, 'E': 4,
                        'F': 5, 'F#': 6, 'Gb': 6, 'G': 7, 'G#': 8, 'Ab': 8, 'A': 9,
                        'A#': 10, 'Bb': 10, 'B': 11}
            root_name = chord_name.split('/')[0].strip()
            root_key = root_name[:2] if len(root_name) > 1 and root_name[1] in ('#', 'b') else root_name[:1]
            root_semi = note_map.get(root_key, 0)
            root_midi = 60 + root_semi  # Center around C4

            intervals = []
            for n in notes:
                n_clean = n.strip()
                semi = note_map.get(n_clean, 0)
                diff = (semi - root_semi) % 12
                intervals.append(diff)

            # Deduplicate preserving order
            unique_intervals = sorted(list(set(intervals)))
            app_state.ear_training.play_voicing(root_midi, unique_intervals, duration=1.5)
            return JSONResponse({"success": True, "chord": chord_name, "notes": notes})
        except Exception as e:
            return JSONResponse({"error": str(e)}, status_code=400)

    async def handle_master_dsp(request):
        """Update persisted master spectrum analyzer and stage warmth controls."""
        try:
            data = await request.json()
            if not isinstance(data, dict):
                return JSONResponse({"error": "Expected JSON object"}, status_code=400)
            if "warmth" in data and isinstance(data["warmth"], dict):
                w = data["warmth"]
                app_state.montage.configure_warmth(
                    enabled=w.get("enabled"),
                    drive=w.get("drive"),
                    mode=w.get("mode"),
                )
            if "analyzer_enabled" in data:
                app_state.montage.set_analyzer_enabled(bool(data["analyzer_enabled"]))
            if "analyzer_visible" in data:
                app_state.set_analyzer_visible(bool(data["analyzer_visible"]))
            # Refresh native status immediately so returned JSON and cached telemetry are up to date
            fresh_status = app_state.montage.query_native_status()
            return JSONResponse({"success": True, "engine": fresh_status})
        except (TypeError, ValueError) as error:
            return JSONResponse({"error": str(error)}, status_code=400)

    async def handle_launch_license_manager(request):
        """Launch Yamaha Montage M license manager executable."""
        ok = app_state.montage.open_license_manager()
        return JSONResponse({"success": ok})

    return (
        handle_open_editor,
        handle_voices_catalog,
        handle_assign_voice,
        handle_montage_volume,
        handle_montage_scene,
        handle_custom_names,
        handle_play_voicing,
        handle_master_dsp,
        handle_launch_license_manager,
    )
