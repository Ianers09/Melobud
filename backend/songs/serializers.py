from rest_framework import serializers

from chord_recognition.models import ChordAnalysis

from .models import Song


class SongSerializer(serializers.ModelSerializer):
    chords = serializers.SerializerMethodField()

    class Meta:
        model = Song
        fields = [
            "id",
            "title",
            "artist",
            "original_filename",
            "file_size",
            "duration",
            "status",
            "status_message",
            "progress",
            "created_at",
            "analysis_finished_at",
            "last_played_at",
            "chords",
        ]
        read_only_fields = [f for f in fields if f not in ("title", "artist")]

    def validate_title(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError("Title can't be empty.")
        return value

    def validate_artist(self, value):
        return value.strip()

    def get_chords(self, song):
        analysis = getattr(song, "analysis", None) if song.status == Song.STATUS_COMPLETED else None
        if analysis is None:
            return None
        return analysis.summary or None


class AnalysisSerializer(serializers.ModelSerializer):
    segments = serializers.SerializerMethodField()

    class Meta:
        model = ChordAnalysis
        fields = [
            "chord_model",
            "beat_model",
            "device",
            "key",
            "key_source",
            "tuning_cents",
            "tempo_bpm",
            "beats",
            "downbeats",
            "beats_per_bar",
            "meter_confidence",
            "processing_seconds",
            "summary",
            "created_at",
            "segments",
        ]

    def get_segments(self, analysis):
        return [
            {
                "start": s.start,
                "end": s.end,
                "raw": s.label_raw,
                "label": s.label,
                "simple": s.simple,
                "confidence": s.confidence,
                "simple_confidence": s.simple_confidence,
            }
            for s in analysis.segments.all()
        ]


class SongDetailSerializer(SongSerializer):
    analysis = serializers.SerializerMethodField()

    class Meta(SongSerializer.Meta):
        fields = SongSerializer.Meta.fields + ["analysis"]
        read_only_fields = SongSerializer.Meta.read_only_fields + ["analysis"]

    def get_analysis(self, song):
        if song.status != Song.STATUS_COMPLETED:
            return None
        analysis = getattr(song, "analysis", None)
        return AnalysisSerializer(analysis).data if analysis else None


class UploadSerializer(serializers.Serializer):
    file = serializers.FileField(allow_empty_file=False)
    title = serializers.CharField(max_length=200, required=False, allow_blank=True)
    artist = serializers.CharField(max_length=200, required=False, allow_blank=True)
