"""
High-Precision Lyrics Search & Fuzzy Title Resolution Service
=============================================================
Resolves technical filenames, artist-title patterns, and worship tags
(e.g. 'YESUS KAU SUNGGUH BAIK SYMPHONY WORSHIP LIVE ARR.mp3' -> 'Yesus Kau Sungguh Baik')
to query, fetch, and cache real synchronized LRC lyrics.
"""

import os
import re
import json
import time
import logging
import urllib.request
import urllib.parse
from typing import Dict, Any, List, Optional

logger = logging.getLogger("LitwaveLyrics")

LRCLIB_API_ENDPOINT = "https://lrclib.net/api"

COMMON_WORSHIP_BANDS = [
    "symphony worship", "ndc worship", "jpcc worship", "gms live", "gms worship",
    "true worshippers", "hillsong worship", "hillsong united", "bethel music",
    "elevation worship", "mawar sharon worship", "planetshakers", "gloria trio",
    "sound of praise", "sidney mohede", "sari simorangkir"
]

COMMON_ACRONYMS = {
    "wgtb": "Walau Gunung Tak Berpindah",
    "kkh": "Karna Kau Hebat",
    "ssb": "Saat Sunyi Berbisik",
    "akt": "Ajaib Kau Tuhan",
    "yksb": "Yesus Kau Sungguh Baik",
}


def clean_query_candidates(filename: str) -> List[str]:
    """Generate intelligent search candidates by stripping audio metadata, tags, and isolating titles."""
    base = os.path.splitext(os.path.basename(filename))[0]

    # 1. Remove bracketed metadata [Official Audio], (Live 2022), {Remastered}, etc.
    cleaned = re.sub(r"[\(\[\{].*?[\)\]\}]", " ", base)
    # 2. Strip bitrate and format technical tags
    cleaned = re.sub(r"_\d+k(?:bps)?", " ", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"\b\d+k(?:bps)?\b", " ", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"\b(flac|wav|mp3|m4a|aac|ogg)\b", " ", cleaned, flags=re.IGNORECASE)
    # 3. Strip common performance / arrangement tags
    cleaned = re.sub(
        r"\b(live\s+arr(?:angement)?|arr(?:angement)?|live|official(?:\s+video|\s+audio)?|"
        r"audio|video|lyrics?|lyric|karaoke|acoustic|cover|remix|ver(?:sion)?|edit|hd)\b",
        " ",
        cleaned,
        flags=re.IGNORECASE,
    )
    # 4. Normalize separators
    cleaned = re.sub(r"[_\-\.]+", " ", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()

    candidates: List[str] = []
    if cleaned:
        candidates.append(cleaned)

    # Check acronyms
    first_word = cleaned.split()[0].lower() if cleaned else ""
    if first_word in COMMON_ACRONYMS:
        candidates.append(COMMON_ACRONYMS[first_word])

    # If filename has explicit artist separator "Artist - Title" or "Title - Artist"
    if " - " in base:
        parts = [p.strip() for p in base.split(" - ") if p.strip()]
        if len(parts) >= 2:
            p0 = re.sub(r"[\(\[\{].*?[\)\]\}]", " ", parts[0]).strip()
            p1 = re.sub(r"[\(\[\{].*?[\)\]\}]", " ", parts[-1]).strip()
            candidates.append(p1)
            candidates.append(p0)
            candidates.append(f"{p0} {p1}")

    # Check for known bands embedded in the title string (e.g. 'YESUS KAU SUNGGUH BAIK SYMPHONY WORSHIP')
    lower_cleaned = cleaned.lower()
    for band in COMMON_WORSHIP_BANDS:
        if band in lower_cleaned:
            title_without_band = re.sub(re.escape(band), " ", cleaned, flags=re.IGNORECASE).strip()
            title_without_band = re.sub(r"\s+", " ", title_without_band).strip()
            if title_without_band:
                candidates.append(title_without_band)
                candidates.append(f"{band.title()} - {title_without_band}")
                candidates.append(f"{title_without_band} {band.title()}")

    # Progressive 3-word and 4-word title prefixes
    words = cleaned.split()
    if len(words) >= 4:
        candidates.append(" ".join(words[:4]))
    if len(words) >= 3:
        candidates.append(" ".join(words[:3]))

    # Deduplicate while preserving priority order
    seen = set()
    result = []
    for c in candidates:
        norm = c.strip().lower()
        if norm and norm not in seen and len(norm) > 2:
            seen.add(norm)
            result.append(c.strip())

    return result


def parse_lrc_content(lrc_text: str) -> List[Dict[str, Any]]:
    """Parse LRC timestamps [mm:ss.xx] or [mm:ss] into a sorted timeline."""
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
    """Query LRCLIB for a single candidate term with retry on 503 / 429."""
    encoded_q = urllib.parse.quote(term)
    url = f"{LRCLIB_API_ENDPOINT}/search?q={encoded_q}"
    headers = {"User-Agent": "Litwave-Practice-DAW/2.0 (music-practice-workstation)"}

    # Up to 2 retries with backoff on 503 / 429
    for attempt in range(2):
        try:
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=4.0) as resp:
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
                                "lines": parsed,
                            }
            return None
        except urllib.error.HTTPError as http_err:
            if http_err.code in (503, 429) and attempt == 0:
                time.sleep(0.6)
                continue
            logger.warning(f"LRCLIB HTTP {http_err.code} for '{term}': {http_err.reason}")
            return None
        except Exception as e:
            logger.warning(f"Error querying LRCLIB for '{term}': {e}")
            return None
    return None


