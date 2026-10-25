"""Lecture metadata + per-stage status, persisted as <data_dir>/lectures/<id>/status.json."""
from __future__ import annotations

import json
import shutil
import threading
import time
import uuid
from datetime import date, timedelta
from pathlib import Path

import yaml

import cards as cardlib

STAGES = ["transcribe", "summarize", "extract", "assemble"]
DEFAULT_CONFIG = {
    "whisper_model": "small",
    "whisper_device": "auto",  # auto | cuda | cpu
    "ollama_model": "llama3.1:8b",
    "glossary": [],
    "new_cards_per_day": 20,
}


class Store:
    def __init__(self, data_dir: Path):
        self._lock = threading.RLock()  # status.json is read-modify-written from the worker, the API and the UI polls
        self.root = data_dir / "lectures"
        self.root.mkdir(parents=True, exist_ok=True)
        self.config_path = data_dir / "config.yaml"
        if not self.config_path.exists():
            self.config_path.write_text(yaml.safe_dump(DEFAULT_CONFIG))

    def config(self) -> dict:
        return {**DEFAULT_CONFIG, **(yaml.safe_load(self.config_path.read_text()) or {})}

    def dir(self, lid: str) -> Path:
        d = (self.root / lid).resolve()
        if d.parent != self.root.resolve():
            raise KeyError(lid)
        return d

    def create(self, source: str, course: str | None) -> dict:
        lid = time.strftime("%Y%m%d-%H%M%S-") + uuid.uuid4().hex[:4]
        (self.dir(lid) / "segments").mkdir(parents=True)
        st = {
            "id": lid, "title": time.strftime("Lecture %Y-%m-%d %H:%M"), "course": course,
            "source": source, "created": time.time(), "duration": 0.0,
            "state": "recording",  # recording | recorded | queued | <stage> | ready | failed | cancelled
            "stages": {s: "pending" for s in STAGES}, "error": None,
        }
        self.save(st)
        return st

    def save(self, st: dict):
        with self._lock:
            p = self.dir(st["id"]) / "status.json"
            self._atomic(p, json.dumps(st, indent=2))

    def _atomic(self, p: Path, text: str):
        tmp = p.with_suffix(".tmp")
        tmp.write_text(text, encoding="utf-8")
        for attempt in range(5):  # Windows: antivirus/indexers can briefly hold the target
            try:
                tmp.replace(p)
                return
            except PermissionError:
                if attempt == 4:
                    raise
                time.sleep(0.05)

    def get(self, lid: str) -> dict:
        with self._lock:
            try:
                return json.loads((self.dir(lid) / "status.json").read_text())
            except (OSError, ValueError, KeyError):
                raise KeyError(lid)

    def update(self, lid: str, **kw) -> dict:
        with self._lock:
            st = self.get(lid)
            st.update(kw)
            self.save(st)
            return st

    def set_stage(self, lid: str, stage: str, value: str, **kw) -> dict:
        with self._lock:
            st = self.get(lid)
            st["stages"][stage] = value
            st.update(kw)
            self.save(st)
            return st

    def list(self) -> list[dict]:
        out = []
        with self._lock:
            for d in self.root.iterdir():
                try:
                    out.append(json.loads((d / "status.json").read_text()))
                except (OSError, ValueError):
                    pass
        return sorted(out, key=lambda s: s["created"], reverse=True)

    def delete(self, lid: str):
        with self._lock:
            shutil.rmtree(self.dir(lid))

    def read_json(self, lid: str, name: str, default=None):
        try:
            return json.loads((self.dir(lid) / name).read_text(encoding="utf-8"))
        except OSError:
            return default

    def write_json(self, lid: str, name: str, obj):
        (self.dir(lid) / name).write_text(json.dumps(obj, indent=2, ensure_ascii=False), encoding="utf-8")

    def _cards_file(self, lid: str) -> dict:
        f = self.read_json(lid, "cards.json")
        if f is None:
            f = {"cards": [], "seen": []}
            ex = self.read_json(lid, "extract.json")
            if ex:
                cardlib.merge(f, ex["flashcards"])
        return f

    def cards(self, lid: str) -> list[dict]:
        with self._lock:
            f = self._cards_file(lid)
            if self.read_json(lid, "cards.json") is None and f["cards"]:
                self._atomic(self.dir(lid) / "cards.json", json.dumps(f, indent=2, ensure_ascii=False))
            return f["cards"]

    def edit_cards(self, lid: str, fn):
        """Run fn(file) on {"cards", "seen"} under the lock and save the result; returns fn's return value."""
        with self._lock:
            f = self._cards_file(lid)
            out = fn(f)
            self._atomic(self.dir(lid) / "cards.json", json.dumps(f, indent=2, ensure_ascii=False))
            return out

    def sync_cards(self, lid: str):
        ex = self.read_json(lid, "extract.json") or {"flashcards": []}
        self.edit_cards(lid, lambda f: cardlib.merge(f, ex["flashcards"]))

    def _review(self) -> dict:
        try:
            r = json.loads((self.root.parent / "review.json").read_text())
        except (OSError, ValueError):
            r = {}
        today = date.today().isoformat()
        return {**r, "new": r.get("new", 0)} if r.get("date") == today else {**r, "date": today, "new": 0}

    def new_today(self) -> int:
        with self._lock:
            return self._review()["new"]

    def add_new_today(self, n: int = 1):
        with self._lock:
            r = self._review()
            r["new"] += n
            self._atomic(self.root.parent / "review.json", json.dumps(r))

    def profile(self) -> dict | None:
        try:
            return json.loads((self.root.parent / "profile.json").read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return None

    def set_profile(self, name: str, subjects: list[str]):
        with self._lock:
            self._atomic(self.root.parent / "profile.json", json.dumps({"name": name, "subjects": subjects}, ensure_ascii=False))

    def mark_reviewed(self, new: int = 0):
        with self._lock:
            r = self._review()
            r["new"] += new
            r["days"] = sorted({*r.get("days", []), r["date"]})
            r["counts"] = {**r.get("counts", {}), r["date"]: r.get("counts", {}).get(r["date"], 0) + 1}
            self._atomic(self.root.parent / "review.json", json.dumps(r))

    def days(self) -> dict[str, int]:
        """Reviewed date -> cards answered. 0 for days recorded before counts existed."""
        with self._lock:
            r = self._review()
        return {d: r.get("counts", {}).get(d, 0) for d in r.get("days", [])}

    def streak(self) -> int:
        """Consecutive days with a review, ending today (or yesterday, so it survives until you miss a full day)."""
        with self._lock:
            days = set(self._review().get("days", []))
        d = date.today()
        if d.isoformat() not in days:
            d -= timedelta(days=1)
        n = 0
        while d.isoformat() in days:
            n, d = n + 1, d - timedelta(days=1)
        return n
