import shutil
from pathlib import Path

from django.conf import settings


def delete_user_audio(user_id):
    folder = Path(settings.MEDIA_ROOT) / "audio" / str(int(user_id))
    if folder.is_dir():
        shutil.rmtree(folder, ignore_errors=True)
