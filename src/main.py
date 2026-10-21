"""
Run the Montage Practice DAW Studio
Starts the backend audio/MIDI engine and shows the studio UI in its own desktop window.
Pass --browser to open it in the web browser instead (the old behaviour).
"""

import os
import sys
import socket
import threading
import webbrowser
import uvicorn

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

PORT = 8080
URL = f"http://127.0.0.1:{PORT}"
APP_ID = "Litwave.Desktop"
ICON = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "assets", "icon", "app.ico"))

SPLASH = """<!doctype html><html><body style="margin:0;height:100vh;display:grid;place-items:center;
background:#000;color:#8E8E93;font:15px -apple-system,'Segoe UI',sans-serif">Starting Litwave…</body></html>"""


def _port_in_use() -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        return s.connect_ex(("127.0.0.1", PORT)) == 0


def _log_to_file_without_console():
    # pythonw (the desktop shortcut) has no console: keep the server log in data/ instead of losing it.
    if sys.stdout is not None and sys.stderr is not None:
        return
    from src.user_data import data_dir
    log = open(os.path.join(data_dir(), "litwave.log"), "a", buffering=1, encoding="utf-8")
    sys.stdout = sys.stdout or log
    sys.stderr = sys.stderr or log


def _alert(text: str):
    if sys.platform == "win32":
        import ctypes
        ctypes.windll.user32.MessageBoxW(None, text, "Litwave", 0x40)
    else:
        print(text)


def run_browser():
    webbrowser.open(URL)
    # All network interfaces (0.0.0.0) so the phone remote can connect via Wi-Fi LAN IP
    uvicorn.run("src.server:app", host="0.0.0.0", port=PORT, log_level="info")


def run_window():
    import webview

    if sys.platform == "win32":
        # Own taskbar entry and icon instead of grouping under python.exe
        import ctypes
        ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID(APP_ID)

    server = uvicorn.Server(uvicorn.Config("src.server:app", host="0.0.0.0", port=PORT, log_level="info"))
    server_thread = threading.Thread(target=server.run, name="litwave-server", daemon=True)
    server_thread.start()

    window = webview.create_window("Litwave", html=SPLASH, width=1440, height=900,
                                   min_size=(1024, 680), background_color="#000000")

    def load_when_ready():
        while not server.started:
            if not server_thread.is_alive():
                window.load_html(SPLASH.replace("Starting Litwave…", "Litwave could not start. See data/litwave.log."))
                return
            threading.Event().wait(0.1)
        window.load_url(URL)

    webview.start(load_when_ready, icon=ICON, private_mode=False)

    # Window closed: stop the server so the lifespan shuts audio and MIDI down cleanly.
    server.should_exit = True
    server_thread.join(timeout=10)


def main():
    _log_to_file_without_console()
    print("=" * 60)
    print("  MONTAGE M PRACTICE DAW - LIVE STUDIO")
    print(f"  Interface: {URL}")
    print("=" * 60)

    # A second copy would collide with the first on the audio/VST UDP sockets.
    if _port_in_use():
        _alert(f"Litwave is already running (port {PORT} is in use).")
        return

    if "--browser" in sys.argv:
        run_browser()
    else:
        run_window()


if __name__ == "__main__":
    main()
