"""Temporal refinement of frame-wise chord probabilities.

Frame-wise argmax flickers between similar chords. We decode the most likely
chord *sequence* with a Viterbi pass over an HMM whose transition matrix
favours staying on the same chord (a standard technique in chord
recognition). Changes still happen exactly where the evidence supports them;
nothing is snapped to beats or bars.
"""
from dataclasses import dataclass

import numpy as np

from . import chords


@dataclass
class Segment:
    start: float
    end: float
    label_raw: str
    label: str
    simple: str
    confidence: float
    simple_confidence: float


def viterbi(probs, self_transition=0.94):
    """Most likely state path. probs: (T, K) posteriors."""
    T, K = probs.shape
    log_e = np.log(np.clip(probs, 1e-9, 1.0))
    log_stay = np.log(self_transition)
    log_move = np.log((1.0 - self_transition) / (K - 1))

    back = np.zeros((T, K), dtype=np.int32)
    score = log_e[0].copy()
    for t in range(1, T):
        best_prev = int(np.argmax(score))
        move = score[best_prev] + log_move
        stay = score + log_stay
        use_move = move > stay
        back[t] = np.where(use_move, best_prev, np.arange(K))
        score = np.where(use_move, move, stay) + log_e[t]
    path = np.empty(T, dtype=np.int32)
    path[-1] = int(np.argmax(score))
    for t in range(T - 1, 0, -1):
        path[t - 1] = back[t, path[t]]
    return path


def _family_matrix(labels):
    """(K, F) 0/1 matrix mapping each class to its beginner family."""
    families = []
    index = []
    for label in labels:
        fam = chords.family(label)
        if fam not in families:
            families.append(fam)
        index.append(families.index(fam))
    matrix = np.zeros((len(labels), len(families)), dtype=np.float32)
    matrix[np.arange(len(labels)), index] = 1.0
    return matrix, np.array(index)


def probs_to_segments(probs, frame_seconds, labels, duration=None, min_duration=0.3, self_transition=0.94, spelling=None):
    path = viterbi(probs, self_transition=self_transition)
    fam_matrix, fam_index = _family_matrix(labels)
    fam_probs = probs @ fam_matrix

    # Run-length encode.
    bounds = [0] + [t for t in range(1, len(path)) if path[t] != path[t - 1]] + [len(path)]
    runs = [(bounds[i], bounds[i + 1], int(path[bounds[i]])) for i in range(len(bounds) - 1)]

    # Absorb very short runs into the neighbour that explains them better.
    min_frames = max(1, int(round(min_duration / frame_seconds)))
    changed = True
    while changed and len(runs) > 1:
        changed = False
        for i, (a, b, k) in enumerate(runs):
            if b - a >= min_frames:
                continue
            candidates = []
            if i > 0:
                candidates.append(runs[i - 1][2])
            if i < len(runs) - 1:
                candidates.append(runs[i + 1][2])
            best = max(candidates, key=lambda c: probs[a:b, c].sum())
            runs[i] = (a, b, best)
            merged = [runs[0]]
            for run in runs[1:]:
                if run[2] == merged[-1][2]:
                    merged[-1] = (merged[-1][0], run[1], run[2])
                else:
                    merged.append(run)
            runs = merged
            changed = True
            break

    segments = []
    for a, b, k in runs:
        raw = labels[k]
        start = round(a * frame_seconds, 3)
        end = round(b * frame_seconds, 3)
        if duration is not None:
            end = min(end, round(duration, 3))
        if end <= start:
            continue
        segments.append(
            Segment(
                start=start,
                end=end,
                label_raw=raw,
                label=chords.display_label(raw, spelling),
                simple=chords.simple_label(raw, spelling),
                confidence=round(float(probs[a:b, k].mean()), 4),
                simple_confidence=round(float(fam_probs[a:b, fam_index[k]].mean()), 4),
            )
        )
    if segments and duration is not None and segments[-1].end < duration:
        segments[-1].end = round(duration, 3)
    return segments


def snap_to_beats(segments, beats, max_fraction=0.35):
    """Move each chord change onto the nearest beat when it is within
    `max_fraction` of a beat interval. Changes far from any beat are kept."""
    if len(segments) < 2 or len(beats) < 2:
        return segments
    beats = np.asarray(beats, dtype=float)
    interval = float(np.median(np.diff(beats)))
    limit = max_fraction * interval
    for prev, seg in zip(segments[:-1], segments[1:]):
        j = int(np.argmin(np.abs(beats - seg.start)))
        target = float(beats[j])
        if abs(target - seg.start) <= limit and prev.start < target < seg.end:
            prev.end = seg.start = round(target, 3)
    return segments


