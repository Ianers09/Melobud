import numpy as np
import pytest
from django.conf import settings

from audio_engine import chords
from audio_engine.beats import assess_meter
from audio_engine.smoothing import probs_to_segments, viterbi



# --- chord labels -------------------------------------------------------------
@pytest.mark.parametrize(
    "raw,label,simple",
    [
        ("C", "C", "C"),
        ("A:min", "Am", "Am"),
        ("G:maj7", "Gmaj7", "G"),
        ("D:7", "D7", "D"),
        ("E:min7", "Em7", "Em"),
        ("A#:maj", "Bb", "Bb"),
        # No third: simplifying to major/minor would be wrong, so keep it.
        ("D:sus4", "Dsus4", "Dsus4"),
        ("B:dim", "Bdim", "Bdim"),
        ("B:hdim7", "Bm7b5", "Bm7b5"),
        ("N", "N.C.", "N.C."),
        ("X", "?", "?"),
    ],
)
def test_labels(raw, label, simple):
    assert chords.display_label(raw) == label
    assert chords.simple_label(raw) == simple


def test_key_aware_spelling():
    assert chords.simple_label("G#", chords.spelling_for_key("E", "major")) == "G#"
    assert chords.simple_label("G#", chords.spelling_for_key("F", "minor")) == "Ab"
    assert chords.parse_display("Bbm") == ("A#", "min")
    assert chords.parse_display("F#7") == ("F#", "7")


# --- temporal smoothing ----------------------------------------------------------
def test_viterbi_removes_flicker_but_keeps_real_changes():
    labels = ["C", "G", "N"]
    probs = np.full((60, 3), 0.05)
    probs[:30, 0] = 0.9
    probs[30:, 1] = 0.9
    probs[12, :] = [0.3, 0.6, 0.1]  # one noisy frame
    probs /= probs.sum(1, keepdims=True)
    path = viterbi(probs)
    assert path[12] == 0
    assert path[29] == 0 and path[30] == 1

    segs = probs_to_segments(probs, 0.1, labels, duration=6.0)
    assert [(s.label, s.start, s.end) for s in segs] == [("C", 0.0, 3.0), ("G", 3.0, 6.0)]
    assert 0.8 < segs[0].confidence < 0.95


def test_family_confidence_pools_extensions():
    labels = ["G", "G:maj7", "C"]
    probs = np.tile([0.45, 0.4, 0.15], (20, 1))
    seg = probs_to_segments(probs, 0.1, labels)[0]
    assert seg.label_raw == "G" and seg.simple == "G"
    assert seg.simple_confidence == pytest.approx(0.85, abs=1e-3)


def test_meter_assessment():
    beats = np.arange(0, 40, 0.5)
    downbeats = beats[::4]
    assert assess_meter(beats, downbeats) == (4, 1.0)
    erratic = np.sort(np.random.default_rng(0).choice(beats, 12, replace=False))
    bpb, agreement = assess_meter(beats, erratic)
    assert bpb is None
    assert assess_meter(beats[:6], downbeats[:2]) == (None, None)


# --- real models on a real MP3 -------------------------------------------------------
@pytest.mark.slow
def test_full_pipeline_on_real_mp3():
    from audio_engine.analyze import analyze_file

    result = analyze_file(str(settings.BTC_DIR / "test" / "example.mp3"))
    assert result.duration > 200
    assert len(result.segments) > 20
    starts = [s.start for s in result.segments]
    assert starts == sorted(starts) and result.segments[0].start == 0.0
    assert all(a.end == pytest.approx(b.start) for a, b in zip(result.segments, result.segments[1:]))
    assert result.segments[-1].end == pytest.approx(result.duration, abs=0.01)
    assert all(0 <= s.confidence <= 1 for s in result.segments)
    assert len({s.label_raw for s in result.segments}) > 3
    assert len(result.beats) > 100 and result.tempo_bpm


# --- beats: tempo-octave correction and 1-2-3-4 assignment --------------------------
from audio_engine.beats import _follow_pulse, refine_beats, remove_stray_beats  # noqa: E402


def test_follow_pulse_survives_a_skipped_eighth_note():
    eighths = [i * 0.25 for i in range(40) if i != 13]  # one eighth note missing
    quarters = _follow_pulse(eighths, 0)
    assert np.allclose(quarters, np.arange(0, 10, 0.5), atol=1e-6)


def test_remove_stray_beats():
    beats = [0, 0.5, 1.0, 1.2, 1.5, 2.0]
    assert remove_stray_beats(beats).tolist() == [0, 0.5, 1.0, 1.5, 2.0]


def test_refine_beats_halves_double_tempo():
    eighths = np.arange(0, 16, 0.25)
    downbeats = np.arange(0, 16, 2.0)
    beats, bar_starts = refine_beats(eighths, downbeats, chord_changes=[4.0, 8.0])
    assert np.allclose(np.diff(beats), 0.5)
    assert np.allclose(bar_starts, downbeats)


def test_compound_meter_is_counted_in_dotted_quarters():
    eighths = np.arange(0, 24, 1 / 3)  # 6/8: six eighths per 2-second bar
    downbeats = np.arange(0, 24, 2.0)
    beats, _ = refine_beats(eighths, downbeats, chord_changes=[4.0, 8.0, 12.0])
    assert np.allclose(np.diff(beats), 1.0)  # dotted-quarter pulse
