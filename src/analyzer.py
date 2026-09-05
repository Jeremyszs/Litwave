"""Offline BTC chord, tempo, beat-phase, and key analysis for Litwave."""

import os
import logging
from typing import Dict, Any, List, Optional
import numpy as np
import librosa

logger = logging.getLogger("LitwaveAnalyzer")

BTC_MODEL_ID = "puar-playground/btc-chord"
BTC_MODEL_REVISION = "d436f2f664f5107cd987774279b8ce171846e376"
_BTC_MODEL = None


def get_btc_model():
    """Lazily load and cache the pinned BTC model; failures remain retryable."""
    global _BTC_MODEL
    if _BTC_MODEL is None:
        try:
            from transformers import AutoModel
            logger.info("Loading pinned BTC Transformer chord recognition model...")
            _BTC_MODEL = AutoModel.from_pretrained(
                BTC_MODEL_ID,
                revision=BTC_MODEL_REVISION,
                trust_remote_code=True,
                large_voca=True,
            )
            logger.info("BTC model loaded successfully!")
        except Exception as error:
            logger.error(f"Failed to load BTC model: {error}")
            return None
    return _BTC_MODEL


# Musical Interval Maps for Nashville Numbers
NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
ENHARMONIC = {
    "Db": "C#", "Eb": "D#", "Gb": "F#", "Ab": "G#", "Bb": "A#",
    "D#": "D#", "A#": "A#", "F#": "F#"
}

NASHVILLE_MAJOR = {
    0: "1", 1: "b2", 2: "2", 3: "b3", 4: "3", 5: "4",
    6: "#4", 7: "5", 8: "b6", 9: "6", 10: "b7", 11: "7"
}

KRUMHANSL_MAJOR = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
KRUMHANSL_MINOR = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])


def clean_chord_name(raw_chord: str) -> str:
    """Format Harte chord notation from BTC model into standard studio practice notation."""
    if not raw_chord or raw_chord == "None":
        return "N"
    if raw_chord in ["N", "X"]:
        return raw_chord
    
    # Harte format e.g. "C:maj", "A:min", "G:7", "D:min7", "F:maj7", "Bb:(1,3,5)"
    parts = raw_chord.split(":")
    root = parts[0]
    
    if len(parts) == 1:
        return root
        
    qual = parts[1]
    
    suffixes = {
        "maj": "", "min": "m", "dim": "dim", "aug": "aug",
        "min6": "m6", "maj6": "6", "min7": "m7", "minmaj7": "mMaj7",
        "maj7": "Maj7", "7": "7", "dim7": "dim7", "hdim7": "m7b5",
        "sus2": "sus2", "sus4": "sus4",
    }
    if qual in suffixes:
        return root + suffixes[qual]
    return raw_chord


def calculate_nashville(chord: str, root_key: Optional[str]) -> str:
    """Convert a recognized chord to Nashville notation when key is known."""
    if not chord or chord in ("N", "X") or not root_key:
        return "-"
    
    # Check slash chord
    bass = None
    main_chord = chord
    if "/" in chord:
        main_chord, bass = chord.split("/", 1)
        
    # Extract root pitch
    c_root = main_chord[:2] if len(main_chord) > 1 and main_chord[1] in ["#", "b"] else main_chord[:1]
    suffix = main_chord[len(c_root):]
    
    r_key = root_key.replace("m", "").strip()
    r_key = r_key[:2] if len(r_key) > 1 and r_key[1] in ["#", "b"] else r_key[:1]
    
    norm_c = ENHARMONIC.get(c_root, c_root)
    norm_k = ENHARMONIC.get(r_key, r_key)
    
    if norm_c not in NOTE_NAMES or norm_k not in NOTE_NAMES:
        return chord
        
    semitones = (NOTE_NAMES.index(norm_c) - NOTE_NAMES.index(norm_k)) % 12
    num = NASHVILLE_MAJOR.get(semitones, "?")
    
    # Minor formatting
    if suffix.startswith("m") and not suffix.startswith("maj"):
        num_str = f"{num}m{suffix[1:]}"
    else:
        num_str = f"{num}{suffix}"
        
    if bass:
        norm_bass = ENHARMONIC.get(bass, bass)
        if norm_bass in NOTE_NAMES:
            bass_semi = (NOTE_NAMES.index(norm_bass) - NOTE_NAMES.index(norm_k)) % 12
            num_str += f"/{NASHVILLE_MAJOR.get(bass_semi, '?')}"
            
    return num_str


