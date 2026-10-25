import argparse
import asyncio
import hmac
import threading
from datetime import date
from pathlib import Path

import httpx
import uvicorn
from fastapi import Depends, FastAPI, Header, HTTPException, Query, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from notes.llm import OLLAMA, load, loaded_models
import cards as cardlib
from pipeline import BUSY, Pipeline, write_outputs
from search import search as run_search
from store import Store


class StartReq(BaseModel):
    source: str = "mic"
    course: str | None = None


class StopReq(BaseModel):
    lecture_id: str


class PatchReq(BaseModel):
    title: str | None = None
    course: str | None = None


class CardReq(BaseModel):
    question: str = Field(min_length=1)
    answer: str = Field(min_length=1)


class CardPatch(BaseModel):
    question: str | None = Field(default=None, min_length=1)
    answer: str | None = Field(default=None, min_length=1)


class AnswerReq(BaseModel):
    lecture_id: str
    card_id: str
    grade: int = Field(ge=1, le=5)


class ProfileReq(BaseModel):
    name: str = Field(min_length=1)
    subjects: list[str] = []


def whisper_present(model: str) -> bool:
    try:
        from faster_whisper.utils import download_model

        download_model(model, local_files_only=True)
        return True
    except Exception:
        return False


def create_app(token: str, data_dir: Path, pipeline: Pipeline | None = None, recorder_cls=None) -> FastAPI:
    store = Store(data_dir)
    pipe = pipeline or Pipeline(store)
    if recorder_cls is None:
        from capture.recorder import Recorder as recorder_cls
    rec = {"r": None, "id": None, "level": 0.0}
    model_state = {"loading": False, "error": None}
    rec_lock = threading.Lock()  # /record/start runs in the threadpool; opening a device takes a while

    app = FastAPI()
    app.state.data_dir = data_dir
    app.state.store = store
    # dev server + file:// renderer (origin "null"); the token is required regardless
    app.add_middleware(CORSMiddleware, allow_origins=["null", "http://localhost:5173", "http://127.0.0.1:5173"],
                       allow_methods=["*"], allow_headers=["*"])

    def auth(x_token: str = Header(default=""), token_q: str = Query(default="", alias="token")):
        if not hmac.compare_digest(x_token or token_q, token):
            raise HTTPException(401, "bad token")

    def lecture(lid: str) -> dict:
        try:
            return store.get(lid)
        except KeyError:
            raise HTTPException(404, "no such lecture")

    def file(lid: str, name: str, **kw):
        lecture(lid)
        p = store.dir(lid) / name
        if not p.exists():
            raise HTTPException(404, f"{name} not available")
        return FileResponse(p, **kw)

    @app.get("/profile", dependencies=[Depends(auth)])
    def get_profile():
        return {"profile": store.profile(), "streak": store.streak(), "days": store.days()}

    @app.put("/profile", dependencies=[Depends(auth)])
    def put_profile(req: ProfileReq):
        name, subjects = req.name.strip(), list({s.strip().lower(): s.strip() for s in req.subjects if s.strip()}.values())
        if not name:
            raise HTTPException(422, "name required")
        store.set_profile(name, subjects)
        return {"name": name, "subjects": subjects}

    @app.get("/health", dependencies=[Depends(auth)])
    def health():
        cfg = store.config()
        try:
            models = httpx.get(f"{OLLAMA}/api/tags", timeout=1).json().get("models", [])
            names = [m["name"] for m in models]
            try:
                loaded = cfg["ollama_model"] in loaded_models()
            except httpx.HTTPError:
                loaded = False
            ollama = {"reachable": True, "models": names, "model": cfg["ollama_model"],
                      "model_pulled": cfg["ollama_model"] in names, "loaded": loaded, **model_state}
        except httpx.HTTPError:
            ollama = {"reachable": False, "models": [], "model": cfg["ollama_model"], "model_pulled": False,
                      "loaded": False, **model_state}
        return {"ready": True, "ollama": ollama,
                "whisper": {"model": cfg["whisper_model"], "present": whisper_present(cfg["whisper_model"])}}

    @app.post("/model/load", dependencies=[Depends(auth)])
    def model_load():
        # cold start is ~1 min for an 8B model; do it in the background and let /health report progress
        if model_state["loading"]:
            return {"loading": True}
        model_state.update(loading=True, error=None)

        def run():
            try:
                load(store.config()["ollama_model"])
            except Exception as e:
                model_state["error"] = f"{type(e).__name__}: {e}"
            finally:
                model_state["loading"] = False

        threading.Thread(target=run, daemon=True).start()
        return {"loading": True}

    @app.post("/record/start", dependencies=[Depends(auth)])
    def record_start(req: StartReq):
        if req.source not in ("mic", "loopback", "both"):
            raise HTTPException(400, f"unknown source {req.source!r}")
        with rec_lock:
            if rec["r"]:
                raise HTTPException(409, "already recording")
            st = store.create(req.source, (req.course or "").strip() or None)
            try:
                rec["r"] = recorder_cls(req.source, store.dir(st["id"]) / "segments",
                                        lambda v: rec.__setitem__("level", v))
            except Exception as e:
                store.delete(st["id"])
                raise HTTPException(400, str(e))
            rec["id"] = st["id"]
            return {"lecture_id": st["id"]}

    @app.post("/record/stop", dependencies=[Depends(auth)])
    def record_stop(req: StopReq):
        if not rec["r"] or rec["id"] != req.lecture_id:
            raise HTTPException(409, "not recording that lecture")
        r, lid = rec["r"], rec["id"]
        duration = r.stop()
        rec.update(r=None, id=None, level=0.0)
        store.update(lid, duration=round(duration, 1), state="recorded", error=r.error)
        return {"duration": duration, "error": r.error}

    @app.post("/process/{lid}", dependencies=[Depends(auth)])
    def process(lid: str):
        st = lecture(lid)
        if st["state"] in ("recording", "queued") or pipe.current == lid or rec["id"] == lid:
            raise HTTPException(409, f"lecture is {st['state']}")
        if st["state"] in ("ready", "failed", "cancelled") and st["stages"]["assemble"] == "done":
            pipe.reset(lid)  # explicit re-process
        pipe.enqueue(lid)
        return {"state": "queued"}

    @app.post("/process/{lid}/cancel", dependencies=[Depends(auth)])
    def cancel(lid: str):
        lecture(lid)
        pipe.cancel(lid)
        return {"ok": True}

    @app.get("/lectures", dependencies=[Depends(auth)])
    def lectures():
        return store.list()

    @app.get("/search", dependencies=[Depends(auth)])
    def search(q: str = Query(min_length=1), scope: str = Query(default="all", pattern="^(all|names)$")):
        return run_search(store, q, scope)

    @app.get("/lectures/{lid}", dependencies=[Depends(auth)])
    def detail(lid: str):
        st = lecture(lid)
        d = store.dir(lid)
        summary = d / "summary.md"
        return {**st, "summary": summary.read_text(encoding="utf-8") if summary.exists() else None,
                **{"terms": [], "actions": [], **(store.read_json(lid, "extract.json") or {})},
                "flashcards": store.cards(lid),
                "has_audio": (d / "audio.wav").exists()}

    @app.patch("/lectures/{lid}", dependencies=[Depends(auth)])
    def patch(lid: str, req: PatchReq):
        lecture(lid)
        kw = req.model_dump(exclude_none=True)
        if "course" in kw:
            kw["course"] = kw["course"].strip() or None  # cleared course is no course, not ""
        return store.update(lid, **kw)

    @app.delete("/lectures/{lid}", dependencies=[Depends(auth)])
    def delete(lid: str):
        lecture(lid)
        if rec["id"] == lid or pipe.current == lid or lecture(lid)["state"] in BUSY:
            raise HTTPException(409, "lecture is in use")
        store.delete(lid)
        return {"ok": True}

    @app.get("/lectures/{lid}/transcript", dependencies=[Depends(auth)])
    def transcript(lid: str):
        lecture(lid)
        return store.read_json(lid, "transcript.json", [])

    @app.get("/lectures/{lid}/audio", dependencies=[Depends(auth)])
    def audio(lid: str):
        return file(lid, "audio.wav", media_type="audio/wav")

    @app.delete("/lectures/{lid}/audio", dependencies=[Depends(auth)])
    def delete_audio(lid: str):
        st = lecture(lid)
        d = store.dir(lid)
        if st["state"] not in ("ready", "failed", "cancelled", "recorded") or not (d / "transcript.json").exists():
            raise HTTPException(409, "audio can only be deleted once the transcript exists and nothing is running")
        (d / "audio.wav").unlink(missing_ok=True)
        for s in (d / "segments").glob("*.wav"):
            s.unlink()
        return {"ok": True}

    @app.get("/lectures/{lid}/anki", dependencies=[Depends(auth)])
    def anki(lid: str):
        return file(lid, "flashcards.apkg", filename=f"{lid}.apkg")

    @app.get("/lectures/{lid}/notes", dependencies=[Depends(auth)])
    def notes(lid: str):
        return file(lid, "notes.md", filename=f"{lid}.md", media_type="text/markdown")

    def edit_cards(lid: str, fn):
        if lecture(lid)["state"] in BUSY:
            raise HTTPException(409, "lecture is being processed")
        out = store.edit_cards(lid, fn)
        if (store.dir(lid) / "summary.md").exists() and store.read_json(lid, "extract.json"):
            write_outputs(store, lid)
        return out

    @app.post("/lectures/{lid}/cards", dependencies=[Depends(auth)])
    def add_card(lid: str, req: CardReq):
        def add(f):
            c = cardlib.merge({"cards": [], "seen": []}, [req.model_dump()])["cards"][0]
            f["cards"].append(c)
            return c
        return edit_cards(lid, add)

    @app.patch("/lectures/{lid}/cards/{cid}", dependencies=[Depends(auth)])
    def patch_card(lid: str, cid: str, req: CardPatch):
        def patch_(f):
            for c in f["cards"]:
                if c["id"] == cid:
                    c.update(req.model_dump(exclude_none=True))
                    return c
            raise HTTPException(404, "no such card")
        return edit_cards(lid, patch_)

    @app.delete("/lectures/{lid}/cards/{cid}", dependencies=[Depends(auth)])
    def delete_card(lid: str, cid: str):
        def drop(f):
            if not any(c["id"] == cid for c in f["cards"]):
                raise HTTPException(404, "no such card")
            f["cards"] = [c for c in f["cards"] if c["id"] != cid]
        edit_cards(lid, drop)
        return {"ok": True}

    def review_entries(course: str | None = None, lid: str | None = None):
        out = []
        for st in store.list():
            if st["state"] != "ready" or (lid and st["id"] != lid):
                continue
            if course is not None and (st["course"] or "") != course:
                continue
            out += [(st, c) for c in store.cards(st["id"])]
        return out

    def new_left() -> int:
        return store.config()["new_cards_per_day"] - store.new_today()

    @app.get("/review/queue", dependencies=[Depends(auth)])
    def review_queue(course: str | None = None, lecture: str | None = None, practice: bool = False):
        es = {(st["id"], c["id"]): st for st, c in review_entries(course, lecture)}
        entries = [(st["id"], c) for st, c in review_entries(course, lecture)]
        q = entries if practice else cardlib.queue(entries, date.today(), new_left())  # practice: every card, ignoring schedule
        return {"cards": [{"lecture_id": lid, "title": es[lid, c["id"]]["title"], "course": es[lid, c["id"]]["course"], "card": c} for lid, c in q],
                "due": len(q), "new_left": max(new_left(), 0)}

    @app.get("/review/courses", dependencies=[Depends(auth)])
    def review_courses():
        by: dict[str, list] = {}
        for st, c in review_entries():
            by.setdefault(st["course"] or "", []).append((st["id"], c))
        left, today = new_left(), date.today()
        courses = [{"course": k or None, "due": len(cardlib.queue(v, today, left))} for k, v in by.items()]
        total = len(cardlib.queue([e for v in by.values() for e in v], today, left))
        return {"due": total, "courses": courses, "streak": store.streak()}

    @app.post("/review/answer", dependencies=[Depends(auth)])
    def review_answer(req: AnswerReq):
        if req.grade not in (1, 3, 4, 5):
            raise HTTPException(422, "grade must be 1, 3, 4 or 5")
        lecture(req.lecture_id)

        def answer(f):
            for i, c in enumerate(f["cards"]):
                if c["id"] == req.card_id:
                    f["cards"][i] = cardlib.grade(c, req.grade, date.today())
                    return c, f["cards"][i]
            raise HTTPException(404, "no such card")
        old, new = store.edit_cards(req.lecture_id, answer)
        store.mark_reviewed(new=int(cardlib.is_new(old)))  # one write: new-card count and streak together
        return new

    @app.post("/review/practiced", dependencies=[Depends(auth)])
    def review_practiced():
        store.mark_reviewed()  # practice counts toward streak/heatmap but doesn't touch scheduling
        return {}

    @app.websocket("/ws")
    async def ws(sock: WebSocket):
        if not hmac.compare_digest(sock.query_params.get("token", ""), token):
            await sock.close(code=1008)
            return
        await sock.accept()
        try:
            while True:
                r = rec["r"]
                await sock.send_json({"type": "level", "level": rec["level"], "recording": bool(r), "lecture_id": rec["id"],
                                      "seconds": r.seconds if r else 0, "error": r.error if r else None})
                await asyncio.sleep(0.1)
        except (WebSocketDisconnect, RuntimeError):
            pass

    return app


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--port", type=int, required=True)
    p.add_argument("--token", required=True)
    p.add_argument("--data-dir", type=Path, required=True)
    a = p.parse_args()
    a.data_dir.mkdir(parents=True, exist_ok=True)
    uvicorn.run(create_app(a.token, a.data_dir), host="127.0.0.1", port=a.port)
