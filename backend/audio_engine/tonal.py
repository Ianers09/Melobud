"""Supporting harmonic analysis: global key and tuning.

Essentia's KeyExtractor is used when Essentia is importable (Linux/macOS/WSL;
there is no Windows wheel). Otherwise the key is estimated with the
Krumhansl–Schmuckler method on a librosa CQT chromagram.
"""
import logging

import librosa
import numpy as np

from .chords import display_root, spelling_for_key

logger = logging.getLogger(__name__)

try:  # pragma: no cover - depends on platform
    import essentia.standard as es  # type: ignore

    HAS_ESSENTIA = True
except Exception:  # noqa: BLE001
    es = None
    HAS_ESSENTIA = False

ROOTS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
KS_MAJOR = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
KS_MINOR = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])


def estimate_tuning_cents(wav, sr):
    try:
        semitones = librosa.estimate_tuning(y=wav, sr=sr, bins_per_octave=12)
    except Exception:  # noqa: BLE001
        return None
    return round(float(semitones) * 100.0, 1)


def _format_key(root, scale):
    return (root, "minor" if scale == "minor" else "major")


def key_name(key):
    root, scale = key
    return f"{display_root(root, spelling_for_key(root, scale))} {scale}"


def estimate_key(wav, sr):
    """Returns ((root, scale), source) e.g. (('G', 'major'), 'librosa'), or (None, None)."""
    if HAS_ESSENTIA:
        try:
            audio = wav.astype(np.float32)
            if sr != 44100:
                audio = librosa.resample(audio, orig_sr=sr, target_sr=44100)
            key, scale, strength = es.KeyExtractor()(audio)
            key = {"Db": "C#", "Eb": "D#", "Gb": "F#", "Ab": "G#", "Bb": "A#"}.get(key, key)
            if strength > 0.1:
                return _format_key(key, scale), "essentia"
        except Exception:  # noqa: BLE001
            logger.warning("Essentia key extraction failed; falling back to librosa", exc_info=True)

    chroma = librosa.feature.chroma_cqt(y=wav, sr=sr, hop_length=4096)
    profile = chroma.mean(axis=1)
    if not np.isfinite(profile).all() or profile.sum() <= 0:
        return None, None
    scores = []
    for i in range(12):
        scores.append((np.corrcoef(profile, np.roll(KS_MAJOR, i))[0, 1], ROOTS[i], "major"))
        scores.append((np.corrcoef(profile, np.roll(KS_MINOR, i))[0, 1], ROOTS[i], "minor"))
    scores.sort(reverse=True)
    best = scores[0]
    if best[0] < 0.5:
        return None, None
    return _format_key(best[1], best[2]), "librosa"
