import hashlib
from pathlib import Path

import genanki


def notepack_md(st: dict, summary: str, segs: list[dict], ex: dict) -> str:
    md = [f"# {st['title']}", f"*{st.get('course') or 'No course'}*", "", "## Summary", "", summary, ""]
    md += ["## Terms", ""] + [f"- **{t['term']}**: {t['definition']}" for t in ex["terms"]]
    md += ["", "## Action items", ""] + [f"- {a}" for a in ex["actions"]]
    md += ["", "## Flashcards", ""] + [f"**Q:** {c['question']}  \n**A:** {c['answer']}\n" for c in ex["flashcards"]]
    md += ["", "## Transcript", ""] + [f"`{int(s['start'] // 60)}:{int(s['start'] % 60):02d}` {s['text']}" for s in segs]
    return "\n".join(md)


def _id(s: str) -> int:
    return int(hashlib.sha1(s.encode()).hexdigest()[:8], 16)


def write_apkg(st: dict, cards: list[dict], path: Path):
    model = genanki.Model(
        1607392319,
        "Live Notes Basic",
        fields=[{"name": "Question"}, {"name": "Answer"}],
        templates=[{"name": "Card 1", "qfmt": "{{Question}}", "afmt": "{{FrontSide}}<hr id=answer>{{Answer}}"}],
    )
    deck = genanki.Deck(_id(st["id"]), st["title"])
    for c in cards:
        deck.add_note(genanki.Note(model=model, fields=[c["question"], c["answer"]]))
    genanki.Package(deck).write_to_file(str(path))
