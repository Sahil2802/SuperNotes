import logging
from pathlib import Path

from pydantic import BaseModel, ValidationError

from .llm import chat, chunk

PROMPTS = Path(__file__).parent.parent / "prompts"
log = logging.getLogger(__name__)


class Card(BaseModel):
    question: str
    answer: str


class Term(BaseModel):
    term: str
    definition: str


class Extraction(BaseModel):
    flashcards: list[Card] = []
    terms: list[Term] = []
    actions: list[str] = []


def extract(segs: list[dict], model: str, cancelled=lambda: False) -> dict:
    cards, terms, actions = {}, {}, {}
    prompt = (PROMPTS / "extract.txt").read_text()
    for i, c in enumerate(chunk(segs)):
        if cancelled():
            break
        ex = None
        for _ in range(2):  # retry once on invalid output, then skip the chunk
            try:
                ex = Extraction.model_validate_json(chat(model, prompt.format(text=c), Extraction.model_json_schema()))
                break
            except (ValidationError, ValueError) as e:
                log.warning("chunk %d invalid extraction: %s", i, e)
        if not ex:
            continue
        for x in ex.flashcards:
            cards.setdefault(x.question.strip().lower(), x.model_dump())
        for x in ex.terms:
            terms.setdefault(x.term.strip().lower(), x.model_dump())
        for x in ex.actions:
            actions.setdefault(x.strip().lower(), x)
    return {"flashcards": list(cards.values()), "terms": list(terms.values()), "actions": list(actions.values())}