def postprocess_chords(raw_chords: List[Dict[str, Any]], track_duration: float) -> List[Dict[str, Any]]:
    """Validate a raw chord timeline and merge only touching identical labels."""
    if not np.isfinite(track_duration) or track_duration < 0:
        raise ValueError("Invalid track duration")

    processed: List[Dict[str, Any]] = []
    previous_end = 0.0
    for index, raw in enumerate(raw_chords):
        start = float(raw["start"])
        end = float(raw["end"])
        chord = str(raw["chord"])
        if not np.isfinite(start) or not np.isfinite(end) or start < 0 or end <= start:
            raise ValueError(f"Invalid chord interval: {raw}")
        is_last = index == len(raw_chords) - 1
        if (start < previous_end - 0.001 or start >= track_duration
                or end > track_duration + 0.25 or (end > track_duration and not is_last)):
            raise ValueError(f"Chord interval outside ordered track bounds: {raw}")

        segment = {"start": start, "end": min(end, track_duration), "chord": chord}
        if (processed and processed[-1]["chord"] == chord
                and abs(processed[-1]["end"] - start) <= 0.001):
            processed[-1]["end"] = segment["end"]
        else:
            processed.append(segment)
        previous_end = end
    return processed


def chord_duration_totals(detected_chords: List[Dict[str, Any]]) -> Dict[str, float]:
    """Sum actual segment durations using enharmonic-normalized chord roots."""
    totals: Dict[str, float] = {}
    for segment in detected_chords:
        chord = str(segment.get("chord", "N"))
        if chord in ("N", "X"):
            continue
        root_len = 2 if len(chord) > 1 and chord[1] in ("#", "b") else 1
        chord = ENHARMONIC.get(chord[:root_len], chord[:root_len]) + chord[root_len:]
        duration = float(segment["end"]) - float(segment["start"])
        if duration > 0:
            totals[chord] = totals.get(chord, 0.0) + duration
    return totals


def estimate_key(chroma_mean: np.ndarray, detected_chords: Optional[List[Dict[str, Any]]] = None) -> Optional[str]:
    """Estimate key from chroma and real chord durations, or return unknown."""
    if chroma_mean.shape != (12,) or not np.all(np.isfinite(chroma_mean)):
        return None
    chroma_norm = float(np.linalg.norm(chroma_mean))
    if chroma_norm <= 1e-6:
        return None

    norm_chroma = chroma_mean / chroma_norm
    k_maj = KRUMHANSL_MAJOR / np.linalg.norm(KRUMHANSL_MAJOR)
    k_min = KRUMHANSL_MINOR / np.linalg.norm(KRUMHANSL_MINOR)
    
    # Calculate correlation for all 24 keys
    candidate_scores = {}
    for i in range(12):
        # Major correlation
        rot_maj = np.roll(k_maj, i)
        corr_maj = float(np.dot(norm_chroma, rot_maj))
        candidate_scores[NOTE_NAMES[i]] = corr_maj
            
        # Minor correlation
        rot_min = np.roll(k_min, i)
        corr_min = float(np.dot(norm_chroma, rot_min))
        candidate_scores[f"{NOTE_NAMES[i]}m"] = corr_min

    # Harmonic weight from actual detected chord durations
    if detected_chords:
        chord_durations = chord_duration_totals(detected_chords)

        # If relative major triad duration substantially exceeds relative minor (e.g. E > C#m in Kisah Romantis)
        for i in range(12):
            maj_note = NOTE_NAMES[i]
            rel_minor_note = f"{NOTE_NAMES[(i + 9) % 12]}m"
            
            maj_dur = chord_durations.get(maj_note, 0.0) + chord_durations.get(f"{maj_note}Maj7", 0.0)
            min_dur = chord_durations.get(rel_minor_note, 0.0) + chord_durations.get(f"{rel_minor_note}7", 0.0)
            
            # Boost score based on actual tonic chord duration
            if maj_dur > 0 and maj_dur > min_dur * 1.3:
                candidate_scores[maj_note] = candidate_scores.get(maj_note, 0.0) + 0.015
            elif min_dur > 0 and min_dur > maj_dur * 1.3:
                candidate_scores[rel_minor_note] = candidate_scores.get(rel_minor_note, 0.0) + 0.015

    best_key = max(candidate_scores.items(), key=lambda x: x[1])[0]
    return best_key


