from celery import shared_task

from .services import run_analysis


@shared_task(name="chord_recognition.analyze_song", acks_late=True, max_retries=0)
def analyze_song(song_id):
    run_analysis(song_id)
