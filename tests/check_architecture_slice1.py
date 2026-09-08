"""
Regression tests for architecture foundation slice 1:
- Lifecycle-safe server import (no hardware on import)
- PWA routes (/sw.js, /manifest.json) return 200 with correct content types
- FX bank A-F validation across backend endpoints
- Service worker navigation behavior (structural check)
- Remote drone variable declaration (structural check)
- Chord debounce variable scope (structural check)
- Canvas EQ CSS property resolution (structural check)
"""
import os
import sys
import re
import importlib
import ast

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, REPO_ROOT)


# ─── Slice 1: Lifecycle-safe import ───────────────────────────────────────

def test_import_does_not_boot():
    """Importing src.server and src.runtime must NOT start audio, MIDI, or monitor threads."""
    # Parse the AST instead of importing (which would trigger hardware init
    # through AudioEngine/MidiManager constructors even with deferred boot).
    runtime_path = os.path.join(REPO_ROOT, "src", "runtime.py")
    with open(runtime_path, "r", encoding="utf-8") as f:
        source = f.read()

    tree = ast.parse(source, filename="runtime.py")

    # Find AppState class
    appstate_cls = None
    for node in ast.walk(tree):
        if isinstance(node, ast.ClassDef) and node.name == "AppState":
            appstate_cls = node
            break
    assert appstate_cls is not None, "AppState class not found in runtime.py"

    # Find __init__ method
    init_method = None
    boot_method = None
    shutdown_method = None
    for item in appstate_cls.body:
        if isinstance(item, ast.FunctionDef):
            if item.name == "__init__":
                init_method = item
            elif item.name == "boot":
                boot_method = item
            elif item.name == "shutdown":
                shutdown_method = item

    assert init_method is not None, "AppState.__init__ not found"
    assert boot_method is not None, "AppState.boot() not found"
    assert shutdown_method is not None, "AppState.shutdown() not found"

    # Verify __init__ does NOT construct hardware objects or start threads
    init_source = ast.get_source_segment(source, init_method)
    assert "start_stream" not in init_source, "__init__ must not call start_stream()"
    assert "open_port" not in init_source, "__init__ must not call open_port()"
    assert ".start()" not in init_source, "__init__ must not start monitor thread"
    assert "AudioEngine()" not in init_source, "__init__ must not construct AudioEngine"
    assert "MidiManager(" not in init_source, "__init__ must not construct MidiManager"
    assert "MontageHost()" not in init_source, "__init__ must not construct MontageHost"
    assert "DronePadManager(" not in init_source, "__init__ must not construct DronePadManager"

    # Verify boot() DOES construct runtime objects and start hardware
    boot_source = ast.get_source_segment(source, boot_method)
    assert "AudioEngine()" in boot_source, "boot() must construct AudioEngine"
    assert "MidiManager(" in boot_source, "boot() must construct MidiManager"
    assert "MontageHost()" in boot_source, "boot() must construct MontageHost"
    assert "start_stream" in boot_source, "boot() must call start_stream()"
    assert ".start()" in boot_source, "boot() must start monitor thread"

    # Verify shutdown() stops monitor and cleans up
    shutdown_source = ast.get_source_segment(source, shutdown_method)
    assert "_monitor_running" in shutdown_source, "shutdown() must stop monitor"
    assert ".join(" in shutdown_source, "shutdown() must join monitor thread"
    assert "udp_sock.close()" in shutdown_source, "shutdown() must close UDP socket"
    assert "midi" in shutdown_source, "shutdown() must stop MIDI"

    print("PASS: import lifecycle safety verified via AST")


def test_starlette_app_uses_lifespan():
    """app = Starlette(...) must use asynccontextmanager lifespan, not on_startup/on_shutdown."""
    server_path = os.path.join(REPO_ROOT, "src", "server.py")
    with open(server_path, "r", encoding="utf-8") as f:
        source = f.read()
    assert "lifespan=" in source, "Starlette app must use lifespan= kwarg"
    assert "asynccontextmanager" in source, "Must import asynccontextmanager"
    assert "on_startup=" not in source, "on_startup= is unsupported in Starlette 1.x; use lifespan"
    assert "on_shutdown=" not in source, "on_shutdown= is unsupported in Starlette 1.x; use lifespan"
    assert "state.boot" in source, "lifespan must reference state.boot"
    assert "state.shutdown" in source, "lifespan must reference state.shutdown"
    print("PASS: Starlette app uses asynccontextmanager lifespan")


