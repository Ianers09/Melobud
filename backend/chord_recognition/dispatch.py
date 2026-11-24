"""Queue song analysis on Celery/Redis when available, otherwise in-process.

The in-process fallback keeps the app usable on a machine without Redis.
It runs one analysis at a time on a background thread, so requests are never
blocked, but queued work is lost if the Django process restarts (the song is
then marked failed and can be re-analyzed).
"""
import logging
import os
import subprocess
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor

from django.conf import settings
from django.db import close_old_connections, transaction

logger = logging.getLogger(__name__)

_executor = None
_executor_lock = threading.Lock()
_broker_cache = {"checked_at": 0.0, "ok": False}


def broker_available() -> bool:
    if not settings.REDIS_URL:
        return False
    now = time.monotonic()
    if now - _broker_cache["checked_at"] < 15:
        return _broker_cache["ok"]
    ok = False
    try:
        import redis

        client = redis.Redis.from_url(settings.REDIS_URL, socket_connect_timeout=0.5, socket_timeout=0.5)
        ok = bool(client.ping())
    except Exception:  # noqa: BLE001
        ok = False
    _broker_cache.update(checked_at=now, ok=ok)
    return ok


def _run_isolated(song_id):
    """Analyze in a child process so an out-of-memory kill cannot take the site down."""
    from songs.models import Song

    from .services import mark_failed

    env = {**os.environ, "OMP_NUM_THREADS": os.environ.get("OMP_NUM_THREADS", "1")}
    manage = settings.BASE_DIR / "manage.py"
    result = subprocess.run([sys.executable, str(manage), "analyze_song", str(song_id)], env=env, check=False)
    if result.returncode != 0:
        killed = result.returncode in (-9, 137)
        logger.error("Analysis process for song %s exited with %s", song_id, result.returncode)
        still_running = Song.objects.filter(pk=song_id, status__in=[Song.STATUS_PENDING, Song.STATUS_PROCESSING])
        if still_running.exists():
            mark_failed(
                song_id,
                "The server ran out of memory while analyzing this song."
                if killed
                else "The analysis could not be completed. Please try again.",
            )


def _run_in_thread(song_id):
    from .services import run_analysis

    close_old_connections()
    try:
        if settings.ANALYSIS_IN_SUBPROCESS:
            _run_isolated(song_id)
        else:
            run_analysis(song_id)
    finally:
        close_old_connections()


def _get_executor():
    global _executor
    with _executor_lock:
        if _executor is None:
            _executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="melobud-analysis")
        return _executor


def enqueue_analysis(song_id) -> str:
    """Schedule analysis after the current transaction commits. Returns the backend used."""
    if broker_available():
        from .tasks import analyze_song

        transaction.on_commit(lambda: analyze_song.delay(song_id))
        return "celery"
    transaction.on_commit(lambda: _get_executor().submit(_run_in_thread, song_id))
    return "in-process"
