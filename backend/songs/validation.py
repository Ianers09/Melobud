"""MP3 upload validation: extension, size, container signature and decodability."""
from dataclasses import dataclass
from pathlib import Path

from django.conf import settings
from mutagen import MutagenError
from mutagen.mp3 import MP3, HeaderNotFoundError


class InvalidAudio(Exception):
    def __init__(self, message, code="invalid_file"):
        super().__init__(message)
        self.message = message
        self.code = code


@dataclass
class AudioInfo:
    duration: float
    title: str
    artist: str


def _first_tag(tags, *keys):
    if not tags:
        return ""
    for key in keys:
        frame = tags.get(key)
        if frame is not None:
            text = getattr(frame, "text", None)
            value = str(text[0] if text else frame).strip()
            if value:
                return value[:200]
    return ""


def validate_mp3(uploaded_file) -> AudioInfo:
    name = uploaded_file.name or ""
    if Path(name).suffix.lower() != ".mp3":
        raise InvalidAudio("Unsupported file type. Please upload an MP3 file.", "unsupported_type")
    max_bytes = settings.MAX_UPLOAD_MB * 1024 * 1024
    if uploaded_file.size > max_bytes:
        raise InvalidAudio(f"The file exceeds the {settings.MAX_UPLOAD_MB} MB size limit.", "file_too_large")
    if uploaded_file.size < 1024:
        raise InvalidAudio("The file is too small to contain a song.", "file_too_small")

    uploaded_file.seek(0)
    head = uploaded_file.read(3)
    uploaded_file.seek(0)
    is_id3 = head == b"ID3"
    is_frame_sync = len(head) >= 2 and head[0] == 0xFF and (head[1] & 0xE0) == 0xE0
    if not (is_id3 or is_frame_sync):
        raise InvalidAudio("The file is not a valid MP3 audio file.", "unsupported_type")

    try:
        audio = MP3(uploaded_file)
    except (HeaderNotFoundError, MutagenError):
        raise InvalidAudio("The audio in this file could not be read. The file may be damaged.", "corrupt_file")
    finally:
        uploaded_file.seek(0)

    duration = float(audio.info.length or 0)
    if duration < 5:
        raise InvalidAudio("Songs must be at least 5 seconds long.", "too_short")
    if duration > 20 * 60:
        raise InvalidAudio("Songs longer than 20 minutes are not supported.", "too_long")

    return AudioInfo(
        duration=duration,
        title=_first_tag(audio.tags, "TIT2"),
        artist=_first_tag(audio.tags, "TPE1", "TPE2"),
    )
