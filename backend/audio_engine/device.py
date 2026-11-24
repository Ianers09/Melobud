import torch
from django.conf import settings


def pick_device() -> str:
    choice = (settings.AUDIO_DEVICE or "auto").lower()
    if choice == "cpu":
        return "cpu"
    if choice == "cuda":
        if not torch.cuda.is_available():
            raise RuntimeError("AUDIO_DEVICE=cuda but no CUDA device is available.")
        return "cuda"
    return "cuda" if torch.cuda.is_available() else "cpu"
