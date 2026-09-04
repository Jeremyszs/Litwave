# Implementation Plan: MONTAGE M Part Mute/Solo, Part Reverb Send, and Sound State Auto-Restore

**Goal:**
1. Implement Part 1-8 Reverb Send sliders and Mute/Solo controls in the native C++ host, backend, and both desktop/remote frontends.
2. Implement automatic persistence and restoration of the entire Yamaha MONTAGE M sound preset state (`getState`/`setState`) across launches.
3. Provide architectural clarification on native Win32 GUI docking within web browsers.

---

### Phase 1: Native C++ Host (`cpp_host/native_complete_host.cpp`)
- Define parameter tables:
  - `kPartMuteParamIDs[8]` = { 568871075, 1456374756, 196394789, 1083898470, 1971402151, 711422184, 1598925865, 338945898 }
  - `kPartReverbParamIDs[8]` = { 568872068, 1456375749, 196395782, 1083899463, 1971403144, 711423177, 1598926858, 338946891 }
- Add UDP command `0x52` (`'R'`) for Part Reverb Send (`['R', part, val, 0]`).
- Add UDP command `0x55` (`'U'`) for Part Mute Switch (`['U', part, isMuted, 0]`).
- Implement `save_sound_state()` and `restore_sound_state()` using `g_comp->getState(&stream)` / `g_comp->setState(&stream)` saving to `last_session_state.bin`.
- Auto-restore on engine boot; auto-save on engine exit or when snapshot requested.
- Recompile `cpp_host/montage_live_engine.exe`.

### Phase 2: Python Backend (`src/montage_host.py` & `src/server.py`)
- In `src/montage_host.py`:
  - Add `set_part_reverb(part, val)`
  - Add `set_part_mute(part, is_muted)`
  - Add `set_part_solo(part, is_solo)` with mute-group state management
  - Track part mute, solo, and reverb states in telemetry
- In `src/server.py`:
  - Update `/api/montage/volume` and add `/api/montage/part-control` for mute/solo/reverb.

### Phase 3: Desktop & Remote Frontend UI (`src/static/index.html` & `src/static/remote.html`)
- In `remote.html` & `index.html`:
  - Add `[M]` (Mute) and `[S]` (Solo) buttons for each of Parts 1-8.
  - Add a secondary slider/fader for Reverb Send (`Rev`) alongside/beneath each Part fader.
  - Bi-directional sync via WebSocket telemetry.

### Phase 4: Verification & Git Push
- Verify UDP parameter dispatch and state saving.
- Commit and push to GitHub.
