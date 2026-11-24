from django.core.management.base import BaseCommand

from chord_recognition.services import run_analysis


class Command(BaseCommand):
    help = "Analyze one song (used to run each analysis in its own process)."

    def add_arguments(self, parser):
        parser.add_argument("song_id", type=int)

    def handle(self, *args, song_id, **options):
        run_analysis(song_id)
