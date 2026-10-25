"""Flashcards: import from model output, SM-2 scheduling, review queue. Pure functions; `today` is passed in."""
import uuid
from datetime import date, timedelta


def _key(question: str) -> str:
    return question.strip().lower()


def merge(file: dict, extracted: list[dict]) -> dict:
    """Add cards for questions never imported before; deleted cards stay deleted via `seen`."""
    seen = set(file["seen"])
    for x in extracted:
        k = _key(x["question"])
        if k in seen:
            continue
        seen.add(k)
        file["cards"].append({"id": uuid.uuid4().hex[:8], "question": x["question"], "answer": x["answer"],
                              "ef": 2.5, "reps": 0, "interval": 0, "due": None})
        file["seen"].append(k)
    return file


def is_new(card: dict) -> bool:
    return card["due"] is None


def is_due(card: dict, today: date) -> bool:
    return not is_new(card) and date.fromisoformat(card["due"]) <= today


def grade(card: dict, g: int, today: date) -> dict:
    c = dict(card)
    if g < 3:
        c["reps"], c["interval"] = 0, 1
    else:
        c["interval"] = 1 if c["reps"] == 0 else 6 if c["reps"] == 1 else round(c["interval"] * c["ef"])
        c["reps"] += 1
        c["ef"] = round(max(1.3, c["ef"] + 0.1 - (5 - g) * (0.08 + (5 - g) * 0.02)), 4)
    c["due"] = (today + timedelta(days=c["interval"])).isoformat()
    return c


def queue(entries: list[tuple[str, dict]], today: date, new_left: int) -> list[tuple[str, dict]]:
    """All due reviews, then new cards up to `new_left`. entries are (lecture_id, card)."""
    due = [e for e in entries if is_due(e[1], today)]
    return due + [e for e in entries if is_new(e[1])][:max(new_left, 0)]
