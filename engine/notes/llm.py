"""Thin Ollama client + transcript chunking."""
import json
import time

import httpx

OLLAMA = "http://127.0.0.1:11434"
NUM_CTX = 8192
KEEP_ALIVE = "30m"  # keep the model resident between lectures
CHUNK_CHARS = 8000  # ~2k tokens; leaves room for prompt + output in an 8k context


class Cancelled(Exception):
    pass


def _stream(body: dict, cancelled) -> str:
    parts = []
    # read timeout is per chunk of output, not per call: a healthy long generation never trips it,
    # while the first token may wait on a cold model load
    with httpx.stream("POST", f"{OLLAMA}/api/chat", json=body, timeout=httpx.Timeout(10, read=180)) as r:
        if r.status_code >= 400:
            r.read()
            r.raise_for_status()
        for line in r.iter_lines():  # leaving the with-block closes the connection, which stops generation
            if cancelled():
                raise Cancelled
            if not line:
                continue
            j = json.loads(line)
            if "error" in j:
                raise RuntimeError(j["error"])
            parts.append(j.get("message", {}).get("content", ""))
            if j.get("done"):
                break
    return "".join(parts)


def chat(model: str, prompt: str, schema: dict | None = None, cancelled=lambda: False) -> str:
    body = {
        "model": model,
        "stream": True,
        "keep_alive": KEEP_ALIVE,
        "options": {"num_ctx": NUM_CTX, "temperature": 0.2},
        "messages": [
            {"role": "system", "content": "Never use em dashes. Use commas, colons, periods or hyphens instead."},
            {"role": "user", "content": prompt},
        ],
    }
    if schema:
        body["format"] = schema
    for attempt in range(3):  # Ollama 500s while a model is still loading / VRAM is being freed
        try:
            # models ignore the em-dash instruction now and then, so enforce it
            return _stream(body, cancelled).replace(" — ", ", ").replace("—", "-")
        except httpx.HTTPStatusError as e:
            if e.response.status_code < 500 or attempt == 2:
                raise
        for _ in range(100):  # 10 s back-off, still cancellable
            if cancelled():
                raise Cancelled
            time.sleep(0.1)


def load(model: str):
    """Load the model into memory (no generation) so the first real call doesn't pay the cold start."""
    # same num_ctx as chat(): a different context size makes Ollama reload the model on the first real call
    body = {"model": model, "keep_alive": KEEP_ALIVE, "options": {"num_ctx": NUM_CTX}}
    for attempt in range(3):  # a 500 can happen while a previous instance of the model is still unloading
        r = httpx.post(f"{OLLAMA}/api/generate", json=body, timeout=600)
        if r.status_code < 500 or attempt == 2:
            break
        time.sleep(5)
    r.raise_for_status()


def loaded_models() -> list[str]:
    return [m["name"] for m in httpx.get(f"{OLLAMA}/api/ps", timeout=1).json().get("models", [])]


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
