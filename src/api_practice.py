"""
Practice and Ear Training API boundary handlers.
Extracted from src/server.py for modularity and isolation.
Preserves route paths, HTTP methods, request/response JSON shapes, and status codes
for ambient worship drone pad (/api/drone-pad) and ear training (/api/ear-training).
"""

from starlette.responses import JSONResponse

from src.api_validation import ApiError, num, one_of
from src.drone_pad import DronePadManager as DronePad


def create_practice_handlers(app_state):
    """
    Factory creating drone pad and ear training API handlers with injected state.
    Avoids circular imports and allows isolated regression testing with dummy state.
    """

    async def handle_ear_exercise(request):
        """Generate or retrieve ear training exercise"""
        try:
            body = await request.json() if request.method == "POST" else {}
            action = body.get("action", "generate")
            trainer = app_state.ear_training
            if action == "replay":
                ok = trainer.replay_current()
                return JSONResponse({"success": ok})
            elif action == "check":
                ans = body.get("answer")
                res = trainer.check_answer(ans)
                return JSONResponse(res)
            else:  # generate
                module = body.get("module", "chord_quality")
                ex = trainer.generate_exercise(module)
                return JSONResponse({"success": True, "exercise": ex, "score": trainer.current_score})
        except Exception as e:
            return JSONResponse({"error": str(e)}, status_code=400)

    async def handle_drone_pad(request):
        """Ambient Worship Drone Pad API"""
        try:
            data = await request.json()
            action = data.get("action")
            drone = app_state.drone_pad

            if action == "start":
                root = data.get("root")
                if root is not None:
                    one_of(root, DronePad.ROOT_MIDI, "root")
                drone.start_drone(root)
            elif action == "stop":
                drone.stop_drone()
            elif action == "toggle":
                if drone.is_active:
                    drone.stop_drone()
                else:
                    root = data.get("root")
                    if root is not None:
                        one_of(root, DronePad.ROOT_MIDI, "root")
                    drone.start_drone(root)
            elif action == "set_root":
                root = one_of(data.get("root", "C"), DronePad.ROOT_MIDI, "root")
                drone.set_root(root)
            elif action == "set_volume":
                vol = num(data.get("volume", 95), "volume", lo=0, hi=127)
                drone.set_volume(vol)
            elif action == "set_cutoff":
                cutoff = num(data.get("cutoff", 68), "cutoff", lo=0, hi=127)
                drone.set_cutoff(cutoff)
            elif action == "set_voice":
                vid = data.get("voice_id", "")
                bank = num(data.get("bank", 6), "bank", lo=0, hi=127, integer=True)
                preset = num(data.get("preset", 4), "preset", lo=0, hi=127, integer=True)
                drone.set_voice(vid, bank, preset)
            elif action != "stop":
                raise ApiError(f"Unknown drone action: {action!r}")
            return JSONResponse({"success": True, "drone_pad": drone.get_status()})
        except (ValueError, TypeError, KeyError) as e:
            return JSONResponse({"success": False, "error": str(e)}, status_code=400)
        except Exception as e:
            return JSONResponse({"success": False, "error": str(e)}, status_code=500)

    return handle_ear_exercise, handle_drone_pad
