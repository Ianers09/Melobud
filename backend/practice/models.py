from django.conf import settings
from django.db import models

from songs.models import Song


class PracticeSession(models.Model):
    MODE_STEP = "step"
    MODE_PLAY_ALONG = "play_along"
    MODE_CHOICES = [(MODE_STEP, "Step-by-step"), (MODE_PLAY_ALONG, "Play-along")]

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="practice_sessions")
    # Sessions outlive deleted songs so past results are not silently rewritten.
    song = models.ForeignKey(Song, on_delete=models.SET_NULL, null=True, blank=True, related_name="practice_sessions")
    song_title = models.CharField(max_length=200)
    song_artist = models.CharField(max_length=200, blank=True)
    mode = models.CharField(max_length=16, choices=MODE_CHOICES)
    chord_display = models.CharField(max_length=8, default="simple")
    started_at = models.DateTimeField(auto_now_add=True)
    last_activity_at = models.DateTimeField(auto_now_add=True)
    ended_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-started_at"]
        indexes = [models.Index(fields=["user", "-started_at"])]

    @property
    def duration_seconds(self):
        end = self.ended_at or self.last_activity_at
        return max(0.0, (end - self.started_at).total_seconds())


class PracticeAttempt(models.Model):
    RESULT_CORRECT = "correct"
    RESULT_INCORRECT = "incorrect"
    RESULT_MISSED = "missed"
    RESULT_UNCERTAIN = "uncertain"
    RESULT_CHOICES = [
        (RESULT_CORRECT, "Correct"),
        (RESULT_INCORRECT, "Incorrect"),
        (RESULT_MISSED, "Missed"),
        (RESULT_UNCERTAIN, "Uncertain"),
    ]

    session = models.ForeignKey(PracticeSession, on_delete=models.CASCADE, related_name="attempts")
    expected_chord = models.CharField(max_length=24)
    detected_chord = models.CharField(max_length=24, blank=True)
    result = models.CharField(max_length=12, choices=RESULT_CHOICES)
    reason = models.CharField(max_length=24, blank=True)
    confidence = models.FloatField(null=True, blank=True)
    song_time = models.FloatField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at"]
        indexes = [models.Index(fields=["session", "created_at"])]
