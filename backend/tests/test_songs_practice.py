
import pytest
from django.conf import settings
from django.core.files.uploadedfile import SimpleUploadedFile

from chord_recognition.models import ChordAnalysis, ChordSegment
from songs.models import Song


pytestmark = pytest.mark.django_db

EXAMPLE_MP3 = settings.BTC_DIR / "test" / "example.mp3"


def mp3_upload(name="My Song.mp3"):
    return SimpleUploadedFile(name, EXAMPLE_MP3.read_bytes(), content_type="audio/mpeg")


def upload(client, file=None, **extra):
    return client.post("/api/songs/", {"file": file or mp3_upload(), **extra}, format="multipart")


def make_analysed_song(owner, segments):
    song = Song.objects.create(
        owner=owner, title="Test song", audio="audio/x.mp3", original_filename="x.mp3", file_size=1, duration=20, status="completed"
    )
    analysis = ChordAnalysis.objects.create(
        song=song, chord_model="BTC", device="cpu", processing_seconds=1, beats=[0.5, 1.0], downbeats=[0.5], summary={"simple": ["C"]}
    )
    for i, (start, end, raw, label, simple) in enumerate(segments):
        ChordSegment.objects.create(analysis=analysis, position=i, start=start, end=end, label_raw=raw, label=label, simple=simple, confidence=0.8, simple_confidence=0.9)
    return song


def test_upload_valid_mp3_creates_pending_song(authed, user):
    r = upload(authed, artist="Someone")
    assert r.status_code == 201, r.content
    data = r.json()
    assert data["status"] == "pending"
    assert data["artist"] == "Someone"
    assert data["duration"] > 200
    assert data["queue"] in ("in-process", "celery")
    song = Song.objects.get(pk=data["id"])
    assert song.owner == user
    assert song.audio.path.endswith(".mp3")


@pytest.mark.parametrize(
    "file,code",
    [
        (SimpleUploadedFile("song.wav", b"RIFF" + b"\0" * 4000), "unsupported_type"),
        (SimpleUploadedFile("fake.mp3", b"this is not audio" * 200), "unsupported_type"),
        (SimpleUploadedFile("tiny.mp3", b"ID3"), "file_too_small"),
        (SimpleUploadedFile("broken.mp3", b"ID3" + b"\0" * 5000), "corrupt_file"),
    ],
)
def test_upload_rejects_invalid_files(authed, file, code):
    r = upload(authed, file=file)
    assert r.status_code == 400
    assert r.json()["code"] == code
    assert not Song.objects.exists()


def test_upload_rejects_oversize(authed, settings):
    settings.MAX_UPLOAD_MB = 1
    r = upload(authed)
    assert r.json()["code"] == "file_too_large"


def test_users_cannot_see_each_others_songs(authed, other_user):
    theirs = make_analysed_song(other_user, [(0, 5, "C", "C", "C")])
    assert authed.get("/api/songs/").json()["count"] == 0
    for url in (f"/api/songs/{theirs.id}/", f"/api/songs/{theirs.id}/audio/"):
        assert authed.get(url).status_code == 404
    assert authed.delete(f"/api/songs/{theirs.id}/").status_code == 404
    assert authed.post(f"/api/songs/{theirs.id}/reanalyze/").status_code == 404
    assert authed.post("/api/practice/sessions/", {"song": theirs.id, "mode": "step"}, format="json").status_code == 404
    assert Song.objects.filter(pk=theirs.id).exists()


def test_search_sort_rename_delete(authed, user):
    upload(authed, title="Zebra Song")
    upload(authed, title="Apple Tune", artist="Banana")
    titles = [s["title"] for s in authed.get("/api/songs/?sort=title").json()["results"]]
    assert titles == ["Apple Tune", "Zebra Song"]
    assert [s["title"] for s in authed.get("/api/songs/?q=banana").json()["results"]] == ["Apple Tune"]
    song = Song.objects.get(title="Zebra Song")
    assert authed.patch(f"/api/songs/{song.id}/", {"title": "  "}, format="json").status_code == 400
    assert authed.patch(f"/api/songs/{song.id}/", {"title": "Renamed"}, format="json").json()["title"] == "Renamed"
    path = song.audio.path
    assert authed.delete(f"/api/songs/{song.id}/").status_code == 204
    import os

    assert not os.path.exists(path)


def test_audio_supports_http_range(authed):
    song_id = upload(authed).json()["id"]
    size = EXAMPLE_MP3.stat().st_size
    full = authed.get(f"/api/songs/{song_id}/audio/")
    assert full.status_code == 200 and full["Accept-Ranges"] == "bytes" and int(full["Content-Length"]) == size
    part = authed.get(f"/api/songs/{song_id}/audio/", HTTP_RANGE="bytes=100-199")
    assert part.status_code == 206
    assert part["Content-Range"] == f"bytes 100-199/{size}"
    assert b"".join(part.streaming_content) == EXAMPLE_MP3.read_bytes()[100:200]
    assert authed.get(f"/api/songs/{song_id}/audio/", HTTP_RANGE=f"bytes={size + 10}-").status_code == 416


