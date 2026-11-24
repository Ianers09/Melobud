"""Beat and downbeat tracking with Beat This! (Foscarin, Schlüter & Widmer, ISMIR 2024).

Beat This! predicts beats *and* downbeats directly from audio. We only report a
bar count (1-2-3-4) when the predicted downbeats are consistent: most bars must
contain the same number of beats. Otherwise only the beat pulse is exposed and
the UI says the bar position is unknown.
"""
import logging
import threading
from collections import Counter
from dataclasses import dataclass, field

import numpy as np

from .device import pick_device

logger = logging.getLogger(__name__)

_lock = threading.Lock()
_tracker = None
MODEL_NAME = "Beat This! (final0)"


@dataclass
class BeatResult:
    beats: list = field(default_factory=list)
    downbeats: list = field(default_factory=list)
    beats_per_bar: int | None = None
    meter_confidence: float | None = None
    tempo_bpm: float | None = None
    model: str = MODEL_NAME


def _get_tracker():
    global _tracker
    with _lock:
        if _tracker is None:
            from beat_this.inference import Audio2Beats

            _tracker = Audio2Beats(checkpoint_path="final0", device=pick_device(), dbn=False)
        return _tracker


def assess_meter(beats, downbeats, min_bars=4, min_agreement=0.75):
    """Return (beats_per_bar or None, agreement) from beat/downbeat times."""
    beats = np.asarray(beats, dtype=float)
    downbeats = np.asarray(downbeats, dtype=float)
    if len(downbeats) < min_bars + 1 or len(beats) < 8:
        return None, None
    counts = []
    for a, b in zip(downbeats[:-1], downbeats[1:]):
        counts.append(int(np.sum((beats >= a - 0.07) & (beats < b - 0.07))))
    counts = [c for c in counts if c > 0]
    if len(counts) < min_bars:
        return None, None
    value, hits = Counter(counts).most_common(1)[0]
    agreement = hits / len(counts)
    if value in (2, 3, 4, 6) and agreement >= min_agreement:
        return value, round(agreement, 3)
    return None, round(agreement, 3)


def _near(times, targets, tolerance):
    targets = np.asarray(targets, dtype=float)
    if targets.size == 0:
        return np.zeros(len(times), dtype=bool)
    idx = np.clip(np.searchsorted(targets, times), 1, len(targets) - 1)
    nearest = np.minimum(np.abs(targets[idx - 1] - times), np.abs(targets[idx] - times))
    return nearest <= tolerance


def remove_stray_beats(beats, min_fraction=0.6):
    """Drop beats that follow the previous kept beat too closely (spurious onsets)."""
    beats = np.asarray(beats, dtype=float)
    if len(beats) < 4:
        return beats
    interval = float(np.median(np.diff(beats)))
    kept = [beats[0]]
    for t in beats[1:]:
        if t - kept[-1] >= min_fraction * interval:
            kept.append(t)
    return np.array(kept)


def low_frequency_accents_raw(wav, sr, beats):
    """Mean low-frequency onset strength at the given times, normalised by the
    whole-signal level (comparable between different candidate beat grids)."""
    import librosa

    hop = 256
    mel = librosa.feature.melspectrogram(y=wav, sr=sr, n_fft=2048, hop_length=hop, n_mels=64, fmin=20, fmax=sr / 2)
    freqs = librosa.mel_frequencies(n_mels=64, fmin=20, fmax=sr / 2)
    low = librosa.power_to_db(mel[freqs < 150].sum(axis=0) + 1e-10)
    flux = np.maximum(0, np.diff(low, prepend=low[0]))
    scale = flux.std() + 1e-9
    frames = librosa.time_to_frames(np.asarray(beats, float), sr=sr, hop_length=hop)
    win = max(1, int(0.05 * sr / hop))
    return np.array([flux[max(0, f - win): f + win + 1].max() / scale if f < len(flux) else 0.0 for f in frames])


