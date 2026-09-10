"""
Run the Montage Practice DAW Studio
Starts the backend audio/MIDI engine, serves the Impeccable studio UI, and opens your browser.
"""

import os
import sys
import webbrowser
import uvicorn

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

def main():
    port = 8080
    url = f"http://127.0.0.1:{port}"
    print("=" * 60)
    print("  MONTAGE M PRACTICE DAW - LIVE STUDIO")
    print(f"  Interface: {url}")
    print("=" * 60)
    
    # Auto-launch browser window (try Microsoft Edge in app mode first, fallback to system default)
    edge_paths = [
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    ]
    edge_bin = next((p for p in edge_paths if os.path.exists(p)), None)
    if edge_bin:
        import subprocess
        subprocess.Popen([edge_bin, f"--app={url}", "--window-size=1280,820"])
    else:
        webbrowser.open(url)
    
    # Run uvicorn server on all network interfaces (0.0.0.0) so phone can connect via Wi-Fi LAN IP
    uvicorn.run("src.server:app", host="0.0.0.0", port=port, log_level="info")

if __name__ == "__main__":
    main()
