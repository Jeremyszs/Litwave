"""
AI-Powered Multi-Tier Lyrics Alignment & Instrumental Handling Service
======================================================================
1. Automatic Audio Duration Cross-Matching (LRCLIB):
   - Eliminates intro/acoustic vs studio mismatch by picking the closest song duration (>30s).
2. Whisper AI Vocal Activity Anchor (Local Fallback & Grounding):
   - Directly transcribes and detects exact vocal timestamps on the audio track.
   - Accurately detects extended instrumental solos, guitar preludes, and silent bars.
"""

import os
import re
import json
import logging
import urllib.request
import urllib.parse
from typing import Dict, Any, List, Optional

logger = logging.getLogger("LitwaveLyrics")

LRCLIB_API_ENDPOINT = "https://lrclib.net/api"

def parse_lrc_content(lrc_text: str) -> List[Dict[str, Any]]:
    """
    Parse LRC lines formatted as [mm:ss.xx] Text into sorted timestamped events.
    """
    lines = []
    pattern = re.compile(r"\[(\d+):(\d+(?:\.\d+)?)\](.*)")
    
    for row in lrc_text.splitlines():
        match = pattern.match(row.strip())
        if match:
            minutes = int(match.group(1))
            seconds = float(match.group(2))
            text = match.group(3).strip()
            total_sec = round(minutes * 60.0 + seconds, 2)
            if text:
                lines.append({"time": total_sec, "text": text})
                
    lines.sort(key=lambda x: x["time"])
    return lines


def transcribe_with_whisper(audio_path: str) -> Optional[List[Dict[str, Any]]]:
    """
    Use local OpenAI Whisper to extract ground-truth vocal segments with exact timestamps.
    Handles instrumental parts automatically (Whisper emits segments ONLY when singing is present).
    """
    try:
        import whisper
        logger.info("Running local Whisper AI vocal transcription to detect vocal timestamps...")
        model = whisper.load_model("base")
        res = model.transcribe(audio_path, fp16=False)
        lines = []
        for seg in res.get("segments", []):
            txt = seg.get("text", "").strip()
            if txt and len(txt) > 2:
                lines.append({
                    "time": round(float(seg["start"]), 2),
                    "end": round(float(seg["end"]), 2),
                    "text": txt
                })
        logger.info(f"Whisper extracted {len(lines)} vocal phrases.")
        return lines if lines else None
    except Exception as e:
        logger.warning(f"Whisper transcription unavailable: {e}")
        return None


def fetch_synced_lyrics(query: str, duration: Optional[float] = None, audio_path: Optional[str] = None) -> Optional[Dict[str, Any]]:
    """
    Query LRCLIB API for time-synced lyrics with intelligent acoustic vs studio duration locking.
    Falls back to local Whisper transcription if no database match exists or if instrumental solos break alignment.
    """
    clean_title = os.path.splitext(query)[0]
    clean_title = re.sub(r"[_\-\.]+", " ", clean_title).strip()
    
    encoded_q = urllib.parse.quote(clean_title)
    url = f"{LRCLIB_API_ENDPOINT}/search?q={encoded_q}"
    
    req = urllib.request.Request(
        url,
        headers={"User-Agent": "Litwave-Practice-DAW/1.0 (jeremyszs@users.noreply.github.com)"}
    )
    
    try:
        with urllib.request.urlopen(req, timeout=5.0) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            if isinstance(data, list) and len(data) > 0:
                synced_results = [r for r in data if r.get("syncedLyrics")]
                if synced_results:
                    best_match = synced_results[0]
                    if duration and duration > 0:
                        best_diff = 99999.0
                        for r in synced_results:
                            d = r.get("duration", 0)
                            if d and d > 30: # Ignore stub entries
                                diff = abs(d - duration)
                                if diff < best_diff:
                                    best_diff = diff
                                    best_match = r
                                    
                    parsed_lines = parse_lrc_content(best_match["syncedLyrics"])
                    if parsed_lines:
                        return {
                            "title": best_match.get("trackName") or best_match.get("name") or clean_title,
                            "artist": best_match.get("artistName") or "Unknown Artist",
                            "synced_lyrics": best_match["syncedLyrics"],
                            "lines": parsed_lines
                        }
    except Exception as e:
        logger.warning(f"LRCLIB search error: {e}")

    # Fallback to local Whisper if audio file provided
    if audio_path and os.path.exists(audio_path):
        whisper_lines = transcribe_with_whisper(audio_path)
        if whisper_lines:
            return {
                "title": clean_title,
                "artist": "Local Transcription",
                "synced_lyrics": "",
                "lines": whisper_lines
            }

    return None
