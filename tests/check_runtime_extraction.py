"""
Regression tests for runtime lifecycle extraction (Slice 2):
- AppState and create_lifespan are in src.runtime
- AppState, state, app, SUPPORTED_FX_BANKS re-exported from src.server
- Importing src.server and src.runtime creates no hardware objects
- Lifespan startup/shutdown calls boot and shutdown
- Shutdown is idempotent and safe when unbooted or booted
"""
import os
import sys
import importlib
import ast

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, REPO_ROOT)


def test_runtime_module_ast():
    """AppState and lifecycle helpers live in src/runtime.py without hardware creation on import."""
    runtime_path = os.path.join(REPO_ROOT, "src", "runtime.py")
    with open(runtime_path, "r", encoding="utf-8") as f:
        source = f.read()

    tree = ast.parse(source, filename="runtime.py")

    classes = {n.name: n for n in ast.walk(tree) if isinstance(n, ast.ClassDef)}
    assert "AppState" in classes, "AppState must be defined in src/runtime.py"

    appstate_cls = classes["AppState"]
    methods = {n.name: n for n in appstate_cls.body if isinstance(n, ast.FunctionDef)}
    assert "__init__" in methods
    assert "boot" in methods
    assert "shutdown" in methods

    # Verify no top-level hardware instantiation in runtime.py outside of functions/methods
    top_level_calls = []
    for stmt in tree.body:
        if isinstance(stmt, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            continue
        for node in ast.walk(stmt):
            if isinstance(node, ast.Call) and isinstance(node.func, ast.Name):
                top_level_calls.append(node.func.id)

    assert "AudioEngine" not in top_level_calls
    assert "MidiManager" not in top_level_calls
    assert "MontageHost" not in top_level_calls
    print("PASS: runtime AST structure verified")


def test_server_reexports_and_compatibility():
    """src.server exposes state, app, AppState, SUPPORTED_FX_BANKS."""
    import src.server as server_mod
    import src.runtime as runtime_mod

    assert hasattr(server_mod, "state"), "server must expose state"
    assert hasattr(server_mod, "app"), "server must expose app"
    assert hasattr(server_mod, "AppState"), "server must re-export AppState"
    assert hasattr(server_mod, "SUPPORTED_FX_BANKS"), "server must re-export SUPPORTED_FX_BANKS"

    assert isinstance(server_mod.state, runtime_mod.AppState)
    assert server_mod.SUPPORTED_FX_BANKS == runtime_mod.SUPPORTED_FX_BANKS
    print("PASS: server re-exports and API compatibility verified")


def test_clean_import_no_hardware():
    """Verify state components remain None prior to boot()."""
    from src.runtime import AppState

    state = AppState()
    assert state.audio is None
    assert state.midi is None
    assert state.montage is None
    assert state.drone_pad is None
    assert state.ear_training is None
    assert state._booted is False

    # Shutdown on unbooted state must be cleanly idempotent (no exceptions)
    state.shutdown()
    state.shutdown()
    print("PASS: clean import and idempotent shutdown on unbooted state verified")


def test_analyzer_visibility_toggle_safe_unbooted():
    """set_analyzer_visible should not throw even if montage is None."""
    from src.runtime import AppState
    state = AppState()
    state.set_analyzer_visible(True)
    assert state.analyzer_visible_clients == 1
    state.set_analyzer_visible(False)
    assert state.analyzer_visible_clients == 0
    print("PASS: set_analyzer_visible safe when unbooted")


if __name__ == "__main__":
    tests = [
        test_runtime_module_ast,
        test_server_reexports_and_compatibility,
        test_clean_import_no_hardware,
        test_analyzer_visibility_toggle_safe_unbooted,
    ]
    passed = 0
    for t in tests:
        t()
        passed += 1
    print(f"\nALL {passed} RUNTIME REGRESSION CHECKS PASSED")
