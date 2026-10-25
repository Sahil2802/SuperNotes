"""Substring search over each lecture's title, transcript, summary and extracted terms/actions."""
import re

FIELDS = ("title", "transcript", "summary", "terms", "actions")


def _snippet(text: str, words: list[str], width: int = 70) -> str:
    text = re.sub(r"\s+", " ", text)
    i = min(p for p in (text.lower().find(w) for w in words) if p >= 0)
    a = max(0, i - width)
    return ("…" if a else "") + text[a : i + width * 2].strip() + ("…" if i + width * 2 < len(text) else "")


def _fields(store, st: dict) -> dict[str, str]:
    lid = st["id"]
    ex = store.read_json(lid, "extract.json") or {}
    summary = store.dir(lid) / "summary.md"
    return {
        "title": st["title"],
        "transcript": " ".join(s["text"] for s in store.read_json(lid, "transcript.json", [])),
        "summary": summary.read_text(encoding="utf-8") if summary.exists() else "",
        "terms": "\n".join(f"{t['term']}: {t['definition']}" for t in ex.get("terms", [])),
        "actions": "\n".join(ex.get("actions", [])),
    }


def search(store, q: str, scope: str = "all") -> list[dict]:
    """Every word of q must appear (case-insensitive) somewhere in the lecture; newest lectures first."""
    words = q.lower().split()
    out = []
    for st in store.list():
        f = _fields(store, st) if scope == "all" else {"title": st["title"]}
        if not all(w in "\n".join(f.values()).lower() for w in words):
            continue
        hit = [k for k in FIELDS if k in f and any(w in f[k].lower() for w in words)]
        body = next((k for k in hit if k != "title"), None)
        out.append({"id": st["id"], "title": st["title"], "course": st["course"], "matched": hit,
                    "snippet": _snippet(f[body], words) if body else None})
    return out
