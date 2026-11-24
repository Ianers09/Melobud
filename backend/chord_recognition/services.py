"""Runs the audio engine for a stored song and persists the results."""
import logging

from django.db import transaction
from django.utils import timezone

from songs.models import Song

from .models import ChordAnalysis, ChordSegment

logger = logging.getLogger(__name__)

STALE_AFTER_SECONDS = 30 * 60


def _update(song_id, **fields):
    Song.objects.filter(pk=song_id).update(updated_at=timezone.now(), **fields)


def chord_summary(segments):
    """Distinct chords ranked by how long they sound in the song (N.C. and unknown excluded)."""
    totals = {"simple": {}, "full": {}}
    for seg in segments:
        if seg.label_raw in ("N", "X"):
            continue
        length = seg.end - seg.start
        totals["simple"][seg.simple] = totals["simple"].get(seg.simple, 0.0) + length
        totals["full"][seg.label] = totals["full"].get(seg.label, 0.0) + length
    return {kind: sorted(values, key=values.get, reverse=True) for kind, values in totals.items()}


def run_analysis(song_id):
    # Imported here so the web process never loads PyTorch (memory) unless it analyzes.
    from audio_engine.analyze import AnalysisError, analyze_file

    song = Song.objects.filter(pk=song_id).first()
    if song is None:
        logger.info("Song %s was deleted before analysis started", song_id)
        return
    _update(
        song_id,
        status=Song.STATUS_PROCESSING,
        status_message="Loading audio",
        progress=5,
        analysis_started_at=timezone.now(),
        analysis_finished_at=None,
    )

    def progress(percent, message):
        _update(song_id, progress=int(percent), status_message=message[:300])

    try:
        result = analyze_file(song.audio.path, progress=progress)
    except AnalysisError as exc:
        logger.warning("Analysis of song %s failed: %s", song_id, exc)
        _update(song_id, status=Song.STATUS_FAILED, status_message=str(exc)[:300], analysis_finished_at=timezone.now())
        return
    except Exception:  # noqa: BLE001
        logger.exception("Unexpected analysis failure for song %s", song_id)
        _update(
            song_id,
            status=Song.STATUS_FAILED,
            status_message="The analysis could not be completed. Please try again.",
            analysis_finished_at=timezone.now(),
        )
        return

    with transaction.atomic():
        song = Song.objects.select_for_update().filter(pk=song_id).first()
        if song is None:
            return
        ChordAnalysis.objects.filter(song=song).delete()
        analysis = ChordAnalysis.objects.create(
            song=song,
            chord_model=result.chord_model,
            beat_model=result.beat_model,
            device=result.device,
            key=result.key or "",
            key_source=result.key_source or "",
            tuning_cents=result.tuning_cents,
            tempo_bpm=result.tempo_bpm,
            beats=result.beats,
            downbeats=result.downbeats,
            beats_per_bar=result.beats_per_bar,
            meter_confidence=result.meter_confidence,
            processing_seconds=result.processing_seconds,
            summary=chord_summary(result.segments),
        )
        ChordSegment.objects.bulk_create(
            [
                ChordSegment(
                    analysis=analysis,
                    position=i,
                    start=seg.start,
                    end=seg.end,
                    label_raw=seg.label_raw,
                    label=seg.label,
                    simple=seg.simple,
                    confidence=seg.confidence,
                    simple_confidence=seg.simple_confidence,
                )
                for i, seg in enumerate(result.segments)
            ]
        )
        song.status = Song.STATUS_COMPLETED
        song.status_message = ""
        song.progress = 100
        song.duration = result.duration or song.duration
        song.analysis_finished_at = timezone.now()
        song.save()
    logger.info("Song %s analyzed in %.1fs (%d segments)", song_id, result.processing_seconds, len(result.segments))


def mark_stale_jobs_failed(queryset):
    """Jobs whose worker died (e.g. server restart) are surfaced as failures, not left spinning."""
    cutoff = timezone.now() - timezone.timedelta(seconds=STALE_AFTER_SECONDS)
    message = "The analysis was interrupted. Please try again."
    queryset.filter(status=Song.STATUS_PROCESSING, analysis_started_at__lt=cutoff).update(
        status=Song.STATUS_FAILED, status_message=message
    )
    queryset.filter(status=Song.STATUS_PENDING, updated_at__lt=cutoff).update(
        status=Song.STATUS_FAILED, status_message=message
    )


def mark_failed(song_id, message):
    _update(song_id, status=Song.STATUS_FAILED, status_message=message[:300], analysis_finished_at=timezone.now())
