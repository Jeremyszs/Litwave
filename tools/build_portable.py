"""
Litwave Portable Builder
Constructs a standalone, zero-dependency distribution using Python Embeddable + Edge App Mode.
Excludes proprietary VSTs, PyTorch ML pack, and local user uploads.
"""

import os
import sys
import shutil
import zipfile
import urllib.request
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DIST_DIR = PROJECT_ROOT / "dist"
BUILD_DIR = DIST_DIR / "Litwave"

PYTHON_EMBED_URL = "https://www.python.org/ftp/python/3.11.9/python-3.11.9-embed-amd64.zip"

CORE_PACKAGES = [
    "aiofiles",
    "asio",
    "librosa",
    "mido",
    "miniaudio",
    "pefile",
    "python-multipart",
    "python-rtmidi",
    "sounddevice",
    "soundfile",
    "starlette",
    "uvicorn",
    "websockets",
    "wsproto",
    "numpy",
    "scipy",
    "numba",
    "llvmlite",
]

EXCLUDE_DIRS = {
    "__pycache__",
    ".git",
    ".venv",
    ".pytest_cache",
    ".hermes",
    "vst3_sdk",
    "tests",
    "uploads",  # Avoid packing user audio files
}

def clean_build_dir():
    if BUILD_DIR.exists():
        print(f"[*] Cleaning previous build at {BUILD_DIR}...")
        shutil.rmtree(BUILD_DIR)
    BUILD_DIR.mkdir(parents=True, exist_ok=True)

def download_python_embed(target_dir: Path):
    cache_zip = DIST_DIR / "python-3.11.9-embed-amd64.zip"
    if not cache_zip.exists():
        print(f"[*] Downloading Python 3.11 Embeddable zip from {PYTHON_EMBED_URL}...")
        urllib.request.urlretrieve(PYTHON_EMBED_URL, cache_zip)
    else:
        print(f"[*] Using cached Python embed zip: {cache_zip.name}")

    print("[*] Extracting Python embeddable runtime...")
    with zipfile.ZipFile(cache_zip, "r") as zf:
        zf.extractall(target_dir / "python")

    # Enable site-packages in python311._pth
    pth_file = target_dir / "python" / "python311._pth"
    if pth_file.exists():
        content = pth_file.read_text()
        lines = content.splitlines()
        new_lines = []
        for line in lines:
            if line.strip() == "#import site":
                new_lines.append("import site")
            else:
                new_lines.append(line)
        new_lines.append(r".\Lib\site-packages")
        new_lines.append(r"..")
        pth_file.write_text("\n".join(new_lines) + "\n")

def copy_dependencies(target_dir: Path):
    venv_site = PROJECT_ROOT / ".venv" / "Lib" / "site-packages"
    dest_site = target_dir / "python" / "Lib" / "site-packages"
    dest_site.mkdir(parents=True, exist_ok=True)

    print("[*] Copying core dependencies into embedded runtime...")
    
    # Exclude torch and transformers packages
    skip_prefixes = ("torch", "nvidia", "triton", "transformers", "huggingface", "hf_")

    for item in venv_site.iterdir():
        name_lower = item.name.lower()
        if any(name_lower.startswith(p) for p in skip_prefixes):
            continue
        if item.name.endswith(".dist-info"):
            # skip dist-info to save space
            continue
        if item.name == "__pycache__":
            continue

        target = dest_site / item.name
        if item.is_dir():
            shutil.copytree(item, target, ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))
        else:
            shutil.copy2(item, target)

