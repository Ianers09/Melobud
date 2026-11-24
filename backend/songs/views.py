import os
from pathlib import Path

from django.db.models import Q
from django.http import Http404
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import generics, status
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView

from chord_recognition.dispatch import enqueue_analysis
from chord_recognition.services import mark_stale_jobs_failed

from .models import Song
from .ranged import ranged_file_response
from .serializers import SongDetailSerializer, SongSerializer, UploadSerializer
from .validation import InvalidAudio, validate_mp3

SORTS = {
    "recent": ["-created_at"],
    "oldest": ["created_at"],
    "title": ["title", "-created_at"],
    "artist": ["artist", "title"],
    "duration": ["-duration", "title"],
    "played": ["-last_played_at", "-created_at"],
}


def owned_songs(request):
    """Every song query goes through this, so users only ever see their own songs."""
    return Song.objects.filter(owner=request.user)


class SongListCreateView(APIView):
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def get_throttles(self):
        self.throttle_scope = "upload" if self.request.method == "POST" else None
        return super().get_throttles()

    def get(self, request):
        songs = owned_songs(request)
        mark_stale_jobs_failed(songs)
        query = request.query_params.get("q", "").strip()[:100]
        if query:
            songs = songs.filter(Q(title__icontains=query) | Q(artist__icontains=query))
        status_filter = request.query_params.get("status")
        if status_filter in dict(Song.STATUS_CHOICES):
            songs = songs.filter(status=status_filter)
        sort = SORTS.get(request.query_params.get("sort", "recent"), SORTS["recent"])
        songs = songs.select_related("analysis").order_by(*sort)
        try:
            limit = max(1, min(int(request.query_params.get("limit", 200)), 200))
        except ValueError:
            limit = 200
        return Response({"results": SongSerializer(songs[:limit], many=True).data, "count": songs.count()})

    def post(self, request):
        serializer = UploadSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        upload = serializer.validated_data["file"]
        try:
            info = validate_mp3(upload)
        except InvalidAudio as exc:
            return Response({"detail": exc.message, "code": exc.code}, status=status.HTTP_400_BAD_REQUEST)

        title = (serializer.validated_data.get("title") or "").strip() or info.title or Path(upload.name).stem
        artist = (serializer.validated_data.get("artist") or "").strip() or info.artist
        song = Song(
            owner=request.user,
            title=title[:200],
            artist=artist[:200],
            original_filename=Path(upload.name).name[:255],
            file_size=upload.size,
            duration=round(info.duration, 3),
            status=Song.STATUS_PENDING,
            status_message="Queued for analysis",
        )
        song.audio.save("upload.mp3", upload, save=False)
        song.save()
        backend = enqueue_analysis(song.pk)
        data = SongSerializer(song).data
        data["queue"] = backend
        return Response(data, status=status.HTTP_201_CREATED)


class SongDetailView(generics.RetrieveUpdateDestroyAPIView):
    serializer_class = SongDetailSerializer
    http_method_names = ["get", "patch", "delete"]

    def get_queryset(self):
        songs = owned_songs(self.request)
        mark_stale_jobs_failed(songs)
        return songs.select_related("analysis").prefetch_related("analysis__segments")

    def perform_destroy(self, song):
        path = song.audio.path if song.audio else None
        song.delete()
        if path and os.path.exists(path):
            os.remove(path)


class SongAudioView(APIView):
    throttle_classes = []

    def get(self, request, pk):
        song = get_object_or_404(owned_songs(request), pk=pk)
        if not song.audio or not os.path.exists(song.audio.path):
            raise Http404("Audio file is missing.")
        return ranged_file_response(request, song.audio.path)


class SongReanalyzeView(APIView):
    def post(self, request, pk):
        song = get_object_or_404(owned_songs(request), pk=pk)
        if song.status in (Song.STATUS_PENDING, Song.STATUS_PROCESSING):
            return Response(
                {"detail": "This song is already being analyzed.", "code": "in_progress"},
                status=status.HTTP_409_CONFLICT,
            )
        if not song.audio or not os.path.exists(song.audio.path):
            return Response(
                {"detail": "The audio file for this song is no longer available. Please upload the song again.", "code": "missing_audio"},
                status=status.HTTP_410_GONE,
            )
        song.status = Song.STATUS_PENDING
        song.status_message = "Queued for analysis"
        song.progress = 0
        song.save(update_fields=["status", "status_message", "progress", "updated_at"])
        enqueue_analysis(song.pk)
        return Response(SongSerializer(song).data, status=status.HTTP_202_ACCEPTED)


class SongPlayedView(APIView):
    def post(self, request, pk):
        updated = owned_songs(request).filter(pk=pk).update(last_played_at=timezone.now())
        if not updated:
            raise Http404
        return Response(status=status.HTTP_204_NO_CONTENT)