def test_reanalyze_rules(authed, user):
    song = make_analysed_song(user, [(0, 5, "C", "C", "C")])
    song.status = "processing"
    song.save()
    assert authed.post(f"/api/songs/{song.id}/reanalyze/").json()["code"] == "in_progress"
    song.status = "failed"
    song.save()
    assert authed.post(f"/api/songs/{song.id}/reanalyze/").json()["code"] == "missing_audio"


def test_detail_includes_real_timeline(authed, user):
    song = make_analysed_song(user, [(0, 2, "N", "N.C.", "N.C."), (2, 6, "G:maj7", "Gmaj7", "G")])
    data = authed.get(f"/api/songs/{song.id}/").json()
    assert data["analysis"]["segments"][1] == {
        "start": 2.0, "end": 6.0, "raw": "G:maj7", "label": "Gmaj7", "simple": "G", "confidence": 0.8, "simple_confidence": 0.9,
    }


def test_practice_session_records_browser_judged_attempts(authed, user):
    song = make_analysed_song(user, [(0, 1, "N", "N.C.", "N.C."), (1, 6, "C", "C", "C"), (6, 12, "G", "G", "G")])
    session = authed.post("/api/practice/sessions/", {"song": song.id, "mode": "step"}, format="json").json()
    url = f"/api/practice/sessions/{session['id']}/attempts/"

    assert authed.post(url, {"song_time": 3.0, "expected": "C", "detected": "C", "result": "correct"}, format="json").status_code == 201
    assert authed.post(url, {"song_time": 3.2, "expected": "C", "detected": "G", "result": "incorrect"}, format="json").status_code == 201
    # Chords that are not in the song, and unknown results, are rejected.
    assert authed.post(url, {"song_time": 3.0, "expected": "F#", "result": "correct"}, format="json").json()["code"] == "unknown_chord"
    assert authed.post(url, {"song_time": 3.0, "expected": "C", "result": "maybe"}, format="json").status_code == 400

    assert authed.post(url, {"song_time": 7.0, "expected": "G", "result": "missed"}, format="json").status_code == 201
    summary = authed.patch(f"/api/practice/sessions/{session['id']}/", {}, format="json").json()
    assert summary["attempts"] == {"correct": 1, "incorrect": 1, "missed": 1}
    assert summary["ended_at"]
    assert authed.post(url, {"song_time": 3.0, "expected": "C", "result": "correct"}, format="json").json()["code"] == "ended"

    detail = authed.get(f"/api/practice/sessions/{session['id']}/").json()
    assert [t["result"] for t in detail["timeline"]] == ["correct", "incorrect", "missed"]
    assert detail["timeline"][1]["detected"] == "G"


def test_attempts_are_private(authed, other_user):
    song = make_analysed_song(other_user, [(0, 5, "C", "C", "C")])
    from practice.models import PracticeSession

    theirs = PracticeSession.objects.create(user=other_user, song=song, song_title="x", mode="step")
    r = authed.post(f"/api/practice/sessions/{theirs.id}/attempts/", {"song_time": 1, "expected": "C", "result": "correct"}, format="json")
    assert r.status_code == 404


def test_practice_requires_analysed_song(authed, user):
    song = make_analysed_song(user, [(0, 5, "C", "C", "C")])
    song.status = "processing"
    song.save()
    assert authed.post("/api/practice/sessions/", {"song": song.id, "mode": "step"}, format="json").json()["code"] == "not_ready"


def test_history_survives_song_deletion(authed, user):
    song = make_analysed_song(user, [(0, 5, "C", "C", "C")])
    session = authed.post("/api/practice/sessions/", {"song": song.id, "mode": "play_along"}, format="json").json()
    song.delete()
    item = authed.get(f"/api/practice/sessions/{session['id']}/").json()
    assert item["song_title"] == "Test song" and item["song_available"] is False


def test_dashboard_reports_only_real_data(authed, user):
    empty = authed.get("/api/practice/dashboard/").json()
    assert empty["songs"]["total"] == 0 and empty["totals"] == {"sessions": 0, "practice_seconds": 0}
    assert all(d["minutes"] == 0 for d in empty["activity"]) and len(empty["activity"]) == 14
    song = make_analysed_song(user, [(0, 5, "C", "C", "C")])
    authed.post("/api/practice/sessions/", {"song": song.id, "mode": "step"}, format="json")
    data = authed.get("/api/practice/dashboard/").json()
    assert data["songs"]["ready"] == 1 and data["totals"]["sessions"] == 1
    assert data["recently_practiced"][0]["song"]["id"] == song.id


def test_health_endpoint(client, db):
    data = client.get("/api/health/").json()
    assert data["database"]["ok"] is True
    assert data["job_queue"] == "in-process"
