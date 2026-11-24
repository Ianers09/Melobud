from django.db import models

from songs.models import Song


class ChordAnalysis(models.Model):
    """Result of analyzing one song. Every value here is derived from the audio."""

    song = models.OneToOneField(Song, on_delete=models.CASCADE, related_name="analysis")
    chord_model = models.CharField(max_length=80)
    beat_model = models.CharField(max_length=80, blank=True)
    device = models.CharField(max_length=16)
    key = models.CharField(max_length=16, blank=True)
    key_source = models.CharField(max_length=16, blank=True)
    tuning_cents = models.FloatField(null=True, blank=True)
    tempo_bpm = models.FloatField(null=True, blank=True)
    beats = models.JSONField(default=list)
    downbeats = models.JSONField(default=list)
    beats_per_bar = models.PositiveSmallIntegerField(null=True, blank=True)
    meter_confidence = models.FloatField(null=True, blank=True)
    # Distinct chords ordered by total time in the song, e.g. {"simple": ["G", "C"], "full": [...]}.
    summary = models.JSONField(default=dict)
    processing_seconds = models.FloatField()
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"Analysis of {self.song_id}"


class ChordSegment(models.Model):
    analysis = models.ForeignKey(ChordAnalysis, on_delete=models.CASCADE, related_name="segments")
    position = models.PositiveIntegerField()
    start = models.FloatField()
    end = models.FloatField()
    # Raw model output in Harte notation, e.g. "G:maj7" — never modified.
    label_raw = models.CharField(max_length=24)
    # Full display name, e.g. "Gmaj7".
    label = models.CharField(max_length=24)
    # Beginner-friendly name, e.g. "G". Equal to `label` when simplifying would mislead.
    simple = models.CharField(max_length=24)
    # Mean model probability of `label_raw` over the segment's frames.
    confidence = models.FloatField(null=True, blank=True)
    # Mean probability of the whole beginner family (e.g. all G-major-type chords).
    simple_confidence = models.FloatField(null=True, blank=True)

    class Meta:
        ordering = ["position"]
        indexes = [models.Index(fields=["analysis", "position"])]
        constraints = [models.UniqueConstraint(fields=["analysis", "position"], name="unique_segment_position")]
