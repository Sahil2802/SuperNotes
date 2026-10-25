"""Single-worker processing queue. Each stage persists its status so a restart resumes."""
import logging
import queue
import threading

from assemble.notepack import notepack_md, write_apkg
from notes.extract import extract
from notes.llm import Cancelled
from notes.summarize import summarize
from store import STAGES, Store
from transcribe.whisper_run import merge_segments, transcribe, write_vtt

log = logging.getLogger(__name__)
IDLE = ("recording", "recorded", "ready", "failed", "cancelled")
BUSY = ("queued", *STAGES)


class Pipeline:
    def __init__(self, store: Store):
        self.store = store
        self.q: queue.Queue = queue.Queue()
        self.current: str | None = None
        self.cancel_ids: set[str] = set()
        threading.Thread(target=self._worker, daemon=True).start()
        for st in store.list():  # resume unfinished lectures
            if st["state"] == "recording":
                store.update(st["id"], state="recorded")  # app died mid-recording; segments are kept
            elif st["state"] not in IDLE:
                self.enqueue(st["id"])

    def enqueue(self, lid: str):
        self.cancel_ids.discard(lid)
        self.store.update(lid, state="queued", error=None)
        self.q.put(lid)

    def cancel(self, lid: str):
        if self.store.get(lid)["state"] not in BUSY:
            return  # nothing running or queued; don't clobber a finished lecture
        self.cancel_ids.add(lid)
        if self.current != lid:  # still queued
            self.store.update(lid, state="cancelled")

    def reset(self, lid: str):
        st = self.store.get(lid)
        d = self.store.dir(lid)
        # audio deleted but transcript kept: re-run only the LLM stages
        keep = not any((d / "segments").glob("seg_*.wav")) and (d / "transcript.json").exists()
        st["stages"] = {s: "done" if keep and s == "transcribe" else "pending" for s in STAGES}
        self.store.save(st)

    def _mark(self, lid: str, **kw):
        # the worker must outlive any single lecture: never let a status write kill it
        try:
            self.store.update(lid, **kw)
        except Exception:
            log.exception("could not record %s for %s", kw.get("state"), lid)

    def _worker(self):
        while True:
            lid = self.q.get()
            if lid in self.cancel_ids:
                self.cancel_ids.discard(lid)
                continue
            self.current = lid
            try:
                self._run(lid)
            except Cancelled:
                self._mark(lid, state="cancelled")
            except Exception as e:
                log.exception("pipeline failed for %s", lid)
                self._mark(lid, state="failed", error=f"{type(e).__name__}: {e}")
            finally:
                self.cancel_ids.discard(lid)
                self.current = None

    def _run(self, lid: str):
        s, d = self.store, self.store.dir(lid)
        cfg = s.config()
        stop = lambda: lid in self.cancel_ids

        def stage(name, fn):
            if s.get(lid)["stages"][name] == "done":
                return
            s.set_stage(lid, name, "running", state=name)
            fn()
            if stop():
                s.set_stage(lid, name, "pending")
                raise Cancelled
            s.set_stage(lid, name, "done")

        def do_transcribe():
            merge_segments(d / "segments", d / "audio.wav")
            segs = transcribe(d / "audio.wav", cfg, stop, lambda f: s.update(lid, progress=round(f, 2)))
            if stop():
                return
            s.write_json(lid, "transcript.json", segs)
            write_vtt(segs, d / "transcript.vtt")

        def do_summarize():
            segs = s.read_json(lid, "transcript.json")
            (d / "summary.md").write_text(summarize(segs, cfg["ollama_model"], stop), encoding="utf-8")

        def do_extract():
            segs = s.read_json(lid, "transcript.json")
            s.write_json(lid, "extract.json", extract(segs, cfg["ollama_model"], stop))

        def do_assemble():
            st, ex, segs = s.get(lid), s.read_json(lid, "extract.json"), s.read_json(lid, "transcript.json")
            summary = (d / "summary.md").read_text(encoding="utf-8")
            (d / "notes.md").write_text(notepack_md(st, summary, segs, ex), encoding="utf-8")
            write_apkg(st, ex["flashcards"], d / "flashcards.apkg")

        stage("transcribe", do_transcribe)
        stage("summarize", do_summarize)
        stage("extract", do_extract)
        stage("assemble", do_assemble)
        s.update(lid, state="ready", progress=1)
