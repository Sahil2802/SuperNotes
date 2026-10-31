"""Segmented 16 kHz mono capture via WASAPI (mic, loopback, or both mixed)."""
import queue
import threading
import time
import wave
from pathlib import Path

import numpy as np
import pyaudiowpatch as pa

RATE = 16000
SEGMENT_SEC = 60
BLOCK = 0.1  # seconds per mixing block


class RecorderError(Exception):
    pass


def _resample(x: np.ndarray, src: int) -> np.ndarray:
    if src == RATE or len(x) == 0:
        return x
    n = int(len(x) * RATE / src)
    return np.interp(np.linspace(0, len(x) - 1, n), np.arange(len(x)), x).astype(np.float32)


class _Input:
    """One opened device -> queue of mono float32 blocks at 16 kHz."""

    def __init__(self, p: pa.PyAudio, dev: dict):
        self.q: queue.Queue = queue.Queue()
        self.ch = int(dev["maxInputChannels"])
        self.rate = int(dev["defaultSampleRate"])
        self.failed = False

        def cb(data, frames, t, status):
            x = np.frombuffer(data, np.int16).reshape(-1, self.ch).mean(axis=1) / 32768.0
            self.q.put(_resample(x.astype(np.float32), self.rate))
            return (None, pa.paContinue)

        self.stream = p.open(format=pa.paInt16, channels=self.ch, rate=self.rate, input=True,
                             input_device_index=dev["index"], frames_per_buffer=int(self.rate * BLOCK),
                             stream_callback=cb)

    def close(self):
        self.stream.stop_stream()
        self.stream.close()


class Recorder:
    def __init__(self, source: str, out_dir: Path, on_level=None):
        self.source, self.out_dir, self.on_level = source, out_dir, on_level
        self.error: str | None = None
        self.seconds = 0.0
        self._closed = False
        self._stop = threading.Event()
        self.paused = False
        if source not in ("mic", "loopback", "both"):
            raise RecorderError(f"unknown source {source!r}")
        self._p = pa.PyAudio()
        self._inputs: list[_Input] = []
        try:
            if source in ("mic", "both"):
                self._inputs.append(_Input(self._p, self._p.get_default_input_device_info()))
            if source in ("loopback", "both"):
                self._inputs.append(_Input(self._p, self._p.get_default_wasapi_loopback()))
        except (OSError, LookupError) as e:
            self._close()
            raise RecorderError(f"No usable audio device ({e})") from e
        self._bufs = [[] for _ in self._inputs]
        self._t0, self._emitted = time.monotonic(), 0
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()

    def _close(self):
        if self._closed:
            return
        self._closed = True
        for i in self._inputs:
            try:
                i.close()
            except OSError:
                pass
        self._p.terminate()

    def _block(self) -> np.ndarray:
        # Wall-clock paced: loopback emits nothing while the system is silent, so each input is
        # drained into a buffer and padded with silence to the elapsed time.
        time.sleep(BLOCK)
        want = int((time.monotonic() - self._t0) * RATE) - self._emitted
        parts = []
        for i, buf in zip(self._inputs, self._bufs):
            if not i.stream.is_active():
                raise OSError("audio device disconnected")
            while not i.q.empty():
                buf.append(i.q.get_nowait())
            x = np.concatenate(buf) if buf else np.zeros(0, np.float32)
            buf.clear()
            if len(x) >= want:
                buf.append(x[want:][-RATE:])  # keep at most 1 s of backlog
                x = x[:want]
            parts.append(np.pad(x, (0, want - len(x))))
        self._emitted += want
        mix = sum(parts) / len(parts) * (1 if len(parts) == 1 else 1.5)
        return np.clip(mix, -1, 1)

    def _run(self):
        seg, w, written = 0, None, 0
        try:
            while not self._stop.is_set():
                if self.paused:
                    t = time.monotonic()
                    time.sleep(BLOCK)
                    self._t0 += time.monotonic() - t  # paused time doesn't count toward the wall clock
                    for i, buf in zip(self._inputs, self._bufs):
                        buf.clear()
                        while not i.q.empty():
                            i.q.get_nowait()
                    continue
                x = self._block()
                if w is None:
                    w = wave.open(str(self.out_dir / f"seg_{seg:05d}.wav"), "wb")
                    w.setnchannels(1); w.setsampwidth(2); w.setframerate(RATE)
                w.writeframes((x * 32767).astype(np.int16).tobytes())
                written += len(x)
                self.seconds += len(x) / RATE
                if self.on_level:
                    self.on_level(float(np.sqrt(np.mean(x**2))) if len(x) else 0.0)
                if written >= SEGMENT_SEC * RATE:
                    w.close(); w, written, seg = None, 0, seg + 1
        except Exception as e:  # disk full, device unplugged: keep what's saved
            self.error = f"{type(e).__name__}: {e}"
        finally:
            if w:
                w.close()
            if self.error:
                self._close()  # release the mic; otherwise the callbacks queue audio forever

    def stop(self) -> float:
        self._stop.set()
        self._thread.join(timeout=5)
        self._close()
        return self.seconds
