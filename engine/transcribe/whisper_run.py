"""Segments -> audio.wav + transcript.json + transcript.vtt via faster-whisper."""
import gc
import wave
from pathlib import Path

import numpy as np


def merge_segments(seg_dir: Path, out: Path):
    segs = sorted(seg_dir.glob("seg_*.wav"))
    if not segs:
        raise RuntimeError("no audio segments recorded")
    with wave.open(str(out), "wb") as w:
        for i, s in enumerate(segs):
            with wave.open(str(s), "rb") as r:
                if i == 0:
                    w.setparams(r.getparams())
                w.writeframes(r.readframes(r.getnframes()))


def _ts(t: float) -> str:
    h, rem = divmod(t, 3600)
    m, s = divmod(rem, 60)
    return f"{int(h):02d}:{int(m):02d}:{s:06.3f}"


def _add_cuda_dlls():
    """Make the pip-installed cuBLAS/cuDNN DLLs (nvidia-*-cu12 wheels) loadable."""
    import importlib.util
    import os

    spec = importlib.util.find_spec("nvidia")
    for root in (spec.submodule_search_locations if spec else []) or []:
        for b in Path(root).glob("*/bin"):
            os.add_dll_directory(str(b))
            os.environ["PATH"] = f"{b}{os.pathsep}{os.environ['PATH']}"


def _run(pcm, cfg, device, compute, cancelled, progress):
    from faster_whisper import WhisperModel

    model = WhisperModel(cfg["whisper_model"], device=device, compute_type=compute)
    # glossary is best-effort: it mostly conditions the first window
    segs, info = model.transcribe(pcm, initial_prompt=", ".join(cfg["glossary"]) or None, vad_filter=True)
    out = []
    for s in segs:
        if cancelled():
            break
        out.append({"start": round(s.start, 2), "end": round(s.end, 2), "text": s.text.strip()})
        progress(min(s.end / info.duration, 1.0) if info.duration else 0)
    del model, segs  # free VRAM before the LLM stages
    gc.collect()
    return out


def transcribe(audio: Path, cfg: dict, cancelled=lambda: False, progress=lambda f: None) -> list[dict]:
    _add_cuda_dlls()
    device = cfg["whisper_device"]
    if device == "auto":
        try:
            import ctranslate2

            device = "cuda" if ctranslate2.get_cuda_device_count() else "cpu"
        except Exception:
            device = "cpu"
    with wave.open(str(audio), "rb") as w:  # our own 16 kHz mono PCM; skips PyAV decoding
        pcm = np.frombuffer(w.readframes(w.getnframes()), np.int16).astype(np.float32) / 32768.0
    if device == "cuda":
        try:
            return _run(pcm, cfg, "cuda", "int8_float16", cancelled, progress)
        except Exception:  # missing/mismatched CUDA libs: fall back to CPU
            pass
    return _run(pcm, cfg, "cpu", "int8", cancelled, progress)


def write_vtt(segs: list[dict], path: Path):
    lines = ["WEBVTT", ""]
    for s in segs:
        lines += [f"{_ts(s['start'])} --> {_ts(s['end'])}", s["text"], ""]
    path.write_text("\n".join(lines), encoding="utf-8")
