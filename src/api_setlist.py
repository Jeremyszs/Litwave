"""
Setlist and Patch Management API handlers.
Extracted from src/server.py for modularity and isolation.
Preserves route paths, HTTP methods, request/response JSON shapes, status codes,
and patch recall (engine, part mixer, drone root, FX bank) without circular imports.
"""

from typing import Optional, Tuple
from starlette.responses import JSONResponse


def create_setlist_handler(app_state, supported_banks: Optional[Tuple[str, ...]] = None):
    """
    Factory creating the api_setlist handler with injected state and supported banks.
    Avoids circular imports and allows isolated testing with dummy state.
    """
    if supported_banks is None:
        from src.runtime import SUPPORTED_FX_BANKS
        banks = SUPPORTED_FX_BANKS
    else:
        banks = supported_banks

    async def handle_setlist(request):
        """Setlist and Patch Management API"""
        try:
            if request.method == "GET":
                return JSONResponse({"success": True, "setlists": app_state.setlist.get_setlists()})
            data = await request.json()
            action = data.get("action")
            setlist = app_state.setlist

            if action == "create_setlist":
                name = data.get("name", "New Setlist")
                item = setlist.create_setlist(name)
                return JSONResponse({"success": True, "setlist": item})
            elif action == "delete_setlist":
                sid = data.get("setlist_id")
                ok = setlist.delete_setlist(sid)
                return JSONResponse({"success": ok, "setlists": setlist.get_setlists()})
            elif action == "move_song":
                sid = data.get("setlist_id")
                song_id = data.get("song_id")
                direction = data.get("direction", "up")
                ok = setlist.move_song(sid, song_id, direction)
                return JSONResponse({"success": ok, "setlists": setlist.get_setlists()})
            elif action == "add_song":
                sid = data.get("setlist_id")
                song = data.get("song_data", {})
                # Include current patch snapshot
                patch_snapshot = {
                    "engine_type": app_state.montage.engine_type,
                    "part_volumes": dict(app_state.montage.part_volumes),
                    "part_reverbs": dict(app_state.montage.part_reverbs),
                    "part_mutes": dict(app_state.montage.part_mutes),
                    "part_names": dict(app_state.montage.part_names),
                    "drone_root": app_state.drone_pad.current_root
                }
                song["patch_snapshot"] = patch_snapshot
                ok = setlist.add_song_to_setlist(sid, song)
                return JSONResponse({"success": ok, "setlists": setlist.get_setlists()})
            elif action == "remove_song":
                sid = data.get("setlist_id")
                song_id = data.get("song_id")
                ok = setlist.remove_song_from_setlist(sid, song_id)
                return JSONResponse({"success": ok, "setlists": setlist.get_setlists()})
            elif action == "apply_song_patch":
                patch = data.get("patch_snapshot", {})
                # 1. Switch engine if needed
                req_engine = patch.get("engine_type")
                if req_engine and req_engine != app_state.montage.engine_type:
                    app_state.montage.kill_vst_engine()
                    app_state.montage.open_vst_editor(hidden=False, engine=req_engine)
                # 2. Apply part volumes, reverbs, mutes
                vols = patch.get("part_volumes", {})
                for p_str, v in vols.items():
                    app_state.montage.set_part_volume(int(p_str), int(v))
                revs = patch.get("part_reverbs", {})
                for p_str, r in revs.items():
                    app_state.montage.set_part_reverb(int(p_str), int(r))
                mutes = patch.get("part_mutes", {})
                for p_str, m in mutes.items():
                    app_state.montage.set_part_mute(int(p_str), bool(m))
                # 3. Update drone root if specified
                if "drone_root" in patch:
                    app_state.drone_pad.set_root(patch["drone_root"])
                # 4. Recall FX Bank if specified
                if "fx_bank" in patch:
                    bank = str(patch["fx_bank"]).upper()
                    if bank in banks:
                        app_state.audio.fx_sampler.active_bank = bank
                        app_state.audio.fx_sampler.persist_settings()
                return JSONResponse({"success": True, "applied": True})
            return JSONResponse({"success": False, "error": "Unknown action"}, status_code=400)
        except Exception as e:
            return JSONResponse({"success": False, "error": str(e)}, status_code=500)

    return handle_setlist