def _follow_pulse(fast_beats, start, factor=2):
    """From a double-tempo beat list, follow the slower pulse starting at
    `start`: each next beat is the one closest to one slow period later. This
    stays on the same half of the pulse even when the tracker skipped a note."""
    fast_beats = np.asarray(fast_beats, dtype=float)
    period = factor * float(np.median(np.diff(fast_beats)))
    picked = [fast_beats[start]]
    i = start
    while True:
        target = picked[-1] + period
        rest = fast_beats[i + 1:]
        rest = rest[rest > picked[-1] + 0.5 * period]
        if rest.size == 0:
            break
        j = int(np.argmin(np.abs(rest - target)))
        if abs(rest[j] - target) > 0.25 * period:
            picked.append(target)  # fill a gap with the expected position
            continue
        picked.append(float(rest[j]))
        i = int(np.searchsorted(fast_beats, rest[j]))
    return np.array(picked)


def pulse_factor(raw_beats, raw_downbeats, max_bpm=190.0, min_bpm=55.0, tolerance=0.07):
    """How many tracked beats make one counted beat.

    3 for compound meters (6 or 12 small beats per bar, e.g. 6/8 or 12/8, which
    are counted in dotted-quarter beats), 2 when the tracker followed eighth
    notes, 1 otherwise, and 0.5 when it followed half notes (too slow)."""
    beats = np.asarray(raw_beats, dtype=float)
    if len(beats) < 8:
        return 1
    downbeats = np.asarray(raw_downbeats, dtype=float)
    if len(downbeats) >= 4:
        per_bar = [int(np.sum((beats >= a - tolerance) & (beats < b - tolerance))) for a, b in zip(downbeats[:-1], downbeats[1:])]
        common, hits = Counter(per_bar).most_common(1)[0]
        consistent = hits / len(per_bar) >= 0.6  # a clear, regular bar length
        if consistent and common in (6, 12):
            return 3
        if consistent and common in (8, 16):
            return 2
    bpm = 60.0 / float(np.median(np.diff(beats)))
    if bpm > max_bpm:
        return 2
    if bpm < min_bpm:
        return 0.5
    return 1


def refine_beats(raw_beats, raw_downbeats, chord_changes=(), wav=None, sr=None):
    """Correct the beat grid (eighth-note tracking, compound meters, half time,
    stray beats). Returns (beats, downbeats). The chord changes are snapped to
    these beats, so the per-chord beat count in the player is exact."""
    beats = np.asarray(raw_beats, dtype=float)
    factor = pulse_factor(raw_beats, raw_downbeats)
    if factor == 0.5:
        beats = np.sort(np.concatenate([beats, (beats[:-1] + beats[1:]) / 2]))
    elif factor > 1:
        # Keep the grid that best explains downbeats, chord changes and kick/bass hits.
        def support(b):
            interval = float(np.median(np.diff(b))) if len(b) > 1 else 0.5
            score = _near(b, np.sort(np.asarray(raw_downbeats, float)), 0.07).sum() + _near(
                b, np.sort(np.asarray(chord_changes, float)), 0.2 * interval).sum()
            if wav is not None:
                # Kick and bass sit on the main beats; hi-hats fill the rest.
                score += 0.5 * len(b) * float(np.mean(low_frequency_accents_raw(wav, sr, b)))
            return score
        candidates = [_follow_pulse(beats, start, factor) for start in range(min(factor, len(beats)))]
        beats = max(candidates, key=support)
    beats = remove_stray_beats(beats)
    raw_downbeats = np.asarray(raw_downbeats, dtype=float)
    if raw_downbeats.size == 0 or beats.size == 0:
        return beats, np.zeros(0)
    # Model downbeats moved onto the corrected beat grid.
    idx = np.unique([int(np.argmin(np.abs(beats - d))) for d in raw_downbeats])
    return beats, beats[idx]


def track_beats(wav, sr, chord_changes=()) -> BeatResult:
    tracker = _get_tracker()
    raw_beats, raw_downbeats = tracker(wav, sr)
    beats, downbeats = refine_beats(raw_beats, raw_downbeats, chord_changes, wav=wav, sr=sr)
    beats = [round(float(t), 3) for t in beats]
    downbeats = [round(float(t), 3) for t in downbeats]
    tempo = None
    if len(beats) >= 8:
        tempo = round(60.0 / float(np.median(np.diff(beats))), 1)
    beats_per_bar, agreement = assess_meter(beats, downbeats)
    return BeatResult(
        beats=beats,
        downbeats=downbeats,
        beats_per_bar=beats_per_bar,
        meter_confidence=agreement,
        tempo_bpm=tempo,
    )
