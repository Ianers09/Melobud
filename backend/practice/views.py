from collections import defaultdict

from django.db.models import Count, Q
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import serializers, status
from rest_framework.response import Response
from rest_framework.views import APIView

from chord_recognition.models import ChordSegment
from songs.models import Song
from songs.serializers import SongSerializer

from .models import PracticeAttempt, PracticeSession



def session_summary(session, attempts=None):
    attempts = list(session.attempts.all()) if attempts is None else attempts
    counts = {"correct": 0, "incorrect": 0, "missed": 0}
    per_chord = defaultdict(lambda: {"correct": 0, "incorrect": 0, "missed": 0})
    for a in attempts:
        if a.result not in counts:  # legacy "uncertain" rows
            continue
        counts[a.result] += 1
        per_chord[a.expected_chord][a.result] += 1
    return {
        "id": session.id,
        "song_id": session.song_id,
        "song_title": session.song_title,
        "song_artist": session.song_artist,
        "song_available": session.song_id is not None,
        "mode": session.mode,
        "chord_display": session.chord_display,
        "started_at": session.started_at,
        "ended_at": session.ended_at,
        "duration_seconds": round(session.duration_seconds),
        "attempts": counts,
        "chords": [{"chord": chord, **values} for chord, values in per_chord.items()],
    }


class StartSessionSerializer(serializers.Serializer):
    song = serializers.IntegerField()
    mode = serializers.ChoiceField(choices=[c[0] for c in PracticeSession.MODE_CHOICES])


class SessionListView(APIView):
    def get(self, request):
        sessions = (
            PracticeSession.objects.filter(user=request.user)
            .prefetch_related("attempts")
            .order_by("-started_at")[:100]
        )
        return Response({"results": [session_summary(s) for s in sessions]})

    def post(self, request):
        serializer = StartSessionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        song = get_object_or_404(Song, pk=serializer.validated_data["song"], owner=request.user)
        if song.status != Song.STATUS_COMPLETED:
            return Response(
                {"detail": "This song has not finished analyzing yet.", "code": "not_ready"},
                status=status.HTTP_409_CONFLICT,
            )
        session = PracticeSession.objects.create(
            user=request.user,
            song=song,
            song_title=song.title,
            song_artist=song.artist,
            mode=serializer.validated_data["mode"],
            chord_display="simple",
        )
        return Response(session_summary(session, []), status=status.HTTP_201_CREATED)


class SessionDetailView(APIView):
    def get_session(self, request, pk):
        return get_object_or_404(PracticeSession, pk=pk, user=request.user)

    def get(self, request, pk):
        session = self.get_session(request, pk)
        attempts = list(session.attempts.all())
        data = session_summary(session, attempts)
        data["timeline"] = [
            {
                "expected": a.expected_chord,
                "detected": a.detected_chord or None,
                "result": a.result,
                "confidence": a.confidence,
                "song_time": a.song_time,
                "at": a.created_at,
            }
            for a in attempts
        ]
        return Response(data)

    def patch(self, request, pk):
        """End a session. Idempotent."""
        session = self.get_session(request, pk)
        if session.ended_at is None:
            session.ended_at = timezone.now()
            session.save(update_fields=["ended_at"])
        return Response(session_summary(session))

    def delete(self, request, pk):
        self.get_session(request, pk).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class AttemptSerializer(serializers.Serializer):
    song_time = serializers.FloatField(min_value=0)
    expected = serializers.CharField(max_length=24)
    detected = serializers.CharField(max_length=24, allow_blank=True, allow_null=True, required=False)
    result = serializers.ChoiceField(
        choices=[PracticeAttempt.RESULT_CORRECT, PracticeAttempt.RESULT_INCORRECT, PracticeAttempt.RESULT_MISSED]
    )


class AttemptView(APIView):
    """Store one chord's result, judged in the browser (real-time recognition runs client-side)."""

    throttle_scope = "live_eval"

    def post(self, request, pk):
        session = get_object_or_404(PracticeSession, pk=pk, user=request.user)
        if session.ended_at is not None:
            return Response({"detail": "This practice session has ended.", "code": "ended"}, status=409)
        if session.song_id is None:
            return Response({"detail": "This song has been deleted.", "code": "song_deleted"}, status=410)
        serializer = AttemptSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        known = ChordSegment.objects.filter(analysis__song_id=session.song_id, simple=data["expected"]).exists()
        if not known:
            return Response({"detail": "That chord is not part of this song.", "code": "unknown_chord"}, status=400)
        PracticeAttempt.objects.create(
            session=session,
            expected_chord=data["expected"],
            detected_chord=data.get("detected") or "",
            result=data["result"],
            song_time=round(data["song_time"], 3),
        )
        session.last_activity_at = timezone.now()
        session.save(update_fields=["last_activity_at"])
        return Response(status=status.HTTP_201_CREATED)


class DashboardView(APIView):
    def get(self, request):
        user = request.user
        songs = Song.objects.filter(owner=user)
        counts = songs.aggregate(
            total=Count("id"),
            ready=Count("id", filter=Q(status=Song.STATUS_COMPLETED)),
            processing=Count("id", filter=Q(status__in=[Song.STATUS_PENDING, Song.STATUS_PROCESSING])),
            failed=Count("id", filter=Q(status=Song.STATUS_FAILED)),
        )
        recent_uploads = songs.select_related("analysis").order_by("-created_at")[:5]

        sessions = list(
            PracticeSession.objects.filter(user=user).prefetch_related("attempts").order_by("-started_at")[:200]
        )
        recently_practiced, seen = [], set()
        for s in sessions:
            if s.song_id and s.song_id not in seen:
                seen.add(s.song_id)
                recently_practiced.append(s)
            if len(recently_practiced) == 5:
                break
        practiced_songs = {
            song.id: song
            for song in songs.select_related("analysis").filter(id__in=[s.song_id for s in recently_practiced])
        }

        today = timezone.localdate()
        days = [today - timezone.timedelta(days=i) for i in range(13, -1, -1)]
        minutes = {d: 0.0 for d in days}
        for s in sessions:
            day = timezone.localtime(s.started_at).date()
            if day in minutes:
                minutes[day] += s.duration_seconds / 60.0

        totals = {"sessions": len(sessions), "practice_seconds": round(sum(s.duration_seconds for s in sessions))}
        # Accuracy over every judged attempt (correct / correct + incorrect + missed).
        judged = correct = 0
        for s in sessions:
            for a in s.attempts.all():
                if a.result in ("correct", "incorrect", "missed"):
                    judged += 1
                    correct += a.result == "correct"
        totals["accuracy"] = round(correct / judged, 4) if judged else None
        return Response(
            {
                "songs": counts,
                "recent_uploads": SongSerializer(recent_uploads, many=True).data,
                "recently_practiced": [
                    {
                        "session": session_summary(s),
                        "song": SongSerializer(practiced_songs[s.song_id]).data if s.song_id in practiced_songs else None,
                    }
                    for s in recently_practiced
                ],
                "recent_sessions": [session_summary(s) for s in sessions[:5]],
                "activity": [{"date": d.isoformat(), "minutes": round(minutes[d], 1)} for d in days],
                "totals": totals,
            }
        )
