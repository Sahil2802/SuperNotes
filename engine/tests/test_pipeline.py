import time
import wave

import pipeline
from fastapi.testclient import TestClient

from app import create_app

H = {"X-Token": "secret"}


class FakeRecorder:
    seconds = 0.0
    error = None

    def __init__(self, source, out_dir, on_level=None):
        with wave.open(str(out_dir / "seg_00000.wav"), "wb") as w:
            w.setnchannels(1); w.setsampwidth(2); w.setframerate(16000)
            w.writeframes(b"\0\0" * 16000)

    def stop(self):
        return 1.0


def test_full_pipeline(tmp_path, monkeypatch):
    monkeypatch.setattr(pipeline, "transcribe", lambda *a, **k: [{"start": 0, "end": 1, "text": "hello"}])
    monkeypatch.setattr(pipeline, "summarize", lambda *a, **k: "## S\n- point")
    monkeypatch.setattr(pipeline, "extract", lambda *a, **k: {
        "flashcards": [{"question": "q", "answer": "a"}], "terms": [], "actions": ["do x"]})
    c = TestClient(create_app("secret", tmp_path, recorder_cls=FakeRecorder))

    lid = c.post("/record/start", json={"source": "mic"}, headers=H).json()["lecture_id"]
    assert c.post("/record/start", json={}, headers=H).status_code == 409
    c.post("/record/stop", json={"lecture_id": lid}, headers=H)
    assert c.post(f"/process/{lid}", headers=H).status_code == 200

    for _ in range(50):
        d = c.get(f"/lectures/{lid}", headers=H).json()
        if d["state"] in ("ready", "failed"):
            break
        time.sleep(0.1)
    assert d["state"] == "ready", d["error"]
    assert d["flashcards"] and d["actions"] == ["do x"] and d["summary"].startswith("## S")
    assert c.get(f"/lectures/{lid}/anki", headers=H).status_code == 200
    assert c.get(f"/lectures/{lid}/audio?token=secret").status_code == 200
    assert c.delete(f"/lectures/{lid}", headers=H).status_code == 200
    assert c.get("/lectures", headers=H).json() == []


def test_guards_and_reprocess_after_audio_delete(tmp_path, monkeypatch):
    monkeypatch.setattr(pipeline, "transcribe", lambda *a, **k: [{"start": 0, "end": 1, "text": "hello"}])
    monkeypatch.setattr(pipeline, "summarize", lambda *a, **k: "s")
    monkeypatch.setattr(pipeline, "extract", lambda *a, **k: {"flashcards": [], "terms": [], "actions": []})
    c = TestClient(create_app("secret", tmp_path, recorder_cls=FakeRecorder))
    assert c.post("/record/start", json={"source": "bogus"}, headers=H).status_code == 400
    lid = c.post("/record/start", json={"source": "mic"}, headers=H).json()["lecture_id"]
    assert c.post(f"/process/{lid}", headers=H).status_code == 409  # still recording
    assert c.delete(f"/lectures/{lid}/audio", headers=H).status_code == 409
    c.post("/record/stop", json={"lecture_id": lid}, headers=H)
    c.post(f"/process/{lid}", headers=H)
    for _ in range(50):
        if c.get(f"/lectures/{lid}", headers=H).json()["state"] == "ready":
            break
        time.sleep(0.1)
    assert c.delete(f"/lectures/{lid}/audio", headers=H).status_code == 200
    assert c.post(f"/process/{lid}", headers=H).status_code == 200  # re-process without audio
    for _ in range(50):
        d = c.get(f"/lectures/{lid}", headers=H).json()
        if d["state"] in ("ready", "failed"):
            break
        time.sleep(0.1)
    assert d["state"] == "ready", d["error"]
