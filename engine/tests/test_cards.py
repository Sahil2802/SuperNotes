import json
from datetime import date, timedelta

import cards
from store import Store

T = date(2026, 10, 25)


def q(*qs):
    return [{"question": x, "answer": "a"} for x in qs]


def new():
    return cards.merge({"cards": [], "seen": []}, q("x"))["cards"][0]


def test_merge_adds_only_unseen_questions():
    f = cards.merge({"cards": [], "seen": []}, q("A", "B"))
    f = cards.merge(f, q("a ", "C"))
    assert [c["question"] for c in f["cards"]] == ["A", "B", "C"]


def test_deleted_card_stays_deleted_after_merge():
    f = cards.merge({"cards": [], "seen": []}, q("A", "B"))
    f["cards"] = [c for c in f["cards"] if c["question"] != "A"]
    f = cards.merge(f, q("A", "B"))
    assert [c["question"] for c in f["cards"]] == ["B"]


def test_grade_again_resets_interval_and_keeps_ef():
    c = cards.grade(cards.grade(new(), 4, T), 4, T)
    c = cards.grade(c, 1, T)
    assert (c["reps"], c["interval"], c["ef"]) == (0, 1, 2.5)
    assert c["due"] == (T + timedelta(days=1)).isoformat()


def test_grade_good_sequence():
    c = new()
    seen = []
    for _ in range(3):
        c = cards.grade(c, 4, T)
        seen.append(c["interval"])
    assert seen[:2] == [1, 6] and seen[2] == round(6 * 2.5)


def test_grade_easy_raises_ef_and_hard_lowers_it():
    assert cards.grade(new(), 5, T)["ef"] > 2.5
    assert cards.grade(new(), 3, T)["ef"] < 2.5
    c = new()
    for _ in range(30):
        c = cards.grade(c, 3, T)
    assert c["ef"] == 1.3


def test_queue_caps_new_cards_not_due_cards():
    due = [("L", {**new(), "due": T.isoformat(), "reps": 1}) for _ in range(3)]
    fresh = [("L", new()) for _ in range(5)]
    future = [("L", {**new(), "due": (T + timedelta(days=2)).isoformat(), "reps": 1})]
    assert len(cards.queue(due + fresh + future, T, 2)) == 5


def test_store_imports_extract_json_when_no_cards_file(tmp_path):
    s = Store(tmp_path)
    lid = s.create("mic", None)["id"]
    s.write_json(lid, "extract.json", {"flashcards": q("A"), "terms": [], "actions": []})
    assert [c["question"] for c in s.cards(lid)] == ["A"]
    assert json.loads((s.dir(lid) / "cards.json").read_text())["seen"] == ["a"]


def test_new_today_resets_on_new_date(tmp_path, monkeypatch):
    s = Store(tmp_path)
    s.add_new_today(); s.add_new_today()
    assert s.new_today() == 2
    (tmp_path / "review.json").write_text(json.dumps({"date": "2000-01-01", "new": 9}))
    assert s.new_today() == 0
