from pathlib import Path

from .llm import chat, chunk

PROMPTS = Path(__file__).parent.parent / "prompts"


def summarize(segs: list[dict], model: str, cancelled=lambda: False) -> str:
    if not segs:
        return "No speech was detected in this recording."
    parts = []
    for c in chunk(segs):
        if cancelled():
            return ""
        parts.append(chat(model, (PROMPTS / "map.txt").read_text().format(text=c), cancelled=cancelled))
    if len(parts) == 1:
        return parts[0]
    # ponytail: single reduce pass; many-hour lectures would need a tree reduce
    return chat(model, (PROMPTS / "reduce.txt").read_text().format(text="\n\n".join(parts)))
