import json
from datetime import date, timedelta

import yaml
from fastapi.testclient import TestClient

from app import create_app

H = {"X-Token": "secret"}


def setup(tmp_path, limit=None):
    if limit is not None:
        (tmp_path / "config.yaml").write_text(yaml.safe_dump({"new_cards_per_day": limit}))
    app = create_app("secret", tmp_path)
    c = TestClient(app, headers=H)
    return c, app.state.store


def lecture(store, qs, course=None, state="ready"):
    lid = store.create("mic", course)["id"]
    store.write_json(lid, "extract.json", {"flashcards": [{"question": x, "answer": "a"} for x in qs], "terms": [], "actions": []})
    store.write_json(lid, "transcript.json", [])
    (store.dir(lid) / "summary.md").write_text("s")
    store.update(lid, state=state)
    return lid


def test_card_crud_roundtrip(tmp_path):
    c, s = setup(tmp_path)
    lid = lecture(s, ["A"])
    cid = c.get(f"/lectures/{lid}").json()["flashcards"][0]["id"]
    new = c.post(f"/lectures/{lid}/cards", json={"question": "B", "answer": "b"}).json()
    assert c.patch(f"/lectures/{lid}/cards/{cid}", json={"answer": "z"}).json()["answer"] == "z"
    assert c.delete(f"/lectures/{lid}/cards/{new['id']}").json() == {"ok": True}
    assert [x["question"] for x in c.get(f"/lectures/{lid}").json()["flashcards"]] == ["A"]
    assert c.patch(f"/lectures/{lid}/cards/nope", json={"answer": "z"}).status_code == 404


def test_reprocess_keeps_edits_and_deletes(tmp_path):
    c, s = setup(tmp_path)
    lid = lecture(s, ["A", "B"])
    a, b = c.get(f"/lectures/{lid}").json()["flashcards"]
    c.delete(f"/lectures/{lid}/cards/{a['id']}")
    c.patch(f"/lectures/{lid}/cards/{b['id']}", json={"question": "B2"})
    s.sync_cards(lid)
    qs = [x["question"] for x in c.get(f"/lectures/{lid}").json()["flashcards"]]
    assert "A" not in qs and "B2" in qs


def test_queue_filters_by_course_lecture_and_no_course(tmp_path):
    c, s = setup(tmp_path)
    p = lecture(s, ["p1", "p2"], "Physics")
    lecture(s, ["c1"], "Chem")
    n = lecture(s, ["n1"])
    lecture(s, ["busy"], "Physics", state="summarize")
    qn = lambda **kw: sorted(x["card"]["question"] for x in c.get("/review/queue", params=kw).json()["cards"])
    assert qn() == ["c1", "n1", "p1", "p2"]
    assert qn(course="Physics") == ["p1", "p2"]
    assert qn(course="") == ["n1"]
    assert qn(lecture=p) == ["p1", "p2"] and qn(lecture=n) == ["n1"]


def test_queue_respects_daily_new_limit(tmp_path):
    c, s = setup(tmp_path, limit=2)
    lecture(s, ["a", "b", "c", "d", "e"])
    r = c.get("/review/queue").json()
    assert len(r["cards"]) == 2 and r["new_left"] == 2


def test_answer_updates_schedule_and_counts_new_once(tmp_path):
    c, s = setup(tmp_path)
    lid = lecture(s, ["A"])
    cid = c.get(f"/lectures/{lid}").json()["flashcards"][0]["id"]
    body = {"lecture_id": lid, "card_id": cid}
    assert c.post("/review/answer", json={**body, "grade": 1}).json()["interval"] == 1
    assert c.post("/review/answer", json={**body, "grade": 4}).json()["reps"] == 1
    assert s.new_today() == 1
    assert c.get("/review/queue").json()["cards"] == []  # now scheduled for the future


def test_streak_counts_consecutive_days(tmp_path):
    c, s = setup(tmp_path)
    assert s.streak() == 0
    lid = lecture(s, ["A"])
    cid = c.get(f"/lectures/{lid}").json()["flashcards"][0]["id"]
    c.post("/review/answer", json={"lecture_id": lid, "card_id": cid, "grade": 4})
    assert c.get("/review/courses").json()["streak"] == 1
    assert c.get("/profile").json()["days"] == {date.today().isoformat(): 1}
    c.post("/review/answer", json={"lecture_id": lid, "card_id": cid, "grade": 4})
    assert c.get("/profile").json()["days"] == {date.today().isoformat(): 2}
    t = date.today()
    s._atomic(s.root.parent / "review.json", json.dumps({"date": t.isoformat(), "new": 0, "days": [
        (t - timedelta(days=n)).isoformat() for n in (0, 1, 2, 4)]}))
    assert s.streak() == 3  # day 3 missing
    s._atomic(s.root.parent / "review.json", json.dumps({"date": t.isoformat(), "new": 0, "days": [
        (t - timedelta(days=n)).isoformat() for n in (1, 2)]}))
    assert s.streak() == 2  # today not yet reviewed: still alive
    s._atomic(s.root.parent / "review.json", json.dumps({"date": t.isoformat(), "new": 0, "days": [
        (t - timedelta(days=2)).isoformat()]}))
    assert s.streak() == 0


def test_answer_rejects_bad_grade(tmp_path):
    c, s = setup(tmp_path)
    lid = lecture(s, ["A"])
    cid = c.get(f"/lectures/{lid}").json()["flashcards"][0]["id"]
    assert c.post("/review/answer", json={"lecture_id": lid, "card_id": cid, "grade": 2}).status_code == 422


def test_edit_rewrites_anki_and_notes(tmp_path):
    c, s = setup(tmp_path)
    lid = lecture(s, ["A"])
    cid = c.get(f"/lectures/{lid}").json()["flashcards"][0]["id"]
    c.patch(f"/lectures/{lid}/cards/{cid}", json={"question": "Edited Q"})
    assert "Edited Q" in c.get(f"/lectures/{lid}/notes").text
    assert c.get(f"/lectures/{lid}/anki").status_code == 200


def test_courses_endpoint_counts(tmp_path):
    c, s = setup(tmp_path)
    lecture(s, ["p1", "p2"], "Physics")
    lecture(s, ["n1"])
    r = c.get("/review/courses").json()
    assert r["due"] == 3
    assert sorted((x["course"] or "", x["due"]) for x in r["courses"]) == [("", 1), ("Physics", 2)]


def test_card_write_refused_while_busy(tmp_path):
    c, s = setup(tmp_path)
    lid = lecture(s, ["A"], state="summarize")
    assert c.post(f"/lectures/{lid}/cards", json={"question": "B", "answer": "b"}).status_code == 409


def test_profile_roundtrip(tmp_path):
    c, s = setup(tmp_path)
    assert c.get("/profile").json()["profile"] is None
    assert c.put("/profile", json={"name": "  ", "subjects": []}).status_code == 422
    c.put("/profile", json={"name": " Sam ", "subjects": ["Physics", " ", "Art "]})
    assert c.get("/profile").json()["profile"] == {"name": "Sam", "subjects": ["Physics", "Art"]}


def test_practice_queue_ignores_schedule(tmp_path):
    c, s = setup(tmp_path)
    lid = lecture(s, ["A", "B"])
    cid = c.get(f"/lectures/{lid}").json()["flashcards"][0]["id"]
    c.post("/review/answer", json={"lecture_id": lid, "card_id": cid, "grade": 4})
    assert len(c.get("/review/queue").json()["cards"]) == 1
    assert len(c.get("/review/queue?practice=true").json()["cards"]) == 2
