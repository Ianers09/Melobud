"""BTC (Bi-directional Transformer for Chord recognition, Park et al., ISMIR 2019).

Wraps the vendored reference implementation in vendor/BTC (MIT licence)
without modifying it. Differences from the repo's test.py, and why:

* run_config.yaml is read with yaml.safe_load: the repo's HParams.load calls
  yaml.load(f) without a Loader, which raises on PyYAML >= 6.
* np.float/np.int/np.bool (removed in NumPy 1.24) are restored as the builtin
  aliases they always were, before the vendored modules are imported.
* Feature extraction is identical (CQT, 144 bins, 24 bins/octave, hop 2048 at
  22050 Hz, computed in 10 s blocks, log-magnitude) but runs on an
  already-decoded signal so the audio is decoded only once.
* Inference uses overlapping 108-frame windows (50% hop) and averages the
  softmax probabilities. test.py uses non-overlapping windows, which gives the
  frames at every window edge almost no context on one side.
* The full per-frame probability matrix is returned (test.py keeps only the
  argmax) so later stages can smooth over time and report real confidences.
"""
import sys
import threading
from dataclasses import dataclass

import librosa
import numpy as np
import torch
import yaml
from django.conf import settings

from .device import pick_device

_lock = threading.Lock()
_models = {}


@dataclass
class BTCOutput:
    probs: np.ndarray  # (frames, classes), rows sum to 1
    frame_seconds: float
    labels: list
    device: str


def _vendor_imports():
    # BTC (2019) uses np.float / np.int / np.bool, which NumPy 1.24 removed.
    # They were plain aliases of the builtins, so restoring them is exact and
    # avoids pinning an old NumPy that librosa/PyTorch no longer support.
    for alias, builtin in (("float", float), ("int", int), ("bool", bool)):
        if not hasattr(np, alias):
            setattr(np, alias, builtin)
    btc_dir = str(settings.BTC_DIR)
    if btc_dir not in sys.path:
        sys.path.insert(0, btc_dir)
    from btc_model import BTC_model  # noqa: E402
    from utils.mir_eval_modules import idx2chord, idx2voca_chord  # noqa: E402

    return BTC_model, idx2chord, idx2voca_chord


class BTCRecognizer:
    SAMPLE_RATE = 22050

    def __init__(self, large_vocabulary=True, device=None):
        BTC_model, idx2chord, idx2voca_chord = _vendor_imports()
        with open(settings.BTC_DIR / "run_config.yaml", "r", encoding="utf-8") as f:
            config = yaml.safe_load(f)
        self.mp3_cfg = config["mp3"]
        self.feature_cfg = config["feature"]
        model_cfg = dict(config["model"])
        if large_vocabulary:
            self.feature_cfg["large_voca"] = True
            model_cfg["num_chords"] = 170
            checkpoint_path = settings.BTC_DIR / "test" / "btc_model_large_voca.pt"
            mapping = idx2voca_chord()
            self.labels = [mapping[i] for i in range(170)]
            self.name = "BTC-ISMIR19 (large vocabulary, 170 classes)"
        else:
            checkpoint_path = settings.BTC_DIR / "test" / "btc_model.pt"
            self.labels = list(idx2chord)
            self.name = "BTC-ISMIR19 (major/minor, 25 classes)"
        self.timestep = model_cfg["timestep"]
        self.device = torch.device(device or pick_device())

        # The checkpoint is a dict holding the state_dict plus numpy mean/std
        # arrays used for normalisation, so it cannot be loaded with
        # weights_only=True. It ships inside the vendored, pinned repository.
        checkpoint = torch.load(checkpoint_path, map_location=self.device, weights_only=False)
        self.mean = float(np.asarray(checkpoint["mean"]))
        self.std = float(np.asarray(checkpoint["std"]))
        self.model = BTC_model(config=model_cfg).to(self.device)
        self.model.load_state_dict(checkpoint["model"])
        self.model.eval()

    # -- features --------------------------------------------------------------
    def features(self, wav, tuning=0.0):
        """Log-CQT exactly as utils.mir_eval_modules.audio_file_to_features computes it."""
        sr = self.SAMPLE_RATE
        block = int(sr * self.mp3_cfg["inst_len"])
        cqt_kwargs = dict(
            sr=sr,
            n_bins=self.feature_cfg["n_bins"],
            bins_per_octave=self.feature_cfg["bins_per_octave"],
            hop_length=self.feature_cfg["hop_length"],
            tuning=tuning,
        )
        parts = []
        pos = 0
        while len(wav) > pos + block:
            parts.append(librosa.cqt(wav[pos : pos + block], **cqt_kwargs))
            pos += block
        parts.append(librosa.cqt(wav[pos:], **cqt_kwargs))
        feature = np.concatenate(parts, axis=1)
        feature = np.log(np.abs(feature) + 1e-6)
        frame_seconds = self.mp3_cfg["inst_len"] / self.timestep
        return feature.T.astype(np.float32), frame_seconds

    # -- inference ---------------------------------------------------------------
    @torch.no_grad()
    def predict(self, wav, batch_size=64, tuning=0.0) -> BTCOutput:
        feature, frame_seconds = self.features(wav, tuning=tuning)
        feature = (feature - self.mean) / self.std
        n_frames = feature.shape[0]
        T = self.timestep
        hop = T // 2

        starts = list(range(0, max(n_frames - T, 0) + 1, hop))
        if not starts or starts[-1] + T < n_frames:
            starts.append(max(n_frames - T, 0))
        padded_len = max(n_frames, starts[-1] + T)
        padded = np.zeros((padded_len, feature.shape[1]), dtype=np.float32)
        padded[:n_frames] = feature

        n_classes = len(self.labels)
        acc = np.zeros((padded_len, n_classes), dtype=np.float64)
        weight = np.zeros((padded_len, 1), dtype=np.float64)
        # Down-weight window edges, where the transformer has one-sided context.
        taper = np.hanning(T + 2)[1:-1].reshape(-1, 1) + 1e-3

        for i in range(0, len(starts), batch_size):
            batch_starts = starts[i : i + batch_size]
            windows = np.stack([padded[s : s + T] for s in batch_starts])
            x = torch.from_numpy(windows).to(self.device)
            hidden, _ = self.model.self_attn_layers(x)
            logits = self.model.output_layer.output_projection(hidden)
            probs = torch.softmax(logits, dim=-1).float().cpu().numpy()
            for s, p in zip(batch_starts, probs):
                acc[s : s + T] += p * taper
                weight[s : s + T] += taper

        probs = (acc / np.maximum(weight, 1e-9))[:n_frames]
        probs /= probs.sum(axis=1, keepdims=True)
        return BTCOutput(probs=probs.astype(np.float32), frame_seconds=frame_seconds, labels=self.labels, device=str(self.device.type))


def get_recognizer(large_vocabulary=True) -> BTCRecognizer:
    with _lock:
        key = bool(large_vocabulary)
        if key not in _models:
            _models[key] = BTCRecognizer(large_vocabulary=key)
        return _models[key]