def analyze_track(audio_path: str, max_duration: Optional[float] = None) -> Dict[str, Any]:
    """Analyze tempo, beat phase, key, and a raw BTC chord timeline."""
    if not os.path.exists(audio_path):
        raise FileNotFoundError(f"Audio file not found: {audio_path}")

    sr = 22050
    logger.info(f"Loading audio for analysis: {audio_path} (sr={sr})...")
    y, _ = librosa.load(audio_path, sr=sr, duration=max_duration)
    duration = float(librosa.get_duration(y=y, sr=sr))

    logger.info("Extracting beat onsets and tempo grid...")
    onset_env = librosa.onset.onset_strength(y=y, sr=sr)
    tempo_arr, beats = librosa.beat.beat_track(
        onset_envelope=onset_env,
        sr=sr,
        start_bpm=90.0,
        tightness=100,
    )
    tempo = float(tempo_arr[0] if isinstance(tempo_arr, (np.ndarray, list)) else tempo_arr)
    tempo = round(tempo, 1) if np.isfinite(tempo) and tempo > 0 else 0.0
    beat_times = [round(float(t), 3) for t in librosa.frames_to_time(beats, sr=sr).tolist()]
    first_beat = float(beat_times[0]) if beat_times else None

    chroma = librosa.feature.chroma_cqt(y=y, sr=sr)
    chroma_mean = np.mean(chroma, axis=1)

    model = get_btc_model()
    if model is None:
        raise RuntimeError("BTC chord model is unavailable; existing chart was preserved")

    try:
        logger.info("Running BTC Transformer inference...")
        preds = model.predict(y)
    except Exception as error:
        raise RuntimeError(f"BTC chord inference failed: {error}") from error
    if not preds:
        raise RuntimeError("BTC chord inference returned no predictions; existing chart was preserved")

    raw_chords = [
        {
            "start": round(float(prediction["start"]), 3),
            "end": round(float(prediction["end"]), 3),
            "chord": clean_chord_name(prediction["chord"]),
        }
        for prediction in preds
    ]
    filtered_chords = postprocess_chords(raw_chords, duration)
    root_key = estimate_key(chroma_mean, filtered_chords)

    chord_chart: List[Dict[str, Any]] = []
    for chord in filtered_chords:
        chord_chart.append({
            "time": chord["start"],
            "end": chord["end"],
            "chord": chord["chord"],
            "nashville": calculate_nashville(chord["chord"], root_key),
            "duration": round(chord["end"] - chord["start"], 3),
        })

    logger.info(f"Analysis complete: {tempo} BPM, Key: {root_key}, {len(chord_chart)} distinct chords.")

    return {
        "bpm": tempo,
        "key": root_key,
        "time_sig": None,
        "first_beat_seconds": round(first_beat, 3) if first_beat is not None else None,
        "beat_times": beat_times,
        "total_chords": len(chord_chart),
        "model": {"id": BTC_MODEL_ID, "revision": BTC_MODEL_REVISION, "vocabulary": "large"},
        "pipeline_version": 2,
        "chords": chord_chart,
    }
