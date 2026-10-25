"""Lecture metadata + per-stage status, persisted as <data_dir>/lectures/<id>/status.json."""
import json
import shutil
import time
import uuid
from pathlib import Path

import yaml

STAGES = ["transcribe", "summarize", "extract", "assemble"]
DEFAULT_CONFIG = {
    "whisper_model": "small",
    "whisper_device": "auto",  # auto | cuda | cpu
    "ollama_model": "llama3.1:8b",
    "glossary": [],
}


class Store:
    def __init__(self, data_dir: Path):
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
        p = self.dir(st["id"]) / "status.json"
        tmp = p.with_suffix(".tmp")
        tmp.write_text(json.dumps(st, indent=2))
        tmp.replace(p)

    def get(self, lid: str) -> dict:
        try:
            return json.loads((self.dir(lid) / "status.json").read_text())
        except (OSError, KeyError):
            raise KeyError(lid)

    def update(self, lid: str, **kw) -> dict:
        st = self.get(lid)
        st.update(kw)
        self.save(st)
        return st

    def set_stage(self, lid: str, stage: str, value: str, **kw) -> dict:
        st = self.get(lid)
        st["stages"][stage] = value
        st.update(kw)
        self.save(st)
        return st

    def list(self) -> list[dict]:
        out = []
        for d in self.root.iterdir():
            try:
                out.append(json.loads((d / "status.json").read_text()))
            except (OSError, ValueError):
                pass
        return sorted(out, key=lambda s: s["created"], reverse=True)

    def delete(self, lid: str):
        shutil.rmtree(self.dir(lid))

    def read_json(self, lid: str, name: str, default=None):
        try:
            return json.loads((self.dir(lid) / name).read_text(encoding="utf-8"))
        except OSError:
            return default

    def write_json(self, lid: str, name: str, obj):
        (self.dir(lid) / name).write_text(json.dumps(obj, indent=2, ensure_ascii=False), encoding="utf-8")
