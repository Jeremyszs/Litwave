"""
Performance FX Pad API handler and helpers.
Extracted from src/server.py for modularity and isolation.
Preserves route path, methods, request/response JSON shapes, status codes,
and SUPPORTED_FX_BANKS validation without circular imports or side-effects.
"""

import json
import asyncio
from typing import Optional, Tuple
from starlette.responses import JSONResponse

from src.api_validation import ApiError, num, one_of, require_text


def create_fx_pads_handler(app_state, supported_banks: Optional[Tuple[str, ...]] = None):
    """
    Factory creating the api_fx_pads endpoint handler with injected state and bank choices.
    Avoids circular imports and enables decoupled testing with mock/custom state.
    """
    if supported_banks is None:
        from src.runtime import SUPPORTED_FX_BANKS
        banks = SUPPORTED_FX_BANKS
    else:
        banks = supported_banks

    async def handle_fx_pads(request):
        """Performance FX Pad sampler trigger and configuration endpoint"""
        try:
            data = await request.json() if request.method == "POST" else {}
            action = data.get("action", "trigger")
            sampler = app_state.audio.fx_sampler

            if action == "trigger":
                pad_id = data.get("pad_id")
                if request.method == "POST":
                    pad_id = require_text(pad_id, "pad_id")
                velocity = num(data.get("velocity", 127), "velocity", lo=0, hi=127, integer=True)
                act = one_of(data.get("press_type", "press"), ("press", "release"), "press_type")
                ok = sampler.trigger_pad(pad_id, velocity=velocity, action=act)

                # Broadcast instant lightweight pad pulse over WebSocket to all clients
                if app_state.ws_clients and ok:
                    msg = json.dumps({
                        "type": "fx_pad_pulse",
                        "pad_id": pad_id,
                        "action": act
                    })
                    asyncio.create_task(app_state.broadcast(msg))

                return JSONResponse({"success": ok, "pad_id": pad_id})

            elif action == "stop_all":
                sampler.stop_all_pads()
                return JSONResponse({"success": True})

            elif action == "bank":
                bank = require_text(data.get("bank", "A"), "bank").upper()
                valid = bank in banks
                if not valid:
                    raise ApiError(f"bank must be one of: {', '.join(banks)}")
                sampler.active_bank = bank
                sampler.persist_settings()
                return JSONResponse({"success": True, "active_bank": sampler.active_bank})

            elif action == "bus":
                if "volume" in data:
                    sampler.bus_volume = max(0.0, min(1.5, num(data["volume"], "volume")))
                if "muted" in data:
                    sampler.bus_muted = bool(data["muted"])
                sampler.persist_settings()
                return JSONResponse({"success": True, "bus_volume": sampler.bus_volume, "bus_muted": sampler.bus_muted})

            elif action == "update_pad":
                pad_id = data.get("pad_id")
                if "trigger_mode" in data:
                    one_of(data["trigger_mode"], ("oneshot", "gate", "toggle"), "trigger_mode")
                for key, lo, hi in (("volume", 0, 4), ("pan", -1, 1), ("pitch", -48, 48)):
                    if key in data:
                        num(data[key], key, lo=lo, hi=hi)
                if "choke_group" in data:
                    num(data["choke_group"], "choke_group", lo=0, hi=16, integer=True)
                if data.get("midi_note") is not None:
                    num(data["midi_note"], "midi_note", lo=0, hi=127, integer=True)
                if pad_id in sampler.pads:
                    p = sampler.pads[pad_id]
                    for key in ["name", "sample_path", "trigger_mode", "choke_group", "volume", "pan", "pitch", "midi_note", "velocity_sensitive"]:
                        if key in data:
                            p[key] = data[key]
                    sampler._rebuild_midi_map()
                    # If sample path was updated, preload it
                    if "sample_path" in data and data["sample_path"]:
                        buf = sampler._decode_audio_file(data["sample_path"])
                        if buf is not None:
                            sampler.sample_cache[data["sample_path"]] = buf
                    if "sound_id" in data:
                        sound_id = data["sound_id"]
                        if hasattr(sampler, "sound_catalog") and sound_id in sampler.sound_catalog:
                            s_meta = sampler.sound_catalog[sound_id]
                            p["sound_id"] = sound_id
                            p["name"] = s_meta["name"]
                            p["sample_path"] = s_meta["sample_path"]
                            p["category"] = s_meta.get("category", p.get("category"))
                            if p["sample_path"] not in sampler.sample_cache:
                                buf = sampler._decode_audio_file(p["sample_path"])
                                if buf is not None:
                                    sampler.sample_cache[p["sample_path"]] = buf
                    sampler.persist_settings()
                    return JSONResponse({"success": True, "pad": p})
                return JSONResponse({"error": "Invalid pad_id"}, status_code=404)

            elif action == "upload_custom_sample":
                # Handled via multipart or upload endpoint
                pass

            elif request.method == "POST" and action not in ("trigger", "stop_all", "bank", "bus", "update_pad", "upload_custom_sample"):
                raise ApiError(f"Unknown fx-pads action: {action!r}")

            return JSONResponse(sampler.get_status())
        except Exception as e:
            return JSONResponse({"success": False, "error": str(e)}, status_code=400)

    return handle_fx_pads
