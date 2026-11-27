"""Full-song analysis pipeline: decode -> BTC chords -> smoothing -> beats -> key."""
import logging
import time
from dataclasses import dataclass, field

import librosa
import numpy as np

from . import beats as beat_tracking
from . import chords
from . import tonal
from .btc import BTCRecognizer, get_recognizer
from .smoothing import ensemble_majmin, key_from_chords, probs_to_segments, rare_outside_key_prior, snap_to_beats, song_vocabulary_prior

logger = logging.getLogger(__name__)


class AnalysisError(Exception):
    """A failure that is safe and useful to show to the user."""


@dataclass
class AnalysisResult:
    segments: list
    duration: float
    chord_model: str
    device: str
    processing_seconds: float
    beats: list = field(default_factory=list)
    downbeats: list = field(default_factory=list)
    beats_per_bar: int | None = None
    meter_confidence: float | None = None
    tempo_bpm: float | None = None
    beat_model: str = ""
    key: str | None = None
    key_source: str | None = None
    tuning_cents: float | None = None


def load_audio(path, sr=BTCRecognizer.SAMPLE_RATE):
    try:
        wav, _ = librosa.load(path, sr=sr, mono=True)
    except Exception as exc:  # noqa: BLE001
        raise AnalysisError("The audio file could not be decoded.") from exc
    if wav.size == 0 or not np.isfinite(wav).all():
        raise AnalysisError("The audio file is empty or damaged.")
    peak = float(np.max(np.abs(wav)))
    if peak < 1e-4:
        raise AnalysisError("The audio file does not contain any sound.")
    # Peak-normalise so quiet masters reach the model at a typical level. The
    # log-CQT the model uses is largely level-invariant, but this keeps the
    # silence floor (1e-6) from dominating very quiet files.
    return (wav / peak * 0.95).astype(np.float32)


DEFAULT_VARIANT = "tuning+snap+vocab+key"


def analyze_file(path, progress=lambda pct, msg: None) -> AnalysisResult:
    started = time.perf_counter()
    progress(8, "Decoding audio")
    wav = load_audio(path)
    result = analyze_signal(wav, progress=progress)
    result.processing_seconds = round(time.perf_counter() - started, 2)
    return result


def analyze_signal(wav, progress=lambda pct, msg: None, variant=None) -> AnalysisResult:
    """Full analysis of a decoded 22.05 kHz mono signal.

    `variant` selects optional refinements (used by the evaluation script):
    any combination of "tuning", "snap", "ensemble", "vocab" and "key" joined with "+".
    """
    variant = variant or DEFAULT_VARIANT
    opts = set(variant.split("+"))
    started = time.perf_counter()
    sr = BTCRecognizer.SAMPLE_RATE
    duration = len(wav) / sr

    progress(15, "Estimating key and tuning")
    key, key_source, tuning = None, None, None
    try:
        key, key_source = tonal.estimate_key(wav, sr)
        tuning = tonal.estimate_tuning_cents(wav, sr)
    except Exception:  # noqa: BLE001 - supplementary; chords are still valid
        logger.exception("Key/tuning estimation failed; continuing")

    progress(25, "Recognizing chords")
    recognizer = get_recognizer(large_vocabulary=True)
    # CQT tuning is in fractions of a bin; BTC uses 24 bins per octave (50 cents).
    cqt_tuning = (tuning or 0.0) / 50.0 if "tuning" in opts and tuning is not None and abs(tuning) >= 8 else 0.0
    output = recognizer.predict(wav, tuning=cqt_tuning)
    probs = output.probs
    if "ensemble" in opts:
        majmin = get_recognizer(large_vocabulary=False).predict(wav, tuning=cqt_tuning)
        probs = ensemble_majmin(probs, output.labels, majmin.probs, majmin.labels)
    if "vocab" in opts:
        probs = song_vocabulary_prior(probs, output.labels)
    # The key is read from the chords themselves (the key whose triads cover the
    # song): far more reliable than the audio key profile, which often lands a
    # fifth away or on the relative key (synthetic benchmark: 20/24 vs 7/24).
    chord_key = key_from_chords(probs, output.labels)
    if chord_key:
        key, key_source = chord_key, "chords"
    if "key" in opts and key:
        probs = rare_outside_key_prior(probs, output.labels, key)
    spelling = chords.spelling_for_key(*key) if key else None

    progress(55, "Refining chord changes")
    segments = probs_to_segments(probs, output.frame_seconds, output.labels, duration=duration, spelling=spelling)
    if not segments:
        raise AnalysisError("No chords could be recognized in this recording.")

    progress(70, "Tracking beats and bars")
    beat_result = None
    try:
        changes = [s.start for s in segments[1:] if s.label_raw not in ("N", "X")]
        beat_result = beat_tracking.track_beats(wav, sr, chord_changes=changes)
    except Exception:  # noqa: BLE001 - beats are supplementary; chords are still valid
        logger.exception("Beat tracking failed; continuing without beats")

    if "snap" in opts and beat_result and beat_result.beats:
        segments = snap_to_beats(segments, beat_result.beats)

    result = AnalysisResult(
        segments=segments,
        duration=round(duration, 3),
        chord_model=recognizer.name,
        device=output.device,
        processing_seconds=0.0,
        key=tonal.key_name(key) if key else None,
        key_source=key_source,
        tuning_cents=tuning,
    )
    if beat_result:
        result.beats = beat_result.beats
        result.downbeats = beat_result.downbeats
        result.beats_per_bar = beat_result.beats_per_bar
        result.meter_confidence = beat_result.meter_confidence
        result.tempo_bpm = beat_result.tempo_bpm
        result.beat_model = beat_result.model
    result.processing_seconds = round(time.perf_counter() - started, 2)
    return result
