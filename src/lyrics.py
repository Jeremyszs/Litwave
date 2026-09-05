"""
Litwave Synchronized Lyrics & Musician Chord Sheet Service
==========================================================
Fetches time-synced lyrics from LRCLIB (same service as ChordMini)
and merges them with detected BTC chords to produce interactive lead sheets.
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
            if text:  # Filter empty breath rows
                lines.append({"time": total_sec, "text": text})
                
    lines.sort(key=lambda x: x["time"])
    return lines


def fetch_synced_lyrics(query: str, duration: Optional[float] = None) -> Optional[Dict[str, Any]]:
    """
    Query LRCLIB API for time-synced lyrics matching song title.
    """
    # Clean query from file extensions and unwanted symbols
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
            if not isinstance(data, list) or len(data) == 0:
                logger.info(f"No lyrics found for query: '{clean_title}'")
                return None
                
            # Filter results with syncedLyrics
            synced_results = [r for r in data if r.get("syncedLyrics")]
            if not synced_results:
                logger.info(f"Only plain lyrics found for: '{clean_title}'")
                return None
                
            # Pick best match based on duration if provided
            # Note: A single album can have studio (00:11.12 start) vs acoustic live (00:27.09 start)
            best_match = synced_results[0]
            if duration and duration > 0:
                best_diff = 99999.0
                for r in synced_results:
                    d = r.get("duration", 0)
                    if d and d > 30: # ignore placeholder durations like 6.0s
                        diff = abs(d - duration)
                        if diff < best_diff:
                            best_diff = diff
                            best_match = r
                            
            parsed_lines = parse_lrc_content(best_match["syncedLyrics"])
            return {
                "title": best_match.get("trackName") or best_match.get("name") or clean_title,
                "artist": best_match.get("artistName") or "Unknown Artist",
                "synced_lyrics": best_match["syncedLyrics"],
                "lines": parsed_lines
            }
    except Exception as e:
        logger.error(f"Error fetching synced lyrics from LRCLIB: {e}")
        return None


def merge_chords_with_lyrics(lyric_lines: List[Dict[str, Any]], chord_chart: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Align BTC detected chords with lyric lines to produce a musician lead sheet.
    Each lyric line gets its active and upcoming chords.
    """
    if not lyric_lines:
        return []
        
    merged_sheet = []
    
    for i, line in enumerate(lyric_lines):
        line_start = line["time"]
        line_end = lyric_lines[i + 1]["time"] if i + 1 < len(lyric_lines) else line_start + 10.0
        
        # Collect chords sounding during this line
        line_chords = []
        for c in chord_chart:
            c_time = c.get("time", 0.0)
            c_dur = c.get("duration", 2.0)
            c_end = c_time + c_dur
            
            # If chord overlaps with this line duration
            if (c_time >= line_start and c_time < line_end) or (c_time <= line_start and c_end > line_start):
                line_chords.append({
                    "chord": c.get("chord", ""),
                    "time": round(c_time, 2)
                })
                
        # Deduplicate chords for the line
        dedup_chords = []
        seen = set()
        for ch in line_chords:
            if ch["chord"] not in seen:
                seen.add(ch["chord"])
                dedup_chords.append(ch["chord"])
                
        merged_sheet.append({
            "time": line_start,
            "text": line["text"],
            "chords": dedup_chords
        })
        
    return merged_sheet