def find_local_sidecar_lyrics(audio_path: str) -> Optional[Dict[str, Any]]:
    """Check for a local .lrc, .lyrics.json, or .txt file in the same directory as the audio."""
    if not audio_path or not os.path.exists(audio_path):
        return None

    base_without_ext = os.path.splitext(audio_path)[0]
    
    # 1. Check for .lrc file
    lrc_path = base_without_ext + ".lrc"
    if os.path.exists(lrc_path):
        try:
            with open(lrc_path, "r", encoding="utf-8", errors="ignore") as f:
                content = f.read()
            parsed = parse_lrc_content(content)
            if parsed:
                logger.info(f"Loaded local sidecar LRC: {lrc_path} ({len(parsed)} lines)")
                return {
                    "title": os.path.basename(base_without_ext),
                    "artist": "Local File",
                    "synced_lyrics": content,
                    "lines": parsed
                }
        except Exception as e:
            logger.warning(f"Error reading local LRC {lrc_path}: {e}")

    # 2. Check for .lyrics.json file
    json_path = base_without_ext + ".lyrics.json"
    if os.path.exists(json_path):
        try:
            with open(json_path, "r", encoding="utf-8") as f:
                data = json.load(f)
            if isinstance(data, dict) and data.get("lines"):
                logger.info(f"Loaded local sidecar JSON lyrics: {json_path}")
                return data
            elif isinstance(data, list):
                return {
                    "title": os.path.basename(base_without_ext),
                    "artist": "Local File",
                    "synced_lyrics": "",
                    "lines": data
                }
        except Exception as e:
            logger.warning(f"Error reading local lyrics JSON {json_path}: {e}")

    return None


def fetch_synced_lyrics(query: str, duration: Optional[float] = None, audio_path: Optional[str] = None) -> Optional[Dict[str, Any]]:
    """
    Search synchronized lyrics by checking local sidecars first, then running
    smart candidate searches against LRCLIB with backoff.
    """
    # 1. Try local sidecar if audio_path exists
    if audio_path:
        local = find_local_sidecar_lyrics(audio_path)
        if local:
            return local

    # 2. Generate prioritized search candidates
    candidates = clean_query_candidates(query)
    logger.info(f"Searching lyrics for candidates: {candidates}")

    for cand in candidates:
        res = query_lrclib_for_term(cand, duration=duration)
        if res:
            logger.info(f"Matched lyrics for '{cand}': {res['title']} by {res['artist']} ({len(res['lines'])} lines)")
            # Cache alongside audio if audio_path is valid
            if audio_path and os.path.exists(os.path.dirname(audio_path)):
                try:
                    cache_file = os.path.splitext(audio_path)[0] + ".lyrics.json"
                    with open(cache_file, "w", encoding="utf-8") as f:
                        json.dump(res, f, indent=2)
                except Exception:
                    pass
            return res

    return None