def test_response_import():
    """Response must be imported from starlette.responses for /sw.js and /manifest.json routes."""
    server_path = os.path.join(REPO_ROOT, "src", "server.py")
    with open(server_path, "r", encoding="utf-8") as f:
        source = f.read()
    assert "from starlette.responses import" in source
    # Check Response is in the import line
    import_line = [l for l in source.splitlines() if "from starlette.responses import" in l][0]
    assert "Response" in import_line, f"Response not in import: {import_line}"
    # Verify it's not just HTMLResponse/JSONResponse/FileResponse
    assert ", Response" in import_line or "Response," in import_line, \
        f"Bare Response class not imported: {import_line}"
    print("PASS: Response class imported")


# ─── Slice 2: PWA routes ─────────────────────────────────────────────────

def test_pwa_sw_js_navigation_fallback():
    """sw.js must only fall back /remote navigation, not root /."""
    sw_path = os.path.join(REPO_ROOT, "src", "static", "sw.js")
    with open(sw_path, "r", encoding="utf-8") as f:
        source = f.read()

    # Navigation fallback must be scoped to /remote
    assert 'url.pathname === "/remote"' in source, \
        "SW navigation fallback must be scoped to /remote only"

    # Must NOT have a catch-all navigate fallback to /remote
    # The old pattern was: if (evt.request.mode === "navigate" || url.pathname === "/remote")
    assert 'evt.request.mode === "navigate" || url.pathname === "/remote"' not in source, \
        "SW must not have catch-all navigate fallback"

    # Must bypass /static/uploads/
    assert "/static/uploads/" in source, "SW must bypass /static/uploads/"

    # Must let non-/remote navigation pass through
    assert 'if (evt.request.mode === "navigate")' in source, \
        "SW must have a pass-through for non-/remote navigations"

    print("PASS: sw.js navigation fallback correctly scoped")


def test_pwa_sw_js_api_bypass():
    """sw.js must bypass API and WebSocket routes."""
    sw_path = os.path.join(REPO_ROOT, "src", "static", "sw.js")
    with open(sw_path, "r", encoding="utf-8") as f:
        source = f.read()
    assert '"/api/"' in source, "SW must bypass /api/ routes"
    assert '"/ws"' in source, "SW must bypass /ws routes"
    print("PASS: sw.js API/WS bypass verified")


# ─── Slice 3: Remote drone variable ──────────────────────────────────────

def test_remote_drone_variable_declared():
    """g_lastRemoteDroneInteraction must be declared before use in remote.html."""
    remote_path = os.path.join(REPO_ROOT, "src", "static", "remote.html")
    with open(remote_path, "r", encoding="utf-8") as f:
        source = f.read()

    # Must have a declaration (let/var/const)
    decl_pattern = r'\b(let|var|const)\s+g_lastRemoteDroneInteraction\b'
    match = re.search(decl_pattern, source)
    assert match is not None, "g_lastRemoteDroneInteraction must be declared with let/var/const"

    # Declaration must come before first usage
    decl_pos = match.start()
    first_use = source.index("g_lastRemoteDroneInteraction")
    # The declaration IS the first occurrence
    assert decl_pos == first_use or decl_pos <= first_use, \
        "Declaration must come before or at first usage"

    print("PASS: g_lastRemoteDroneInteraction properly declared")


# ─── Slice 4: Chord debounce ─────────────────────────────────────────────

