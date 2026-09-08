"""
Practice and Ear Training API boundary handlers.
Extracted from src/server.py for modularity and isolation.
Preserves route paths, HTTP methods, request/response JSON shapes, and status codes
for ambient worship drone pad (/api/drone-pad) and ear training (/api/ear-training).
"""

from starlette.responses import JSONResponse


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
                drone.start_drone(root)
            elif action == "stop":
                drone.stop_drone()
            elif action == "toggle":
                if drone.is_active:
                    drone.stop_drone()
                else:
                    root = data.get("root")
                    drone.start_drone(root)
            elif action == "set_root":
                root = data.get("root", "C")
                drone.set_root(root)
            elif action == "set_volume":
                vol = data.get("volume", 95)
                drone.set_volume(vol)
            elif action == "set_cutoff":
                cutoff = data.get("cutoff", 68)
                drone.set_cutoff(cutoff)
            elif action == "set_voice":
                vid = data.get("voice_id", "")
                bank = data.get("bank", 6)
                preset = data.get("preset", 4)
                drone.set_voice(vid, bank, preset)
            return JSONResponse({"success": True, "drone_pad": drone.get_status()})
        except Exception as e:
            return JSONResponse({"success": False, "error": str(e)}, status_code=500)

    return handle_ear_exercise, handle_drone_pad