def copy_project_files(target_dir: Path):
    print("[*] Copying application code and assets...")
    
    # Copy src
    shutil.copytree(
        PROJECT_ROOT / "src",
        target_dir / "src",
        ignore=shutil.ignore_patterns("__pycache__", "*.pyc", "uploads")
    )
    (target_dir / "src" / "static" / "uploads").mkdir(parents=True, exist_ok=True)

    # Copy assets (sampler pads)
    shutil.copytree(
        PROJECT_ROOT / "assets",
        target_dir / "assets",
        ignore=shutil.ignore_patterns("__pycache__", "*.pyc")
    )

    # Copy C++ engine & starter soundfonts
    cpp_dest = target_dir / "cpp_host"
    cpp_dest.mkdir(parents=True, exist_ok=True)
    
    shutil.copy2(PROJECT_ROOT / "cpp_host" / "litwave_community_engine.exe", cpp_dest)
    
    # SoundFonts: only include starter bank (GeneralUser-GS) + Nord if available
    sf_dest = cpp_dest / "soundfonts"
    sf_dest.mkdir(parents=True, exist_ok=True)
    
    starter_fonts = ["GeneralUser-GS.sf2", "Nord_Stage_Romantic_Grand.sf2", "Yamaha-SY22.sf2", "Roland_SC-88.sf2"]
    for sf in starter_fonts:
        src_sf = PROJECT_ROOT / "cpp_host" / "soundfonts" / sf
        if src_sf.exists():
            print(f"    Including SoundFont: {sf}")
            shutil.copy2(src_sf, sf_dest)

    # README & docs
    if (PROJECT_ROOT / "README.md").exists():
        shutil.copy2(PROJECT_ROOT / "README.md", target_dir)

def create_launchers(target_dir: Path):
    print("[*] Creating application launcher scripts...")
    
    # 1. Litwave.bat (silent background or direct window)
    bat_content = """@echo off
setlocal
cd /d "%~dp0"
title Litwave Keyboard Practice Workstation
echo Starting Litwave Engine...
python\\python.exe src\\main.py
"""
    (target_dir / "Litwave.bat").write_text(bat_content)

    # 2. Litwave_Windowless.vbs (for starting without console window)
    vbs_content = """Set WshShell = CreateObject("WScript.Shell")
WshShell.Run "cmd /c Litwave.bat", 0, False
"""
    (target_dir / "Litwave.vbs").write_text(vbs_content)

    # 3. Optional PyTorch ML Pack installer script
    install_torch_bat = """@echo off
cd /d "%~dp0"
echo =======================================================
echo   Litwave: Install PyTorch AI Chord Recognition Pack
echo =======================================================
echo This will download and install PyTorch and Transformers (~800MB).
echo.
pause
echo Installing...
python\\python.exe -m pip install --no-warn-script-location torch transformers huggingface-hub
echo.
echo Installation complete! Restart Litwave to use AI Chord Transcription.
pause
"""
    (target_dir / "install_ai_chord_pack.bat").write_text(install_torch_bat)

def create_zip(target_dir: Path):
    archive_name = DIST_DIR / "Litwave-Portable-Windows-x64.zip"
    print(f"[*] Packaging into zip: {archive_name.name}...")
    with zipfile.ZipFile(archive_name, "w", zipfile.ZIP_DEFLATED) as zipf:
        for root, dirs, files in os.walk(target_dir):
            for file in files:
                abs_path = Path(root) / file
                rel_path = abs_path.relative_to(target_dir)
                zipf.write(abs_path, arcname=rel_path)
    
    size_mb = archive_name.stat().st_size / (1024 * 1024)
    print(f"[✓] Successfully created {archive_name.name} ({size_mb:.2f} MB)")

def main():
    print("==================================================")
    print("  BUILDING LITWAVE PORTABLE DESKTOP DISTRIBUTION  ")
    print("==================================================")
    clean_build_dir()
    download_python_embed(BUILD_DIR)
    copy_dependencies(BUILD_DIR)
    copy_project_files(BUILD_DIR)
    create_launchers(BUILD_DIR)
    
    # Calculate folder size
    total_sz = sum(f.stat().st_size for f in BUILD_DIR.rglob('*') if f.is_file()) / (1024 * 1024)
    print(f"[*] Uncompressed deliverable size: {total_sz:.2f} MB")
    
    create_zip(BUILD_DIR)

if __name__ == "__main__":
    main()