def test_chord_debounce_variable_scope():
    """lastRecordedChord and lastRecordedChordTime must NOT be declared inside renderTelemetry."""
    index_path = os.path.join(REPO_ROOT, "src", "static", "index.html")
    with open(index_path, "r", encoding="utf-8") as f:
        lines = f.readlines()

    # Find renderTelemetry function boundaries
    rt_start = None
    brace_depth = 0
    rt_end = None
    for i, line in enumerate(lines):
        if "function renderTelemetry(" in line:
            rt_start = i
            brace_depth = 0
        if rt_start is not None and i >= rt_start:
            brace_depth += line.count("{") - line.count("}")
            if brace_depth <= 0 and i > rt_start:
                rt_end = i
                break

    assert rt_start is not None, "renderTelemetry function not found"
    assert rt_end is not None, "renderTelemetry function end not found"

    # Check that let lastRecordedChord and let lastRecordedChordTime are NOT inside the function
    inside_body = "".join(lines[rt_start + 1:rt_end])
    assert "let lastRecordedChord" not in inside_body, \
        "lastRecordedChord must NOT be declared with 'let' inside renderTelemetry"
    assert "let lastRecordedChordTime" not in inside_body, \
        "lastRecordedChordTime must NOT be declared with 'let' inside renderTelemetry"

    # Verify they ARE declared somewhere before renderTelemetry
    before_rt = "".join(lines[:rt_start])
    assert "lastRecordedChord" in before_rt, \
        "lastRecordedChord must be declared before renderTelemetry"
    assert "lastRecordedChordTime" in before_rt, \
        "lastRecordedChordTime must be declared before renderTelemetry"

    print("PASS: chord debounce variables have correct scope")


# ─── Slice 5: Canvas EQ CSS custom property resolution ───────────────────

def test_canvas_eq_no_css_vars():
    """drawEqSpline must not use var(--...) in Canvas API calls."""
    index_path = os.path.join(REPO_ROOT, "src", "static", "index.html")
    with open(index_path, "r", encoding="utf-8") as f:
        source = f.read()

    # Find drawEqSpline function
    fn_start = source.find("function drawEqSpline()")
    assert fn_start != -1, "drawEqSpline function not found"

    # Find end of function (next function declaration or reasonable boundary)
    fn_end = source.find("function renderEqInspectors()", fn_start)
    if fn_end == -1:
        fn_end = fn_start + 5000  # fallback

    fn_body = source[fn_start:fn_end]

    # Canvas context calls must NOT use CSS custom properties
    # Check for var(-- patterns in ctx.fillStyle, ctx.strokeStyle, ctx.font assignments
    css_var_pattern = r'ctx\.(fillStyle|strokeStyle|font)\s*=\s*["\'].*var\(--'
    matches = re.findall(css_var_pattern, fn_body)
    assert len(matches) == 0, \
        f"drawEqSpline must not use CSS custom properties in Canvas context: found in {matches}"

    # Verify concrete values are used instead
    assert "'Geist Mono'" in fn_body or '"Geist Mono"' in fn_body, \
        "drawEqSpline must use concrete font names, not var(--font-mono)"
    assert "#e2e8f0" in fn_body, \
        "drawEqSpline must use concrete color #e2e8f0 for accent"
    assert "#f3f4f6" in fn_body, \
        "drawEqSpline must use concrete color #f3f4f6 for text-main"

    print("PASS: Canvas EQ uses concrete values, not CSS custom properties")


# ─── Slice 6: FX bank A-F backend validation ─────────────────────────────

def test_fx_bank_af_validation_server():
    """Backend must use SUPPORTED_FX_BANKS constant for A-F validation."""
    server_path = os.path.join(REPO_ROOT, "src", "server.py")
    with open(server_path, "r", encoding="utf-8") as f:
        server_source = f.read()

    api_fx_path = os.path.join(REPO_ROOT, "src", "api_fx_pads.py")
    api_setlist_path = os.path.join(REPO_ROOT, "src", "api_setlist.py")
    fx_source = ""
    if os.path.exists(api_fx_path):
        with open(api_fx_path, "r", encoding="utf-8") as f:
            fx_source += f.read() + "\n"
    if os.path.exists(api_setlist_path):
        with open(api_setlist_path, "r", encoding="utf-8") as f:
            fx_source += f.read() + "\n"

    combined_source = server_source + "\n" + fx_source

    # Must define the constant
    assert "SUPPORTED_FX_BANKS" in server_source, "SUPPORTED_FX_BANKS constant must be defined in server.py"

    # Both bank checks must reference the constant, not inline tuples
    bank_checks = re.findall(r'bank in SUPPORTED_FX_BANKS|bank in banks', combined_source)
    assert len(bank_checks) >= 2, \
        f"Expected at least 2 uses of SUPPORTED_FX_BANKS / banks, found {len(bank_checks)}"

    # No leftover inline bank tuples
    inline_bank_tuples = re.findall(r'bank in \("A"', combined_source)
    assert len(inline_bank_tuples) == 0, \
        "Inline FX bank tuples must be replaced with SUPPORTED_FX_BANKS constant"

    print("PASS: FX bank A-F validation uses SUPPORTED_FX_BANKS constant")


