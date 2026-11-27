"""Chord label handling.

BTC outputs Harte-style labels ("C", "C:min", "G:maj7", "N", "X"). This module
turns them into readable names and a beginner-friendly form *without* hiding
information that would make the result misleading:

* 7th/6th extensions of major and minor triads collapse to the triad
  (Gmaj7 -> G, Am7 -> Am). The triad is a correct, playable subset.
* sus2/sus4 collapse to the major triad (Asus2 -> A, Bsus4 -> B). In pop
  songs they colour a major chord, and the model often reports them where the
  band simply plays the triad. Full names still show the sus chord.
* dim/aug chords keep their own name in beginner mode: calling them major or
  minor would be wrong.
"""
ROOTS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
# Guitarists usually read these as flats.
DISPLAY_ROOT = {"C#": "C#", "D#": "Eb", "F#": "F#", "G#": "Ab", "A#": "Bb"}
FLAT_TO_SHARP = {"Db": "C#", "Eb": "D#", "Gb": "F#", "Ab": "G#", "Bb": "A#", "Cb": "B", "Fb": "E", "E#": "F", "B#": "C"}

QUALITY_SUFFIX = {
    "maj": "",
    "min": "m",
    "dim": "dim",
    "aug": "aug",
    "min6": "m6",
    "maj6": "6",
    "min7": "m7",
    "minmaj7": "m(maj7)",
    "maj7": "maj7",
    "7": "7",
    "dim7": "dim7",
    "hdim7": "m7b5",
    "sus2": "sus2",
    "sus4": "sus4",
}
MAJOR_FAMILY = {"maj", "maj6", "maj7", "7", "sus2", "sus4"}
MINOR_FAMILY = {"min", "min6", "min7", "minmaj7"}

# Semitone intervals of each quality, used to build templates for live recognition.
QUALITY_INTERVALS = {
    "maj": (0, 4, 7),
    "min": (0, 3, 7),
    "dim": (0, 3, 6),
    "aug": (0, 4, 8),
    "min6": (0, 3, 7, 9),
    "maj6": (0, 4, 7, 9),
    "min7": (0, 3, 7, 10),
    "minmaj7": (0, 3, 7, 11),
    "maj7": (0, 4, 7, 11),
    "7": (0, 4, 7, 10),
    "dim7": (0, 3, 6, 9),
    "hdim7": (0, 3, 6, 10),
    "sus2": (0, 2, 7),
    "sus4": (0, 5, 7),
}
SUFFIX_TO_QUALITY = {v: k for k, v in QUALITY_SUFFIX.items()}
SUFFIX_TO_QUALITY.update({"min": "min", "maj": "maj", "M7": "maj7", "-": "min", "m7b5": "hdim7", "ø": "hdim7"})

NO_CHORD = "N"
UNKNOWN = "X"


def parse_harte(label):
    """Return (root, quality) or (None, None) for N/X. Bass/inversions are ignored."""
    if label in (NO_CHORD, UNKNOWN, "", None):
        return None, None
    label = label.split("/")[0]
    if ":" in label:
        root, quality = label.split(":", 1)
    else:
        root, quality = label, "maj"
    root = FLAT_TO_SHARP.get(root, root)
    if root not in ROOTS or quality not in QUALITY_SUFFIX:
        return None, None
    return root, quality


SHARP_TO_FLAT = {"C#": "Db", "D#": "Eb", "F#": "Gb", "G#": "Ab", "A#": "Bb"}
# Keys whose scales are written with sharps / flats (by tonic, major and minor).
SHARP_KEYS = {
    ("G", "major"), ("D", "major"), ("A", "major"), ("E", "major"), ("B", "major"), ("F#", "major"),
    ("E", "minor"), ("B", "minor"), ("F#", "minor"), ("C#", "minor"), ("G#", "minor"), ("D#", "minor"),
}
# C# major is conventionally written as Db major (5 flats rather than 7 sharps).
FLAT_KEYS = {
    ("F", "major"), ("A#", "major"), ("D#", "major"), ("G#", "major"), ("C#", "major"),
    ("D", "minor"), ("G", "minor"), ("C", "minor"), ("F", "minor"), ("A#", "minor"),
}


def spelling_for_key(root, scale):
    """'sharp', 'flat' or None (use the guitar-friendly default) for a key."""
    if (root, scale) in SHARP_KEYS:
        return "sharp"
    if (root, scale) in FLAT_KEYS:
        return "flat"
    return None


def display_root(root, spelling=None):
    if spelling == "sharp":
        return root
    if spelling == "flat":
        return SHARP_TO_FLAT.get(root, root)
    return DISPLAY_ROOT.get(root, root)


def display_label(label, spelling=None):
    if label == NO_CHORD:
        return "N.C."
    if label == UNKNOWN:
        return "?"
    root, quality = parse_harte(label)
    if root is None:
        return "?"
    return display_root(root, spelling) + QUALITY_SUFFIX[quality]


def family(label):
    """Beginner family key: ('G','maj'), ('A','min'), or the exact (root, quality) for others."""
    root, quality = parse_harte(label)
    if root is None:
        return (label, None)
    if quality in MAJOR_FAMILY:
        return (root, "maj")
    if quality in MINOR_FAMILY:
        return (root, "min")
    return (root, quality)


def simple_label(label, spelling=None):
    root, quality = family(label)
    if quality is None:
        return display_label(label, spelling)
    return display_root(root, spelling) + QUALITY_SUFFIX[quality]


def parse_display(name):
    """Parse a display name like 'Bb', 'F#m', 'Gmaj7' into (root, quality) or (None, None)."""
    if not name or name in ("N.C.", "?"):
        return None, None
    if len(name) >= 2 and name[1] in "#b":
        root, suffix = name[:2], name[2:]
    else:
        root, suffix = name[:1], name[1:]
    root = FLAT_TO_SHARP.get(root, root)
    if root not in ROOTS:
        return None, None
    quality = SUFFIX_TO_QUALITY.get(suffix)
    if quality is None:
        return None, None
    return root, quality


def pitch_classes(root, quality):
    base = ROOTS.index(root)
    return tuple(sorted((base + i) % 12 for i in QUALITY_INTERVALS[quality]))
