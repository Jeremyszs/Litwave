"""
Regression checks for documentation accuracy, static module contract, and import safety.
Ensures documentation matches actual codebase structure and loading order contracts.
"""

import os
import sys
import ast
import re

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, REPO_ROOT)


def test_readme_exists_and_covers_required_sections():
    readme_path = os.path.join(REPO_ROOT, "README.md")
    assert os.path.exists(readme_path), "README.md must exist"
    with open(readme_path, "r", encoding="utf-8") as f:
        content = f.read()

    required_keywords = [
        "Architecture & Data-Flow Overview",
        "Frontend Static-Module Loading Order",
        "Setup & Dependencies",
        "Verification & Testing",
        "Safe No-Hardware Verification",
        "Hardware & Native-Host Cautions",
        "Branch & Change Conventions",
        "chord_timeline.js",
        "browser_api.js",
        "ws_telemetry.js",
        "AppState",
        "Starlette",
    ]
    for kw in required_keywords:
        assert kw in content, f"README.md missing expected section or keyword: {kw}"
    print("PASS: README structure and sections verified")


def test_static_script_loading_order_matches_docs():
    """Verify index.html and remote.html load scripts in order: chord_timeline.js -> browser_api.js -> ws_telemetry.js."""
    for html_file in ["index.html", "remote.html"]:
        fpath = os.path.join(REPO_ROOT, "src", "static", html_file)
        with open(fpath, "r", encoding="utf-8") as f:
            html = f.read()

        pos_chord = html.find("/static/chord_timeline.js")
        pos_browser = html.find("/static/browser_api.js")
        pos_ws = html.find("/static/ws_telemetry.js")

        assert pos_chord != -1, f"{html_file} missing chord_timeline.js"
        assert pos_browser != -1, f"{html_file} missing browser_api.js"
        assert pos_ws != -1, f"{html_file} missing ws_telemetry.js"
        assert pos_chord < pos_browser < pos_ws, f"{html_file} script tag order incorrect"

    print("PASS: Static script loading order verified in HTML files")


def test_service_worker_asset_manifest_and_bypass():
    """Verify sw.js caches extracted scripts and bypasses api/ws/uploads."""
    sw_path = os.path.join(REPO_ROOT, "src", "static", "sw.js")
    with open(sw_path, "r", encoding="utf-8") as f:
        sw = f.read()

    assert "/static/chord_timeline.js" in sw
    assert "/static/browser_api.js" in sw
    assert "/static/ws_telemetry.js" in sw
    assert "/api/" in sw
    assert "/ws" in sw
    assert "/static/uploads/" in sw
    print("PASS: Service worker static asset list and bypass routes verified")


def test_safe_server_import_contract():
    """Importing src.server must create AppState with unbooted hardware engines."""
    import src.server as server_mod

    assert hasattr(server_mod, "state")
    assert hasattr(server_mod, "app")
    assert server_mod.state.audio is None
    assert server_mod.state.midi is None
    assert server_mod.state.montage is None
    assert server_mod.state._booted is False
    print("PASS: Safe server import contract verified")


if __name__ == "__main__":
    test_readme_exists_and_covers_required_sections()
    test_static_script_loading_order_matches_docs()
    test_service_worker_asset_manifest_and_bypass()
    test_safe_server_import_contract()
    print("\nALL DOC & QUALITY CHECKS PASSED")