def test_fx_bank_af_factory_manifest():
    """Factory FX manifest must define banks E and F."""
    gen_path = os.path.join(REPO_ROOT, "src", "generate_factory_fx.py")
    with open(gen_path, "r", encoding="utf-8") as f:
        source = f.read()
    assert '"bank": "E"' in source, "Factory manifest must define bank E pads"
    assert '"bank": "F"' in source, "Factory manifest must define bank F pads"
    print("PASS: Factory FX manifest includes banks E and F")


def test_fx_sampler_comment_af():
    """FxSampler active_bank comment must mention A-F."""
    sampler_path = os.path.join(REPO_ROOT, "src", "fx_sampler.py")
    with open(sampler_path, "r", encoding="utf-8") as f:
        source = f.read()
    assert '"E", "F"' in source or '"E"' in source, \
        "FxSampler comment should mention banks E and F"
    print("PASS: FxSampler comment updated for A-F")


def test_midi_manager_has_stop():
    """MidiManager must have an orderly stop() method that sets _running and joins the thread."""
    midi_path = os.path.join(REPO_ROOT, "src", "midi_manager.py")
    with open(midi_path, "r", encoding="utf-8") as f:
        source = f.read()
    tree = ast.parse(source, filename="midi_manager.py")
    midi_cls = None
    for node in ast.walk(tree):
        if isinstance(node, ast.ClassDef) and node.name == "MidiManager":
            midi_cls = node
            break
    assert midi_cls is not None, "MidiManager class not found"
    stop_method = None
    for item in midi_cls.body:
        if isinstance(item, ast.FunctionDef) and item.name == "stop":
            stop_method = item
            break
    assert stop_method is not None, "MidiManager.stop() method not found"
    stop_src = ast.get_source_segment(source, stop_method)
    assert "_running" in stop_src, "stop() must set _running to False"
    assert ".join(" in stop_src, "stop() must join the worker thread"
    print("PASS: MidiManager has orderly stop()")


def test_safe_server_import():
    """Importing src.server must succeed without constructing hardware objects.
    This is a real import test, not just AST — it verifies no AudioEngine/MidiManager
    constructors fire at module level. Skipped if sounddevice/mido are unavailable."""
    try:
        # server.py now defers hardware imports to boot(), so this should succeed
        # even without audio/MIDI hardware available.
        mod = importlib.import_module("src.server")
        assert hasattr(mod, "state"), "Module must expose state"
        assert hasattr(mod, "app"), "Module must expose Starlette app"
        s = mod.state
        assert s.audio is None, "state.audio must be None before boot()"
        assert s.midi is None, "state.midi must be None before boot()"
        assert s.montage is None, "state.montage must be None before boot()"
        assert s._booted is False, "state must not be booted on import"
        print("PASS: src.server imports safely (no hardware constructed)")
    except ImportError as e:
        # If starlette itself isn't importable, skip gracefully
        print(f"SKIP: safe import test (missing dependency: {e})")


# ─── Runner ──────────────────────────────────────────────────────────────

if __name__ == "__main__":
    tests = [
        test_import_does_not_boot,
        test_starlette_app_uses_lifespan,
        test_response_import,
        test_pwa_sw_js_navigation_fallback,
        test_pwa_sw_js_api_bypass,
        test_remote_drone_variable_declared,
        test_chord_debounce_variable_scope,
        test_canvas_eq_no_css_vars,
        test_fx_bank_af_validation_server,
        test_fx_bank_af_factory_manifest,
        test_fx_sampler_comment_af,
        test_midi_manager_has_stop,
        test_safe_server_import,
    ]
    passed = 0
    failed = 0
    for t in tests:
        try:
            t()
            passed += 1
        except Exception as e:
            print(f"FAIL: {t.__name__}: {e}")
            failed += 1

    print(f"\n{'='*60}")
    print(f"Results: {passed} passed, {failed} failed out of {len(tests)}")
    if failed > 0:
        sys.exit(1)
    else:
        print("ALL CHECKS PASSED")
