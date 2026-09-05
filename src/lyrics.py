"""
High-Precision Lyrics Search & Fuzzy Title Resolution Service
=============================================================
Resolves filename technical tags (e.g. 'WGTB_128k.mp3' -> 'WGTB' / 'Walau Gunung Tak Berpindah')
to query and fetch real, official studio/acoustic synchronized lyrics.
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

# Common Indonesian worship & pop acronym map
SONG_ACRONYMS = {
    "wgtb": "Walau Gunung Tak Berpindah",
    "kkh": "Karna Kau Hebat",
    "ssb": "Saat Sunyi Berbisik",
    "akt": "Ajaib Kau Tuhan",
}

def clean_query_candidates(filename: str) -> List[str]:
    """Generate search candidates from filename by stripping bitrates, tags, brackets."""
    base = os.path.splitext(filename)[0]
    # Remove tags like (Official Video), [Audio], _128k, - 320kbps, etc.
    cleaned = re.sub(r"[\(\[\{].*?[\)\]\}]", " ", base)
    cleaned = re.sub(r"_\d+k(?:bps)?", " ", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"\b\d+k(?:bps)?\b", " ", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"[_\-\.]+", " ", cleaned).strip()
    
    candidates = []
    if cleaned:
        candidates.append(cleaned)
        
    # Check acronyms
    first_word = cleaned.split()[0].lower() if cleaned else ""
    if first_word in SONG_ACRONYMS:
        candidates.append(SONG_ACRONYMS[first_word])
        
    # If title has "Artist - Song", extract just the song name
    if " - " in base:
        parts = base.split(" - ")
        candidates.append(parts[-1].strip())
        candidates.append(parts[0].strip())
        
    # Dedup while preserving order
    seen = set()
    result = []
    for c in candidates:
        if c and c.lower() not in seen:
            seen.add(c.lower())
            result.append(c)
    return result


def parse_lrc_content(lrc_text: str) -> List[Dict[str, Any]]:
    """Parse LRC timestamps [mm:ss.xx] into structured timeline."""
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


def query_lrclib_for_term(term: str, duration: Optional[float] = None) -> Optional[Dict[str, Any]]:
    """Query LRCLIB for a single candidate term."""
    encoded_q = urllib.parse.quote(term)
    url = f"{LRCLIB_API_ENDPOINT}/search?q={encoded_q}"
    req = urllib.request.Request(
        url,
        headers={"User-Agent": "Litwave-Practice-DAW/1.0 (jeremyszs@users.noreply.github.com)"}
    )
    try:
        with urllib.request.urlopen(req, timeout=5.0) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            if isinstance(data, list) and len(data) > 0:
                synced = [r for r in data if r.get("syncedLyrics")]
                if synced:
                    best = synced[0]
                    if duration and duration > 0:
                        best_diff = 99999.0
                        for r in synced:
                            d = r.get("duration", 0)
                            if d and d > 30:
                                diff = abs(d - duration)
                                if diff < best_diff:
                                    best_diff = diff
                                    best = r
                    parsed = parse_lrc_content(best["syncedLyrics"])
                    if parsed:
                        return {
                            "title": best.get("trackName") or best.get("name") or term,
                            "artist": best.get("artistName") or "Unknown Artist",
                            "synced_lyrics": best["syncedLyrics"],
                            "lines": parsed
                        }
    except Exception as e:
        logger.warning(f"Error querying LRCLIB for '{term}': {e}")
    return None


def fetch_synced_lyrics(query: str, duration: Optional[float] = None, audio_path: Optional[str] = None) -> Optional[Dict[str, Any]]:
    """
    Search LRCLIB across multiple smart title candidates.
    Never falls back to noisy ASR hallucination if database match exists.
    """
    candidates = clean_query_candidates(query)
    logger.info(f"Searching lyrics for candidates: {candidates}")
    
    for cand in candidates:
        res = query_lrclib_for_term(cand, duration=duration)
        if res:
            logger.info(f"Matched lyrics for '{cand}': {res['title']} ({len(res['lines'])} lines)")
            return res
            
    return None