def ensemble_majmin(large_probs, large_labels, majmin_probs, majmin_labels, weight=0.5):
    """Re-weight large-vocabulary probabilities with the major/minor model.

    Each large-vocabulary class in a major or minor family is scaled by how much
    more (or less) the 25-class model believes in that family, raised to
    `weight`. Other qualities (dim, aug) are left unchanged."""
    n = min(len(large_probs), len(majmin_probs))
    large = large_probs[:n].astype(np.float64)
    mm = majmin_probs[:n].astype(np.float64)
    mm_index = {}
    for j, label in enumerate(majmin_labels):
        fam = chords.family(label)
        if fam[1] in ("maj", "min"):
            mm_index[fam] = j
    fam_of = [chords.family(label) for label in large_labels]
    fam_sum = {}
    for k, fam in enumerate(fam_of):
        if fam in mm_index:
            fam_sum.setdefault(fam, np.zeros(n))
            fam_sum[fam] += large[:, k]
    out = large.copy()
    for k, fam in enumerate(fam_of):
        if fam in mm_index:
            ratio = (mm[:, mm_index[fam]] + 1e-4) / (fam_sum[fam] + 1e-4)
            out[:, k] *= ratio ** weight
    out /= out.sum(axis=1, keepdims=True)
    return out.astype(np.float32)


def song_vocabulary_prior(probs, labels, strength=1.0):
    """Favour the chords this song actually uses on each root.

    The model sometimes hears a weak stretch of the song's A chord as Am (or
    Asus2). Across the whole song, each beginner family's share of its root
    (e.g. A major 90%, A minor 10%) is used as a prior: every class is scaled by
    share ** `strength`. A chord the song uses as much as its sibling (C and Cm
    in a song that really plays both) is barely affected, and a confident
    chord still wins; only doubtful stretches of a rare variant flip.
    """
    fams = [chords.family(label) for label in labels]
    keys = list(dict.fromkeys(fams))
    index = np.array([keys.index(f) for f in fams])
    matrix = np.zeros((len(labels), len(keys)))
    matrix[np.arange(len(labels)), index] = 1.0
    mass = (probs @ matrix).mean(axis=0)
    root_total = {}
    for k, (root, quality) in enumerate(keys):
        if quality is not None:
            root_total[root] = root_total.get(root, 0.0) + mass[k]
    share = np.array(
        [mass[k] / root_total[root] if quality is not None and root_total[root] > 0 else 1.0 for k, (root, quality) in enumerate(keys)]
    )
    out = probs * np.maximum(share[index], 1e-6) ** strength
    out /= out.sum(axis=1, keepdims=True)
    return out.astype(np.float32)


# Triads that belong to a key, as (semitones above the tonic, quality).
DIATONIC = {
    "major": {(0, "maj"), (2, "min"), (4, "min"), (5, "maj"), (7, "maj"), (9, "min")},
    # Natural minor plus the major V of harmonic minor.
    "minor": {(0, "min"), (3, "maj"), (5, "min"), (7, "min"), (7, "maj"), (8, "maj"), (10, "maj")},
}


def _family_mass(probs, labels):
    mass = {}
    for k, fam in enumerate(chords.family(label) for label in labels):
        if fam[1] in ("maj", "min"):
            mass[fam] = mass.get(fam, 0.0) + float(probs[:, k].sum())
    return mass


def key_from_chords(probs, labels):
    """The key whose triads cover most of the song's chords: (tonic, scale) or None.

    More reliable than a key profile of the raw audio, which often lands a fifth
    away or on the relative key. Between a major key and its relative minor
    (same chords), the one whose tonic chord is heard more wins.
    """
    mass = _family_mass(probs, labels)
    total = sum(mass.values())
    if not total:
        return None
    best, best_score = None, -1.0
    for t, tonic in enumerate(chords.ROOTS):
        for scale in ("major", "minor"):
            covered = sum(
                v for (root, quality), v in mass.items()
                if ((chords.ROOTS.index(root) - t) % 12, quality) in DIATONIC[scale]
            )
            tonic_mass = mass.get((tonic, "maj" if scale == "major" else "min"), 0.0)
            score = covered / total + 0.5 * tonic_mass / total
            if score > best_score:
                best, best_score = (tonic, scale), score
    return best


def rare_outside_key_prior(probs, labels, key, max_share=0.02, factor=0.2):
    """Discount chords that are both outside the song's key and rare in it.

    A melody or lead line (a vocal note, a guitar fill) is often recognized as
    a short chord that does not belong to the key, e.g. Eb in a song in F. A
    real borrowed chord is used again and again, so it is kept; only families
    that fill less than `max_share` of the song and are not diatonic are scaled
    by `factor`. A chord the model is sure of can still win.
    """
    if not key:
        return probs
    tonic, scale = key
    allowed = DIATONIC.get(scale)
    if allowed is None or tonic not in chords.ROOTS:
        return probs
    fams = [chords.family(label) for label in labels]
    mass = _family_mass(probs, labels)
    total = sum(mass.values()) or 1.0
    weights = np.ones(len(labels))
    for k, (root, quality) in enumerate(fams):
        if quality not in ("maj", "min"):
            continue
        interval = (chords.ROOTS.index(root) - chords.ROOTS.index(tonic)) % 12
        if (interval, quality) not in allowed and mass.get((root, quality), 0.0) / total < max_share:
            weights[k] = factor
    out = probs * weights
    out /= out.sum(axis=1, keepdims=True)
    return out.astype(np.float32)
