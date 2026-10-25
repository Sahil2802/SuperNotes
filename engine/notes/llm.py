"""Thin Ollama client + transcript chunking."""
import time

import httpx

OLLAMA = "http://127.0.0.1:11434"
CHUNK_CHARS = 8000  # ~2k tokens; leaves room for prompt + output in an 8k context


def chat(model: str, prompt: str, schema: dict | None = None) -> str:
    body = {
        "model": model,
        "stream": False,
        "options": {"num_ctx": 8192, "temperature": 0.2},
        "messages": [
            {"role": "system", "content": "Never use em dashes. Use commas, colons, periods or hyphens instead."},
            {"role": "user", "content": prompt},
        ],
    }
    if schema:
        body["format"] = schema
    for attempt in range(3):  # Ollama 500s while a model is still loading / VRAM is being freed
        r = httpx.post(f"{OLLAMA}/api/chat", json=body, timeout=600)
        if r.status_code < 500 or attempt == 2:
            break
        time.sleep(10)
    r.raise_for_status()
    # models ignore the instruction now and then, so enforce it
    return r.json()["message"]["content"].replace(" — ", ", ").replace("—", "-")


def chunk(segs: list[dict], limit: int = CHUNK_CHARS) -> list[str]:
    chunks, cur, n = [], [], 0
    for s in segs:
        line = f"[{int(s['start'] // 60)}:{int(s['start'] % 60):02d}] {s['text']}"
        if n + len(line) > limit and cur:
            chunks.append("\n".join(cur))
            cur, n = [], 0
        cur.append(line)
        n += len(line) + 1
    if cur:
        chunks.append("\n".join(cur))
    return chunks
