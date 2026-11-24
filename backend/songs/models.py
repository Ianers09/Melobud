import uuid

from django.conf import settings
from django.db import models


def audio_upload_path(instance, filename):
    # Files are grouped per owner and named by random UUID; the original
    # filename is kept only in the database.
    return f"audio/{instance.owner_id}/{uuid.uuid4().hex}.mp3"


class Song(models.Model):
    STATUS_PENDING = "pending"
    STATUS_PROCESSING = "processing"
    STATUS_COMPLETED = "completed"
    STATUS_FAILED = "failed"
    STATUS_CHOICES = [
        (STATUS_PENDING, "Pending"),
        (STATUS_PROCESSING, "Processing"),
        (STATUS_COMPLETED, "Completed"),
        (STATUS_FAILED, "Failed"),
    ]

    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="songs")
    title = models.CharField(max_length=200)
    artist = models.CharField(max_length=200, blank=True)
    audio = models.FileField(upload_to=audio_upload_path, max_length=255)
    original_filename = models.CharField(max_length=255)
    file_size = models.PositiveBigIntegerField()
    duration = models.FloatField(null=True, blank=True)
    status = models.CharField(max_length=16, choices=STATUS_CHOICES, default=STATUS_PENDING)
    status_message = models.CharField(max_length=300, blank=True)
    progress = models.PositiveSmallIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    analysis_started_at = models.DateTimeField(null=True, blank=True)
    analysis_finished_at = models.DateTimeField(null=True, blank=True)
    last_played_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["owner", "-created_at"]),
            models.Index(fields=["owner", "status"]),
        ]

    def __str__(self):
        return self.title
